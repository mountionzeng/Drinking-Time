import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  getStoryById,
  getStoryTimeline,
  insertTransitionShotAtomic,
  resetMemoryStateForTesting,
} from "./db";

describe("insertTransitionShotAtomic", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("writes story and timeline together, then treats the same stable id as idempotent", async () => {
    const story = await createStory({
      userId: 1,
      title: "transition",
      body: {
        _revision: 1,
        shots: [
          { shotNo: 1, stableShotId: "shot-a", subject: "A" },
          { shotNo: 2, stableShotId: "shot-b", subject: "B" },
        ],
      },
    });
    const input = {
      storyId: story.id,
      userId: 1,
      stableShotId: "transition-shot-1",
      expectedStoryRevision: 1,
      expectedTimelineVersion: 0,
      nextStoryBody: {
        _revision: 2,
        shots: [
          { shotNo: 1, stableShotId: "shot-a", subject: "A" },
          {
            shotNo: 2,
            stableShotId: "transition-shot-1",
            subject: "A 到 B",
          },
          { shotNo: 3, stableShotId: "shot-b", subject: "B" },
        ],
      },
      nextTimelineItems: [
        { stableShotId: "shot-a", included: true, position: 0 },
        {
          stableShotId: "transition-shot-1",
          included: true,
          position: 1,
        },
        { stableShotId: "shot-b", included: true, position: 2 },
      ],
    };

    const applied = await insertTransitionShotAtomic(input);
    const repeated = await insertTransitionShotAtomic(input);

    expect(applied.applied).toBe(true);
    expect(repeated.applied).toBe(false);
    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: { _revision: 2 },
    });
    expect(await getStoryTimeline(story.id, 1)).toMatchObject({
      version: 1,
      items: [
        { stableShotId: "shot-a" },
        { stableShotId: "transition-shot-1" },
        { stableShotId: "shot-b" },
      ],
    });
  });

  it("rejects a stale story revision before either document changes", async () => {
    const story = await createStory({
      userId: 1,
      title: "stale",
      body: { _revision: 4, shots: [] },
    });

    await expect(
      insertTransitionShotAtomic({
        storyId: story.id,
        userId: 1,
        stableShotId: "transition-shot-stale",
        expectedStoryRevision: 3,
        expectedTimelineVersion: 0,
        nextStoryBody: { _revision: 5, shots: [] },
        nextTimelineItems: [],
      })
    ).rejects.toThrow("故事已经更新");

    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: { _revision: 4 },
    });
    expect(await getStoryTimeline(story.id, 1)).toBeNull();
  });
});
