import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  bindRedeemedInviteToUser,
  createInviteCode,
  getUserByOpenId,
  redeemInviteForEmail,
  resetMemoryStateForTesting,
  upsertUser,
} from "./db";
import { appRouter } from "./routers";
import { hashInviteCode } from "./services/inviteAccess";

function context(user: NonNullable<TrpcContext["user"]>): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("管理员邀请状态", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("拒绝普通用户读取邀请名单", async () => {
    await upsertUser({
      openId: "email:member@example.com",
      email: "member@example.com",
      loginMethod: "email",
      role: "user",
    });
    const member = await getUserByOpenId("email:member@example.com");

    await expect(
      appRouter.createCaller(context(member!)).accessAnalytics.invites()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("展示待领取、已领取和已过期状态，不暴露邀请码哈希", async () => {
    await upsertUser({
      openId: "email:owner@example.com",
      email: "owner@example.com",
      loginMethod: "email",
      role: "admin",
    });
    await upsertUser({
      openId: "email:claimed@example.com",
      email: "claimed@example.com",
      name: "已领取测试员",
      loginMethod: "email",
      role: "user",
    });
    const owner = await getUserByOpenId("email:owner@example.com");
    const claimedUser = await getUserByOpenId("email:claimed@example.com");

    const pendingCode = "LH-PENDING-01";
    const claimedCode = "LH-CLAIMED-01";
    await createInviteCode({
      codeHash: hashInviteCode(pendingCode),
      label: "pending@example.com",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await createInviteCode({
      codeHash: hashInviteCode("LH-EXPIRED-01"),
      label: "expired@example.com",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await createInviteCode({
      codeHash: hashInviteCode(claimedCode),
      label: "claimed@example.com",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await redeemInviteForEmail(
      hashInviteCode(claimedCode),
      "claimed@example.com"
    );
    await bindRedeemedInviteToUser("claimed@example.com", claimedUser!.id);

    const overview = await appRouter
      .createCaller(context(owner!))
      .accessAnalytics.invites();

    expect(overview.invites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "pending@example.com",
          status: "pending",
        }),
        expect.objectContaining({
          label: "expired@example.com",
          status: "expired",
        }),
        expect.objectContaining({
          label: "claimed@example.com",
          status: "redeemed",
          redeemedByEmail: "claimed@example.com",
          redeemedByUserId: claimedUser!.id,
          userName: "已领取测试员",
        }),
      ])
    );
    expect(overview.invites.every(invite => !("codeHash" in invite))).toBe(
      true
    );
  });
});
