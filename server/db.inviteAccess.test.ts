import { beforeEach, describe, expect, it } from "vitest";

import {
  bindRedeemedInviteToUser,
  createEmailOtp,
  createInviteCode,
  findAvailableInviteCode,
  findValidEmailOtp,
  hasRedeemedInviteForEmail,
  markEmailOtpUsed,
  redeemInviteForEmail,
  resetMemoryStateForTesting,
  upsertUser,
  getUserByOpenId,
} from "./db";
import { hashInviteCode } from "./services/inviteAccess";

describe("邀请码与本地邮箱验证码", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("邀请码只能绑定一个邮箱，并允许同邮箱安全重试", async () => {
    const codeHash = hashInviteCode("LH-AB12-CD34");
    await createInviteCode({
      codeHash,
      label: "第一轮内测",
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await findAvailableInviteCode(codeHash)).not.toBeNull();
    expect(
      await redeemInviteForEmail(codeHash, "a@example.com")
    ).not.toBeNull();
    expect(
      await redeemInviteForEmail(codeHash, "a@example.com")
    ).not.toBeNull();
    expect(await redeemInviteForEmail(codeHash, "b@example.com")).toBeNull();
    expect(await hasRedeemedInviteForEmail("a@example.com")).toBe(true);
    expect(await findAvailableInviteCode(codeHash)).toBeNull();
  });

  it("已核销的邀请码可以补绑到创建出的用户", async () => {
    const email = "tester@example.com";
    const codeHash = hashInviteCode("LH-EF56-GH78");
    await createInviteCode({ codeHash, label: null, expiresAt: null });
    await redeemInviteForEmail(codeHash, email);
    await upsertUser({
      openId: `email:${email}`,
      email,
      loginMethod: "email",
    });
    const user = await getUserByOpenId(`email:${email}`);

    expect(user).toBeDefined();
    await bindRedeemedInviteToUser(email, user!.id);
    expect(await hasRedeemedInviteForEmail(email)).toBe(true);
  });

  it("本地模式也能完成一次性 OTP 验证", async () => {
    await createEmailOtp(
      "local@example.com",
      "123456",
      new Date(Date.now() + 60_000)
    );
    const otp = await findValidEmailOtp("local@example.com", "123456");

    expect(otp).not.toBeNull();
    await markEmailOtpUsed(otp!.id);
    expect(await findValidEmailOtp("local@example.com", "123456")).toBeNull();
  });
});
