import { beforeEach, describe, expect, it } from "vitest";
import {
  applyStoryTimelineOverlayAtomic,
  createStory,
  createVideoTake,
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "./db";

describe("story timeline overlay persistence", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("round-trips overlays and preserves them when an ordinary timeline edit saves items", async () => {
    const story = await createStory({
      userId: 1,
      title: "overlay",
      body: { shots: [{ shotNo: 1, stableShotId: "shot-a" }] },
    });
    const overlays = [
      {
        id: "overlay-a",
        kind: "generated-video",
        takeId: 9,
        sourceStableShotId: "shot-a",
        videoUrl: "/video.mp4",
        startFrame: 0,
        targetEndFrame: 90,
        mediaEndFrame: 80,
        endFrame: 90,
        stackOrder: 1,
        leftImageId: 1,
        rightImageId: 2,
        transform: {},
      },
    ];
    const created = await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-a", included: true, position: 0 }],
      overlays,
    });
    expect(created).toMatchObject({ version: 1, overlays });

    const updated = await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "shot-a", included: true, position: 0, stackOrder: 2 }],
    });
    expect(updated).toMatchObject({ version: 2, overlays });
    expect(await getStoryTimeline(story.id, 1)).toMatchObject({ overlays });
  });

  it("atomically marks the paid take applied while appending one idempotent overlay", async () => {
    const story = await createStory({
      userId: 1,
      title: "atomic overlay",
      body: { shots: [{ shotNo: 1, stableShotId: "shot-a" }] },
    });
    const timeline = await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-a", included: true, position: 0 }],
    });
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "transition-shot-a",
      sourceImageId: 1,
      status: "available",
      provider: "302",
      model: "viduq2-turbo",
      prompt: "overlay",
      durationSec: 3,
      aspectRatio: "1:1",
      videoUrl: "/api/videos/take.mp4",
      extractionCapability: "available",
      parameterSnapshot: { appliedToTimeline: false },
    });
    const overlay = {
      id: "overlay-atomic",
      kind: "generated-video" as const,
      takeId: take.id,
      sourceStableShotId: "shot-a",
      videoUrl: take.videoUrl!,
      startFrame: 30,
      targetEndFrame: 132,
      mediaEndFrame: 120,
      endFrame: 132,
      stackOrder: 5,
      leftImageId: 1,
      rightImageId: 2,
      transform: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 },
    };
    const applied = await applyStoryTimelineOverlayAtomic({
      storyId: story.id,
      userId: 1,
      takeId: take.id,
      stableShotId: "transition-shot-a",
      expectedStoryRevision: 0,
      expectedVersion: timeline.version,
      nextStoryBody: {
        revision: 1,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "transition-shot-a" },
        ],
      },
      nextTimelineItems: [
        { stableShotId: "shot-a", included: true, position: 0 },
        { stableShotId: "transition-shot-a", included: true, position: 1 },
      ],
      overlay,
    });
    const repeated = await applyStoryTimelineOverlayAtomic({
      storyId: story.id,
      userId: 1,
      takeId: take.id,
      stableShotId: "transition-shot-a",
      expectedStoryRevision: 0,
      expectedVersion: timeline.version,
      nextStoryBody: {
        revision: 1,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "transition-shot-a" },
        ],
      },
      nextTimelineItems: [
        { stableShotId: "shot-a", included: true, position: 0 },
        { stableShotId: "transition-shot-a", included: true, position: 1 },
      ],
      overlay,
    });
    expect(applied.applied).toBe(true);
    expect(repeated.applied).toBe(false);
    expect(applied.take.parameterSnapshot).toMatchObject({
      appliedToTimeline: true,
      overlayId: overlay.id,
    });
    expect((applied.timeline.overlays as unknown[])).toHaveLength(1);
    expect((applied.timeline.items as unknown[])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stableShotId: "transition-shot-a" }),
      ])
    );
    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: {
        shots: expect.arrayContaining([
          expect.objectContaining({ stableShotId: "transition-shot-a" }),
        ]),
      },
    });
  });

  it.each([
    { shotExists: false, timelineItemExists: false, overlayExists: true },
    { shotExists: false, timelineItemExists: true, overlayExists: false },
    { shotExists: false, timelineItemExists: true, overlayExists: true },
    { shotExists: true, timelineItemExists: false, overlayExists: false },
    { shotExists: true, timelineItemExists: false, overlayExists: true },
    { shotExists: true, timelineItemExists: true, overlayExists: false },
  ])(
    "repairs a partial adoption state: shot=$shotExists item=$timelineItemExists overlay=$overlayExists",
    async ({ shotExists, timelineItemExists, overlayExists }) => {
      const stableShotId = "transition-shot-repair";
      const story = await createStory({
        userId: 1,
        title: "repair overlay",
        body: {
          revision: 0,
          shots: [
            { shotNo: 1, stableShotId: "shot-a" },
            ...(shotExists
              ? [{ shotNo: 2, stableShotId }]
              : []),
          ],
        },
      });
      const overlay = {
        id: "overlay-repair",
        kind: "generated-video" as const,
        takeId: 1,
        sourceStableShotId: stableShotId,
        videoUrl: "/api/videos/repair.mp4",
        startFrame: 30,
        targetEndFrame: 132,
        mediaEndFrame: 120,
        endFrame: 132,
        stackOrder: 5,
        leftImageId: 1,
        rightImageId: 2,
        transform: {},
      };
      const timeline = await updateStoryTimeline({
        storyId: story.id,
        userId: 1,
        expectedVersion: 0,
        items: [
          { stableShotId: "shot-a", included: true, position: 0 },
          ...(timelineItemExists
            ? [{ stableShotId, included: true, position: 1 }]
            : []),
        ],
        ...(overlayExists ? { overlays: [overlay] } : {}),
      });
      const take = await createVideoTake({
        storyId: story.id,
        userId: 1,
        stableShotId,
        sourceImageId: 1,
        status: "available",
        provider: "302",
        model: "viduq2-turbo",
        prompt: "repair",
        durationSec: 3,
        aspectRatio: "1:1",
        videoUrl: overlay.videoUrl,
        extractionCapability: "available",
        parameterSnapshot: { appliedToTimeline: false },
      });
      overlay.takeId = take.id;

      const repaired = await applyStoryTimelineOverlayAtomic({
        storyId: story.id,
        userId: 1,
        takeId: take.id,
        stableShotId,
        expectedStoryRevision: 0,
        expectedVersion: timeline.version,
        nextStoryBody: {
          revision: 1,
          shots: [
            { shotNo: 1, stableShotId: "shot-a" },
            { shotNo: 2, stableShotId },
          ],
        },
        nextTimelineItems: [
          { stableShotId: "shot-a", included: true, position: 0 },
          { stableShotId, included: true, position: 1 },
        ],
        overlay,
      });

      expect(repaired.applied).toBe(true);
      expect(repaired.story.body).toMatchObject({
        shots: expect.arrayContaining([
          expect.objectContaining({ stableShotId }),
        ]),
      });
      expect(repaired.timeline.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ stableShotId })])
      );
      expect(repaired.timeline.overlays).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: overlay.id })])
      );
      expect(repaired.take.parameterSnapshot).toMatchObject({
        appliedToTimeline: true,
        overlayId: overlay.id,
      });
    }
  );
});
