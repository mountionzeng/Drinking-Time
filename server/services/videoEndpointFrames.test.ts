import { describe, expect, it } from "vitest";
import {
  transitionVideoFrameTime,
  transitionVideoWindow,
} from "./videoEndpointFrames";

function video(overrides: Record<string, unknown> = {}) {
  return {
    durationSec: 8,
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: "full_take" as const,
    ...overrides,
  };
}

describe("transition video endpoint window", () => {
  it("uses the actual planned playback end instead of the physical file end", () => {
    const window = transitionVideoWindow(video(), {
      plannedDurationMs: 3_000,
    });

    expect(window).toEqual({
      startSec: 0,
      endSec: 3,
      rangeId: null,
      selectionType: "full_take",
    });
    expect(transitionVideoFrameTime(window, "start")).toBe(0);
    expect(transitionVideoFrameTime(window, "end")).toBeCloseTo(2.966667, 5);
  });

  it("respects the selected range and caps it by timeline duration", () => {
    const window = transitionVideoWindow(
      video({
        durationSec: 20,
        ranges: [
          {
            id: 77,
            startSec: 4,
            endSec: 12,
          },
        ],
        selectedRangeId: 77,
        selectedSelectionType: "range",
      }) as Parameters<typeof transitionVideoWindow>[0],
      { plannedDurationMs: 2_500 }
    );

    expect(window).toEqual({
      startSec: 4,
      endSec: 6.5,
      rangeId: 77,
      selectionType: "range",
    });
    expect(transitionVideoFrameTime(window, "start")).toBe(4);
    expect(transitionVideoFrameTime(window, "end")).toBeCloseTo(6.466667, 5);
  });
});
