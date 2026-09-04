import { describe, expect, it } from "vitest";
import {
  createTimelineViewport,
  DEFAULT_TIMELINE_SCALE,
} from "@shared/timelineViewport";
import type { SubtitleCue } from "@shared/timelineSubtitleModel";
import {
  subtitleCuePlacement,
  subtitleDragGhost,
} from "./SubtitleTrackRow";

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
