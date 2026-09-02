import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  getStoryById,
  getStoryTimeline,
  insertTransitionShotAtomic,
  resetMemoryStateForTesting,
  restoreSplitStoryShotAtomic,
  updateStoryTimeline,
} from "./db";

describe("story shot split atomic persistence", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("restores both documents atomically while keeping revisions monotonic", async () => {
    const beforeBody = {
      _revision: 1,
      shots: [{ shotNo: 1, stableShotId: "shot-a" }],
    };
    const story = await createStory({
      userId: 1,
      title: "split",
      body: beforeBody,
    });
    const beforeItems = [
      { stableShotId: "shot-a", included: true, position: 0 },
    ];
    const splitBody = {
      _revision: 2,
      shots: [
        { shotNo: 1, stableShotId: "shot-a" },
        { shotNo: 2, stableShotId: "split-right" },
      ],
    };
    const splitItems = [
      { stableShotId: "shot-a", included: true, position: 0 },
      { stableShotId: "split-right", included: true, position: 1 },
    ];

    await insertTransitionShotAtomic({
      storyId: story.id,
      userId: 1,
      stableShotId: "split-right",
      expectedStoryRevision: 1,
      expectedTimelineVersion: 0,
      nextStoryBody: splitBody,
      nextTimelineItems: splitItems,
    });

    const restored = await restoreSplitStoryShotAtomic({
      storyId: story.id,
      userId: 1,
      splitStableShotId: "split-right",
      expectedStoryRevision: 2,
      expectedTimelineVersion: 1,
      nextStoryBody: { ...beforeBody, _revision: 3 },
      nextTimelineItems: beforeItems,
    });

    expect(restored.story.body).toMatchObject({
      _revision: 3,
      shots: [{ stableShotId: "shot-a" }],
    });
    expect(restored.timeline).toMatchObject({ version: 2, items: beforeItems });
  });

  it("rejects stale undo without changing either document", async () => {
    const story = await createStory({
      userId: 1,
      title: "stale split",
      body: {
        _revision: 2,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "split-right" },
        ],
      },
    });

    await expect(
      restoreSplitStoryShotAtomic({
        storyId: story.id,
        userId: 1,
        splitStableShotId: "split-right",
        expectedStoryRevision: 1,
        expectedTimelineVersion: 0,
        nextStoryBody: {
          _revision: 3,
          shots: [{ shotNo: 1, stableShotId: "shot-a" }],
        },
        nextTimelineItems: [],
      })
    ).rejects.toThrow("故事已在切割后继续编辑");

    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: { _revision: 2, shots: [{}, { stableShotId: "split-right" }] },
    });
    expect(await getStoryTimeline(story.id, 1)).toBeNull();
  });

  it("restores a split while preserving a persisted timeline overlay", async () => {
    const beforeBody = {
      _revision: 1,
      shots: [{ shotNo: 1, stableShotId: "shot-a" }],
    };
    const story = await createStory({ userId: 1, title: "overlay split", body: beforeBody });
    const beforeItems = [{ stableShotId: "shot-a", included: true, position: 0 }];
    const splitItems = [
      ...beforeItems,
      { stableShotId: "split-right", included: true, position: 1 },
    ];

    await insertTransitionShotAtomic({
      storyId: story.id,
      userId: 1,
      stableShotId: "split-right",
      expectedStoryRevision: 1,
      expectedTimelineVersion: 0,
      nextStoryBody: {
        _revision: 2,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "split-right" },
        ],
      },
      nextTimelineItems: splitItems,
    });
    const overlays = [{ id: "overlay-1", kind: "generated-video" }];
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 1,
      items: splitItems,
      overlays,
    });

    const restored = await restoreSplitStoryShotAtomic({
      storyId: story.id,
      userId: 1,
      splitStableShotId: "split-right",
      expectedStoryRevision: 2,
      expectedTimelineVersion: 2,
      nextStoryBody: { ...beforeBody, _revision: 3 },
      nextTimelineItems: beforeItems,
    });

    expect(restored.timeline.version).toBe(3);
    expect(await getStoryTimeline(story.id, 1)).toMatchObject({
      version: 3,
      items: beforeItems,
      overlays,
    });
  });
});
