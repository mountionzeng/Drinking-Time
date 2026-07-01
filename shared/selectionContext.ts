export type SelectionSourceType =
  | "card"
  | "script-scene"
  | "script-meta"
  | "shot"
  | "storyboard-image"
  | "animatic-video"
  | "timeline-range"
  | "chat";

export type SelectionMaterialStatus =
  | "current-image"
  | "candidate-image"
  | "current-video"
  | "failed-video"
  | "unadopted-video"
  | "stale-video"
  | "timeline-range"
  | "timeline-material"
  | "derivation-draft"
  | "fallback-image"
  | "unknown";

export type SelectionRegion =
  | {
      kind: "text";
      start: number;
      end: number;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "time";
      startSec: number;
      endSec: number;
    };

export type SelectionContext = {
  sourceType: SelectionSourceType;
  sourceId: string;
  selectedText: string;
  fullText: string;
  objectVersion?: string | null;
  selection?: SelectionRegion | null;
  materialStatus?: SelectionMaterialStatus;
  storyId?: number | null;
  stableShotId?: string | null;
  shotNo?: number | null;
  imageId?: number | null;
  videoTakeId?: number | null;
  rangeId?: number | null;
};

export function inferSelectionMaterialStatus(
  context: Pick<
    SelectionContext,
    "sourceType" | "imageId" | "videoTakeId" | "rangeId" | "materialStatus"
  >
): SelectionMaterialStatus {
  if (context.materialStatus) return context.materialStatus;
  if (context.sourceType === "timeline-range" || context.rangeId != null) {
    return "timeline-range";
  }
  if (context.sourceType === "animatic-video" || context.videoTakeId != null) {
    return "current-video";
  }
  if (context.sourceType === "storyboard-image" || context.imageId != null) {
    return "current-image";
  }
  return "unknown";
}
