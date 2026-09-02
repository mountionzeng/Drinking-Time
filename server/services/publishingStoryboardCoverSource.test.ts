import { describe, expect, it } from "vitest";

import { emptyPublishingDraftState } from "@shared/publishingDraft";
import { resolvePublishingStoryboardCoverSource } from "./publishingStoryboardCoverSource";

describe("publishing storyboard cover source", () => {
  it("does not treat paid ancestor candidates as an adopted cover version", () => {
    const state = emptyPublishingDraftState(1);
    const v1 = state.versions![0]!;
    v1.coverRounds = [
      {
        id: "legacy-cover-round",
        platform: "xiaohongshu",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        instructions: [],
        artReference: null,
        assetIds: [1640, 1641, 1642, 1643],
        createdAt: 1,
      },
    ];
    state.versions = [
      v1,
      {
        ...structuredClone(v1),
        versionId: "v2",
        sequence: 2,
        parentId: "v1",
        cover: null,
        coverRounds: [],
      },
      {
        ...structuredClone(v1),
        versionId: "v4",
        sequence: 4,
        parentId: "v2",
        cover: null,
        coverRounds: [],
      },
    ];
    state.activeVersionId = "v4";
    state.activeVideoStoryboardVersionId = "v2";

    expect(resolvePublishingStoryboardCoverSource(state)).toEqual({
      versionId: "v2",
      cover: null,
    });
  });

  it("prefers the nearest formally adopted cover over older candidates", () => {
    const state = emptyPublishingDraftState(1);
    const v1 = state.versions![0]!;
    v1.coverRounds = [
      {
        id: "older-round",
        platform: "xiaohongshu",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        instructions: [],
        artReference: null,
        assetIds: [41, 42, 43, 44],
        createdAt: 1,
      },
    ];
    state.versions = [
      v1,
      {
        ...structuredClone(v1),
        versionId: "v2",
        sequence: 2,
        parentId: "v1",
        cover: { assetId: 77, sourceCoreRevision: 1, createdAt: 2 },
        coverRounds: [],
      },
    ];
    state.activeVersionId = "v2";
    state.activeVideoStoryboardVersionId = "v2";

    expect(resolvePublishingStoryboardCoverSource(state)).toMatchObject({
      versionId: "v2",
      cover: { assetId: 77 },
    });
  });
});
