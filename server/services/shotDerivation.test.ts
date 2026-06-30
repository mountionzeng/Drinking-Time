import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmDerivedShotAtomic,
  createGeneratedImage,
  createShotDerivationDraft,
  createStory,
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
  undoDerivedShotAtomic,
} from "../db";

describe("derived shot atomic operation", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("applies story, image and timeline together and can undo", async () => {
    const created = await createStory({
      userId: 1,
      title: "test",
      body: {
        _revision: 1,
        shots: [{ shotNo: 1, stableShotId: "shot-a", subject: "A" }],
      },
    });
    const candidate = await createGeneratedImage({
      storyId: created.id,
      userId: 1,
      shotIdentity: "shot-derived",
      imageUrl: "/api/images/derived.png",
      isCurrent: false,
    });
    const draft = await createShotDerivationDraft({
      storyId: created.id,
      userId: 1,
      sourceStableShotId: "shot-a",
      sourceTakeId: 9,
      sourceTimeSec: 1.2,
      crop: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
      fullFrameImageUrl: "/api/images/full.png",
      cropImageUrl: "/api/images/crop.png",
      provisionalStableShotId: "shot-derived",
      candidateImageIds: [candidate.id],
      status: "ready",
    });
    const confirmation = {
      storyId: created.id,
      userId: 1,
      draftId: draft.id,
      selectedImageId: candidate.id,
      stableShotId: "shot-derived",
      shotNo: "SH02",
      expectedStoryRevision: 1,
      expectedTimelineVersion: 0,
      nextStoryBody: {
        _revision: 2,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "shot-derived" },
        ],
      },
      nextTimelineItems: [
        { stableShotId: "shot-a", included: true, position: 0 },
        { stableShotId: "shot-derived", included: true, position: 1 },
      ],
    };
    const applied = await confirmDerivedShotAtomic(confirmation);
    const repeated = await confirmDerivedShotAtomic(confirmation);

    expect((await getStoryById(created.id, 1))?.body).toMatchObject({
      _revision: 2,
    });
    expect(repeated.operation.id).toBe(applied.operation.id);
    expect(await getStoryTimeline(created.id, 1)).toMatchObject({
      version: 1,
    });

    await undoDerivedShotAtomic(applied.operation.id, 1);
    expect((await getStoryById(created.id, 1))?.body).toMatchObject({
      _revision: 1,
    });
    expect(await getStoryTimeline(created.id, 1)).toMatchObject({
      version: 2,
      items: [],
    });
  });

  it("rejects stale story revisions before changing state", async () => {
    const created = await createStory({
      userId: 1,
      title: "test",
      body: { _revision: 4, shots: [] },
    });
    const candidate = await createGeneratedImage({
      storyId: created.id,
      userId: 1,
      shotIdentity: "shot-derived",
      imageUrl: "/api/images/derived.png",
      isCurrent: false,
    });
    const draft = await createShotDerivationDraft({
      storyId: created.id,
      userId: 1,
      sourceStableShotId: "shot-a",
      sourceTakeId: 9,
      sourceTimeSec: 1.2,
      crop: {},
      fullFrameImageUrl: "/api/images/full.png",
      cropImageUrl: "/api/images/crop.png",
      provisionalStableShotId: "shot-derived",
      status: "ready",
    });
    await expect(
      confirmDerivedShotAtomic({
        storyId: created.id,
        userId: 1,
        draftId: draft.id,
        selectedImageId: candidate.id,
        stableShotId: "shot-derived",
        shotNo: "SH02",
        expectedStoryRevision: 3,
        expectedTimelineVersion: 0,
        nextStoryBody: { _revision: 4, shots: [] },
        nextTimelineItems: [],
      })
    ).rejects.toThrow("故事已经更新");
  });
});
