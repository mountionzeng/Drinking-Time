export const MIN_SHOT_DURATION_MS = 1200;
export const MAX_SHOT_DURATION_MS = 12000;
export const DEFAULT_EMPTY_SHOT_DURATION_MS = 2400;

export type PlaybackShot = {
  shotNo: number;
  dialogue?: string;
  beat?: string;
  durationMs?: number | null;
};

export type PlaybackState = {
  currentShotNo: number | null;
  elapsedMs: number;
  isPlaying: boolean;
};

function clampDuration(ms: number) {
  return Math.min(MAX_SHOT_DURATION_MS, Math.max(MIN_SHOT_DURATION_MS, Math.round(ms)));
}

export function estimateReadingMs(text: string | null | undefined): number {
  const value = text?.trim() ?? '';
  if (!value) return DEFAULT_EMPTY_SHOT_DURATION_MS;
  const cjkCount = Array.from(value).filter((char) => /[\u3400-\u9fff]/.test(char)).length;
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  const readingMs = 1200 + cjkCount * 155 + wordCount * 260;
  return clampDuration(readingMs);
}

export function shotDurationMs(shot: PlaybackShot): number {
  if (typeof shot.durationMs === 'number' && Number.isFinite(shot.durationMs)) {
    return clampDuration(shot.durationMs);
  }
  return estimateReadingMs(shot.dialogue || shot.beat);
}

export function totalDurationMs(shots: readonly PlaybackShot[]): number {
  return shots.reduce((total, shot) => total + shotDurationMs(shot), 0);
}

export function initialPlaybackState(shots: readonly PlaybackShot[]): PlaybackState {
  return {
    currentShotNo: shots[0]?.shotNo ?? null,
    elapsedMs: 0,
    isPlaying: false,
  };
}

export function seekToShot(shotNo: number | null): PlaybackState {
  return {
    currentShotNo: shotNo,
    elapsedMs: 0,
    isPlaying: false,
  };
}

export function advancePlayback(
  shots: readonly PlaybackShot[],
  state: PlaybackState,
  deltaMs: number,
): PlaybackState {
  if (!state.isPlaying || shots.length === 0 || deltaMs <= 0) return state;

  let index = Math.max(0, shots.findIndex((shot) => shot.shotNo === state.currentShotNo));
  let elapsed = state.elapsedMs + deltaMs;

  while (index < shots.length) {
    const duration = shotDurationMs(shots[index]);
    if (elapsed < duration) {
      return {
        currentShotNo: shots[index].shotNo,
        elapsedMs: elapsed,
        isPlaying: true,
      };
    }

    if (index === shots.length - 1) {
      return {
        currentShotNo: shots[index].shotNo,
        elapsedMs: duration,
        isPlaying: false,
      };
    }

    elapsed -= duration;
    index += 1;
  }

  const last = shots[shots.length - 1];
  return {
    currentShotNo: last.shotNo,
    elapsedMs: shotDurationMs(last),
    isPlaying: false,
  };
}

export function enteredShotNo(
  previous: PlaybackState,
  next: PlaybackState,
): number | null {
  if (next.currentShotNo == null) return null;
  return previous.currentShotNo === next.currentShotNo ? null : next.currentShotNo;
}
