import { describe, expect, it } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
import { resolveScopedPublishingHandoff } from "./publishingHandoffScope";

function publishing(body: string, now: number) {
  return upsertPublishingPlatformDraft(emptyPublishingDraftState(now), {
    platform: "xiaohongshu",
    content: { title: "", body, tags: [] },
    now,
  });
}

describe("publishing handoff story scope", () => {
  it("rejects a cover and draft response that belongs to the previous story", () => {
    const currentStoryPublishing = publishing("故事 B 的文字稿", 2);
    const result = resolveScopedPublishingHandoff({
      activeStoryId: 1176,
      spinePublishing: currentStoryPublishing,
      story: { id: 1176, body: { publishing: currentStoryPublishing } },
      publishingRead: {
        storyId: 20,
        publishing: publishing("故事 A 的文字稿", 99),
        coverAsset: {
          id: 1480,
          imageUrl: "/api/images/story-a.webp",
          imageKey: "story-a.webp",
        },
      },
    });

    expect(result.publishing.drafts.xiaohongshu?.content.body).toBe(
      "故事 B 的文字稿"
    );
    expect(result.coverAsset).toBeNull();
  });

  it("rejects a cover from a stale publishing version", () => {
    const current = publishing("V1", 2);
    current.activeVersionId = "v2";
    current.revision = 10;
    const stale = publishing("V1", 3);
    stale.activeVersionId = "v1";
    stale.revision = 3;

    const result = resolveScopedPublishingHandoff({
      activeStoryId: 1176,
      spinePublishing: current,
      story: { id: 1176, body: { publishing: current } },
      publishingRead: {
        storyId: 1176,
        publishing: stale,
        coverAsset: {
          id: 1480,
          imageUrl: "/api/images/old-cover.webp",
          imageKey: "old-cover.webp",
        },
      },
    });

    expect(result.coverAsset).toBeNull();
  });

  it("accepts the cover only when story and active version both match", () => {
    const current = publishing("当前文字稿", 2);
    const cover = {
      id: 1523,
      imageUrl: "/api/images/current-cover.webp",
      imageKey: "current-cover.webp",
    };
    const result = resolveScopedPublishingHandoff({
      activeStoryId: 1176,
      spinePublishing: current,
      story: { id: 1176, body: { publishing: current } },
      publishingRead: {
        storyId: 1176,
        publishing: current,
        coverAsset: cover,
      },
    });

    expect(result.coverAsset).toEqual(cover);
  });
});
