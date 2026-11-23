import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeLoginPhone } from "../../shared/phoneLogin";
import { ENV } from "../_core/env";
import {
  consumePersistentRateLimit,
  getLoginIdentity,
  normalizeAccountEmail,
  resolveEmailIdentity,
} from "../repositories/accounts";
import {
  cancelPlatformRegistration,
  findLoginIdentityForUpdate,
  insertPlatformRegistration,
  lockPlatformRegistration,
  mutatePlatformRegistration,
  savePlatformRegistration,
  sha256Hex,
  viewPlatformRegistration,
} from "../repositories/platformRegistrationStore";
import { registrationDatabase } from "../repositories/registrationDatabase";
import type { CreditLedgerExecutor } from "../repositories/computeLedger";
import { getUserByOpenId } from "../repositories/users";
import { generateOtpCode } from "./accountSecurity";
import { grantCredit } from "./computeLedger";
import { isRegistrationConflict, openRegisteredAccount, openRegisteredAccountOnExecutor } from "./webLoginGift";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const devSecret = randomBytes(32).toString("hex");

export type PlatformChannel = "email" | "phone";
export type PlatformRegistrationFailure =
  | { error: "missing" | "expired" | "invalid" | "conflict" | "not_configured" | "invalid_subject" | "delivery_failed" }
  | { error: "rate_limited"; retryAfterMs: number };

function digestSecret() {
  const configured = ENV.otpDigestSecret.trim();
  if (configured) return configured;
  if (ENV.isProduction) return null;
  return devSecret;
}

function codeHash(challengeId: string, channel: PlatformChannel, subject: string, code: string, secret: string) {
  return createHmac("sha256", secret).update(`platform-reg:v2:${challengeId}:${channel}:${subject}:${code}`).digest("hex");
}

function hashesMatch(expectedHex: string, suppliedHex: string) {
  const expected = Buffer.from(expectedHex, "hex");
  const supplied = Buffer.from(suppliedHex, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function subjectOf(channel: PlatformChannel, value: unknown) {
  if (channel === "email") {
    const email = typeof value === "string" ? normalizeAccountEmail(value) : "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
  return normalizeLoginPhone(value);
}

async function limit(scope: string, subject: string, windowSeconds: number, maxAttempts: number) {
  const result = await consumePersistentRateLimit({ scope, subject, windowSeconds, maxAttempts });
  return result.allowed ? null : result.retryAfterMs;
}

/** 只保存平台在授权码交换里给出的 openId。调用方不能用查询参数申请。 */
export async function beginPlatformRegistration(input: {
  openId: string;
  name?: string | null;
  loginMethod?: string | null;
  now?: number;
}) {
  const openId = input.openId.trim();
  if (!openId || openId.length > 64) return { error: "invalid_profile" as const };
  return insertPlatformRegistration({
    openId,
    name: input.name ?? null,
    loginMethod: input.loginMethod ?? null,
    now: input.now ?? Date.now(),
  });
}

export async function readPlatformRegistration(cookie: string | undefined, now = Date.now()) {
  return viewPlatformRegistration(cookie, now);
}

export async function abandonPlatformRegistration(cookie: string | undefined, now = Date.now()) {
  await cancelPlatformRegistration(cookie, now);
}

export async function sendPlatformRegistrationCode(input: {
  cookie: string | undefined;
  channel: PlatformChannel;
  subject: unknown;
  requestIp: string;
  now?: number;
  deliver: (channel: PlatformChannel, subject: string, code: string) => Promise<void>;
}): Promise<{ ok: true } | PlatformRegistrationFailure> {
  const subject = subjectOf(input.channel, input.subject);
  if (!subject) return { error: "invalid_subject" };
  const secret = digestSecret();
  if (!secret) return { error: "not_configured" };
  const now = input.now ?? Date.now();
  const pending = await readPlatformRegistration(input.cookie, now);
  if (pending.status !== "pending") return { error: pending.status };
  const ipWait = await limit("platform-reg:send:ip", sha256Hex(input.requestIp || "unknown"), 3600, 20);
  if (ipWait !== null) return { error: "rate_limited", retryAfterMs: ipWait };
  const subjectWait = await limit(`platform-reg:send:${input.channel}`, sha256Hex(subject), 60, 1);
  if (subjectWait !== null) return { error: "rate_limited", retryAfterMs: subjectWait };
  const code = generateOtpCode();
  const subjectHash = sha256Hex(subject);
  const saved = await mutatePlatformRegistration(input.cookie, now, row => {
    row.otp = {
      channel: input.channel,
      subjectHash,
      codeHash: codeHash(row.id, input.channel, subject, code, secret),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
    };
    return true;
  });
  if (saved.status !== "ok") return { error: saved.status };
  try {
    await input.deliver(input.channel, subject, code);
  } catch {
    await mutatePlatformRegistration(input.cookie, now, row => {
      if (row.otp?.codeHash === codeHash(row.id, input.channel, subject, code, secret)) row.otp = null;
    });
    return { error: "delivery_failed" };
  }
  return { ok: true };
}

function registrationWriteRace(error: unknown): boolean {
  const failure = error as { code?: string; cause?: { code?: string } } | undefined;
  const code = failure?.cause?.code ?? failure?.code;
  return code === "ER_LOCK_DEADLOCK" || code === "ER_DUP_ENTRY";
}

async function identityAlreadyExists(channel: PlatformChannel, subject: string) {
  if (channel === "phone") return Boolean(await getLoginIdentity("phone", subject));
  const resolution = await resolveEmailIdentity(subject);
  return resolution.kind !== "absent";
}

/**
 * 验证码只证明这次挑战里的邮箱或手机号。
 * 命中已有身份时冲突：不登录旧账号，不绑定平台 openId，不改余额和预占。
 * 全新身份才在注册事务里建号、写身份并发放一次 5 算力。
 */
export async function completePlatformRegistration(input: {
  cookie: string | undefined;
  channel: PlatformChannel;
  subject: unknown;
  code: unknown;
  requestIp: string;
  now?: number;
  grant?: typeof grantCredit;
}): Promise<{ outcome: "created"; userId: number } | PlatformRegistrationFailure> {
  const subject = subjectOf(input.channel, input.subject);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!subject || !/^\d{6}$/.test(code)) return { error: "invalid" };
  const secret = digestSecret();
  if (!secret) return { error: "not_configured" };
  const now = input.now ?? Date.now();
  const db = await registrationDatabase();
  const ipWait = await limit("platform-reg:verify:ip", sha256Hex(input.requestIp || "unknown"), 600, 60);
  if (ipWait !== null) return { error: "rate_limited", retryAfterMs: ipWait };
  const subjectWait = await limit(`platform-reg:verify:${input.channel}`, sha256Hex(subject), 600, 20);
  if (subjectWait !== null) return { error: "rate_limited", retryAfterMs: subjectWait };
  if (!db) return completeWithoutDatabase({ ...input, subject, code, secret, now });
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction(async tx => {
        const locked = await lockPlatformRegistration(tx, input.cookie, now);
        if (locked.status !== "ok") return { error: locked.status };
        const verdict = await decideOtp(locked.row, input.channel, subject, code, secret, now);
        if (verdict !== "match") {
          await savePlatformRegistration(tx, locked.row);
          return { error: "invalid" as const };
        }
        if (input.channel === "phone" && await findLoginIdentityForUpdate(tx, "phone", subject)) {
          locked.row.consumedAt = now;
          locked.row.otp = null;
          await savePlatformRegistration(tx, locked.row);
          return { error: "conflict" as const };
        }
        const opened = await openRegisteredAccountOnExecutor(tx as CreditLedgerExecutor, registrationInput(locked.openId, locked.row, input.channel, subject, input.requestIp, now), input.grant);
        if (opened.outcome !== "created") {
          locked.row.consumedAt = now;
          locked.row.otp = null;
          await savePlatformRegistration(tx, locked.row);
          return { error: "conflict" as const };
        }
        locked.row.consumedAt = now;
        locked.row.otp = null;
        await savePlatformRegistration(tx, locked.row);
        return { outcome: "created" as const, userId: opened.userId };
      });
    } catch (error) {
      if (attempt === 0 && registrationWriteRace(error)) continue;
      if (!isRegistrationConflict(error)) throw error;
      await mutatePlatformRegistration(input.cookie, now, row => {
        row.consumedAt = now;
        row.otp = null;
      });
      return { error: "conflict" };
    }
  }
}

function registrationInput(openId: string, row: { name: string | null; loginMethod: string | null }, channel: PlatformChannel, subject: string, requestIp: string, now: number) {
  return {
    openId,
    name: row.name,
    loginMethod: row.loginMethod,
    lastSignedIn: new Date(now),
    requestIp,
    email: channel === "email" ? subject : null,
    emailVerified: channel === "email",
    claimExisting: false,
    links: [{ provider: channel, subject }],
  };
}

function decideOtp(row: { id: string; otp: { channel: PlatformChannel; subjectHash: string; codeHash: string; expiresAt: number; attempts: number } | null }, channel: PlatformChannel, subject: string, code: string, secret: string, now: number) {
  const otp = row.otp;
  if (!otp || otp.channel !== channel || otp.subjectHash !== sha256Hex(subject) || otp.expiresAt <= now) return "invalid" as const;
  otp.attempts += 1;
  const matches = hashesMatch(otp.codeHash, codeHash(row.id, channel, subject, code, secret));
  if (!matches || otp.attempts > OTP_MAX_ATTEMPTS) {
    if (otp.attempts >= OTP_MAX_ATTEMPTS) row.otp = null;
    return "invalid" as const;
  }
  return "match" as const;
}

async function completeWithoutDatabase(input: {
  cookie: string | undefined;
  channel: PlatformChannel;
  subject: string;
  code: string;
  requestIp: string;
  secret: string;
  now: number;
  grant?: typeof grantCredit;
}): Promise<{ outcome: "created"; userId: number } | PlatformRegistrationFailure> {
  const decision = await mutatePlatformRegistration(input.cookie, input.now, async (row, openId) => {
    if (decideOtp(row, input.channel, input.subject, input.code, input.secret, input.now) !== "match") return { error: "invalid" as const };
    if (await identityAlreadyExists(input.channel, input.subject)) {
      row.consumedAt = input.now;
      row.otp = null;
      return { error: "conflict" as const };
    }
    const opened = await openRegisteredAccount(registrationInput(openId, row, input.channel, input.subject, input.requestIp, input.now), input.grant);
    if (opened.outcome !== "created") {
      row.consumedAt = input.now;
      row.otp = null;
      return { error: "conflict" as const };
    }
    const user = await getUserByOpenId(openId);
    if (!user || user.id !== opened.userId) {
      row.consumedAt = input.now;
      row.otp = null;
      return { error: "conflict" as const };
    }
    row.consumedAt = input.now;
    row.otp = null;
    return { outcome: "created" as const, userId: user.id };
  });
  if (decision.status !== "ok") return { error: decision.status };
  return decision.value;
}
