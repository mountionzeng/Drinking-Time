import type { CreationEditorShot } from "./CreationEditorContext";
import { shotDurationMs } from "./playback";
import type { VideoTakeAsset, VideoTakeStatus } from "@shared/videoAsset";

export type VideoTakeAffordance = {
  label: string;
  tone: "neutral" | "positive" | "warning" | "danger";
  canPlay: boolean;
  canRefresh: boolean;
  canUseOnTimeline: boolean;
  canExplainParameters: boolean;
};

export function videoTakeAffordance(
  status: VideoTakeStatus
): VideoTakeAffordance {
  switch (status) {
    case "available":
      return {
        label: "可用",
        tone: "positive",
        canPlay: true,
        canRefresh: false,
        canUseOnTimeline: true,
        canExplainParameters: true,
      };
    case "submitted":
      return {
        label: "已提交",
        tone: "warning",
        canPlay: false,
        canRefresh: true,
        canUseOnTimeline: false,
        canExplainParameters: true,
      };
    case "processing":
      return {
        label: "生成中",
        tone: "warning",
        canPlay: false,
        canRefresh: true,
        canUseOnTimeline: false,
        canExplainParameters: true,
      };
    case "failed":
      return {
        label: "失败",
        tone: "danger",
        canPlay: false,
        canRefresh: false,
        canUseOnTimeline: false,
        canExplainParameters: true,
      };
    case "timeout":
      return {
        label: "超时",
        tone: "danger",
        canPlay: false,
        canRefresh: true,
        canUseOnTimeline: false,
        canExplainParameters: true,
      };
    case "unfollowable":
      return {
        label: "不可追踪",
        tone: "neutral",
        canPlay: false,
        canRefresh: false,
        canUseOnTimeline: false,
        canExplainParameters: true,
      };
  }
}

export function videoTakeDurationMs(
  take: Pick<VideoTakeAsset, "durationSec">
): number | null {
  return typeof take.durationSec === "number" &&
    Number.isFinite(take.durationSec)
    ? Math.max(0, Math.round(take.durationSec * 1000))
    : null;
}

export function selectedVideoSegmentDurationMs(
  take: Pick<
    VideoTakeAsset,
    | "durationSec"
    | "ranges"
    | "selectedRangeId"
    | "selectedSelectionType"
    | "isTimelineSelected"
  >
): number | null {
  if (!take.isTimelineSelected) return null;
  if (take.selectedSelectionType === "range" && take.selectedRangeId != null) {
    const range = take.ranges.find(item => item.id === take.selectedRangeId);
    if (!range) return null;
    return Math.max(0, Math.round((range.endSec - range.startSec) * 1000));
  }
  if (take.selectedSelectionType === "full_take") {
    return videoTakeDurationMs(take);
  }
  return null;
}

export function playableVideoTake<
  T extends Pick<VideoTakeAsset, "status" | "videoUrl">,
>(takes: readonly T[] | undefined): T | undefined {
  if (!takes?.length) return undefined;
  return (
    takes.find(
      take => Boolean(take.videoUrl) && videoTakeAffordance(take.status).canPlay
    ) ?? takes.find(take => Boolean(take.videoUrl))
  );
}

export function videoTakeErrorMessage(message: string): string {
  if (
    message
      .trim()
      .toLowerCase()
      .includes("prompt parameter error or image not approved")
  ) {
    return "MJ 未通过提示词或首帧审核。请简化动作描述，或更换主图后重试。";
  }
  return message;
}

export function shotTimelineDurationMs(shot: CreationEditorShot): number {
  const selectedTake = shot.videoTakes?.find(take => take.isTimelineSelected);
  const selectedDuration = selectedTake
    ? selectedVideoSegmentDurationMs(selectedTake)
    : null;
  if (selectedDuration != null && selectedDuration > 0) return selectedDuration;
  return shotDurationMs({
    shotNo: shot.shotNo,
    dialogue: shot.dialogue,
    beat: shot.beat,
    durationMs: shot.durationMs,
  });
}
