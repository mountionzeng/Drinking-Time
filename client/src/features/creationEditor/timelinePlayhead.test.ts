import { describe, expect, it } from "vitest";

import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
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
});
