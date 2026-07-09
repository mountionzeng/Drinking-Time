import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  createVideoTake,
  getStoryVideoTakeRanges,
  getStoryVideoTimelineSelections,
  getVideoTakeById,
  resetMemoryStateForTesting,
} from "../db";
import {
  clearVideoTimelineSegment,
  createUsableVideoRange,
  markVideoTakeUnusable,
  moveVideoTakeToShot,
  reuseVideoTakeForShot,
  selectVideoTimelineSegment,
} from "./videoTimeline";

async function seedStory() {
  const story = await createStory({
    userId: 1,
    projectId: null,
    title: "故事",
    body: {
      cards: [],
      characters: [],
      shots: [
        {
          stableShotId: "shot-06",
          shotIdentity: "shot-06",
          shotNo: 6,
          subject: "窗边",
          action: "转身",
          dialogue: "",
          shotType: "",
          beat: "turn",
          cameraAngle: "",
          cameraMove: "",
          location: "",
          timeLight: "",
          mood: "",
          sound: "",
          styleRef: "",
          note: "",
          emotion: "",
          sourceCardContent: "",
        },
      ],
    },
  });
  const take = await createVideoTake({
    storyId: story.id,
    userId: 1,
    stableShotId: "shot-06",
    sourceImageId: 11,
    status: "available",
    provider: "302",
    model: "video-model",
    prompt: "move",
    durationSec: 5,
    aspectRatio: "16:9",
    videoUrl: "/api/video/1",
    extractionCapability: "unavailable",
  });
  return { story, take };
}

beforeEach(() => {
  resetMemoryStateForTesting();
});

describe("videoTimeline", () => {
  it("stores a usable range and can mark it as the single timeline segment", async () => {
    const { story, take } = await seedStory();

    const result = await createUsableVideoRange(
      {
        storyId: story.id,
        stableShotId: "shot-06",
        takeId: take.id,
        startSec: 1.2,
        endSec: 3.4,
        useOnTimeline: true,
      },
      1
    );

    expect(result.range).toMatchObject({
      startSec: 1.2,
      endSec: 3.4,
      takeId: take.id,
    });
    expect(result.selection).toMatchObject({
      takeId: take.id,
      rangeId: result.range.id,
      selectionType: "range",
    });
  });

  it("replaces the prior timeline segment instead of keeping competing truth", async () => {
    const { story, take } = await seedStory();
    await createUsableVideoRange(
      {
        storyId: story.id,
        stableShotId: "shot-06",
        takeId: take.id,
        startSec: 1,
        endSec: 2,
        useOnTimeline: true,
      },
      1
    );

    await selectVideoTimelineSegment(
      {
        storyId: story.id,
        stableShotId: "shot-06",
        takeId: take.id,
        selectionType: "full_take",
      },
      1
    );

    const selections = await getStoryVideoTimelineSelections(story.id, 1);
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({
      takeId: take.id,
      rangeId: null,
      selectionType: "full_take",
    });
  });

  it("moves a take, its ranges, and its timeline selection to another shot", async () => {
    const { story, take } = await seedStory();
    const rangeResult = await createUsableVideoRange(
      {
        storyId: story.id,
        stableShotId: "shot-06",
        takeId: take.id,
        startSec: 1,
        endSec: 2,
        useOnTimeline: true,
      },
      1
    );

    const moved = await moveVideoTakeToShot(
      {
        storyId: story.id,
        takeId: take.id,
        targetStableShotId: "shot-07",
      },
      1
    );

    expect(moved).toMatchObject({
      sourceStableShotId: "shot-06",
      targetStableShotId: "shot-07",
      movedTimelineSelection: true,
    });
    expect(await getVideoTakeById(take.id, 1)).toMatchObject({
      stableShotId: "shot-07",
    });
    expect(await getStoryVideoTakeRanges(story.id, 1)).toContainEqual(
      expect.objectContaining({
        id: rangeResult.range.id,
        stableShotId: "shot-07",
        takeId: take.id,
      })
    );
    expect(await getStoryVideoTimelineSelections(story.id, 1)).toEqual([
      expect.objectContaining({
        stableShotId: "shot-07",
        takeId: take.id,
        rangeId: rangeResult.range.id,
        selectionType: "range",
      }),
    ]);
  });

  it("reuses a take on another shot without moving the source take", async () => {
    const { story, take } = await seedStory();

    const reused = await reuseVideoTakeForShot(
      {
        storyId: story.id,
        sourceTakeId: take.id,
        targetStableShotId: "shot-07",
        plannedDurationSec: 2.4,
      },
      1
    );

    expect(reused.take).toMatchObject({
      storyId: story.id,
      stableShotId: "shot-07",
      status: "available",
      videoUrl: take.videoUrl,
      sourceImageId: null,
      promptCompilationId: null,
    });
    expect(reused.take.id).not.toBe(take.id);
    expect(reused.range).toMatchObject({
      takeId: reused.take.id,
      stableShotId: "shot-07",
      startSec: 0,
      endSec: 2.4,
    });
    expect(reused.selection).toMatchObject({
      takeId: reused.take.id,
      stableShotId: "shot-07",
      rangeId: reused.range.id,
      selectionType: "range",
    });
    expect(await getVideoTakeById(take.id, 1)).toMatchObject({
      stableShotId: "shot-06",
    });
    expect(await getStoryVideoTimelineSelections(story.id, 1)).toEqual([
      expect.objectContaining({
        stableShotId: "shot-07",
        takeId: reused.take.id,
      }),
    ]);
  });

  it("reuses a take from another story into the current story", async () => {
    const { story: sourceStory, take } = await seedStory();
    const targetStory = await createStory({
      userId: 1,
      projectId: null,
      title: "目标故事",
      body: {
        shots: [
          {
            stableShotId: "target-shot-01",
            shotIdentity: "target-shot-01",
            shotNo: 1,
            subject: "门口",
          },
        ],
      },
    });

    const reused = await reuseVideoTakeForShot(
      {
        storyId: targetStory.id,
        sourceTakeId: take.id,
        targetStableShotId: "target-shot-01",
        plannedDurationSec: 3,
      },
      1
    );

    expect(reused.take).toMatchObject({
      storyId: targetStory.id,
      stableShotId: "target-shot-01",
      status: "available",
      videoUrl: take.videoUrl,
    });
    expect(reused.take.parameterSnapshot).toMatchObject({
      reusedFromTakeId: take.id,
      reusedFromStoryId: sourceStory.id,
      reusedFromStableShotId: "shot-06",
    });
    expect(await getVideoTakeById(take.id, 1)).toMatchObject({
      storyId: sourceStory.id,
      stableShotId: "shot-06",
    });
    expect(await getStoryVideoTimelineSelections(targetStory.id, 1)).toEqual([
      expect.objectContaining({
        stableShotId: "target-shot-01",
        takeId: reused.take.id,
      }),
    ]);
  });

  it("clears timeline truth without deleting the take", async () => {
    const { story, take } = await seedStory();
    await selectVideoTimelineSegment(
      {
        storyId: story.id,
        stableShotId: "shot-06",
        takeId: take.id,
        selectionType: "full_take",
      },
      1
    );

    await clearVideoTimelineSegment(
      { storyId: story.id, stableShotId: "shot-06" },
      1
    );

    expect(await getStoryVideoTimelineSelections(story.id, 1)).toEqual([]);
  });

  it("marks a take unusable and removes its timeline slot", async () => {
    const { story, take } = await seedStory();
    await selectVideoTimelineSegment(
      {
        storyId: story.id,
        stableShotId: "shot-06",
        takeId: take.id,
        selectionType: "full_take",
      },
      1
    );

    const result = await markVideoTakeUnusable(
      { storyId: story.id, takeId: take.id },
      1
    );

    expect(result).toMatchObject({
      clearedTimelineSelection: true,
      take: {
        id: take.id,
        status: "unfollowable",
        errorMessage: "用户标记为不可用。",
      },
    });
    expect(await getVideoTakeById(take.id, 1)).toMatchObject({
      status: "unfollowable",
      errorMessage: "用户标记为不可用。",
    });
    expect(await getStoryVideoTimelineSelections(story.id, 1)).toEqual([]);
  });

  it("rejects unavailable takes as timeline material", async () => {
    const { story } = await seedStory();
    const failed = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-06",
      sourceImageId: 12,
      status: "failed",
      provider: "302",
      model: "video-model",
      prompt: "move",
      durationSec: 5,
      aspectRatio: "16:9",
      extractionCapability: "unavailable",
    });

    await expect(
      selectVideoTimelineSegment(
        {
          storyId: story.id,
          stableShotId: "shot-06",
          takeId: failed.id,
          selectionType: "full_take",
        },
        1
      )
    ).rejects.toThrow("只有已生成且可播放的视频素材才能进入时间轴");
  });
});
