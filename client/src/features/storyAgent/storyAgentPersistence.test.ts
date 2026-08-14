import { describe, expect, it } from "vitest";

import {
  emptyState,
  getPublishingBuffer,
  normalizePersisted,
  removePublishingBuffer,
  setPublishingBuffer,
  reconcilePublishingBufferReceipt,
  persistPublishingBuffersSafely,
  publishingBufferContentHash,
  storyWorkScore,
} from "./storyAgentPersistence";

describe("storyAgent publishing persistence", () => {
  it("reconciles leave/carry after a committed receipt and is idempotent after a client crash", () => {
    const source = { storyId: 7, platform: "x" as const, versionId: "v1", content: { title: "", body: "dirty", tags: [] }, updatedAt: 1 };
    const buffers = setPublishingBuffer({}, source);
    const baseReceipt = { status: "committed" as const, operationKind: "create_version" as const, operationToken: "op", requestHash: "hash-1234", versionId: "v2", resultActiveVersionId: "v2",
      sourceVersionId: "v1", storyId: 7, platform: "x" as const, sourceBufferKey: "7:x",
      sourceBufferHash: publishingBufferContentHash(source.content), committedAt: 2, baseContainerRevision: 1 };
    expect(reconcilePublishingBufferReceipt(buffers, { ...baseReceipt, bufferDisposition: "leave" }).buffers).toEqual(buffers);
    const carried = reconcilePublishingBufferReceipt(buffers, { ...baseReceipt, bufferDisposition: "carry" });
    expect(getPublishingBuffer(carried.buffers, 7, "x", "v1")).toBeUndefined();
    expect(getPublishingBuffer(carried.buffers, 7, "x", "v2")?.content.body).toBe("dirty");
    expect(reconcilePublishingBufferReceipt(carried.buffers, { ...baseReceipt, bufferDisposition: "carry" }).buffers).toEqual(carried.buffers);
    const edited = setPublishingBuffer(buffers, { ...source, content: { ...source.content, body: "new edit" } });
    expect(reconcilePublishingBufferReceipt(edited, { ...baseReceipt, bufferDisposition: "carry" })).toMatchObject({
      conflict: "buffer_changed", buffers: edited,
    });
    const withTarget = setPublishingBuffer(buffers, { ...source, versionId: "v2", content: { ...source.content, body: "existing v2" } });
    expect(reconcilePublishingBufferReceipt(withTarget, { ...baseReceipt, bufferDisposition: "carry" })).toMatchObject({
      conflict: "target_buffer_exists", buffers: withTarget,
    });
  });

  it("keeps the original buffer when localStorage persistence fails", () => {
    const buffers = setPublishingBuffer({}, { storyId: 7, platform: "x", versionId: "v1", content: { title: "", body: "dirty", tags: [] }, updatedAt: 1 });
    const storage = { setItem: () => { throw new Error("quota"); } };
    const result = persistPublishingBuffersSafely(storage, "key", emptyState(), {}, buffers);
    expect(result).toEqual({ ok: false, buffers });
  });

  it("merges buffers into the full persisted state without overwriting story fields", () => {
    let written = "";
    const storage = { setItem: (_key: string, value: string) => { written = value; } };
    const state = { ...emptyState(), messages: [{ id: "m", role: "user" as const, content: "keep", timestamp: 1 }],
      cards: [{ id: "c", content: "card", emotion: "", sensoryDetails: [], createdAt: 1 }] };
    const result = persistPublishingBuffersSafely(storage, "key", state, {}, {});
    expect(result.ok).toBe(true);
    expect(JSON.parse(written)).toMatchObject({ messages: state.messages, cards: state.cards, publishingBuffers: {} });
  });
  it("normalizes malformed publishing data without disturbing existing story work", () => {
    const normalized = normalizePersisted({
      ...emptyState(),
      messages: [{ id: "m1", role: "user", content: "真实想法", timestamp: 1 }],
      cards: [
        {
          id: "c1",
          content: "保留的故事卡",
          emotion: "quiet",
          sensoryDetails: [],
          createdAt: 1,
        },
      ],
      publishing: { activePlatform: "myspace", drafts: "broken" } as never,
      publishingBuffers: {
        "7:x": {
          storyId: 7,
          platform: "x",
          content: { title: "", body: "尚未应用的文字", tags: [] },
          updatedAt: 10,
        },
        broken: { storyId: 8, platform: "myspace" },
      } as never,
    });

    expect(normalized.messages[0]?.content).toBe("真实想法");
    expect(normalized.cards[0]?.content).toBe("保留的故事卡");
    expect(normalized.publishing?.activePlatform).toBe("xiaohongshu");
    expect(normalized.publishing?.drafts).toEqual({});
    expect(Object.keys(normalized.publishingBuffers ?? {})).toEqual(["7:x"]);
  });

  it("keeps dirty buffers isolated by Story and platform", () => {
    let buffers = {};
    buffers = setPublishingBuffer(buffers, {
      storyId: 7,
      platform: "xiaohongshu",
      content: { title: "小红书", body: "A", tags: [] },
      updatedAt: 10,
    });
    buffers = setPublishingBuffer(buffers, {
      storyId: 8,
      platform: "xiaohongshu",
      content: { title: "另一个故事", body: "B", tags: [] },
      updatedAt: 11,
    });

    expect(getPublishingBuffer(buffers, 7, "xiaohongshu")?.content.body).toBe(
      "A"
    );
    expect(getPublishingBuffer(buffers, 8, "xiaohongshu")?.content.body).toBe(
      "B"
    );

    buffers = removePublishingBuffer(buffers, 7, "xiaohongshu");
    expect(getPublishingBuffer(buffers, 7, "xiaohongshu")).toBeUndefined();
    expect(getPublishingBuffer(buffers, 8, "xiaohongshu")).toBeDefined();
  });

  it("keeps dirty buffers isolated between publishing versions", () => {
    let buffers = {};
    buffers = setPublishingBuffer(buffers, {
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      content: { title: "V1", body: "旧版本修改", tags: [] },
      updatedAt: 10,
    });
    buffers = setPublishingBuffer(buffers, {
      storyId: 7,
      versionId: "v2",
      platform: "xiaohongshu",
      content: { title: "V2", body: "新版本修改", tags: [] },
      updatedAt: 11,
    });

    expect(
      getPublishingBuffer(buffers, 7, "xiaohongshu", "v1")?.content.body
    ).toBe("旧版本修改");
    expect(
      getPublishingBuffer(buffers, 7, "xiaohongshu", "v2")?.content.body
    ).toBe("新版本修改");
    expect(Object.keys(buffers)).toEqual(["7:xiaohongshu", "7:v2:xiaohongshu"]);
  });

  it("counts accepted drafts and dirty buffers as recoverable work", () => {
    const withPublishing = normalizePersisted({
      ...emptyState(),
      publishing: {
        activePlatform: "x",
        selectedPlatforms: ["x"],
        drafts: {
          x: {
            platform: "x",
            content: { title: "", body: "a draft", tags: [] },
          },
        },
      } as never,
    });
    const withBuffer = normalizePersisted({
      ...emptyState(),
      publishingBuffers: {
        "-1:x": {
          storyId: -1,
          platform: "x",
          content: { title: "", body: "typing", tags: [] },
          updatedAt: 1,
        },
      },
    } as never);

    expect(storyWorkScore(withPublishing)).toBeGreaterThan(0);
    expect(storyWorkScore(withBuffer)).toBeGreaterThan(0);
  });
});
