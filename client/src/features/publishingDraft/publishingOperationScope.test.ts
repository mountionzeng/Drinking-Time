import { describe, expect, it } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
import {
  publishingOperationScope,
  publishingOperationScopeMatches,
  publishingTrendWriteScope,
} from "./publishingOperationScope";

describe("publishing operation scope", () => {
  it("captures every identity and revision used by version and trend writes", () => {
    const publishing = upsertPublishingPlatformDraft(
      emptyPublishingDraftState(1),
      {
        platform: "xiaohongshu",
        content: { title: "标题", body: "正文", tags: [] },
        now: 2,
      }
    );
    publishing.containerRevision = 3;
    publishing.versions![0].versionRevision = 4;
    publishing.versions![0].drafts = structuredClone(publishing.drafts);
    publishing.versions![0].platformContexts = {
      xiaohongshu: {
        revision: 5,
        snapshots: [],
        selectedSnapshotId: null,
        selectedTags: [],
        updatedAt: 3,
      },
    };

    const scope = publishingOperationScope({ storyId: 7, publishing });
    expect(scope).toMatchObject({
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      containerRevision: 3,
      versionRevision: 4,
      draftRevision: 1,
      contextRevision: 5,
    });
    expect(publishingTrendWriteScope(scope)).toEqual({
      versionId: "v1",
      platform: "xiaohongshu",
      baseContainerRevision: 3,
      baseVersionRevision: 4,
      baseContextRevision: 5,
      baseSourceRevision: 1,
    });
  });

  it("rejects a response after Story, version, draft, intent, or context moved", () => {
    const publishing = emptyPublishingDraftState(1);
    const scope = publishingOperationScope({ storyId: 7, publishing });
    expect(publishingOperationScopeMatches(scope, {
      storyId: 7,
      publishing,
    })).toBe(true);
    expect(publishingOperationScopeMatches(scope, {
      storyId: 8,
      publishing,
    })).toBe(false);

    const moved = structuredClone(publishing);
    moved.containerRevision = (moved.containerRevision ?? 0) + 1;
    expect(publishingOperationScopeMatches(scope, {
      storyId: 7,
      publishing: moved,
    })).toBe(false);
  });

});
