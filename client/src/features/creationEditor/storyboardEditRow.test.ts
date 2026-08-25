import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryTimelineVisualClip } from "@shared/storyMaterial";
import { createTimelineViewport } from "@shared/timelineViewport";
import type { StoryboardTimingRow } from "@/features/storyAgent/storyboardTiming";

import {
  consumeStoryboardVisualPasteContextMenu,
  STORYBOARD_EDIT_FRAME_MS,
  createStoryboardVisualClipNudgeQueue,
  focusStoryboardClipForDrag,
  isStoryboardClipPointerDrag,
  isStoryboardPointerOwner,
  storyboardAudioPeaks,
  storyboardEditBlocks,
  storyboardEditEdgeMs,
  storyboardEditFilmstripFrameUrls,
  storyboardEditMarkedRange,
  storyboardEditMenuItems,
  storyboardEditNeedsRowFocus,
  storyboardEditNeighborShotId,
  storyboardMagnetThresholdFrames,
  storyboardRollingBoundaryFrame,
  storyboardEditNudgedDurationMs,
  storyboardEditPlayheadPx,
  storyboardEditRangePx,
  storyboardEditSegments,
  storyboardEditSelectionRange,
  storyboardEditSelectionSummary,
  storyboardEditSeekMs,
  storyboardEditShortcut,
  storyboardEditShouldFollowSelectionToShot,
  storyboardEditShouldHandleKey,
  storyboardEditTimingAt,
  storyboardEditTrackMs,
  storyboardGroupDragDeltaFrames,
  storyboardGroupDragDirection,
  storyboardGripDragMode,
  storyboardGroupDragStep,
  storyboardGroupDragSummary,
  storyboardTimelineContentTotalMs,
  storyboardTrimmedBoundaryFrame,
  storyboardTrimmedDurationMs,
  storyboardExtractedFrameTimeMs,
  storyboardVisualClipShotTimingPreview,
  storyboardVisualObjectMenuFocusIndex,
  storyboardVisualObjectShortcutRoute,
  storyboardOwnedClipVisualLayer,
  storyboardOwnedClipNudgeBase,
  storyboardVisualLayerShotIds,
} from "./storyboardEditRow";

afterEach(() => {
  vi.useRealTimers();
});

function visualClip(
  overrides: Partial<StoryTimelineVisualClip> & { id: string }
): StoryTimelineVisualClip {
  return {
    takeId: 1,
    rangeId: 1,
    sourceStableShotId: "sh-01",
    videoUrl: "/v.mp4",
    label: overrides.id,
    sourceStartSec: 0,
    sourceEndSec: 1,
    offsetMs: 0,
    durationMs: 500,
    ...overrides,
  };
}

function timingRow(
  stableShotId: string,
  shotNo: number,
  position: number,
  startMs: number,
  durationMs: number
): StoryboardTimingRow {
  return {
    stableShotId,
    shotNo,
    position,
    startMs,
    endMs: startMs + durationMs,
    durationMs,
  };
}

const timings = [
  timingRow("sh-01", 1, 0, 0, 2_000),
  timingRow("sh-02", 2, 1, 2_000, 6_000),
];

const viewport = (totalMs = 8_000, scale = 40) =>
  createTimelineViewport({ totalMs, scale });

describe("storyboard edit track", () => {
  it("聚焦待拖动剪辑时禁止浏览器自动滚动时间线", () => {
    const focus = vi.fn();

    focusStoryboardClipForDrag({ focus });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("只有超过点击容差的位移才算拖动剪辑", () => {
    expect(
      isStoryboardClipPointerDrag(
        { clientX: 100, clientY: 50 },
        { clientX: 102, clientY: 52 }
      )
    ).toBe(false);
    expect(
      isStoryboardClipPointerDrag(
        { clientX: 100, clientY: 50 },
        { clientX: 104, clientY: 50 }
      )
    ).toBe(true);
    expect(
      isStoryboardClipPointerDrag(
        { clientX: 100, clientY: 50 },
        { clientX: 100, clientY: 54 }
      )
    ).toBe(true);
  });

  it("只接受起手指针继续或结束当前镜头拖动", () => {
    expect(isStoryboardPointerOwner(7, 7)).toBe(true);
    expect(isStoryboardPointerOwner(7, 8)).toBe(false);
  });

  it("时间视口覆盖超出最后镜头的上层素材与音频", () => {
    expect(
      storyboardTimelineContentTotalMs(8_000, {
        totalMs: 9_000,
        audioTotalMs: 10_000,
        audioClips: [{ endMs: 11_000 }],
        overlays: [{ endFrame: 360 }],
      })
    ).toBe(12_000);
  });

  it("把连续方向键合并成一次最终位置写入", async () => {
    vi.useFakeTimers();
    const move = vi.fn(async () => {});
    const queue = createStoryboardVisualClipNudgeQueue({ delayMs: 100 });

    for (let index = 0; index < 4; index += 1) {
      queue.enqueue({
        clipId: "shot:sh-01",
        startVisualLayer: 0,
        deltaVisualLayers: 0,
        startFrame: 30,
        deltaFrames: 1,
        move,
      });
    }

    await vi.advanceTimersByTimeAsync(100);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith({
      clipId: "shot:sh-01",
      visualLayer: 0,
      toStartFrame: 34,
    });
  });

  it("上一次写入未完成时保留新的方向键输入", async () => {
    vi.useFakeTimers();
    let releaseFirst = () => {};
    const firstWrite = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const move = vi
      .fn<(input: { toStartFrame: number }) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined);
    const queue = createStoryboardVisualClipNudgeQueue({ delayMs: 100 });

    queue.enqueue({
      clipId: "image:7",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(100);
    queue.enqueue({
      clipId: "image:7",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(move).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenLastCalledWith({
      clipId: "image:7",
      visualLayer: 0,
      toStartFrame: 12,
    });
  });

  it("连按上下键同样累积图层，不只保留最后一次", async () => {
    vi.useFakeTimers();
    const move = vi.fn(async () => {});
    const queue = createStoryboardVisualClipNudgeQueue({ delayMs: 100 });
    for (let index = 0; index < 3; index += 1) {
      queue.enqueue({
        clipId: "image:7",
        startVisualLayer: 0,
        deltaVisualLayers: 1,
        startFrame: 10,
        deltaFrames: 0,
        move,
      });
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(move).toHaveBeenCalledWith({
      clipId: "image:7",
      visualLayer: 3,
      toStartFrame: 10,
    });
  });

  it("交替操作多个片段不会无限推迟最早的队列项", async () => {
    vi.useFakeTimers();
    const move = vi.fn(async () => {});
    const queue = createStoryboardVisualClipNudgeQueue({ delayMs: 100 });

    queue.enqueue({
      clipId: "image:first",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(80);
    queue.enqueue({
      clipId: "image:second",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 20,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(move).toHaveBeenCalled();
    expect(move).toHaveBeenNthCalledWith(1, {
      clipId: "image:first",
      visualLayer: 0,
      toStartFrame: 11,
    });
  });

  it("写入被拒绝时报错并丢弃失败目标，之后的新输入仍可成功", async () => {
    vi.useFakeTimers();
    const error = new Error("rejected");
    const onError = vi.fn();
    const move = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const queue = createStoryboardVisualClipNudgeQueue({
      delayMs: 100,
      onError,
    });

    queue.enqueue({
      clipId: "image:7",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(onError).toHaveBeenCalledWith(error);
    queue.enqueue({
      clipId: "image:7",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenLastCalledWith({
      clipId: "image:7",
      visualLayer: 0,
      toStartFrame: 11,
    });
  });

  it("首次写入延迟拒绝时保留期间接收的同片段新输入", async () => {
    vi.useFakeTimers();
    let rejectFirst = (_error: Error) => {};
    const firstWrite = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const error = new Error("rejected");
    const onError = vi.fn();
    const move = vi
      .fn<(input: { toStartFrame: number }) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(undefined);
    const queue = createStoryboardVisualClipNudgeQueue({
      delayMs: 100,
      onError,
    });

    queue.enqueue({
      clipId: "image:7",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });
    await vi.advanceTimersByTimeAsync(100);
    queue.enqueue({
      clipId: "image:7",
      startVisualLayer: 0,
      deltaVisualLayers: 0,
      startFrame: 10,
      deltaFrames: 1,
      move,
    });

    rejectFirst(error);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
    expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenLastCalledWith({
      clipId: "image:7",
      visualLayer: 0,
      toStartFrame: 12,
    });
  });

  it("samples real audio amplitude into a normalized waveform", () => {
    expect(
      storyboardAudioPeaks(new Float32Array([0, 0, 1, -1, 0.5, -0.5, 0, 0]), 4)
    ).toEqual([0, 1, 0.5, 0]);
  });

  it("maps a pointer position to an absolute time on the whole track", () => {
    const input = { trackLeft: 100, viewport: viewport() };
    expect(storyboardEditTrackMs({ ...input, clientX: 180 })).toBe(2_000);
    expect(storyboardEditTrackMs({ ...input, clientX: 40 })).toBe(0);
    expect(storyboardEditTrackMs({ ...input, clientX: 999 })).toBe(8_000);
  });

  it("sizes blocks by duration share, so a long shot is a wide block", () => {
    expect(storyboardEditBlocks(timings, viewport())).toEqual([
      expect.objectContaining({ leftPx: 0, widthPx: 80 }),
      expect.objectContaining({ leftPx: 80, widthPx: 240 }),
    ]);
  });

  it("returns no blocks when the film has no running time yet", () => {
    expect(storyboardEditBlocks(timings, viewport(0))).toEqual([]);
  });

  it("trims by real time: pixels dragged convert straight to milliseconds", () => {
    const base = {
      baseDurationMs: 2_000,
      viewport: viewport(),
    };
    expect(storyboardTrimmedDurationMs({ ...base, deltaPx: 40 })).toBe(3_000);
    expect(storyboardTrimmedDurationMs({ ...base, deltaPx: -40 })).toBe(1_000);
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        deltaPx: 40,
        edge: "start",
      })
    ).toBe(1_000);
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        deltaPx: -40,
        edge: "start",
      })
    ).toBe(3_000);
  });

  it("does not let a left trim extend before the timeline starts", () => {
    expect(
      storyboardTrimmedDurationMs({
        baseDurationMs: 2_000,
        viewport: viewport(),
        deltaPx: -160,
        edge: "start",
        maxDurationMs: 2_000,
      })
    ).toBe(2_000);
  });

  it("clamps trimming to the storyboard duration bounds", () => {
    const base = { viewport: viewport() };
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        baseDurationMs: 2_000,
        deltaPx: -160,
      })
    ).toBe(100);
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        baseDurationMs: 8_000,
        deltaPx: 360,
      })
    ).toBe(12_000);
  });

  it("lays the primary band under the visual clips", () => {
    const segments = storyboardEditSegments({
      durationMs: 2_000,
      label: "SH01",
      visualClips: [visualClip({ id: "c1", offsetMs: 500, durationMs: 500 })],
    });
    expect(segments).toEqual([
      expect.objectContaining({ id: "primary", leftPct: 0, widthPct: 100 }),
      expect.objectContaining({ id: "c1", leftPct: 25, widthPct: 25 }),
    ]);
  });

  it("drops the primary band when clips fully replace it", () => {
    const segments = storyboardEditSegments({
      durationMs: 2_000,
      label: "SH01",
      visualClipsReplacePrimary: true,
      visualClips: [visualClip({ id: "c1", offsetMs: 0, durationMs: 2_000 })],
    });
    expect(segments.map(segment => segment.id)).toEqual(["c1"]);
  });

  it("keeps the primary band when replace is set but no clip survives", () => {
    const segments = storyboardEditSegments({
      durationMs: 2_000,
      label: "SH01",
      visualClipsReplacePrimary: true,
      visualClips: [visualClip({ id: "c1", offsetMs: 0, durationMs: 0 })],
    });
    expect(segments.map(segment => segment.id)).toEqual(["primary"]);
  });

  it("samples a long video into at most six filmstrip frames", () => {
    expect(
      storyboardEditFilmstripFrameUrls({
        source: {
          takeId: 77,
          rangeId: 9,
          sourceStartSec: 2,
          sourceEndSec: 10,
        },
        durationMs: 20_000,
      })
    ).toEqual([
      "/api/video-frames/77?atSec=2.667&rangeId=9",
      "/api/video-frames/77?atSec=4.000&rangeId=9",
      "/api/video-frames/77?atSec=5.333&rangeId=9",
      "/api/video-frames/77?atSec=6.667&rangeId=9",
      "/api/video-frames/77?atSec=8.000&rangeId=9",
      "/api/video-frames/77?atSec=9.333&rangeId=9",
    ]);
  });

  it("orders filmstrip frames in the rendered direction for reverse video", () => {
    expect(
      storyboardEditFilmstripFrameUrls({
        source: {
          takeId: 12,
          sourceStartSec: 2,
          sourceEndSec: 5,
          reverse: true,
        },
        durationMs: 3_000,
      })
    ).toEqual([
      "/api/video-frames/12?atSec=4.500",
      "/api/video-frames/12?atSec=3.500",
      "/api/video-frames/12?atSec=2.500",
    ]);
  });

  it("does not request filmstrip frames for an image or empty video range", () => {
    expect(
      storyboardEditFilmstripFrameUrls({ source: null, durationMs: 2_000 })
    ).toEqual([]);
    expect(
      storyboardEditFilmstripFrameUrls({
        source: {
          takeId: 12,
          sourceStartSec: 3,
          sourceEndSec: 3,
        },
        durationMs: 2_000,
      })
    ).toEqual([]);
  });

  it("projects only ordinary video movement into a transient shot timing", () => {
    expect(
      storyboardVisualClipShotTimingPreview({
        kind: "shot",
        stableShotId: "sh-02",
        startFrame: 60,
        durationFrames: 45,
        deltaFrames: -20,
      })
    ).toEqual({
      stableShotId: "sh-02",
      startFrame: 40,
      endFrame: 85,
    });
    expect(storyboardVisualClipShotTimingPreview({ kind: "image" })).toBeNull();
  });

  it("clamps a dragged shot preview at frame zero without changing duration", () => {
    expect(
      storyboardVisualClipShotTimingPreview({
        kind: "shot",
        stableShotId: "sh-01",
        startFrame: 10,
        durationFrames: 60,
        deltaFrames: -30,
      })
    ).toEqual({
      stableShotId: "sh-01",
      startFrame: 0,
      endFrame: 60,
    });
  });

  it("treats a micro drag as a click rather than a range", () => {
    expect(storyboardEditSelectionRange(1_000, 1_040)).toBeNull();
    expect(storyboardEditSelectionRange(1_400, 1_000)).toEqual({
      startMs: 1_000,
      endMs: 1_400,
    });
  });

  it("places a selection that spans several shots on the track", () => {
    expect(
      storyboardEditRangePx({ startMs: 1_000, endMs: 5_000 }, viewport())
    ).toEqual({ leftPx: 40, widthPx: 160 });
  });

  it("clips a selection that runs past the end of the film", () => {
    expect(
      storyboardEditRangePx({ startMs: 7_000, endMs: 99_000 }, viewport())
    ).toEqual({ leftPx: 280, widthPx: 40 });
  });

  it("places the playhead anywhere on the track, including the very end", () => {
    expect(storyboardEditPlayheadPx(2_000, viewport())).toBe(80);
    expect(storyboardEditPlayheadPx(8_000, viewport())).toBe(320);
    expect(storyboardEditPlayheadPx(9_000, viewport())).toBeNull();
  });

  it("finds which shot owns a point in time", () => {
    expect(storyboardEditTimingAt(timings, 0)?.shotNo).toBe(1);
    expect(storyboardEditTimingAt(timings, 2_000)?.shotNo).toBe(2);
    expect(storyboardEditTimingAt(timings, 8_000)?.shotNo).toBe(2);
    expect(storyboardEditTimingAt(timings, 9_000)).toBeNull();
  });

  it("describes a one-shot selection in both film time and shot-local time", () => {
    const summary = storyboardEditSelectionSummary({
      shotLabels: ["SH02"],
      range: { startMs: 4_800, endMs: 5_500 },
      timing: { startMs: 4_000, durationMs: 2_400 },
    });
    expect(summary.selectedText).toBe("SH02 · 00:04.800–00:05.500");
    expect(summary.fullText).toContain("0.80–1.50 秒");
    expect(summary.fullText).toContain("共 0.70 秒");
  });

  it("names every shot a selection crosses instead of pinning it to the first", () => {
    const summary = storyboardEditSelectionSummary({
      shotLabels: ["SH01", "SH02", "SH03"],
      range: { startMs: 2_772, endMs: 6_929 },
      timing: { startMs: 0, durationMs: 3_067 },
    });
    expect(summary.selectedText).toBe("SH01–SH03 · 00:02.772–00:06.929");
    expect(summary.fullText).toContain("跨 3 个镜头");
    expect(summary.fullText).toContain("SH01、SH02、SH03");
    expect(summary.fullText).not.toContain("2.77–6.93 秒");
  });

  it("never lets a shot-local end run past the shot's own duration", () => {
    const summary = storyboardEditSelectionSummary({
      shotLabels: ["SH01"],
      range: { startMs: 500, endMs: 9_000 },
      timing: { startMs: 0, durationMs: 3_067 },
    });
    expect(summary.fullText).toContain("0.50–3.07 秒");
  });
});

describe("storyboard edit shortcuts", () => {
  const press = (
    key: string,
    modifiers: Partial<{
      shiftKey: boolean;
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
    }> = {}
  ) =>
    storyboardEditShortcut({
      key,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...modifiers,
    });

  it("maps the transport keys every editor shares", () => {
    expect(press(" ")).toEqual({ kind: "togglePlay" });
    expect(press("l")).toEqual({ kind: "play" });
    expect(press("k")).toEqual({ kind: "pause" });
    expect(press("j")).toEqual({ kind: "seekBy", deltaMs: -1000 });
    expect(press("Home")).toEqual({ kind: "seekTo", position: "start" });
    expect(press("End")).toEqual({ kind: "seekTo", position: "end" });
  });

  it("steps one frame with the arrows and one second with shift", () => {
    expect(press("ArrowRight")).toEqual({
      kind: "seekBy",
      deltaMs: STORYBOARD_EDIT_FRAME_MS,
    });
    expect(press("ArrowLeft")).toEqual({
      kind: "seekBy",
      deltaMs: -STORYBOARD_EDIT_FRAME_MS,
    });
    expect(press("ArrowRight", { shiftKey: true })).toEqual({
      kind: "seekBy",
      deltaMs: 1000,
    });
  });

  it("jumps between edit points with up and down", () => {
    expect(press("ArrowUp")).toEqual({ kind: "seekEdge", direction: "prev" });
    expect(press("ArrowDown")).toEqual({ kind: "seekEdge", direction: "next" });
  });

  it("marks in and out points, and clears with escape", () => {
    expect(press("i")).toEqual({ kind: "markIn" });
    expect(press("o")).toEqual({ kind: "markOut" });
    expect(press("Escape")).toEqual({ kind: "clearSelection" });
  });

  it("accepts both S and the cmd/ctrl+K that Premiere users reach for", () => {
    expect(press("s")).toEqual({ kind: "action", action: "split" });
    expect(press("k", { metaKey: true })).toEqual({
      kind: "action",
      action: "split",
    });
    expect(press("k", { ctrlKey: true })).toEqual({
      kind: "action",
      action: "split",
    });
  });

  it("reorders with alt+arrows rather than plain arrows", () => {
    expect(press("ArrowLeft", { altKey: true })).toEqual({
      kind: "action",
      action: "moveLeft",
    });
    expect(press("ArrowRight", { altKey: true })).toEqual({
      kind: "action",
      action: "moveRight",
    });
    expect(press("ArrowUp", { altKey: true })).toBeNull();
  });

  it("leaves the removed duration shortcuts unused", () => {
    expect(press(",")).toBeNull();
    expect(press(".")).toBeNull();
    expect(press("<")).toBeNull();
    expect(press(">")).toBeNull();
  });

  it("leaves other cmd/ctrl chords alone so global undo still works", () => {
    expect(press("z", { metaKey: true })).toBeNull();
    expect(press("s", { metaKey: true })).toBeNull();
    expect(press("q")).toBeNull();
  });

  it("routes Story-scoped visual clipboard shortcuts", () => {
    expect(press("c", { metaKey: true })).toEqual({ kind: "copyVisualObject" });
    expect(press("C", { ctrlKey: true })).toEqual({ kind: "copyVisualObject" });
    expect(press("v", { metaKey: true })).toEqual({
      kind: "pasteVisualObject",
    });
    expect(press("V", { ctrlKey: true })).toEqual({
      kind: "pasteVisualObject",
    });
    expect(press("v", { metaKey: true, altKey: true })).toBeNull();
  });
});

describe("visual object shortcut routing", () => {
  const story = {
    type: "story-shot",
    stableShotId: "shot-1",
    shotNo: 1,
  } as const;
  const image = {
    type: "image-clip",
    clipId: "image-1",
    ownerStableShotId: "shot-1",
  } as const;
  const shortcut = (action: "split" | "extract" | "selectShot" | "delete") =>
    ({ kind: "action", action }) as const;

  it("routes selected-object creative and destructive keys through one facade", () => {
    const available = () => true;
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("split"),
        selectedObject: story,
        commandAvailable: available,
      })
    ).toEqual({ kind: "object", command: "split" });
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("extract"),
        selectedObject: story,
        commandAvailable: available,
      })
    ).toEqual({ kind: "object", command: "extract-frame" });
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("selectShot"),
        selectedObject: story,
        commandAvailable: available,
      })
    ).toEqual({ kind: "object", command: "chat" });
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("delete"),
        selectedObject: story,
        commandAvailable: available,
      })
    ).toEqual({ kind: "object", command: "delete" });
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: { kind: "addAnchor" },
        selectedObject: story,
        commandAvailable: available,
      })
    ).toEqual({ kind: "object", command: "set-anchor" });
  });

  it("blocks unsupported or disabled selected-object commands instead of falling back", () => {
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("split"),
        selectedObject: image,
        commandAvailable: () => true,
      })
    ).toEqual({ kind: "blocked" });
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("delete"),
        selectedObject: image,
        commandAvailable: () => false,
      })
    ).toEqual({ kind: "blocked" });
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("delete"),
        selectedObject: story,
        commandAvailable: () => false,
      })
    ).toEqual({ kind: "blocked" });
  });

  it("keeps playhead shot behavior only when no object is selected", () => {
    expect(
      storyboardVisualObjectShortcutRoute({
        shortcut: shortcut("delete"),
        selectedObject: null,
        commandAvailable: () => true,
      })
    ).toEqual({ kind: "legacy" });
  });
});

describe("storyboard edit navigation", () => {
  it("consumes the browser context menu before opening visual paste", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    consumeStoryboardVisualPasteContextMenu(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("keeps the magnet threshold at eight screen pixels across timeline scales", () => {
    expect(
      storyboardMagnetThresholdFrames({ viewport: viewport(10_000, 16) })
    ).toBe(15);
    expect(
      storyboardMagnetThresholdFrames({ viewport: viewport(10_000, 32) })
    ).toBe(8);
  });

  it("computes a rolling boundary from the release coordinate and clamps both shots", () => {
    expect(
      storyboardRollingBoundaryFrame({
        baseBoundaryFrame: 60,
        leftStartFrame: 0,
        rightEndFrame: 120,
        startClientX: 200,
        currentClientX: 220,
        viewport: viewport(4_000, 30),
      })
    ).toBe(80);
    expect(
      storyboardRollingBoundaryFrame({
        baseBoundaryFrame: 60,
        leftStartFrame: 0,
        rightEndFrame: 120,
        startClientX: 200,
        currentClientX: 2_000,
        viewport: viewport(4_000, 30),
      })
    ).toBe(119);
  });

  it("clamps seeking to the running time", () => {
    expect(storyboardEditSeekMs(1_000, -5_000, 8_000)).toBe(0);
    expect(storyboardEditSeekMs(1_000, 99_000, 8_000)).toBe(8_000);
    expect(storyboardEditSeekMs(1_000, 500, 8_000)).toBe(1_500);
  });

  it("jumps to the next and previous cut, including the final end", () => {
    expect(storyboardEditEdgeMs(timings, 0, "next")).toBe(2_000);
    expect(storyboardEditEdgeMs(timings, 2_000, "next")).toBe(8_000);
    expect(storyboardEditEdgeMs(timings, 8_000, "next")).toBeNull();
    expect(storyboardEditEdgeMs(timings, 5_000, "prev")).toBe(2_000);
    expect(storyboardEditEdgeMs(timings, 0, "prev")).toBeNull();
  });

  it("does not re-snap to the cut it is already parked on", () => {
    expect(storyboardEditEdgeMs(timings, 2_000, "prev")).toBe(0);
  });

  it("finds the neighbour to swap with", () => {
    expect(storyboardEditNeighborShotId(timings, "sh-01", "next")).toBe(
      "sh-02"
    );
    expect(storyboardEditNeighborShotId(timings, "sh-01", "prev")).toBeNull();
    expect(storyboardEditNeighborShotId(timings, "sh-02", "next")).toBeNull();
    expect(storyboardEditNeighborShotId(timings, "nope", "next")).toBeNull();
  });

  it("keeps nudged durations inside the storyboard bounds", () => {
    expect(storyboardEditNudgedDurationMs(3_000, 500)).toBe(3_500);
    expect(storyboardEditNudgedDurationMs(200, -5_000)).toBe(100);
  });
});

describe("时间线抽帧标记", () => {
  it("reads the durable millisecond marker written by new extractions", () => {
    expect(
      storyboardExtractedFrameTimeMs(
        "时间线抽帧 · 2893ms · 00:02.893 · 来源 Take 1494"
      )
    ).toBe(2893);
  });

  it("keeps older extracted images visible after upgrading", () => {
    expect(
      storyboardExtractedFrameTimeMs("时间线 01:02.345 提取帧，来源 Take 1494")
    ).toBe(62_345);
    expect(storyboardExtractedFrameTimeMs("普通导入素材")).toBeNull();
  });
});

describe("storyboard edit context menu", () => {
  const menu = (overrides: Parameters<typeof storyboardEditMenuItems>[0]) =>
    storyboardEditMenuItems(overrides);

  const base = {
    shotLabel: "0101",
    canSplitHere: true,
    isFirst: false,
    isLast: false,
    shotCount: 5,
    canInsert: true,
    canDelete: true,
  };

  it("offers detaching only when the click is on a magnetic seam", () => {
    expect(
      menu({ ...base, canDetachMagnet: true }).find(
        item => item.action === "detachMagnet"
      )
    ).toMatchObject({
      label: "取消这两个镜头的吸附",
      disabledReason: null,
    });
    expect(menu(base).some(item => item.action === "detachMagnet")).toBe(false);
  });

  it("explains why cutting is unavailable rather than failing silently", () => {
    const items = menu({ ...base, canSplitHere: false, canExtractHere: false });
    const split = items.find(item => item.action === "split");
    const extract = items.find(item => item.action === "extract");
    expect(split?.disabledReason).toContain("还没有视频");
    expect(extract?.disabledReason).toContain("还没有可提取的图片或视频");
  });

  it("keeps image extraction live while video-only splitting stays disabled", () => {
    const items = menu({ ...base, canSplitHere: false, canExtractHere: true });
    expect(
      items.find(item => item.action === "split")?.disabledReason
    ).toContain("还没有视频");
    expect(
      items.find(item => item.action === "extract")?.disabledReason
    ).toBeNull();
  });

  it("keeps cut and extract live when the click lands on video", () => {
    const items = menu(base);
    expect(
      items.find(item => item.action === "split")?.disabledReason
    ).toBeNull();
    expect(items.find(item => item.action === "extract")?.label).toBe(
      "抽帧（存成画面）"
    );
  });

  it("does not show the low-level duration controls in the context menu", () => {
    expect(menu(base).map(item => item.action)).not.toEqual(
      expect.arrayContaining([
        "trimMinusFrame",
        "trimPlusFrame",
        "trimMinusHalfSec",
        "trimPlusHalfSec",
      ])
    );
  });

  it("greys out the move that would run off the end of the film", () => {
    const first = menu({ ...base, isFirst: true });
    expect(first.find(item => item.action === "moveLeft")?.disabledReason).toBe(
      "已经是第一镜"
    );
    expect(
      first.find(item => item.action === "moveRight")?.disabledReason
    ).toBeNull();

    const last = menu({ ...base, isLast: true });
    expect(last.find(item => item.action === "moveRight")?.disabledReason).toBe(
      "已经是最后一镜"
    );
  });

  it("refuses to delete the last remaining shot", () => {
    const items = menu({ ...base, shotCount: 1, isFirst: true, isLast: true });
    expect(items.find(item => item.action === "delete")?.disabledReason).toBe(
      "至少保留一个镜头"
    );
  });

  it("hides shot add/delete entirely when the board cannot do them", () => {
    const actions = menu({
      ...base,
      canInsert: false,
      canDelete: false,
    }).map(item => item.action);
    expect(actions).not.toContain("insertAfter");
    expect(actions).not.toContain("delete");
    expect(actions).toContain("split");
  });

  it("names the shot in the entries that act on the whole shot", () => {
    const items = menu(base);
    expect(items.find(item => item.action === "selectShot")?.label).toBe(
      "选中 0101 交给聊聊"
    );
    expect(items.find(item => item.action === "delete")?.label).toBe(
      "删掉 0101"
    );
  });

  it("shows the same shortcuts the keyboard actually honours", () => {
    for (const item of menu(base)) {
      expect(item.shortcut.length).toBeGreaterThan(0);
    }
    expect(menu(base).find(item => item.action === "split")?.shortcut).toBe(
      "S"
    );
    expect(menu(base).find(item => item.action === "delete")?.shortcut).toBe(
      "⌫"
    );
  });
});

describe("storyboard edit in/out marking", () => {
  it("needs both points before it becomes a range", () => {
    expect(storyboardEditMarkedRange(1_000, null)).toBeNull();
    expect(storyboardEditMarkedRange(null, 2_000)).toBeNull();
    expect(storyboardEditMarkedRange(2_000, 1_000)).toEqual({
      startMs: 1_000,
      endMs: 2_000,
    });
  });

  it("ignores an out point set on top of the in point", () => {
    expect(storyboardEditMarkedRange(1_000, 1_020)).toBeNull();
  });
});

describe("storyboard edit key routing", () => {
  const gate = (
    overrides: Partial<Parameters<typeof storyboardEditShouldHandleKey>[0]> = {}
  ) =>
    storyboardEditShouldHandleKey({
      key: "ArrowRight",
      defaultPrevented: false,
      isEditableTarget: false,
      isButtonTarget: false,
      rowVisible: true,
      ...overrides,
    });

  it("still fires when focus has moved off the time bar onto a button", () => {
    // 这就是「点了看板上的按钮之后快捷键全失灵」的那个场景。
    expect(gate({ isButtonTarget: true })).toBe(true);
  });

  it("never steals keys from the chat box or any other text field", () => {
    expect(gate({ isEditableTarget: true })).toBe(false);
    expect(gate({ key: " ", isEditableTarget: true })).toBe(false);
  });

  it.each(["select", "combobox", "dialog", "menu", "rename"])(
    "yields Delete to a focused %s surface",
    () => {
      expect(gate({ key: "Delete", isInteractionBoundary: true })).toBe(false);
      expect(gate({ key: "Backspace", isInteractionBoundary: true })).toBe(
        false
      );
    }
  );

  it("lets space and enter activate the button they are aimed at", () => {
    expect(gate({ key: " ", isButtonTarget: true })).toBe(false);
    expect(gate({ key: "Enter", isButtonTarget: true })).toBe(false);
    expect(gate({ key: "s", isButtonTarget: true })).toBe(true);
    expect(gate({ key: "Delete", isButtonTarget: true })).toBe(false);
    expect(gate({ key: "Backspace", isButtonTarget: true })).toBe(false);
  });

  it("yields every shortcut to a focused movable image or video clip", () => {
    expect(gate({ isButtonTarget: true, isVisualClipMoveTarget: true })).toBe(
      false
    );
    expect(
      gate({
        key: "ArrowUp",
        isButtonTarget: true,
        isVisualClipMoveTarget: true,
      })
    ).toBe(false);
    expect(
      gate({ key: "c", isButtonTarget: true, isVisualClipMoveTarget: true })
    ).toBe(true);
    expect(
      gate({
        key: "Delete",
        isButtonTarget: true,
        isVisualClipMoveTarget: true,
      })
    ).toBe(true);
  });

  it("stays out of the way when the edit row is not on screen", () => {
    expect(gate({ rowVisible: false })).toBe(false);
  });

  it("yields to whoever already handled the key", () => {
    expect(gate({ defaultPrevented: true })).toBe(false);
  });

  it("requires row focus only for the actions that change the shot list", () => {
    expect(storyboardEditNeedsRowFocus("delete")).toBe(true);
    expect(storyboardEditNeedsRowFocus("insertAfter")).toBe(true);
    expect(storyboardEditNeedsRowFocus("split")).toBe(false);
    expect(storyboardEditNeedsRowFocus("moveLeft")).toBe(false);
    expect(storyboardEditNeedsRowFocus("trimPlusFrame")).toBe(false);
  });

  it("keeps a timeline range as the active chat selection", () => {
    expect(storyboardEditShouldFollowSelectionToShot("timeline-range")).toBe(
      false
    );
    expect(storyboardEditShouldFollowSelectionToShot("shot")).toBe(true);
    expect(storyboardEditShouldFollowSelectionToShot("storyboard-image")).toBe(
      true
    );
  });
});

describe("visual object menu keyboard interaction", () => {
  it("wraps arrows and supports Home/End", () => {
    expect(
      storyboardVisualObjectMenuFocusIndex({
        key: "ArrowDown",
        currentIndex: 2,
        itemCount: 3,
      })
    ).toBe(0);
    expect(
      storyboardVisualObjectMenuFocusIndex({
        key: "ArrowUp",
        currentIndex: 0,
        itemCount: 3,
      })
    ).toBe(2);
    expect(
      storyboardVisualObjectMenuFocusIndex({
        key: "Home",
        currentIndex: 2,
        itemCount: 3,
      })
    ).toBe(0);
    expect(
      storyboardVisualObjectMenuFocusIndex({
        key: "End",
        currentIndex: 0,
        itemCount: 3,
      })
    ).toBe(2);
  });
});

describe("owned clip track projection", () => {
  it("uses the clip's own persisted visual layer", () => {
    expect(storyboardOwnedClipVisualLayer({ visualLayer: 2 })).toBe(2);
    expect(storyboardOwnedClipVisualLayer({ visualLayer: -3 })).toBe(0);
    expect(storyboardOwnedClipVisualLayer({})).toBe(0);
  });

  it("starts ArrowUp from layer 2 after the clip was moved there", () => {
    expect(
      storyboardOwnedClipNudgeBase({
        ownerStartFrame: 30,
        clip: { id: "owned", offsetMs: 500, visualLayer: 2 },
      })
    ).toEqual({
      clipId: "video:owned",
      startVisualLayer: 2,
      startFrame: 45,
    });
  });
});

describe("方向批量移动手势", () => {
  it("抓手默认只移动一镜，只有按住 Shift 才进入整组模式", () => {
    expect(
      storyboardGripDragMode({
        shiftKey: false,
        singleMoveEnabled: true,
        groupMoveEnabled: true,
      })
    ).toBe("single");
    expect(
      storyboardGripDragMode({
        shiftKey: true,
        singleMoveEnabled: true,
        groupMoveEnabled: true,
      })
    ).toBe("group");
  });

  it("小抖动不算拖动，越过阈值才锁定方向", () => {
    expect(storyboardGroupDragDirection(3)).toBeNull();
    expect(storyboardGroupDragDirection(-3)).toBeNull();
    expect(storyboardGroupDragDirection(-9)).toBe("left");
    expect(storyboardGroupDragDirection(9)).toBe("right");
  });

  it("把像素位移量化成整数帧", () => {
    expect(
      storyboardGroupDragDeltaFrames({
        deltaPx: 100,
        viewport: viewport(8_000, 16),
      })
    ).toBe(188);
    expect(
      storyboardGroupDragDeltaFrames({ deltaPx: 50, viewport: viewport(0) })
    ).toBe(0);
    expect(
      storyboardGroupDragDeltaFrames({
        deltaPx: 100,
        viewport: viewport(8_000, 32),
      })
    ).toBe(94);
  });

  it("一次 pointermove 就能同时锁方向并算出位移", () => {
    // 回归：快速甩动/触摸板轻扫可能只产生一个 pointermove。如果锁定方向的
    // 那一次不算位移，松手时位移永远是 0，整个拖动白做。
    const step = storyboardGroupDragStep({
      lockedDirection: null,
      deltaPx: 50,
      viewport: viewport(8_000, 40),
    });
    expect(step).toEqual({ direction: "right", deltaFrames: 38 });
  });

  it("没越过阈值就还不算拖动", () => {
    expect(
      storyboardGroupDragStep({
        lockedDirection: null,
        deltaPx: 3,
        viewport: viewport(),
      })
    ).toBeNull();
  });

  it("方向锁定之后即使指针划回另一侧也不换方向", () => {
    const step = storyboardGroupDragStep({
      lockedDirection: "right",
      deltaPx: -40,
      viewport: viewport(),
    });
    expect(step).toMatchObject({ direction: "right" });
    expect(step!.deltaFrames).toBeLessThan(0);
  });

  it("拖动说明里点名方向、范围和挡路的锚定镜头", () => {
    expect(
      storyboardGroupDragSummary({
        direction: "left",
        shotLabels: ["0101", "0102", "0103"],
        deltaFrames: -15,
        boundaryLabel: "0100",
      })
    ).toBe(
      "向左整体移动 0101–0103（3 镜） · -0.50s · 到 0100 为止，它有位置锚点"
    );
    expect(
      storyboardGroupDragSummary({
        direction: "right",
        shotLabels: ["0104"],
        deltaFrames: 30,
        boundaryLabel: null,
      })
    ).toBe("向右整体移动 0104 · +1.00s");
  });
});

describe("位置锚点的快捷键与菜单", () => {
  const key = (
    overrides: Partial<Parameters<typeof storyboardEditShortcut>[0]>
  ) =>
    storyboardEditShortcut({
      key: "m",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...overrides,
    });

  it("M 打位置锚点，⌘M 留给系统", () => {
    expect(key({})).toEqual({ kind: "addAnchor" });
    expect(key({ key: "M" })).toEqual({ kind: "addAnchor" });
    expect(key({ metaKey: true })).toBeNull();
  });

  it("焦点在锚点标记上时，删除键不能落到「删掉整个镜头」上", () => {
    // 回归：这条监听挂在捕获阶段，早于锚点自己的 onKeyDown。曾经因此在
    // 锚点上按 Delete 直接删掉了一整个镜头，而且不在时间轴撤销栈里。
    const base = {
      defaultPrevented: false,
      isEditableTarget: false,
      isButtonTarget: true,
      rowVisible: true,
    };
    for (const key of ["Delete", "Backspace"]) {
      expect(
        storyboardEditShouldHandleKey({ ...base, key, isAnchorTarget: true })
      ).toBe(false);
      // 普通按钮同样拥有自己的键盘契约，不能触发破坏性全局删除。
      expect(
        storyboardEditShouldHandleKey({ ...base, key, isAnchorTarget: false })
      ).toBe(false);
    }
  });

  it("没接锚点能力时菜单里不出现打标项", () => {
    const items = storyboardEditMenuItems({
      shotLabel: "0101",
      canSplitHere: true,
      isFirst: true,
      isLast: false,
      shotCount: 2,
      canInsert: false,
      canDelete: false,
    });
    expect(items.map(item => item.action)).not.toContain("addAnchor");
  });

  it("空档和重复打标都给出写明原因的灰项", () => {
    const inGap = storyboardEditMenuItems({
      shotLabel: "0101",
      canSplitHere: true,
      isFirst: true,
      isLast: false,
      shotCount: 2,
      canInsert: false,
      canDelete: false,
      anchors: {
        inGap: true,
        alreadyAnchored: false,
        removableAnchorLabel: null,
      },
    });
    expect(
      inGap.find(item => item.action === "addAnchor")?.disabledReason
    ).toBe("这一刻是空档，没有可标记的画面");
    expect(
      inGap.find(item => item.action === "removeAnchor")?.disabledReason
    ).toBe("这一帧没有位置锚点");

    const duplicate = storyboardEditMenuItems({
      shotLabel: "0101",
      canSplitHere: true,
      isFirst: true,
      isLast: false,
      shotCount: 2,
      canInsert: false,
      canDelete: false,
      anchors: {
        inGap: false,
        alreadyAnchored: true,
        removableAnchorLabel: "00:01.000",
      },
    });
    expect(
      duplicate.find(item => item.action === "addAnchor")?.disabledReason
    ).toBe("这一帧已经有位置锚点");
    expect(
      duplicate.find(item => item.action === "removeAnchor")?.disabledReason
    ).toBeNull();
  });
});

describe("空档与重叠下的时间查询", () => {
  const row = (
    stableShotId: string,
    position: number,
    startFrame: number,
    durationFrames: number,
    extra: Partial<StoryboardTimingRow> = {}
  ): StoryboardTimingRow => ({
    stableShotId,
    shotNo: position + 1,
    position,
    startMs: Math.round((startFrame * 1000) / 30),
    endMs: Math.round(((startFrame + durationFrames) * 1000) / 30),
    durationMs: Math.round((durationFrames * 1000) / 30),
    startFrame,
    durationFrames,
    stackOrder: position,
    anchorFrames: [],
    ...extra,
  });

  it("空档返回 null，不残留上一镜", () => {
    const rows = [row("a", 0, 0, 30), row("b", 1, 90, 30)];
    expect(storyboardEditTimingAt(rows, 500)?.stableShotId).toBe("a");
    expect(storyboardEditTimingAt(rows, 2000)).toBeNull();
    expect(storyboardEditTimingAt(rows, 4000)?.stableShotId).toBe("b");
  });

  it("重叠时锚定镜头压过最近移动过的镜头", () => {
    const rows = [
      row("anchored", 0, 0, 60, { anchorFrames: [10], stackOrder: 0 }),
      row("recent", 1, 0, 60, { stackOrder: 99 }),
    ];
    expect(storyboardEditTimingAt(rows, 500)?.stableShotId).toBe("anchored");
  });

  it("切点导航走遍所有结构边界，包括空档两侧", () => {
    const rows = [row("a", 0, 0, 30), row("b", 1, 90, 30)];
    expect(storyboardEditEdgeMs(rows, 0, "next")).toBe(1000);
    expect(storyboardEditEdgeMs(rows, 1000, "next")).toBe(3000);
    expect(storyboardEditEdgeMs(rows, 3000, "next")).toBe(4000);
    expect(storyboardEditEdgeMs(rows, 4000, "prev")).toBe(3000);
  });
});

describe("裁边换算成锚点安全的绝对帧边界", () => {
  it("裁左边缘时，右端（尾）锚定不动", () => {
    // 60 帧的镜头从第 30 帧开始，把左边缘拖到只剩 1.0 秒（30 帧）：
    // 尾部必须还在第 90 帧，不能跟着挪。
    expect(
      storyboardTrimmedBoundaryFrame({
        startFrame: 30,
        durationFrames: 60,
        edge: "start",
        newDurationMs: 1000,
      })
    ).toBe(60);
  });

  it("裁右边缘时，左端（头）锚定不动", () => {
    expect(
      storyboardTrimmedBoundaryFrame({
        startFrame: 30,
        durationFrames: 60,
        edge: "end",
        newDurationMs: 500,
      })
    ).toBe(45);
  });

  it("时长不足一帧也至少按一帧算，不会把边界算到反面去", () => {
    expect(
      storyboardTrimmedBoundaryFrame({
        startFrame: 0,
        durationFrames: 30,
        edge: "end",
        newDurationMs: 1,
      })
    ).toBe(1);
  });
});

describe("视觉覆盖层", () => {
  it("把镜头放到上层时，主层仍保留完整顺序，上层只显示覆盖副本", () => {
    const stableShotIds = ["shot-a", "shot-b", "shot-c"];
    const assignments = { "shot-b": "overlay-1" };

    expect(
      storyboardVisualLayerShotIds({
        stableShotIds,
        assignments,
        layerId: "main",
        mainLayerId: "main",
      })
    ).toEqual(["shot-a", "shot-b", "shot-c"]);
    expect(
      storyboardVisualLayerShotIds({
        stableShotIds,
        assignments,
        layerId: "overlay-1",
        mainLayerId: "main",
      })
    ).toEqual(["shot-b"]);
  });
});
