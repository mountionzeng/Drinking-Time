import { Check, Crosshair, Loader2, Pencil, Video } from "lucide-react";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import type { TimelineTransform } from "@shared/storyMaterial";
import type { SubtitleRenderPlan } from "@shared/timelineSubtitleModel";

import { trpc } from "@/lib/trpc";
import { formatStoryboardTimestamp } from "@/features/storyAgent/storyboardTiming";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import type { ImageRegionEditHandoffRunner } from "@/features/storyAgent/imageRegionEditHandoff";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import type {
  ChatCutTimelineClip,
  ChatCutTimelineManifest,
} from "../chatCutTimeline";
import { chatCutSourceNameFromShot } from "../chatCutTimeline";
import type { CreationEditorShot } from "../types";
import {
  normalizeVideoClipEditDraft,
  timelineVideoMotionStyle,
} from "../videoClipEditorModel";
import {
  timelineTransformStyle,
  type ImageClipEditorTarget,
} from "../imageClipEditorModel";
import {
  INITIAL_PREVIEW_OBJECT_MASK_STATE,
  confirmedPreviewMaskSelection,
  previewMaskSelectionMatchesSession,
  resetPreviewMaskSessionForTargetChange,
  previewObjectMaskReducer,
} from "../previewObjectMaskEditing";
import { previewPathToSourcePolygon } from "../previewObjectMaskGeometry";
import {
  PREVIEW_CANVAS_INSET_PX,
  VIDEO_END_HOLD_EPSILON_SECONDS,
  fitProjectCanvas,
  playableVideoUrl,
  previewMediaLayerPlan,
  shotImageUrl,
  shotLabel,
  shouldForwardPreviewPause,
  previewSubtitleLines,
  timelineVideoPlaybackRate,
  timelineVideoShouldHoldLastFrame,
  type TimelineVideoSource,
  type VideoEditorPreview,
} from "../previewPlaybackModel";

export default function ShotPreview({
  shot,
  timing,
  sourceClip,
  timelineVideoSource,
  timelineImageSource,
  editorPreview,
  suppressDefaultVideo,
  playheadMs,
  playheadFrame,
  timelinePlaying,
  format,
  subtitlePlan,
  muteVisualSourceAudio = false,
  onRequestTimelinePlaying,
  keyboardShortcutZoneRef,
  onEditImage,
  onSelectImageForChat,
  onEditCurrentVideoFrame,
  storyId,
  maskEditTarget,
  onMaskAdopted,
  extractingCurrentVideoFrame = false,
}: {
  shot: CreationEditorShot | null;
  timing?: { startMs: number; endMs: number; durationMs: number };
  sourceClip?: ChatCutTimelineClip | null;
  timelineVideoSource?: TimelineVideoSource | null;
  timelineImageSource?: {
    imageUrl: string;
    transform?: TimelineTransform;
  } | null;
  editorPreview?: VideoEditorPreview | null;
  suppressDefaultVideo?: boolean;
  playheadMs: number;
  playheadFrame?: number;
  timelinePlaying: boolean;
  format: ChatCutTimelineManifest | null;
  /**
   * 正式字幕轨。有 cue 时 Preview 只显示它；没有时才回落到 `format`/dialogue
   * 算出的只读候选，并在界面上标出来。
   */
  subtitlePlan?: SubtitleRenderPlan | null;
  /** True when Web Audio owns all video/source sound for this Story. */
  muteVisualSourceAudio?: boolean;
  onRequestTimelinePlaying: (isPlaying: boolean) => void;
  keyboardShortcutZoneRef: { current: boolean };
  onEditImage?: () => void;
  onSelectImageForChat?: () => void;
  onEditCurrentVideoFrame?: () => void;
  storyId?: number | null;
  maskEditTarget?: ImageClipEditorTarget | null;
  onMaskAdopted?: () => void;
  extractingCurrentVideoFrame?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const maskPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const { registerImageRegionEditRunner, setActiveSelection } =
    useStoryAgentActions();
  const ignoreNextVideoPauseRef = useRef(false);
  const previewControlInteractionAtRef = useRef<number | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const [previewStageSize, setPreviewStageSize] = useState({
    width: 0,
    height: 0,
  });
  const [maskState, dispatchMask] = useReducer(
    previewObjectMaskReducer,
    INITIAL_PREVIEW_OBJECT_MASK_STATE
  );
  const maskStateRef = useRef(maskState);
  maskStateRef.current = maskState;
  const [maskPrompt, setMaskPrompt] = useState("");
  const publishedMaskKeyRef = useRef<string | null>(null);
  const [previewImageSize, setPreviewImageSize] = useState({
    width: 0,
    height: 0,
  });
  const [maskDrag, setMaskDrag] = useState<{
    pointerId: number;
    points: Array<{ x: number; y: number }>;
  } | null>(null);
  const maskCapabilitiesQuery =
    trpc.creationAgent.maskSelectionCapabilities.useQuery(undefined, {
      staleTime: 60_000,
    });
  const segmentRegionMutation = trpc.creationAgent.segmentRegion.useMutation();
  const quoteInpaintMutation = trpc.creationAgent.quoteInpaint.useMutation();
  const inpaintMutation = trpc.creationAgent.inpaint.useMutation();
  const adoptMutation = trpc.creationAgent.adoptInpaintCandidate.useMutation();
  const latestCandidateQuery =
    trpc.creationAgent.latestInpaintCandidate.useQuery(
      {
        storyId: storyId ?? 0,
        sourceImageId: maskState.target?.imageId ?? 0,
        targetKind: maskState.target?.targetKind ?? "shot-primary",
        stableShotId: maskState.target?.stableShotId ?? "pending",
        ...(maskState.target?.clipId
          ? { clipId: maskState.target.clipId }
          : {}),
      },
      {
        enabled: Boolean(
          storyId && maskState.target && maskState.phase === "selecting"
        ),
        staleTime: 0,
      }
    );
  const maskedEstimate = estimateStoryboardMaskedEditCost();
  const maskSubmitInFlightRef = useRef(false);
  const maskSessionPlayheadRef = useRef<number | null>(null);
  const maskSessionEpochRef = useRef(0);
  const clearPublishedMaskSelection = useCallback(() => {
    const maskKey = publishedMaskKeyRef.current;
    if (!maskKey) return;
    const current = storySpineStore.getState().activeSelection;
    if (current?.confirmedImageRegion?.maskKey === maskKey) {
      setActiveSelection(null);
    }
    publishedMaskKeyRef.current = null;
  }, [setActiveSelection]);
  const resetMaskSession = useCallback(() => {
    clearPublishedMaskSelection();
    maskSessionEpochRef.current += 1;
    dispatchMask({ type: "reset" });
    setMaskPrompt("");
    setMaskDrag(null);
    maskSessionPlayheadRef.current = null;
  }, [clearPublishedMaskSelection]);

  const confirmMaskForChat = useCallback(() => {
    if (!storyId || !maskState.target || !maskState.mask) return;
    dispatchMask({ type: "confirm-mask" });
    setActiveSelection(
      confirmedPreviewMaskSelection({
        storyId,
        target: maskState.target,
        mask: maskState.mask,
      })
    );
    publishedMaskKeyRef.current = maskState.mask.maskKey;
    toast.success("局部选区已放进聊天框，只会修改确认区域");
  }, [maskState.mask, maskState.target, setActiveSelection, storyId]);

  const reselectMaskRegion = useCallback(() => {
    clearPublishedMaskSelection();
    dispatchMask({ type: "reselect" });
  }, [clearPublishedMaskSelection]);

  useEffect(() => {
    const runner: ImageRegionEditHandoffRunner = async ({
      instruction,
      selection,
    }) => {
      if (
        !previewMaskSelectionMatchesSession({
          selection,
          storyId,
          state: maskStateRef.current,
        })
      ) {
        return {
          status: "error",
          stale: true,
          message: "图片或局部蒙版已经变化，请在 Preview 里重新确认区域",
        };
      }
      setMaskPrompt(instruction);
      globalThis.requestAnimationFrame?.(() => maskPromptRef.current?.focus());
      return {
        status: "success",
        message:
          "已把修改要求填入 Preview。请核对局部选区和费用后手动生成；现在还没有提交付费任务。",
      };
    };
    return registerImageRegionEditRunner(runner);
  }, [registerImageRegionEditRunner, storyId]);
  const normalizedEditorDraft = editorPreview
    ? normalizeVideoClipEditDraft(
        editorPreview.draft,
        editorPreview.target.mediaDurationSec
      )
    : null;
  const mediaLayerPlan = previewMediaLayerPlan({
    timelineImageUrl: timelineImageSource?.imageUrl,
    editorVideoUrl: editorPreview?.target.videoUrl,
    timelineVideoUrl: timelineVideoSource?.videoUrl,
    fallbackVideoUrl: suppressDefaultVideo ? null : playableVideoUrl(shot),
    posterUrl: editorPreview?.target.posterUrl ?? shotImageUrl(shot),
  });
  const { videoUrl, overlayImageUrl, standaloneImageUrl, posterUrl } =
    mediaLayerPlan;
  const visibleImageUrl =
    overlayImageUrl ?? standaloneImageUrl ?? posterUrl ?? null;
  const aspectRatio = format ? `${format.width} / ${format.height}` : "1 / 1";
  const formatLabel = format ? `${format.width}×${format.height}` : "1080×1080";
  const canvasSize = fitProjectCanvas({
    stageWidth: previewStageSize.width,
    stageHeight: previewStageSize.height,
    projectWidth: format?.width ?? 1,
    projectHeight: format?.height ?? 1,
    inset: PREVIEW_CANVAS_INSET_PX,
  });
  const timelineOffsetMs = timing
    ? Math.min(timing.durationMs, Math.max(0, playheadMs - timing.startMs))
    : 0;
  const sourceInMs = sourceClip?.sourceInMs ?? 0;
  const sourceDurationMs = Math.max(
    0,
    (sourceClip?.sourceOutMs ?? sourceInMs) - sourceInMs
  );
  const sourceStartSeconds =
    normalizedEditorDraft?.sourceStartSec ??
    timelineVideoSource?.sourceStartSec ??
    sourceInMs / 1_000;
  const sourceEndSeconds =
    normalizedEditorDraft?.sourceEndSec ??
    timelineVideoSource?.sourceEndSec ??
    (sourceClip?.sourceOutMs ?? sourceInMs) / 1_000;
  const playbackRate =
    normalizedEditorDraft?.effects.playbackRate ??
    timelineVideoPlaybackRate({
      sourceStartSec: sourceStartSeconds,
      sourceEndSec: sourceEndSeconds,
      durationMs: timelineVideoSource?.durationMs ?? timing?.durationMs ?? 0,
      effects: timelineVideoSource?.effects,
    });
  const reverse =
    normalizedEditorDraft?.effects.reverse ??
    timelineVideoSource?.effects.reverse ??
    false;
  const sourceVolume =
    normalizedEditorDraft?.effects.volume ??
    timelineVideoSource?.effects.volume ??
    1;
  const sourceMuted =
    muteVisualSourceAudio ||
    (normalizedEditorDraft?.effects.muted ??
      timelineVideoSource?.effects.muted ??
      false);
  const videoTransform =
    normalizedEditorDraft?.transform ?? timelineVideoSource?.transform;
  const videoMotionStyle = timelineVideoMotionStyle(
    normalizedEditorDraft?.effects ?? timelineVideoSource?.effects
  );
  const editorSourceOffsetSeconds = Math.min(
    Math.max(0, sourceEndSeconds - sourceStartSeconds),
    (timelineOffsetMs / 1_000) * playbackRate
  );
  const targetVideoTimeSeconds = normalizedEditorDraft
    ? reverse
      ? Math.max(
          sourceStartSeconds,
          sourceEndSeconds - editorSourceOffsetSeconds
        )
      : Math.min(
          sourceEndSeconds,
          sourceStartSeconds + editorSourceOffsetSeconds
        )
    : (timelineVideoSource?.sourceTimeSec ??
      (sourceInMs +
        (sourceDurationMs > 0
          ? Math.min(timelineOffsetMs, sourceDurationMs)
          : timelineOffsetMs)) /
        1000);
  const shouldHoldLastFrame = timelineVideoShouldHoldLastFrame({
    targetTimeSec: targetVideoTimeSeconds,
    sourceStartSec: sourceStartSeconds,
    sourceEndSec: sourceEndSeconds,
    reverse,
  });
  const subtitleLines = previewSubtitleLines({
    subtitlePlan: subtitlePlan ?? null,
    playheadFrame:
      playheadFrame ?? Math.max(0, Math.round((playheadMs * 30) / 1_000)),
    playheadMs,
    legacyManifest: format,
    fallbackDialogue: shot?.dialogue,
  });
  const frameAdjustmentAvailable = Boolean(
    onEditImage || onSelectImageForChat || onEditCurrentVideoFrame
  );
  const currentFrameReady = Boolean(maskEditTarget && visibleImageUrl);
  const currentFrameIsTimelineImage = Boolean(maskEditTarget?.clipId);
  const editingCurrentVideo = Boolean(videoUrl && !overlayImageUrl);
  const frameEditBusy =
    extractingCurrentVideoFrame ||
    maskState.phase === "extracting" ||
    maskState.phase === "generating" ||
    maskState.phase === "adopting";

  useEffect(() => {
    resetMaskSession();
  }, [resetMaskSession, storyId, shot?.shotNo, timelinePlaying]);

  useEffect(() => {
    if (
      timelinePlaying ||
      maskState.phase === "idle" ||
      maskSessionPlayheadRef.current == null ||
      maskSessionPlayheadRef.current === playheadMs
    )
      return;
    resetMaskSession();
  }, [maskState.phase, playheadMs, resetMaskSession, timelinePlaying]);

  useEffect(() => {
    resetPreviewMaskSessionForTargetChange({
      sessionTarget: maskState.target,
      visibleTarget: maskEditTarget ?? null,
      reset: resetMaskSession,
    });
  }, [maskEditTarget, maskState.target, resetMaskSession]);

  useEffect(() => {
    const candidate = latestCandidateQuery.data?.candidate;
    if (!candidate || !maskState.target || maskState.phase !== "selecting")
      return;
    dispatchMask({
      type: "restore-candidate",
      target: maskState.target,
      candidate,
    });
  }, [latestCandidateQuery.data, maskState.phase, maskState.target]);

  const beginMaskEdit = useCallback(async () => {
    if (timelinePlaying) {
      toast.error("请先暂停视频，再进行区域修改");
      return;
    }
    if (maskEditTarget) {
      maskSessionEpochRef.current += 1;
      maskSessionPlayheadRef.current = playheadMs;
      dispatchMask({ type: "start", target: maskEditTarget });
      return;
    }
    toast.error("请先点击“调整画面”抽取当前帧");
  }, [maskEditTarget, playheadMs, timelinePlaying]);

  const prepareFrameForAdjustment = useCallback(() => {
    if (editingCurrentVideo) {
      onEditCurrentVideoFrame?.();
      return;
    }
    if (onSelectImageForChat && currentFrameReady) {
      onSelectImageForChat();
      return;
    }
    if (onEditImage && visibleImageUrl) {
      onEditImage();
      return;
    }
    onEditCurrentVideoFrame?.();
  }, [
    currentFrameReady,
    editingCurrentVideo,
    onEditCurrentVideoFrame,
    onEditImage,
    onSelectImageForChat,
    visibleImageUrl,
  ]);

  const segmentPreviewRegion = useCallback(
    async (
      element: HTMLDivElement,
      previewPath: Array<{ x: number; y: number }>
    ) => {
      if (
        !storyId ||
        !maskState.target ||
        (maskState.phase !== "selecting" && maskState.phase !== "mask-ready") ||
        previewImageSize.width <= 0 ||
        previewImageSize.height <= 0
      )
        return;
      const rect = element.getBoundingClientRect();
      const points = previewPathToSourcePolygon(
        {
          previewWidth: rect.width,
          previewHeight: rect.height,
          sourceWidth: previewImageSize.width,
          sourceHeight: previewImageSize.height,
          transform: maskState.target.transform,
        },
        previewPath
      );
      if (!points) {
        dispatchMask({
          type: "error",
          message: "请沿着物体外侧圈出一个完整范围",
        });
        return;
      }
      const requestId = maskState.requestId + 1;
      dispatchMask({ type: "segment", requestId });
      try {
        const result = await segmentRegionMutation.mutateAsync({
          storyId,
          imageId: maskState.target.imageId,
          points,
        });
        if (
          result.status !== "ok" ||
          !result.maskKey ||
          !result.maskUrl ||
          !result.previewMaskUrl ||
          !result.width ||
          !result.height
        ) {
          throw new Error(result.message || "圈选范围内没有识别到这个物体");
        }
        dispatchMask({
          type: "mask",
          requestId,
          mask: {
            maskKey: result.maskKey,
            maskUrl: result.maskUrl,
            previewMaskUrl: result.previewMaskUrl,
            width: result.width,
            height: result.height,
          },
        });
      } catch (error) {
        dispatchMask({
          type: "error",
          requestId,
          message: error instanceof Error ? error.message : "语义对象识别失败",
        });
      }
    },
    [
      maskState.phase,
      maskState.requestId,
      maskState.target,
      previewImageSize.height,
      previewImageSize.width,
      segmentRegionMutation,
      storyId,
    ]
  );

  const maskSelectionActive =
    maskState.phase === "selecting" || maskState.phase === "mask-ready";
  const semanticRegionSelection =
    maskCapabilitiesQuery.data?.semanticRegionSelection === true;

  const maskPointerPosition = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      };
    },
    []
  );

  const startMaskSelectionGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!maskSelectionActive) return;
      event.preventDefault();
      event.stopPropagation();
      if (!semanticRegionSelection) {
        dispatchMask({
          type: "error",
          message: "当前未配置语义对象识别；不会把圈选范围直接当成修改区域",
        });
        return;
      }
      const point = maskPointerPosition(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      setMaskDrag({ pointerId: event.pointerId, points: [point] });
    },
    [semanticRegionSelection, maskPointerPosition, maskSelectionActive]
  );

  const moveMaskSelectionGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!maskDrag || maskDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const current = maskPointerPosition(event);
      setMaskDrag(drag => {
        if (!drag || drag.pointerId !== event.pointerId) return drag;
        const previous = drag.points.at(-1);
        if (
          previous &&
          Math.hypot(current.x - previous.x, current.y - previous.y) < 3
        ) {
          return drag;
        }
        return { ...drag, points: [...drag.points, current] };
      });
    },
    [maskDrag, maskPointerPosition]
  );

  const finishMaskSelectionGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!maskDrag || maskDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const element = event.currentTarget;
      const end = maskPointerPosition(event);
      const previous = maskDrag.points.at(-1);
      const points =
        previous && Math.hypot(end.x - previous.x, end.y - previous.y) >= 1
          ? [...maskDrag.points, end]
          : maskDrag.points;
      setMaskDrag(null);
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      if (points.length < 3) {
        dispatchMask({
          type: "error",
          message: "请按住并沿物体外侧圈一圈",
        });
        return;
      }
      void segmentPreviewRegion(element, points);
    },
    [maskDrag, maskPointerPosition, segmentPreviewRegion]
  );

  const generateMaskedCandidate = useCallback(async () => {
    if (
      maskSubmitInFlightRef.current ||
      !storyId ||
      !maskState.target ||
      !maskState.mask ||
      !maskState.maskConfirmed
    )
      return;
    const prompt = maskPrompt.trim();
    if (!prompt) {
      toast.error("请写清楚只想修改什么");
      return;
    }
    maskSubmitInFlightRef.current = true;
    const requestId = maskState.requestId + 1;
    dispatchMask({ type: "generate", requestId });
    let providerSubmissionStarted = false;
    try {
      const token =
        globalThis.crypto?.randomUUID?.() ??
        `mask-${Date.now()}-${Math.random()}`;
      const target = {
        targetKind: maskState.target.targetKind ?? ("shot-primary" as const),
        stableShotId: maskState.target.stableShotId,
        clipId: maskState.target.clipId,
      };
      const quoted = await quoteInpaintMutation.mutateAsync({
        storyId,
        imageId: maskState.target.imageId,
        maskKey: maskState.mask.maskKey,
        prompt,
        ...target,
      });
      if (quoted.status !== "ok") {
        throw new Error(quoted.message || "局部修改费用报价失败");
      }
      if (
        quoted.quote.currency !== maskedEstimate.currency ||
        Math.abs(quoted.quote.estimatedCny - maskedEstimate.estimatedCny) >
          0.001
      ) {
        throw new Error(
          `费用已变化为 ¥${quoted.quote.estimatedCny.toFixed(2)}，请核对后重新确认`
        );
      }
      providerSubmissionStarted = true;
      const result = await inpaintMutation.mutateAsync({
        storyId,
        imageId: maskState.target.imageId,
        maskKey: maskState.mask.maskKey,
        prompt,
        operationToken: token,
        ...target,
        confirmation: quoted.quote,
      });
      if (result.status !== "ok") {
        if (result.submissionUncertain) {
          dispatchMask({
            type: "uncertain",
            requestId,
            message: result.message || "付费提交状态未知，系统不会自动重复提交",
          });
          return;
        }
        dispatchMask({
          type: "error",
          requestId,
          message: result.message || "局部修改失败",
        });
        return;
      }
      dispatchMask({
        type: "candidate",
        requestId,
        candidate: {
          imageId: result.image.id,
          imageUrl: result.image.imageUrl,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "局部修改失败";
      dispatchMask(
        providerSubmissionStarted
          ? {
              type: "uncertain",
              requestId,
              message: `${message}。若请求已发出，系统不会自动重复提交。`,
            }
          : { type: "error", requestId, message }
      );
    } finally {
      maskSubmitInFlightRef.current = false;
    }
  }, [
    inpaintMutation,
    maskPrompt,
    maskState.mask,
    maskState.maskConfirmed,
    maskState.target,
    maskedEstimate.currency,
    maskedEstimate.estimatedCny,
    quoteInpaintMutation,
    storyId,
  ]);

  const adoptMaskedCandidate = useCallback(async () => {
    if (!storyId || !maskState.target || !maskState.candidate) return;
    const requestId = maskState.requestId + 1;
    const sessionEpoch = maskSessionEpochRef.current;
    dispatchMask({ type: "adopt", requestId });
    try {
      const result = await adoptMutation.mutateAsync({
        storyId,
        candidateImageId: maskState.candidate.imageId,
        expectedSourceImageId: maskState.target.imageId,
        targetKind: maskState.target.targetKind ?? "shot-primary",
        stableShotId: maskState.target.stableShotId,
        clipId: maskState.target.clipId,
      });
      if (result.status !== "ok")
        throw new Error(result.message || "候选采用失败");
      if (maskSessionEpochRef.current !== sessionEpoch) return;
      resetMaskSession();
      onMaskAdopted?.();
      toast.success("已采用局部修改候选");
    } catch (error) {
      dispatchMask({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : "候选采用失败",
      });
    }
  }, [
    adoptMutation,
    maskState.candidate,
    maskState.target,
    onMaskAdopted,
    resetMaskSession,
    storyId,
  ]);

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      setPreviewStageSize(current =>
        current.width === next.width && current.height === next.height
          ? current
          : next
      );
    };
    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const maximumTime = Math.max(0, video.duration - 0.001);
    const lastFrameTime = Math.min(
      maximumTime,
      Math.max(
        sourceStartSeconds,
        sourceEndSeconds - VIDEO_END_HOLD_EPSILON_SECONDS
      )
    );
    const targetTime = Math.min(
      shouldHoldLastFrame ? lastFrameTime : targetVideoTimeSeconds,
      maximumTime
    );
    const drift = Math.abs(video.currentTime - targetTime);
    video.defaultPlaybackRate = playbackRate;
    video.playbackRate = playbackRate;
    video.volume = sourceVolume;
    video.muted = sourceMuted;

    if (!timelinePlaying || shouldHoldLastFrame || reverse) {
      if (!video.paused) {
        ignoreNextVideoPauseRef.current = true;
        video.pause();
      }
      if (drift > 0.004) video.currentTime = targetTime;
      return;
    }

    if (drift > 0.35) video.currentTime = targetTime;
    if (video.paused) void video.play().catch(() => undefined);
  }, [
    playbackRate,
    reverse,
    shouldHoldLastFrame,
    sourceEndSeconds,
    sourceStartSeconds,
    targetVideoTimeSeconds,
    timelinePlaying,
    videoUrl,
    sourceMuted,
    sourceVolume,
  ]);

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[color:var(--panel-header)]"
      aria-label="Preview"
      onPointerEnter={() => {
        keyboardShortcutZoneRef.current = true;
      }}
      onPointerMove={() => {
        keyboardShortcutZoneRef.current = true;
      }}
      onPointerLeave={() => {
        keyboardShortcutZoneRef.current = false;
      }}
    >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
          <span className="editing-panel-heading">Preview</span>
          {shot ? (
            <span className="ml-2 font-mono text-[10px] text-primary">
              {shotLabel(shot)}
            </span>
          ) : null}
          <span
            className="ml-2 font-mono text-[9px] tabular-nums text-muted-foreground"
            title="项目画布尺寸"
          >
            {formatLabel}
          </span>
          {editorPreview ? (
            <span
              className="ml-2 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
              data-testid="editing-preview-live-draft"
            >
              参数预览
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {frameAdjustmentAvailable ? (
            <button
              type="button"
              onClick={prepareFrameForAdjustment}
              disabled={frameEditBusy}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-cyan-400/50 bg-cyan-400/10 px-2 text-[10px] font-medium text-foreground transition hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="调整 Preview 当前画面"
              title={
                editingCurrentVideo
                  ? "暂停视频并抽取当前帧"
                  : "选中当前图片，在下方或聊天框中修改"
              }
              data-testid="preview-frame-edit-trigger"
            >
              {frameEditBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="h-3 w-3" />
              )}
              {frameEditBusy
                ? "正在抽帧…"
                : editingCurrentVideo
                  ? "调整画面"
                  : "调整这张图"}
            </button>
          ) : null}
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {timing
              ? `${formatStoryboardTimestamp(timing.startMs)} / ${formatStoryboardTimestamp(timing.endMs)}`
              : "00:00.000"}
          </span>
        </div>
      </div>

      <div className="flex min-h-[150px] flex-1 flex-col overflow-hidden bg-muted/35">
        <div
          ref={previewStageRef}
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          data-testid="editing-preview-stage"
        >
          <div
            className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-black shadow-sm ${
              maskState.phase === "selecting" ||
              maskState.phase === "mask-ready"
                ? "cursor-crosshair ring-2 ring-cyan-400/50"
                : ""
            }`}
            style={{
              aspectRatio,
              width: canvasSize.width || 180,
              height: canvasSize.height || 180,
            }}
            data-testid="editing-project-canvas"
            data-project-size={formatLabel}
          >
            {videoUrl ? (
              <div
                className="relative h-full w-full"
                data-testid="editing-preview-video-stack"
              >
                <div
                  className="h-full w-full"
                  style={videoMotionStyle}
                  data-testid={
                    videoMotionStyle ? "editing-preview-heartbeat" : undefined
                  }
                >
                  <video
                    key={
                      editorPreview
                        ? `editor-${editorPreview.target.takeId}-${editorPreview.target.clipId ?? "primary"}`
                        : videoUrl
                    }
                    ref={videoRef}
                    src={videoUrl}
                    poster={posterUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    onPointerDown={() => {
                      previewControlInteractionAtRef.current = Date.now();
                    }}
                    onKeyDown={event => {
                      if (
                        event.key === " " ||
                        event.key === "Enter" ||
                        event.key.toLowerCase() === "k" ||
                        event.key === "MediaPlayPause"
                      ) {
                        previewControlInteractionAtRef.current = Date.now();
                      }
                    }}
                    onLoadedMetadata={event => {
                      const maximumTime = Math.max(
                        0,
                        event.currentTarget.duration - 0.001
                      );
                      event.currentTarget.defaultPlaybackRate = playbackRate;
                      event.currentTarget.playbackRate = playbackRate;
                      event.currentTarget.volume = sourceVolume;
                      event.currentTarget.muted = sourceMuted;
                      const targetTime = shouldHoldLastFrame
                        ? Math.max(
                            sourceStartSeconds,
                            sourceEndSeconds - VIDEO_END_HOLD_EPSILON_SECONDS
                          )
                        : targetVideoTimeSeconds;
                      event.currentTarget.currentTime = Math.min(
                        targetTime,
                        maximumTime
                      );
                      if (timelinePlaying && !shouldHoldLastFrame && !reverse) {
                        void event.currentTarget.play().catch(() => undefined);
                      }
                    }}
                    onPlay={event => {
                      previewControlInteractionAtRef.current = null;
                      const startSeconds = sourceStartSeconds;
                      const endSeconds = sourceEndSeconds;
                      event.currentTarget.defaultPlaybackRate = playbackRate;
                      event.currentTarget.playbackRate = playbackRate;
                      event.currentTarget.volume = sourceVolume;
                      event.currentTarget.muted = sourceMuted;
                      if (
                        event.currentTarget.currentTime < startSeconds ||
                        (endSeconds > startSeconds &&
                          event.currentTarget.currentTime >= endSeconds - 0.03)
                      ) {
                        event.currentTarget.currentTime = reverse
                          ? Math.max(startSeconds, endSeconds - 1 / 120)
                          : startSeconds;
                      }
                      if (!timelinePlaying) onRequestTimelinePlaying(true);
                      if (reverse) {
                        ignoreNextVideoPauseRef.current = true;
                        event.currentTarget.pause();
                      }
                    }}
                    onPause={event => {
                      const ignoreNextPause = ignoreNextVideoPauseRef.current;
                      const lastInteractionAtMs =
                        previewControlInteractionAtRef.current;
                      ignoreNextVideoPauseRef.current = false;
                      previewControlInteractionAtRef.current = null;
                      if (
                        shouldForwardPreviewPause({
                          timelinePlaying,
                          ignoreNextPause,
                          mediaIsCurrent:
                            videoRef.current === event.currentTarget,
                          mediaConnected: event.currentTarget.isConnected,
                          mediaEnded: event.currentTarget.ended,
                          lastInteractionAtMs,
                          nowMs: Date.now(),
                        })
                      ) {
                        onRequestTimelinePlaying(false);
                      }
                    }}
                    onTimeUpdate={event => {
                      const endSeconds = sourceEndSeconds;
                      if (
                        !reverse &&
                        endSeconds > 0 &&
                        event.currentTarget.currentTime >= endSeconds
                      ) {
                        ignoreNextVideoPauseRef.current = true;
                        event.currentTarget.pause();
                        event.currentTarget.currentTime = Math.max(
                          sourceStartSeconds,
                          endSeconds - VIDEO_END_HOLD_EPSILON_SECONDS
                        );
                      }
                    }}
                    className="h-full w-full object-cover"
                    style={
                      videoTransform
                        ? timelineTransformStyle(videoTransform)
                        : undefined
                    }
                    aria-label={`${shot ? shotLabel(shot) : "当前镜头"} 视频预览`}
                  />
                </div>
                {overlayImageUrl ? (
                  <img
                    src={overlayImageUrl}
                    alt={`${shot ? shotLabel(shot) : "当前镜头"} 当前图片帧`}
                    className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
                    style={timelineTransformStyle(
                      timelineImageSource?.transform
                    )}
                    data-testid="editing-preview-frame-overlay"
                    onLoad={event =>
                      setPreviewImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                ) : null}
              </div>
            ) : standaloneImageUrl ? (
              <>
                <img
                  src={standaloneImageUrl}
                  alt={`${shot ? shotLabel(shot) : "当前镜头"} 预览`}
                  className="h-full w-full object-cover"
                  style={timelineTransformStyle(
                    timelineImageSource?.transform ??
                      (shot?.imageId != null
                        ? (shot.timelineItem?.imageTransforms?.[
                            String(shot.imageId)
                          ] ?? shot.timelineItem?.transform)
                        : shot?.timelineItem?.transform)
                  )}
                  onLoad={event =>
                    setPreviewImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[9px] font-medium text-white">
                  {timelineImageSource
                    ? "时间线图片帧"
                    : "静态首帧占位 · 尚未采用视频"}
                </span>
              </>
            ) : (
              <div className="flex h-full min-h-[220px] w-full min-w-[220px] flex-col items-center justify-center gap-2 px-6 text-center text-neutral-400">
                <Video className="h-7 w-7" />
                <span className="text-xs">当前镜头尚未关联画面</span>
                <span className="max-w-[260px] truncate text-[10px] text-neutral-500">
                  {shot ? chatCutSourceNameFromShot(shot) : "从左侧选择镜头"}
                </span>
              </div>
            )}
            {maskState.mask && maskState.target ? (
              <img
                src={maskState.mask.previewMaskUrl}
                alt="当前局部修改选区"
                className="pointer-events-none absolute inset-0 z-20 h-full w-full object-cover"
                style={timelineTransformStyle(maskState.target.transform)}
                data-testid="preview-object-mask-overlay"
              />
            ) : null}
            {maskSelectionActive ? (
              <div
                className="absolute inset-0 z-[25] cursor-crosshair touch-none"
                data-testid="preview-object-mask-hit-layer"
                aria-label={
                  semanticRegionSelection
                    ? "按住并圈住要修改的物体"
                    : "当前未配置语义对象识别"
                }
                onPointerDown={startMaskSelectionGesture}
                onPointerMove={moveMaskSelectionGesture}
                onPointerUp={finishMaskSelectionGesture}
                onPointerCancel={() => setMaskDrag(null)}
              >
                {maskDrag ? (
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    data-testid="preview-object-mask-lasso"
                    aria-hidden="true"
                  >
                    <polygon
                      points={maskDrag.points
                        .map(point => `${point.x},${point.y}`)
                        .join(" ")}
                      fill="rgba(34,211,238,0.18)"
                      stroke="rgb(103,232,249)"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </div>
            ) : null}
            {maskState.phase !== "idle" ? (
              <div
                className="absolute inset-x-3 bottom-3 z-30 rounded-md border border-white/20 bg-black/85 p-3 text-white shadow-xl backdrop-blur"
                data-mask-controls
                data-testid="preview-object-mask-controls"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[11px]">
                    {maskState.phase === "extracting"
                      ? "正在抽取当前帧…"
                      : maskState.phase === "segmenting"
                        ? "正在识别物体轮廓…"
                        : maskState.phase === "selecting"
                          ? semanticRegionSelection
                            ? "按住并沿外侧圈住要修改的物体"
                            : "当前未配置语义对象识别；不会把圈选范围直接当成修改区域"
                          : maskState.phase === "generating"
                            ? "正在生成局部修改候选…"
                            : maskState.phase === "uncertain"
                              ? "付费任务状态未知，已停止自动重试"
                              : maskState.phase === "adopting"
                                ? "正在采用候选…"
                                : maskState.phase === "candidate-ready"
                                  ? "候选已生成，原图尚未改变"
                                  : maskState.maskConfirmed
                                    ? "选区已确认，请描述修改"
                                    : "检查高亮范围，确认后再生成"}
                    {maskState.error ? (
                      <p className="mt-1 text-[10px] text-red-300">
                        {maskState.error}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={resetMaskSession}
                    className="rounded px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    退出
                  </button>
                </div>
                {maskState.phase === "mask-ready" &&
                !maskState.maskConfirmed ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={confirmMaskForChat}
                      className="inline-flex items-center gap-1 rounded bg-cyan-500 px-2.5 py-1.5 text-[10px] font-medium text-black"
                    >
                      <Check className="h-3 w-3" />
                      确认选区
                    </button>
                    <button
                      type="button"
                      onClick={reselectMaskRegion}
                      className="rounded border border-white/20 px-2.5 py-1.5 text-[10px]"
                    >
                      重新点选
                    </button>
                  </div>
                ) : null}
                {maskState.phase === "mask-ready" && maskState.maskConfirmed ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      ref={maskPromptRef}
                      value={maskPrompt}
                      onChange={event =>
                        setMaskPrompt(event.currentTarget.value)
                      }
                      placeholder="例如：把杯子改成蓝色陶瓷杯"
                      rows={2}
                      className="w-full resize-none rounded border border-white/20 bg-white/10 px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-white/40 focus:border-cyan-400"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] text-white/60">
                        仅透明蒙版内可修改，预计 ¥
                        {maskedEstimate.estimatedCny.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void generateMaskedCandidate()}
                        disabled={!maskPrompt.trim()}
                        className="rounded bg-cyan-500 px-2.5 py-1.5 text-[10px] font-medium text-black disabled:opacity-40"
                      >
                        确认费用并生成
                      </button>
                    </div>
                  </div>
                ) : null}
                {maskState.phase === "candidate-ready" &&
                maskState.candidate ? (
                  <div className="mt-2 flex items-center gap-3">
                    <img
                      src={maskState.candidate.imageUrl}
                      alt="局部修改候选"
                      className="h-16 w-16 rounded border border-white/20 object-cover"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void adoptMaskedCandidate()}
                        className="rounded bg-cyan-500 px-3 py-1.5 text-[10px] font-medium text-black"
                      >
                        采用候选
                      </button>
                      <button
                        type="button"
                        onClick={resetMaskSession}
                        className="rounded border border-white/20 px-3 py-1.5 text-[10px]"
                      >
                        保留原图
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {currentFrameReady ? (
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/70 bg-[color:var(--panel-header)] px-3 py-2"
            data-testid="preview-frame-tools"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-foreground">
                {currentFrameIsTimelineImage
                  ? "当前抽帧已就绪"
                  : "当前图片已就绪"}
              </p>
              <p className="text-[9px] text-muted-foreground">
                {currentFrameIsTimelineImage
                  ? "已选中这一帧；可在左侧聊天框直接描述要如何修改"
                  : "已选中这张图；可在左侧聊天框直接描述要如何修改"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {onEditImage ? (
                <button
                  type="button"
                  onClick={onEditImage}
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-background px-2 text-[10px] font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  aria-label="调整当前抽帧的构图和文字"
                >
                  <Pencil className="h-3 w-3" /> 构图与文字
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void beginMaskEdit()}
                disabled={frameEditBusy}
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-cyan-400/50 bg-cyan-400/10 px-2 text-[10px] font-medium transition hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="圈选当前抽帧中的物体并局部修改"
              >
                <Crosshair className="h-3 w-3" /> 圈选局部
              </button>
              {onSelectImageForChat ? (
                <button
                  type="button"
                  onClick={onSelectImageForChat}
                  className="inline-flex h-7 items-center rounded-sm px-2 text-[10px] font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  在聊天框修改
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          className="flex h-12 shrink-0 items-center justify-center overflow-hidden border-t border-border/70 bg-[color:var(--panel-header)] px-4 text-center"
          aria-live="polite"
          data-testid="editing-preview-subtitle-rail"
        >
          {subtitleLines.length > 0 ? (
            <div className="flex max-w-[92%] flex-col items-center gap-0.5">
              {subtitleLines.map(line => (
                <p
                  key={line.id}
                  className={`m-0 line-clamp-2 whitespace-pre-line text-[13px] font-medium leading-5 ${
                    line.source === "candidate"
                      ? "text-muted-foreground"
                      : "text-foreground"
                  }`}
                  data-testid="editing-preview-subtitle"
                  data-subtitle-source={line.source}
                >
                  {line.source === "candidate" ? (
                    <span
                      className="mr-1 rounded-sm bg-muted px-1 text-[9px] align-middle"
                      data-testid="editing-preview-subtitle-candidate-badge"
                    >
                      候选
                    </span>
                  ) : null}
                  {line.text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
