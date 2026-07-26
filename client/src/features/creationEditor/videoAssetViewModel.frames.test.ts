import { describe, expect, it } from "vitest";

import type { VideoTakeAsset } from "@shared/videoAsset";

import { videoTakeFrameUrl } from "./videoAssetViewModel";

function take(patch: Partial<VideoTakeAsset> = {}): VideoTakeAsset {
  return {
    id: 71,
    storyId: 1165,
    userId: 1,
    stableShotId: "shot-0107",
    sourceImageId: 11,
    promptCompilationId: null,
    promptFreshness: "current",
    status: "available",
    taskId: "task-71",
    provider: "302",
    model: "video-model",
    prompt: "move with purpose",
    subtitle: null,
    durationSec: 6,
    aspectRatio: "1:1",
    videoKey: "take-71.mp4",
    videoUrl: "/video/take-71.mp4",
    errorMessage: null,
    parameterSnapshot: null,
    extractionCapability: "available",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: "full_take",
    isTimelineSelected: false,
    ...patch,
  };
}

describe("videoTakeFrameUrl", () => {
  it("reads first and last frames from the selected take range", () => {
    const ranged = take({
      ranges: [
        {
          id: 9,
          takeId: 71,
          storyId: 1165,
          userId: 1,
          stableShotId: "shot-0107",
          startSec: 1.25,
          endSec: 4.5,
          label: "preferred",
          source: "manual",
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
        },
      ],
      selectedRangeId: 9,
      selectedSelectionType: "range",
    });

    expect(videoTakeFrameUrl(ranged, "start")).toBe(
      "/api/video-frames/71?atSec=1.250&rangeId=9"
    );
    expect(videoTakeFrameUrl(ranged, "end")).toBe(
      "/api/video-frames/71?atSec=4.467&rangeId=9"
    );
  });

  it("does not expose frames before a take is available", () => {
    expect(
      videoTakeFrameUrl(take({ status: "processing", videoUrl: null }), "start")
    ).toBeNull();
  });
});
