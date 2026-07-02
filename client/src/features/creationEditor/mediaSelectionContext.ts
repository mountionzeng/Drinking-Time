import type { SelectionContext } from "@shared/selectionContext";

type SelectionShot = {
  shotNo: number;
  shotKey?: string | null;
  stableShotId?: string | null;
  shotIdentity?: string | null;
  subject?: string | null;
  action?: string | null;
  dialogue?: string | null;
};

type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

function normalizedRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    width: Math.max(0.001, Math.min(1 - x, clamp01(rect.width))),
    height: Math.max(0.001, Math.min(1 - y, clamp01(rect.height))),
  };
}

function stableShotId(shot: SelectionShot): string | null {
  return shot.stableShotId?.trim() || shot.shotIdentity?.trim() || null;
}

function shotLabel(shot: SelectionShot): string {
  return shot.shotKey?.trim() || `SH${String(shot.shotNo).padStart(2, "0")}`;
}

function shotContext(shot: SelectionShot): string {
  return [shot.subject, shot.action, shot.dialogue]
    .map(value => value?.trim())
    .filter(Boolean)
    .join("；");
}

export function buildImageRegionSelection(input: {
  storyId: number;
  shot: SelectionShot;
  imageId?: number | null;
  imageUrl?: string | null;
  rect: NormalizedRect;
}): SelectionContext {
  const rect = normalizedRect(input.rect);
  const label = shotLabel(input.shot);
  const shotId = stableShotId(input.shot);
  const imageId = input.imageId ?? null;
  return {
    sourceType: "storyboard-image",
    sourceId: imageId != null ? String(imageId) : `${shotId ?? label}:current-frame`,
    selectedText: `${label} 画面区域 x ${Math.round(rect.x * 100)}%，y ${Math.round(rect.y * 100)}%，宽 ${Math.round(rect.width * 100)}%，高 ${Math.round(rect.height * 100)}%`,
    fullText: shotContext(input.shot) || `${label} 当前主图`,
    objectVersion: imageId != null ? `image:${imageId}` : "image:current-frame",
    selection: { kind: "rect", ...rect },
    materialStatus: "current-image",
    storyId: input.storyId,
    stableShotId: shotId,
    shotNo: input.shot.shotNo,
    imageId,
  };
}

export function buildVideoRangeSelection(input: {
  storyId: number;
  shot: SelectionShot;
  takeId: number;
  rangeId?: number | null;
  startSec: number;
  endSec: number;
  durationSec: number;
}): SelectionContext {
  const durationSec = Math.max(0.1, finite(input.durationSec, 0.1));
  const startSec = Math.max(
    0,
    Math.min(durationSec - 0.1, finite(input.startSec, 0)),
  );
  const endSec = Math.max(
    startSec + 0.1,
    Math.min(durationSec, finite(input.endSec, durationSec)),
  );
  const normalizedStart = Number(startSec.toFixed(2));
  const normalizedEnd = Number(endSec.toFixed(2));
  const label = shotLabel(input.shot);
  return {
    sourceType: "timeline-range",
    sourceId:
      input.rangeId != null
        ? String(input.rangeId)
        : `take:${input.takeId}:${normalizedStart}-${normalizedEnd}`,
    selectedText: `${label} 视频 ${normalizedStart.toFixed(1)}-${normalizedEnd.toFixed(1)}s`,
    fullText: shotContext(input.shot) || `${label} 当前视频`,
    objectVersion: `video:${input.takeId}`,
    selection: {
      kind: "time",
      startSec: normalizedStart,
      endSec: normalizedEnd,
    },
    materialStatus: "timeline-range",
    storyId: input.storyId,
    stableShotId: stableShotId(input.shot),
    shotNo: input.shot.shotNo,
    videoTakeId: input.takeId,
    rangeId: input.rangeId ?? null,
  };
}

export function buildVideoFrameRegionSelection(input: {
  storyId: number;
  shot: SelectionShot;
  takeId: number;
  timeSec: number;
  rect: NormalizedRect;
}): SelectionContext {
  const rect = normalizedRect(input.rect);
  const timeSec = Number(Math.max(0, finite(input.timeSec, 0)).toFixed(2));
  const label = shotLabel(input.shot);
  return {
    sourceType: "animatic-video",
    sourceId: String(input.takeId),
    selectedText: `${label} 视频 ${timeSec.toFixed(2)}s 画面区域 x ${Math.round(rect.x * 100)}%，y ${Math.round(rect.y * 100)}%，宽 ${Math.round(rect.width * 100)}%，高 ${Math.round(rect.height * 100)}%`,
    fullText: shotContext(input.shot) || `${label} 当前视频`,
    objectVersion: `video:${input.takeId}`,
    selection: { kind: "rect", ...rect },
    materialStatus: "current-video",
    storyId: input.storyId,
    stableShotId: stableShotId(input.shot),
    shotNo: input.shot.shotNo,
    videoTakeId: input.takeId,
  };
}
