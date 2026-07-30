import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  createGeneratedImage,
  createVideoTake,
  getUserByOpenId,
  resetMemoryStateForTesting,
  upsertUser,
} from "./db";
import { appRouter } from "./routers";

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

  it("管理员能看到零访问邮箱、近期时段和每位用户的生成算力", async () => {
    await upsertUser({
      openId: "email:owner@example.com",
      email: "owner@example.com",
      loginMethod: "email",
      role: "admin",
    });
    await upsertUser({
      openId: "email:invited@example.com",
      email: "invited@example.com",
      loginMethod: "email",
      role: "user",
    });
    const admin = await getUserByOpenId("email:owner@example.com");
    const invited = await getUserByOpenId("email:invited@example.com");
    const caller = appRouter.createCaller(context(admin!));
    const invitedCaller = appRouter.createCaller(context(invited!));

    await invitedCaller.accessAnalytics.heartbeat({
      visitId: "invited-visit-1",
      siteHost: "www.drinkingtime.top",
    });
    await createGeneratedImage({
      projectId: null,
      storyId: null,
      userId: invited!.id,
      shotNo: "1",
      shotIdentity: "shot-1",
      imageKey: null,
      imageUrl: "https://example.com/image.png",
      prompt: "test",
      promptCompilationId: null,
      generationType: "initial",
      parentImageId: null,
      isCurrent: true,
      maskKey: null,
    });
    await createVideoTake({
      storyId: 1,
      userId: invited!.id,
      stableShotId: "shot-1",
      sourceImageId: null,
      promptCompilationId: null,
      status: "available",
      taskId: "task-1",
      provider: "302",
      model: "viduq2-turbo",
      prompt: "move",
      subtitle: null,
      durationSec: 5,
      aspectRatio: "16:9",
      videoKey: null,
      videoUrl: "https://example.com/video.mp4",
      errorMessage: null,
      parameterSnapshot: null,
      idempotencyKey: null,
      extractionCapability: "unavailable",
    });
    await createVideoTake({
      storyId: 1,
      userId: invited!.id,
      stableShotId: "shot-2",
      sourceImageId: null,
      promptCompilationId: null,
      status: "failed",
      taskId: "task-2",
      provider: "302",
      model: "viduq2-turbo",
      prompt: "failed move",
      subtitle: null,
      durationSec: 99,
      aspectRatio: "16:9",
      videoKey: null,
      videoUrl: null,
      errorMessage: "failed",
      parameterSnapshot: null,
      idempotencyKey: null,
      extractionCapability: "unavailable",
    });

    const overview = await caller.accessAnalytics.overview({
      siteHost: "www.drinkingtime.top",
    });
    expect(overview.users).toHaveLength(2);
    expect(
      overview.users.find(user => user.email === "owner@example.com")
    ).toMatchObject({
      visitCount: 0,
      durationSeconds: 0,
      imageGenerations: 0,
      videoGenerations: 0,
      hasAccessHistory: false,
    });
    expect(
      overview.users.find(user => user.email === "invited@example.com")
    ).toMatchObject({
      visitCount: 1,
      imageGenerations: 1,
      videoGenerations: 1,
      videoSeconds: 5,
      hasAccessHistory: true,
    });
    expect(
      overview.users.find(user => user.email === "invited@example.com")
        ?.recentSessions
    ).toHaveLength(1);
  });
});
