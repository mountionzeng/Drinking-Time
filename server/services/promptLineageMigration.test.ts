import { describe, expect, it } from "vitest";
import { createPromptLineageMemoryStore } from "./promptLineageStore";
import { migrateLegacyPromptLineage } from "./promptLineageMigration";

describe("migrateLegacyPromptLineage", () => {
  it("imports shot prompt facts, three modality compilations, and merged chat once", async () => {
    const store = createPromptLineageMemoryStore();
    const input = {
      storyId: 28,
      userId: 7,
      body: {
        theme: "学会放下",
        visualPreference: "写实记录",
        shots: [
          {
            stableShotId: "shot-01",
            shotNo: 1,
            subject: "主角站在雨后的街口",
            action: "抬头看向远处",
            dialogue: "没关系，就这样吧",
            cameraMove: "轻微推近",
            promptDraft: "雨后街口，写实电影感",
          },
        ],
        messages: [
          {
            id: "first-question",
            role: "assistant",
            content: "你好，我是小酌",
            timestamp: 1,
          },
          {
            id: "user-1",
            role: "user",
            content: "我想让这一句更克制",
            timestamp: 20,
          },
        ],
        creationMessages: [
          {
            id: "user-1",
            role: "user",
            content: "我想让这一句更克制",
            timestamp: 20,
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "可以把动作收住，只保留抬头。",
            timestamp: 30,
          },
        ],
      },
    };

    const first = await migrateLegacyPromptLineage(store, input);
    const second = await migrateLegacyPromptLineage(store, input);
    const aggregate = store.getStoryAggregate(input);

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(aggregate.state.migrationStatus).toBe("migrated");
    expect(aggregate.nodes.map(node => node.dimension)).toEqual(
      expect.arrayContaining([
        "theme",
        "visual_style",
        "subject",
        "action",
        "dialogue",
        "camera_motion",
        "image_prompt",
      ]),
    );
    expect(
      aggregate.compilationHeads.map(
        head => `${head.stableShotId}:${head.modality}`,
      ),
    ).toEqual([
      "shot-01:dialogue",
      "shot-01:image",
      "shot-01:video",
    ]);
    expect(aggregate.messages.map(message => message.content)).toEqual([
      "我想让这一句更克制",
      "可以把动作收住，只保留抬头。",
    ]);
    expect(
      aggregate.revisions.find(revision => revision.content === "主角站在雨后的街口")
        ?.weight,
    ).toBe(0.42);
    expect(
      aggregate.revisions.find(revision => revision.content === "轻微推近")?.weight,
    ).toBe(0.36);
  });

  it("creates a minimal migrated state for a story without shots", async () => {
    const store = createPromptLineageMemoryStore();
    const result = await migrateLegacyPromptLineage(store, {
      storyId: 30,
      userId: 7,
      body: { title: "空故事" },
    });

    const aggregate = store.getStoryAggregate({ storyId: 30, userId: 7 });
    expect(result.migrated).toBe(true);
    expect(aggregate.state.migrationStatus).toBe("migrated");
    expect(aggregate.nodes).toMatchObject([
      { scope: "story", modality: "shared", dimension: "title" },
    ]);
    expect(aggregate.compilations).toHaveLength(0);
  });

  it("rebuilds a system-only migrated story when shots arrive later", async () => {
    const store = createPromptLineageMemoryStore();
    await migrateLegacyPromptLineage(store, {
      storyId: 32,
      userId: 7,
      body: { title: "先空后补" },
      source: "initial",
    });

    const second = await migrateLegacyPromptLineage(store, {
      storyId: 32,
      userId: 7,
      body: {
        title: "先空后补",
        visualPreference: "温暖广告片",
        shots: [
          {
            stableShotId: "shot-01",
            shotNo: 1,
            subject: "主角站在午后街头",
            dialogue: "就这样继续吧",
            promptDraft: "warm premium commercial film still",
            cameraMove: "缓慢推近",
          },
        ],
      },
      source: "initial",
    });

    const aggregate = store.getStoryAggregate({ storyId: 32, userId: 7 });
    expect(second.migrated).toBe(true);
    expect(
      aggregate.compilationHeads.map(
        head => `${head.stableShotId}:${head.modality}`,
      ),
    ).toEqual([
      "shot-01:dialogue",
      "shot-01:image",
      "shot-01:video",
    ]);
    expect(
      aggregate.nodes.find(node => node.dimension === "visual_style")
        ?.currentRevisionId,
    ).toBeTruthy();
  });

  it("derives deterministic unique identities for legacy duplicate shot numbers", async () => {
    const store = createPromptLineageMemoryStore();
    await migrateLegacyPromptLineage(store, {
      storyId: 31,
      userId: 7,
      body: {
        shots: [
          { shotNo: 1, subject: "街口" },
          { shotNo: 1, subject: "室内" },
        ],
      },
    });

    const aggregate = store.getStoryAggregate({ storyId: 31, userId: 7 });
    const shotIds = Array.from(
      new Set(
        aggregate.nodes
          .map(node => node.stableShotId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    expect(shotIds).toHaveLength(2);
    expect(shotIds[0]).not.toBe(shotIds[1]);
  });
});
