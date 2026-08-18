import { describe, expect, it } from "vitest";
import type { StoryTimelineVisualClip } from "@shared/storyMaterial";
import type { StoryboardTimingRow } from "@/features/storyAgent/storyboardTiming";

import {
  STORYBOARD_EDIT_FRAME_MS,
  storyboardAudioPeaks,
  storyboardEditBlocks,
  storyboardEditEdgeMs,
  storyboardEditMarkedRange,
  storyboardEditMenuItems,
  storyboardEditNeedsRowFocus,
  storyboardEditNeighborShotId,
  storyboardEditNudgedDurationMs,
  storyboardEditPlayheadPct,
  storyboardEditRangePct,
  storyboardEditSegments,
  storyboardEditSelectionRange,
  storyboardEditSelectionSummary,
  storyboardEditSeekMs,
  storyboardEditShortcut,
  storyboardEditShouldFollowSelectionToShot,
  storyboardEditShouldHandleKey,
  storyboardEditTimingAt,
  storyboardEditTrackMs,
  storyboardTrimmedDurationMs,
} from "./storyboardEditRow";

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

describe("storyboard edit track", () => {
  it("samples real audio amplitude into a normalized waveform", () => {
    expect(
      storyboardAudioPeaks(
        new Float32Array([0, 0, 1, -1, 0.5, -0.5, 0, 0]),
        4
      )
    ).toEqual([0, 1, 0.5, 0]);
  });

  it("maps a pointer position to an absolute time on the whole track", () => {
    const input = { rectLeft: 100, rectWidth: 400, totalMs: 8_000 };
    expect(storyboardEditTrackMs({ ...input, clientX: 200 })).toBe(2_000);
    expect(storyboardEditTrackMs({ ...input, clientX: 40 })).toBe(0);
    expect(storyboardEditTrackMs({ ...input, clientX: 999 })).toBe(8_000);
  });

  it("sizes blocks by duration share, so a long shot is a wide block", () => {
    expect(storyboardEditBlocks(timings, 8_000)).toEqual([
      expect.objectContaining({ leftPct: 0, widthPct: 25 }),
      expect.objectContaining({ leftPct: 25, widthPct: 75 }),
    ]);
  });

  it("returns no blocks when the film has no running time yet", () => {
    expect(storyboardEditBlocks(timings, 0)).toEqual([]);
  });

  it("trims by real time: pixels dragged convert straight to milliseconds", () => {
    const base = {
      baseDurationMs: 2_000,
      trackWidthPx: 800,
      totalMs: 8_000,
    };
    expect(storyboardTrimmedDurationMs({ ...base, deltaPx: 100 })).toBe(3_000);
    expect(storyboardTrimmedDurationMs({ ...base, deltaPx: -100 })).toBe(1_000);
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        deltaPx: 100,
        edge: "start",
      })
    ).toBe(1_000);
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        deltaPx: -100,
        edge: "start",
      })
    ).toBe(3_000);
  });

  it("does not let a left trim extend before the timeline starts", () => {
    expect(
      storyboardTrimmedDurationMs({
        baseDurationMs: 2_000,
        trackWidthPx: 800,
        totalMs: 8_000,
        deltaPx: -400,
        edge: "start",
        maxDurationMs: 2_000,
      })
    ).toBe(2_000);
  });

  it("clamps trimming to the storyboard duration bounds", () => {
    const base = { trackWidthPx: 800, totalMs: 8_000 };
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        baseDurationMs: 2_000,
        deltaPx: -400,
      })
    ).toBe(100);
    expect(
      storyboardTrimmedDurationMs({
        ...base,
        baseDurationMs: 8_000,
        deltaPx: 900,
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

  it("treats a micro drag as a click rather than a range", () => {
    expect(storyboardEditSelectionRange(1_000, 1_040)).toBeNull();
    expect(storyboardEditSelectionRange(1_400, 1_000)).toEqual({
      startMs: 1_000,
      endMs: 1_400,
    });
  });

  it("places a selection that spans several shots on the track", () => {
    expect(
      storyboardEditRangePct({ startMs: 1_000, endMs: 5_000 }, 8_000)
    ).toEqual({ leftPct: 12.5, widthPct: 50 });
  });

  it("clips a selection that runs past the end of the film", () => {
    expect(
      storyboardEditRangePct({ startMs: 7_000, endMs: 99_000 }, 8_000)
    ).toEqual({ leftPct: 87.5, widthPct: 12.5 });
  });

  it("places the playhead anywhere on the track, including the very end", () => {
    expect(storyboardEditPlayheadPct(2_000, 8_000)).toBe(25);
    expect(storyboardEditPlayheadPct(8_000, 8_000)).toBe(100);
    expect(storyboardEditPlayheadPct(9_000, 8_000)).toBeNull();
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

  it("nudges duration with comma and period", () => {
    expect(press(",")).toEqual({ kind: "action", action: "trimMinusFrame" });
    expect(press(".")).toEqual({ kind: "action", action: "trimPlusFrame" });
    expect(press("<")).toEqual({ kind: "action", action: "trimMinusHalfSec" });
    expect(press(">")).toEqual({ kind: "action", action: "trimPlusHalfSec" });
  });

  it("leaves other cmd/ctrl chords alone so global undo still works", () => {
    expect(press("z", { metaKey: true })).toBeNull();
    expect(press("s", { metaKey: true })).toBeNull();
    expect(press("q")).toBeNull();
  });
});

describe("storyboard edit navigation", () => {
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

  it("explains why cutting is unavailable rather than failing silently", () => {
    const items = menu({ ...base, canSplitHere: false });
    const split = items.find(item => item.action === "split");
    const extract = items.find(item => item.action === "extract");
    expect(split?.disabledReason).toContain("还没有视频");
    expect(extract?.disabledReason).toContain("还没有视频");
  });

  it("keeps cut and extract live when the click lands on video", () => {
    const items = menu(base);
    expect(
      items.find(item => item.action === "split")?.disabledReason
    ).toBeNull();
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

  it("lets space and enter activate the button they are aimed at", () => {
    expect(gate({ key: " ", isButtonTarget: true })).toBe(false);
    expect(gate({ key: "Enter", isButtonTarget: true })).toBe(false);
    expect(gate({ key: "s", isButtonTarget: true })).toBe(true);
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
