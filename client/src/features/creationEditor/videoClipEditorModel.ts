import type { VideoTakeAsset } from "@shared/videoAsset";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "@shared/storyMaterial";
import type { CSSProperties } from "react";

export type VideoClipEditorTarget = {
  stableShotId: string;
  shotNo: number;
  cueCode?: string | null;
  takeId: number;
  rangeId: number | null;
  clipId: string | null;
  videoUrl: string;
  posterUrl?: string | null;
  label: string;
  mediaDurationSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
  isTimelineSelected: boolean;
};

export type VideoClipEditDraft = Pick<
  VideoClipEditorTarget,
  "sourceStartSec" | "sourceEndSec" | "effects" | "transform"
>;

export type VideoClipboardPayload = {
  sourceTakeId: number;
  sourceStableShotId: string;
  sourceShotNo: number;
  sourceCueCode?: string | null;
  label: string;
  videoUrl: string;
  sourceStartSec: number;
  sourceEndSec: number;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function normalizedMotionPreset(
  motionPreset: TimelineVideoEffects["motionPreset"]
): TimelineVideoEffects["motionPreset"] {
  if (!motionPreset || motionPreset.kind !== "heartbeat") return null;
  return {
    kind: "heartbeat",
    bpm: clamp(motionPreset.bpm, 36, 180),
    scaleAmount: clamp(motionPreset.scaleAmount, 0.01, 0.16),
  };
}

/** 供画布预览使用。静态构图留给内部 video 元素，避免 transform 冲突。 */
export function timelineVideoMotionStyle(
  effects: TimelineVideoEffects | null | undefined
): CSSProperties | undefined {
  const motionPreset = normalizedMotionPreset(effects?.motionPreset);
  if (!motionPreset) return undefined;
  const scale = (1 + motionPreset.scaleAmount).toFixed(4);
  const echo = (1 + motionPreset.scaleAmount * 0.42).toFixed(4);
  const second = (1 + motionPreset.scaleAmount * 0.72).toFixed(4);
  return {
    animation: `timeline-heartbeat ${(60 / motionPreset.bpm).toFixed(3)}s ease-in-out infinite`,
    "--timeline-heartbeat-primary-scale": scale,
    "--timeline-heartbeat-echo-scale": echo,
    "--timeline-heartbeat-secondary-scale": second,
  } as CSSProperties;
}

export function normalizeVideoClipEditDraft(
  value: VideoClipEditDraft,
  mediaDurationSec: number
): VideoClipEditDraft {
  const mediaEnd = Math.max(1 / 30, mediaDurationSec);
  const sourceStartSec = clamp(value.sourceStartSec, 0, mediaEnd - 1 / 30);
  const sourceEndSec = clamp(
    value.sourceEndSec,
    sourceStartSec + 1 / 30,
    mediaEnd
  );
  return {
    sourceStartSec,
    sourceEndSec,
    effects: {
      playbackRate: clamp(value.effects.playbackRate, 0.25, 4),
      reverse: Boolean(value.effects.reverse),
      volume: clamp(value.effects.volume, 0, 2),
      muted: Boolean(value.effects.muted),
      motionPreset: normalizedMotionPreset(value.effects.motionPreset),
    },
    transform: {
      cropX: clamp(value.transform.cropX, 0, 1),
      cropY: clamp(value.transform.cropY, 0, 1),
      cropWidth: clamp(value.transform.cropWidth, 0.01, 1),
      cropHeight: clamp(value.transform.cropHeight, 0.01, 1),
      zoom: clamp(value.transform.zoom, 1, 8),
      panX: clamp(value.transform.panX, -1, 1),
      panY: clamp(value.transform.panY, -1, 1),
      rotationDeg: clamp(value.transform.rotationDeg ?? 0, -180, 180),
      flipX: Boolean(value.transform.flipX),
      flipY: Boolean(value.transform.flipY),
    },
  };
}

export function editedTimelineDurationMs(
  draft: Pick<VideoClipEditDraft, "sourceStartSec" | "sourceEndSec" | "effects">
): number {
  return Math.max(
    100,
    Math.round(
      ((draft.sourceEndSec - draft.sourceStartSec) * 1_000) /
        clamp(draft.effects.playbackRate, 0.25, 4)
    )
  );
}

export function videoClipboardPayloadFromTarget(
  target: VideoClipEditorTarget
): VideoClipboardPayload {
  return {
    sourceTakeId: target.takeId,
    sourceStableShotId: target.stableShotId,
    sourceShotNo: target.shotNo,
    sourceCueCode: target.cueCode,
    label: target.label,
    videoUrl: target.videoUrl,
    sourceStartSec: target.sourceStartSec,
    sourceEndSec: target.sourceEndSec,
    effects: { ...target.effects },
    transform: { ...target.transform },
  };
}

export function videoClipboardPlannedDurationSec(
  payload: Pick<
    VideoClipboardPayload,
    "sourceStartSec" | "sourceEndSec" | "effects"
  >
): number {
  return Math.min(30, Math.max(0.1, editedTimelineDurationMs(payload) / 1_000));
}

function inferredEffects(input: {
  sourceStartSec: number;
  sourceEndSec: number;
  timelineDurationMs: number;
  effects?: TimelineVideoEffects;
}): TimelineVideoEffects {
  if (input.effects) return { ...input.effects };
  const sourceDurationSec = Math.max(
    0,
    input.sourceEndSec - input.sourceStartSec
  );
  const timelineDurationSec = Math.max(0.1, input.timelineDurationMs / 1_000);
  return {
    ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
    playbackRate: clamp(sourceDurationSec / timelineDurationSec, 0.25, 4),
  };
}

export function videoClipEditorTargetForTake(input: {
  stableShotId: string;
  shotNo: number;
  cueCode?: string | null;
  label: string;
  take: VideoTakeAsset;
  timelineItem?: StoryTimelineItem | null;
  posterUrl?: string | null;
}): VideoClipEditorTarget | null {
  if (!input.take.videoUrl) return null;
  const selectedRange =
    input.take.selectedSelectionType === "range" &&
    input.take.selectedRangeId != null
      ? input.take.ranges.find(range => range.id === input.take.selectedRangeId)
      : null;
  const edit =
    input.timelineItem?.primaryVideoEdit?.takeId === input.take.id
      ? input.timelineItem.primaryVideoEdit
      : null;
  const sourceStartSec = Math.max(
    0,
    edit?.sourceStartSec ?? selectedRange?.startSec ?? 0
  );
  const mediaDurationSec = Math.max(
    sourceStartSec + 1 / 30,
    input.take.durationSec ?? selectedRange?.endSec ?? sourceStartSec + 3
  );
  const sourceEndSec = clamp(
    edit?.sourceEndSec ?? selectedRange?.endSec ?? mediaDurationSec,
    sourceStartSec + 1 / 30,
    mediaDurationSec
  );
  return {
    stableShotId: input.stableShotId,
    shotNo: input.shotNo,
    cueCode: input.cueCode,
    takeId: input.take.id,
    rangeId: selectedRange?.id ?? null,
    clipId: null,
    videoUrl: input.take.videoUrl,
    posterUrl: input.posterUrl,
    label: input.label,
    mediaDurationSec,
    sourceStartSec,
    sourceEndSec,
    effects: inferredEffects({
      sourceStartSec,
      sourceEndSec,
      timelineDurationMs:
        input.timelineItem?.plannedDurationMs ??
        Math.round((sourceEndSec - sourceStartSec) * 1_000),
      effects: edit?.effects,
    }),
    transform: {
      ...(input.timelineItem?.transform ?? DEFAULT_TIMELINE_TRANSFORM),
    },
    isTimelineSelected: Boolean(input.take.isTimelineSelected),
  };
}

export function videoClipEditorTargetForVisualClip(input: {
  stableShotId: string;
  shotNo: number;
  cueCode?: string | null;
  label: string;
  clip: StoryTimelineVisualClip;
  timelineItem?: StoryTimelineItem | null;
  mediaDurationSec?: number | null;
  posterUrl?: string | null;
}): VideoClipEditorTarget {
  const mediaDurationSec = Math.max(
    input.clip.sourceEndSec,
    input.mediaDurationSec ?? input.clip.sourceEndSec
  );
  return {
    stableShotId: input.stableShotId,
    shotNo: input.shotNo,
    cueCode: input.cueCode,
    takeId: input.clip.takeId,
    rangeId: input.clip.rangeId,
    clipId: input.clip.id,
    videoUrl: input.clip.videoUrl,
    posterUrl: input.posterUrl,
    label: input.label,
    mediaDurationSec,
    sourceStartSec: input.clip.sourceStartSec,
    sourceEndSec: input.clip.sourceEndSec,
    effects: inferredEffects({
      sourceStartSec: input.clip.sourceStartSec,
      sourceEndSec: input.clip.sourceEndSec,
      timelineDurationMs: input.clip.durationMs,
      effects: input.clip.effects,
    }),
    transform: {
      ...(input.clip.transform ??
        input.timelineItem?.transform ??
        DEFAULT_TIMELINE_TRANSFORM),
    },
    isTimelineSelected: true,
  };
}
