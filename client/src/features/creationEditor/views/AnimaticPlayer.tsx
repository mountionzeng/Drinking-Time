import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Pause, Play, RotateCcw, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreationEditorShot } from "../CreationEditorContext";
import type { ShotVideoProviderStatus } from "@shared/videoAsset";
import { buildPromptTable } from "../promptTable/buildPromptTable";
import { compileVideoShotRecipe } from "../promptTable/videoRecipe";
import {
  cropFrameQuadrant,
  FRAME_QUADRANTS,
  type FrameQuadrant,
} from "../video/frameCrop";
import {
  advancePlayback,
  enteredShotNo,
  initialPlaybackState,
  seekToShot,
  type PlaybackState,
} from "../playback";
import {
  playableVideoTake,
  shotTimelineDurationMs,
  videoTakeAffordance,
  videoTakeDurationMs,
} from "../videoAssetViewModel";

type AnimaticPlayerProps = {
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  durationsByShotNo?: Record<number, number>;
  onShotEnter: (shotNo: number) => void;
  isPlaying: boolean;
  onPlayingChange: (isPlaying: boolean) => void;
  playbackResetKey?: number;
  onPromoteFrameCrop?: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
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
  }) => Promise<{
    takeId: number;
    videoStatus: string;
    videoUrl?: string;
    taskId?: string;
    prompt: string;
  }>;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  onCreateVideoTakeRange?: (input: {
    stableShotId: string;
    takeId: number;
    startSec: number;
    endSec: number;
    label?: string;
    useOnTimeline?: boolean;
  }) => Promise<void>;
  onSelectVideoTimelineSegment?: (input: {
    stableShotId: string;
    takeId: number;
    rangeId?: number | null;
    selectionType: "full_take" | "range";
  }) => Promise<void>;
  onClearVideoTimelineSegment?: (stableShotId: string) => Promise<void>;
  generatingVideoShotNo?: number | null;
  shotVideoProviderStatus?: ShotVideoProviderStatus | null;
};

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, "0")}`;
}

function compactText(...values: Array<string | null | undefined>) {
  return values.map(value => value?.trim()).find(Boolean) ?? "";
}

function joinText(...values: Array<string | null | undefined>) {
  return values
    .map(value => value?.trim())
    .filter(Boolean)
    .join(" · ");
}

function frameQuadrantLabel(value: FrameQuadrant | null) {
  return (
    FRAME_QUADRANTS.find(quadrant => quadrant.value === value)?.label ?? "选中"
  );
}

type FrameCropPhase = "cropping" | "saving" | "done";

type FrameCropStatus = {
  quadrant: FrameQuadrant;
  phase: FrameCropPhase;
};

function frameCropStatusText(status: FrameCropStatus) {
  const label = frameQuadrantLabel(status.quadrant);
  if (status.phase === "saving") return `正在把${label}小图保存为本镜首帧…`;
  if (status.phase === "done") return `已把${label}小图设为本镜首帧`;
  return `正在裁切${label}小图…`;
}

function waitForNextPaint() {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
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
  playbackResetKey = 0,
  onPromoteFrameCrop,
  promotingFrameCropShotNo = null,
  onGenerateShotVideo,
  onRefreshShotVideoStatus,
  onCreateVideoTakeRange,
  onSelectVideoTimelineSegment,
  onClearVideoTimelineSegment,
  generatingVideoShotNo = null,
  shotVideoProviderStatus = null,
}: AnimaticPlayerProps) {
  const playbackShots = useMemo(
    () =>
      shots.map(shot => ({
        shotNo: shot.shotNo,
        dialogue: shot.dialogue,
        beat: shot.beat,
        durationMs:
          durationsByShotNo[shot.shotNo] ?? shotTimelineDurationMs(shot),
      })),
    [durationsByShotNo, shots]
  );
  const [state, setState] = useState<PlaybackState>(() =>
    initialPlaybackState(playbackShots)
  );
  const [preparedVideoShotNo, setPreparedVideoShotNo] = useState<number | null>(
    null
  );
  const [frameCropStatus, setFrameCropStatus] =
    useState<FrameCropStatus | null>(null);
  const [frameCropError, setFrameCropError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [activeTakeIdByShotNo, setActiveTakeIdByShotNo] = useState<
    Record<number, number>
  >({});
  const [rangeDraftByTakeId, setRangeDraftByTakeId] = useState<
    Record<number, { startSec: number; endSec: number }>
  >({});
  const [videoPreviewByShotNo, setVideoPreviewByShotNo] = useState<
    Record<
      number,
      {
        videoUrl?: string;
        taskId?: string;
        takeId?: number;
        videoStatus?: string;
        prompt: string;
      }
    >
  >({});
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  useEffect(() => {
    setState(current => ({
      ...seekToShot(selectedShotNo ?? playbackShots[0]?.shotNo ?? null),
      isPlaying: current.isPlaying,
    }));
  }, [playbackShots, selectedShotNo]);

  useEffect(() => {
    setState({
      ...seekToShot(selectedShotNo ?? playbackShots[0]?.shotNo ?? null),
      isPlaying,
    });
    lastTimeRef.current = null;
  }, [playbackResetKey]);

  useEffect(() => {
    setState(current => ({ ...current, isPlaying }));
  }, [isPlaying]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
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

      setState(previous => {
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
    shots.find(shot => shot.shotNo === state.currentShotNo) ??
    shots.find(shot => shot.shotNo === selectedShotNo) ??
    shots[0] ??
    null;
  const duration = currentShot
    ? (durationsByShotNo[currentShot.shotNo] ??
      shotTimelineDurationMs(currentShot))
    : 0;
  const progress = duration > 0 ? Math.min(1, state.elapsedMs / duration) : 0;
  const videoRows = useMemo(() => {
    if (!currentShot) return [];
    const previousShots = shots.filter(
      shot => shot.shotNo < currentShot.shotNo
    );
    return buildPromptTable(currentShot, { previousShots });
  }, [currentShot, shots]);
  const videoRecipe = useMemo(
    () =>
      currentShot
        ? compileVideoShotRecipe({ shot: currentShot, rows: videoRows })
        : null,
    [currentShot, videoRows]
  );
  const activeFrameUrl =
    currentShot?.imageUrl ||
    currentShot?.promptRun?.imageUrl ||
    videoRecipe?.sourceImageUrl ||
    "";
  const activeFrameId = currentShot?.imageId;
  const hasExplicitSelectedFrame =
    currentShot?.imageSelectionSource === "explicit";
  const videoMissing = videoRecipe
    ? videoRecipe.missing.filter(item => item !== "首帧图" || !activeFrameUrl)
    : [];
  const isVideoReady = Boolean(
    videoRecipe && activeFrameUrl && videoMissing.length === 0
  );
  const isPrepared = Boolean(
    currentShot && preparedVideoShotNo === currentShot.shotNo
  );
  const isPromotingFrameCrop = Boolean(
    currentShot && promotingFrameCropShotNo === currentShot.shotNo
  );
  const isFrameCropBusy =
    Boolean(isPromotingFrameCrop) ||
    frameCropStatus?.phase === "cropping" ||
    frameCropStatus?.phase === "saving";
  const isGeneratingVideo = Boolean(
    currentShot && generatingVideoShotNo === currentShot.shotNo
  );
  const currentVideoTake = currentShot
    ? (currentShot.videoTakes?.find(
        take => take.id === activeTakeIdByShotNo[currentShot.shotNo]
      ) ??
      currentShot.videoTakes?.find(take => take.isTimelineSelected) ??
      // 优先选 available 的 take，避免新 failed take 覆盖旧可播放视频
      currentShot.videoTakes?.find(
        take => videoTakeAffordance(take.status).canPlay
      ) ??
      currentShot.videoTakes?.[0])
    : undefined;
  const previewVideoTake =
    currentVideoTake?.videoUrl &&
    videoTakeAffordance(currentVideoTake.status).canPlay
      ? currentVideoTake
      : playableVideoTake(currentShot?.videoTakes);
  const currentTakeAffordance = currentVideoTake
    ? videoTakeAffordance(currentVideoTake.status)
    : null;
  const currentTakeDurationMs = currentVideoTake
    ? videoTakeDurationMs(currentVideoTake)
    : null;
  const currentTakeDurationSec = (currentTakeDurationMs ?? duration) / 1000;
  const rangeDraft = currentVideoTake
    ? (rangeDraftByTakeId[currentVideoTake.id] ?? {
        startSec:
          currentVideoTake.ranges.find(
            range => range.id === currentVideoTake.selectedRangeId
          )?.startSec ?? 0,
        endSec:
          currentVideoTake.ranges.find(
            range => range.id === currentVideoTake.selectedRangeId
          )?.endSec ?? Math.max(0.1, currentTakeDurationSec),
      })
    : null;
  const currentVideoPreview = currentShot
    ? (videoPreviewByShotNo[currentShot.shotNo] ??
      (previewVideoTake
        ? {
            videoUrl: previewVideoTake.videoUrl ?? undefined,
            taskId: previewVideoTake.taskId ?? undefined,
            takeId: previewVideoTake.id,
            videoStatus: previewVideoTake.status,
            prompt: previewVideoTake.prompt,
          }
        : undefined))
    : undefined;
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    video.playbackRate = playbackSpeed;
  }, [playbackSpeed]);
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video || !currentVideoPreview?.videoUrl) return;
    if (!isPlaying) {
      video.pause();
      return;
    }
    video.currentTime = 0;
    void video.play().catch(() => {
      // Browser autoplay policy can reject play() for videos with audio.
      // The controls remain visible so the user can start it manually.
    });
  }, [
    currentShot?.shotNo,
    currentVideoPreview?.videoUrl,
    isPlaying,
    playbackResetKey,
  ]);
  const canRefreshVideo =
    Boolean(
      currentVideoTake?.taskId &&
        onRefreshShotVideoStatus &&
        ["submitted", "processing"].includes(currentVideoTake.status)
    ) && !isGeneratingVideo;
  const providerMissing = shotVideoProviderStatus?.missing ?? [];
  const providerWarnings = shotVideoProviderStatus?.warnings ?? [];
  const providerReady = shotVideoProviderStatus?.ready ?? false;
  const providerStatusText = !shotVideoProviderStatus
    ? "正在检查视频服务配置。"
    : providerMissing.length > 0
      ? `后端缺：${providerMissing.join(" / ")}。`
      : providerWarnings.length > 0
        ? `后端提醒：${providerWarnings.join(" / ")} 未配置，异步视频可能无法刷新。`
        : "";
  const videoActionLabel = !activeFrameUrl
    ? "先生成首帧"
    : activeFrameId == null || !hasExplicitSelectedFrame
      ? "先选首帧"
      : !isVideoReady
        ? "补视频提示"
        : !providerReady
          ? "配置视频模型"
          : canRefreshVideo
            ? "刷新视频状态"
            : currentVideoPreview?.videoUrl
              ? "重新生成视频"
              : "生成本镜视频";
  const frameStatusText = activeFrameUrl
    ? activeFrameId == null
      ? "已有候选图。若它是四宫格，先点一格成为正式首帧。"
      : hasExplicitSelectedFrame
        ? "已选中单张首帧，视频只会使用这张图。"
        : "已有候选图。先从四宫格中选一格成为正式首帧，再生成视频。"
    : "当前镜头还没有首帧图，先到提示词表重渲本镜。";
  const frameDisplayStatusText = currentVideoPreview?.videoUrl
    ? "已有可播放视频，动态分镜会优先播放这条视频。"
    : frameStatusText;
  const canGenerateVideo =
    Boolean(
      isVideoReady &&
        activeFrameId != null &&
        hasExplicitSelectedFrame &&
        providerReady &&
        onGenerateShotVideo
    ) &&
    !isGeneratingVideo &&
    !isFrameCropBusy;

  const updateRangeDraft = (
    patch: Partial<{ startSec: number; endSec: number }>
  ) => {
    if (!currentVideoTake || !rangeDraft) return;
    const max = Math.max(0.1, currentTakeDurationSec);
    const next = {
      ...rangeDraft,
      ...patch,
    };
    const startSec = Math.max(0, Math.min(max - 0.1, next.startSec));
    const endSec = Math.max(startSec + 0.1, Math.min(max, next.endSec));
    setRangeDraftByTakeId(current => ({
      ...current,
      [currentVideoTake.id]: {
        startSec: Number(startSec.toFixed(1)),
        endSec: Number(endSec.toFixed(1)),
      },
    }));
  };

  const useFullTakeOnTimeline = async () => {
    if (
      !currentShot?.stableShotId ||
      !currentVideoTake ||
      !onSelectVideoTimelineSegment
    )
      return;
    setRangeError(null);
    setRangeBusy(true);
    try {
      await onSelectVideoTimelineSegment({
        stableShotId: currentShot.stableShotId,
        takeId: currentVideoTake.id,
        rangeId: null,
        selectionType: "full_take",
      });
    } catch (error) {
      setRangeError(
        error instanceof Error ? error.message : "时间轴选择保存失败"
      );
    } finally {
      setRangeBusy(false);
    }
  };

  const saveRangeToTimeline = async () => {
    if (
      !currentShot?.stableShotId ||
      !currentVideoTake ||
      !rangeDraft ||
      !onCreateVideoTakeRange
    )
      return;
    setRangeError(null);
    setRangeBusy(true);
    try {
      await onCreateVideoTakeRange({
        stableShotId: currentShot.stableShotId,
        takeId: currentVideoTake.id,
        startSec: rangeDraft.startSec,
        endSec: rangeDraft.endSec,
        label: `${shotLabel(currentShot)} 可用片段`,
        useOnTimeline: true,
      });
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : "片段保存失败");
    } finally {
      setRangeBusy(false);
    }
  };

  const useExistingRangeOnTimeline = async (rangeId: number) => {
    if (
      !currentShot?.stableShotId ||
      !currentVideoTake ||
      !onSelectVideoTimelineSegment
    )
      return;
    setRangeError(null);
    setRangeBusy(true);
    try {
      await onSelectVideoTimelineSegment({
        stableShotId: currentShot.stableShotId,
        takeId: currentVideoTake.id,
        rangeId,
        selectionType: "range",
      });
    } catch (error) {
      setRangeError(
        error instanceof Error ? error.message : "时间轴选择保存失败"
      );
    } finally {
      setRangeBusy(false);
    }
  };

  const clearTimelineSegment = async () => {
    if (!currentShot?.stableShotId || !onClearVideoTimelineSegment) return;
    setRangeError(null);
    setRangeBusy(true);
    try {
      await onClearVideoTimelineSegment(currentShot.stableShotId);
    } catch (error) {
      setRangeError(
        error instanceof Error ? error.message : "时间轴选择清除失败"
      );
    } finally {
      setRangeBusy(false);
    }
  };

  const promoteQuadrant = async (quadrant: FrameQuadrant) => {
    if (!onPromoteFrameCrop) return;
    setFrameCropError(null);
    if (!currentShot || !activeFrameUrl) {
      setFrameCropError("当前镜头还没有可裁切的候选图，请先生成首帧图。");
      return;
    }
    setFrameCropStatus({ quadrant, phase: "cropping" });
    await waitForNextPaint();
    try {
      const cropped = await cropFrameQuadrant(activeFrameUrl, quadrant);
      setFrameCropStatus({ quadrant, phase: "saving" });
      await waitForNextPaint();
      await onPromoteFrameCrop({
        shotNo: currentShot.shotNo,
        imageBase64: cropped.imageBase64,
        mimeType: cropped.mimeType,
        parentImageId: activeFrameId,
        quadrant,
      });
      setFrameCropStatus({ quadrant, phase: "done" });
      window.setTimeout(() => {
        setFrameCropStatus(current =>
          current?.phase === "done" && current.quadrant === quadrant
            ? null
            : current
        );
      }, 1800);
    } catch (error) {
      setFrameCropError(
        error instanceof Error ? error.message : "首帧裁切失败"
      );
      setFrameCropStatus(null);
    }
  };

  const generateVideo = async () => {
    if (!currentShot || !videoRecipe || !onGenerateShotVideo) return;
    setVideoError(null);
    if (canRefreshVideo && currentVideoTake?.id && onRefreshShotVideoStatus) {
      try {
        await onRefreshShotVideoStatus(currentVideoTake.id);
      } catch (error) {
        setVideoError(
          error instanceof Error ? error.message : "视频状态刷新失败"
        );
      }
      return;
    }
    if (activeFrameId == null || !hasExplicitSelectedFrame) {
      setVideoError("先从四宫格中选一格成为正式首帧，再生成视频。");
      return;
    }
    if (!providerReady) {
      setVideoError(providerStatusText || "视频服务还没有配置完成。");
      return;
    }
    setPreparedVideoShotNo(currentShot.shotNo);
    try {
      const result = await onGenerateShotVideo({
        shotNo: currentShot.shotNo,
        imageId: activeFrameId,
        prompt: videoRecipe.finalPrompt,
        subtitle: currentShot.dialogue || undefined,
        durationSec: Math.max(
          3,
          Math.min(10, Math.round(duration / 1000) || 5)
        ),
      });
      if (result.videoUrl) {
        setVideoPreviewByShotNo(current => ({
          ...current,
          [currentShot.shotNo]: result,
        }));
      }
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "视频生成失败");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
        {currentVideoPreview?.videoUrl ? (
          <video
            ref={videoElementRef}
            src={currentVideoPreview.videoUrl}
            controls
            playsInline
            className="h-full w-full bg-black object-contain"
          />
        ) : activeFrameUrl ? (
          <img
            src={activeFrameUrl}
            alt={currentShot ? shotLabel(currentShot) : "当前镜头"}
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
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-700"
                  }`}
                >
                  {canGenerateVideo ? "可生成视频" : videoActionLabel}
                </span>
              </div>
              <p className="leading-5 text-muted-foreground">
                {frameDisplayStatusText}
                {!currentVideoPreview?.videoUrl && videoMissing.length > 0
                  ? ` 还缺：${videoMissing.join(" / ")}。`
                  : ""}
                {providerStatusText ? ` ${providerStatusText}` : ""}
                {currentVideoTake
                  ? ` 当前视频：${currentVideoTake.status}。`
                  : ""}
              </p>
              {currentVideoTake?.errorMessage ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 leading-5 text-destructive">
                  {/image not approved/i.test(currentVideoTake.errorMessage)
                    ? "这张首帧被视频模型拒绝，请换一张首帧或重新裁切。"
                    : /prompt parameter/i.test(currentVideoTake.errorMessage)
                      ? "视频模型拒绝了提示词，请检查视频包中的 prompt 是否过长或包含不支持的内容。"
                      : `当前 Take ${currentVideoTake.id} 失败原因：${currentVideoTake.errorMessage}`}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant={currentVideoPreview?.videoUrl ? "outline" : "default"}
              disabled={!canGenerateVideo && !canRefreshVideo}
              onClick={() => void generateVideo()}
              aria-label="生成本镜视频"
            >
              {currentVideoPreview?.videoUrl ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Video className="h-4 w-4" />
              )}
              {isGeneratingVideo ? "正在生成视频" : videoActionLabel}
            </Button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="min-w-0 space-y-1.5 text-muted-foreground">
              <p className="leading-5">
                <span className="font-medium text-foreground">这一镜：</span>
                {compactText(
                  currentShot.intent,
                  currentShot.rationale,
                  currentShot.beat,
                  currentShot.subject
                ) || "等待导演明确镜头任务"}
              </p>
              <p className="leading-5">
                <span className="font-medium text-foreground">运动/声音：</span>
                {joinText(
                  currentShot.videoPrompt,
                  currentShot.cameraMove,
                  currentShot.videoStart,
                  currentShot.videoEnd,
                  currentShot.dialogue,
                  currentShot.sound
                ) || "等待补充视频运动、字幕或背景音"}
              </p>
              {currentShot.videoTakes?.length ? (
                <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-foreground">
                      视频素材
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {currentShot.videoTakes.length} 条 take
                    </span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {currentShot.videoTakes.map(take => {
                      const affordance = videoTakeAffordance(take.status);
                      const active = currentVideoTake?.id === take.id;
                      return (
                        <button
                          key={take.id}
                          type="button"
                          onClick={() => {
                            setActiveTakeIdByShotNo(current => ({
                              ...current,
                              [currentShot.shotNo]: take.id,
                            }));
                            setVideoError(null);
                            setRangeError(null);
                          }}
                          className={`min-w-[118px] rounded-md border px-2 py-1.5 text-left transition ${
                            active
                              ? "border-primary bg-primary/10"
                              : "border-border bg-background hover:border-primary/40"
                          }`}
                        >
                          <span className="block text-[11px] font-semibold text-foreground">
                            Take {take.id}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {affordance.label}
                            {take.isTimelineSelected ? " · 时间轴" : ""}
                          </span>
                          {take.errorMessage ? (
                            <span className="mt-1 line-clamp-2 block text-[10px] text-destructive">
                              {take.errorMessage}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {currentVideoTake ? (
                    <div className="space-y-2 rounded-md border border-border/70 bg-background/70 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-foreground">
                          当前 Take {currentVideoTake.id} ·{" "}
                          {currentTakeAffordance?.label}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              rangeBusy ||
                              !currentTakeAffordance?.canUseOnTimeline ||
                              !onSelectVideoTimelineSegment
                            }
                            onClick={() => void useFullTakeOnTimeline()}
                          >
                            整段用于时间轴
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              rangeBusy ||
                              !currentVideoTake.isTimelineSelected ||
                              !onClearVideoTimelineSegment
                            }
                            onClick={() => void clearTimelineSegment()}
                          >
                            清空选择
                          </Button>
                        </div>
                      </div>
                      {currentVideoPreview?.videoUrl ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            播放速度
                          </span>
                          {[0.5, 1.0, 1.5, 2.0].map(speed => (
                            <button
                              key={speed}
                              type="button"
                              onClick={() => setPlaybackSpeed(speed)}
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                                playbackSpeed === speed
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40"
                              }`}
                            >
                              {speed}x
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {currentTakeAffordance?.canUseOnTimeline && rangeDraft ? (
                        <div className="space-y-2">
                          <p className="text-[10px] text-muted-foreground">
                            当前视频 {currentTakeDurationSec.toFixed(1)}s，选择其中一段用于时间轴。
                            {playbackSpeed !== 1.0
                              ? ` 以 ${playbackSpeed}x 速度播放，时间轴时长约 ${((rangeDraft.endSec - rangeDraft.startSec) / playbackSpeed).toFixed(1)}s。`
                              : ` 时间轴时长 ${(rangeDraft.endSec - rangeDraft.startSec).toFixed(1)}s。`}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <label className="block text-[10px] text-muted-foreground">
                            <span className="mb-1 block">
                              入点 {rangeDraft.startSec.toFixed(1)}s
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={Math.max(0.1, currentTakeDurationSec - 0.1)}
                              step={0.1}
                              value={rangeDraft.startSec}
                              onChange={event =>
                                updateRangeDraft({
                                  startSec: Number(event.currentTarget.value),
                                })
                              }
                              className="w-full accent-[var(--primary)]"
                              aria-label="可用片段入点"
                            />
                          </label>
                          <label className="block text-[10px] text-muted-foreground">
                            <span className="mb-1 block">
                              出点 {rangeDraft.endSec.toFixed(1)}s
                            </span>
                            <input
                              type="range"
                              min={0.1}
                              max={Math.max(0.1, currentTakeDurationSec)}
                              step={0.1}
                              value={rangeDraft.endSec}
                              onChange={event =>
                                updateRangeDraft({
                                  endSec: Number(event.currentTarget.value),
                                })
                              }
                              className="w-full accent-[var(--primary)]"
                              aria-label="可用片段出点"
                            />
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            disabled={rangeBusy || !onCreateVideoTakeRange}
                            onClick={() => void saveRangeToTimeline()}
                          >
                            保存片段
                          </Button>
                          </div>
                        </div>
                      ) : null}
                      {currentVideoTake.ranges.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {currentVideoTake.ranges.map(range => (
                            <Button
                              key={range.id}
                              type="button"
                              size="sm"
                              variant={
                                currentVideoTake.selectedRangeId === range.id
                                  ? "default"
                                  : "outline"
                              }
                              disabled={
                                rangeBusy ||
                                !currentTakeAffordance?.canUseOnTimeline ||
                                !onSelectVideoTimelineSegment
                              }
                              onClick={() =>
                                void useExistingRangeOnTimeline(range.id)
                              }
                            >
                              {range.startSec.toFixed(1)}-
                              {range.endSec.toFixed(1)}s
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      {rangeError ? (
                        <div className="rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-destructive">
                          {rangeError}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {onPromoteFrameCrop ? (
              <div className="rounded-md border border-border/70 bg-muted/30 p-2">
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                  四宫格选首帧
                </div>
                {activeFrameUrl ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {FRAME_QUADRANTS.map(quadrant => (
                      <Button
                        key={quadrant.value}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isFrameCropBusy}
                        onClick={() => void promoteQuadrant(quadrant.value)}
                      >
                        {frameCropStatus?.quadrant === quadrant.value &&
                        frameCropStatus.phase === "saving"
                          ? "保存中"
                          : frameCropStatus?.quadrant === quadrant.value &&
                              frameCropStatus.phase === "cropping"
                            ? "处理中"
                            : frameCropStatus?.quadrant === quadrant.value &&
                                frameCropStatus.phase === "done"
                              ? "已选"
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
                onClick={() =>
                  setPreparedVideoShotNo(isPrepared ? null : currentShot.shotNo)
                }
              >
                {isPrepared ? "收起视频包" : "查看视频包"}
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
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-background/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onPlayingChange(!isPlaying)}
            disabled={shots.length === 0}
            aria-label={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
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
          {currentShot
            ? `${shotLabel(currentShot)} · ${(duration / 1000).toFixed(1)}s`
            : "0.0s"}
        </div>
      </div>
    </div>
  );
}
