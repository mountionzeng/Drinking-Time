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

export type ConfirmedImageRegion = {
  /** Server-issued storage key. The server re-checks its user/story/image scope. */
  maskKey: string;
  imageId: number;
  width: number;
  height: number;
  confirmed: true;
  previewMaskUrl?: string | null;
};

export type SelectionEditKind = "text" | "image" | "image-region" | "other";

export type SelectionContext = {
  sourceType: SelectionSourceType;
  sourceId: string;
  selectedText: string;
  fullText: string;
  objectVersion?: string | null;
  /** Fingerprint of the canonical mutable source value captured with the selection. */
  contentFingerprint?: string | null;
  selection?: SelectionRegion | null;
  /** A rectangle is only a gesture/display hint; this makes a region executable. */
  confirmedImageRegion?: ConfirmedImageRegion | null;
  materialStatus?: SelectionMaterialStatus;
  storyId?: number | null;
  stableShotId?: string | null;
  shotNo?: number | null;
  cueCode?: string | null;
  imageId?: number | null;
  videoTakeId?: number | null;
  rangeId?: number | null;
};

const EDITABLE_TEXT_SOURCES = new Set<SelectionSourceType>(["card", "shot"]);

export function selectionContentFingerprint(value: string): string {
  // Deterministic FNV-1a over UTF-16 code units. This is a drift token, not a
  // security primitive; authoritative writes still use server ownership + CAS.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}:${value.length}`;
}

export function selectionEditKind(
  context: SelectionContext
): SelectionEditKind {
  if (context.selection?.kind === "text") return "text";
  if (context.sourceType === "storyboard-image") {
    return context.selection?.kind === "rect" || context.confirmedImageRegion
      ? "image-region"
      : "image";
  }
  return "other";
}

export type SelectionReadiness =
  | { status: "executable"; kind: Exclude<SelectionEditKind, "other"> }
  | { status: "read-only"; kind: SelectionEditKind; reason: string }
  | { status: "invalid" | "stale"; kind: SelectionEditKind; reason: string };

export function selectionReadiness(
  context: SelectionContext,
  activeStoryId: number | null | undefined
): SelectionReadiness {
  const kind = selectionEditKind(context);
  if (context.storyId == null) {
    return { status: "read-only", kind, reason: "选区没有可验证的故事归属" };
  }
  if (activeStoryId == null || context.storyId !== activeStoryId) {
    return { status: "stale", kind, reason: "选区不属于当前故事" };
  }
  if (kind === "text") {
    if (!EDITABLE_TEXT_SOURCES.has(context.sourceType)) {
      return { status: "read-only", kind, reason: "这段文字只能作为引用" };
    }
    const range = context.selection;
    if (
      !range ||
      range.kind !== "text" ||
      range.start < 0 ||
      range.end <= range.start
    ) {
      return { status: "invalid", kind, reason: "文字选区边界无效" };
    }
    if (range.end > context.fullText.length) {
      return { status: "stale", kind, reason: "文字内容已经变化" };
    }
    if (
      context.fullText.slice(range.start, range.end) !== context.selectedText
    ) {
      return { status: "stale", kind, reason: "所选文字已经变化" };
    }
    if (
      context.contentFingerprint !==
      selectionContentFingerprint(context.fullText)
    ) {
      return { status: "stale", kind, reason: "文字版本已经变化" };
    }
    return { status: "executable", kind };
  }
  if (kind === "image" || kind === "image-region") {
    if (
      context.imageId == null ||
      !context.stableShotId ||
      !context.objectVersion
    ) {
      return { status: "invalid", kind, reason: "图片缺少稳定目标身份" };
    }
    if (kind === "image-region") {
      const confirmed = context.confirmedImageRegion;
      if (
        !confirmed ||
        !confirmed.confirmed ||
        confirmed.imageId !== context.imageId ||
        !confirmed.maskKey ||
        !Number.isInteger(confirmed.width) ||
        confirmed.width <= 0 ||
        !Number.isInteger(confirmed.height) ||
        confirmed.height <= 0
      ) {
        return { status: "invalid", kind, reason: "图片局部尚未确认" };
      }
    }
    return { status: "executable", kind };
  }
  return { status: "read-only", kind, reason: "当前选区不支持定向修改" };
}

export function selectionIdentity(context: SelectionContext): string {
  const kind = selectionEditKind(context);
  const region = context.selection ? JSON.stringify(context.selection) : "none";
  return [
    kind,
    context.storyId ?? "none",
    context.sourceType,
    context.sourceId,
    context.stableShotId ?? "none",
    context.imageId ?? "none",
    context.objectVersion ?? "none",
    context.contentFingerprint ?? "none",
    context.confirmedImageRegion?.maskKey ?? "none",
    region,
  ].join("|");
}

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
