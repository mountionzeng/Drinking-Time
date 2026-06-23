import { describe, expect, it } from "vitest";
import {
  selectedVideoSegmentDurationMs,
  videoTakeAffordance,
} from "./videoAssetViewModel";

describe("videoAssetViewModel", () => {
  it("keeps timeline affordances strict by canonical status", () => {
    expect(videoTakeAffordance("available")).toMatchObject({
      canPlay: true,
      canUseOnTimeline: true,
    });
    for (const status of [
      "submitted",
      "processing",
      "failed",
      "timeout",
      "unfollowable",
    ] as const) {
      expect(videoTakeAffordance(status).canUseOnTimeline).toBe(false);
    }
  });

  it("uses explicit range duration only when the timeline selection points at that range", () => {
    expect(
      selectedVideoSegmentDurationMs({
        durationSec: 5,
        isTimelineSelected: true,
        selectedSelectionType: "range",
        selectedRangeId: 7,
        ranges: [
          {
            id: 7,
            takeId: 1,
            storyId: 1,
            userId: 1,
            stableShotId: "shot-1",
            startSec: 1.2,
            endSec: 3.4,
            label: null,
            source: "manual",
            createdAt: "2026-06-22T00:00:00.000Z",
            updatedAt: "2026-06-22T00:00:00.000Z",
          },
        ],
      })
    ).toBe(2200);
  });

  it("uses full take duration only for an explicit full-take timeline selection", () => {
    expect(
      selectedVideoSegmentDurationMs({
        durationSec: 5,
        isTimelineSelected: true,
        selectedSelectionType: "full_take",
        selectedRangeId: null,
        ranges: [],
      })
    ).toBe(5000);
    expect(
      selectedVideoSegmentDurationMs({
        durationSec: 5,
        isTimelineSelected: false,
        selectedSelectionType: null,
        selectedRangeId: null,
        ranges: [],
      })
    ).toBeNull();
  });
});
