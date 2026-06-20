import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Pause, Play, RotateCcw, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CreationEditorShot } from '../CreationEditorContext';
import { buildPromptTable } from '../promptTable/buildPromptTable';
import { compileVideoShotRecipe } from '../promptTable/videoRecipe';
import {
  cropFrameQuadrant,
  FRAME_QUADRANTS,
  type FrameQuadrant,
} from '../video/frameCrop';
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
  onPromoteFrameCrop?: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => Promise<{ imageId: number; imageUrl: string }>;
  promotingFrameCropShotNo?: number | null;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
  }) => Promise<{ videoUrl: string; taskId?: string; prompt: string }>;
  generatingVideoShotNo?: number | null;
};

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, '0')}`;
}

function compactText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? '';
}

function joinText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).filter(Boolean).join(' · ');
}

function frameQuadrantLabel(value: FrameQuadrant | null) {
  return FRAME_QUADRANTS.find((quadrant) => quadrant.value === value)?.label ?? '选中';
}

type FrameCropPhase = 'cropping' | 'saving' | 'done';

type FrameCropStatus = {
  quadrant: FrameQuadrant;
  phase: FrameCropPhase;
};

function frameCropStatusText(status: FrameCropStatus) {
  const label = frameQuadrantLabel(status.quadrant);
  if (status.phase === 'saving') return `正在把${label}小图保存为本镜首帧…`;
  if (status.phase === 'done') return `已把${label}小图设为本镜首帧`;
  return `正在裁切${label}小图…`;
}

function waitForNextPaint() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

export default function AnimaticPlayer({
  shots,
  selectedShotNo,
  durationsByShotNo = {},
  onShotEnter,
  isPlaying,
  onPlayingChange,
  onPromoteFrameCrop,
  promotingFrameCropShotNo = null,
  onGenerateShotVideo,
  generatingVideoShotNo = null,
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
  const [preparedVideoShotNo, setPreparedVideoShotNo] = useState<number | null>(null);
  const [frameCropStatus, setFrameCropStatus] = useState<FrameCropStatus | null>(null);
  const [frameCropError, setFrameCropError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoPreviewByShotNo, setVideoPreviewByShotNo] = useState<Record<number, {
    videoUrl: string;
    taskId?: string;
    prompt: string;
  }>>({});
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
  const videoRows = useMemo(() => {
    if (!currentShot) return [];
    const previousShots = shots.filter((shot) => shot.shotNo < currentShot.shotNo);
    return buildPromptTable(currentShot, { previousShots });
  }, [currentShot, shots]);
  const videoRecipe = useMemo(
    () => (currentShot ? compileVideoShotRecipe({ shot: currentShot, rows: videoRows }) : null),
    [currentShot, videoRows],
  );
  const activeFrameUrl =
    currentShot?.imageUrl || currentShot?.promptRun?.imageUrl || videoRecipe?.sourceImageUrl || '';
  const activeFrameId = currentShot?.imageId ?? currentShot?.promptRun?.imageId;
  const videoMissing = videoRecipe
    ? videoRecipe.missing.filter((item) => item !== '首帧图' || !activeFrameUrl)
    : [];
  const isVideoReady = Boolean(videoRecipe && activeFrameUrl && videoMissing.length === 0);
  const isPrepared = Boolean(currentShot && preparedVideoShotNo === currentShot.shotNo);
  const isPromotingFrameCrop = Boolean(
    currentShot && promotingFrameCropShotNo === currentShot.shotNo,
  );
  const isFrameCropBusy =
    Boolean(isPromotingFrameCrop) ||
    frameCropStatus?.phase === 'cropping' ||
    frameCropStatus?.phase === 'saving';
  const isGeneratingVideo = Boolean(
    currentShot && generatingVideoShotNo === currentShot.shotNo,
  );
  const currentVideoPreview = currentShot ? videoPreviewByShotNo[currentShot.shotNo] : undefined;
  const videoActionLabel = !activeFrameUrl
    ? '先生成首帧'
    : activeFrameId == null
      ? '先选首帧'
      : !isVideoReady
        ? '补视频提示'
        : currentVideoPreview
          ? '重新生成视频'
          : '生成本镜视频';
  const frameStatusText = activeFrameUrl
    ? activeFrameId == null
      ? '已有候选图。若它是四宫格，先点一格成为正式首帧。'
      : '首帧已可追踪。若画面仍是四宫格，也可以先选一格再生成视频。'
    : '当前镜头还没有首帧图，先到提示词表重渲本镜。';
  const canGenerateVideo =
    Boolean(isVideoReady && activeFrameId != null && onGenerateShotVideo) &&
    !isGeneratingVideo &&
    !isFrameCropBusy;

  const promoteQuadrant = async (quadrant: FrameQuadrant) => {
    if (!onPromoteFrameCrop) return;
    setFrameCropError(null);
    if (!currentShot || !activeFrameUrl) {
      setFrameCropError('当前镜头还没有可裁切的候选图，请先生成首帧图。');
      return;
    }
    setFrameCropStatus({ quadrant, phase: 'cropping' });
    await waitForNextPaint();
    try {
      const cropped = await cropFrameQuadrant(activeFrameUrl, quadrant);
      setFrameCropStatus({ quadrant, phase: 'saving' });
      await waitForNextPaint();
      await onPromoteFrameCrop({
        shotNo: currentShot.shotNo,
        imageBase64: cropped.imageBase64,
        mimeType: cropped.mimeType,
        parentImageId: activeFrameId,
        quadrant,
      });
      setFrameCropStatus({ quadrant, phase: 'done' });
      window.setTimeout(() => {
        setFrameCropStatus((current) =>
          current?.phase === 'done' && current.quadrant === quadrant ? null : current,
        );
      }, 1800);
    } catch (error) {
      setFrameCropError(error instanceof Error ? error.message : '首帧裁切失败');
      setFrameCropStatus(null);
    }
  };

  const generateVideo = async () => {
    if (!currentShot || !videoRecipe || !onGenerateShotVideo) return;
    setVideoError(null);
    if (activeFrameId == null) {
      setVideoError('先从四宫格中选一格成为正式首帧，再生成视频。');
      return;
    }
    setPreparedVideoShotNo(currentShot.shotNo);
    try {
      const result = await onGenerateShotVideo({
        shotNo: currentShot.shotNo,
        imageId: activeFrameId,
        prompt: videoRecipe.finalPrompt,
        subtitle: currentShot.dialogue || undefined,
        durationSec: Math.max(3, Math.min(10, Math.round(duration / 1000) || 5)),
      });
      setVideoPreviewByShotNo((current) => ({
        ...current,
        [currentShot.shotNo]: result,
      }));
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : '视频生成失败');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
        {activeFrameUrl ? (
          <img
            src={activeFrameUrl}
            alt={currentShot ? shotLabel(currentShot) : '当前镜头'}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="max-w-md px-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Play className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium">动态分镜待出图</p>
            <p className="mt-1 text-sm text-muted-foreground">
              当前镜先以镜头设计连播；有图后会自动切换为画面预览。
            </p>
          </div>
        )}
        {currentShot?.dialogue ? (
          <div className="absolute inset-x-6 bottom-5 rounded-md bg-background/88 px-4 py-3 text-center text-sm shadow-sm backdrop-blur">
            {currentShot.dialogue}
          </div>
        ) : null}
      </div>

      {currentShot ? (
        <div className="rounded-md border border-border/70 bg-background/70 p-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                <Video className="h-3.5 w-3.5 text-primary" />
                镜头动作
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-normal ${
                    canGenerateVideo
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
                      : 'border-amber-500/20 bg-amber-500/10 text-amber-700'
                  }`}
                >
                  {canGenerateVideo ? '可生成视频' : videoActionLabel}
                </span>
              </div>
              <p className="leading-5 text-muted-foreground">
                {frameStatusText}
                {videoMissing.length > 0 ? ` 还缺：${videoMissing.join(' / ')}。` : ''}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={currentVideoPreview ? 'outline' : 'default'}
              disabled={!canGenerateVideo}
              onClick={() => void generateVideo()}
              aria-label="生成本镜视频"
            >
              {currentVideoPreview ? <CheckCircle2 className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              {isGeneratingVideo ? '正在生成视频' : videoActionLabel}
            </Button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="min-w-0 space-y-1.5 text-muted-foreground">
              <p className="leading-5">
                <span className="font-medium text-foreground">这一镜：</span>
                {compactText(currentShot.intent, currentShot.rationale, currentShot.beat, currentShot.subject) || '等待导演明确镜头任务'}
              </p>
              <p className="leading-5">
                <span className="font-medium text-foreground">运动/声音：</span>
                {joinText(
                  currentShot.videoPrompt,
                  currentShot.cameraMove,
                  currentShot.videoStart,
                  currentShot.videoEnd,
                  currentShot.dialogue,
                  currentShot.sound,
                ) || '等待补充视频运动、字幕或背景音'}
              </p>
            </div>

            {onPromoteFrameCrop ? (
              <div className="rounded-md border border-border/70 bg-muted/30 p-2">
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">四宫格选首帧</div>
                {activeFrameUrl ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {FRAME_QUADRANTS.map((quadrant) => (
                      <Button
                        key={quadrant.value}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isFrameCropBusy}
                        onClick={() => void promoteQuadrant(quadrant.value)}
                      >
                        {frameCropStatus?.quadrant === quadrant.value && frameCropStatus.phase === 'saving'
                          ? '保存中'
                          : frameCropStatus?.quadrant === quadrant.value && frameCropStatus.phase === 'cropping'
                            ? '处理中'
                            : frameCropStatus?.quadrant === quadrant.value && frameCropStatus.phase === 'done'
                              ? '已选'
                              : quadrant.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-background/70 px-3 py-2 text-center text-[11px] text-muted-foreground">
                    暂无候选图
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {frameCropStatus ? (
            <p className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 font-medium text-foreground">
              {frameCropStatusText(frameCropStatus)}
            </p>
          ) : null}
          {frameCropError ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-destructive">
              {frameCropError}
            </div>
          ) : null}
          {videoRecipe ? (
            <>
              <button
                type="button"
                className="mt-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setPreparedVideoShotNo(isPrepared ? null : currentShot.shotNo)}
              >
                {isPrepared ? '收起视频包' : '查看视频包'}
              </button>
              {isPrepared ? (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-[11px] leading-5">
                  {videoRecipe.finalPrompt}
                </pre>
              ) : null}
              {videoError ? (
                <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-destructive">
                  {videoError}
                </div>
              ) : null}
            </>
          ) : null}
          {currentVideoPreview ? (
            <div className="mt-2 overflow-hidden rounded-md border border-border/70 bg-muted/40">
              <video
                src={currentVideoPreview.videoUrl}
                controls
                playsInline
                className="aspect-video w-full bg-black object-contain"
              />
            </div>
          ) : null}
        </div>
      ) : null}

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
