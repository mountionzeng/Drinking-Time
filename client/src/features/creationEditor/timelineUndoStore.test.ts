import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryTimelineItem,
} from "@shared/storyMaterial";
import {
  clearTimelineUndoForTesting,
  executeTimelineUndo,
  recordDeletedStoryShotUndo,
  recordInsertedStoryShotUndo,
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

  it("clones per-image text layers so undo restores the exact saved typography", () => {
    const source = timeline(1_000);
    source[0].imageTextOverlays = {
      "42": {
        text: "午饭刚吃到一半",
        typography: {
          layoutVersion: 1,
          fontId: "noto-serif-sc",
          alignment: "center",
          fontSize: 48,
          letterSpacing: 0,
          lineSpacing: 1.3,
          contrast: {
            textColor: "#ffffff",
            outlineColor: "#000000",
            outlineWidth: 1.5,
            backdropColor: null,
          },
          kind: "region",
          shape: "rectangle",
          direction: "horizontal",
          region: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
        },
      },
    };
    recordTimelineUndoSnapshot(7, source);
    source[0].imageTextOverlays["42"].text = "被后续操作改坏";

    expect(
      takeTimelineUndoSnapshot(7)?.[0].imageTextOverlays?.["42"].text
    ).toBe("午饭刚吃到一半");
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

  it("clones extracted-image and overlay transforms across the undo boundary", () => {
    const source = timeline(1_000);
    source[0].imageClips = [
      {
        id: "still-1",
        imageId: 1,
        imageUrl: "/1.png",
        label: "抽帧",
        offsetFrames: 0,
        durationFrames: 1,
        visualLayer: 1,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      },
    ];
    const overlayTransform = { ...DEFAULT_TIMELINE_TRANSFORM };
    recordTimelineUndoSnapshot(7, source, {
      overlays: [
        {
          id: "overlay-1",
          kind: "generated-video",
          takeId: 9,
          sourceStableShotId: "shot-a",
          videoUrl: "/9.mp4",
          startFrame: 0,
          targetEndFrame: 30,
          mediaEndFrame: 30,
          endFrame: 30,
          stackOrder: 1,
          visualLayer: 1,
          leftImageId: 1,
          rightImageId: 2,
          transform: overlayTransform,
        },
      ],
    });
    source[0].imageClips[0].transform!.panX = 0.75;
    overlayTransform.panY = -0.5;

    const entry = takeCreationEditorUndoEntry(7);
    expect(entry?.kind).toBe("timeline");
    if (entry?.kind !== "timeline") return;
    expect(entry.items[0].imageClips?.[0].transform?.panX).toBe(0);
    expect(entry.overlays?.[0].transform.panY).toBe(0);
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

  it("records external placement as one inserted-shot undo step", () => {
    recordInsertedStoryShotUndo(7, "shot-external");

    expect(takeCreationEditorUndoEntry(7)).toEqual({
      kind: "inserted-story-shot",
      insertedStableShotId: "shot-external",
    });
    expect(takeCreationEditorUndoEntry(7)).toBeNull();
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

describe("图层状态进同一条撤销记录", () => {
  beforeEach(() => clearTimelineUndoForTesting());

  it("一条记录同时带上素材、图层数量、显隐和遗留 overlay", () => {
    recordTimelineUndoSnapshot(1, timeline(2_000), {
      visualLayerState: { count: 3, hidden: [1] },
      overlays: [
        {
          id: "ov-1",
          kind: "generated-video",
          takeId: 9,
          sourceStableShotId: "shot-a",
          videoUrl: "/9.mp4",
          startFrame: 0,
          targetEndFrame: 30,
          mediaEndFrame: 30,
          endFrame: 30,
          stackOrder: 0,
          visualLayer: 2,
          leftImageId: 1,
          rightImageId: 2,
          transform: { ...DEFAULT_TIMELINE_TRANSFORM },
        },
      ],
    });
    const entry = takeCreationEditorUndoEntry(1);
    expect(entry?.kind).toBe("timeline");
    if (entry?.kind !== "timeline") return;
    expect(entry.visualLayerState).toEqual({ count: 3, hidden: [1] });
    expect(entry.overlays?.[0]).toMatchObject({ id: "ov-1", visualLayer: 2 });
  });

  /**
   * 只改显隐时素材一个字节都不变。以前去重只比 items，这一步会被整条丢掉，
   * Cmd+Z 于是跳过隐藏动作、去撤销上一次别的编辑。
   */
  it("素材没变、只有显隐变了，仍然记一条", () => {
    const items = timeline(2_000);
    recordTimelineUndoSnapshot(1, items, {
      visualLayerState: { count: 3, hidden: [] },
    });
    recordTimelineUndoSnapshot(1, items, {
      visualLayerState: { count: 3, hidden: [1] },
    });
    expect(takeCreationEditorUndoEntry(1)).toMatchObject({
      visualLayerState: { count: 3, hidden: [1] },
    });
    expect(takeCreationEditorUndoEntry(1)).toMatchObject({
      visualLayerState: { count: 3, hidden: [] },
    });
  });

  it("素材和图层状态都没变才算重复", () => {
    const items = timeline(2_000);
    recordTimelineUndoSnapshot(1, items, {
      visualLayerState: { count: 3, hidden: [1] },
    });
    recordTimelineUndoSnapshot(1, items, {
      visualLayerState: { count: 3, hidden: [1] },
    });
    expect(takeCreationEditorUndoEntry(1)).not.toBeNull();
    expect(takeCreationEditorUndoEntry(1)).toBeNull();
  });
});
