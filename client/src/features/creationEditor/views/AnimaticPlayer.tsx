import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Copy,
  GitBranchPlus,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
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

type SelectionPoint = {
  x: number;
  y: number;
};

type PixelSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DERIVE_FRAME_RATE = 24;
const DEFAULT_PIXEL_SELECTION: PixelSelectionRect = {
  x: 30,
  y: 24,
  width: 38,
  height: 34,
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

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizePixelSelection(
  start: SelectionPoint,
  end: SelectionPoint
): PixelSelectionRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return {
    x: clampPercent(left),
    y: clampPercent(top),
    width: Math.max(3, clampPercent(right - left)),
    height: Math.max(3, clampPercent(bottom - top)),
  };
}

function pct(value: number) {
  return `${Math.round(value)}%`;
}

function frameSampleIndexes(totalFrames: number, maxSamples = 12) {
  const total = Math.max(1, totalFrames);
  const count = Math.min(total, maxSamples);
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) =>
    Math.min(total - 1, Math.round((index / (count - 1)) * (total - 1)))
  );
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
  const deriveStageRef = useRef<HTMLDivElement | null>(null);
  const deriveVideoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [deriveWorkbenchOpen, setDeriveWorkbenchOpen] = useState(false);
  const [deriveZoom, setDeriveZoom] = useState(1);
  const [deriveFrameIndex, setDeriveFrameIndex] = useState(0);
  const [deriveSelection, setDeriveSelection] =
    useState<PixelSelectionRect>(DEFAULT_PIXEL_SELECTION);
  const [deriveDragStart, setDeriveDragStart] =
    useState<SelectionPoint | null>(null);
  const [deriveInstruction, setDeriveInstruction] = useState("");
  const [deriveCopied, setDeriveCopied] = useState(false);
  const [deriveMediaSize, setDeriveMediaSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

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
  const deriveSourceUrl = currentVideoPreview?.videoUrl || activeFrameUrl;
  const deriveSourceType = currentVideoPreview?.videoUrl ? "video" : "image";
  const deriveDurationSec =
    deriveSourceType === "video"
      ? Math.max(0.1, currentTakeDurationSec)
      : Math.max(0.1, duration / 1000 || 0.1);
  const deriveFrameCount =
    deriveSourceType === "video"
      ? Math.max(1, Math.round(deriveDurationSec * DERIVE_FRAME_RATE))
      : 1;
  const deriveFrameTimeSec =
    deriveSourceType === "video"
      ? Math.min(
          deriveDurationSec,
          Number((deriveFrameIndex / DERIVE_FRAME_RATE).toFixed(2))
        )
      : 0;
  const deriveFrameSamples = useMemo(
    () => frameSampleIndexes(deriveFrameCount),
    [deriveFrameCount]
  );
  const deriveSelectionPixels = useMemo(() => {
    if (!deriveMediaSize) return null;
    return {
      x: Math.round((deriveSelection.x / 100) * deriveMediaSize.width),
      y: Math.round((deriveSelection.y / 100) * deriveMediaSize.height),
      width: Math.round(
        (deriveSelection.width / 100) * deriveMediaSize.width
      ),
      height: Math.round(
        (deriveSelection.height / 100) * deriveMediaSize.height
      ),
    };
  }, [deriveMediaSize, deriveSelection]);
  const deriveContextMessage = useMemo(() => {
    if (!currentShot) return "";
    const frameText =
      deriveSourceType === "video"
        ? `视频帧 ${deriveFrameIndex + 1}/${deriveFrameCount}，约 ${deriveFrameTimeSec.toFixed(2)}s`
        : "当前主图静帧";
    const pixelText = deriveSelectionPixels
      ? `像素区域：左上 (${deriveSelectionPixels.x}, ${deriveSelectionPixels.y})，尺寸 ${deriveSelectionPixels.width} x ${deriveSelectionPixels.height}px`
      : `画面区域：x ${pct(deriveSelection.x)}，y ${pct(deriveSelection.y)}，宽 ${pct(deriveSelection.width)}，高 ${pct(deriveSelection.height)}`;
    return [
      `我想从 ${shotLabel(currentShot)} 派生一个新镜头。`,
      `素材：${frameText}`,
      pixelText,
      currentShot.intent ? `原镜头任务：${currentShot.intent}` : "",
      currentShot.dialogue ? `原台词/声音：${currentShot.dialogue}` : "",
      deriveInstruction.trim()
        ? `我想让小酌做：${deriveInstruction.trim()}`
        : "我想让小酌做：以这个局部为基础，判断能不能图生图派生新镜头。",
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    currentShot,
    deriveFrameCount,
    deriveFrameIndex,
    deriveFrameTimeSec,
    deriveInstruction,
    deriveSelection,
    deriveSelectionPixels,
    deriveSourceType,
  ]);
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    video.playbackRate = playbackSpeed;
  }, [playbackSpeed]);
  useEffect(() => {
    setDeriveFrameIndex(current =>
      Math.max(0, Math.min(current, deriveFrameCount - 1))
    );
  }, [deriveFrameCount]);
  useEffect(() => {
    if (!deriveWorkbenchOpen) return;
    const video = deriveVideoRef.current;
    if (!video || deriveSourceType !== "video") return;
    try {
      video.currentTime = deriveFrameTimeSec;
    } catch {
      // Some remote videos reject seeking until metadata is ready.
    }
  }, [deriveFrameTimeSec, deriveSourceType, deriveWorkbenchOpen]);
  useEffect(() => {
    if (!deriveWorkbenchOpen) {
      setDeriveDragStart(null);
      setDeriveCopied(false);
    }
  }, [deriveWorkbenchOpen]);
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
  const providerStatusText = !shotVideoProviderStatus
    ? "正在检查视频服务配置。"
    : providerMissing.length > 0
      ? `后端缺：${providerMissing.join(" / ")}。`
      : providerWarnings.length > 0
        ? `后端提醒：${providerWarnings.join(" / ")} 未配置，异步视频可能无法刷新。`
        : "";
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

  const refreshVideoStatus = async () => {
    if (!currentVideoTake?.id || !onRefreshShotVideoStatus) return;
    setVideoError(null);
    try {
      await onRefreshShotVideoStatus(currentVideoTake.id);
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "视频状态刷新失败");
    }
  };

  const pointFromSelectionEvent = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = deriveStageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
      y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100),
    };
  };

  const beginPixelSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!deriveSourceUrl) return;
    const point = pointFromSelectionEvent(event);
    setDeriveDragStart(point);
    setDeriveSelection({ x: point.x, y: point.y, width: 3, height: 3 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updatePixelSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!deriveDragStart) return;
    setDeriveSelection(
      normalizePixelSelection(deriveDragStart, pointFromSelectionEvent(event))
    );
  };

  const finishPixelSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (deriveDragStart) {
      setDeriveSelection(
        normalizePixelSelection(deriveDragStart, pointFromSelectionEvent(event))
      );
    }
    setDeriveDragStart(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const openSelectionInChat = () => {
    if (!deriveContextMessage) return;
    window.dispatchEvent(
      new CustomEvent("dt:open-creation-chat", {
        detail: { draftMessage: deriveContextMessage },
      })
    );
    setDeriveWorkbenchOpen(false);
  };

  const copySelectionContext = async () => {
    if (!deriveContextMessage || !navigator.clipboard) return;
    await navigator.clipboard.writeText(deriveContextMessage);
    setDeriveCopied(true);
    window.setTimeout(() => setDeriveCopied(false), 1600);
  };

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
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
        <div className="rounded-md border border-border/70 bg-background p-3 text-xs">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold text-foreground">
                <Video className="h-3.5 w-3.5 text-primary" />
                <span className="min-w-[52px] whitespace-nowrap">镜头动作</span>
                <span
                  className={`min-w-[64px] shrink-0 rounded-full border px-2 py-0.5 text-center text-[11px] font-normal ${
                    currentVideoPreview?.videoUrl
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                      : activeFrameUrl
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-700"
                  }`}
                >
                  {currentVideoPreview?.videoUrl
                    ? "当前视频"
                    : activeFrameUrl
                      ? "当前主图"
                      : "缺素材"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={deriveWorkbenchOpen ? "default" : "outline"}
                  onClick={() => setDeriveWorkbenchOpen(true)}
                  disabled={!deriveSourceUrl}
                >
                  <GitBranchPlus className="h-4 w-4" />
                  派生新镜头
                </Button>
                {canRefreshVideo ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshVideoStatus()}
                    aria-label="刷新视频状态"
                  >
                    <Video className="h-4 w-4" />
                    刷新视频状态
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 leading-5 text-muted-foreground">
              {frameDisplayStatusText}
              {!currentVideoPreview?.videoUrl && videoMissing.length > 0
                ? ` 还缺：${videoMissing.join(" / ")}。`
                : ""}
              {providerStatusText ? ` ${providerStatusText}` : ""}
              {currentVideoTake ? ` 当前视频：${currentVideoTake.status}。` : ""}
              {!canRefreshVideo
                ? " 视频生成在故事版看板完成，需要视频时回故事版看板生成或重试。"
                : ""}
            </div>

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

          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_176px]">
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

      <Dialog open={deriveWorkbenchOpen} onOpenChange={setDeriveWorkbenchOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[min(1180px,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <GitBranchPlus className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-base">
                  {currentShot
                    ? `从 ${shotLabel(currentShot)} 派生新镜头`
                    : "派生新镜头"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs">
                  先选帧和画面局部；图片生成和新镜头判断交给小酌继续。
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid max-h-[calc(100vh-7.5rem)] min-h-[520px] overflow-hidden lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0 overflow-auto bg-muted/20 p-4">
              <div
                ref={deriveStageRef}
                className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-md border border-border bg-black"
              >
                {deriveSourceUrl ? (
                  <>
                    <div
                      className="absolute inset-0 flex items-center justify-center transition-transform duration-150"
                      style={{ transform: `scale(${deriveZoom})` }}
                    >
                      {deriveSourceType === "video" ? (
                        <video
                          ref={deriveVideoRef}
                          src={deriveSourceUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="max-h-full max-w-full object-contain"
                          onLoadedMetadata={event => {
                            const video = event.currentTarget;
                            setDeriveMediaSize({
                              width: video.videoWidth || 1920,
                              height: video.videoHeight || 1080,
                            });
                            try {
                              video.currentTime = deriveFrameTimeSec;
                            } catch {
                              // Seeking can wait until the media element is ready.
                            }
                          }}
                        />
                      ) : (
                        <img
                          src={deriveSourceUrl}
                          alt={
                            currentShot
                              ? `${shotLabel(currentShot)} 派生取样`
                              : "派生取样"
                          }
                          className="max-h-full max-w-full object-contain"
                          onLoad={event => {
                            const image = event.currentTarget;
                            setDeriveMediaSize({
                              width: image.naturalWidth || image.width,
                              height: image.naturalHeight || image.height,
                            });
                          }}
                        />
                      )}
                    </div>
                    <div
                      className="absolute inset-0 cursor-crosshair touch-none"
                      onPointerDown={beginPixelSelection}
                      onPointerMove={updatePixelSelection}
                      onPointerUp={finishPixelSelection}
                      onPointerCancel={finishPixelSelection}
                      aria-label="框选派生像素区域"
                      role="presentation"
                    >
                      <div
                        className="absolute rounded-sm border-2 border-primary bg-primary/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]"
                        style={{
                          left: `${deriveSelection.x}%`,
                          top: `${deriveSelection.y}%`,
                          width: `${deriveSelection.width}%`,
                          height: `${deriveSelection.height}%`,
                        }}
                      />
                    </div>
                    <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
                      <ScanLine className="h-3.5 w-3.5 text-primary" />
                      拖拽框选画面局部
                    </div>
                  </>
                ) : (
                  <div className="px-6 text-center text-sm text-muted-foreground">
                    当前镜头还没有可派生的图片或视频。
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      帧 {deriveFrameIndex + 1} / {deriveFrameCount}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {deriveSourceType === "video"
                        ? `${deriveFrameTimeSec.toFixed(2)}s · 按 24fps 映射`
                        : "当前主图静帧"}
                    </div>
                  </div>
                  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {deriveSourceType === "video" ? "视频取帧" : "图片取样"}
                  </span>
                </div>
                <div className="mt-3">
                  <Slider
                    min={0}
                    max={Math.max(0, deriveFrameCount - 1)}
                    step={1}
                    value={[deriveFrameIndex]}
                    disabled={deriveFrameCount <= 1}
                    onValueChange={value =>
                      setDeriveFrameIndex(value[0] ?? 0)
                    }
                    aria-label="选择派生帧"
                  />
                </div>
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                  {deriveFrameSamples.map(index => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setDeriveFrameIndex(index)}
                      className={`min-w-[68px] rounded-md border px-2 py-1.5 text-left transition ${
                        deriveFrameIndex === index
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <span className="block text-[11px] font-semibold">
                        F{index + 1}
                      </span>
                      <span className="mt-0.5 block text-[10px]">
                        {deriveSourceType === "video"
                          ? `${(index / DERIVE_FRAME_RATE).toFixed(2)}s`
                          : "主图"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-l border-border bg-background p-4">
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    画面缩放
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {deriveZoom.toFixed(1)}x
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ZoomOut className="h-4 w-4 text-muted-foreground" />
                  <Slider
                    min={1}
                    max={4}
                    step={0.1}
                    value={[deriveZoom]}
                    onValueChange={value => setDeriveZoom(value[0] ?? 1)}
                    aria-label="派生画面缩放"
                  />
                  <ZoomIn className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="text-xs font-semibold text-foreground">
                  选中区域
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <span>x {pct(deriveSelection.x)}</span>
                  <span>y {pct(deriveSelection.y)}</span>
                  <span>宽 {pct(deriveSelection.width)}</span>
                  <span>高 {pct(deriveSelection.height)}</span>
                </div>
                {deriveSelectionPixels ? (
                  <div className="mt-2 rounded-md bg-background px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
                    约 {deriveSelectionPixels.width} x{" "}
                    {deriveSelectionPixels.height}px，左上{" "}
                    {deriveSelectionPixels.x}, {deriveSelectionPixels.y}
                  </div>
                ) : null}
              </div>

              <label className="block text-xs font-semibold text-foreground">
                告诉小酌怎么派生
                <Textarea
                  value={deriveInstruction}
                  onChange={event => setDeriveInstruction(event.target.value)}
                  placeholder="例如：用这块窗边的光和人物背影，生成一个更近的反应镜头。"
                  className="mt-2 min-h-24 resize-none text-xs"
                />
              </label>

              <div className="min-h-[150px] rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-2 text-xs font-semibold text-foreground">
                  给小酌的上下文
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                  {deriveContextMessage}
                </pre>
              </div>

              <div className="mt-auto flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copySelectionContext()}
                  disabled={!deriveContextMessage}
                >
                  <Copy className="h-4 w-4" />
                  {deriveCopied ? "已复制" : "复制上下文"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={openSelectionInChat}
                  disabled={!deriveContextMessage}
                >
                  <MessageCircle className="h-4 w-4" />
                  去问小酌
                </Button>
              </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>

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
