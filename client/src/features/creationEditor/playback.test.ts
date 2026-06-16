import { describe, expect, it } from 'vitest';
import {
  advancePlayback,
  enteredShotNo,
  estimateReadingMs,
  initialPlaybackState,
  shotDurationMs,
  totalDurationMs,
  type PlaybackState,
} from './playback';

const shots = [
  { shotNo: 1, dialogue: '第一句', durationMs: 1200 },
  { shotNo: 2, dialogue: '第二句', durationMs: 2000 },
  { shotNo: 3, dialogue: '第三句', durationMs: 1500 },
];

describe('creation editor playback', () => {
  it('advances three shots in order by each shot duration', () => {
    let state: PlaybackState = { currentShotNo: 1, elapsedMs: 0, isPlaying: true };
    const entries: number[] = [];

    let next = advancePlayback(shots, state, 1200);
    const firstEntry = enteredShotNo(state, next);
    if (firstEntry != null) entries.push(firstEntry);
    state = next;

    next = advancePlayback(shots, state, 1999);
    expect(next.currentShotNo).toBe(2);
    expect(enteredShotNo(state, next)).toBeNull();
    state = next;

    next = advancePlayback(shots, state, 1);
    const secondEntry = enteredShotNo(state, next);
    if (secondEntry != null) entries.push(secondEntry);

    expect(entries).toEqual([2, 3]);
    expect(next.currentShotNo).toBe(3);
  });

  it('uses a non-zero fallback duration for shots without dialogue', () => {
    expect(estimateReadingMs('')).toBeGreaterThan(0);
    expect(shotDurationMs({ shotNo: 1 })).toBeGreaterThan(0);
  });

  it('lets one shot duration override change totals without touching others', () => {
    const base = totalDurationMs(shots);
    const changed = totalDurationMs([
      shots[0],
      { ...shots[1], durationMs: 4200 },
      shots[2],
    ]);

    expect(changed - base).toBe(2200);
    expect(shotDurationMs(shots[0])).toBe(1200);
    expect(shotDurationMs(shots[2])).toBe(1500);
  });

  it('reports a shot entry only when the playback head moves to a new shot', () => {
    const previous = initialPlaybackState(shots);
    const same = { ...previous, elapsedMs: 500, isPlaying: true };
    const changed = { ...same, currentShotNo: 2 };

    expect(enteredShotNo(previous, same)).toBeNull();
    expect(enteredShotNo(same, changed)).toBe(2);
  });

  it('stops on the final shot after the full animatic has played', () => {
    const done = advancePlayback(
      shots,
      { currentShotNo: 1, elapsedMs: 0, isPlaying: true },
      10000,
    );

    expect(done.currentShotNo).toBe(3);
    expect(done.isPlaying).toBe(false);
  });
});
