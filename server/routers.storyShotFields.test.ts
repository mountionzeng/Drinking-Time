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
          {
            stableShotId: "shot-0102",
            shotIdentity: "shot-0102",
            shotNo: 2,
            dialogue: "另一镜保持不变",
          },
        ],
        timeline: { version: 7, items: ["shot-0101", "shot-0102"] },
        publishing: { activeVersionId: "v3" },
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
    expect((body.shots as Array<Record<string, unknown>>)[1]).toMatchObject({
      stableShotId: "shot-0102",
      dialogue: "另一镜保持不变",
    });
    expect(body.timeline).toEqual({
      version: 7,
      items: ["shot-0101", "shot-0102"],
    });
    expect(body.publishing).toEqual({ activeVersionId: "v3" });
  });

  it("updates editor metadata atomically without replacing sibling state", async () => {
    const caller = appRouter.createCaller(context(612));
    const created = await caller.storyAgent.storyUpsert({
      title: "Metadata command",
      body: {
        shots: [
          {
            stableShotId: "shot-0101",
            shotIdentity: "shot-0101",
            shotNo: 1,
            subject: "窗边人物",
            promptOverrides: {
              tone: { value: "暖色", weight: 0.3 },
            },
          },
          {
            stableShotId: "shot-0102",
            shotIdentity: "shot-0102",
            shotNo: 2,
            subject: "兄弟镜头",
          },
        ],
        timeline: { version: 4 },
        publishing: { activeVersionId: "v2" },
      },
    });
    if (!created) throw new Error("story creation failed");

    const result = await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "SHOT-0101",
      patch: { cameraMove: "缓慢推进" },
      metadata: {
        durationMs: 4200,
        promptOverride: {
          dimension: "genre",
          override: { value: "水彩", weight: 0.9 },
        },
        promptRun: {
          finalPrompt: "窗边人物，水彩质感",
          generatedAt: 123,
          imageId: 99,
          source: "prompt-table-rerender",
          usedDimensions: ["subject", "genre"],
        },
      },
    });

    expect(result.status).toBe("ok");
    const body = result.story?.body as Record<string, unknown>;
    expect((body.shots as Array<Record<string, unknown>>)[0]).toMatchObject({
      stableShotId: "shot-0101",
      cameraMove: "缓慢推进",
      durationMs: 4200,
      promptOverrides: {
        tone: { value: "暖色", weight: 0.3 },
        genre: { value: "水彩", weight: 0.9 },
      },
      promptRun: { imageId: 99, finalPrompt: "窗边人物，水彩质感" },
    });
    expect((body.shots as Array<Record<string, unknown>>)[1]).toMatchObject({
      stableShotId: "shot-0102",
      subject: "兄弟镜头",
    });
    expect(body.timeline).toEqual({ version: 4 });
    expect(body.publishing).toEqual({ activeVersionId: "v2" });
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
