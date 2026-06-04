import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { resetMemoryStateForTesting } from "./db";

function createAuthContext(userId = 42): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user-${userId}@example.com`,
      name: `用户 ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("project tRPC router", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("同一用户两台设备初次进入会收敛到同一个最近项目", async () => {
    const caller = appRouter.createCaller(createAuthContext(101));
    const otherDeviceCaller = appRouter.createCaller(createAuthContext(101));

    const older = await caller.project.create({ name: "旧项目" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await caller.project.create({ name: "最近项目" });

    const [firstDevice, secondDevice] = await Promise.all([
      caller.project.getOrCreateDefault(),
      otherDeviceCaller.project.getOrCreateDefault(),
    ]);

    expect(firstDevice.id).toBe(newer.id);
    expect(secondDevice.id).toBe(newer.id);
    expect(firstDevice.id).not.toBe(older.id);
  });

  it("零项目并发进入只创建一个默认项目", async () => {
    const caller = appRouter.createCaller(createAuthContext(202));

    const defaults = await Promise.all(
      Array.from({ length: 8 }, () => caller.project.getOrCreateDefault())
    );
    const projects = await caller.project.list();

    expect(new Set(defaults.map((project) => project.id)).size).toBe(1);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("默认分析项目");
  });

  it("不同用户的默认项目按 userId 隔离", async () => {
    const firstUser = appRouter.createCaller(createAuthContext(301));
    const secondUser = appRouter.createCaller(createAuthContext(302));

    const firstDefault = await firstUser.project.getOrCreateDefault();
    const secondDefault = await secondUser.project.getOrCreateDefault();

    expect(firstDefault.userId).toBe(301);
    expect(secondDefault.userId).toBe(302);
    expect(firstDefault.id).not.toBe(secondDefault.id);
    await expect(firstUser.project.list()).resolves.toHaveLength(1);
    await expect(secondUser.project.list()).resolves.toHaveLength(1);
  });
});
