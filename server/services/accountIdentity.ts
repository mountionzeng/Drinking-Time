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
import {
  bumpUserSessionVersion,
  consumePersistentRateLimit,
  consumeVerificationChallenge,
  getPasswordCredential,
  issueVerificationChallenge,
  normalizeAccountEmail,
  resolveEmailIdentity,
  setPasswordCredential,
} from "../db";
import {
  checkPasswordPolicy,
  generateOtpCode,
  hashOtpCode,
  otpDigestMatches,
  hashPassword,
  verifyPassword,
  type OtpPurpose,
  type PasswordPolicyResult,
} from "./accountSecurity";

export const OTP_TTL_MS = 10 * 60_000;
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
