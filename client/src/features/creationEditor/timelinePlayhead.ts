export function clampTimelinePlayheadMs(
  timeMs: number,
  totalMs: number
): number {
  const safeTotalMs = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;
  const safeTimeMs = Number.isFinite(timeMs) ? timeMs : 0;
  return Math.min(safeTotalMs, Math.max(0, safeTimeMs));
}

export function timelineMsFromClientX(
  clientX: number,
  timelineLeft: number,
  pixelsPerSecond: number,
  totalMs: number
): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  return clampTimelinePlayheadMs(
    ((clientX - timelineLeft) / pixelsPerSecond) * 1000,
    totalMs
  );
}

export function advanceTimelinePlayhead(
  currentMs: number,
  elapsedMs: number,
  totalMs: number
): { timeMs: number; ended: boolean } {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const timeMs = clampTimelinePlayheadMs(currentMs + safeElapsedMs, totalMs);
  return { timeMs, ended: timeMs >= Math.max(0, totalMs) };
}

export function stepTimelinePlayheadByFrames(
  currentMs: number,
  direction: -1 | 1,
  fps: number,
  totalMs: number,
  frameCount = 1
): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeFrameCount = Number.isFinite(frameCount)
    ? Math.max(1, Math.round(frameCount))
    : 1;
  const currentFrame = Math.round((currentMs / 1000) * safeFps);
  const nextFrame = currentFrame + direction * safeFrameCount;
  return clampTimelinePlayheadMs((nextFrame / safeFps) * 1000, totalMs);
}
