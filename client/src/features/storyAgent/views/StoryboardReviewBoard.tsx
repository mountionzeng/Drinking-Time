/**
 * Full storyboard review and directed media workflow.
 * Kept separate so card-list changes do not load the entire review workspace.
 */
import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  X,
  Loader2,
  Clapperboard,
  ImagePlus,
  Trash2,
  ListPlus,
  PlusCircle,
  Upload,
  Video,
  Check,
  Focus,
  SkipBack,
  SkipForward,
  Copy,
  ClipboardPaste,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { StoryShotEditableField } from "@/features/storyAgent/StoryAgentContext";
import { toast } from "sonner";
import type { GeneratedScript, StoryShot } from "@/features/storyAgent/types";
import {
  creationTimelineShotId,
  type CreationEditorImage,
  type CreationEditorShot,
  type ImportedStoryMaterialResult,
} from "@/features/creationEditor/CreationEditorContext";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import {
  mjVideoVariantLabel,
  videoTakeCandidateToAdopt,
  videoTakeAffordance,
  videoTakeErrorMessage,
  videoTakeFrameUrl,
  videoTakeProgress,
} from "@/features/creationEditor/videoAssetViewModel";
import {
  cropFrameQuadrant,
  FRAME_QUADRANTS,
  type FrameQuadrant,
} from "@/features/creationEditor/video/frameCrop";
import { isFrameCandidateSheet } from "@/features/creationEditor/frameCandidate";
import type { PromptRow } from "@/features/creationEditor/promptTable/types";
import {
  videoClipEditorTargetForTake,
  videoClipEditorTargetForVisualClip,
  type VideoClipEditorTarget,
} from "@/features/creationEditor/videoClipEditorModel";
import {
  imageClipEditorTargetForShot,
  timelineTransformStyle,
  type ImageClipEditorTarget,
} from "@/features/creationEditor/imageClipEditorModel";
import type { ShotVideoProviderStatus } from "@shared/videoAsset";
import type {
  ShotConsistencyAnalysis,
  ShotConsistencyMismatch,
} from "@shared/shotConsistency";
import { estimateStoryboardImageCost } from "@shared/imageRenderCost";
import type { ShotDirectorResult } from "@shared/shotDirector";
import {
  parseStartEndVideoConfig,
  type StartEndShotVideoEstimate,
} from "@shared/startEndVideo";
import { displayShotCode } from "@shared/shotIdentity";
import type { GeneratedImageItem } from "@/features/mobileChat/types";
import {
  hasVideoTakeDragPayload,
  readVideoTakeDragPayload,
  writeVideoTakeDragPayload,
} from "./videoTakeDrag";
import { buildStoryboardTimingRows } from "../storyboardTiming";
import {
  StoryboardMatrixFieldCell,
  STORYBOARD_MATRIX_ROWS,
  storyboardMatrixSwapPlan,
  type StoryboardMatrixField,
  type StoryboardMatrixRow,
} from "./StoryboardMatrix";
import {
  StoryboardMediaPreviewDialog,
  StoryboardVideoThumbnail,
  storyboardPreviewVideoTake,
  type StoryboardMediaPreview,
} from "./StoryboardMediaPreview";
import {
  hasStoryboardImageDragPayload,
  importStoryboardMediaFiles,
  readStoryboardImageDragPayload,
  writeStoryboardImageDragPayload,
} from "../storyboardLocalMedia";
import {
  characterContinuityMismatches,
  storyboardContinuityOptions,
  StoryboardContinuityDialog,
  type StoryboardContinuityOption,
} from "./StoryboardContinuityDialog";

import {
  autoScrollElementAtPoint,
  autoScrollElementHorizontallyAtPoint,
  hasStoryboardScrollableDragPayload,
  latestStoryboardFrames,
  quickShotVideoRenderPlan,
  scrollElementHorizontallyIntoView,
  shortText,
  storyboardCandidateImageStyle,
  storyboardCharacterContinuityGenerationParams,
  storyboardCharacterContinuityReference,
  storyboardDragScrollSpeedMultiplier,
  storyboardExplicitImageInstruction,
  storyboardFrameOrderGenerationParams,
  storyboardFrameOrdersAfterMove,
  storyboardFrameParamsAfterDelete,
  storyboardFrameRoleForImage,
  storyboardFrameRoleGenerationParams,
  storyboardInheritedStartEndGenerationParams,
  storyboardRenderIntentSummary,
  storyboardRenderShotWithDraft,
  storyboardRerenderRequestId,
  storyboardShotFrameImages,
  storyboardStartEndFrameIssue,
  storyboardStartEndGenerationParams,
  storyboardVideoIntentPatch,
  storyShotInsertIdentity,
  type StoryboardFrameRole,
  type StoryboardNeighborFrameSource,
} from "./storyboardReviewModel";

function AddShotButton({
  shotLabel,
  inserting,
  disabled,
  onClick,
  compact = false,
}: {
  shotLabel: string;
  inserting: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-sm bg-muted/45 text-[10px] font-medium text-muted-foreground transition hover:bg-[var(--nayin-glow)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-70 ${
        compact ? "h-7 w-7" : "mt-2 w-full gap-1.5 px-3 py-2"
      }`}
      aria-label={`在 ${shotLabel} 后添加镜头`}
      title={`在 ${shotLabel} 后添加镜头`}
    >
      {inserting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <PlusCircle className="h-3.5 w-3.5" />
      )}
      {compact ? null : "添加镜头"}
    </button>
  );
}

function DeleteShotButton({
  shotLabel,
  deleting,
  disabled,
  onClick,
  compact = false,
}: {
  shotLabel: string;
  deleting: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
}) {
  const label = `删除 ${shotLabel}`;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-muted/45 text-[10px] font-medium text-muted-foreground transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-wait disabled:opacity-70 ${
        compact ? "h-7 w-7" : "mt-2 min-h-[34px] gap-1.5 px-3 py-2"
      }`}
      aria-label={label}
      title={label}
    >
      {deleting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      {compact ? null : "删除"}
    </button>
  );
}

function StoryboardMediaDropOverlay({
  shotLabel,
  importing,
  moving = false,
}: {
  shotLabel: string;
  importing: boolean;
  moving?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center gap-1.5 rounded-sm border bg-background/95 px-2 text-[9px] font-semibold text-foreground shadow-sm"
      style={{ borderColor: "var(--nayin-accent)" }}
      aria-live="polite"
    >
      {importing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-nayin-bright" />
      ) : moving ? (
        <ImagePlus className="h-3.5 w-3.5 text-nayin-bright" />
      ) : (
        <Upload className="h-3.5 w-3.5 text-nayin-bright" />
      )}
      {importing
        ? `正在导入 ${shotLabel}`
        : moving
          ? `移动到 ${shotLabel}`
          : `导入到 ${shotLabel}`}
    </div>
  );
}

export function StoryboardReviewBoard({
  images,
  shots,
  latestScript,
  isGeneratingScript,
  selectedShotNo = null,
  onSelectShot,
  onUpdateShotField,
  creationShots = [],
  timelineShotIds = [],
  onAddShotToTimeline,
  onInsertShotAfter,
  onDeleteShot,
  generatingImageShotNo = null,
  onGenerateShotImages,
  continuityAnchor = null,
  onAnalyzeShotConsistency,
  generatingVideoShotNo = null,
  onGenerateShotVideo,
  onEstimateStartEndShotVideo,
  onGenerateStartEndShotVideo,
  onRefreshShotVideoStatus,
  onMoveStoryImage,
  onDeleteStoryImage,
  onMoveVideoTake,
  onAdoptVideoTake,
  onMarkVideoTakeUnusable,
  onRemoveTimelineVideoClip,
  onEditVideo,
  onEditImage,
  onCopyVideo,
  onPasteVideo,
  videoClipboardLabel = null,
  onPromoteFrameCrop,
  onImportStoryMaterial,
  onUpdateShotFields,
  promotingFrameCropShotNo = null,
  shotVideoProviderStatus = null,
  defaultViewMode = "simple",
  embeddedEditorMode = false,
  headerAction,
  className = "",
}: {
  images: GeneratedImageItem[];
  shots: StoryShot[];
  latestScript: GeneratedScript | null;
  isGeneratingScript: boolean;
  selectedShotNo?: number | null;
  onSelectShot?: (shotNo: number) => void;
  onUpdateShotField?: (
    index: number,
    field: StoryShotEditableField,
    value: string
  ) => void | Promise<void>;
  creationShots?: CreationEditorShot[];
  timelineShotIds?: string[];
  onAddShotToTimeline?: (shotNo: number, stableShotId?: string | null) => void;
  onInsertShotAfter?: (
    shotNo: number,
    stableShotId?: string | null
  ) => void | Promise<void>;
  onDeleteShot?: (
    shotNo: number,
    stableShotId?: string | null
  ) => number | null | void | Promise<number | null | void>;
  generatingImageShotNo?: number | null;
  onGenerateShotImages?: (input: {
    shotNo: number;
    rows: PromptRow[];
    explicitInstruction: string;
    reference?: {
      imageUrl?: string;
      identityImageUrl?: string;
    };
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<void>;
  continuityAnchor?: {
    label: string;
    imageUrl: string;
  } | null;
  onAnalyzeShotConsistency?: (input: {
    anchorImageUrl?: string | null;
    targetImage?: {
      imageId: number;
      imageUrl: string;
      shotNo?: string | null;
    };
    maxShots?: number;
  }) => Promise<ShotConsistencyAnalysis>;
  generatingVideoShotNo?: number | null;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    characterReferenceImageUrl?: string;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: "low" | "high";
    aspectRatio?: "1:1";
    directorPromptApproved?: boolean;
    rerenderRequestId?: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<unknown>;
  onEstimateStartEndShotVideo?: (
    stableShotId: string
  ) => Promise<StartEndShotVideoEstimate>;
  onGenerateStartEndShotVideo?: (input: {
    shotNo: number;
    stableShotId: string;
    rerenderRequestId?: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<unknown>;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  onMarkVideoTakeUnusable?: (takeId: number) => Promise<void>;
  onRemoveTimelineVideoClip?: (input: {
    stableShotId: string;
    clipId: string;
  }) => Promise<void>;
  onEditVideo?: (target: VideoClipEditorTarget) => void;
  onEditImage?: (target: ImageClipEditorTarget) => void;
  onCopyVideo?: (target: VideoClipEditorTarget) => void;
  onPasteVideo?: (input: {
    stableShotId: string;
    shotNo: number;
    mode?: "replace" | "append";
    targetOffsetMs?: number;
  }) => Promise<void>;
  videoClipboardLabel?: string | null;
  onMoveStoryImage?: (input: {
    imageId: number;
    targetStableShotId: string;
    preserveTimelineSelection?: boolean;
  }) => Promise<void>;
  onDeleteStoryImage?: (imageId: number) => Promise<void>;
  onMoveVideoTake?: (input: {
    takeId: number;
    targetStableShotId: string;
  }) => Promise<void>;
  onAdoptVideoTake?: (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => Promise<void>;
  onPromoteFrameCrop?: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => Promise<{ imageId: number; imageUrl: string }>;
  onImportStoryMaterial?: (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
    preserveTimelineSelection?: boolean;
  }) => Promise<ImportedStoryMaterialResult>;
  onAnalyzeShotVideoDirection?: (input: {
    shotNo: number;
    stableShotId: string;
    draftPrompt: string;
    subtitle?: string;
  }) => Promise<ShotDirectorResult>;
  onUpdateShotFields?: (
    stableShotId: string,
    patch: Partial<Record<StoryShotEditableField, string>>
  ) => Promise<void>;
  promotingFrameCropShotNo?: number | null;
  shotVideoProviderStatus?: ShotVideoProviderStatus | null;
  defaultViewMode?: "full" | "simple";
  embeddedEditorMode?: boolean;
  headerAction?: ReactNode;
  className?: string;
}) {
  const [previewMedia, setPreviewMedia] =
    useState<StoryboardMediaPreview | null>(null);
  const [continuityDialog, setContinuityDialog] = useState<{
    shotLabel: string;
    renderKind: "image" | "video";
    options: StoryboardContinuityOption[];
    mismatches: ShotConsistencyMismatch[];
  } | null>(null);
  const continuityChoiceResolverRef = useRef<
    ((option: StoryboardContinuityOption | null) => void) | null
  >(null);
  const [viewMode, setViewMode] = useState<"full" | "simple">(defaultViewMode);
  const [insertingAfterShotNo, setInsertingAfterShotNo] = useState<
    number | null
  >(null);
  const [deletingShotId, setDeletingShotId] = useState<string | null>(null);
  const [videoTakeDropTargetId, setVideoTakeDropTargetId] = useState<
    string | null
  >(null);
  const [localMediaDropTargetId, setLocalMediaDropTargetId] = useState<
    string | null
  >(null);
  const [imageFrameDropTargetId, setImageFrameDropTargetId] = useState<
    string | null
  >(null);
  const [importingMediaShotId, setImportingMediaShotId] = useState<
    string | null
  >(null);
  const [movingImageId, setMovingImageId] = useState<number | null>(null);
  const [updatingFrameImageId, setUpdatingFrameImageId] = useState<
    number | null
  >(null);
  const [movingVideoTakeId, setMovingVideoTakeId] = useState<number | null>(
    null
  );
  const [refreshingVideoTakeId, setRefreshingVideoTakeId] = useState<
    number | null
  >(null);
  const [adoptingVideoTakeId, setAdoptingVideoTakeId] = useState<number | null>(
    null
  );
  const [pastingVideoShotId, setPastingVideoShotId] = useState<string | null>(
    null
  );
  const [previewVideoTakeByShot, setPreviewVideoTakeByShot] = useState<
    Record<string, number>
  >({});
  const [removingVideoKey, setRemovingVideoKey] = useState<string | null>(null);
  const [rerenderingShotNo, setRerenderingShotNo] = useState<number | null>(
    null
  );
  const [continuityChecking, setContinuityChecking] = useState<{
    shotNo: number;
    renderKind: "image" | "video";
  } | null>(null);
  const [draggedMatrixCell, setDraggedMatrixCell] = useState<{
    sourceIndex: number;
    field: StoryboardMatrixField;
  } | null>(null);
  const [matrixDropTarget, setMatrixDropTarget] = useState<{
    targetIndex: number;
    field: StoryboardMatrixField;
  } | null>(null);
  const matrixDraftsRef = useRef(
    new Map<string, Partial<Record<StoryboardMatrixField, string>>>()
  );
  const videoSingleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const settleContinuityChoice = useCallback(
    (option: StoryboardContinuityOption | null) => {
      const resolve = continuityChoiceResolverRef.current;
      continuityChoiceResolverRef.current = null;
      setContinuityDialog(null);
      resolve?.(option);
    },
    []
  );
  const requestContinuityChoice = useCallback(
    (request: NonNullable<typeof continuityDialog>) =>
      new Promise<StoryboardContinuityOption | null>(resolve => {
        continuityChoiceResolverRef.current?.(null);
        continuityChoiceResolverRef.current = resolve;
        setContinuityDialog(request);
      }),
    []
  );
  useEffect(
    () => () => {
      continuityChoiceResolverRef.current?.(null);
      continuityChoiceResolverRef.current = null;
    },
    []
  );
  useEffect(() => setViewMode(defaultViewMode), [defaultViewMode]);
  const cancelDeferredVideoSingleClick = useCallback(() => {
    if (videoSingleClickTimerRef.current === null) return;
    clearTimeout(videoSingleClickTimerRef.current);
    videoSingleClickTimerRef.current = null;
  }, []);
  const deferVideoSingleClick = useCallback(
    (action: () => void) => {
      cancelDeferredVideoSingleClick();
      videoSingleClickTimerRef.current = setTimeout(() => {
        videoSingleClickTimerRef.current = null;
        action();
      }, 220);
    },
    [cancelDeferredVideoSingleClick]
  );
  useEffect(
    () => () => cancelDeferredVideoSingleClick(),
    [cancelDeferredVideoSingleClick]
  );
  const pasteVideoIntoShot = useCallback(
    async (
      stableShotId: string,
      shotNo: number,
      mode: "replace" | "append"
    ) => {
      if (!onPasteVideo || !videoClipboardLabel) return;
      setPastingVideoShotId(stableShotId);
      try {
        await onPasteVideo({ stableShotId, shotNo, mode });
      } finally {
        setPastingVideoShotId(current =>
          current === stableShotId ? null : current
        );
      }
    },
    [onPasteVideo, videoClipboardLabel]
  );
  const boardRef = useRef<HTMLElement | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const dragScrollFrameRef = useRef<number | null>(null);
  const dragScrollClientYRef = useRef<number | null>(null);
  const dragScrollStartedAtRef = useRef<number | null>(null);
  const frames = useMemo(
    () => latestStoryboardFrames(images, shots),
    [images, shots]
  );
  const frameByShotNo = useMemo(
    () => new Map(frames.map(({ shotNo, image }) => [shotNo, image])),
    [frames]
  );
  const creationShotByNo = useMemo(
    () => new Map(creationShots.map(shot => [shot.shotNo, shot])),
    [creationShots]
  );
  const timelineShotIdSet = useMemo(
    () => new Set(timelineShotIds),
    [timelineShotIds]
  );
  const storyboardTimingRows = useMemo(
    () => buildStoryboardTimingRows(creationShots, timelineShotIds),
    [creationShots, timelineShotIds]
  );
  const storyboardTimelineDurationMs = storyboardTimingRows.at(-1)?.endMs ?? 0;
  const previousCreationShotsByNo = useMemo(() => {
    const byShotNo = new Map<number, CreationEditorShot[]>();
    const previous: CreationEditorShot[] = [];
    for (const shot of creationShots) {
      byShotNo.set(shot.shotNo, [...previous]);
      previous.push(shot);
    }
    return byShotNo;
  }, [creationShots]);
  const shouldShow =
    frames.length > 0 || isGeneratingScript || shots.length > 0 || latestScript;
  useEffect(() => {
    if (selectedShotNo == null) return;
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => {
        const target = boardRef.current?.querySelector<HTMLElement>(
          `[data-storyboard-shot-no="${selectedShotNo}"]`
        );
        if (viewMode === "full") {
          scrollElementHorizontallyIntoView(
            boardScrollRef.current,
            target ?? null,
            76
          );
          return;
        }
        target?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (nestedFrame) window.cancelAnimationFrame(nestedFrame);
    };
  }, [selectedShotNo, viewMode]);
  useEffect(() => {
    if (
      viewMode !== "full" ||
      selectedShotNo == null ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const scroller = boardScrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const keepSelectedShotVisible = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const target = boardRef.current?.querySelector<HTMLElement>(
          `[data-storyboard-shot-no="${selectedShotNo}"]`
        );
        scrollElementHorizontallyIntoView(scroller, target ?? null, 76);
      });
    };
    const observer = new ResizeObserver(keepSelectedShotVisible);
    observer.observe(scroller);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selectedShotNo, shots.length, viewMode]);

  const stopStoryboardDragScroll = useCallback(() => {
    dragScrollClientYRef.current = null;
    dragScrollStartedAtRef.current = null;
    if (dragScrollFrameRef.current != null) {
      window.cancelAnimationFrame(dragScrollFrameRef.current);
      dragScrollFrameRef.current = null;
    }
  }, []);

  const tickStoryboardDragScroll = useCallback(() => {
    const clientY = dragScrollClientYRef.current;
    if (clientY == null) {
      dragScrollFrameRef.current = null;
      return;
    }
    const now = window.performance.now();
    const startedAt = dragScrollStartedAtRef.current ?? now;
    dragScrollStartedAtRef.current = startedAt;
    const delta = autoScrollElementAtPoint(
      boardScrollRef.current,
      clientY,
      storyboardDragScrollSpeedMultiplier(now - startedAt)
    );
    if (delta === 0) {
      dragScrollStartedAtRef.current = null;
      dragScrollFrameRef.current = null;
      return;
    }
    dragScrollFrameRef.current = window.requestAnimationFrame(
      tickStoryboardDragScroll
    );
  }, []);

  const startStoryboardDragScroll = useCallback(
    (clientY: number) => {
      dragScrollClientYRef.current = clientY;
      if (dragScrollFrameRef.current == null) {
        dragScrollFrameRef.current = window.requestAnimationFrame(
          tickStoryboardDragScroll
        );
      }
    },
    [tickStoryboardDragScroll]
  );

  useEffect(() => stopStoryboardDragScroll, [stopStoryboardDragScroll]);

  if (!shouldShow) return null;

  const labelForShotNo = (shotNo: number) =>
    displayShotCode(shots.find(shot => shot.shotNo === shotNo) ?? { shotNo });

  const openShotEditor = (shotNo: number) => {
    onSelectShot?.(shotNo);
    setViewMode("full");
  };

  const resolveGenerationContinuity = async (input: {
    shot: StoryShot;
    creationShot: CreationEditorShot;
    renderKind: "image" | "video";
  }): Promise<StoryboardContinuityOption | null | undefined> => {
    const persistedReference = storyboardCharacterContinuityReference(
      input.creationShot.generationParams
    );
    const creationShotIdentity =
      input.creationShot.stableShotId ??
      input.creationShot.shotIdentity ??
      null;
    const currentIndex = creationShots.findIndex(candidate => {
      const candidateIdentity =
        candidate.stableShotId ?? candidate.shotIdentity ?? null;
      return creationShotIdentity
        ? candidateIdentity === creationShotIdentity
        : candidate === input.creationShot;
    });
    const previousShotWithImage =
      currentIndex > 0
        ? [...creationShots.slice(0, currentIndex)]
            .reverse()
            .find(candidate => Boolean(candidate.imageUrl))
        : undefined;
    const usingPreviousShotFallback =
      !persistedReference &&
      !continuityAnchor &&
      Boolean(previousShotWithImage?.imageUrl);
    const referenceAnchor =
      persistedReference ??
      continuityAnchor ??
      (previousShotWithImage?.imageUrl
        ? {
            label: `${displayShotCode(previousShotWithImage)} 人物版本`,
            imageUrl: previousShotWithImage.imageUrl,
          }
        : null);
    if (!referenceAnchor?.imageUrl) return undefined;
    const frameImages = storyboardShotFrameImages(input.creationShot);
    const options = storyboardContinuityOptions({
      anchor: referenceAnchor,
      frames: frameImages,
      currentImageId: input.creationShot.imageId,
    });
    const anchorOption = options.find(option => option.kind === "anchor");
    if (!anchorOption) return undefined;
    if (
      input.creationShot.imageId == null ||
      !input.creationShot.imageUrl ||
      input.creationShot.imageUrl === referenceAnchor.imageUrl
    ) {
      return anchorOption;
    }
    if (!onAnalyzeShotConsistency) return anchorOption;

    try {
      const analysis = await onAnalyzeShotConsistency({
        anchorImageUrl: referenceAnchor.imageUrl,
        targetImage: {
          imageId: input.creationShot.imageId,
          imageUrl: input.creationShot.imageUrl,
          shotNo: displayShotCode(input.shot),
        },
      });
      if (analysis.status !== "ok") {
        toast.info("人物一致性暂时无法自动判断，本次仍按人物基准约束");
        return anchorOption;
      }
      const finding =
        analysis.findings.find(
          candidate => candidate.imageId === input.creationShot.imageId
        ) ?? analysis.findings[0];
      if (finding?.verdict === "unknown" && usingPreviousShotFallback) {
        return undefined;
      }
      const mismatches = characterContinuityMismatches(finding);
      if (mismatches.length === 0) return anchorOption;
      return requestContinuityChoice({
        shotLabel: displayShotCode(input.shot),
        renderKind: input.renderKind,
        options,
        mismatches,
      });
    } catch (error) {
      console.warn("[storyboard-continuity] preflight failed", error);
      toast.info("人物一致性检查未完成，本次仍按人物基准约束");
      return anchorOption;
    }
  };

  const insertShotAfter = async (
    shotNo: number,
    stableShotId?: string | null
  ) => {
    if (!onInsertShotAfter || insertingAfterShotNo != null || deletingShotId)
      return;
    setInsertingAfterShotNo(shotNo);
    try {
      await onInsertShotAfter(shotNo, stableShotId);
      toast.success(`已在 ${labelForShotNo(shotNo)} 后添加镜头`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "添加镜头失败，请稍后再试"
      );
    } finally {
      setInsertingAfterShotNo(null);
    }
  };

  const deleteShot = async (shotNo: number, stableShotId?: string | null) => {
    if (!onDeleteShot || deletingShotId || insertingAfterShotNo != null) return;
    if (shots.length <= 1) {
      toast.error("至少保留一个镜头");
      return;
    }
    const label = labelForShotNo(shotNo);
    const confirmed = window.confirm(
      `删除 ${label}？这会移除该镜头，并重新编号后面的镜头。`
    );
    if (!confirmed) return;
    const shotId = stableShotId ?? `shot-${shotNo}`;
    setDeletingShotId(shotId);
    try {
      await onDeleteShot(shotNo, stableShotId);
      toast.success(`已删除 ${label}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "删除镜头失败，请稍后再试"
      );
    } finally {
      setDeletingShotId(null);
    }
  };

  const importLocalMediaToShot = async (input: {
    shot: StoryShot;
    stableShotId: string;
    shotTimelineId: string;
    isOnTimeline: boolean;
    files: File[];
  }) => {
    if (!onImportStoryMaterial) return;
    if (importingMediaShotId) {
      toast.info("上一个本地素材仍在导入");
      return;
    }
    const label = displayShotCode(input.shot);
    setImportingMediaShotId(input.stableShotId);
    onSelectShot?.(input.shot.shotNo);
    try {
      const result = await importStoryboardMediaFiles({
        files: input.files,
        stableShotId: input.stableShotId,
        note: `${label} 表格拖入`,
        importMaterial: onImportStoryMaterial,
        adoptVideoTake: onAdoptVideoTake,
      });
      const creationShot = creationShotByNo.get(input.shot.shotNo);
      let lockedStartEndFrames = false;
      if (result.images.length > 0 && creationShot && onUpdateShotFields) {
        const existingFrames = storyboardShotFrameImages(creationShot);
        const importedFrames = result.images.map(image => ({
          id: image.imageId,
          imageUrl: image.imageUrl,
        }));
        const orderedFrames =
          importedFrames.length >= 2
            ? importedFrames
            : [...existingFrames, ...importedFrames];
        const generationParams = storyboardStartEndGenerationParams(
          creationShot.generationParams,
          orderedFrames,
          creationShot.durationMs
        );
        if (generationParams) {
          await onUpdateShotFields(input.stableShotId, { generationParams });
          lockedStartEndFrames = true;
        }
      }
      if (!input.isOnTimeline && onAddShotToTimeline) {
        onAddShotToTimeline(input.shot.shotNo, input.shotTimelineId);
      }
      const imported = [
        result.imageCount > 0 ? `${result.imageCount} 张图片` : null,
        result.videoCount > 0 ? `${result.videoCount} 条视频` : null,
      ]
        .filter(Boolean)
        .join("、");
      const outcomes = [
        result.imageCount > 0 ? "图片已设为主图" : null,
        lockedStartEndFrames ? "首尾帧已按素材顺序锁定" : null,
        result.adoptedVideoCount > 0 ? "视频已进入动态分镜" : null,
        result.videoCount > result.adoptedVideoCount
          ? "视频已保存为候选 Take"
          : null,
      ]
        .filter(Boolean)
        .join("，");
      toast.success(`${label} 已导入 ${imported}；${outcomes}`);
      if (result.rejected.length > 0) {
        toast.info(`另有 ${result.rejected.length} 个文件未导入`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材导入失败");
    } finally {
      setImportingMediaShotId(null);
      setLocalMediaDropTargetId(null);
    }
  };

  const moveStoryboardImageToShot = async (input: {
    imageId: number;
    sourceStableShotId: string;
    sourceShotNo: number;
    targetShot: StoryShot;
    targetStableShotId: string;
  }) => {
    if (!onMoveStoryImage) return;
    if (input.sourceStableShotId === input.targetStableShotId) {
      toast.info("这个画面已经在当前镜头");
      return;
    }
    if (movingImageId != null) {
      toast.info("上一个画面仍在移动");
      return;
    }
    const sourceShot =
      creationShots.find(
        shot =>
          shot.stableShotId === input.sourceStableShotId ||
          shot.shotIdentity === input.sourceStableShotId
      ) ?? creationShotByNo.get(input.sourceShotNo);
    const targetShot = creationShotByNo.get(input.targetShot.shotNo);
    const frameOrders =
      sourceShot &&
      storyboardFrameOrdersAfterMove(
        storyboardShotFrameImages(sourceShot),
        targetShot ? storyboardShotFrameImages(targetShot) : [],
        input.imageId
      );
    setMovingImageId(input.imageId);
    onSelectShot?.(input.targetShot.shotNo);
    try {
      await onMoveStoryImage({
        imageId: input.imageId,
        targetStableShotId: input.targetStableShotId,
        preserveTimelineSelection: true,
      });
      if (frameOrders && onUpdateShotFields) {
        await onUpdateShotFields(input.sourceStableShotId, {
          generationParams: storyboardFrameOrderGenerationParams(
            sourceShot.generationParams,
            frameOrders.sourceImages,
            sourceShot.durationMs
          ),
        });
        await onUpdateShotFields(input.targetStableShotId, {
          generationParams: storyboardFrameOrderGenerationParams(
            targetShot?.generationParams,
            frameOrders.targetImages,
            targetShot?.durationMs
          ),
        });
      }
      toast.success(
        `已把图片 #${input.imageId} 移到 ${displayShotCode(input.targetShot)}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "画面移动失败，请稍后再试"
      );
    } finally {
      setMovingImageId(null);
      setImageFrameDropTargetId(null);
    }
  };

  const setStoryboardFrameRole = async (input: {
    shot: StoryShot;
    creationShot: CreationEditorShot;
    stableShotId: string;
    frameImages: Array<Pick<CreationEditorImage, "id" | "imageUrl">>;
    imageId: number;
    role: StoryboardFrameRole;
  }) => {
    if (!onUpdateShotFields || updatingFrameImageId != null) return;
    setUpdatingFrameImageId(input.imageId);
    onSelectShot?.(input.shot.shotNo);
    try {
      const generationParams = storyboardFrameRoleGenerationParams(
        input.creationShot.generationParams,
        input.frameImages,
        input.imageId,
        input.role,
        input.creationShot.durationMs
      );
      await onUpdateShotFields(input.stableShotId, { generationParams });
      const roleLabel =
        input.role === "first"
          ? "首帧"
          : input.role === "last"
            ? "尾帧"
            : "中间参考";
      toast.success(`图片 #${input.imageId} 已设为${roleLabel}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "画面角色保存失败");
    } finally {
      setUpdatingFrameImageId(null);
    }
  };

  const deleteStoryboardFrame = async (input: {
    shot: StoryShot;
    creationShot: CreationEditorShot;
    stableShotId: string;
    frameImages: Array<Pick<CreationEditorImage, "id" | "imageUrl">>;
    imageId: number;
  }) => {
    if (
      !onDeleteStoryImage ||
      !onUpdateShotFields ||
      updatingFrameImageId != null
    )
      return;
    setUpdatingFrameImageId(input.imageId);
    onSelectShot?.(input.shot.shotNo);
    try {
      const generationParams = storyboardFrameParamsAfterDelete(
        input.creationShot.generationParams,
        input.frameImages,
        input.imageId,
        input.creationShot.durationMs
      );
      await onUpdateShotFields(input.stableShotId, { generationParams });
      await onDeleteStoryImage(input.imageId);
      if (
        previewMedia?.kind === "image" &&
        input.frameImages.find(
          frame =>
            frame.id === input.imageId && frame.imageUrl === previewMedia.url
        )
      ) {
        setPreviewMedia(null);
      }
      toast.success(`图片 #${input.imageId} 已删除`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片删除失败");
    } finally {
      setUpdatingFrameImageId(null);
    }
  };

  const shotMediaDropHandlers = (
    shot: StoryShot,
    stableShotId: string | null | undefined,
    shotTimelineId: string,
    isOnTimeline: boolean
  ) => {
    if (!stableShotId) return {};
    const isImageFrameDrag = (event: DragEvent<HTMLElement>) =>
      hasStoryboardImageDragPayload(event.dataTransfer);
    const isVideoTakeDrag = (event: DragEvent<HTMLElement>) =>
      hasVideoTakeDragPayload(event.dataTransfer);
    const isLocalMediaDrag = (event: DragEvent<HTMLElement>) =>
      Array.from(event.dataTransfer.types).includes("Files");
    return {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        const localMedia = isLocalMediaDrag(event);
        const imageFrame = isImageFrameDrag(event);
        const videoTake = isVideoTakeDrag(event);
        if (
          (!localMedia || !onImportStoryMaterial) &&
          (!imageFrame || !onMoveStoryImage) &&
          (!videoTake || !onMoveVideoTake)
        ) {
          return;
        }
        event.preventDefault();
        if (localMedia) setLocalMediaDropTargetId(stableShotId);
        if (imageFrame) setImageFrameDropTargetId(stableShotId);
        if (videoTake) setVideoTakeDropTargetId(stableShotId);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const localMedia = isLocalMediaDrag(event);
        const imageFrame = isImageFrameDrag(event);
        const videoTake = isVideoTakeDrag(event);
        if (
          (!localMedia || !onImportStoryMaterial) &&
          (!imageFrame || !onMoveStoryImage) &&
          (!videoTake || !onMoveVideoTake)
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = localMedia ? "copy" : "move";
        startStoryboardDragScroll(event.clientY);
        autoScrollElementHorizontallyAtPoint(
          boardScrollRef.current,
          event.clientX
        );
        if (localMedia) setLocalMediaDropTargetId(stableShotId);
        if (imageFrame) setImageFrameDropTargetId(stableShotId);
        if (videoTake) setVideoTakeDropTargetId(stableShotId);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return;
        }
        setVideoTakeDropTargetId(current =>
          current === stableShotId ? null : current
        );
        setImageFrameDropTargetId(current =>
          current === stableShotId ? null : current
        );
        setLocalMediaDropTargetId(current =>
          current === stableShotId ? null : current
        );
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const localMedia = isLocalMediaDrag(event);
        const imageFrame = isImageFrameDrag(event);
        const videoTake = isVideoTakeDrag(event);
        if (
          (!localMedia || !onImportStoryMaterial) &&
          (!imageFrame || !onMoveStoryImage) &&
          (!videoTake || !onMoveVideoTake)
        ) {
          return;
        }
        event.preventDefault();
        // stopPropagation 会拦住看板容器上的 onDrop={stopStoryboardDragScroll}，
        // 这里必须自己停掉拖拽自动滚动，否则循环带着最后的坐标一路滚到底。
        event.stopPropagation();
        stopStoryboardDragScroll();
        setVideoTakeDropTargetId(null);
        setImageFrameDropTargetId(null);
        setLocalMediaDropTargetId(null);
        if (localMedia) {
          const files = Array.from(event.dataTransfer.files);
          void importLocalMediaToShot({
            shot,
            stableShotId,
            shotTimelineId,
            isOnTimeline,
            files,
          });
          return;
        }
        if (imageFrame) {
          const payload = readStoryboardImageDragPayload(event.dataTransfer);
          if (!payload) return;
          void moveStoryboardImageToShot({
            ...payload,
            targetShot: shot,
            targetStableShotId: stableShotId,
          });
          return;
        }
        const payload = readVideoTakeDragPayload(event.dataTransfer);
        if (!payload || !onMoveVideoTake) return;
        if (payload.sourceStableShotId === stableShotId) {
          toast.info("这个 Take 已经在当前镜头下");
          return;
        }
        setMovingVideoTakeId(payload.takeId);
        void onMoveVideoTake({
          takeId: payload.takeId,
          targetStableShotId: stableShotId,
        })
          .then(() => {
            onSelectShot?.(shot.shotNo);
            const shotLabel = displayShotCode(shot);
            toast.success(`已移动 Take ${payload.takeId} 到 ${shotLabel}`);
          })
          .catch(error => {
            toast.error(
              error instanceof Error ? error.message : "视频 Take 移动失败"
            );
          })
          .finally(() => setMovingVideoTakeId(null));
      },
    };
  };

  const matrixShotColumnWidth = embeddedEditorMode ? 196 : 248;

  const renderShotImageCandidates = async (
    shot: StoryShot,
    creationShot: CreationEditorShot | undefined,
    shotIndex: number
  ) => {
    const label = displayShotCode(shot);
    if (!creationShot || !onGenerateShotImages) {
      toast.error(`${label} 还没有可渲染的镜头记录`);
      return;
    }
    if (
      generatingImageShotNo != null ||
      continuityChecking != null ||
      rerenderingShotNo != null ||
      generatingVideoShotNo != null
    ) {
      toast.info("已有渲染或人物检查正在进行，请稍候");
      return;
    }
    const stableShotId = storyShotInsertIdentity(shot, shotIndex);
    const pendingInstruction = stableShotId
      ? matrixDraftsRef.current.get(stableShotId)?.promptDraft
      : undefined;
    const explicitInstruction = storyboardExplicitImageInstruction(
      shot,
      pendingInstruction
    );
    if (!explicitInstruction) {
      toast.error(`请先在 ${label} 的“图片要求”中写清楚要怎样生成或修改`);
      return;
    }

    setContinuityChecking({ shotNo: shot.shotNo, renderKind: "image" });
    let continuityChoice: StoryboardContinuityOption | null | undefined;
    try {
      continuityChoice = await resolveGenerationContinuity({
        shot,
        creationShot,
        renderKind: "image",
      });
    } finally {
      setContinuityChecking(null);
    }
    if (continuityChoice === null) return;

    const imageEstimate = estimateStoryboardImageCost();
    const confirmed = window.confirm(
      `${label} 将按下面这段原文硬指令生成 ${imageEstimate.candidateCount} 张同风格候选图：\n\n${explicitInstruction}\n\n人物版本：${continuityChoice?.label ?? "当前镜头"}。未提及的人物、物体、材质和全片风格会尽量保持不变。预计人民币 ¥${imageEstimate.estimatedCny.toFixed(2)}，确认提交正式图片生成？`
    );
    if (!confirmed) return;

    onSelectShot?.(shot.shotNo);
    try {
      if (
        onUpdateShotField &&
        explicitInstruction !== (shot.promptDraft ?? "").trim()
      ) {
        await onUpdateShotField(shotIndex, "promptDraft", explicitInstruction);
      }
      if (continuityChoice && stableShotId && onUpdateShotFields) {
        await onUpdateShotFields(stableShotId, {
          generationParams: storyboardCharacterContinuityGenerationParams(
            creationShot.generationParams,
            continuityChoice
          ),
        });
      }
      const effectiveShot = storyboardRenderShotWithDraft(creationShot, shot, {
        promptDraft: explicitInstruction,
      });
      const creationShotIdentity =
        creationShot.stableShotId ?? creationShot.shotIdentity ?? null;
      const creationShotIndex = creationShots.findIndex(
        candidate =>
          candidate === creationShot ||
          (creationShotIdentity != null &&
            (candidate.stableShotId ?? candidate.shotIdentity) ===
              creationShotIdentity)
      );
      const rows = buildPromptTable(effectiveShot, {
        previousShots:
          creationShotIndex > 0
            ? creationShots.slice(0, creationShotIndex)
            : [],
      });
      await onGenerateShotImages({
        shotNo: shot.shotNo,
        rows,
        explicitInstruction,
        reference: continuityChoice
          ? {
              imageUrl: creationShot.imageUrl ?? continuityChoice.imageUrl,
              identityImageUrl: continuityChoice.imageUrl,
            }
          : undefined,
        costConfirmation: {
          accepted: true,
          estimatedCny: imageEstimate.estimatedCny,
        },
      });
      toast.success(`${label} 已生成四张候选图，请在“画面”行选择一张`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `${label} 图片生成失败`
      );
    }
  };

  const promoteStoryboardFrameCandidate = async (input: {
    shot: StoryShot;
    imageId: number;
    imageUrl: string;
    quadrant: FrameQuadrant;
  }) => {
    if (!onPromoteFrameCrop) return;
    onSelectShot?.(input.shot.shotNo);
    try {
      const cropped = await cropFrameQuadrant(input.imageUrl, input.quadrant);
      await onPromoteFrameCrop({
        shotNo: input.shot.shotNo,
        imageBase64: cropped.imageBase64,
        mimeType: cropped.mimeType,
        parentImageId: input.imageId,
        quadrant: input.quadrant,
      });
      toast.success(
        `${displayShotCode(input.shot)} 已采用${FRAME_QUADRANTS.find(item => item.value === input.quadrant)?.label ?? ""}候选`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "候选图片保存失败");
    }
  };

  const rerenderShotVideo = async (
    shot: StoryShot,
    creationShot: CreationEditorShot | undefined
  ) => {
    const label = displayShotCode(shot);
    if (!creationShot) {
      toast.error(`${label} 还没有可渲染的镜头记录`);
      return;
    }
    if (
      continuityChecking != null ||
      rerenderingShotNo != null ||
      generatingVideoShotNo != null
    ) {
      toast.info("已有视频任务或人物检查正在进行，请稍候");
      return;
    }
    const stableShotId =
      creationShot.stableShotId ?? creationShot.shotIdentity ?? null;
    const shotIndex = shots.findIndex(candidate => candidate === shot);
    const draftKey =
      (shotIndex >= 0 ? storyShotInsertIdentity(shot, shotIndex) : null) ??
      stableShotId;
    let effectiveShot = storyboardRenderShotWithDraft(
      creationShot,
      shot,
      draftKey ? matrixDraftsRef.current.get(draftKey) : undefined
    );
    setRerenderingShotNo(shot.shotNo);
    onSelectShot?.(shot.shotNo);
    try {
      setContinuityChecking({ shotNo: shot.shotNo, renderKind: "video" });
      let continuityChoice: StoryboardContinuityOption | null | undefined;
      try {
        continuityChoice = await resolveGenerationContinuity({
          shot,
          creationShot: effectiveShot,
          renderKind: "video",
        });
      } finally {
        setContinuityChecking(null);
      }
      if (continuityChoice === null) return;
      if (continuityChoice) {
        effectiveShot = {
          ...effectiveShot,
          generationParams: storyboardCharacterContinuityGenerationParams(
            effectiveShot.generationParams,
            continuityChoice
          ),
        };
      }
      const intentSummary = storyboardRenderIntentSummary(effectiveShot);
      const currentFrameImages = storyboardShotFrameImages(effectiveShot);
      const creationShotIndex = creationShots.findIndex(candidate => {
        const candidateStableShotId =
          candidate.stableShotId ?? candidate.shotIdentity ?? null;
        return stableShotId
          ? candidateStableShotId === stableShotId
          : candidate === creationShot;
      });
      const neighborFrameSource = (
        candidate: CreationEditorShot | undefined
      ): StoryboardNeighborFrameSource | null =>
        candidate
          ? {
              generationParams: candidate.generationParams,
              images: storyboardShotFrameImages(candidate),
              stableShotId:
                candidate.stableShotId ?? candidate.shotIdentity ?? null,
              cueCode: displayShotCode(candidate),
            }
          : null;
      const derivedGenerationParams =
        storyboardStartEndGenerationParams(
          effectiveShot.generationParams,
          currentFrameImages,
          effectiveShot.durationMs
        ) ??
        storyboardInheritedStartEndGenerationParams(
          effectiveShot.generationParams,
          currentFrameImages,
          neighborFrameSource(
            creationShotIndex >= 0
              ? creationShots[creationShotIndex - 1]
              : undefined
          ),
          neighborFrameSource(
            creationShotIndex >= 0
              ? creationShots[creationShotIndex + 1]
              : undefined
          ),
          effectiveShot.durationMs
        );
      if (onUpdateShotFields && !stableShotId) {
        throw new Error(`${label} 缺少稳定镜头编号，无法先保存再重新渲染`);
      }
      if (stableShotId && onUpdateShotFields) {
        await onUpdateShotFields(
          stableShotId,
          storyboardVideoIntentPatch(
            effectiveShot,
            derivedGenerationParams ??
              effectiveShot.generationParams ??
              undefined
          )
        );
      }
      const effectiveGenerationParams =
        derivedGenerationParams ?? effectiveShot.generationParams;
      const startEndConfig = parseStartEndVideoConfig(
        effectiveGenerationParams,
        Math.max(0.1, (effectiveShot.durationMs ?? 5_000) / 1_000)
      );
      if (startEndConfig) {
        if (
          !stableShotId ||
          !onEstimateStartEndShotVideo ||
          !onGenerateStartEndShotVideo
        ) {
          throw new Error("这个首尾帧镜头暂时无法提交视频生成");
        }
        const estimate = await onEstimateStartEndShotVideo(stableShotId);
        const usesLocalTransform =
          estimate.renderStrategy === "local-transform";
        const frameConstraintNotice = estimate.frameConstraintWarning
          ? `\n\n注意：${estimate.frameConstraintWarning}`
          : "";
        const confirmed = window.confirm(
          usesLocalTransform
            ? `${label} 已判断为简单缩放、平移或定格：${estimate.renderReason} 将在本机免费生成，人民币 ¥0.00，不会请求 302；会创建新 Take 并保留旧版本。确认生成？`
            : `${label} 已先保存本镜文字，视频模型会收到：\n${intentSummary || "当前镜头表格中的动作与运镜"}\n\n人物版本：${continuityChoice?.label ?? "当前镜头"}。并使用首帧 ${estimate.firstFrame.label}（图 #${estimate.firstFrame.imageId}）和末帧 ${estimate.lastFrame.label}（图 #${estimate.lastFrame.imageId}）重新渲染。${frameConstraintNotice}\n\n判断：${estimate.renderReason} 预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，时长 ${estimate.durationSec} 秒、${estimate.resolution}、1:1；会创建新 Take 并保留旧版本。确认提交？`
        );
        if (!confirmed) return;
        const result = (await onGenerateStartEndShotVideo({
          shotNo: effectiveShot.shotNo,
          stableShotId,
          rerenderRequestId: storyboardRerenderRequestId(effectiveShot.shotNo),
          costConfirmation: {
            accepted: true,
            estimatedCny: estimate.estimatedCny,
          },
        })) as { takeId?: number } | undefined;
        toast.success(
          result?.takeId
            ? usesLocalTransform
              ? `${label} 已在本机生成候选 Take ${result.takeId}，未调用 302`
              : `${label} 已提交为候选 Take ${result.takeId}`
            : usesLocalTransform
              ? `${label} 已完成本地镜头生成`
              : `${label} 首尾帧视频已提交`
        );
        return;
      }

      const startEndFrameIssue = storyboardStartEndFrameIssue(
        effectiveGenerationParams,
        currentFrameImages
      );
      if (startEndFrameIssue) throw new Error(startEndFrameIssue);

      if (!onGenerateShotVideo) {
        throw new Error("视频生成链路尚未连接");
      }
      if (effectiveShot.imageId == null || !effectiveShot.imageUrl) {
        throw new Error(`${label} 需要先选择一张当前主图`);
      }
      const plan = quickShotVideoRenderPlan(
        effectiveShot,
        previousCreationShotsByNo.get(effectiveShot.shotNo) ?? []
      );
      if (plan.missing.length > 0) {
        throw new Error(`${label} 还缺少：${plan.missing.join("、")}`);
      }
      if (
        plan.renderDecision.strategy === "paid-302" &&
        !shotVideoProviderStatus?.ready
      ) {
        const missing = shotVideoProviderStatus?.missing
          .filter(Boolean)
          .join("、");
        throw new Error(
          missing ? `视频模型未就绪：${missing}` : "视频模型状态尚未就绪"
        );
      }
      const confirmed = window.confirm(
        plan.renderDecision.strategy === "local-transform"
          ? `${label} 已判断为简单缩放、平移或定格：${plan.renderDecision.reason} 将在本机免费生成，人民币 ¥0.00，不会请求 302；会创建新 Take 并保留旧版本。确认生成？`
          : `${label} 已先保存本镜文字，视频模型会收到：\n${intentSummary || "当前镜头表格中的动作与运镜"}\n\n人物版本：${continuityChoice?.label ?? "当前镜头"}。判断：${plan.renderDecision.reason} 预计人民币 ¥${plan.estimatedCny.toFixed(2)}，时长 ${plan.durationSec} 秒、1:1；会创建新 Take 并保留旧版本。确认提交？`
      );
      if (!confirmed) return;
      const result = (await onGenerateShotVideo({
        shotNo: effectiveShot.shotNo,
        imageId: effectiveShot.imageId,
        characterReferenceImageUrl: continuityChoice?.imageUrl,
        prompt: plan.prompt,
        subtitle: effectiveShot.dialogue || undefined,
        durationSec: plan.durationSec,
        motion: plan.motion,
        aspectRatio: plan.aspectRatio,
        directorPromptApproved: false,
        rerenderRequestId: storyboardRerenderRequestId(effectiveShot.shotNo),
        costConfirmation: {
          accepted: true,
          estimatedCny: plan.estimatedCny,
        },
      })) as { takeId?: number } | undefined;
      toast.success(
        result?.takeId
          ? plan.renderDecision.strategy === "local-transform"
            ? `${label} 已在本机生成候选 Take ${result.takeId}，未调用 302`
            : `${label} 已提交为候选 Take ${result.takeId}`
          : plan.renderDecision.strategy === "local-transform"
            ? `${label} 已完成本地镜头生成`
            : `${label} 视频已提交；结果会显示在画面 / Take 行`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `${label} 视频提交失败`
      );
    } finally {
      setRerenderingShotNo(null);
    }
  };

  const dropMatrixCell = (
    targetIndex: number,
    row: StoryboardMatrixRow,
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    stopStoryboardDragScroll();
    const dragged = draggedMatrixCell;
    setMatrixDropTarget(null);
    setDraggedMatrixCell(null);
    if (!dragged || dragged.field !== row.field || !onUpdateShotField) return;
    const plan = storyboardMatrixSwapPlan(
      shots,
      dragged.sourceIndex,
      targetIndex,
      row.field
    );
    if (!plan) return;
    const sourceShot = shots[dragged.sourceIndex];
    const targetShot = shots[targetIndex];
    if (!sourceShot || !targetShot) return;
    const sourceLabel = displayShotCode(sourceShot);
    const targetLabel = displayShotCode(targetShot);
    const operation = plan.targetValue ? "交换" : "移动";
    const confirmed = window.confirm(
      `${operation} ${sourceLabel} 与 ${targetLabel} 的“${row.label}”内容？`
    );
    if (!confirmed) return;
    onUpdateShotField(dragged.sourceIndex, row.field, plan.targetValue);
    onUpdateShotField(targetIndex, row.field, plan.sourceValue);
    onSelectShot?.(targetShot.shotNo);
    toast.success(`已${operation}“${row.label}”`);
  };

  return (
    <section
      ref={boardRef}
      className={`creation-board-panel h-full min-h-0 flex flex-col ${className}`.trim()}
      aria-label="故事版看板"
      onDragOver={event => {
        if (!hasStoryboardScrollableDragPayload(event.dataTransfer)) return;
        if (hasVideoTakeDragPayload(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
        startStoryboardDragScroll(event.clientY);
      }}
      onDragLeave={event => {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return;
        }
        stopStoryboardDragScroll();
      }}
      onDrop={stopStoryboardDragScroll}
    >
      <div className="creation-board-panel-header shrink-0 justify-between">
        <div className="creation-board-panel-title">
          <Clapperboard className="creation-board-panel-icon" />
          <span className="creation-board-panel-title-text">故事版看板</span>
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          {!headerAction ? (
            <span className="creation-board-panel-status">
              {isGeneratingScript
                ? "生成故事版中"
                : storyboardTimelineDurationMs > 0
                  ? `${shots.length} 镜 · ${(storyboardTimelineDurationMs / 1000).toFixed(1)}s · ${frames.length} 图`
                  : `${shots.length} 镜 · ${frames.length} 图`}
            </span>
          ) : null}
          {shots.length > 0 ? (
            <span
              className="inline-flex rounded-sm bg-muted/45 p-0.5 text-[10px]"
              aria-label="故事版看板视图"
            >
              <button
                type="button"
                aria-pressed={viewMode === "full"}
                onClick={() => setViewMode("full")}
                className="rounded-sm px-2 py-0.5"
                style={{
                  background:
                    viewMode === "full" ? "var(--nayin-accent)" : "transparent",
                  color:
                    viewMode === "full"
                      ? "var(--background)"
                      : "var(--muted-foreground)",
                }}
              >
                完整
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "simple"}
                onClick={() => setViewMode("simple")}
                className="rounded-sm px-2 py-0.5"
                style={{
                  background:
                    viewMode === "simple"
                      ? "var(--nayin-accent)"
                      : "transparent",
                  color:
                    viewMode === "simple"
                      ? "var(--background)"
                      : "var(--muted-foreground)",
                }}
              >
                简读
              </button>
            </span>
          ) : null}
        </div>
      </div>

      <div
        ref={viewMode === "simple" ? boardScrollRef : undefined}
        className={`creation-board-panel-body min-h-0 flex-1 custom-scrollbar ${
          viewMode === "full" ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {shots.length > 0 && viewMode === "simple" ? (
          <div className="grid snap-y snap-mandatory gap-1 pb-2 pr-1">
            {shots.map((shot, index) => {
              const image = frameByShotNo.get(shot.shotNo);
              const creationShot = creationShotByNo.get(shot.shotNo);
              const videoPreviewTake = storyboardPreviewVideoTake(creationShot);
              const previewImageUrl =
                image?.imageUrl ?? creationShot?.imageUrl ?? null;
              const previewImageId = creationShot?.imageId ?? image?.id ?? null;
              const videoPosterUrl = videoPreviewTake
                ? videoTakeFrameUrl(videoPreviewTake, "start")
                : null;
              const insertStableShotId = storyShotInsertIdentity(shot, index);
              const shotTimelineId = creationShot
                ? creationTimelineShotId(creationShot)
                : (shot.stableShotId ??
                  shot.shotIdentity ??
                  `legacy-sh${String(shot.shotNo).padStart(2, "0")}`);
              const selected = selectedShotNo === shot.shotNo;
              const isOnTimeline = timelineShotIdSet.has(shotTimelineId);
              const isVideoTakeDropTarget =
                insertStableShotId != null &&
                videoTakeDropTargetId === insertStableShotId;
              const isImageFrameDropTarget =
                insertStableShotId != null &&
                imageFrameDropTargetId === insertStableShotId;
              const isLocalMediaDropTarget =
                insertStableShotId != null &&
                localMediaDropTargetId === insertStableShotId;
              const isImportingMedia =
                insertStableShotId != null &&
                importingMediaShotId === insertStableShotId;
              const title = shortText(
                shot.dialogue,
                shortText(shot.action, shortText(shot.subject, "关键镜头"))
              );
              const detail =
                [shot.subject, shot.cameraMove].filter(Boolean).join(" · ") ||
                "镜头内容待补充";
              return (
                <article
                  key={`simple-${shot.stableShotId ?? shot.shotIdentity ?? shot.shotNo}-${index}`}
                  data-storyboard-shot-no={shot.shotNo}
                  {...shotMediaDropHandlers(
                    shot,
                    insertStableShotId,
                    shotTimelineId,
                    isOnTimeline
                  )}
                  aria-busy={isImportingMedia}
                  className="relative grid min-h-0 snap-start grid-cols-[72px_minmax(0,1fr)] gap-2 overflow-hidden rounded-sm p-1.5"
                  style={{
                    background:
                      isVideoTakeDropTarget ||
                      isImageFrameDropTarget ||
                      isLocalMediaDropTarget
                        ? "var(--nayin-glow)"
                        : selected
                          ? "var(--nayin-glow)"
                          : "transparent",
                  }}
                  onClick={() => openShotEditor(shot.shotNo)}
                >
                  {isLocalMediaDropTarget ||
                  isImageFrameDropTarget ||
                  isImportingMedia ? (
                    <StoryboardMediaDropOverlay
                      shotLabel={displayShotCode(shot)}
                      importing={isImportingMedia}
                      moving={isImageFrameDropTarget}
                    />
                  ) : null}
                  <button
                    type="button"
                    draggable={Boolean(
                      insertStableShotId &&
                        (videoPreviewTake?.id ||
                          creationShot?.imageId ||
                          image?.id)
                    )}
                    className="relative block h-[72px] w-[72px] overflow-hidden rounded-sm bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                    onDragStart={event => {
                      if (!insertStableShotId) {
                        event.preventDefault();
                        return;
                      }
                      if (videoPreviewTake?.id) {
                        writeVideoTakeDragPayload(event.dataTransfer, {
                          takeId: videoPreviewTake.id,
                          sourceStableShotId: insertStableShotId,
                          sourceShotNo: shot.shotNo,
                        });
                        return;
                      }
                      const imageId = creationShot?.imageId ?? image?.id;
                      if (!imageId) {
                        event.preventDefault();
                        return;
                      }
                      writeStoryboardImageDragPayload(event.dataTransfer, {
                        imageId,
                        sourceStableShotId: insertStableShotId,
                        sourceShotNo: shot.shotNo,
                      });
                    }}
                    onDragEnd={() => {
                      stopStoryboardDragScroll();
                      setImageFrameDropTargetId(null);
                      setVideoTakeDropTargetId(null);
                    }}
                    onClick={event => {
                      event.stopPropagation();
                      if (
                        (videoPreviewTake && onEditVideo) ||
                        (previewImageUrl && previewImageId && onEditImage)
                      ) {
                        deferVideoSingleClick(() =>
                          openShotEditor(shot.shotNo)
                        );
                        return;
                      }
                      openShotEditor(shot.shotNo);
                    }}
                    onDoubleClick={event => {
                      cancelDeferredVideoSingleClick();
                      if (!insertStableShotId) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      if (videoPreviewTake && onEditVideo) {
                        const target = videoClipEditorTargetForTake({
                          stableShotId: insertStableShotId,
                          shotNo: shot.shotNo,
                          cueCode: shot.cueCode,
                          label: `${displayShotCode(shot)} · Take ${videoPreviewTake.id}`,
                          take: videoPreviewTake,
                          timelineItem: creationShot?.timelineItem,
                          posterUrl: videoPosterUrl,
                        });
                        if (target) onEditVideo(target);
                        return;
                      }
                      if (
                        creationShot &&
                        previewImageId &&
                        previewImageUrl &&
                        onEditImage
                      ) {
                        onEditImage(
                          imageClipEditorTargetForShot({
                            shot: creationShot,
                            stableShotId: insertStableShotId,
                            imageId: previewImageId,
                            imageUrl: previewImageUrl,
                            label: `${displayShotCode(shot)} · 图片 #${previewImageId}`,
                          })
                        );
                      }
                    }}
                    aria-label={`编辑 ${displayShotCode(shot)}`}
                    title={
                      videoPreviewTake
                        ? `${displayShotCode(shot)} · 双击编辑视频`
                        : previewImageUrl && onEditImage
                          ? `${displayShotCode(shot)} · 双击编辑图片`
                          : `编辑 ${displayShotCode(shot)}`
                    }
                  >
                    {videoPreviewTake?.videoUrl ? (
                      <StoryboardVideoThumbnail
                        src={videoPreviewTake.videoUrl}
                        poster={videoPosterUrl}
                        active={selected}
                        label={`${displayShotCode(shot)} 视频缩略预览`}
                        className="h-full w-full object-cover"
                      />
                    ) : previewImageUrl ? (
                      <img
                        src={previewImageUrl}
                        alt={`${displayShotCode(shot)} ${title}`}
                        draggable={false}
                        className="h-full w-full object-cover"
                        style={timelineTransformStyle(
                          creationShot?.timelineItem?.transform
                        )}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        {isGeneratingScript ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="h-3.5 w-3.5" />
                        )}
                      </div>
                    )}
                    <span className="absolute left-1 top-1 rounded-sm bg-background/90 px-1 py-0.5 font-mono text-[8px] font-semibold text-foreground">
                      {displayShotCode(shot)}
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-col py-0.5">
                    <button
                      type="button"
                      className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                      onClick={event => {
                        event.stopPropagation();
                        openShotEditor(shot.shotNo);
                      }}
                      aria-label={`编辑 ${displayShotCode(shot)} ${title}`}
                    >
                      <p className="line-clamp-2 text-[11px] font-semibold leading-relaxed text-foreground">
                        {title}
                      </p>
                      <p className="mt-1 line-clamp-1 text-[9px] leading-relaxed text-muted-foreground">
                        {detail}
                      </p>
                    </button>
                    <div className="mt-auto flex items-center gap-1 pt-1">
                      {onAddShotToTimeline && !isOnTimeline ? (
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            onAddShotToTimeline(shot.shotNo, shotTimelineId);
                            onSelectShot?.(shot.shotNo);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-muted/45 text-muted-foreground transition hover:bg-[var(--nayin-glow)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                          aria-label={`把 ${displayShotCode(shot)} 加入时间轴`}
                          title="加入时间轴"
                        >
                          <ListPlus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {onInsertShotAfter ? (
                        <AddShotButton
                          compact
                          shotLabel={displayShotCode(shot)}
                          inserting={insertingAfterShotNo === shot.shotNo}
                          disabled={
                            insertingAfterShotNo != null ||
                            deletingShotId != null
                          }
                          onClick={event => {
                            event.stopPropagation();
                            void insertShotAfter(
                              shot.shotNo,
                              insertStableShotId
                            );
                          }}
                        />
                      ) : null}
                      {onDeleteShot ? (
                        <DeleteShotButton
                          compact
                          shotLabel={displayShotCode(shot)}
                          deleting={deletingShotId === insertStableShotId}
                          disabled={
                            insertingAfterShotNo != null ||
                            deletingShotId != null ||
                            shots.length <= 1
                          }
                          onClick={event => {
                            event.stopPropagation();
                            void deleteShot(shot.shotNo, insertStableShotId);
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : shots.length > 0 ? (
          <div className="flex h-full min-h-0 flex-col">
            <div
              ref={boardScrollRef}
              className="min-h-0 flex-1 overflow-auto custom-scrollbar"
              style={{ scrollPaddingLeft: 76 }}
            >
              <div
                role="table"
                aria-label="完整故事版横向分镜表"
                className="grid min-w-max"
                style={{
                  gridTemplateColumns:
                    "76px repeat(" +
                    shots.length +
                    ", " +
                    matrixShotColumnWidth +
                    "px)",
                }}
              >
                <div
                  role="columnheader"
                  className="sticky left-0 top-0 z-40 flex min-h-14 items-end border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--panel-border) 72%, transparent)",
                    background: "var(--panel-header)",
                  }}
                >
                  镜头
                </div>
                {shots.map((shot, index) => {
                  const creationShot = creationShotByNo.get(shot.shotNo);
                  const title = shortText(
                    shot.dialogue,
                    shortText(shot.action, shortText(shot.subject, "关键镜头"))
                  );
                  const shotLabel = displayShotCode(shot);
                  const selected = selectedShotNo === shot.shotNo;
                  const shotTimelineId = creationShot
                    ? creationTimelineShotId(creationShot)
                    : (shot.stableShotId ??
                      shot.shotIdentity ??
                      "legacy-sh" + String(shot.shotNo).padStart(2, "0"));
                  const insertStableShotId = storyShotInsertIdentity(
                    shot,
                    index
                  );
                  const isOnTimeline = timelineShotIdSet.has(shotTimelineId);
                  return (
                    <div
                      key={
                        "matrix-header-" +
                        (shot.stableShotId ??
                          shot.shotIdentity ??
                          shot.shotNo) +
                        "-" +
                        index
                      }
                      role="columnheader"
                      data-storyboard-shot-no={shot.shotNo}
                      data-storyboard-shot-header="two-row"
                      className="sticky top-0 z-30 min-w-0 border-b border-r px-2 py-1.5"
                      style={{
                        borderColor:
                          "color-mix(in srgb, var(--panel-border) 72%, transparent)",
                        background: selected
                          ? "color-mix(in srgb, var(--nayin-accent) 14%, var(--panel-header))"
                          : "var(--panel-header)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectShot?.(shot.shotNo)}
                        className="flex w-full min-w-0 items-baseline gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                        aria-label={`选择 ${shotLabel} ${title}`}
                      >
                        <span className="shrink-0 font-mono text-[10px] font-semibold text-foreground">
                          {shotLabel}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[9px] leading-relaxed text-muted-foreground">
                          {title}
                        </span>
                      </button>
                      <div
                        className="mt-1 flex h-6 items-center gap-1"
                        data-storyboard-shot-actions="true"
                      >
                        {onAddShotToTimeline && !isOnTimeline ? (
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation();
                              onAddShotToTimeline(shot.shotNo, shotTimelineId);
                              onSelectShot?.(shot.shotNo);
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                            aria-label={`把 ${shotLabel} 加入时间轴`}
                            title="加入时间轴"
                          >
                            <ListPlus className="h-3 w-3" />
                          </button>
                        ) : null}
                        {onInsertShotAfter ? (
                          <AddShotButton
                            compact
                            shotLabel={shotLabel}
                            inserting={insertingAfterShotNo === shot.shotNo}
                            disabled={
                              insertingAfterShotNo != null ||
                              deletingShotId != null
                            }
                            onClick={event => {
                              event.stopPropagation();
                              void insertShotAfter(
                                shot.shotNo,
                                insertStableShotId
                              );
                            }}
                          />
                        ) : null}
                        {onDeleteShot ? (
                          <DeleteShotButton
                            compact
                            shotLabel={shotLabel}
                            deleting={deletingShotId === insertStableShotId}
                            disabled={
                              insertingAfterShotNo != null ||
                              deletingShotId != null ||
                              shots.length <= 1
                            }
                            onClick={event => {
                              event.stopPropagation();
                              void deleteShot(shot.shotNo, insertStableShotId);
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                <div
                  role="rowheader"
                  className="sticky left-0 z-20 flex items-start border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--panel-border) 62%, transparent)",
                    background: "var(--background)",
                  }}
                >
                  画面
                </div>
                {shots.map((shot, index) => {
                  const image = frameByShotNo.get(shot.shotNo);
                  const creationShot = creationShotByNo.get(shot.shotNo);
                  const selected = selectedShotNo === shot.shotNo;
                  const insertStableShotId = storyShotInsertIdentity(
                    shot,
                    index
                  );
                  const shotTimelineId = creationShot
                    ? creationTimelineShotId(creationShot)
                    : (shot.stableShotId ??
                      shot.shotIdentity ??
                      `legacy-sh${String(shot.shotNo).padStart(2, "0")}`);
                  const isOnTimeline = timelineShotIdSet.has(shotTimelineId);
                  const isVideoTakeDropTarget =
                    insertStableShotId != null &&
                    videoTakeDropTargetId === insertStableShotId;
                  const isImageFrameDropTarget =
                    insertStableShotId != null &&
                    imageFrameDropTargetId === insertStableShotId;
                  const isLocalMediaDropTarget =
                    insertStableShotId != null &&
                    localMediaDropTargetId === insertStableShotId;
                  const isImportingMedia =
                    insertStableShotId != null &&
                    importingMediaShotId === insertStableShotId;
                  const videoTakes = creationShot?.videoTakes ?? [];
                  const playableTakes = videoTakes.filter(
                    take => videoTakeAffordance(take.status).canPlay
                  );
                  const statusTakes = videoTakes
                    .filter(
                      take =>
                        !videoTakeAffordance(take.status).canPlay &&
                        take.status !== "unfollowable"
                    )
                    .slice(0, 3);
                  const explicitlySelectedTakeId = insertStableShotId
                    ? previewVideoTakeByShot[insertStableShotId]
                    : undefined;
                  const readyCandidate = videoTakeCandidateToAdopt(
                    playableTakes,
                    explicitlySelectedTakeId
                  );
                  const isSubmittingVideo =
                    rerenderingShotNo === shot.shotNo ||
                    generatingVideoShotNo === shot.shotNo;
                  const isCheckingVideoContinuity =
                    continuityChecking?.shotNo === shot.shotNo &&
                    continuityChecking.renderKind === "video";
                  const timelineVisualClips =
                    creationShot?.timelineItem?.visualClips ?? [];
                  const shotFrameImages = creationShot
                    ? storyboardShotFrameImages(creationShot)
                    : [];
                  const frameImages =
                    shotFrameImages.length > 0
                      ? shotFrameImages
                      : image?.imageUrl
                        ? [
                            {
                              id: image.id,
                              imageUrl: image.imageUrl,
                            },
                          ]
                        : [];
                  const latestCandidateSheetId = frameImages
                    .filter(isFrameCandidateSheet)
                    .sort((left, right) => left.id - right.id)
                    .at(-1)?.id;
                  return (
                    <div
                      key={
                        "matrix-media-" +
                        (shot.stableShotId ??
                          shot.shotIdentity ??
                          shot.shotNo) +
                        "-" +
                        index
                      }
                      role="cell"
                      {...shotMediaDropHandlers(
                        shot,
                        insertStableShotId,
                        shotTimelineId,
                        isOnTimeline
                      )}
                      aria-busy={isImportingMedia}
                      data-storyboard-media-drop-target={displayShotCode(shot)}
                      className="relative h-[75px] min-w-0 border-b border-r p-2"
                      style={{
                        borderColor:
                          "color-mix(in srgb, var(--panel-border) 62%, transparent)",
                        background:
                          isVideoTakeDropTarget ||
                          isImageFrameDropTarget ||
                          isLocalMediaDropTarget
                            ? "var(--nayin-glow)"
                            : selected
                              ? "color-mix(in srgb, var(--nayin-glow) 46%, transparent)"
                              : "transparent",
                      }}
                    >
                      {isLocalMediaDropTarget ||
                      isImageFrameDropTarget ||
                      isImportingMedia ? (
                        <StoryboardMediaDropOverlay
                          shotLabel={displayShotCode(shot)}
                          importing={isImportingMedia}
                          moving={isImageFrameDropTarget}
                        />
                      ) : null}
                      <div
                        className="flex h-[59px] items-center gap-1 overflow-x-auto overflow-y-hidden custom-scrollbar"
                        data-storyboard-media-layout="start-end-strip"
                        data-storyboard-media-height="fixed"
                      >
                        {isSubmittingVideo && statusTakes.length === 0 ? (
                          <div
                            className="flex h-[59px] w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm bg-amber-500/10 px-1 text-amber-700 dark:text-amber-300"
                            data-video-take-stage="submitting"
                            title={
                              isCheckingVideoContinuity
                                ? "正在比较脸、发型和服饰"
                                : "正在保存镜头信息并提交视频任务"
                            }
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="text-[7px] font-semibold">
                              {isCheckingVideoContinuity
                                ? "检查人物"
                                : "正在提交"}
                            </span>
                          </div>
                        ) : null}
                        {statusTakes.map(take => {
                          const affordance = videoTakeAffordance(take.status);
                          const progress = videoTakeProgress(take);
                          const isRefreshing =
                            refreshingVideoTakeId === take.id;
                          const failed = progress.stage === "failed";
                          const error = take.errorMessage
                            ? videoTakeErrorMessage(take.errorMessage)
                            : null;
                          return (
                            <button
                              key={`take-status-${take.id}`}
                              type="button"
                              disabled={
                                !affordance.canRefresh ||
                                !onRefreshShotVideoStatus ||
                                isRefreshing
                              }
                              onClick={() => {
                                if (
                                  !affordance.canRefresh ||
                                  !onRefreshShotVideoStatus
                                ) {
                                  return;
                                }
                                setRefreshingVideoTakeId(take.id);
                                void onRefreshShotVideoStatus(take.id)
                                  .catch(refreshError => {
                                    toast.error(
                                      refreshError instanceof Error
                                        ? refreshError.message
                                        : "视频状态刷新失败"
                                    );
                                  })
                                  .finally(() =>
                                    setRefreshingVideoTakeId(current =>
                                      current === take.id ? null : current
                                    )
                                  );
                              }}
                              className={`flex h-[59px] w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm px-1 text-center ${
                                failed
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              } disabled:cursor-default`}
                              data-video-take-stage={progress.stage}
                              aria-label={`${displayShotCode(shot)} Take ${take.id} ${progress.label}`}
                              title={
                                error ??
                                `${progress.label} · Take ${take.id}${affordance.canRefresh ? " · 点击刷新" : ""}`
                              }
                            >
                              {isRefreshing ||
                              progress.stage === "rendering" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                              <span className="text-[7px] font-semibold">
                                {progress.label}
                              </span>
                              <span className="max-w-full truncate font-mono text-[6px] opacity-75">
                                #{take.id}
                              </span>
                            </button>
                          );
                        })}
                        {frameImages.map((frame, frameIndex) => {
                          if (
                            frame.id === latestCandidateSheetId &&
                            onPromoteFrameCrop
                          ) {
                            const promoting =
                              promotingFrameCropShotNo === shot.shotNo;
                            return (
                              <div
                                key={`frame-candidates-${frame.id}`}
                                className="order-2 flex h-[59px] shrink-0 gap-1"
                                role="group"
                                aria-label={`${displayShotCode(shot)} 四张图片候选`}
                              >
                                {FRAME_QUADRANTS.map(
                                  (candidate, candidateIndex) => (
                                    <button
                                      key={candidate.value}
                                      type="button"
                                      disabled={promoting}
                                      onClick={() =>
                                        void promoteStoryboardFrameCandidate({
                                          shot,
                                          imageId: frame.id,
                                          imageUrl: frame.imageUrl,
                                          quadrant: candidate.value,
                                        })
                                      }
                                      className="relative h-[59px] w-[59px] shrink-0 overflow-hidden rounded-sm border border-[var(--nayin-accent)]/40 bg-muted text-left transition hover:border-[var(--nayin-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-55"
                                      aria-label={`采用 ${displayShotCode(shot)} 候选 ${candidateIndex + 1}`}
                                      title={`${candidate.label}候选 · 点击设为当前主图`}
                                    >
                                      <img
                                        src={frame.imageUrl}
                                        alt={`${displayShotCode(shot)} 候选 ${candidateIndex + 1}`}
                                        draggable={false}
                                        className="absolute object-fill"
                                        style={storyboardCandidateImageStyle(
                                          candidate.value
                                        )}
                                      />
                                      <span className="absolute inset-x-0 bottom-0 bg-black/72 px-1 py-0.5 text-center text-[7px] text-white">
                                        候选 {candidateIndex + 1}
                                      </span>
                                      {promoting ? (
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        </span>
                                      ) : null}
                                    </button>
                                  )
                                )}
                              </div>
                            );
                          }
                          const role = creationShot
                            ? storyboardFrameRoleForImage(
                                creationShot.generationParams,
                                frameImages,
                                frame.id
                              )
                            : frameImages.length === 1 || frameIndex === 0
                              ? "first"
                              : frameIndex === frameImages.length - 1
                                ? "last"
                                : "reference";
                          const frameRole =
                            role === "first"
                              ? "首帧"
                              : role === "last"
                                ? "尾帧"
                                : "中间参考";
                          const canManageFrame = Boolean(
                            creationShot &&
                              insertStableShotId &&
                              onUpdateShotFields
                          );
                          const isUpdating = updatingFrameImageId === frame.id;
                          const manageInput =
                            creationShot && insertStableShotId
                              ? {
                                  shot,
                                  creationShot,
                                  stableShotId: insertStableShotId,
                                  frameImages,
                                  imageId: frame.id,
                                }
                              : null;
                          return (
                            <ContextMenu.Root key={`frame-${frame.id}`}>
                              <ContextMenu.Trigger asChild>
                                <button
                                  type="button"
                                  draggable={Boolean(
                                    insertStableShotId && onMoveStoryImage
                                  )}
                                  data-storyboard-frame-role={frameRole}
                                  className={`relative order-3 h-[59px] w-[59px] shrink-0 overflow-hidden rounded-sm bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                                    movingImageId === frame.id || isUpdating
                                      ? "opacity-45"
                                      : ""
                                  }`}
                                  onDragStart={event => {
                                    if (
                                      !insertStableShotId ||
                                      !onMoveStoryImage ||
                                      isUpdating
                                    ) {
                                      event.preventDefault();
                                      return;
                                    }
                                    writeStoryboardImageDragPayload(
                                      event.dataTransfer,
                                      {
                                        imageId: frame.id,
                                        sourceStableShotId: insertStableShotId,
                                        sourceShotNo: shot.shotNo,
                                      }
                                    );
                                  }}
                                  onDragEnd={() => {
                                    stopStoryboardDragScroll();
                                    setImageFrameDropTargetId(null);
                                  }}
                                  onClick={() =>
                                    deferVideoSingleClick(() => {
                                      onSelectShot?.(shot.shotNo);
                                      setPreviewMedia({
                                        kind: "image",
                                        url: frame.imageUrl,
                                        label: `${displayShotCode(shot)} ${frameRole}`,
                                        transform:
                                          creationShot?.timelineItem?.transform,
                                      });
                                    })
                                  }
                                  onDoubleClick={event => {
                                    cancelDeferredVideoSingleClick();
                                    if (
                                      !onEditImage ||
                                      !creationShot ||
                                      !insertStableShotId
                                    ) {
                                      return;
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onEditImage(
                                      imageClipEditorTargetForShot({
                                        shot: creationShot,
                                        stableShotId: insertStableShotId,
                                        imageId: frame.id,
                                        imageUrl: frame.imageUrl,
                                        label: `${displayShotCode(shot)} · ${frameRole}`,
                                      })
                                    );
                                  }}
                                  aria-label={`查看 ${displayShotCode(shot)} ${frameRole}`}
                                  title={`${frameRole} · 图片 #${frame.id} · 双击编辑 · 可右键设置角色，可拖到其他镜头`}
                                >
                                  <img
                                    src={frame.imageUrl}
                                    alt={`${displayShotCode(shot)} ${frameRole}`}
                                    draggable={false}
                                    className="h-full w-full object-cover"
                                    style={timelineTransformStyle(
                                      creationShot?.timelineItem?.transform
                                    )}
                                  />
                                  {isUpdating ? (
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    </span>
                                  ) : null}
                                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/72 px-1 py-0.5 text-center text-[7px] text-white">
                                    {frameRole}
                                  </span>
                                </button>
                              </ContextMenu.Trigger>
                              <ContextMenu.Portal>
                                <ContextMenu.Content
                                  className="z-[90] min-w-[178px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                                  data-testid={`storyboard-frame-menu-${frame.id}`}
                                >
                                  <ContextMenu.Item
                                    disabled={
                                      !canManageFrame ||
                                      isUpdating ||
                                      role === "first"
                                    }
                                    onSelect={() => {
                                      if (!manageInput) return;
                                      void setStoryboardFrameRole({
                                        ...manageInput,
                                        role: "first",
                                      });
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                                  >
                                    <SkipBack className="h-3.5 w-3.5" />
                                    设为首帧
                                    {role === "first" ? (
                                      <Check className="ml-auto h-3.5 w-3.5" />
                                    ) : null}
                                  </ContextMenu.Item>
                                  <ContextMenu.Item
                                    disabled={
                                      !canManageFrame ||
                                      isUpdating ||
                                      role === "last"
                                    }
                                    onSelect={() => {
                                      if (!manageInput) return;
                                      void setStoryboardFrameRole({
                                        ...manageInput,
                                        role: "last",
                                      });
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                                  >
                                    <SkipForward className="h-3.5 w-3.5" />
                                    设为尾帧
                                    {role === "last" ? (
                                      <Check className="ml-auto h-3.5 w-3.5" />
                                    ) : null}
                                  </ContextMenu.Item>
                                  <ContextMenu.Item
                                    disabled={
                                      !canManageFrame ||
                                      isUpdating ||
                                      role === "reference"
                                    }
                                    onSelect={() => {
                                      if (!manageInput) return;
                                      void setStoryboardFrameRole({
                                        ...manageInput,
                                        role: "reference",
                                      });
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                                  >
                                    <Focus className="h-3.5 w-3.5" />
                                    设为中间参考
                                    {role === "reference" ? (
                                      <Check className="ml-auto h-3.5 w-3.5" />
                                    ) : null}
                                  </ContextMenu.Item>
                                  <ContextMenu.Separator className="my-1 h-px bg-border" />
                                  <ContextMenu.Item
                                    disabled={
                                      !canManageFrame ||
                                      !onDeleteStoryImage ||
                                      isUpdating
                                    }
                                    onSelect={() => {
                                      if (!manageInput) return;
                                      void deleteStoryboardFrame(manageInput);
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs text-destructive outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-destructive/10 data-[disabled]:opacity-45"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    删除图片
                                  </ContextMenu.Item>
                                </ContextMenu.Content>
                              </ContextMenu.Portal>
                            </ContextMenu.Root>
                          );
                        })}
                        {timelineVisualClips.map((clip, clipIndex) => {
                          const poster = `/api/video-frames/${clip.takeId}?atSec=${clip.sourceStartSec.toFixed(3)}&rangeId=${clip.rangeId}`;
                          const removalKey = `clip-${clip.id}`;
                          const isRemoving = removingVideoKey === removalKey;
                          return (
                            <ContextMenu.Root key={`timeline-clip-${clip.id}`}>
                              <ContextMenu.Trigger asChild>
                                <button
                                  type="button"
                                  className={`relative order-4 h-[59px] w-[59px] shrink-0 overflow-hidden rounded-sm bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                                    isRemoving ? "opacity-45" : ""
                                  }`}
                                  onClick={() =>
                                    deferVideoSingleClick(() => {
                                      onSelectShot?.(shot.shotNo);
                                      setPreviewMedia({
                                        kind: "video",
                                        url: clip.videoUrl,
                                        poster,
                                        label: `${displayShotCode(shot)} ${clip.label}`,
                                      });
                                    })
                                  }
                                  onDoubleClick={event => {
                                    cancelDeferredVideoSingleClick();
                                    if (!onEditVideo || !insertStableShotId) {
                                      return;
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const take = creationShot?.videoTakes?.find(
                                      item => item.id === clip.takeId
                                    );
                                    onEditVideo(
                                      videoClipEditorTargetForVisualClip({
                                        stableShotId: insertStableShotId,
                                        shotNo: shot.shotNo,
                                        cueCode: shot.cueCode,
                                        label: `${displayShotCode(shot)} · ${clip.label}`,
                                        clip,
                                        timelineItem:
                                          creationShot?.timelineItem,
                                        mediaDurationSec: take?.durationSec,
                                        posterUrl: poster,
                                      })
                                    );
                                  }}
                                  aria-label={`播放 ${displayShotCode(shot)} ${clip.label}`}
                                  title={`${clip.label} · 双击编辑 · 右键可移除`}
                                >
                                  <img
                                    src={poster}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                  {isRemoving ? (
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    </span>
                                  ) : null}
                                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/72 px-1 py-0.5 text-center text-[7px] text-white">
                                    切片 {clipIndex + 1}
                                  </span>
                                </button>
                              </ContextMenu.Trigger>
                              <ContextMenu.Portal>
                                <ContextMenu.Content
                                  className="z-[90] min-w-[178px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                                  data-testid={`storyboard-video-menu-clip-${clip.id}`}
                                >
                                  <ContextMenu.Item
                                    disabled={
                                      !onCopyVideo || !insertStableShotId
                                    }
                                    onSelect={() => {
                                      if (!onCopyVideo || !insertStableShotId) {
                                        return;
                                      }
                                      const take =
                                        creationShot?.videoTakes?.find(
                                          item => item.id === clip.takeId
                                        );
                                      onCopyVideo(
                                        videoClipEditorTargetForVisualClip({
                                          stableShotId: insertStableShotId,
                                          shotNo: shot.shotNo,
                                          cueCode: shot.cueCode,
                                          label: `${displayShotCode(shot)} · ${clip.label}`,
                                          clip,
                                          timelineItem:
                                            creationShot?.timelineItem,
                                          mediaDurationSec: take?.durationSec,
                                          posterUrl: poster,
                                        })
                                      );
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    复制视频
                                  </ContextMenu.Item>
                                  <ContextMenu.Separator className="my-1 h-px bg-border" />
                                  <ContextMenu.Item
                                    disabled={
                                      !insertStableShotId ||
                                      !onRemoveTimelineVideoClip ||
                                      isRemoving
                                    }
                                    onSelect={() => {
                                      if (
                                        !insertStableShotId ||
                                        !onRemoveTimelineVideoClip
                                      ) {
                                        return;
                                      }
                                      setRemovingVideoKey(removalKey);
                                      void onRemoveTimelineVideoClip({
                                        stableShotId: insertStableShotId,
                                        clipId: clip.id,
                                      })
                                        .then(() => {
                                          setPreviewMedia(current =>
                                            current?.kind === "video" &&
                                            current.url === clip.videoUrl
                                              ? null
                                              : current
                                          );
                                          toast.success(
                                            `已从 ${displayShotCode(shot)} 移除视频切片`
                                          );
                                        })
                                        .catch(error => {
                                          toast.error(
                                            error instanceof Error
                                              ? error.message
                                              : "视频切片移除失败"
                                          );
                                        })
                                        .finally(() =>
                                          setRemovingVideoKey(current =>
                                            current === removalKey
                                              ? null
                                              : current
                                          )
                                        );
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs text-destructive outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-destructive/10 data-[disabled]:opacity-45"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    从画面移除
                                  </ContextMenu.Item>
                                </ContextMenu.Content>
                              </ContextMenu.Portal>
                            </ContextMenu.Root>
                          );
                        })}
                        {playableTakes.map(take => {
                          if (!take.videoUrl) return null;
                          const variantLabel = mjVideoVariantLabel(take);
                          const previewSelected = Boolean(
                            insertStableShotId &&
                              previewVideoTakeByShot[insertStableShotId] ===
                                take.id
                          );
                          const selectedTake = Boolean(
                            take.isTimelineSelected ||
                              creationShot?.selectedVideoTake?.id === take.id
                          );
                          const poster = videoTakeFrameUrl(take, "start");
                          const progress = videoTakeProgress(take);
                          const removalKey = `take-${take.id}`;
                          const isRemoving = removingVideoKey === removalKey;
                          return (
                            <ContextMenu.Root key={`take-${take.id}`}>
                              <ContextMenu.Trigger asChild>
                                <button
                                  type="button"
                                  draggable={Boolean(
                                    insertStableShotId && onMoveVideoTake
                                  )}
                                  className={`relative order-1 h-[59px] w-[59px] shrink-0 overflow-hidden rounded-sm bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                                    movingVideoTakeId === take.id || isRemoving
                                      ? "opacity-45"
                                      : ""
                                  }`}
                                  onDragStart={event => {
                                    if (
                                      !insertStableShotId ||
                                      !onMoveVideoTake ||
                                      isRemoving
                                    ) {
                                      event.preventDefault();
                                      return;
                                    }
                                    writeVideoTakeDragPayload(
                                      event.dataTransfer,
                                      {
                                        takeId: take.id,
                                        sourceStableShotId: insertStableShotId,
                                        sourceShotNo: shot.shotNo,
                                      }
                                    );
                                  }}
                                  onDragEnd={() => {
                                    stopStoryboardDragScroll();
                                    setVideoTakeDropTargetId(null);
                                  }}
                                  onClick={() =>
                                    deferVideoSingleClick(() => {
                                      onSelectShot?.(shot.shotNo);
                                      if (insertStableShotId) {
                                        setPreviewVideoTakeByShot(current => ({
                                          ...current,
                                          [insertStableShotId]: take.id,
                                        }));
                                      }
                                      setPreviewMedia({
                                        kind: "video",
                                        url: take.videoUrl ?? "",
                                        poster,
                                        label: `${displayShotCode(shot)} Take ${take.id}`,
                                      });
                                    })
                                  }
                                  onDoubleClick={event => {
                                    cancelDeferredVideoSingleClick();
                                    if (!onEditVideo || !insertStableShotId) {
                                      return;
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const target = videoClipEditorTargetForTake(
                                      {
                                        stableShotId: insertStableShotId,
                                        shotNo: shot.shotNo,
                                        cueCode: shot.cueCode,
                                        label: `${displayShotCode(shot)} · Take ${take.id}`,
                                        take,
                                        timelineItem:
                                          creationShot?.timelineItem,
                                        posterUrl: poster,
                                      }
                                    );
                                    if (target) onEditVideo(target);
                                  }}
                                  aria-label={`播放 ${displayShotCode(shot)} Take ${take.id}`}
                                  title={`${progress.label} · Take ${take.id} · 双击编辑 · 可拖动`}
                                  data-video-take-stage={progress.stage}
                                  data-video-take-id={take.id}
                                >
                                  <StoryboardVideoThumbnail
                                    src={take.videoUrl}
                                    poster={poster}
                                    active={
                                      selected &&
                                      (selectedTake || previewSelected)
                                    }
                                    label={`${displayShotCode(shot)} Take ${take.id}`}
                                    className="h-full w-full object-cover"
                                  />
                                  {isRemoving ? (
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    </span>
                                  ) : null}
                                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/72 px-1 py-0.5 text-center text-[7px] text-white">
                                    {variantLabel ?? progress.label}
                                  </span>
                                </button>
                              </ContextMenu.Trigger>
                              <ContextMenu.Portal>
                                <ContextMenu.Content
                                  className="z-[90] min-w-[178px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                                  data-testid={`storyboard-video-menu-take-${take.id}`}
                                >
                                  <ContextMenu.Item
                                    disabled={
                                      !onCopyVideo || !insertStableShotId
                                    }
                                    onSelect={() => {
                                      if (!onCopyVideo || !insertStableShotId) {
                                        return;
                                      }
                                      const target =
                                        videoClipEditorTargetForTake({
                                          stableShotId: insertStableShotId,
                                          shotNo: shot.shotNo,
                                          cueCode: shot.cueCode,
                                          label: `${displayShotCode(shot)} · Take ${take.id}`,
                                          take,
                                          timelineItem:
                                            creationShot?.timelineItem,
                                          posterUrl: poster,
                                        });
                                      if (target) onCopyVideo(target);
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    复制视频
                                  </ContextMenu.Item>
                                  <ContextMenu.Separator className="my-1 h-px bg-border" />
                                  <ContextMenu.Item
                                    disabled={
                                      !onMarkVideoTakeUnusable || isRemoving
                                    }
                                    onSelect={() => {
                                      if (!onMarkVideoTakeUnusable) return;
                                      setRemovingVideoKey(removalKey);
                                      void onMarkVideoTakeUnusable(take.id)
                                        .then(() => {
                                          setPreviewMedia(current =>
                                            current?.kind === "video" &&
                                            current.url === take.videoUrl
                                              ? null
                                              : current
                                          );
                                          toast.success(
                                            `已从 ${displayShotCode(shot)} 移除 Take ${take.id}，生成记录仍保留`
                                          );
                                        })
                                        .catch(error => {
                                          toast.error(
                                            error instanceof Error
                                              ? error.message
                                              : "视频 Take 移除失败"
                                          );
                                        })
                                        .finally(() =>
                                          setRemovingVideoKey(current =>
                                            current === removalKey
                                              ? null
                                              : current
                                          )
                                        );
                                    }}
                                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs text-destructive outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-destructive/10 data-[disabled]:opacity-45"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    从画面移除
                                  </ContextMenu.Item>
                                </ContextMenu.Content>
                              </ContextMenu.Portal>
                            </ContextMenu.Root>
                          );
                        })}
                        {readyCandidate &&
                        insertStableShotId &&
                        onAdoptVideoTake ? (
                          <button
                            type="button"
                            disabled={adoptingVideoTakeId != null}
                            onClick={() => {
                              setAdoptingVideoTakeId(readyCandidate.id);
                              void onAdoptVideoTake({
                                stableShotId: insertStableShotId,
                                takeId: readyCandidate.id,
                                plannedDurationSec: Math.max(
                                  0.1,
                                  readyCandidate.durationSec ??
                                    (creationShot?.durationMs ?? 5_000) / 1_000
                                ),
                              })
                                .then(() => {
                                  toast.success(
                                    `${displayShotCode(shot)} 已采用 Take ${readyCandidate.id}`
                                  );
                                })
                                .catch(error => {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "采用视频版本失败"
                                  );
                                })
                                .finally(() =>
                                  setAdoptingVideoTakeId(current =>
                                    current === readyCandidate.id
                                      ? null
                                      : current
                                  )
                                );
                            }}
                            className="order-2 flex h-[59px] w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-50 dark:text-emerald-300"
                            aria-label={`采用 ${displayShotCode(shot)} Take ${readyCandidate.id}`}
                            title={`采用 ${mjVideoVariantLabel(readyCandidate) ?? `Take ${readyCandidate.id}`} 进入时间线`}
                          >
                            {adoptingVideoTakeId === readyCandidate.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            <span className="text-[7px] font-semibold">
                              采用
                            </span>
                          </button>
                        ) : null}
                        <ContextMenu.Root>
                          <ContextMenu.Trigger asChild>
                            <button
                              type="button"
                              className={`h-[59px] min-w-8 flex-1 text-left text-[8px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nayin-accent)]/35 ${
                                frameImages.length === 0 &&
                                timelineVisualClips.length === 0 &&
                                playableTakes.length === 0
                                  ? "flex items-center gap-1.5 px-1"
                                  : ""
                              }`}
                              aria-label={`${displayShotCode(shot)} 媒体空白区`}
                              title={
                                videoClipboardLabel
                                  ? `右键粘贴 ${videoClipboardLabel}`
                                  : "右键可粘贴已复制的视频"
                              }
                            >
                              {frameImages.length === 0 &&
                              timelineVisualClips.length === 0 &&
                              playableTakes.length === 0 ? (
                                <>
                                  {isGeneratingScript ? (
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  ) : (
                                    <ImagePlus className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                  <span className="truncate">
                                    拖入图片或视频
                                  </span>
                                </>
                              ) : null}
                            </button>
                          </ContextMenu.Trigger>
                          <ContextMenu.Portal>
                            <ContextMenu.Content
                              className="z-[90] min-w-[190px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                              data-testid={`storyboard-video-paste-${insertStableShotId ?? shot.shotNo}`}
                            >
                              <ContextMenu.Item
                                disabled={
                                  !insertStableShotId ||
                                  !onPasteVideo ||
                                  !videoClipboardLabel ||
                                  pastingVideoShotId != null
                                }
                                onSelect={() => {
                                  if (!insertStableShotId) return;
                                  void pasteVideoIntoShot(
                                    insertStableShotId,
                                    shot.shotNo,
                                    "replace"
                                  );
                                }}
                                className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                              >
                                {pastingVideoShotId === insertStableShotId ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ClipboardPaste className="h-3.5 w-3.5" />
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                  {videoClipboardLabel
                                    ? "替换主视频"
                                    : "剪贴板没有视频"}
                                </span>
                              </ContextMenu.Item>
                              <ContextMenu.Item
                                disabled={
                                  !insertStableShotId ||
                                  !onPasteVideo ||
                                  !videoClipboardLabel ||
                                  pastingVideoShotId != null
                                }
                                onSelect={() => {
                                  if (!insertStableShotId) return;
                                  void pasteVideoIntoShot(
                                    insertStableShotId,
                                    shot.shotNo,
                                    "append"
                                  );
                                }}
                                className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                              >
                                <ClipboardPaste className="h-3.5 w-3.5" />
                                <span className="min-w-0 flex-1 truncate">
                                  追加为新片段
                                </span>
                              </ContextMenu.Item>
                              {videoClipboardLabel ? (
                                <ContextMenu.Label className="max-w-[220px] truncate px-2 py-1 text-[10px] text-muted-foreground">
                                  {videoClipboardLabel}
                                </ContextMenu.Label>
                              ) : null}
                            </ContextMenu.Content>
                          </ContextMenu.Portal>
                        </ContextMenu.Root>
                      </div>
                    </div>
                  );
                })}

                {STORYBOARD_MATRIX_ROWS.map(row => (
                  <Fragment key={row.field}>
                    <div
                      role="rowheader"
                      className="sticky left-0 z-20 border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
                      style={{
                        borderColor:
                          "color-mix(in srgb, var(--panel-border) 62%, transparent)",
                        background: "var(--background)",
                      }}
                    >
                      {row.label}
                    </div>
                    {shots.map((shot, index) => {
                      const selected = selectedShotNo === shot.shotNo;
                      const creationShot = creationShotByNo.get(shot.shotNo);
                      const dropTarget =
                        matrixDropTarget?.targetIndex === index &&
                        matrixDropTarget.field === row.field;
                      const shotLabel = displayShotCode(shot);
                      return (
                        <StoryboardMatrixFieldCell
                          key={
                            "matrix-" +
                            row.field +
                            "-" +
                            (shot.stableShotId ??
                              shot.shotIdentity ??
                              shot.shotNo) +
                            "-" +
                            index
                          }
                          value={shot[row.field]}
                          row={row}
                          shotLabel={shotLabel}
                          selected={selected}
                          dropTarget={dropTarget}
                          editable={Boolean(onUpdateShotField)}
                          onFocus={() => onSelectShot?.(shot.shotNo)}
                          onInputValue={value => {
                            const key = storyShotInsertIdentity(shot, index);
                            if (!key) return;
                            const current =
                              matrixDraftsRef.current.get(key) ?? {};
                            const next = { ...current, [row.field]: value };
                            matrixDraftsRef.current.set(key, next);
                          }}
                          onCommit={async value => {
                            const key = storyShotInsertIdentity(shot, index);
                            try {
                              await onUpdateShotField?.(
                                index,
                                row.field,
                                value
                              );
                            } finally {
                              if (!key) return;
                              const current = matrixDraftsRef.current.get(key);
                              if (current?.[row.field] !== value) return;
                              const next = { ...current };
                              delete next[row.field];
                              if (Object.keys(next).length === 0) {
                                matrixDraftsRef.current.delete(key);
                              } else {
                                matrixDraftsRef.current.set(key, next);
                              }
                            }
                          }}
                          onDragStart={event => {
                            setDraggedMatrixCell({
                              sourceIndex: index,
                              field: row.field,
                            });
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              shotLabel + " " + row.label
                            );
                          }}
                          onDragEnd={() => {
                            stopStoryboardDragScroll();
                            setDraggedMatrixCell(null);
                            setMatrixDropTarget(null);
                          }}
                          onDragOver={event => {
                            if (
                              !draggedMatrixCell ||
                              draggedMatrixCell.field !== row.field
                            ) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "move";
                            startStoryboardDragScroll(event.clientY);
                            autoScrollElementHorizontallyAtPoint(
                              boardScrollRef.current,
                              event.clientX
                            );
                            setMatrixDropTarget({
                              targetIndex: index,
                              field: row.field,
                            });
                          }}
                          onDragLeave={() => {
                            setMatrixDropTarget(current =>
                              current?.targetIndex === index &&
                              current.field === row.field
                                ? null
                                : current
                            );
                          }}
                          onDrop={event => dropMatrixCell(index, row, event)}
                          action={
                            row.field === "promptDraft" &&
                            onGenerateShotImages ? (
                              <button
                                type="button"
                                disabled={
                                  !creationShot ||
                                  generatingImageShotNo != null ||
                                  continuityChecking != null ||
                                  rerenderingShotNo != null ||
                                  generatingVideoShotNo != null
                                }
                                onPointerDown={event => event.stopPropagation()}
                                onClick={event => {
                                  event.stopPropagation();
                                  void renderShotImageCandidates(
                                    shot,
                                    creationShot,
                                    index
                                  );
                                }}
                                className="inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-sm border border-[var(--nayin-accent)]/35 bg-[var(--nayin-glow)] px-2 text-[9px] font-semibold text-foreground transition hover:border-[var(--nayin-accent)] hover:text-[var(--nayin-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-55"
                                aria-label={`按图片要求渲染 ${shotLabel} 的四张候选图`}
                                title="原文要求优先，生成四张同风格候选图"
                              >
                                {generatingImageShotNo === shot.shotNo ||
                                (continuityChecking?.shotNo === shot.shotNo &&
                                  continuityChecking.renderKind === "image") ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ImagePlus className="h-3 w-3" />
                                )}
                                {continuityChecking?.shotNo === shot.shotNo &&
                                continuityChecking.renderKind === "image"
                                  ? "检查人物"
                                  : "渲染 4 张"}
                              </button>
                            ) : row.field === "videoPrompt" &&
                              creationShot &&
                              (onGenerateShotVideo ||
                                (onEstimateStartEndShotVideo &&
                                  onGenerateStartEndShotVideo)) ? (
                              <button
                                type="button"
                                disabled={
                                  generatingImageShotNo != null ||
                                  continuityChecking != null ||
                                  rerenderingShotNo != null ||
                                  generatingVideoShotNo != null
                                }
                                onPointerDown={event => event.stopPropagation()}
                                onClick={event => {
                                  event.stopPropagation();
                                  void rerenderShotVideo(shot, creationShot);
                                }}
                                className="inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-background px-2 text-[9px] font-semibold text-foreground transition hover:border-[var(--nayin-accent)] hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-55"
                                aria-label={`按视频要求渲染 ${shotLabel} 视频`}
                                title="先保存本镜文字并确认人民币费用，再生成候选 Take"
                              >
                                {continuityChecking?.shotNo === shot.shotNo &&
                                continuityChecking.renderKind === "video" ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : rerenderingShotNo === shot.shotNo ||
                                  generatingVideoShotNo === shot.shotNo ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Video className="h-3 w-3" />
                                )}
                                {continuityChecking?.shotNo === shot.shotNo &&
                                continuityChecking.renderKind === "video"
                                  ? "检查人物"
                                  : "渲染视频"}
                              </button>
                            ) : null
                          }
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex h-20 items-center justify-center gap-2 rounded-md border border-dashed text-[10px] text-muted-foreground"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {isGeneratingScript ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Clapperboard className="h-3.5 w-3.5" />
            )}
            {isGeneratingScript
              ? "正在写剧本并准备关键帧草稿"
              : "还没有故事版，点“生成故事版”后会出现在这里"}
          </div>
        )}
      </div>
      <StoryboardMediaPreviewDialog
        preview={previewMedia}
        onClose={() => setPreviewMedia(null)}
      />
      <StoryboardContinuityDialog
        open={continuityDialog != null}
        shotLabel={continuityDialog?.shotLabel ?? ""}
        renderKind={continuityDialog?.renderKind ?? "image"}
        options={continuityDialog?.options ?? []}
        mismatches={continuityDialog?.mismatches ?? []}
        onChoose={settleContinuityChoice}
        onCancel={() => settleContinuityChoice(null)}
      />
    </section>
  );
}
