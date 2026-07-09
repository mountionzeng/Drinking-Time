import * as React from "react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Ban,
  Copy,
  Check,
  Clock3,
  GitBranchPlus,
  Loader2,
  MessageCircle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScanLine,
  Video,
  ZoomIn,
  ZoomOut,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SelectionContext } from "@shared/selectionContext";
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
import {
  advancePlayback,
  enteredShotNo,
  initialPlaybackState,
  seekToShot,
  shotDurationMs,
  totalDurationMs,
  MAX_SHOT_DURATION_MS,
  MIN_SHOT_DURATION_MS,
  SHOT_DURATION_STEP_MS,
  type PlaybackState,
} from "../playback";
import {
  currentVideoTakeForEditing,
  shotTimelineDurationMs,
  videoTakeAffordance,
  videoTakeDurationMs,
  videoTakeErrorMessage,
} from "../videoAssetViewModel";
import {
  buildImageRegionSelection,
  buildVideoFrameRegionSelection,
  buildVideoRangeSelection,
} from "../mediaSelectionContext";

type AnimaticPlayerProps = {
  storyId?: number | null;
  shots: CreationEditorShot[];
  progressShots?: CreationEditorShot[];
  selectedShotNo: number | null;
  durationsByShotNo?: Record<number, number>;
  onShotEnter: (shotNo: number) => void;
  isPlaying: boolean;
  onPlayingChange: (isPlaying: boolean) => void;
  onTogglePlayback?: () => void;
  onSelectContext?: (context: SelectionContext) => void;
  playbackResetKey?: number;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  onMarkVideoTakeUnusable?: (
    takeId: number,
    sourceStoryId?: number | null
  ) => Promise<void>;
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
  onCreateDerivedShotDraft?: (input: {
    sourceStableShotId: string;
    sourceTakeId: number;
    sourceTimeSec: number;
    crop: { x: number; y: number; width: number; height: number };
    fullFrameBase64: string;
    cropBase64: string;
    instruction?: string;
    referenceRole: "person" | "scene" | "object" | "composition";
  }) => Promise<{
    draftId: number;
    proposal: Record<string, unknown> | null;
    images: Array<{ id: number; imageUrl: string }>;
  }>;
  onConfirmDerivedShot?: (
    draftId: number,
    selectedImageId: number
  ) => Promise<number>;
  onUndoStoryOperation?: (operationId: number) => Promise<void>;
  onDurationChange?: (shotNo: number, durationMs: number) => void;
};

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, "0")}`;
}

function shotTextFallback(shot: CreationEditorShot | null) {
  if (!shot) return "等待镜头内容";
  const parts = [
    shot.intent,
    shot.subject,
    shot.action,
    shot.dialogue,
    shot.rationale,
  ]
    .map(part => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : shotLabel(shot);
}

function formatTimelineTime(ms: number) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

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
  storyId = null,
  shots,
  progressShots,
  selectedShotNo,
  durationsByShotNo = {},
  onShotEnter,
  isPlaying,
  onPlayingChange,
  onTogglePlayback,
  onSelectContext,
  playbackResetKey = 0,
  onRefreshShotVideoStatus,
  onMarkVideoTakeUnusable,
  onCreateVideoTakeRange,
  onSelectVideoTimelineSegment,
  onClearVideoTimelineSegment,
  onCreateDerivedShotDraft,
  onConfirmDerivedShot,
  onUndoStoryOperation,
  onDurationChange,
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
  const progressPlaybackShots = useMemo(
    () =>
      (progressShots ?? shots).map(shot => ({
        shotNo: shot.shotNo,
        dialogue: shot.dialogue,
        beat: shot.beat,
        durationMs:
          durationsByShotNo[shot.shotNo] ?? shotTimelineDurationMs(shot),
      })),
    [durationsByShotNo, progressShots, shots]
  );
  const [state, setState] = useState<PlaybackState>(() =>
    initialPlaybackState(playbackShots)
  );
  const [videoError, setVideoError] = useState<string | null>(null);
  const [markingVideoUnusable, setMarkingVideoUnusable] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [rangeDraftByTakeId, setRangeDraftByTakeId] = useState<
    Record<number, { startSec: number; endSec: number }>
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
  const [deriveSelection, setDeriveSelection] = useState<PixelSelectionRect>(
    DEFAULT_PIXEL_SELECTION
  );
  const [deriveDragStart, setDeriveDragStart] = useState<SelectionPoint | null>(
    null
  );
  const [deriveInstruction, setDeriveInstruction] = useState("");
  const [deriveCopied, setDeriveCopied] = useState(false);
  const [deriveRole, setDeriveRole] = useState<
    "person" | "scene" | "object" | "composition"
  >("composition");
  const [deriveBusy, setDeriveBusy] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [deriveResult, setDeriveResult] = useState<{
    draftId: number;
    proposal: Record<string, unknown> | null;
    images: Array<{ id: number; imageUrl: string }>;
  } | null>(null);
  const [deriveSelectedImageId, setDeriveSelectedImageId] = useState<
    number | null
  >(null);
  const [deriveOperationId, setDeriveOperationId] = useState<number | null>(
    null
  );
  const [durationControlOpen, setDurationControlOpen] = useState(false);
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
  const currentPlaybackIndex = progressPlaybackShots.findIndex(
    shot => shot.shotNo === state.currentShotNo
  );
  const elapsedBeforeCurrentShot =
    currentPlaybackIndex > 0
      ? progressPlaybackShots
          .slice(0, currentPlaybackIndex)
          .reduce((total, shot) => total + shotDurationMs(shot), 0)
      : 0;
  const fullDuration = totalDurationMs(progressPlaybackShots);
  const fullElapsed = Math.min(
    fullDuration,
    elapsedBeforeCurrentShot + Math.max(0, state.elapsedMs)
  );
  const progress =
    fullDuration > 0 ? Math.min(1, fullElapsed / fullDuration) : 0;
  const activeFrameUrl =
    currentShot?.imageUrl || currentShot?.promptRun?.imageUrl || "";
  const activeFrameId =
    currentShot?.imageId ?? currentShot?.promptRun?.imageId ?? null;
  const currentVideoTake = currentShot
    ? currentVideoTakeForEditing(currentShot.videoTakes)
    : undefined;
  const previewVideoTake =
    currentVideoTake?.videoUrl &&
    videoTakeAffordance(currentVideoTake.status).canPlay
      ? currentVideoTake
      : undefined;
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
    ? previewVideoTake
      ? {
          videoUrl: previewVideoTake.videoUrl ?? undefined,
          taskId: previewVideoTake.taskId ?? undefined,
          takeId: previewVideoTake.id,
          videoStatus: previewVideoTake.status,
          prompt: previewVideoTake.prompt,
        }
      : undefined
    : undefined;
  const deriveSourceUrl = currentVideoPreview?.videoUrl || activeFrameUrl;
  const deriveSourceType = currentVideoPreview?.videoUrl ? "video" : "image";
  const deriveVideoTakeId =
    currentVideoPreview?.takeId ?? currentVideoTake?.id ?? null;
  const canPersistDerivedFrame =
    deriveSourceType === "video" &&
    currentVideoTake?.extractionCapability === "available";
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
      width: Math.round((deriveSelection.width / 100) * deriveMediaSize.width),
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
      setDeriveError(null);
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
  const canRefreshVideo = Boolean(
    currentVideoTake?.taskId &&
      onRefreshShotVideoStatus &&
      ["submitted", "processing"].includes(currentVideoTake.status)
  );
  const canMarkCurrentVideoUnusable = Boolean(
    currentVideoTake &&
      onMarkVideoTakeUnusable &&
      currentVideoTake.status !== "unfollowable" &&
      currentTakeAffordance &&
      (currentTakeAffordance.canPlay || currentTakeAffordance.canRefresh)
  );
  const changeCurrentShotDuration = (nextDurationMs: number) => {
    if (!currentShot || !onDurationChange) return;
    const clamped = Math.min(
      MAX_SHOT_DURATION_MS,
      Math.max(MIN_SHOT_DURATION_MS, Math.round(nextDurationMs))
    );
    onDurationChange(currentShot.shotNo, clamped);
  };
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

  const refreshVideoStatus = async () => {
    if (!currentVideoTake?.id || !onRefreshShotVideoStatus) return;
    setVideoError(null);
    try {
      await onRefreshShotVideoStatus(currentVideoTake.id);
    } catch (error) {
      setVideoError(
        error instanceof Error ? error.message : "视频状态刷新失败"
      );
    }
  };

  const markCurrentVideoUnusable = async () => {
    if (!currentVideoTake?.id || !onMarkVideoTakeUnusable) return;
    setVideoError(null);
    setMarkingVideoUnusable(true);
    try {
      await onMarkVideoTakeUnusable(
        currentVideoTake.id,
        currentVideoTake.storyId
      );
    } catch (error) {
      setVideoError(
        error instanceof Error ? error.message : "视频 Take 标记失败"
      );
    } finally {
      setMarkingVideoUnusable(false);
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
    if (!deriveContextMessage || !storyId || !currentShot || !onSelectContext) {
      return;
    }
    const rect = {
      x: deriveSelection.x / 100,
      y: deriveSelection.y / 100,
      width: deriveSelection.width / 100,
      height: deriveSelection.height / 100,
    };
    if (deriveSourceType === "video" && deriveVideoTakeId != null) {
      onSelectContext(
        buildVideoFrameRegionSelection({
          storyId,
          shot: currentShot,
          takeId: deriveVideoTakeId,
          timeSec: deriveFrameTimeSec,
          rect,
        })
      );
    } else if (activeFrameUrl) {
      onSelectContext(
        buildImageRegionSelection({
          storyId,
          shot: currentShot,
          imageId: activeFrameId,
          imageUrl: activeFrameUrl,
          rect,
        })
      );
    } else {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("dt:open-creation-chat", {
        detail: {
          draftMessage: deriveContextMessage,
          preserveSelection: true,
        },
      })
    );
    setDeriveWorkbenchOpen(false);
  };
  const canOpenSelectionInChat = Boolean(
    deriveContextMessage &&
      storyId &&
      onSelectContext &&
      (deriveSourceType === "video"
        ? deriveVideoTakeId != null
        : Boolean(activeFrameUrl))
  );

  const openRangeInChat = () => {
    if (
      !storyId ||
      !currentShot ||
      !currentVideoTake ||
      !rangeDraft ||
      !onSelectContext
    ) {
      return;
    }
    const persistedRange = currentVideoTake.ranges.find(
      range =>
        Math.abs(range.startSec - rangeDraft.startSec) < 0.05 &&
        Math.abs(range.endSec - rangeDraft.endSec) < 0.05
    );
    onSelectContext(
      buildVideoRangeSelection({
        storyId,
        shot: currentShot,
        takeId: currentVideoTake.id,
        rangeId: persistedRange?.id ?? null,
        startSec: rangeDraft.startSec,
        endSec: rangeDraft.endSec,
        durationSec: currentTakeDurationSec,
      })
    );
    window.dispatchEvent(
      new CustomEvent("dt:open-creation-chat", {
        detail: {
          draftMessage: `请帮我判断 ${shotLabel(currentShot)} 的 ${rangeDraft.startSec.toFixed(1)}-${rangeDraft.endSec.toFixed(1)}s 这段是否适合保留，或者应该怎样调整镜头。`,
          preserveSelection: true,
        },
      })
    );
  };

  const copySelectionContext = async () => {
    if (!deriveContextMessage || !navigator.clipboard) return;
    await navigator.clipboard.writeText(deriveContextMessage);
    setDeriveCopied(true);
    window.setTimeout(() => setDeriveCopied(false), 1600);
  };

  const captureDerivationFrame = () => {
    const video = deriveVideoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("视频帧尚未准备好，请稍后重试");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法读取当前视频帧");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const fullFrameBase64 = canvas.toDataURL("image/png");
    const sx = Math.round((deriveSelection.x / 100) * canvas.width);
    const sy = Math.round((deriveSelection.y / 100) * canvas.height);
    const sw = Math.max(
      1,
      Math.round((deriveSelection.width / 100) * canvas.width)
    );
    const sh = Math.max(
      1,
      Math.round((deriveSelection.height / 100) * canvas.height)
    );
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) throw new Error("浏览器无法裁切当前视频帧");
    cropContext.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return {
      fullFrameBase64,
      cropBase64: cropCanvas.toDataURL("image/png"),
    };
  };

  const createDerivedCandidates = async () => {
    if (
      !currentShot?.stableShotId ||
      !currentVideoTake ||
      !onCreateDerivedShotDraft
    )
      return;
    setDeriveBusy(true);
    setDeriveError(null);
    try {
      const capture = captureDerivationFrame();
      const result = await onCreateDerivedShotDraft({
        sourceStableShotId: currentShot.stableShotId,
        sourceTakeId: currentVideoTake.id,
        sourceTimeSec: deriveFrameTimeSec,
        crop: {
          x: deriveSelection.x / 100,
          y: deriveSelection.y / 100,
          width: deriveSelection.width / 100,
          height: deriveSelection.height / 100,
        },
        ...capture,
        instruction: deriveInstruction.trim() || undefined,
        referenceRole: deriveRole,
      });
      setDeriveResult(result);
      setDeriveSelectedImageId(result.images[0]?.id ?? null);
    } catch (error) {
      setDeriveError(
        error instanceof Error ? error.message : "派生候选生成失败"
      );
    } finally {
      setDeriveBusy(false);
    }
  };

  const confirmDerivedCandidate = async () => {
    if (!deriveResult || deriveSelectedImageId == null || !onConfirmDerivedShot)
      return;
    setDeriveBusy(true);
    setDeriveError(null);
    try {
      const operationId = await onConfirmDerivedShot(
        deriveResult.draftId,
        deriveSelectedImageId
      );
      setDeriveOperationId(operationId);
    } catch (error) {
      setDeriveError(
        error instanceof Error ? error.message : "派生镜头确认失败"
      );
    } finally {
      setDeriveBusy(false);
    }
  };

  const undoDerivedOperation = async () => {
    if (deriveOperationId == null || !onUndoStoryOperation) return;
    setDeriveBusy(true);
    try {
      await onUndoStoryOperation(deriveOperationId);
      setDeriveOperationId(null);
      setDeriveResult(null);
      setDeriveSelectedImageId(null);
    } catch (error) {
      setDeriveError(error instanceof Error ? error.message : "撤销失败");
    } finally {
      setDeriveBusy(false);
    }
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
          <div className="max-w-lg px-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Play className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {currentShot ? shotLabel(currentShot) : "未选镜头"}
            </p>
            <p className="mt-2 text-base font-medium leading-relaxed text-foreground">
              {shotTextFallback(currentShot)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              暂无画面素材，播放时先以文字镜头占位。
            </p>
          </div>
        )}
        {(currentVideoPreview?.videoUrl || activeFrameUrl) &&
        currentShot?.dialogue ? (
          <div className="absolute inset-x-6 bottom-5 rounded-md bg-background/88 px-4 py-3 text-center text-sm shadow-sm backdrop-blur">
            {currentShot.dialogue}
          </div>
        ) : null}
      </div>

      {currentShot ? (
        <div className="text-xs">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold text-foreground">
                <ScanLine className="h-3.5 w-3.5 text-primary" />
                <span className="min-w-[52px] whitespace-nowrap">剪辑素材</span>
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
                  variant={durationControlOpen ? "default" : "outline"}
                  onClick={() => setDurationControlOpen(open => !open)}
                  disabled={!onDurationChange}
                  aria-label={
                    currentShot
                      ? `调整${shotLabel(currentShot)}时长`
                      : "调整镜头时长"
                  }
                >
                  <Clock3 className="h-4 w-4" />
                  时长 {(duration / 1000).toFixed(1)}s
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={deriveWorkbenchOpen ? "default" : "outline"}
                  onClick={() => setDeriveWorkbenchOpen(true)}
                  disabled={!deriveSourceUrl}
                  title={
                    deriveSourceType === "image"
                      ? "框选当前主图区域并发送给小酌"
                      : canPersistDerivedFrame
                        ? "框选视频帧区域，可先问小酌，也可继续派生新镜头"
                        : "可以框选并询问小酌；当前视频尚未完成同源托管，暂时不能生成派生候选"
                  }
                >
                  <ScanLine className="h-4 w-4" />
                  框选问小酌
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

            {durationControlOpen ? (
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      {shotLabel(currentShot)} 时长
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      调整后会同步影响播放进度和底部时间轴。
                    </div>
                  </div>
                  <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold tabular-nums text-foreground">
                    {(duration / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => changeCurrentShotDuration(duration - 200)}
                    disabled={duration <= MIN_SHOT_DURATION_MS}
                    aria-label={`缩短${shotLabel(currentShot)}时长`}
                  >
                    <Minus className="h-4 w-4" />
                    0.2s
                  </Button>
                  <Slider
                    min={MIN_SHOT_DURATION_MS}
                    max={MAX_SHOT_DURATION_MS}
                    step={SHOT_DURATION_STEP_MS}
                    value={[duration]}
                    onValueChange={value =>
                      changeCurrentShotDuration(value[0] ?? duration)
                    }
                    aria-label={`${shotLabel(currentShot)} 时长`}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => changeCurrentShotDuration(duration + 200)}
                    disabled={duration >= MAX_SHOT_DURATION_MS}
                    aria-label={`延长${shotLabel(currentShot)}时长`}
                  >
                    <Plus className="h-4 w-4" />
                    0.2s
                  </Button>
                </div>
              </div>
            ) : null}

            {currentVideoTake?.errorMessage ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 leading-5 text-destructive">
                {`当前 Take ${currentVideoTake.id} 失败原因：${videoTakeErrorMessage(currentVideoTake.errorMessage)}`}
              </p>
            ) : null}
          </div>

          {currentVideoTake ? (
            <div className="mt-3 grid gap-2 text-muted-foreground">
              <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
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
                        markingVideoUnusable || !canMarkCurrentVideoUnusable
                      }
                      onClick={() => void markCurrentVideoUnusable()}
                    >
                      {markingVideoUnusable ? (
                        <Loader2 className="h-3.5 w-3.5" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" />
                      )}
                      标记不可用
                    </Button>
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
                      当前视频 {currentTakeDurationSec.toFixed(1)}
                      s，拖动入点/出点框选一段；可以先发给小酌判断，也可以保存到时间轴。
                      {playbackSpeed !== 1.0
                        ? ` 以 ${playbackSpeed}x 速度播放，时间轴时长约 ${((rangeDraft.endSec - rangeDraft.startSec) / playbackSpeed).toFixed(1)}s。`
                        : ` 时间轴时长 ${(rangeDraft.endSec - rangeDraft.startSec).toFixed(1)}s。`}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
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
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!storyId || !onSelectContext}
                        onClick={openRangeInChat}
                      >
                        <MessageCircle className="h-4 w-4" />
                        发送给小酌
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
                        {range.startSec.toFixed(1)}-{range.endSec.toFixed(1)}s
                      </Button>
                    ))}
                  </div>
                ) : null}
                {rangeError ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-destructive">
                    {rangeError}
                  </div>
                ) : null}
                {videoError ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-destructive">
                    {videoError}
                  </div>
                ) : null}
              </div>
            </div>
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
                  先选帧和画面局部，再发送给小酌判断；派生候选生成是单独的下一步。
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
                      拖拽框选，右侧发送给小酌
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
                    onValueChange={value => setDeriveFrameIndex(value[0] ?? 0)}
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
                  这块区域用来参考什么
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {(
                    [
                      ["person", "人物"],
                      ["scene", "场景"],
                      ["object", "物件"],
                      ["composition", "构图"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDeriveRole(value)}
                      className={`h-8 rounded-md border text-[11px] transition ${
                        deriveRole === value
                          ? "border-primary bg-primary/10 font-medium text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
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

              {deriveResult ? (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-xs font-semibold text-foreground">
                    小酌建议
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {String(
                      deriveResult.proposal?.intent ||
                        deriveResult.proposal?.subject ||
                        "以选中区域为锚点补充一个新镜头"
                    )}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {deriveResult.images.map(image => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => setDeriveSelectedImageId(image.id)}
                        className={`relative overflow-hidden rounded-md border ${
                          deriveSelectedImageId === image.id
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-border"
                        }`}
                      >
                        <img
                          src={image.imageUrl}
                          alt="派生候选"
                          className="aspect-video w-full object-cover"
                        />
                        {deriveSelectedImageId === image.id ? (
                          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {deriveError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {deriveError}
                </div>
              ) : null}

              <div className="mt-auto flex flex-wrap justify-end gap-2">
                {deriveOperationId == null ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={openSelectionInChat}
                    disabled={!canOpenSelectionInChat}
                  >
                    <MessageCircle className="h-4 w-4" />
                    发送给小酌
                  </Button>
                ) : null}
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
                  variant={deriveResult ? "default" : "outline"}
                  onClick={() =>
                    deriveResult
                      ? void confirmDerivedCandidate()
                      : void createDerivedCandidates()
                  }
                  disabled={
                    deriveBusy ||
                    !canPersistDerivedFrame ||
                    (deriveResult != null && deriveSelectedImageId == null)
                  }
                >
                  {deriveBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : deriveResult ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <GitBranchPlus className="h-4 w-4" />
                  )}
                  {deriveResult ? "确认派生镜头" : "生成派生候选"}
                </Button>
                {deriveOperationId != null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void undoDerivedOperation()}
                    disabled={deriveBusy}
                  >
                    <Undo2 className="h-4 w-4" />
                    撤销派生
                  </Button>
                ) : null}
              </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-1">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              onTogglePlayback
                ? onTogglePlayback()
                : onPlayingChange(!isPlaying)
            }
            disabled={shots.length === 0}
            aria-label={isPlaying ? "暂停全片" : "播放全片"}
            title={isPlaying ? "暂停全片" : "播放全片"}
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
            ? `${shotLabel(currentShot)} · ${formatTimelineTime(fullElapsed)} / ${formatTimelineTime(fullDuration)}`
            : "0.0s"}
        </div>
      </div>
    </div>
  );
}
