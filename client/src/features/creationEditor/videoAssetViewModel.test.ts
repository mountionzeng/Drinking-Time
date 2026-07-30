import { describe, expect, it } from "vitest";
import {
  currentVideoTakeForEditing,
  isLegacyMjVideoPreview,
  mjVideoVariantLabel,
  playableVideoTake,
  selectedVideoSegmentDurationMs,
  shotTimelineDurationMs,
  videoTakeAffordance,
  videoTakeCandidateToAdopt,
  videoTakeErrorMessage,
  videoTakeFailureLabel,
  videoTakeIdsToRefresh,
  videoTakeProgress,
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

  it("describes the user-facing generation and selection stages", () => {
    expect(
      videoTakeProgress({ status: "submitted", isTimelineSelected: false })
    ).toMatchObject({ stage: "rendering", label: "排队中" });
    expect(
      videoTakeProgress({ status: "processing", isTimelineSelected: false })
    ).toMatchObject({ stage: "rendering", label: "渲染中" });
    expect(
      videoTakeProgress({ status: "available", isTimelineSelected: false })
    ).toMatchObject({ stage: "ready", label: "待选择" });
    expect(
      videoTakeProgress({ status: "available", isTimelineSelected: true })
    ).toMatchObject({ stage: "selected", label: "已采用" });
    expect(
      videoTakeProgress({ status: "failed", isTimelineSelected: false })
    ).toMatchObject({ stage: "failed", label: "生成失败" });
    expect(
      videoTakeProgress({
        status: "failed",
        isTimelineSelected: false,
        errorMessage: "video generation timeout",
      })
    ).toMatchObject({ stage: "failed", label: "提交未知" });
    expect(
      videoTakeProgress({
        status: "unfollowable",
        isTimelineSelected: false,
        errorMessage:
          "video generation timeout；付费提交结果未知，为避免重复扣费，请不要直接重试。",
      })
    ).toMatchObject({ stage: "failed", label: "提交未知" });
  });

  it("keeps a just-submitted take under observation before queries catch up", () => {
    expect(
      videoTakeIdsToRefresh(
        [
          {
            videoTakes: [
              { id: 7, status: "processing" },
              { id: 8, status: "available" },
            ],
          },
        ],
        [11]
      )
    ).toEqual([7, 11]);
  });

  it("refreshes legacy MJ contact-sheet takes and labels materialized variants", () => {
    const legacyPreview = {
      id: 18,
      status: "available" as const,
      taskId: "mj-task-four",
      model: "mj-video",
      parameterSnapshot: { resultSelectionRule: "first-valid-url" },
    };
    expect(isLegacyMjVideoPreview(legacyPreview)).toBe(true);
    expect(
      videoTakeIdsToRefresh([{ videoTakes: [legacyPreview] }])
    ).toEqual([18]);
    expect(
      mjVideoVariantLabel({
        parameterSnapshot: { mjVideoVariantLabel: "V3" },
      })
    ).toBe("V3");
  });

  it("requires an explicit choice when a render has multiple video variants", () => {
    const variants = [1, 2, 3, 4].map(id => ({
      id,
      isTimelineSelected: false,
      videoUrl: `/videos/v${id}.mp4`,
    }));
    expect(videoTakeCandidateToAdopt(variants)).toBeNull();
    expect(videoTakeCandidateToAdopt(variants, 3)).toEqual(variants[2]);
    expect(videoTakeCandidateToAdopt([variants[0]])).toEqual(variants[0]);
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

  it("uses concise visible labels for MJ review and execution failures", () => {
    expect(
      videoTakeFailureLabel(
        "302/MJ 未通过视频提示词或首帧审核。请简化动作描述。"
      )
    ).toBe("审核未通过");
    expect(
      videoTakeFailureLabel(
        "[error] Midjourney API execution error, please try again later."
      )
    ).toBe("模型执行失败");
    expect(videoTakeFailureLabel("unknown provider failure")).toBeNull();
  });
});
