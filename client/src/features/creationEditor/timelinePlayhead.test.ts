import { describe, expect, it } from "vitest";

import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
  stepTimelinePlayheadByFrames,
  timelineMsFromClientX,
} from "./timelinePlayhead";

describe("timeline playhead", () => {
  it("clamps seeks to the timeline bounds", () => {
    expect(clampTimelinePlayheadMs(-250, 10_000)).toBe(0);
    expect(clampTimelinePlayheadMs(4_250, 10_000)).toBe(4_250);
    expect(clampTimelinePlayheadMs(12_000, 10_000)).toBe(10_000);
  });

  it("converts a pointer position into milliseconds", () => {
    expect(timelineMsFromClientX(260, 100, 16, 20_000)).toBe(10_000);
    expect(timelineMsFromClientX(40, 100, 16, 20_000)).toBe(0);
  });

  it("stops playback exactly at the end", () => {
    expect(advanceTimelinePlayhead(9_800, 250, 10_000)).toEqual({
      timeMs: 10_000,
      ended: true,
    });
  });

  it("steps exactly one project frame and stays aligned after repeated keys", () => {
    const first = stepTimelinePlayheadByFrames(0, 1, 30, 10_000);
    const second = stepTimelinePlayheadByFrames(first, 1, 30, 10_000);

    expect(first).toBeCloseTo(33.333, 2);
    expect(second).toBeCloseTo(66.667, 2);
    expect(stepTimelinePlayheadByFrames(second, -1, 30, 10_000)).toBeCloseTo(
      first,
      2
    );
  });

  it("uses the supplied fps and clamps at both timeline ends", () => {
    expect(stepTimelinePlayheadByFrames(1000, 1, 24, 10_000)).toBeCloseTo(
      1041.667,
      2
    );
    expect(stepTimelinePlayheadByFrames(0, -1, 30, 10_000)).toBe(0);
    expect(stepTimelinePlayheadByFrames(9_990, 1, 30, 10_000)).toBe(10_000);
  });
});
