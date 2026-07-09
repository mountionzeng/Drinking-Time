import { describe, expect, it } from "vitest";
import {
  currentVideoTakeForEditing,
  playableVideoTake,
  selectedVideoSegmentDurationMs,
  shotTimelineDurationMs,
  videoTakeAffordance,
  videoTakeErrorMessage,
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

  it("prefers a playable video take over a newer failed take for preview", () => {
    const failedTake = {
      id: 2,
      status: "failed" as const,
      videoUrl: null,
    };
    const readyTake = {
      id: 1,
      status: "available" as const,
      videoUrl: "/videos/ready.mp4",
    };

    expect(playableVideoTake([failedTake, readyTake])).toBe(readyTake);
  });

  it("keeps manually unusable takes out of preview even if a stale videoUrl remains", () => {
    expect(
      playableVideoTake([
        {
          id: 3,
          status: "unfollowable" as const,
          videoUrl: "/videos/bad.mp4",
        },
      ])
    ).toBeUndefined();
  });

  it("does not make failed-only video history the current editable take", () => {
    expect(
      currentVideoTakeForEditing([
        {
          id: 17,
          status: "failed" as const,
          videoUrl: null,
          isTimelineSelected: false,
        },
      ])
    ).toBeUndefined();
  });

  it("keeps an older available take current when the newest take failed", () => {
    const failedTake = {
      id: 17,
      status: "failed" as const,
      videoUrl: null,
      isTimelineSelected: false,
    };
    const readyTake = {
      id: 16,
      status: "available" as const,
      videoUrl: "/videos/ready.mp4",
      isTimelineSelected: false,
    };

    expect(currentVideoTakeForEditing([failedTake, readyTake])).toBe(readyTake);
    expect(currentVideoTakeForEditing([failedTake, readyTake], 17)).toBe(
      readyTake
    );
  });

  it("does not keep an unusable selected take as the current editable take", () => {
    const unusableSelected = {
      id: 20,
      status: "unfollowable" as const,
      videoUrl: "/videos/bad.mp4",
      isTimelineSelected: true,
    };
    const readyTake = {
      id: 19,
      status: "available" as const,
      videoUrl: "/videos/ready.mp4",
      isTimelineSelected: false,
    };

    expect(currentVideoTakeForEditing([unusableSelected, readyTake])).toBe(
      readyTake
    );
  });

  it("does not let an unusable selected take define timeline duration", () => {
    expect(
      shotTimelineDurationMs({
        shotNo: 1,
        shotKey: "SH01",
        stableShotId: "shot-1",
        shotIdentity: "shot-1",
        subject: "",
        action: "",
        dialogue: "",
        shotType: "",
        beat: "",
        cameraAngle: "",
        cameraMove: "",
        location: "",
        timeLight: "",
        mood: "",
        sound: "",
        styleRef: "",
        note: "",
        emotion: "",
        sourceCardContent: "",
        durationMs: 3200,
        videoTakes: [
          {
            id: 9,
            storyId: 1,
            userId: 1,
            stableShotId: "shot-1",
            sourceImageId: null,
            promptCompilationId: null,
            promptFreshness: "legacy",
            status: "unfollowable",
            taskId: null,
            provider: "302",
            model: "video-model",
            prompt: "bad",
            subtitle: null,
            durationSec: 12,
            aspectRatio: "16:9",
            videoKey: null,
            videoUrl: "/videos/bad.mp4",
            errorMessage: null,
            parameterSnapshot: null,
            extractionCapability: "unavailable",
            createdAt: "2026-06-22T00:00:00.000Z",
            updatedAt: "2026-06-22T00:00:00.000Z",
            ranges: [],
            selectedRangeId: null,
            selectedSelectionType: "full_take",
            isTimelineSelected: true,
          },
        ],
      })
    ).toBe(3200);
  });

  it("explains the ambiguous MJ approval error in actionable Chinese", () => {
    expect(
      videoTakeErrorMessage("Prompt parameter error or image not approved")
    ).toBe("MJ 未通过提示词或首帧审核。请简化动作描述，或更换主图后重试。");
  });
});
