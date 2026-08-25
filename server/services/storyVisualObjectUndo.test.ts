import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  createVideoTake,
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import { clearVisualEditUndoForTesting, findVisualEditUndo, visualEditUndoDepth } from "./visualEditUndoJournal";
import { activateVisualEditSession, clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import { copyStoryVisualObject, deleteStoryVisualShot, pasteStoryVisualObject, splitStoryVisualShot } from "./storyVisualObjectEditing";
import { undoVisualEditForStory } from "./visualClipEditing";

const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

describe("aggregate visual edit undo", () => {
  beforeEach(async () => {
    await resetMemoryStateForTesting();
    clearVisualEditUndoForTesting();
    clearVisualEditSessionsForTesting();
  });

  it("atomically restores Story and the complete Timeline document", async () => {
    const story = await createStory({
      userId: 1,
      title: "aggregate undo",
      body: {
        shots: [
          { stableShotId: "shot-a", shotNo: 1 },
          { stableShotId: "shot-b", shotNo: 2 },
        ],
      },
    });
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [
        {
          stableShotId: "shot-a",
          included: true,
          position: 0,
          plannedDurationMs: 1000,
          durationFrames: 30,
          timelineStartFrame: 0,
          visualLayer: 0,
          transform,
          imageClips: [{
            id: "image-a",
            imageId: 88,
            imageUrl: "/88.png",
            label: "kept warehouse ref",
            offsetFrames: 0,
            durationFrames: 1,
            visualLayer: 2,
          }],
        },
        {
          stableShotId: "shot-b",
          included: true,
          position: 1,
          plannedDurationMs: 1000,
          durationFrames: 30,
          timelineStartFrame: 30,
          visualLayer: 0,
          transform,
        },
      ],
      overlays: [],
      visualLayerState: { count: 4, hidden: [3] },
    });
    const operation = { editorSessionEpoch: "epoch", operationId: "delete-a" };
    const deleted = await deleteStoryVisualShot({
      storyId: story.id,
      userId: 1,
      operation,
      stableShotId: "shot-a",
    });
    expect(deleted).toMatchObject({
      status: "ok",
      selectedStableShotId: "shot-b",
    });
    const undone = await undoVisualEditForStory({
      storyId: story.id,
      userId: 1,
      operation,
    });
    expect(undone.status).toBe("ok");
    const [restoredStory, restoredTimeline] = await Promise.all([
      getStoryById(story.id, 1),
      getStoryTimeline(story.id, 1),
    ]);
    expect((restoredStory!.body as any).shots.map((shot: any) => shot.stableShotId)).toEqual([
      "shot-a",
      "shot-b",
    ]);
    expect(restoredTimeline!.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stableShotId: "shot-a",
          imageClips: [expect.objectContaining({ id: "image-a" })],
        }),
      ])
    );
    expect(restoredTimeline!.visualLayerState).toEqual({ count: 4, hidden: [3] });
  });

  it("splits owned clips and hosts each independent image exactly once", async () => {
    const story = await createStory({
      userId: 1,
      title: "split identities",
      body: { shots: [{ stableShotId: "shot-a", shotNo: 1 }] },
    });
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 1000,
        durationFrames: 30,
        timelineStartFrame: 0,
        visualLayer: 0,
        transform,
        visualClips: [
          { id: "cross", takeId: 1, rangeId: 1, sourceStableShotId: "shot-a", videoUrl: "/1.mp4", label: "cross", sourceStartSec: 0, sourceEndSec: 1, offsetMs: 333, durationMs: 667, visualLayer: 1 },
          { id: "right", takeId: 2, rangeId: 2, sourceStableShotId: "shot-a", videoUrl: "/2.mp4", label: "right", sourceStartSec: 0, sourceEndSec: 0.2, offsetMs: 667, durationMs: 167, visualLayer: 2 },
        ],
        imageClips: [
          { id: "left-image", imageId: 1, imageUrl: "/1.png", label: "left", offsetFrames: 5, timelineStartFrame: 5, durationFrames: 20, visualLayer: 3 },
          { id: "right-image", imageId: 2, imageUrl: "/2.png", label: "right", offsetFrames: 20, timelineStartFrame: 20, durationFrames: 1, visualLayer: 4 },
        ],
      }],
    });
    const operation = { editorSessionEpoch: "epoch", operationId: "split-a" };
    const split = await splitStoryVisualShot({ storyId: story.id, userId: 1, operation, stableShotId: "shot-a", cutFrame: 15 });
    expect(split.status).toBe("ok");
    if (split.status !== "ok") return;
    const timeline = await getStoryTimeline(story.id, 1);
    const [left, right] = timeline!.items as any[];
    expect(left.visualClips.map((clip: any) => clip.id)).toContain("cross");
    expect(right.visualClips).toHaveLength(2);
    expect(right.visualClips.every((clip: any) => clip.sourceStableShotId === split.rightStableShotId)).toBe(true);
    expect(new Set([...left.visualClips, ...right.visualClips].map((clip: any) => clip.id)).size).toBe(3);
    expect([...left.imageClips, ...right.imageClips].map((clip: any) => clip.id).sort()).toEqual(["left-image", "right-image"]);
    expect(left.imageClips[0]).toMatchObject({ id: "left-image", timelineStartFrame: 5, offsetFrames: 5, durationFrames: 20 });
    expect(right.imageClips[0]).toMatchObject({ id: "right-image", timelineStartFrame: 20, offsetFrames: 5 });
    const replay = await splitStoryVisualShot({ storyId: story.id, userId: 1, operation, stableShotId: "shot-a", cutFrame: 15 });
    expect(replay).toMatchObject({ status: "ok", rightStableShotId: split.rightStableShotId });
    expect((await getStoryTimeline(story.id, 1))!.items).toHaveLength(2);
    await undoVisualEditForStory({ storyId: story.id, userId: 1, operation });
    const restored = await getStoryTimeline(story.id, 1);
    expect(restored!.items).toHaveLength(1);
    expect((restored!.items as any[])[0].imageClips).toHaveLength(2);
  });

  it("replays a successful paste after its clipboard entry is evicted", async () => {
    const story = await createStory({
      userId: 1,
      title: "paste replay",
      body: { shots: [{ stableShotId: "shot-a", shotNo: 1, subject: "copy" }] },
    });
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-a", included: true, position: 0, plannedDurationMs: 1000, durationFrames: 30, timelineStartFrame: 0, visualLayer: 2, transform }],
    });
    await copyStoryVisualObject({ storyId: story.id, userId: 1, editorSessionEpoch: "epoch", clipboardId: "original", object: { type: "story-shot", stableShotId: "shot-a" } });
    const operation = { editorSessionEpoch: "epoch", operationId: "paste-a" };
    const first = await pasteStoryVisualObject({ storyId: story.id, userId: 1, operation, clipboardId: "original", targetFrame: 30, targetLayer: 4 });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    for (let index = 0; index < 13; index += 1)
      await copyStoryVisualObject({ storyId: story.id, userId: 1, editorSessionEpoch: "epoch", clipboardId: `new-${index}`, object: { type: "story-shot", stableShotId: "shot-a" } });
    const replay = await pasteStoryVisualObject({ storyId: story.id, userId: 1, operation, clipboardId: "original", targetFrame: 30, targetLayer: 4 });
    expect(replay).toMatchObject({ status: "ok", stableShotId: first.stableShotId });
    expect((await getStoryTimeline(story.id, 1))!.items).toHaveLength(2);
  });

  it("copies a legacy overlay as a canonical read-only snapshot", async () => {
    const story = await createStory({ userId: 1, title: "legacy copy", body: { shots: [{ stableShotId: "shot-a", shotNo: 1 }] } });
    const take = await createVideoTake({ storyId: story.id, userId: 1, stableShotId: "shot-a", status: "available", model: "test", prompt: "test", durationSec: 1, videoUrl: "/overlay.mp4" });
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-a", included: true, position: 0, plannedDurationMs: 1000, durationFrames: 30, timelineStartFrame: 0, visualLayer: 0, transform, primaryVideoEdit: { takeId: take.id, sourceStartSec: 0, sourceEndSec: 1, effects: { playbackRate: 1, reverse: false, volume: 1, muted: false } } }],
      overlays: [{ id: "overlay-a", kind: "generated-video", takeId: take.id, sourceStableShotId: "shot-a", videoUrl: "/overlay.mp4", startFrame: 20, targetEndFrame: 50, mediaEndFrame: 50, endFrame: 50, stackOrder: 4, leftImageId: 1, rightImageId: 2, transform: { ...transform, zoom: 1.5 } }],
    });
    const beforeStory = await getStoryById(story.id, 1);
    const beforeTimeline = await getStoryTimeline(story.id, 1);
    const copied = await copyStoryVisualObject({ storyId: story.id, userId: 1, editorSessionEpoch: "copy", clipboardId: "copy", object: { type: "story-shot", stableShotId: "shot-a" } });
    expect(copied).toMatchObject({ status: "ok", snapshot: { kind: "story-shot", sourceLayer: 1, timeline: { durationFrames: 30, transform: { zoom: 1.5 } } } });
    expect((await getStoryById(story.id, 1))!.body).toEqual(beforeStory!.body);
    expect((await getStoryTimeline(story.id, 1))!.version).toBe(beforeTimeline!.version);
    expect(visualEditUndoDepth({ storyId: story.id, userId: 1, editorSessionEpoch: "copy" })).toBe(0);
  });

  it("retires only the replaced client epoch and invalidates its clipboard", async () => {
    const story = await createStory({ userId: 1, title: "session lifecycle", body: { shots: [{ stableShotId: "shot-a", shotNo: 1 }, { stableShotId: "shot-b", shotNo: 2 }, { stableShotId: "shot-c", shotNo: 3 }] } });
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: ["shot-a", "shot-b", "shot-c"].map((stableShotId, position) => ({ stableShotId, included: true, position, plannedDurationMs: 1000, durationFrames: 30, timelineStartFrame: position * 30, visualLayer: 0, transform })),
    });
    expect(activateVisualEditSession({ storyId: story.id, userId: 1, editorClientId: "tab-a", editorSessionEpoch: "epoch-a", activationSequence: 1 }).status).toBe("ok");
    expect(activateVisualEditSession({ storyId: story.id, userId: 1, editorClientId: "tab-b", editorSessionEpoch: "epoch-c", activationSequence: 1 }).status).toBe("ok");
    await copyStoryVisualObject({ storyId: story.id, userId: 1, editorSessionEpoch: "epoch-a", clipboardId: "old-copy", object: { type: "story-shot", stableShotId: "shot-a" } });
    const operationA = { editorSessionEpoch: "epoch-a", operationId: "delete-a" };
    expect((await deleteStoryVisualShot({ storyId: story.id, userId: 1, operation: operationA, stableShotId: "shot-a" })).status).toBe("ok");
    expect(activateVisualEditSession({ storyId: story.id, userId: 1, editorClientId: "tab-a", editorSessionEpoch: "epoch-b", activationSequence: 2 })).toMatchObject({ status: "ok", replacedEpoch: "epoch-a" });
    await expect(undoVisualEditForStory({ storyId: story.id, userId: 1, operation: operationA })).resolves.toMatchObject({ status: "error", errorKind: "invalid" });
    expect(findVisualEditUndo({ storyId: story.id, userId: 1, operation: operationA })?.status).toBe("available");
    await expect(pasteStoryVisualObject({ storyId: story.id, userId: 1, operation: { editorSessionEpoch: "epoch-a", operationId: "paste-old" }, clipboardId: "old-copy", targetFrame: 0, targetLayer: 0 })).resolves.toMatchObject({ status: "error", errorKind: "invalid" });
    await expect(copyStoryVisualObject({ storyId: story.id, userId: 1, editorSessionEpoch: "epoch-a", clipboardId: "copy-again", object: { type: "story-shot", stableShotId: "shot-b" } })).resolves.toMatchObject({ status: "error" });

    const operationC = { editorSessionEpoch: "epoch-c", operationId: "delete-c" };
    expect((await deleteStoryVisualShot({ storyId: story.id, userId: 1, operation: operationC, stableShotId: "shot-c" })).status).toBe("ok");
    await expect(undoVisualEditForStory({ storyId: story.id, userId: 1, operation: operationC })).resolves.toMatchObject({ status: "ok" });
  });
});
