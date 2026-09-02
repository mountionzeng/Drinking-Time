import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ENV } from "../_core/env";

import {
  consumePersistentRateLimit,
  getUserSessionVersion,
  linkEmailIdentity,
  resetMemoryStateForTesting,
  resolveEmailIdentity,
  upsertUser,
  getUserByOpenId,
} from "../db";
import {
  OTP_SEND_LIMIT,
  OTP_TTL_MS,
  authenticateWithPassword,
  changeAccountPassword,
  completePasswordRecovery,
  issueEmailOtp,
  resolveForLogin,
  setAccountPassword,
  verifyEmailOtp,
} from "./accountIdentity";

beforeAll(() => {
  // 验证码摘要的 secret 缺失时服务会失败关闭，测试里显式给一个。
  ENV.otpDigestSecret = "test-otp-digest-secret";
  ENV.otpDigestSecretVersion = 1;
  // U3 的邮箱冲突报告完成前，自动 identity 解析保持关闭
  ENV.accountAutoIdentityResolution = false;
});

const IP = "203.0.113.9";
const EMAIL = "owner@example.com";
const STRONG = "correcthorsebatterystaple";
const NEXT_STRONG = "另一句只有我自己记得住的很长的口令"; // 17 个码点

async function makeUser(email: string): Promise<number> {
  await upsertUser({ openId: `email:${email}`, email, loginMethod: "email" });
  const user = await getUserByOpenId(`email:${email}`);
  await linkEmailIdentity({ userId: user!.id, email });
  return user!.id;
}

async function issue(purpose: "login" | "verify" | "recover" = "login") {
  const result = await issueEmailOtp({ email: EMAIL, purpose, requestIp: IP });
  if (result.outcome !== "issued") throw new Error(`签发失败：${result.outcome}`);
  return result.otp;
}

describe("邮箱验证码", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("签发 6 位码并给出过期时间", async () => {
    const otp = await issue();

    expect(otp.code).toMatch(/^\d{6}$/);
    expect(otp.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(OTP_TTL_MS);
  });

  it("正确的码验证通过；同一个码不能用第二次", async () => {
    const otp = await issue();

    expect(
      (await verifyEmailOtp({ email: EMAIL, purpose: "login", code: otp.code, requestIp: IP }))
        .outcome
    ).toBe("verified");
    expect(
      (await verifyEmailOtp({ email: EMAIL, purpose: "login", code: otp.code, requestIp: IP }))
        .outcome
    ).toBe("invalid");
  });

  it("重新签发让上一个码立即失效", async () => {
    const first = await issue();
    const second = await issue();

    expect(
      (await verifyEmailOtp({ email: EMAIL, purpose: "login", code: first.code, requestIp: IP }))
        .outcome
    ).toBe("invalid");
    expect(
      (await verifyEmailOtp({ email: EMAIL, purpose: "login", code: second.code, requestIp: IP }))
        .outcome
    ).toBe("verified");
  });

  it("用途隔离：登录码不能用来找回密码", async () => {
    const otp = await issue("login");

    expect(
      (await verifyEmailOtp({ email: EMAIL, purpose: "recover", code: otp.code, requestIp: IP }))
        .outcome
    ).toBe("invalid");
  });

  it("过期的码不通过", async () => {
    const otp = await issue();
    const later = new Date(Date.now() + OTP_TTL_MS + 1000);

    expect(
      (
        await verifyEmailOtp({
          email: EMAIL,
          purpose: "login",
          code: otp.code,
          requestIp: IP,
          now: later,
        })
      ).outcome
    ).toBe("invalid");
  });

  it("连续猜错到上限后，即使给出正确的码也不再放行", async () => {
    const otp = await issue();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await verifyEmailOtp({ email: EMAIL, purpose: "login", code: "000000", requestIp: IP });
    }

    expect(
      (await verifyEmailOtp({ email: EMAIL, purpose: "login", code: otp.code, requestIp: IP }))
        .outcome
    ).toBe("invalid");
  });

  it("发送次数超限后拒绝，并给出还要等多久", async () => {
    for (let attempt = 0; attempt < OTP_SEND_LIMIT.maxAttempts; attempt += 1) {
      expect((await issueEmailOtp({ email: EMAIL, purpose: "login", requestIp: IP })).outcome)
        .toBe("issued");
    }
    const blocked = await issueEmailOtp({ email: EMAIL, purpose: "login", requestIp: IP });

    expect(blocked.outcome).toBe("rate_limited");
    if (blocked.outcome === "rate_limited") {
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("限流计数落在共享存储里，不是进程内内存", async () => {
    for (let attempt = 0; attempt < OTP_SEND_LIMIT.maxAttempts; attempt += 1) {
      await issueEmailOtp({ email: EMAIL, purpose: "login", requestIp: IP });
    }
    // 直接读持久化限流器：进程重启后拿到的也是这一份
    const decision = await consumePersistentRateLimit({
      scope: "otp:send:email",
      subject: EMAIL,
      windowSeconds: OTP_SEND_LIMIT.windowSeconds,
      maxAttempts: OTP_SEND_LIMIT.maxAttempts,
    });

    expect(decision.allowed).toBe(false);
  });

  it("未知邮箱同样签发，不用响应差异暴露账号是否存在", async () => {
    const known = await issueEmailOtp({ email: EMAIL, purpose: "login", requestIp: IP });
    const unknown = await issueEmailOtp({
      email: "nobody@example.com",
      purpose: "login",
      requestIp: "198.51.100.7",
    });

    expect(known.outcome).toBe(unknown.outcome);
  });

  it("验证通过时返回已解析的 userId；没有账号时返回 null 交给上层去建", async () => {
    const userId = await makeUser(EMAIL);
    const otp = await issue();
    const resolved = await verifyEmailOtp({
      email: EMAIL,
      purpose: "login",
      code: otp.code,
      requestIp: IP,
    });
    expect(resolved).toMatchObject({ outcome: "verified", userId });

    const fresh = await issueEmailOtp({
      email: "brand-new@example.com",
      purpose: "login",
      requestIp: IP,
    });
    if (fresh.outcome !== "issued") throw new Error("签发失败");
    expect(
      await verifyEmailOtp({
        email: "brand-new@example.com",
        purpose: "login",
        code: fresh.otp.code,
        requestIp: IP,
      })
    ).toMatchObject({ outcome: "verified", userId: null });
  });

  it("历史账号未经人工映射时不自动认领——U3 完成前的闸门", async () => {
    // 只建历史 users 行，不建 identity 登记：这正是旧库导入后的形态
    await upsertUser({ openId: "legacy:only", email: EMAIL, loginMethod: "email" });
    expect(await resolveEmailIdentity(EMAIL)).toMatchObject({ kind: "legacy_single" });
    expect(await resolveForLogin(EMAIL)).toMatchObject({
      kind: "needs_manual_mapping",
    });

    const otp = await issue();
    expect(
      await verifyEmailOtp({ email: EMAIL, purpose: "login", code: otp.code, requestIp: IP })
    ).toMatchObject({ outcome: "needs_manual_mapping" });
  });

  it("开关打开后才允许自动认领历史账号", async () => {
    await upsertUser({ openId: "legacy:only", email: EMAIL, loginMethod: "email" });
    const user = await getUserByOpenId("legacy:only");

    ENV.accountAutoIdentityResolution = true;
    try {
      expect(await resolveForLogin(EMAIL)).toMatchObject({
        kind: "known",
        userId: user!.id,
      });
    } finally {
      ENV.accountAutoIdentityResolution = false;
    }
  });

  it("同一邮箱解析到多个历史用户时失败关闭，绝不静默合并", async () => {
    await upsertUser({ openId: "legacy:1", email: EMAIL, loginMethod: "email" });
    await upsertUser({ openId: "legacy:2", email: EMAIL.toUpperCase(), loginMethod: "email" });

    expect(await resolveEmailIdentity(EMAIL)).toMatchObject({ kind: "conflict" });
    expect((await issueEmailOtp({ email: EMAIL, purpose: "login", requestIp: IP })).outcome)
      .toBe("identity_conflict");
  });
});

describe("密码", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("设置后可以用密码登录", async () => {
    const userId = await makeUser(EMAIL);
    expect((await setAccountPassword({ userId, password: STRONG })).outcome).toBe("set");

    expect(
      await authenticateWithPassword({ email: EMAIL, password: STRONG, requestIp: IP })
    ).toMatchObject({ outcome: "authenticated", userId });
  });

  it("弱口令被拒绝并给出可读原因", async () => {
    const userId = await makeUser(EMAIL);
    const result = await setAccountPassword({ userId, password: "short" });

    expect(result).toMatchObject({ outcome: "rejected", reason: "too_short" });
    if (result.outcome === "rejected") expect(result.message).toContain("15");
  });

  it("防枚举：未知邮箱、密码错误、未设置密码返回同一种失败", async () => {
    const userId = await makeUser(EMAIL);
    const noPassword = await authenticateWithPassword({
      email: EMAIL,
      password: STRONG,
      requestIp: IP,
    });
    await setAccountPassword({ userId, password: STRONG });
    const wrongPassword = await authenticateWithPassword({
      email: EMAIL,
      password: "correcthorsebatterystapl",
      requestIp: IP,
    });
    const unknownEmail = await authenticateWithPassword({
      email: "nobody@example.com",
      password: STRONG,
      requestIp: IP,
    });

    expect(noPassword.outcome).toBe("invalid_credentials");
    expect(wrongPassword.outcome).toBe("invalid_credentials");
    expect(unknownEmail.outcome).toBe("invalid_credentials");
  });

  it("改密码需要当前密码，成功后撤销其他设备", async () => {
    const userId = await makeUser(EMAIL);
    await setAccountPassword({ userId, password: STRONG });
    const before = await getUserSessionVersion(userId);

    expect(
      (
        await changeAccountPassword({
          userId,
          currentPassword: "wrong-password-value",
          nextPassword: NEXT_STRONG,
        })
      ).outcome
    ).toBe("invalid_credentials");
    expect(await getUserSessionVersion(userId)).toBe(before);

    const changed = await changeAccountPassword({
      userId,
      currentPassword: STRONG,
      nextPassword: NEXT_STRONG,
    });
    expect(changed.outcome).toBe("changed");
    expect(await getUserSessionVersion(userId)).toBe((before ?? 1) + 1);
    expect(
      (await authenticateWithPassword({ email: EMAIL, password: STRONG, requestIp: IP })).outcome
    ).toBe("invalid_credentials");
    expect(
      (await authenticateWithPassword({ email: EMAIL, password: NEXT_STRONG, requestIp: IP }))
        .outcome
    ).toBe("authenticated");
  });

  it("找回密码撤销全部旧 session，且不自动登录", async () => {
    const userId = await makeUser(EMAIL);
    await setAccountPassword({ userId, password: STRONG });
    const before = (await getUserSessionVersion(userId)) ?? 1;
    const otp = await issue("recover");

    const recovered = await completePasswordRecovery({
      email: EMAIL,
      code: otp.code,
      nextPassword: NEXT_STRONG,
      requestIp: IP,
    });

    expect(recovered).toMatchObject({ outcome: "recovered", userId });
    // 找回不返回任何会话凭据——用户必须用新密码正常登录一次
    expect(recovered).not.toHaveProperty("sessionToken");
    expect(await getUserSessionVersion(userId)).toBe(before + 1);
    expect(
      (await authenticateWithPassword({ email: EMAIL, password: STRONG, requestIp: IP })).outcome
    ).toBe("invalid_credentials");
    expect(
      (await authenticateWithPassword({ email: EMAIL, password: NEXT_STRONG, requestIp: IP }))
        .outcome
    ).toBe("authenticated");
  });

  it("找回时验证码错误不改密码", async () => {
    const userId = await makeUser(EMAIL);
    await setAccountPassword({ userId, password: STRONG });
    await issue("recover");

    expect(
      (
        await completePasswordRecovery({
          email: EMAIL,
          code: "000000",
          nextPassword: NEXT_STRONG,
          requestIp: IP,
        })
      ).outcome
    ).toBe("invalid");
    expect(
      (await authenticateWithPassword({ email: EMAIL, password: STRONG, requestIp: IP })).outcome
    ).toBe("authenticated");
  });
});
