import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryTimelineItem,
} from "@shared/storyMaterial";
import {
  clearTimelineUndoForTesting,
  executeTimelineUndo,
  recordDeletedStoryShotUndo,
  recordSplitStoryShotUndo,
  recordTimelineUndoSnapshot,
  registerTimelineUndoExecutor,
  shouldHandleCreationEditorUndoShortcut,
  takeCreationEditorUndoEntry,
  takeTimelineUndoSnapshot,
  trackCreationEditorOperation,
  waitForCreationEditorOperations,
} from "./timelineUndoStore";

function timeline(durationMs: number): StoryTimelineItem[] {
  return [
    {
      stableShotId: "shot-a",
      included: true,
      position: 0,
      plannedDurationMs: durationMs,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    },
  ];
}

beforeEach(clearTimelineUndoForTesting);

describe("timelineUndoStore", () => {
  it("returns snapshots in reverse operation order", () => {
    recordTimelineUndoSnapshot(7, timeline(1_000));
    recordTimelineUndoSnapshot(7, timeline(2_000));

    expect(takeTimelineUndoSnapshot(7)?.[0].plannedDurationMs).toBe(2_000);
    expect(takeTimelineUndoSnapshot(7)?.[0].plannedDurationMs).toBe(1_000);
    expect(takeTimelineUndoSnapshot(7)).toBeNull();
  });

  it("clones nested edits so later mutations cannot corrupt undo", () => {
    const source = timeline(1_000);
    recordTimelineUndoSnapshot(7, source);
    source[0].transform.rotationDeg = 180;

    expect(takeTimelineUndoSnapshot(7)?.[0].transform.rotationDeg).toBe(0);
  });

  it("clones anchors so later marker edits cannot corrupt undo", () => {
    const source = timeline(1_000);
    source[0].anchors = [
      {
        id: "anchor-1",
        timelineFrame: 3,
        sourceType: "image",
        sourceId: "image-1",
        sourceTimeSec: null,
      },
    ];
    recordTimelineUndoSnapshot(7, source);
    source[0].anchors![0].timelineFrame = 30;

    expect(takeTimelineUndoSnapshot(7)?.[0].anchors?.[0].timelineFrame).toBe(3);
  });

  it("lets chat call the same registered undo executor as the editor", async () => {
    const unregister = registerTimelineUndoExecutor(7, async () => true);

    await expect(executeTimelineUndo(7)).resolves.toBe("undone");
    unregister();
    await expect(executeTimelineUndo(7)).resolves.toBe("unavailable");
  });

  it("reports an empty history without pretending an edit was reverted", async () => {
    registerTimelineUndoExecutor(7, async () => false);

    await expect(executeTimelineUndo(7)).resolves.toBe("empty");
  });

  it("waits for an in-flight edit to finish recording its undo entry", async () => {
    let finish!: () => void;
    const operation = new Promise<void>(resolve => {
      finish = resolve;
    }).then(() => recordTimelineUndoSnapshot(7, timeline(1_000)));
    trackCreationEditorOperation(7, operation);

    let waitFinished = false;
    const waiting = waitForCreationEditorOperations(7).then(() => {
      waitFinished = true;
    });
    await Promise.resolve();
    expect(waitFinished).toBe(false);

    finish();
    await waiting;
    expect(takeCreationEditorUndoEntry(7)).toMatchObject({
      kind: "timeline",
      items: [{ plannedDurationMs: 1_000 }],
    });
  });

  it("keeps deleted story shots in the same operation-ordered undo history", () => {
    recordTimelineUndoSnapshot(7, timeline(1_000));
    recordDeletedStoryShotUndo(7, {
      deletedShot: {
        shotNo: 2,
        stableShotId: "shot-b",
        shotIdentity: "shot-b",
        dialogue: "完整台词",
      },
      deletedIndex: 1,
      deletedStableShotId: "shot-b",
      expectedRevision: 12,
      afterDeleteBody: {
        _revision: 12,
        shots: [{ shotNo: 1, stableShotId: "shot-a" }],
      },
    });

    expect(takeCreationEditorUndoEntry(7)).toMatchObject({
      kind: "deleted-story-shot",
      deletedIndex: 1,
      deletedStableShotId: "shot-b",
      expectedRevision: 12,
      deletedShot: { dialogue: "完整台词" },
      afterDeleteBody: { _revision: 12 },
    });
    expect(takeCreationEditorUndoEntry(7)).toMatchObject({
      kind: "timeline",
      items: [{ plannedDurationMs: 1_000 }],
    });
  });

  it("clones structural split snapshots in the shared undo history", () => {
    const beforeStoryBody = {
      _revision: 4,
      shots: [{ shotNo: 1, stableShotId: "shot-a" }],
    };
    const beforeTimelineItems = timeline(1_000);
    recordSplitStoryShotUndo(7, {
      splitStableShotId: "split-right",
      beforeStoryBody,
      beforeTimelineItems,
      expectedStoryRevision: 5,
      expectedTimelineVersion: 9,
      restoreShotNo: 1,
    });
    beforeStoryBody.shots[0].stableShotId = "corrupted";
    beforeTimelineItems[0].plannedDurationMs = 9_999;

    expect(takeCreationEditorUndoEntry(7)).toMatchObject({
      kind: "split-story-shot",
      splitStableShotId: "split-right",
      beforeStoryBody: { shots: [{ stableShotId: "shot-a" }] },
      beforeTimelineItems: [{ plannedDurationMs: 1_000 }],
      expectedStoryRevision: 5,
      expectedTimelineVersion: 9,
      restoreShotNo: 1,
    });
  });

  it("recognizes Ctrl+Z and Cmd+Z without stealing editable-field undo", () => {
    const base = {
      key: "z",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      targetIsEditable: false,
      repeat: false,
    };

    expect(
      shouldHandleCreationEditorUndoShortcut({ ...base, ctrlKey: true })
    ).toBe(true);
    expect(
      shouldHandleCreationEditorUndoShortcut({ ...base, metaKey: true })
    ).toBe(true);
    expect(
      shouldHandleCreationEditorUndoShortcut({
        ...base,
        ctrlKey: true,
        targetIsEditable: true,
      })
    ).toBe(false);
    expect(
      shouldHandleCreationEditorUndoShortcut({
        ...base,
        ctrlKey: true,
        shiftKey: true,
      })
    ).toBe(false);
    expect(
      shouldHandleCreationEditorUndoShortcut({
        ...base,
        metaKey: true,
        repeat: true,
      })
    ).toBe(false);
  });
});
