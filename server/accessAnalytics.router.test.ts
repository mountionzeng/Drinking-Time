import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  getUserByOpenId,
  resetMemoryStateForTesting,
  upsertUser,
} from "./db";
import { appRouter } from "./routers";

function context(
  user: NonNullable<TrpcContext["user"]>
): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("访问情况权限", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("普通用户可以记录自己的心跳，但不能读取访问名单", async () => {
    await upsertUser({
      openId: "email:member@example.com",
      email: "member@example.com",
      loginMethod: "email",
      role: "user",
    });
    const user = await getUserByOpenId("email:member@example.com");
    const caller = appRouter.createCaller(context(user!));

    await expect(
      caller.accessAnalytics.heartbeat({
        visitId: "member-visit-1",
        siteHost: "www.drinkingtime.top",
      })
    ).resolves.toMatchObject({ durationSeconds: 0 });
    await expect(
      caller.accessAnalytics.overview({
        siteHost: "www.drinkingtime.top",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("管理员可以读取当前站点的访问名单", async () => {
    await upsertUser({
      openId: "email:owner@example.com",
      email: "owner@example.com",
      loginMethod: "email",
      role: "admin",
    });
    const admin = await getUserByOpenId("email:owner@example.com");
    const caller = appRouter.createCaller(context(admin!));
    await caller.accessAnalytics.heartbeat({
      visitId: "owner-visit-1",
      siteHost: "preview.drinkingtime.top",
    });

    await expect(
      caller.accessAnalytics.overview({
        siteHost: "preview.drinkingtime.top",
      })
    ).resolves.toMatchObject({
      users: [
        {
          userId: admin!.id,
          email: "owner@example.com",
          visitCount: 1,
        },
      ],
    });
  });
});
