import type { CSSProperties } from "react";

import type { CreationEditorShot } from "./types";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type TimelineTransform,
} from "@shared/storyMaterial";

export type ImageClipEditorTarget = {
  stableShotId: string;
  shotNo: number;
  cueCode?: string | null;
  imageId: number;
  imageUrl: string;
  label: string;
  transform: TimelineTransform;
};

export type ImageClipEditDraft = TimelineTransform;

const clamp = (value: number | undefined, min: number, max: number) =>
  Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? (value as number) : min)
  );

export function normalizeImageClipEditDraft(
  value: TimelineTransform
): TimelineTransform {
  return {
    cropX: clamp(value.cropX, 0, 1),
    cropY: clamp(value.cropY, 0, 1),
    cropWidth: clamp(value.cropWidth, 0.01, 1),
    cropHeight: clamp(value.cropHeight, 0.01, 1),
    zoom: clamp(value.zoom, 0.25, 4),
    panX: clamp(value.panX, -1, 1),
    panY: clamp(value.panY, -1, 1),
    rotationDeg: clamp(value.rotationDeg, -180, 180),
    flipX: Boolean(value.flipX),
    flipY: Boolean(value.flipY),
  };
}

export function imageClipEditorTargetForShot(input: {
  shot: CreationEditorShot;
  stableShotId: string;
  imageId: number;
  imageUrl: string;
  label: string;
}): ImageClipEditorTarget {
  return {
    stableShotId: input.stableShotId,
    shotNo: input.shot.shotNo,
    cueCode: input.shot.cueCode,
    imageId: input.imageId,
    imageUrl: input.imageUrl,
    label: input.label,
    transform: normalizeImageClipEditDraft({
      ...DEFAULT_TIMELINE_TRANSFORM,
      ...(input.shot.timelineItem?.transform ?? {}),
      ...(input.shot.timelineItem?.imageTransforms?.[String(input.imageId)] ?? {}),
    }),
  };
}

export function timelineTransformStyle(
  transform: TimelineTransform | null | undefined
): CSSProperties | undefined {
  if (!transform) return undefined;
  const zoom = clamp(transform.zoom, 0.25, 8);
  const panX = clamp(transform.panX, -1, 1);
  const panY = clamp(transform.panY, -1, 1);
  const rotationDeg = clamp(transform.rotationDeg ?? 0, -180, 180);
  const flipX = transform.flipX ? -1 : 1;
  const flipY = transform.flipY ? -1 : 1;
  return {
    transform: `translate(${panX * 50}%, ${panY * 50}%) rotate(${rotationDeg}deg) scale(${zoom}) scaleX(${flipX}) scaleY(${flipY})`,
    transformOrigin: "center",
  };
}
