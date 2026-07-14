import { normalizeShotIdentity } from "@shared/shotIdentity";

export const MIN_STORYBOARD_DURATION_MS = 100;
export const MAX_STORYBOARD_DURATION_MS = 12_000;
export const DEFAULT_STORYBOARD_DURATION_MS = 2_400;

export type StoryboardTimingShot = {
  stableShotId?: string | null;
  shotIdentity?: string | null;
  shotKey?: string | null;
  shotNo: number;
  durationMs?: number | null;
};

export type StoryboardTimingRow = {
  stableShotId: string;
  shotNo: number;
  position: number;
  startMs: number;
  endMs: number;
  durationMs: number;
};

export function storyboardTimingShotId(
  shot: StoryboardTimingShot,
  index = 0
): string {
  return (
    normalizeShotIdentity(shot.stableShotId) ??
    normalizeShotIdentity(shot.shotIdentity) ??
    normalizeShotIdentity(shot.shotKey) ??
    `legacy-sh${String(shot.shotNo).padStart(2, "0")}-${index + 1}`
  );
}

export function clampStoryboardDurationMs(durationMs: number): number {
  return Math.min(
    MAX_STORYBOARD_DURATION_MS,
    Math.max(MIN_STORYBOARD_DURATION_MS, Math.round(durationMs))
  );
}

export function storyboardDurationMsFromSeconds(
  seconds: number
): number | null {
  if (!Number.isFinite(seconds)) return null;
  const durationMs = Math.round(seconds * 1000);
  if (
    durationMs < MIN_STORYBOARD_DURATION_MS ||
    durationMs > MAX_STORYBOARD_DURATION_MS
  ) {
    return null;
  }
  return durationMs;
}

export function storyboardDurationMsFromEndSeconds(
  startMs: number,
  endSeconds: number
): number | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endSeconds)) return null;
  return storyboardDurationMsFromSeconds(endSeconds - startMs / 1000);
}

export function buildStoryboardTimingRows(
  shots: readonly StoryboardTimingShot[],
  timelineShotIds: readonly string[]
): StoryboardTimingRow[] {
  const shotsById = new Map(
    shots.map((shot, index) => [storyboardTimingShotId(shot, index), shot])
  );
  let cursorMs = 0;

  return timelineShotIds.flatMap((rawId, position) => {
    const stableShotId = normalizeShotIdentity(rawId);
    const shot = stableShotId ? shotsById.get(stableShotId) : undefined;
    if (!stableShotId || !shot) return [];
    const durationMs = clampStoryboardDurationMs(
      typeof shot.durationMs === "number" && Number.isFinite(shot.durationMs)
        ? shot.durationMs
        : DEFAULT_STORYBOARD_DURATION_MS
    );
    const startMs = cursorMs;
    cursorMs += durationMs;
    return [
      {
        stableShotId,
        shotNo: shot.shotNo,
        position,
        startMs,
        endMs: cursorMs,
        durationMs,
      },
    ];
  });
}

export function formatStoryboardTimestamp(durationMs: number): string {
  const safeMs = Math.max(0, Math.round(durationMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const milliseconds = safeMs % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

export function formatStoryboardSecondsInput(durationMs: number): string {
  return (durationMs / 1000)
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}
