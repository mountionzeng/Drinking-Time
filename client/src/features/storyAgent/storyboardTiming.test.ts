import { describe, expect, it } from "vitest";

import type { StoryTimelineItem } from "@shared/storyMaterial";
import {
  buildStoryboardTimingRows,
  storyboardTimingBoundariesMs,
  storyboardTimingTotalMs,
  storyboardTimingWinnerAt,
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
        startFrame: 0,
        durationFrames: 26,
        stackOrder: 0,
        anchorFrames: [],
      },
      {
        stableShotId: "shot-a",
        shotNo: 1,
        position: 1,
        startMs: 867,
        endMs: 3867,
        durationMs: 3000,
        startFrame: 26,
        durationFrames: 90,
        stackOrder: 1,
        anchorFrames: [],
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

  it("uses absolute frame placement when timeline items are available", () => {
    const rows = buildStoryboardTimingRows(
      [
        { stableShotId: "shot-a", shotNo: 1, durationMs: 1000 },
        { stableShotId: "shot-b", shotNo: 2, durationMs: 1000 },
      ],
      ["shot-a", "shot-b"],
      [timelineItem("shot-a", 0, 0, 30), timelineItem("shot-b", 1, 90, 30)]
    );

    // 90 帧 = 3 秒；中间留下的空档必须真的空着，不能被 ripple 关掉。
    expect(rows.map(row => [row.startMs, row.endMs])).toEqual([
      [0, 1000],
      [3000, 4000],
    ]);
    expect(storyboardTimingTotalMs(rows)).toBe(4000);
    expect(storyboardTimingWinnerAt(rows, 2000)).toBeNull();
    expect(storyboardTimingBoundariesMs(rows)).toEqual([0, 1000, 3000, 4000]);
  });

  it("reports the maximum end as total, not the last shot in story order", () => {
    const rows = buildStoryboardTimingRows(
      [
        { stableShotId: "long", shotNo: 1, durationMs: 4000 },
        { stableShotId: "short", shotNo: 2, durationMs: 300 },
      ],
      ["long", "short"],
      [timelineItem("long", 0, 0, 300), timelineItem("short", 1, 60, 9)]
    );

    expect(storyboardTimingTotalMs(rows)).toBe(10_000);
  });

  it("lets an anchored shot win an overlap over a more recently moved one", () => {
    const rows = buildStoryboardTimingRows(
      [
        { stableShotId: "anchored", shotNo: 1, durationMs: 2000 },
        { stableShotId: "recent", shotNo: 2, durationMs: 2000 },
      ],
      ["anchored", "recent"],
      [
        {
          ...timelineItem("anchored", 0, 0, 60),
          stackOrder: 0,
          anchors: [
            {
              id: "a",
              timelineFrame: 10,
              sourceType: "image",
              sourceId: "image-1",
              sourceTimeSec: null,
            },
          ],
        },
        { ...timelineItem("recent", 1, 0, 60), stackOrder: 99 },
      ]
    );

    expect(storyboardTimingWinnerAt(rows, 500)?.stableShotId).toBe("anchored");
  });
});

function timelineItem(
  stableShotId: string,
  position: number,
  startFrame: number,
  durationFrames: number
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position,
    plannedDurationMs: Math.round((durationFrames * 1000) / 30),
    durationFrames,
    timelineStartFrame: startFrame,
    stackOrder: position,
    transform: {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
  };
}
