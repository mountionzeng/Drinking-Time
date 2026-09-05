import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createTimelineViewport,
  DEFAULT_TIMELINE_SCALE,
} from "@shared/timelineViewport";
import type { SubtitleCue } from "@shared/timelineSubtitleModel";
import {
  SubtitleTrackRow,
  shouldSubmitSubtitleBlur,
  subtitleSaveStatus,
  subtitleCuePlacement,
  subtitleDragGhost,
} from "./SubtitleTrackRow";
import { cancelTimelinePointerDrag } from "./timelinePointerDrag";

vi.stubGlobal("React", React);

const viewport = createTimelineViewport({
  totalMs: 10_000,
  scale: DEFAULT_TIMELINE_SCALE,
});

function cue(overrides: Partial<SubtitleCue> = {}): SubtitleCue {
  return {
    id: "cue-a",
    startFrame: 30,
    durationFrames: 60,
    text: "第一句",
    provenance: { kind: "manual" },
    sourceTextRevision: 0,
    textEdited: false,
    timingEdited: false,
    textRevision: 1,
    ...overrides,
  };
}

describe("subtitleCuePlacement", () => {
  it("maps start/duration frames onto the shared viewport and keeps a visible minimum", () => {
    const wide = subtitleCuePlacement(cue(), viewport);
    expect(wide.leftPx).toBeGreaterThan(0);
    expect(wide.widthPx).toBeGreaterThan(0);

    const sliver = subtitleCuePlacement(
      { startFrame: 0, durationFrames: 1 },
      viewport
    );
    expect(sliver.widthPx).toBeGreaterThanOrEqual(2);
  });
});

describe("subtitleDragGhost", () => {
  it("returns the authoritative cue untouched below the drag threshold", () => {
    const base = cue();
    expect(
      subtitleDragGhost(base, {
        kind: "move",
        deltaFrames: 12,
        passedThreshold: false,
      })
    ).toBe(base);
    expect(subtitleDragGhost(base, null)).toBe(base);
  });

  it("moves only the start frame and never below zero", () => {
    expect(
      subtitleDragGhost(cue(), {
        kind: "move",
        deltaFrames: 15,
        passedThreshold: true,
      })
    ).toMatchObject({ startFrame: 45, durationFrames: 60 });
    expect(
      subtitleDragGhost(cue(), {
        kind: "move",
        deltaFrames: -999,
        passedThreshold: true,
      })
    ).toMatchObject({ startFrame: 0, durationFrames: 60 });
  });

  it("trim-start keeps the tail fixed", () => {
    const ghost = subtitleDragGhost(cue(), {
      kind: "trim-start",
      deltaFrames: 20,
      passedThreshold: true,
    });
    expect(ghost.startFrame).toBe(50);
    expect(ghost.startFrame + ghost.durationFrames).toBe(90);
  });

  it("trim-start never eats the last frame", () => {
    const ghost = subtitleDragGhost(cue(), {
      kind: "trim-start",
      deltaFrames: 999,
      passedThreshold: true,
    });
    expect(ghost.durationFrames).toBe(1);
    expect(ghost.startFrame + ghost.durationFrames).toBe(90);
  });

  it("trim-end keeps the head fixed and clamps to one frame", () => {
    expect(
      subtitleDragGhost(cue(), {
        kind: "trim-end",
        deltaFrames: -20,
        passedThreshold: true,
      })
    ).toMatchObject({ startFrame: 30, durationFrames: 40 });
    expect(
      subtitleDragGhost(cue(), {
        kind: "trim-end",
        deltaFrames: -999,
        passedThreshold: true,
      })
    ).toMatchObject({ startFrame: 30, durationFrames: 1 });
  });
});

describe("subtitle interaction guards", () => {
  it("rolls back only the pointer whose gesture was cancelled", () => {
    const drag = { pointerId: 7, deltaFrames: 15 };
    expect(cancelTimelinePointerDrag(drag, 7)).toBeNull();
    expect(cancelTimelinePointerDrag(drag, 8)).toBe(drag);
  });

  it("does not submit blur during IME composition and reports failed saves honestly", () => {
    expect(shouldSubmitSubtitleBlur(true)).toBe(false);
    expect(shouldSubmitSubtitleBlur(false)).toBe(true);
    expect(subtitleSaveStatus(false)).toContain("保存失败");
    expect(subtitleSaveStatus(true)).toBe("字幕已保存");
  });
});

describe("SubtitleTrackRow empty state", () => {
  it("shows a media command error instead of leaving a failed initialization silent", () => {
    const html = renderToStaticMarkup(
      <SubtitleTrackRow
        binding={{
          cues: [],
          selectedCueId: null,
          onSelectCue: () => undefined,
          pending: false,
          error: "故事或时间线不存在，无法编辑字幕",
          candidates: [],
          onGenerateFromText: () => undefined,
          onEditText: () => undefined,
          onMove: () => undefined,
          onTrim: () => undefined,
          onSplit: () => undefined,
          onMerge: () => undefined,
          onDelete: () => undefined,
        }}
        viewport={viewport}
        playheadMs={0}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("故事或时间线不存在，无法编辑字幕");
  });
});
