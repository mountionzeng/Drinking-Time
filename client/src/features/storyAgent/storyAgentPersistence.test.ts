import { describe, expect, it } from "vitest";

import {
  emptyState,
  getPublishingBuffer,
  normalizePersisted,
  removePublishingBuffer,
  setPublishingBuffer,
  storyWorkScore,
} from "./storyAgentPersistence";

describe("storyAgent publishing persistence", () => {
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
