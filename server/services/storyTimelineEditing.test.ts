import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStory,
  createVideoTake,
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
} from "../../shared/storyMaterial";
import { runStoryTimelineCommand } from "./storyTimelineEditing";
import * as storyVisualPersistence from "../persistence/storyVisualPersistence";

const USER_ID = 1;

async function seedLegacyOverlay() {
  const story = await createStory({
    userId: USER_ID,
    title: "legacy aggregate",
    body: {
      _revision: 0,
      shots: [
        { stableShotId: "shot-a", shotIdentity: "shot-a", shotNo: 1 },
        {
          stableShotId: "transition-shot",
          shotIdentity: "transition-shot",
          shotKey: "transition-shot",
          shotNo: 2,
        },
      ],
    },
  });
  const take = await createVideoTake({
    storyId: story.id,
    userId: USER_ID,
    stableShotId: "transition-shot",
    status: "available",
    provider: "302",
    model: "viduq2-turbo",
    prompt: "legacy overlay",
    durationSec: 3,
    aspectRatio: "1:1",
    videoUrl: "/api/videos/transition.mp4",
    extractionCapability: "available",
  });
  const item: StoryTimelineItem = {
    stableShotId: "transition-shot",
    included: true,
    position: 1,
    plannedDurationMs: 3_000,
    durationFrames: 90,
    timelineStartFrame: 10,
    stackOrder: 2,
    visualLayer: 1,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    primaryVideoEdit: {
      takeId: take.id,
      sourceStartSec: 0,
      sourceEndSec: 3,
      effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
    },
  };
  const overlay: StoryTimelineOverlay = {
    id: "overlay-transition",
    kind: "generated-video",
    takeId: take.id,
    sourceStableShotId: "transition-shot",
    videoUrl: take.videoUrl!,
    startFrame: 75,
    targetEndFrame: 180,
    mediaEndFrame: 165,
    endFrame: 180,
    stackOrder: 23,
    visualLayer: 4,
    leftImageId: 11,
    rightImageId: 12,
    transform: {
      ...DEFAULT_TIMELINE_TRANSFORM,
      zoom: 1.25,
      panX: 0.2,
    },
    effects: {
      ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
      playbackRate: 0.8,
    },
  };
  const timeline = await updateStoryTimeline({
    storyId: story.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 2_000,
        durationFrames: 60,
        timelineStartFrame: 0,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      },
      item,
    ],
    overlays: [overlay],
    visualLayerState: { count: 5, hidden: [3] },
  });
  return { story, take, item, overlay, timeline };
}

describe("runStoryTimelineCommand", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("normalizes one legacy overlay and applies the user command in one aggregate write", async () => {
    const seeded = await seedLegacyOverlay();
    const result = await runStoryTimelineCommand(
      {
        storyId: seeded.story.id,
        userId: USER_ID,
        failureMessage: "移动失败",
        legacyOverlay: {
          overlayId: seeded.overlay.id,
          sourceStableShotId: seeded.overlay.sourceStableShotId,
          expectedVideoUrl: seeded.overlay.videoUrl,
        },
      },
      context => {
        expect(context.document.overlays).toEqual([]);
        const normalized = context.document.items.find(
          candidate => candidate.stableShotId === "transition-shot"
        );
        expect(normalized).toMatchObject({
          timelineStartFrame: 75,
          durationFrames: 90,
          visualLayer: 4,
          stackOrder: 23,
          transform: seeded.overlay.transform,
          primaryVideoEdit: { effects: seeded.overlay.effects },
        });
        return {
          status: "ok" as const,
          value: { stableShotId: "transition-shot" },
          storyBody: context.storyBody,
          document: {
            ...context.document,
            items: context.document.items.map(item =>
              item.stableShotId === "transition-shot"
                ? { ...item, timelineStartFrame: 87 }
                : item
            ),
          },
        };
      }
    );

    expect(result).toMatchObject({
      status: "ok",
      changed: true,
      normalizedLegacyOverlay: true,
      storyRevision: 1,
      timelineVersion: 2,
      value: { stableShotId: "transition-shot" },
    });
    if (result.status !== "ok") return;
    expect(result.facts.before.timelineVersion).toBe(1);
    expect(result.facts.before.document.overlays).toEqual([
      expect.objectContaining({
        id: seeded.overlay.id,
        sourceStableShotId: seeded.overlay.sourceStableShotId,
        startFrame: seeded.overlay.startFrame,
        mediaEndFrame: seeded.overlay.mediaEndFrame,
        visualLayer: seeded.overlay.visualLayer,
      }),
    ]);
    expect(result.facts.after.document.overlays).toEqual([]);

    expect(await getStoryById(seeded.story.id, USER_ID)).toMatchObject({
      body: { _revision: 1 },
    });
    expect(await getStoryTimeline(seeded.story.id, USER_ID)).toMatchObject({
      version: 2,
      overlays: [],
      visualLayerState: { count: 5, hidden: [3] },
      items: expect.arrayContaining([
        expect.objectContaining({
          stableShotId: "transition-shot",
          timelineStartFrame: 87,
          visualLayer: 4,
          stackOrder: 23,
        }),
      ]),
    });
  });

  it("does not persist normalization when the user planner rejects the command", async () => {
    const seeded = await seedLegacyOverlay();
    const result = await runStoryTimelineCommand(
      {
        storyId: seeded.story.id,
        userId: USER_ID,
        failureMessage: "切割失败",
        legacyOverlay: {
          overlayId: seeded.overlay.id,
          sourceStableShotId: seeded.overlay.sourceStableShotId,
          expectedVideoUrl: seeded.overlay.videoUrl,
        },
      },
      context => {
        expect(context.document.overlays).toEqual([]);
        return { status: "error" as const, message: "切点无效" };
      }
    );

    expect(result).toMatchObject({
      status: "error",
      error: "切点无效",
      errorKind: "invalid",
    });
    expect(await getStoryById(seeded.story.id, USER_ID)).toMatchObject({
      body: { _revision: 0 },
    });
    expect(await getStoryTimeline(seeded.story.id, USER_ID)).toMatchObject({
      version: 1,
      overlays: [seeded.overlay],
    });
  });

  it("rejects an invalid overlay binding without exposing a partial working set", async () => {
    const seeded = await seedLegacyOverlay();
    await updateStoryTimeline({
      storyId: seeded.story.id,
      userId: USER_ID,
      expectedVersion: 1,
      items: [
        {
          ...seeded.item,
          primaryVideoEdit: {
            ...seeded.item.primaryVideoEdit!,
            takeId: seeded.take.id + 100,
          },
        },
      ],
      overlays: [seeded.overlay],
      visualLayerState: { count: 5, hidden: [3] },
    });
    let plannerCalled = false;
    const result = await runStoryTimelineCommand(
      {
        storyId: seeded.story.id,
        userId: USER_ID,
        failureMessage: "编辑失败",
        legacyOverlay: {
          overlayId: seeded.overlay.id,
          sourceStableShotId: seeded.overlay.sourceStableShotId,
          expectedVideoUrl: seeded.overlay.videoUrl,
        },
      },
      () => {
        plannerCalled = true;
        return { status: "error" as const, message: "不应执行" };
      }
    );

    expect(plannerCalled).toBe(false);
    expect(result).toMatchObject({
      status: "error",
      errorKind: "invalid",
      error: expect.stringContaining("绑定"),
    });
    expect(await getStoryTimeline(seeded.story.id, USER_ID)).toMatchObject({
      version: 2,
      overlays: [seeded.overlay],
    });
  });

  it("skips both writes for a true no-op command", async () => {
    const seeded = await seedLegacyOverlay();
    const result = await runStoryTimelineCommand(
      {
        storyId: seeded.story.id,
        userId: USER_ID,
        failureMessage: "编辑失败",
      },
      context => ({
        status: "ok" as const,
        changed: false,
        value: null,
        storyBody: context.storyBody,
        document: context.document,
      })
    );

    expect(result).toMatchObject({
      status: "ok",
      changed: false,
      storyRevision: 0,
      timelineVersion: 1,
    });
    expect(await getStoryById(seeded.story.id, USER_ID)).toMatchObject({
      body: { _revision: 0 },
    });
    expect(await getStoryTimeline(seeded.story.id, USER_ID)).toMatchObject({
      version: 1,
      overlays: [seeded.overlay],
    });
  });

  it.each([
    "Story revision CAS conflict: expected 0, got 1",
    "Timeline version conflict: expected 1, got 2",
  ])("classifies aggregate CAS failures as conflicts: %s", async message => {
    const seeded = await seedLegacyOverlay();
    vi.spyOn(storyVisualPersistence, "saveStoryVisualAggregateCas")
      .mockRejectedValueOnce(new Error(message));

    const result = await runStoryTimelineCommand(
      {
        storyId: seeded.story.id,
        userId: USER_ID,
        failureMessage: "编辑失败",
      },
      context => ({
        status: "ok" as const,
        value: null,
        storyBody: context.storyBody,
        document: {
          ...context.document,
          items: context.document.items.map(item => ({
            ...item,
            timelineStartFrame: (item.timelineStartFrame ?? 0) + 1,
          })),
        },
      })
    );

    expect(result).toMatchObject({
      status: "error",
      error: message,
      errorKind: "conflict",
    });
  });
});
