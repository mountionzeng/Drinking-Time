import { createHmac, randomBytes } from "node:crypto";

import { ENV } from "../_core/env";
import {
  consumeConfirmedWebLogin,
  decideWebLogin,
  decideWebLoginWithBinding,
  findOpenWebLoginByCode,
  findWebLoginByLookup,
  insertWebLoginRequest,
  markWebLoginScanned,
} from "../repositories/webLoginRequests";
import { consumePersistentRateLimit } from "../repositories/accounts";
import { bindWechatAccount, resolveWechatAccount } from "./accountIdentity";
import {
  generatePairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
} from "./accountSecurity";

/** 网页登录请求 120 秒有效。 */
export const WEB_LOGIN_TTL_MS = 120_000;

export const WEB_LOGIN_LIMITS = {
  create: { windowSeconds: 600, maxAttempts: 10 },
  poll: { windowSeconds: 10, maxAttempts: 10 },
  confirmMinute: { windowSeconds: 60, maxAttempts: 5 },
  confirmHour: { windowSeconds: 3600, maxAttempts: 20 },
  confirmGlobal: { windowSeconds: 60, maxAttempts: 120 },
};

export function isWechatScanLoginEnabled(): boolean {
  return process.env.WECHAT_SCAN_LOGIN_ENABLED === "true";
}

function secret(): string {
  return ENV.otpDigestSecret;
}
function secretVersion(): number {
  const version = Number(ENV.otpDigestSecretVersion);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

/** 与配对码同样的带密钥摘要；没有密钥失败关闭，绝不退化成裸哈希。 */
function digest(kind: "lookup" | "verifier" | "code", value: string): string {
  const key = secret();
  if (!key.trim()) throw new Error("web_login_not_configured");
  return createHmac("sha256", key).update(`weblogin:${kind}:${secretVersion()}:${value}`, "utf8").digest("hex");
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 只保留粗粒度的系统和浏览器，不保存完整 User-Agent 或 IP。 */
export function coarseClientHint(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "电脑";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "浏览器";
  return `${os} · ${browser}`;
}

export type CreateWebLoginResult =
  | { outcome: "created"; l: string; v: string; code: string; expiresAt: Date; clientHint: string }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "not_configured" };

export async function createWebLoginRequest(input: {
  requestIp: string;
  userAgent?: string;
  /** 已登录用户发起「绑定微信」时传入；登录模式为 undefined。 */
  bindUserId?: number;
  now?: Date;
}): Promise<CreateWebLoginResult> {
  if (!secret().trim()) return { outcome: "not_configured" };
  const now = input.now ?? new Date();
  const limit = await consumePersistentRateLimit({
    scope: "weblogin:create", subject: input.requestIp || "unknown", ...WEB_LOGIN_LIMITS.create, now,
  });
  if (!limit.allowed) return { outcome: "rate_limited", retryAfterMs: limit.retryAfterMs };

  const clientHint = coarseClientHint(input.userAgent);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const l = randomBytes(32).toString("base64url");
    const v = randomBytes(32).toString("base64url");
    const code = generatePairingCode();
    const expiresAt = new Date(now.getTime() + WEB_LOGIN_TTL_MS);
    const inserted = await insertWebLoginRequest({
      lookupHash: digest("lookup", l),
      verifierHash: digest("verifier", v),
      codeHash: digest("code", code),
      secretVersion: secretVersion(),
      mode: input.bindUserId ? "bind" : "login",
      bindUserId: input.bindUserId ?? null,
      clientHint,
      expiresAt,
    }, now);
    if (inserted) return { outcome: "created", l, v, code, expiresAt, clientHint };
  }
  throw new Error("web_login_code_space_busy");
}

export type PollWebLoginResult =
  | { status: "pending" | "scanned" | "denied" | "merge_required" | "expired" }
  | { status: "confirmed"; userId: number; mode: "login" | "bind" }
  | { status: "rate_limited"; retryAfterMs: number }
  | { status: "not_configured" };

export async function pollWebLoginRequest(input: {
  l: string;
  v: string;
  requestIp: string;
  now?: Date;
}): Promise<PollWebLoginResult> {
  if (!secret().trim()) return { status: "not_configured" };
  if (!TOKEN_PATTERN.test(input.l) || !TOKEN_PATTERN.test(input.v)) return { status: "expired" };
  const now = input.now ?? new Date();
  const lookupHash = digest("lookup", input.l);
  const limit = await consumePersistentRateLimit({
    scope: "weblogin:poll", subject: `${lookupHash}:${input.requestIp || "unknown"}`, ...WEB_LOGIN_LIMITS.poll, now,
  });
  if (!limit.allowed) return { status: "rate_limited", retryAfterMs: limit.retryAfterMs };

  const verifierHash = digest("verifier", input.v);
  const row = await findWebLoginByLookup(lookupHash);
  // 验证值不对和不存在对外一样：别人拿到 L 也只能看到 expired。
  if (!row || row.verifierHash !== verifierHash) return { status: "expired" };
  if (row.status === "confirmed") {
    const consumed = await consumeConfirmedWebLogin({ lookupHash, verifierHash, now });
    return consumed ? { status: "confirmed", userId: consumed.userId, mode: consumed.mode } : { status: "expired" };
  }
  if (row.status === "denied" || row.status === "merge_required") return { status: row.status };
  if (row.status === "consumed" || row.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
  return { status: row.status };
}

export type ConfirmDecision = "preview" | "confirm" | "deny";
export type ConfirmWebLoginResult =
  | { outcome: "preview"; clientHint: string; mode: "login" | "bind" }
  | { outcome: "confirmed" | "denied" | "merge_required" }
  | { outcome: "invalid" }
  | { outcome: "rate_limited" }
  | { outcome: "not_configured" };

/** subject 来自验过签的桥接请求，由云函数从 OPENID 计算，这里不接受客户端传入的身份。 */
export async function confirmWebLoginBySubject(input: {
  subject: string;
  code: string;
  decision: ConfirmDecision;
  now?: Date;
}): Promise<ConfirmWebLoginResult> {
  if (!secret().trim()) return { outcome: "not_configured" };
  const now = input.now ?? new Date();
  for (const [scope, subject, limit] of [
    ["weblogin:confirm:minute", input.subject, WEB_LOGIN_LIMITS.confirmMinute],
    ["weblogin:confirm:hour", input.subject, WEB_LOGIN_LIMITS.confirmHour],
    ["weblogin:confirm:global", "all", WEB_LOGIN_LIMITS.confirmGlobal],
  ] as const) {
    const decision = await consumePersistentRateLimit({ scope, subject, ...limit, now });
    if (!decision.allowed) return { outcome: "rate_limited" };
  }

  const normalized = normalizePairingCode(input.code);
  if (normalized.length !== PAIRING_CODE_LENGTH) return { outcome: "invalid" };
  const row = await findOpenWebLoginByCode(digest("code", normalized), now);
  if (!row) return { outcome: "invalid" };

  if (input.decision === "preview") {
    await markWebLoginScanned(row.id, now);
    return { outcome: "preview", clientHint: row.clientHint, mode: row.mode };
  }
  if (input.decision === "deny") {
    return (await decideWebLogin({ id: row.id, status: "denied", userId: null, now })) ? { outcome: "denied" } : { outcome: "invalid" };
  }

  if (row.mode === "bind") {
    if (!row.bindUserId) return { outcome: "invalid" };
    const outcome = await decideWebLoginWithBinding({
      id: row.id,
      now,
      bind: (userId, tx) => bindWechatAccount(userId, input.subject, tx),
    });
    return { outcome };
  }
  const userId = await resolveWechatAccount(input.subject);
  return (await decideWebLogin({ id: row.id, status: "confirmed", userId, now })) ? { outcome: "confirmed" } : { outcome: "invalid" };
}
