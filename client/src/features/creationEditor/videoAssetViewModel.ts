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

export type VideoTakeProgress = {
  stage: "rendering" | "ready" | "selected" | "failed" | "removed";
  label: string;
};

function takeParameters(
  take: { parameterSnapshot?: VideoTakeAsset["parameterSnapshot"] }
): Record<string, unknown> {
  return take.parameterSnapshot &&
    typeof take.parameterSnapshot === "object" &&
    !Array.isArray(take.parameterSnapshot)
    ? take.parameterSnapshot
    : {};
}

export function mjVideoVariantLabel(
  take: { parameterSnapshot?: VideoTakeAsset["parameterSnapshot"] }
): string | null {
  const value = takeParameters(take).mjVideoVariantLabel;
  return typeof value === "string" && /^V[1-4]$/.test(value) ? value : null;
}

export function isLegacyMjVideoPreview(
  take: Pick<VideoTakeAsset, "status"> &
    Partial<Pick<VideoTakeAsset, "taskId" | "model" | "parameterSnapshot">>
): boolean {
  if (take.status !== "available" || !take.taskId) return false;
  const parameters = takeParameters(take);
  return (
    take.model === "mj-video" &&
    parameters.resultSelectionRule === "first-valid-url"
  );
}

export function videoTakeProgress(
  take: Pick<VideoTakeAsset, "status" | "isTimelineSelected"> &
    Partial<Pick<VideoTakeAsset, "errorMessage">>
): VideoTakeProgress {
  if (take.status === "available") {
    return take.isTimelineSelected
      ? { stage: "selected", label: "已采用" }
      : { stage: "ready", label: "待选择" };
  }
  if (take.status === "submitted") {
    return { stage: "rendering", label: "排队中" };
  }
  if (take.status === "processing") {
    return { stage: "rendering", label: "渲染中" };
  }
  if (take.status === "timeout") {
    return { stage: "failed", label: "生成超时" };
  }
  if (take.status === "failed") {
    if (isUnknownVideoSubmissionError(take.errorMessage)) {
      return { stage: "failed", label: "提交未知" };
    }
    return { stage: "failed", label: "生成失败" };
  }
  if (
    take.status === "unfollowable" &&
    isUnknownVideoSubmissionError(take.errorMessage)
  ) {
    return { stage: "failed", label: "提交未知" };
  }
  return { stage: "removed", label: "已移除" };
}

function isUnknownVideoSubmissionError(
  message: string | null | undefined
): boolean {
  return /付费提交结果未知|video generation timeout|fetch failed|network|aborted|socket|econnreset/i.test(
    message?.trim() ?? ""
  );
}

export function videoTakeIdsToRefresh(
  shots: ReadonlyArray<{
    videoTakes?: ReadonlyArray<
      Pick<VideoTakeAsset, "id" | "status"> &
        Partial<
          Pick<VideoTakeAsset, "taskId" | "model" | "parameterSnapshot">
        >
    >;
  }>,
  recentTakeIds: readonly number[] = []
): number[] {
  const ids = new Set(recentTakeIds);
  for (const shot of shots) {
    for (const take of shot.videoTakes ?? []) {
      if (take.status === "submitted" || take.status === "processing") {
        ids.add(take.id);
      } else if (isLegacyMjVideoPreview(take)) {
        ids.add(take.id);
      }
    }
  }
  return Array.from(ids).sort((left, right) => left - right);
}

export function videoTakeCandidateToAdopt<
  T extends Pick<VideoTakeAsset, "id" | "isTimelineSelected" | "videoUrl">,
>(takes: readonly T[], explicitlySelectedTakeId?: number): T | null {
  const candidates = takes.filter(
    take => !take.isTimelineSelected && Boolean(take.videoUrl)
  );
  const explicitlySelected = candidates.find(
    take => take.id === explicitlySelectedTakeId
  );
  if (explicitlySelected) return explicitlySelected;
  return candidates.length === 1 ? candidates[0] : null;
}

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
        label: "不可用",
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
  return takes.find(
    take => Boolean(take.videoUrl) && videoTakeAffordance(take.status).canPlay
  );
}

export function currentVideoTakeForEditing<
  T extends Pick<
    VideoTakeAsset,
    "id" | "status" | "videoUrl" | "isTimelineSelected"
  >,
>(
  takes: readonly T[] | undefined,
  activeTakeId?: number | null
): T | undefined {
  if (!takes?.length) return undefined;
  const isOperational = (take: T) => {
    const affordance = videoTakeAffordance(take.status);
    return affordance.canPlay || affordance.canRefresh;
  };
  const explicitTake =
    activeTakeId == null
      ? undefined
      : takes.find(take => take.id === activeTakeId);
  if (explicitTake && isOperational(explicitTake)) return explicitTake;
  return (
    takes.find(
      take =>
        take.isTimelineSelected && videoTakeAffordance(take.status).canPlay
    ) ??
    takes.find(take => videoTakeAffordance(take.status).canRefresh) ??
    playableVideoTake(takes)
  );
}

function selectedVideoRange(take: VideoTakeAsset) {
  return take.selectedSelectionType === "range" && take.selectedRangeId != null
    ? (take.ranges.find(range => range.id === take.selectedRangeId) ?? null)
    : null;
}

export function videoTakeFrameUrl(
  take: VideoTakeAsset,
  role: "start" | "end"
): string | null {
  if (take.status !== "available" || !take.videoUrl) return null;
  const range = selectedVideoRange(take);
  const startSec = Math.max(0, range?.startSec ?? 0);
  const sourceEnd = Math.max(
    startSec,
    range?.endSec ?? take.durationSec ?? startSec
  );
  const atSec =
    role === "start" ? startSec : Math.max(startSec, sourceEnd - 1 / 30);
  const rangeQuery = range ? `&rangeId=${range.id}` : "";
  return `/api/video-frames/${take.id}?atSec=${atSec.toFixed(3)}${rangeQuery}`;
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
  const selectedTake = shot.videoTakes?.find(
    take =>
      take.isTimelineSelected &&
      videoTakeAffordance(take.status).canUseOnTimeline
  );
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
