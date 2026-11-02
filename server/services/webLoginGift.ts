import { createHash } from "node:crypto";
import type { User } from "../../drizzle/schema";
import { COMPUTE_UNITS_PER_YUAN, MINOR_PER_YUAN } from "../../shared/computeMoney";
import { consumePersistentRateLimit } from "../repositories/accounts";
import { listCreditLedgerEntries } from "../repositories/computeLedger";
import { grantCredit } from "./computeLedger";

export const WEB_LOGIN_GIFT_MINOR = 5 * MINOR_PER_YUAN / COMPUTE_UNITS_PER_YUAN;
const GIFT_PREFIX = "web-login-gift:";
const DAY = 24 * 60 * 60;

/** 常见一次性/临时邮箱域名；可用 WEB_LOGIN_GIFT_BLOCKED_EMAIL_DOMAINS（逗号分隔）追加。 */
const BUILTIN_DISPOSABLE_DOMAINS = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.net",
  "temp-mail.io", "tempmail.dev", "tmpmail.org", "tmpmail.net", "yopmail.com", "yopmail.net",
  "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "dispostable.com",
  "maildrop.cc", "mintemail.com", "throwawaymail.com", "fakeinbox.com", "mohmal.com",
  "emailondeck.com", "moakt.com", "mailnesia.com", "spamgourmet.com", "burnermail.io",
  "mail.tm", "mail.gw", "dropmail.me", "linshiyouxiang.net", "bccto.me", "chacuo.net",
  "027168.com", "24mail.chacuo.net", "tempail.com", "emailtemporanea.net", "tempr.email",
];

function envInt(name: string, fallback: number) {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function webLoginGiftLimits() {
  return {
    emailIpPerDay: envInt("WEB_LOGIN_GIFT_EMAIL_IP_DAILY_LIMIT", 3),
    globalPerDay: envInt("WEB_LOGIN_GIFT_DAILY_GLOBAL_LIMIT", 300),
  };
}

function blockedDomains() {
  const extra = (process.env.WEB_LOGIN_GIFT_BLOCKED_EMAIL_DOMAINS ?? "")
    .split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  return new Set([...BUILTIN_DISPOSABLE_DOMAINS, ...extra]);
}

/** 域名本身或其子域命中黑名单即视为临时邮箱。 */
export function isDisposableEmail(email: string | null | undefined) {
  const domain = email?.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  const blocked = blockedDomains();
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (blocked.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function alreadyGifted(userId: number) {
  const entries = await listCreditLedgerEntries(userId, 1000);
  return entries.some(item => [GIFT_PREFIX, "wechat-registration-gift:"].some(prefix => item.idempotencyKey?.startsWith(prefix)));
}

type GiftUser = Pick<User, "id" | "openId" | "loginMethod"> & { email?: string | null };

/**
 * 网站登录赠送：每账号一次（账本幂等键 + 账号级前缀去重，事务内完成）。
 * 防批量领取（只影响是否赠送，绝不影响登录/注册）：
 * - 临时邮箱域名不赠送；
 * - 邮箱账号按 IP（sha256 后）每日限次；
 * - 全站每日赠送总量上限；
 * - 限流存储异常时不赠送（下次访问会重试）。
 * 对外统一返回 { kind: "ineligible" }，不暴露具体原因。
 */
export async function claimWebLoginGift(user: GiftUser, opts: { ip?: string | null; now?: Date } = {}) {
  if (user.loginMethod === "guest" || user.openId.startsWith("guest:") || user.openId === "local-guest") {
    return { kind: "ineligible" as const };
  }
  // 已领过的账号直接返回，避免每次访问都消耗限流额度。
  if (await alreadyGifted(user.id)) return { kind: "duplicate" as const };

  const isEmail = user.loginMethod === "email";
  const deny = (reason: string) => {
    console.warn(`[web-login-gift] skipped user=${user.id} reason=${reason}`);
    return { kind: "ineligible" as const };
  };
  if (isEmail && isDisposableEmail(user.email)) return deny("disposable_domain");

  const limits = webLoginGiftLimits();
  // 同一账号每天只占一次额度：并发/重试的首次领取不会重复消耗 IP 和全站额度。
  const checks: Array<[string, string, string, number]> = [
    ["user_attempt_day", "web-login-gift:user-attempt:day", String(user.id), 1],
  ];
  if (isEmail) {
    checks.push(["email_ip_day", "web-login-gift:email-ip:day", hash(`ip:${opts.ip?.trim() || "unknown"}`), limits.emailIpPerDay]);
  }
  checks.push(["global_day", "web-login-gift:global:day", "all", limits.globalPerDay]);
  try {
    for (const [reason, scope, subject, maxAttempts] of checks) {
      const result = await consumePersistentRateLimit({ scope, subject, windowSeconds: DAY, maxAttempts, now: opts.now });
      if (!result.allowed) return deny(reason);
    }
  } catch {
    return deny("storage_unavailable");
  }

  return grantCredit({
    userId: user.id,
    amountMinor: WEB_LOGIN_GIFT_MINOR,
    idempotencyKey: `web-login-gift:v1:${user.id}`,
    oncePerAccountPrefixes: [GIFT_PREFIX, "wechat-registration-gift:"],
    reason: "网站登录赠送 5 算力（每账号一次）",
    enableAccess: true,
  });
}
