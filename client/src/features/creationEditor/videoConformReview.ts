import type {
  VideoCropPath,
  VideoConformMode,
  VideoTargetAspectRatio,
} from "@shared/videoConform";

export type VideoConformReviewMode = Extract<
  VideoConformMode,
  "crop" | "ai_expand"
>;

export type VideoConformRecommendation = {
  mode: VideoConformReviewMode;
  confidence: "high" | "medium" | "review";
  cropAxis: "horizontal" | "vertical" | null;
  reason: string;
};

type RecommendationInput = {
  cameraMove: string | null | undefined;
  sourceAspectRatio: string | null | undefined;
  targetAspectRatio: VideoTargetAspectRatio;
};

type BatchItemSource = {
  takeId: number;
  stableShotId: string;
};

export type VideoExpandAvailability =
  | { supported: true; reason: null }
  | { supported: false; reason: string };

export function videoConformReviewKey(input: {
  takeId: number;
  stableShotId: string;
}): string {
  return `${input.takeId}\u0000${input.stableShotId}`;
}

export function isVideoConformReviewCandidate(input: {
  hasCurrentVideo: boolean;
  videoTakeId: number | null;
}): boolean {
  return input.hasCurrentVideo && input.videoTakeId != null;
}

function ratioValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const compact = value.toLowerCase().replace(/\s+/g, "");
  if (compact === "square") return 1;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(compact);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return width / height;
}

function compactMovement(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
}

export function get302VideoExpandAvailability(input: {
  sourceAspectRatio: string | null | undefined;
  targetAspectRatio: VideoTargetAspectRatio;
}): VideoExpandAvailability {
  const sourceRatio = ratioValue(input.sourceAspectRatio);
  if (sourceRatio == null) return { supported: true, reason: null };
  const squareTolerance = 0.025;
  const supported =
    input.targetAspectRatio === "1:1"
      ? Math.abs(sourceRatio - 1) > squareTolerance
      : input.targetAspectRatio === "16:9"
        ? sourceRatio <= 1 + squareTolerance
        : sourceRatio >= 1 - squareTolerance;
  return supported
    ? { supported: true, reason: null }
    : {
        supported: false,
        reason:
          "当前 302 Runway Expand 只支持横竖屏互转；这个同方向比例请直接裁切。",
      };
}

export function recommendVideoConformMode(
  input: RecommendationInput
): VideoConformRecommendation {
  const sourceRatio = ratioValue(input.sourceAspectRatio);
  const targetRatio = ratioValue(input.targetAspectRatio);
  if (
    sourceRatio != null &&
    targetRatio != null &&
    Math.abs(sourceRatio - targetRatio) < 0.025
  ) {
    return {
      mode: "crop",
      confidence: "high",
      cropAxis: null,
      reason: "当前画幅已经匹配，只需本地规范编码，不需要外扩。",
    };
  }

  const cropAxis =
    sourceRatio == null || targetRatio == null
      ? null
      : sourceRatio > targetRatio
        ? "horizontal"
        : "vertical";
  const movement = compactMovement(input.cameraMove);
  if (!movement) {
    return {
      mode: "crop",
      confidence: "review",
      cropAxis,
      reason: "没有填写运镜；先按免费裁切预选，请播放视频确认主体不会出框。",
    };
  }

  const allEdgeRisk =
    /环绕|orbit|手持|handheld|跟拍|跟随|追踪|tracking|甩镜|whip|拉远|后退|zoomout|pullback|dollyout/;
  const horizontalEdgeRisk =
    /横移|左移|右移|向左|向右|横摇|摇摄|pan|truckleft|truckright|dollyleft|dollyright/;
  const verticalEdgeRisk =
    /上移|下移|抬升|下降|升降|纵移|俯仰|tilt|craneup|cranedown/;
  const crossesCropEdge =
    allEdgeRisk.test(movement) ||
    (cropAxis === "horizontal" && horizontalEdgeRisk.test(movement)) ||
    (cropAxis === "vertical" && verticalEdgeRisk.test(movement));
  if (crossesCropEdge) {
    const expandAvailability = get302VideoExpandAvailability(input);
    if (!expandAvailability.supported) {
      return {
        mode: "crop",
        confidence: "review",
        cropAxis,
        reason: expandAvailability.reason,
      };
    }
    return {
      mode: "ai_expand",
      confidence: "high",
      cropAxis,
      reason:
        cropAxis === "vertical"
          ? "运镜会经过上下裁切边缘，建议用 302 Runway Expand 保留运动空间。"
          : cropAxis === "horizontal"
            ? "运镜会经过左右裁切边缘，建议用 302 Runway Expand 保留运动空间。"
            : "运镜会使用画面边缘，建议播放确认后使用 302 Runway Expand。",
    };
  }

  const centeredOrLocked =
    /固定|静止|锁定|定机位|tripod|static|locked|推近|推进|zoomin|dollyin/;
  if (centeredOrLocked.test(movement)) {
    return {
      mode: "crop",
      confidence: "high",
      cropAxis,
      reason: "运镜以固定机位或中心推进为主，直接裁切通常不会破坏运动。",
    };
  }

  return {
    mode: "crop",
    confidence: "medium",
    cropAxis,
    reason: "运镜没有明显触及裁切边缘，先按免费裁切预选；请播放视频确认。",
  };
}

export function buildVideoConformBatchItems(
  items: readonly BatchItemSource[],
  decisions: ReadonlyMap<string, VideoConformReviewMode>,
  cropPaths: ReadonlyMap<string, VideoCropPath> = new Map()
): Array<{
  takeId: number;
  stableShotId: string;
  mode: VideoConformReviewMode;
  cropPath?: VideoCropPath;
}> {
  return items.flatMap(item => {
    const key = videoConformReviewKey(item);
    const mode = decisions.get(key);
    return mode
      ? [
          {
            takeId: item.takeId,
            stableShotId: item.stableShotId,
            mode,
            ...(mode === "crop" && cropPaths.has(key)
              ? { cropPath: cropPaths.get(key)! }
              : {}),
          },
        ]
      : [];
  });
}

export function summarizeVideoConformResults(
  items: ReadonlyArray<{
    takeId: number;
    stableShotId: string;
    mode: VideoConformReviewMode;
  }>,
  results: ReadonlyArray<
    | {
        status: "ok";
        sourceTakeId: number;
        stableShotId: string;
        videoStatus: string;
      }
    | {
        status: "error";
        sourceTakeId: number;
        stableShotId: string;
        error: string;
      }
  >
) {
  const modeByKey = new Map(
    items.map(item => [videoConformReviewKey(item), item.mode] as const)
  );
  const successfulItems = results.filter(result => result.status === "ok");
  return {
    successfulItems,
    processingCount: successfulItems.filter(
      item => item.videoStatus === "processing"
    ).length,
    cropSuccessCount: successfulItems.filter(
      item =>
        modeByKey.get(
          videoConformReviewKey({
            takeId: item.sourceTakeId,
            stableShotId: item.stableShotId,
          })
        ) === "crop"
    ).length,
    expandSuccessCount: successfulItems.filter(
      item =>
        modeByKey.get(
          videoConformReviewKey({
            takeId: item.sourceTakeId,
            stableShotId: item.stableShotId,
          })
        ) === "ai_expand"
    ).length,
  };
}
