/**
 * 统一账号的领域层：邮箱验证码、密码、找回与会话撤销。
 *
 * 三条贯穿全文的立场——
 *  1. **一个标准化邮箱只解析到一个 userId。** 解析不出唯一答案就停在 `identity_conflict`，
 *     等 U3 的映射清单和人工裁决；静默 merge 会把两个人的故事并进一个账号，不可逆。
 *  2. **防枚举。** 未知邮箱、密码错误、未设置密码返回同一种失败；验证码请求无论邮箱
 *     存不存在都照常签发。
 *  3. **限流落库。** PM2 重启或多进程时，进程内内存限流形同虚设。
 */
import { ENV } from "../_core/env";
import { randomUUID, createHmac } from 'node:crypto';
import { and, asc, desc, eq, getTableColumns, getTableName, is, isNull, sql } from 'drizzle-orm';
import { MySqlTable } from 'drizzle-orm/mysql-core';
import * as schema from '../../drizzle/schema';
import { withMinigameAccountLock } from './minigameAccountLock';
import { accountIdentities, users } from '../../drizzle/schema';
import {
  bumpUserSessionVersion,
  getDb,
  getUserById,
  consumeDevicePairingCode,
  consumePersistentRateLimit,
  consumeVerificationChallenge,
  getPasswordCredential,
  issueDevicePairingCode,
  issueVerificationChallenge,
  normalizeAccountEmail,
  resolveEmailIdentity,
  setPasswordCredential,
} from "../db";
import {
  PAIRING_CODE_LENGTH,
  checkPasswordPolicy,
  generateOtpCode,
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  hashOtpCode,
  otpDigestMatches,
  hashPassword,
  verifyPassword,
  type OtpPurpose,
  type PasswordPolicyResult,
} from "./accountSecurity";

const { accountIdentities: identities, accountVerificationChallenges: challenges } = schema;
type ProofContext = { userId: number; sessionVersion: number; email: string; secret: string };
export type EmailLinkResult = { outcome: 'linked'; userId: number } | {
  outcome: 'session_expired' | 'invalid_code' | 'invalid_otp' | 'source_has_data' |
    'identity_conflict' | 'needs_manual_mapping' | 'email_already_linked';
};
const normalize = (email: string) => email.trim().toLowerCase();
function bindingSecret(input: ProofContext) {
  if (input.secret.length < 32) throw new Error('email_not_configured');
  // A Web login/verify OTP, or one sent by another account/session, cannot link identities.
  return createHmac('sha256', input.secret)
    .update(`minigame-email-link:v1:${input.userId}:${input.sessionVersion}`).digest('hex');
}

/** Called only after authenticated route-level and persistent email/IP throttling. */
export async function issueMinigameLinkChallenge(input: ProofContext) {
  const db = await getDb();
  if (!db) throw new Error('database_required');
  const email = normalize(input.email), secret = bindingSecret(input);
  const code = generateOtpCode(), now = new Date();
  await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
    if (!user || user.sessionVersion !== input.sessionVersion) throw new Error('session_expired');
    await tx.update(challenges).set({ invalidatedAt: now }).where(and(
      eq(challenges.normalizedEmail, email), eq(challenges.purpose, 'verify'),
      isNull(challenges.consumedAt), isNull(challenges.invalidatedAt),
    ));
    await tx.insert(challenges).values({ normalizedEmail: email, purpose: 'verify',
      codeHash: hashOtpCode({ email, code, purpose: 'verify', secret, version: 1 }),
      secretVersion: 1, maxAttempts: 5, expiresAt: new Date(now.getTime() + 600_000) });
  });
  return { code };
}

/** No account/content deletion and no balance merge. The sole permitted transfer is
 * a single WeChat identity from an otherwise empty, WeChat-only account after dual proof.
 * Legacy mapping is separately scoped to an operator-approved email allowlist. */
export async function completeMinigameEmailLink(input: ProofContext & {
  code: string; subject: string; approvedLegacyEmails: string[];
}): Promise<EmailLinkResult> {
  const db = await getDb();
  if (!db) throw new Error('database_required');
  const email = normalize(input.email), secret = bindingSecret(input);
  return withMinigameAccountLock(input.userId, () => db.transaction(async tx => {
    const [source] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
    if (!source || source.sessionVersion !== input.sessionVersion) return { outcome: 'session_expired' };
    const [wechat] = await tx.select().from(identities).where(and(
      eq(identities.provider, 'wechat'), eq(identities.subject, input.subject),
    )).for('update');
    if (!wechat || wechat.subject !== input.subject || wechat.userId !== source.id)
      return { outcome: 'invalid_code' };
    const [challenge] = await tx.select().from(challenges).where(and(
      eq(challenges.normalizedEmail, email), eq(challenges.purpose, 'verify'),
      isNull(challenges.consumedAt), isNull(challenges.invalidatedAt),
    )).orderBy(desc(challenges.id)).limit(1).for('update');
    const now = new Date();
    if (!challenge || challenge.expiresAt <= now || challenge.attemptCount >= challenge.maxAttempts)
      return { outcome: 'invalid_otp' };
    if (!otpDigestMatches({ email, code: input.code, purpose: 'verify', secret,
      version: challenge.secretVersion, digest: challenge.codeHash })) {
      await tx.update(challenges).set({ attemptCount: challenge.attemptCount + 1 }).where(eq(challenges.id, challenge.id));
      return { outcome: 'invalid_otp' };
    }
    await tx.update(challenges).set({ consumedAt: now }).where(eq(challenges.id, challenge.id));

    const ownIdentities = await tx.select().from(identities).where(eq(identities.userId, source.id)).for('update');
    if ((source.email && normalize(source.email) !== email) ||
      ownIdentities.some(row => row.provider === 'email' && row.subject !== email))
      return { outcome: 'email_already_linked' };
    const [emailIdentity] = await tx.select().from(identities).where(and(
      eq(identities.provider, 'email'), eq(identities.subject, email),
    )).for('update');
    // Always check legacy duplicates too; a pre-existing identity is not permission to guess.
    const candidates = await tx.select().from(users)
      .where(sql`LOWER(TRIM(${users.email})) = ${email}`).orderBy(asc(users.id)).for('update');
    if (candidates.length > 1 || (emailIdentity && candidates.some(row => row.id !== emailIdentity.userId)))
      return { outcome: 'identity_conflict' };
    const legacy = !emailIdentity && candidates.length === 1 && candidates[0].id !== source.id;
    if (legacy && !input.approvedLegacyEmails.map(normalize).includes(email))
      return { outcome: 'needs_manual_mapping' };
    const targetId = emailIdentity?.userId ?? candidates[0]?.id ?? source.id;
    const [target] = await tx.select().from(users).where(eq(users.id, targetId)).for('update');
    if (!target || (target.email && normalize(target.email) !== email)) return { outcome: 'identity_conflict' };
    if (targetId !== source.id) {
      if (source.role !== 'user' || source.loginMethod !== 'wechat' || source.email || source.name ||
        ownIdentities.length !== 1) return { outcome: 'source_has_data' };
      // Automatically cover all schema-owned account content, including future userId tables.
      // A zero credit projection may be created by a read; financial history still blocks.
      for (const table of Object.values(schema)) {
        if (!is(table, MySqlTable) || ['users', 'account_identities', 'access_sessions', 'credit_accounts'].includes(getTableName(table))) continue;
        const columns = getTableColumns(table);
        const owner = 'userId' in columns ? columns.userId :
          'redeemedByUserId' in columns ? columns.redeemedByUserId : undefined;
        if (!owner) continue;
        const rows = await tx.select({ owner }).from(table).where(eq(owner, source.id)).limit(1).for('update');
        if (rows.length) return { outcome: 'source_has_data' };
      }
      const [credit] = await tx.select().from(schema.creditAccounts).where(eq(schema.creditAccounts.userId, source.id)).for('update');
      if (credit && (credit.balanceMinor || credit.reservedMinor || credit.lifetimeSpentMinor || credit.accessEnabledAt))
        return { outcome: 'source_has_data' };
    }
    if (!emailIdentity) await tx.insert(identities).values({ provider: 'email', subject: email, userId: targetId, verifiedAt: now });
    if (!target.email) await tx.update(users).set({ email }).where(eq(users.id, targetId));
    if (targetId !== source.id) {
      await tx.update(identities).set({ userId: targetId, verifiedAt: now }).where(eq(identities.id, wechat.id));
      await tx.update(users).set({ sessionVersion: source.sessionVersion + 1 }).where(eq(users.id, source.id));
    }
    await tx.insert(schema.dataMigrationReceipts).values({ sourceKey: 'minigame_email_link',
      batchKey: `challenge:${challenge.id}`, sourceHash: createHmac('sha256', secret).update(email).digest('hex'),
      recordCount: 1, details: { sourceUserId: source.id, targetUserId: targetId,
        wechatIdentityId: wechat.id, legacyMapped: legacy, method: 'wx_code_and_scoped_email_otp', version: 1 } });
    return { outcome: 'linked', userId: targetId };
  }));
}

export async function allowMinigameEmailOtpSend(email: string, ip: string) {
  for (const [scope, subject, limits] of [
    ['otp:send:email', normalizeAccountEmail(email), OTP_SEND_LIMIT],
    ['otp:send:ip', ip, OTP_SEND_IP_LIMIT],
  ] as const) {
    if (!(await consumePersistentRateLimit({ scope, subject, ...limits })).allowed) return false;
  }
  return true;
}
export async function allowMinigameEmailOtpVerify(email: string) {
  return (await consumePersistentRateLimit({ scope: 'otp:verify:email',
    subject: normalizeAccountEmail(email), ...OTP_VERIFY_LIMIT })).allowed;
}

export const OTP_TTL_MS = 10 * 60_000;
export async function accountDatabaseReady() { return Boolean(await getDb()); }
/** Server-only caller context; never serialize the full account to game clients. */
export async function getAccountWorkspaceUser(id: number) {
  if (!await getDb()) return null;
  return getUserById(id);
}
export async function getAccountSessionPrincipal(id: number) {
  const user = await getUserById(id);
  return user ? { id: user.id, sessionVersion: user.sessionVersion } : null;
}
export async function allowMinigameAuthAttempt(ip: string) {
  return (await consumePersistentRateLimit({ scope: 'minigame:auth:ip', subject: ip,
    windowSeconds: 60, maxAttempts: 15 })).allowed;
}

/** Creates the account and identity in one transaction; no email or gift allocation. */
export async function resolveWechatAccount(subject: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('wechat_database_unavailable');
  const find = async () => {
    const [row] = await db.select({ userId: accountIdentities.userId, subject: accountIdentities.subject }).from(accountIdentities)
      .where(and(eq(accountIdentities.provider, 'wechat'), eq(accountIdentities.subject, subject))).limit(1);
    // Legacy database collations may be case-insensitive; openid is not.
    if (row && row.subject !== subject) throw new Error('wechat_identity_collision');
    return row?.userId;
  };
  const existing = await find();
  if (existing !== undefined) return existing;
  try {
    return await db.transaction(async tx => {
      const [user] = await tx.insert(users).values({
        openId: `wx:${randomUUID()}`, loginMethod: 'wechat', role: 'user',
      }).$returningId();
      await tx.insert(accountIdentities).values({ userId: user.id, provider: 'wechat', subject, verifiedAt: new Date() });
      return user.id;
    });
  } catch (error) {
    // If another login won the unique identity constraint, its account is authoritative.
    // The losing transaction rolls back its new user as well.
    const winner = await find();
    if (winner !== undefined) return winner;
    throw error;
  }
}

/** Identity uniqueness is the serialization point shared with independent login.
 * Never transfers an identity from another account, even if it appears empty. */
export async function bindWechatAccount(userId: number, subject: string) {
  const db = await getDb();
  if (!db) throw new Error('wechat_database_unavailable');
  const find = async () => {
    const [row] = await db.select({ userId: accountIdentities.userId, subject: accountIdentities.subject }).from(accountIdentities)
      .where(and(eq(accountIdentities.provider, 'wechat'), eq(accountIdentities.subject, subject))).limit(1);
    if (row && row.subject !== subject) throw new Error('wechat_identity_collision');
    return row;
  };
  const existing = await find();
  if (existing) return existing.userId === userId ? 'bound' as const : 'merge_required' as const;
  try {
    await db.transaction(async tx => {
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      if (!user) throw new Error('account_missing');
      await tx.insert(accountIdentities).values({ userId, provider: 'wechat', subject, verifiedAt: new Date() });
    });
    return 'bound' as const;
  } catch (error) {
    const winner = await find();
    if (winner) return winner.userId === userId ? 'bound' as const : 'merge_required' as const;
    throw error;
  }
}
export const OTP_MAX_ATTEMPTS = 5;
/** 每个邮箱每 10 分钟最多 5 次发送 */
export const OTP_SEND_LIMIT = { windowSeconds: 600, maxAttempts: 5 };
/** 同一来源地址的发送上限更宽，防的是一个 IP 给很多邮箱发 */
export const OTP_SEND_IP_LIMIT = { windowSeconds: 600, maxAttempts: 20 };
export const OTP_VERIFY_LIMIT = { windowSeconds: 600, maxAttempts: 10 };
export const PASSWORD_LOGIN_LIMIT = { windowSeconds: 600, maxAttempts: 10 };

const PASSWORD_ALGORITHM_VERSION = 1;

function otpSecret(): string {
  return ENV.otpDigestSecret;
}

function otpSecretVersion(): number {
  const version = Number(ENV.otpDigestSecretVersion);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

export type IssuedOtp = { code: string; expiresAt: Date };

export type IssueOtpResult =
  | { outcome: "issued"; otp: IssuedOtp }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "identity_conflict"; userIds: number[] }
  | { outcome: "not_configured" };

/**
 * 签发一个验证码。
 *
 * 无论邮箱是否已有账号都照常签发——响应差异本身就是枚举信道。
 * 只有身份冲突会中断，因为那种情况下我们**不知道**该给谁发。
 */
export async function issueEmailOtp(input: {
  email: string;
  purpose: OtpPurpose;
  requestIp: string;
  now?: Date;
}): Promise<IssueOtpResult> {
  const email = normalizeAccountEmail(input.email);
  const now = input.now ?? new Date();

  if (!otpSecret().trim()) {
    // 失败关闭：宁可发不出验证码，也不用可离线枚举的裸摘要。
    return { outcome: "not_configured" };
  }

  const resolution = await resolveEmailIdentity(email);
  if (resolution.kind === "conflict") {
    return { outcome: "identity_conflict", userIds: resolution.userIds };
  }

  const byEmail = await consumePersistentRateLimit({
    scope: "otp:send:email",
    subject: email,
    ...OTP_SEND_LIMIT,
    now,
  });
  if (!byEmail.allowed) {
    return { outcome: "rate_limited", retryAfterMs: byEmail.retryAfterMs };
  }
  const byIp = await consumePersistentRateLimit({
    scope: "otp:send:ip",
    subject: input.requestIp || "unknown",
    ...OTP_SEND_IP_LIMIT,
    now,
  });
  if (!byIp.allowed) {
    return { outcome: "rate_limited", retryAfterMs: byIp.retryAfterMs };
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  await issueVerificationChallenge({
    email,
    purpose: input.purpose,
    codeHash: hashOtpCode({
      code,
      email,
      purpose: input.purpose,
      secret: otpSecret(),
      version: otpSecretVersion(),
    }),
    secretVersion: otpSecretVersion(),
    expiresAt,
    maxAttempts: OTP_MAX_ATTEMPTS,
  });

  return { outcome: "issued", otp: { code, expiresAt } };
}

/**
 * 登录用的身份解析闸门。
 *
 * `legacy_single` 表示「历史 users 表里恰好有一个同邮箱账号，但还没建立 identity 登记」。
 * 自动认领它就是自动 identity 解析——在 U3 的冲突报告和人工映射批准之前一律不做。
 * 宁可让这个邮箱暂时登不进去，也不能把某个历史账号的全部故事交给一个刚验证邮箱的人。
 */
export type LoginResolution =
  | { kind: "known"; userId: number }
  | { kind: "new" }
  | { kind: "needs_manual_mapping"; userIds: number[] }
  | { kind: "conflict"; userIds: number[] };

export async function resolveForLogin(email: string): Promise<LoginResolution> {
  const resolution = await resolveEmailIdentity(email);
  if (resolution.kind === "resolved") {
    return { kind: "known", userId: resolution.userId };
  }
  if (resolution.kind === "conflict") {
    return { kind: "conflict", userIds: resolution.userIds };
  }
  if (resolution.kind === "legacy_single") {
    return ENV.accountAutoIdentityResolution
      ? { kind: "known", userId: resolution.userId }
      : { kind: "needs_manual_mapping", userIds: [resolution.userId] };
  }
  return { kind: "new" };
}

export type VerifyOtpResult =
  /** `userId` 为 null 表示邮箱已验证但还没有账号，由上层决定怎么建 */
  | { outcome: "verified"; userId: number | null }
  | { outcome: "invalid" }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "identity_conflict"; userIds: number[] }
  | { outcome: "needs_manual_mapping"; userIds: number[] };

/**
 * 校验验证码。
 *
 * 过期、用错用途、猜太多次、码不对，对外都是同一个 `invalid`——
 * 区分它们等于告诉攻击者「这个邮箱有一个正在等待的挑战」。
 */
export async function verifyEmailOtp(input: {
  email: string;
  purpose: OtpPurpose;
  code: string;
  requestIp: string;
  now?: Date;
}): Promise<VerifyOtpResult> {
  const email = normalizeAccountEmail(input.email);
  const now = input.now ?? new Date();

  const limit = await consumePersistentRateLimit({
    scope: "otp:verify:email",
    subject: email,
    ...OTP_VERIFY_LIMIT,
    now,
  });
  if (!limit.allowed) {
    return { outcome: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const consumption = await consumeVerificationChallenge({
    email,
    purpose: input.purpose,
    now,
    verify: challenge =>
      otpDigestMatches({
        code: input.code,
        email,
        purpose: input.purpose,
        secret: otpSecret(),
        version: challenge.secretVersion,
        digest: challenge.codeHash,
      }),
  });
  if (consumption.kind !== "consumed") return { outcome: "invalid" };

  const resolution = await resolveForLogin(email);
  if (resolution.kind === "conflict") {
    return { outcome: "identity_conflict", userIds: resolution.userIds };
  }
  if (resolution.kind === "needs_manual_mapping") {
    return { outcome: "needs_manual_mapping", userIds: resolution.userIds };
  }
  return {
    outcome: "verified",
    userId: resolution.kind === "known" ? resolution.userId : null,
  };
}

export type SetPasswordResult =
  | { outcome: "set" }
  | {
      outcome: "rejected";
      reason: Extract<PasswordPolicyResult, { ok: false }>["reason"];
      message: string;
    };

export async function setAccountPassword(input: {
  userId: number;
  password: string;
}): Promise<SetPasswordResult> {
  const policy = checkPasswordPolicy(input.password);
  if (!policy.ok) {
    return { outcome: "rejected", reason: policy.reason, message: policy.message };
  }
  await setPasswordCredential({
    userId: input.userId,
    secret: await hashPassword(input.password),
    algorithmVersion: PASSWORD_ALGORITHM_VERSION,
  });
  return { outcome: "set" };
}

export type PasswordAuthResult =
  | { outcome: "authenticated"; userId: number }
  | { outcome: "invalid_credentials" }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "identity_conflict"; userIds: number[] }
  | { outcome: "needs_manual_mapping"; userIds: number[] };

/**
 * 密码登录。
 *
 * 未知邮箱、没设过密码、密码错误全部返回 `invalid_credentials`：
 * 任何区分都会变成「这个邮箱注册过吗」的探测接口。
 */
export async function authenticateWithPassword(input: {
  email: string;
  password: string;
  requestIp: string;
  now?: Date;
}): Promise<PasswordAuthResult> {
  const email = normalizeAccountEmail(input.email);
  const now = input.now ?? new Date();

  const limit = await consumePersistentRateLimit({
    scope: "password:login:email",
    subject: email,
    ...PASSWORD_LOGIN_LIMIT,
    now,
  });
  if (!limit.allowed) {
    return { outcome: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const resolution = await resolveForLogin(email);
  if (resolution.kind === "conflict") {
    return { outcome: "identity_conflict", userIds: resolution.userIds };
  }
  if (resolution.kind === "needs_manual_mapping") {
    return { outcome: "needs_manual_mapping", userIds: resolution.userIds };
  }
  if (resolution.kind === "new") return { outcome: "invalid_credentials" };

  const credential = await getPasswordCredential(resolution.userId);
  if (!credential) return { outcome: "invalid_credentials" };
  if (!(await verifyPassword(input.password, credential.secret))) {
    return { outcome: "invalid_credentials" };
  }
  return { outcome: "authenticated", userId: resolution.userId };
}

export type ChangePasswordResult =
  | { outcome: "changed"; sessionVersion: number }
  | { outcome: "invalid_credentials" }
  | {
      outcome: "rejected";
      reason: Extract<PasswordPolicyResult, { ok: false }>["reason"];
      message: string;
    };

/** 改密码：要求当前密码，成功后自增会话版本以撤销其他设备。 */
export async function changeAccountPassword(input: {
  userId: number;
  currentPassword: string;
  nextPassword: string;
}): Promise<ChangePasswordResult> {
  const credential = await getPasswordCredential(input.userId);
  if (!credential) return { outcome: "invalid_credentials" };
  if (!(await verifyPassword(input.currentPassword, credential.secret))) {
    return { outcome: "invalid_credentials" };
  }

  const set = await setAccountPassword({
    userId: input.userId,
    password: input.nextPassword,
  });
  if (set.outcome === "rejected") return set;

  return {
    outcome: "changed",
    sessionVersion: await bumpUserSessionVersion(input.userId),
  };
}

export type PasswordRecoveryResult =
  | { outcome: "recovered"; userId: number; sessionVersion: number }
  | { outcome: "invalid" }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "identity_conflict"; userIds: number[] }
  | { outcome: "needs_manual_mapping"; userIds: number[] }
  | {
      outcome: "rejected";
      reason: Extract<PasswordPolicyResult, { ok: false }>["reason"];
      message: string;
    };

/**
 * 找回密码。
 *
 * 成功后撤销**全部**旧 session，并且**不自动登录**——用户必须用新密码正常登录一次。
 * 这样即使找回链路本身被滥用，攻击者也拿不到一个现成的会话。
 */
export async function completePasswordRecovery(input: {
  email: string;
  code: string;
  nextPassword: string;
  requestIp: string;
  now?: Date;
}): Promise<PasswordRecoveryResult> {
  const policy = checkPasswordPolicy(input.nextPassword);
  if (!policy.ok) {
    return { outcome: "rejected", reason: policy.reason, message: policy.message };
  }

  const verified = await verifyEmailOtp({
    email: input.email,
    purpose: "recover",
    code: input.code,
    requestIp: input.requestIp,
    now: input.now,
  });
  if (verified.outcome === "rate_limited") return verified;
  if (verified.outcome === "identity_conflict") return verified;
  if (verified.outcome === "needs_manual_mapping") return verified;
  if (verified.outcome !== "verified" || verified.userId === null) {
    return { outcome: "invalid" };
  }

  const set = await setAccountPassword({
    userId: verified.userId,
    password: input.nextPassword,
  });
  if (set.outcome === "rejected") return set;

  return {
    outcome: "recovered",
    userId: verified.userId,
    sessionVersion: await bumpUserSessionVersion(verified.userId),
  };
}

/* ── 设备配对 ─────────────────────────────────────────────────────────────
   用已登录的设备把另一台设备拉进**同一个账号**。

   手机上敲邮箱和邀请码很痛，而且邀请码是哈希存的、忘了找不回来。
   配对码把这件事翻译成它本来的语义——「让这台手机进入我电脑上那个账号」——
   所以它天生不会像「手机上另外注册一次」那样把故事分裂成两个 userId。

   放在本文件而不是另开一个 devicePairing.ts：架构棘轮的豁免表写明
   「若出现第二个直接导入 db 的账号文件，必须合并回本文件」。
   ─────────────────────────────────────────────────────────────────────── */

/** 五分钟：够走到另一台设备上抄一遍，又短到来不及被扫。 */
export const PAIRING_TTL_MS = 5 * 60_000;
/** 一个账号十分钟最多签发 10 次 */
export const PAIRING_ISSUE_LIMIT = { windowSeconds: 600, maxAttempts: 10 };
/**
 * 同一来源地址十分钟最多兑换 10 次。
 * 这是唯一的防爆破手段——配对码按摘要唯一索引反查，猜错只是查不到行，
 * 没有「这一行又错了一次」可记。8.9 亿的码空间配上这个窗口，
 * 猜中的期望时间以万年计。
 */
export const PAIRING_REDEEM_IP_LIMIT = { windowSeconds: 600, maxAttempts: 10 };

function pairingSecret(): string {
  return ENV.otpDigestSecret;
}

function pairingSecretVersion(): number {
  const version = Number(ENV.otpDigestSecretVersion);
  return Number.isSafeInteger(version) && version > 0 ? version : 1;
}

export type IssuePairingResult =
  | { outcome: "issued"; code: string; expiresAt: Date }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "not_configured" };

export async function issuePairingCode(input: {
  userId: number;
  now?: Date;
}): Promise<IssuePairingResult> {
  if (!pairingSecret().trim()) return { outcome: "not_configured" };

  const limit = await consumePersistentRateLimit({
    scope: "pairing:issue",
    subject: String(input.userId),
    ...PAIRING_ISSUE_LIMIT,
  });
  if (!limit.allowed) {
    return { outcome: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const current = input.now ?? new Date();
  const code = generatePairingCode();
  const expiresAt = new Date(current.getTime() + PAIRING_TTL_MS);
  await issueDevicePairingCode({
    userId: input.userId,
    codeHash: hashPairingCode({
      code,
      secret: pairingSecret(),
      version: pairingSecretVersion(),
    }),
    secretVersion: pairingSecretVersion(),
    expiresAt,
  });
  return { outcome: "issued", code, expiresAt };
}

export type RedeemPairingResult =
  | { outcome: "paired"; userId: number }
  | { outcome: "invalid" }
  | { outcome: "rate_limited"; retryAfterMs: number }
  | { outcome: "not_configured" };

export async function redeemPairingCode(input: {
  code: string;
  requestIp: string;
  now?: Date;
}): Promise<RedeemPairingResult> {
  if (!pairingSecret().trim()) return { outcome: "not_configured" };

  const normalized = normalizePairingCode(input.code);
  // 长度不对连限流额度都不消耗，免得畸形输入把正常用户挤下去
  if (normalized.length !== PAIRING_CODE_LENGTH) return { outcome: "invalid" };

  const limit = await consumePersistentRateLimit({
    scope: "pairing:redeem",
    subject: input.requestIp || "unknown",
    ...PAIRING_REDEEM_IP_LIMIT,
  });
  if (!limit.allowed) {
    return { outcome: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const redemption = await consumeDevicePairingCode({
    codeHash: hashPairingCode({
      code: normalized,
      secret: pairingSecret(),
      version: pairingSecretVersion(),
    }),
    now: input.now,
  });

  // not_found 和 expired 在这里合流：对外只有一种失败。
  if (redemption.kind !== "redeemed") return { outcome: "invalid" };
  return { outcome: "paired", userId: redemption.userId };
}
