import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, type User } from "../../drizzle/schema";
import { COMPUTE_UNITS_PER_YUAN, MINOR_PER_YUAN } from "../../shared/computeMoney";
import { ENV } from "../_core/env";
import { consumePersistentRateLimit } from "../repositories/accounts";
import { listCreditLedgerEntries, type CreditLedgerExecutor } from "../repositories/computeLedger";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now as memoryNow,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "../repositories/runtime";
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
  name?: string | null;
  loginMethod?: string | null;
  role?: "user" | "admin";
  lastSignedIn?: Date;
  requestIp?: string | null;
  now?: Date;
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
  if (input.loginMethod === "email" && isDisposableEmail(input.email)) return "disposable_domain";
  return null;
}

/** 超限是明确拒绝，账号仍可建成且以后不再补。存储故障则抛出，让本次注册回滚。 */
async function registrationGiftPermitted(input: OpenRegisteredAccountInput) {
  const limits = webLoginGiftLimits();
  const checks: Array<[string, string, string, number]> = [];
  if (input.loginMethod === "email") {
    checks.push(["email_ip_day", "web-login-gift:email-ip:day", hash(`ip:${input.requestIp?.trim() || "unknown"}`), limits.emailIpPerDay]);
  }
  checks.push(["global_day", "web-login-gift:global:day", "all", limits.globalPerDay]);
  for (const [reason, scope, subject, maxAttempts] of checks) {
    const result = await consumePersistentRateLimit({ scope, subject, windowSeconds: DAY, maxAttempts, now: input.now });
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

/**
 * 第一次插入这个 openId 时，用户行和注册赠送在同一次提交里完成。
 * 已存在的账号只更新资料，不赠送。限流存储或账本写入失败会让新建回滚，
 * 调用方重新完成注册时仍会领取；超限和临时邮箱是决定不送，登录不会再补。
 * 调用点：邮箱建会话、账号会话的新建分支、Google 新建、手机号新建、
 * 平台 OAuth 回调和会话里第一次同步本地用户。
 */
export async function openRegisteredAccount(
  input: OpenRegisteredAccountInput,
  grant: RegistrationGrant = grantCredit,
): Promise<{ userId: number; created: boolean }> {
  if (!input.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return openRegisteredAccountInMemory(input, grant);
  try {
    return await db.transaction(async tx => {
      const [existing] = await tx.select().from(users).where(eq(users.openId, input.openId)).limit(1).for("update");
      if (existing) {
        const patch: Partial<typeof users.$inferInsert> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.email !== undefined) patch.email = input.email;
        if (input.loginMethod !== undefined) patch.loginMethod = input.loginMethod;
        if (input.role !== undefined) patch.role = input.role;
        if (input.lastSignedIn !== undefined) patch.lastSignedIn = input.lastSignedIn;
        if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, existing.id));
        return { userId: existing.id, created: false };
      }
      const [created] = await tx.insert(users).values({
        openId: input.openId,
        name: input.name ?? null,
        email: input.email ?? null,
        loginMethod: input.loginMethod ?? null,
        role: input.role ?? (input.openId === ENV.ownerOpenId ? "admin" : "user"),
        lastSignedIn: input.lastSignedIn ?? new Date(),
      }).$returningId();
      if (!registrationGiftDeclined(input) && await registrationGiftPermitted(input)) {
        await grant(registrationGiftInput(created.id), tx as CreditLedgerExecutor);
      }
      return { userId: created.id, created: true };
    });
  } catch (error) {
    const winner = await getUserByOpenId(input.openId);
    if (winner) return { userId: winner.id, created: false };
    throw error;
  }
}

async function openRegisteredAccountInMemory(input: OpenRegisteredAccountInput, grant: RegistrationGrant) {
  return withLocalAggregateMutationLock(async () => {
    const existing = memoryState.users.find(user => user.openId === input.openId);
    if (existing) {
      const patch = { ...input };
      delete patch.requestIp;
      delete patch.now;
      applyDefinedValues(existing as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>);
      existing.updatedAt = memoryNow();
      if (input.lastSignedIn !== undefined) existing.lastSignedIn = input.lastSignedIn;
      await persistMemoryState();
      return { userId: existing.id, created: false };
    }
    const declined = registrationGiftDeclined(input);
    const permitted = declined ? false : await registrationGiftPermitted(input);
    const current = memoryNow();
    const id = nextMemoryId("user");
    memoryState.users.push({
      id,
      openId: input.openId,
      name: input.name ?? null,
      email: input.email ?? null,
      loginMethod: input.loginMethod ?? null,
      role: (input.role ?? (input.openId === ENV.ownerOpenId ? "admin" : "user")) as User["role"],
      sessionVersion: 1,
      createdAt: current,
      updatedAt: current,
      lastSignedIn: input.lastSignedIn ?? current,
    });
    if (permitted) {
      try {
        await grant(registrationGiftInput(id));
      } catch (error) {
        memoryState.users = memoryState.users.filter(user => user.id !== id);
        memoryState.creditLedgerEntries = memoryState.creditLedgerEntries.filter(entry => entry.userId !== id);
        memoryState.creditAccounts = memoryState.creditAccounts.filter(account => account.userId !== id);
        throw error;
      }
    }
    await persistMemoryState();
    return { userId: id, created: true };
  });
}
