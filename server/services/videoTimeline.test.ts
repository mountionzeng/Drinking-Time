import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  createVideoTake,
  getStoryVideoTimelineSelections,
  resetMemoryStateForTesting,
} from "../db";
import {
  clearVideoTimelineSegment,
  createUsableVideoRange,
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
