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
