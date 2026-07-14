import { describe, expect, it } from "vitest";

import {
  buildStoryboardTimingRows,
  formatStoryboardSecondsInput,
  formatStoryboardTimestamp,
  storyboardDurationMsFromEndSeconds,
  storyboardDurationMsFromSeconds,
} from "./storyboardTiming";

describe("storyboard timing", () => {
  it("builds cumulative ranges in timeline order", () => {
    const rows = buildStoryboardTimingRows(
      [
        { stableShotId: "shot-a", shotNo: 1, durationMs: 3000 },
        { stableShotId: "shot-b", shotNo: 2, durationMs: 867 },
        { stableShotId: "shot-c", shotNo: 3, durationMs: 2000 },
      ],
      ["shot-b", "shot-a"]
    );

    expect(rows).toEqual([
      {
        stableShotId: "shot-b",
        shotNo: 2,
        position: 0,
        startMs: 0,
        endMs: 867,
        durationMs: 867,
      },
      {
        stableShotId: "shot-a",
        shotNo: 1,
        position: 1,
        startMs: 867,
        endMs: 3867,
        durationMs: 3000,
      },
    ]);
  });

  it("formats millisecond-precise timeline labels", () => {
    expect(formatStoryboardTimestamp(88_468)).toBe("01:28.468");
    expect(formatStoryboardTimestamp(3_661_009)).toBe("1:01:01.009");
    expect(formatStoryboardSecondsInput(4_733)).toBe("4.733");
    expect(formatStoryboardSecondsInput(4_000)).toBe("4");
  });

  it("parses duration and absolute end seconds within editor limits", () => {
    expect(storyboardDurationMsFromSeconds(4.733)).toBe(4733);
    expect(storyboardDurationMsFromEndSeconds(10_000, 14.733)).toBe(4733);
    expect(storyboardDurationMsFromSeconds(0.05)).toBeNull();
    expect(storyboardDurationMsFromSeconds(12.001)).toBeNull();
  });
});
