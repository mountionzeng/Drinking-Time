import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";

const savedDatabaseUrl = ENV.databaseUrl;

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `shot-fields-${userId}`,
      email: `shot-fields-${userId}@example.com`,
      name: `Shot Fields ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
});

afterEach(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});

describe("storyAgent.updateStoryShotFields", () => {
  it("patches the latest server story by stable id without replacing sibling edits", async () => {
    const caller = appRouter.createCaller(context(611));
    const created = await caller.storyAgent.storyUpsert({
      title: "SheSelf",
      body: {
        cards: [],
        characters: [],
        shots: [
          {
            stableShotId: "shot-0101",
            shotIdentity: "shot-0101",
            shotNo: 1,
            dialogue: "我害怕所有的事情",
            cameraMove: "缓慢推进",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    await caller.storyAgent.storyUpsert({
      id: created.id,
      baseRevision: created.revision,
      title: created.title,
      body: {
        ...(created.body as Record<string, unknown>),
        editorNote: "another tab saved this first",
      },
    });

    const result = await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "shot-0101",
      patch: {
        cueCode: "0101",
        cameraPath: "从正面极近景开始，沿视线轴推至眼部后停住。",
      },
    });

    expect(result.status).toBe("ok");
    const body = result.story?.body as Record<string, unknown>;
    expect(body.editorNote).toBe("another tab saved this first");
    expect((body.shots as Array<Record<string, unknown>>)[0]).toMatchObject({
      stableShotId: "shot-0101",
      cueCode: "0101",
      cameraMove: "缓慢推进",
      cameraPath: "从正面极近景开始，沿视线轴推至眼部后停住。",
    });
  });

  it("does not allow another user to patch the story", async () => {
    const owner = appRouter.createCaller(context(612));
    const intruder = appRouter.createCaller(context(613));
    const created = await owner.storyAgent.storyUpsert({
      title: "Private story",
      body: {
        shots: [{ stableShotId: "private-shot", shotNo: 1 }],
      },
    });
    if (!created) throw new Error("story creation failed");

    await expect(
      intruder.storyAgent.updateStoryShotFields({
        storyId: created.id,
        stableShotId: "private-shot",
        patch: { cameraMove: "should not persist" },
      })
    ).resolves.toEqual({ status: "error", error: "故事不存在" });
  });
});
