import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CreationEditorShot } from '../CreationEditorContext';
import {
  advancePlayback,
  enteredShotNo,
  initialPlaybackState,
  seekToShot,
  shotDurationMs,
  type PlaybackState,
} from '../playback';

type AnimaticPlayerProps = {
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  durationsByShotNo?: Record<number, number>;
  onShotEnter: (shotNo: number) => void;
  isPlaying: boolean;
  onPlayingChange: (isPlaying: boolean) => void;
};

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, '0')}`;
}

export default function AnimaticPlayer({
  shots,
  selectedShotNo,
  durationsByShotNo = {},
  onShotEnter,
  isPlaying,
  onPlayingChange,
}: AnimaticPlayerProps) {
  const playbackShots = useMemo(
    () =>
      shots.map((shot) => ({
        shotNo: shot.shotNo,
        dialogue: shot.dialogue,
        beat: shot.beat,
        durationMs: durationsByShotNo[shot.shotNo] ?? shot.durationMs,
      })),
    [durationsByShotNo, shots],
  );
  const [state, setState] = useState<PlaybackState>(() => initialPlaybackState(playbackShots));
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    setState((current) => ({
      ...seekToShot(selectedShotNo ?? playbackShots[0]?.shotNo ?? null),
      isPlaying: current.isPlaying,
    }));
  }, [playbackShots, selectedShotNo]);

  useEffect(() => {
    setState((current) => ({ ...current, isPlaying }));
  }, [isPlaying]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!state.isPlaying) {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastTimeRef.current = null;
      return undefined;
    }

    const tick = (time: number) => {
      const previousTime = lastTimeRef.current ?? time;
      lastTimeRef.current = time;
      const delta = time - previousTime;

      setState((previous) => {
        const next = advancePlayback(playbackShots, previous, delta);
        const entered = enteredShotNo(previous, next);
        if (entered != null) onShotEnter(entered);
        if (!next.isPlaying) onPlayingChange(false);
        return next;
      });

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastTimeRef.current = null;
    };
  }, [onPlayingChange, onShotEnter, playbackShots, state.isPlaying]);

  const currentShot =
    shots.find((shot) => shot.shotNo === state.currentShotNo) ??
    shots.find((shot) => shot.shotNo === selectedShotNo) ??
    shots[0] ??
    null;
  const duration = currentShot
    ? shotDurationMs({
        shotNo: currentShot.shotNo,
        dialogue: currentShot.dialogue,
        beat: currentShot.beat,
        durationMs: durationsByShotNo[currentShot.shotNo] ?? currentShot.durationMs,
      })
    : 0;
  const progress = duration > 0 ? Math.min(1, state.elapsedMs / duration) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
        {currentShot?.imageUrl ? (
          <img
            src={currentShot.imageUrl}
            alt={shotLabel(currentShot)}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="max-w-md px-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Play className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium">动态分镜待出图</p>
            <p className="mt-1 text-sm text-muted-foreground">
              当前镜先以静态占位连播；有图后会自动切换为画面预览。
            </p>
          </div>
        )}
        {currentShot?.dialogue ? (
          <div className="absolute inset-x-6 bottom-5 rounded-md bg-background/88 px-4 py-3 text-center text-sm shadow-sm backdrop-blur">
            {currentShot.dialogue}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-background/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onPlayingChange(!isPlaying)}
            disabled={shots.length === 0}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const first = playbackShots[0]?.shotNo ?? null;
              setState(seekToShot(first));
              if (first != null) onShotEnter(first);
              onPlayingChange(false);
            }}
            disabled={shots.length === 0}
            aria-label="回到开头"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {currentShot ? `${shotLabel(currentShot)} · ${(duration / 1000).toFixed(1)}s` : '0.0s'}
        </div>
      </div>
    </div>
  );
}
