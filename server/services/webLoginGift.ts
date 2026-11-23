import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { accountIdentities, users, type User } from "../../drizzle/schema";
import { COMPUTE_UNITS_PER_YUAN, MINOR_PER_YUAN } from "../../shared/computeMoney";
import { ENV } from "../_core/env";
import { consumePersistentRateLimit, normalizeAccountEmail } from "../repositories/accounts";
import { listCreditLedgerEntries, type CreditLedgerExecutor } from "../repositories/computeLedger";
import { registrationDatabase } from "../repositories/registrationDatabase";
import { openRegisteredAccountInMemory } from "../repositories/registrationMemory";
import { getUserById, getUserByOpenId } from "../repositories/users";
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
type RegistrationGrant = typeof grantCredit;

export type OpenRegisteredAccountInput = {
  openId: string;
  email?: string | null;
  /** 调用方已经证明这个人控制该邮箱。未验证的供应商邮箱不能用来认领旧账号。 */
  emailVerified?: boolean;
  loginMethod?: string | null;
  name?: string | null;
  role?: "user" | "admin";
  lastSignedIn?: Date;
  requestIp?: string | null;
  now?: Date;
  links?: Array<{ provider: "email" | "google" | "phone"; subject: string }>;
  /** 平台新注册传 false，已有邮箱或平台身份均返回冲突。 */
  claimExisting?: boolean;
};

export type OpenRegisteredAccountResult = {
  outcome: "created" | "reused" | "conflict";
  created: boolean;
  /** 冲突时是已有账号之一，不是新建账号。 */
  userId: number;
  userIds?: number[];
};

/**
 * 登录、绑定和读余额只查询是否已经领过，绝不按创建时间补发。
 * 赠送发生在 openRegisteredAccount 第一次插入用户的同一次提交里。
 */
export async function claimWebLoginGift(user: GiftUser, _opts: { ip?: string | null; now?: Date } = {}) {
  const stored = await getUserById(user.id);
  if (!stored || stored.id !== user.id) return { kind: "ineligible" as const };
  if (await alreadyGifted(stored.id)) return { kind: "duplicate" as const };
  return { kind: "ineligible" as const };
}

function registrationGiftDeclined(input: OpenRegisteredAccountInput) {
  if (input.loginMethod === "guest" || input.loginMethod === "system") return "not_registration";
  if (input.openId.startsWith("guest:") || input.openId === "local-guest" || input.openId.startsWith("system:")) return "not_registration";
  if (input.email && isDisposableEmail(input.email)) return "disposable_domain";
  return null;
}

/** 超限是明确拒绝，账号仍可建成且以后不再补。存储故障则抛出，让本次注册回滚。 */
async function registrationGiftPermitted(
  input: OpenRegisteredAccountInput,
  executor?: Parameters<typeof consumePersistentRateLimit>[0]["executor"],
) {
  const limits = webLoginGiftLimits();
  const checks: Array<[string, string, string, number]> = [
    ["ip_day", "web-login-gift:ip:day", hash(`ip:${input.requestIp?.trim() || "unknown"}`), limits.emailIpPerDay],
    ["global_day", "web-login-gift:global:day", "all", limits.globalPerDay],
  ];
  for (const [reason, scope, subject, maxAttempts] of checks) {
    const result = await consumePersistentRateLimit({
      scope, subject, windowSeconds: DAY, maxAttempts, now: input.now, executor,
    });
    if (!result.allowed) {
      console.warn(`[web-login-gift] skipped new registration reason=${reason}`);
      return false;
    }
  }
  return true;
}

function registrationGiftInput(userId: number) {
  return {
    userId,
    amountMinor: WEB_LOGIN_GIFT_MINOR,
    idempotencyKey: `web-login-gift:v1:${userId}`,
    oncePerAccountPrefixes: [GIFT_PREFIX, "wechat-registration-gift:"] as const,
    reason: "网站注册赠送 5 算力（每账号一次）",
    enableAccess: true,
  };
}

type VerifiedEmailDecision =
  | { kind: "reuse"; userId: number }
  | { kind: "conflict"; userIds: number[] }
  | { kind: "absent" };

/**
 * 已验证邮箱先解析到唯一账号。解析不了或有多条存量映射时冲突，不新建、不赠送、不合并余额。
 * 真正新建时，用户、身份、额度和赠送在同一次提交里；失败则整笔回滚，重试仍可领取。
 */
export async function openRegisteredAccount(
  input: OpenRegisteredAccountInput,
  grant: RegistrationGrant = grantCredit,
): Promise<OpenRegisteredAccountResult> {
  if (!input.openId) throw new Error("User openId is required for upsert");
  const db = await registrationDatabase();
  if (!db) {
    return openRegisteredAccountInMemory(input, {
      declined: Boolean(registrationGiftDeclined(input)),
      permit: () => registrationGiftPermitted(input),
      grant: userId => grant(registrationGiftInput(userId)),
    });
  }
  try {
    return await db.transaction(async tx => openRegisteredAccountOn(tx as CreditLedgerExecutor, input, grant));
  } catch (error) {
    if (error instanceof RegistrationConflict) {
      return { outcome: "conflict", created: false, userId: 0, userIds: error.userIds };
    }
    const winner = await getUserByOpenId(input.openId);
    if (winner) return { outcome: "reused", created: false, userId: winner.id };
    throw error;
  }
}

class RegistrationConflict extends Error {
  constructor(readonly userIds: number[]) {
    super("registration_identity_conflict");
  }
}

export function isRegistrationConflict(error: unknown): error is RegistrationConflict {
  return error instanceof RegistrationConflict;
}

export async function openRegisteredAccountOnExecutor(
  tx: CreditLedgerExecutor,
  input: OpenRegisteredAccountInput,
  grant: RegistrationGrant = grantCredit,
) {
  return openRegisteredAccountOn(tx, input, grant);
}

async function openRegisteredAccountOn(
  tx: CreditLedgerExecutor,
  input: OpenRegisteredAccountInput,
  grant: RegistrationGrant,
): Promise<OpenRegisteredAccountResult> {
  const verified = await verifiedEmailDecisionOn(tx, input.email, input.emailVerified);
  if (input.claimExisting === false && (verified?.kind === "reuse" || verified?.kind === "conflict")) {
    return {
      outcome: "conflict",
      created: false,
      userId: 0,
      userIds: verified.kind === "reuse" ? [verified.userId] : verified.userIds,
    };
  }
  if (verified?.kind === "conflict") return { outcome: "conflict", created: false, userId: 0, userIds: verified.userIds };
  if (verified?.kind === "reuse") {
    await touchRegisteredUser(tx, verified.userId, input);
    const blocked = await attachLinksOn(tx, verified.userId, input);
    if (blocked) throw new RegistrationConflict([verified.userId, blocked].sort((a, b) => a - b));
    return { outcome: "reused", created: false, userId: verified.userId };
  }
  const [existing] = await tx.select().from(users).where(eq(users.openId, input.openId)).for("update").limit(1);
  if (existing) {
    if (input.claimExisting === false) {
      return { outcome: "conflict", created: false, userId: 0, userIds: [existing.id] };
    }
    await touchRegisteredUser(tx, existing.id, input);
    const blocked = await attachLinksOn(tx, existing.id, input);
    if (blocked) throw new RegistrationConflict([existing.id, blocked].sort((a, b) => a - b));
    return { outcome: "reused", created: false, userId: existing.id };
  }
  const [created] = await tx.insert(users).values({
    openId: input.openId,
    name: input.name ?? null,
    email: input.email ?? null,
    loginMethod: input.loginMethod ?? null,
    role: input.role ?? (input.openId === ENV.ownerOpenId ? "admin" : "user"),
    lastSignedIn: input.lastSignedIn ?? new Date(),
  }).$returningId();
  const links = [
    ...(input.emailVerified && input.email ? [{ provider: "email" as const, subject: input.email }] : []),
    ...(input.links ?? []),
  ];
  const blocked = await attachLinksOn(tx, created.id, { ...input, links });
  if (blocked) throw new RegistrationConflict([blocked]);
  if (!registrationGiftDeclined(input) && await registrationGiftPermitted(input, tx)) {
    await grant(registrationGiftInput(created.id), tx);
  }
  return { outcome: "created", created: true, userId: created.id };
}

async function verifiedEmailDecisionOn(tx: CreditLedgerExecutor, email: string | null | undefined, verified: boolean | undefined): Promise<VerifiedEmailDecision | null> {
  if (!verified || !email) return null;
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return { kind: "absent" };
  const [identity] = await tx.select().from(accountIdentities).where(and(
    eq(accountIdentities.provider, "email"), eq(accountIdentities.subject, normalized),
  )).for("update").limit(1);
  if (identity) return { kind: "reuse", userId: identity.userId };
  const matches = await tx.select({ id: users.id }).from(users).where(sql`LOWER(TRIM(${users.email})) = ${normalized}`).for("update");
  if (matches.length > 1) return { kind: "conflict", userIds: matches.map(item => item.id).sort((a, b) => a - b) };
  if (matches.length === 1) {
    return ENV.accountAutoIdentityResolution
      ? { kind: "reuse", userId: matches[0].id }
      : { kind: "conflict", userIds: [matches[0].id] };
  }
  return { kind: "absent" };
}

async function touchRegisteredUser(tx: CreditLedgerExecutor, userId: number, input: OpenRegisteredAccountInput) {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.lastSignedIn !== undefined) patch.lastSignedIn = input.lastSignedIn;
  if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, userId));
}

async function attachLinksOn(tx: CreditLedgerExecutor, userId: number, input: OpenRegisteredAccountInput) {
  for (const link of input.links ?? []) {
    const subject = link.provider === "email" ? normalizeAccountEmail(link.subject) : link.subject.trim();
    if (!subject) continue;
    const [owner] = await tx.select().from(accountIdentities).where(and(
      eq(accountIdentities.provider, link.provider), eq(accountIdentities.subject, subject),
    )).for("update").limit(1);
    if (owner && owner.userId !== userId) return owner.userId;
    if (owner) continue;
    await tx.insert(accountIdentities).values({ userId, provider: link.provider, subject, verifiedAt: new Date() });
  }
  return null;
}
