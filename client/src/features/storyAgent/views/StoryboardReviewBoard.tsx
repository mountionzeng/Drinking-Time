/**
 * Full storyboard review and directed media workflow.
 * Kept separate so card-list changes do not load the entire review workspace.
 */
import {
  StoryboardTimelineRulerRow,
  StoryboardTimelineZoomBar,
  useStoryboardTimelineViewport,
} from "./StoryboardTimelineRuler";
import React, {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  Clapperboard,
  ImagePlus,
  Trash2,
  ListPlus,
  Video,
  Sparkles,
  Check,
  Focus,
  SkipBack,
  SkipForward,
  Copy,
  ClipboardPaste,
  Minimize2,
  Maximize2,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type {
  StoryboardImageRerenderResult,
  StoryboardImageRerenderRunner,
} from "@/features/storyAgent/StoryAgentContext";
import type { StoryShotEditableField } from "@shared/shotDirector";
import { toast } from "sonner";
import type {
  ChatMessage,
  GeneratedScript,
  StoryShot,
} from "@/features/storyAgent/types";
import { creationTimelineShotId } from "@/features/creationEditor/CreationEditorContext";
import type {
  CreationEditorImage,
  CreationEditorShot,
  ImportedStoryMaterialResult,
} from "@/features/creationEditor/types";
import {
  MAX_CONCURRENT_STORYBOARD_RENDERS,
  addShotToRenderSlots,
  canStartShotRender,
  mergeActiveRenderShotNos,
  removeShotFromRenderSlots,
} from "@/features/creationEditor/renderSlots";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import {
  mjVideoVariantLabel,
  videoTakeCandidateToAdopt,
  videoTakeAffordance,
  videoTakeErrorMessage,
  videoTakeFailureLabel,
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
import {
  isVideoTakeTerminal,
  type ShotVideoProviderStatus,
} from "@shared/videoAsset";
import type {
  ShotConsistencyAnalysis,
  ShotConsistencyMismatch,
} from "@shared/shotConsistency";
import type { ShotDirectorResult } from "@shared/shotDirector";
import {
  parseStartEndVideoConfig,
  type StartEndShotVideoEstimate,
} from "@shared/startEndVideo";
import { displayShotCode } from "@shared/shotIdentity";
import type { ShotPendingCandidate } from "../shotCandidateSummary";
import ShotCandidateBadge from "./ShotCandidateBadge";
import type { GeneratedImageItem } from "@/features/storyAgent/storyTypes";
import type { ImageProvider, ImageProviderStatus } from "@shared/imageProvider";
import {
  createStoryboardEditMaskDataUrl,
  storyboardExactEditMaskPlan,
} from "@/features/creationEditor/editMask";
import {
  hasVideoTakeDragPayload,
  readVideoTakeDragPayload,
  writeVideoTakeDragPayload,
} from "./videoTakeDrag";
import {
  buildStoryboardTimingRows,
  storyboardTimingTotalMs,
} from "../storyboardTiming";
import {
  StoryboardEditRow,
  StoryboardEditTransport,
  type StoryboardBoardTimeline,
  type StoryboardEditShot,
  type StoryboardEditShotActions,
} from "@/features/creationEditor/views/StoryboardEditRow";
import {
  storyboardExtractedFrameTimeMs,
  type StoryboardEditFrameSource,
} from "@/features/creationEditor/storyboardEditRow";
import {
  StoryboardFieldVersionSelect,
  StoryboardCostCell,
  StoryboardMatrixFieldCell,
  StoryboardVoiceCell,
  STORYBOARD_MATRIX_VISIBLE_ROWS,
  storyboardMatrixSwapPlan,
  type StoryboardMatrixField,
  type StoryboardMatrixRow,
} from "./StoryboardMatrix";
import {
  isStoryboardVersionedField,
  type StoryboardFieldVersions,
  type StoryboardVersionedField,
} from "@shared/storyboardFieldVersions";
import {
  StoryboardMediaPreviewDialog,
  StoryboardVideoThumbnail,
  type StoryboardMediaPreview,
} from "./StoryboardMediaPreview";
import {
  isStoryboardMediaSelected,
  storyboardMediaSelection,
  storyboardMediaShotExpanded,
  type StoryboardMediaSelectionTarget,
} from "./storyboardMediaSelection";
import {
  hasStoryboardImageDragPayload,
  importStoryboardMediaFiles,
  readStoryboardMediaBase64,
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
  planStoryboardOneClickVideo,
  quickShotVideoRenderPlan,
  scrollElementHorizontallyIntoView,
  shortText,
  storyboardPlaybackCenterInset,
  storyboardPlaybackFollowDelta,
  storyboardCandidateImageStyle,
  storyboardCharacterContinuityGenerationParams,
  storyboardCharacterContinuityMatchesTarget,
  storyboardCharacterContinuityReference,
  storyboardDragScrollSpeedMultiplier,
  storyboardExplicitImageInstruction,
  storyboardFrameOrderGenerationParams,
  storyboardFrameOrdersAfterMove,
  storyboardFrameParamsAfterDelete,
  storyboardFrameRoleForImage,
  storyboardFrameRoleGenerationParams,
  storyboardInheritedStartEndGenerationParams,
  storyboardImageGenerationReferences,
  storyboardRenderIntentSummary,
  storyboardShotCostEstimate,
  storyboardRenderShotWithDraft,
  storyboardRerenderRequestId,
  storyboardShotFrameImages,
  STORYBOARD_CONTINUITY_REQUEST_INTERRUPTED,
  STORYBOARD_START_END_AMPLITUDE_OPTIONS,
  STORYBOARD_START_END_DURATION_OPTIONS,
  storyboardStartEndAmplitude,
  storyboardStartEndDurationSec,
  storyboardStartEndFrameIssue,
  storyboardStartEndGenerationParams,
  storyboardStartEndTuningGenerationParams,
  type StoryboardStartEndAmplitude,
  storyboardVideoIntentPatch,
  storyboardVideoRenderBlockReason,
  storyboardVideoSourceFrame,
  shouldAnnounceVideoGenerationCancellation,
  shouldUseSingleImageFallback,
  storyShotInsertIdentity,
  type StoryboardFrameRole,
  type StoryboardNeighborFrameSource,
  type StoryboardContinuityResolution,
} from "./storyboardReviewModel";
import {
  buildStoryboardImageRenderPlan,
  buildSheSelf02ImageEditInstruction,
  isSheSelf02ImageEditTemplateEnabled,
  SHE_SELF_02_0201_IMAGE_EDIT_TEMPLATE_LABEL,
  storyboardExactEditConstraint,
  storyboardImageRenderBlockReason,
  storyboardInstructionImageIds,
  storyboardReferenceContext,
  storyboardReferenceManifest,
} from "./storyboardImageRenderPlan";
import {
  AddShotButton,
  DeleteShotButton,
  SimpleStoryboardBoard,
  StoryboardMediaDropOverlay,
} from "./SimpleStoryboardBoard";
import {
  buildStoryboardMatrixLayout,
  shouldCompactStoryboardMatrixForShot,
} from "./storyboardMatrixLayout";

/**
 * 用户自己滚看板的时候，播放跟随让出这么久再接着跟。
 * 一镜通常几秒，太短等于没让、太长又会让人以为跟随坏了。
 */
const MANUAL_BOARD_SCROLL_GRACE_MS = 2_500;

function storyboardPrimaryFrameSource(
  shot: CreationEditorShot
): StoryboardEditFrameSource | null {
  const edit = shot.timelineItem?.primaryVideoEdit;
  if (edit) {
    return {
      takeId: edit.takeId,
      sourceStartSec: edit.sourceStartSec,
      sourceEndSec: edit.sourceEndSec,
      reverse: edit.effects.reverse,
    };
  }

  const take = [shot.selectedVideoTake, ...(shot.videoTakes ?? [])].find(
    candidate =>
      Boolean(candidate?.videoUrl) &&
      candidate != null &&
      videoTakeAffordance(candidate.status).canPlay
  );
  if (!take) return null;
  const range =
    take.selectedSelectionType === "range" && take.selectedRangeId != null
      ? (take.ranges.find(candidate => candidate.id === take.selectedRangeId) ??
        null)
      : null;
  const sourceStartSec = Math.max(0, range?.startSec ?? 0);
  const sourceEndSec = Math.max(
    sourceStartSec,
    range?.endSec ?? take.durationSec ?? sourceStartSec
  );
  if (!(sourceEndSec > sourceStartSec)) return null;
  return {
    takeId: take.id,
    rangeId: range?.id ?? null,
    sourceStartSec,
    sourceEndSec,
  };
}

function StoryboardMediaSelectionIndicator({
  selected,
}: {
  selected: boolean;
}) {
  if (!selected) return null;
  return (
    <span
      className="absolute left-1 top-1 z-20 inline-flex items-center gap-0.5 rounded-sm bg-[var(--nayin-accent)] px-1.5 py-0.5 text-[8px] font-semibold text-white shadow-sm"
      data-storyboard-media-selection-indicator="true"
    >
      <Check className="h-2.5 w-2.5" />
      已选
    </span>
  );
}

export function StoryboardReviewBoard({
  images,
  shots,
  latestScript,
  isGeneratingScript,
  storyTitle = null,
  onRegisterImageRerenderRunner,
  selectedShotNo = null,
  onSelectShot,
  onUpdateShotField,
  onGenerateShotVoice,
  generatingVoiceShotIds = [],
  storyboardFieldVersions,
  onRestoreStoryboardFieldVersion,
  creationShots = [],
  timelineShotIds = [],
  onAddShotToTimeline,
  onInsertShotAfter,
  onDeleteShot,
  generatingImageShotNos = [],
  onGenerateShotImages,
  continuityAnchor = null,
  onAnalyzeShotConsistency,
  generatingVideoShotNos = [],
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
  imageProviderStatus = null,
  defaultViewMode = "simple",
  embeddedEditorMode = false,
  headerAction,
  inheritedPublishingCover = null,
  inheritedPublishingCoverCandidates = [],
  className = "",
  candidatesByShot,
  onConfirmCandidate,
  onRejectCandidate,
  boardTimeline,
}: {
  images: GeneratedImageItem[];
  shots: StoryShot[];
  latestScript: GeneratedScript | null;
  isGeneratingScript: boolean;
  storyTitle?: string | null;
  onRegisterImageRerenderRunner?: (
    runner: StoryboardImageRerenderRunner
  ) => () => void;
  selectedShotNo?: number | null;
  onSelectShot?: (shotNo: number) => void;
  onUpdateShotField?: (
    index: number,
    field: StoryShotEditableField,
    value: string
  ) => void | Promise<void>;
  onGenerateShotVoice?: (
    stableShotId: string,
    text: string
  ) => void | Promise<void>;
  generatingVoiceShotIds?: readonly string[];
  storyboardFieldVersions?: StoryboardFieldVersions;
  onRestoreStoryboardFieldVersion?: (
    field: StoryboardVersionedField,
    revision: number
  ) => Promise<void>;
  creationShots?: CreationEditorShot[];
  timelineShotIds?: string[];
  /** 传进来就在完整视图里长出「剪辑」行；不传就是纯故事版看板。 */
  boardTimeline?: StoryboardBoardTimeline;
  onAddShotToTimeline?: (shotNo: number, stableShotId?: string | null) => void;
  onInsertShotAfter?: (
    shotNo: number,
    stableShotId?: string | null
  ) => void | Promise<void>;
  onDeleteShot?: (
    shotNo: number,
    stableShotId?: string | null
  ) => number | null | void | Promise<number | null | void>;
  generatingImageShotNos?: readonly number[];
  onGenerateShotImages?: (input: {
    shotNo: number;
    rows: PromptRow[];
    explicitInstruction: string;
    exactFrameEdit?: boolean;
    candidateCount?: 4;
    imageProvider?: ImageProvider;
    editMaskImageUrl?: string;
    reference?: {
      imageUrl?: string;
      identityImageUrl?: string;
      contextImageUrls?: string[];
      storyStyleImageUrl?: string;
    };
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<{
    generatedCount: number;
    failedCount: number;
    imageId?: number;
    imageUrl?: string;
  }>;
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
  generatingVideoShotNos?: readonly number[];
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    characterReferenceImageUrl?: string;
    storyStyleReferenceImageUrl?: string;
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
  imageProviderStatus?: ImageProviderStatus | null;
  defaultViewMode?: "full" | "simple";
  embeddedEditorMode?: boolean;
  headerAction?: ReactNode;
  inheritedPublishingCover?: { imageUrl: string } | null;
  inheritedPublishingCoverCandidates?: readonly {
    id: number;
    imageUrl: string;
  }[];
  className?: string;
  /** 阶段 E：每个镜头（按 stableShotId）待确认候选；缺省当作没有候选。 */
  candidatesByShot?: Map<string, ShotPendingCandidate[]>;
  onConfirmCandidate?: (candidate: ShotPendingCandidate) => Promise<void>;
  onRejectCandidate?: (candidate: ShotPendingCandidate) => Promise<void>;
}) {
  const [previewMedia, setPreviewMedia] =
    useState<StoryboardMediaPreview | null>(null);
  const [selectedStoryboardMedia, setSelectedStoryboardMedia] =
    useState<ReturnType<typeof storyboardMediaSelection> | null>(null);
  const [imageEditDialog, setImageEditDialog] = useState<{
    shotNo: number;
    shotIndex: number;
    imageId: number;
    imageUrl: string;
    label: string;
  } | null>(null);
  const [imageEditInstruction, setImageEditInstruction] = useState("");
  const [imageEditSubmitting, setImageEditSubmitting] = useState(false);
  const [publishingCoverReferenceDialog, setPublishingCoverReferenceDialog] =
    useState<{
      shot: StoryShot;
      creationShot: CreationEditorShot;
      shotIndex: number;
      request?: NonNullable<ChatMessage["imageRerenderAction"]>;
    } | null>(null);
  const [selectedPublishingCoverCandidateId, setSelectedPublishingCoverCandidateId] =
    useState<number | null>(null);
  const [imageRenderMonitor, setImageRenderMonitor] = useState<{
    id: string;
    label: string;
    imageUrl: string;
    startedAt: number;
    estimatedSeconds: number;
    status: "running" | "success" | "error";
    message?: string;
  } | null>(null);
  const [imageRenderMonitorNow, setImageRenderMonitorNow] = useState(() =>
    Date.now()
  );
  const [restoringStoryboardField, setRestoringStoryboardField] =
    useState<StoryboardVersionedField | null>(null);
  const [hoveredImagePreview, setHoveredImagePreview] = useState<{
    imageUrl: string;
    label: string;
    left: number;
    top: number;
    cropStyle?: CSSProperties;
  } | null>(null);
  const [continuityDialog, setContinuityDialog] = useState<{
    shotLabel: string;
    renderKind: "image" | "video";
    options: StoryboardContinuityOption[];
    mismatches: ShotConsistencyMismatch[];
  } | null>(null);
  const continuityChoiceResolverRef = useRef<
    ((resolution: StoryboardContinuityResolution) => void) | null
  >(null);
  const continuityAnalysisCacheRef = useRef(
    new Map<string, Promise<ShotConsistencyAnalysis>>()
  );
  const [viewMode, setViewMode] = useState<"full" | "simple">(defaultViewMode);
  const [compactShots, setCompactShots] = useState(false);
  const [compactExpandedShotNo, setCompactExpandedShotNo] = useState<
    number | null
  >(null);
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
  const [expandedVideoCandidatesByShot, setExpandedVideoCandidatesByShot] =
    useState<Record<string, boolean>>({});
  const [removingVideoKey, setRemovingVideoKey] = useState<string | null>(null);
  const [rerenderingShotNos, setRerenderingShotNos] = useState<number[]>([]);
  const [oneClickVideoProgress, setOneClickVideoProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [continuityCheckingByShot, setContinuityCheckingByShot] = useState<
    Record<number, "image" | "video">
  >({});
  const continuityCheckingShotNos = useMemo(
    () => Object.keys(continuityCheckingByShot).map(Number),
    [continuityCheckingByShot]
  );
  const backgroundVideoRenderShotNos = useMemo(
    () =>
      creationShots
        .filter(shot =>
          shot.videoTakes?.some(take => !isVideoTakeTerminal(take.status))
        )
        .map(shot => shot.shotNo),
    [creationShots]
  );
  const activeRenderShotNos = useMemo(
    () =>
      mergeActiveRenderShotNos(
        generatingImageShotNos,
        generatingVideoShotNos,
        rerenderingShotNos,
        continuityCheckingShotNos,
        backgroundVideoRenderShotNos
      ),
    [
      backgroundVideoRenderShotNos,
      continuityCheckingShotNos,
      generatingImageShotNos,
      generatingVideoShotNos,
      rerenderingShotNos,
    ]
  );
  const continuityWorkflowLocked =
    continuityCheckingShotNos.length > 0 || continuityDialog != null;
  const isShotRenderActive = useCallback(
    (shotNo: number) => activeRenderShotNos.includes(shotNo),
    [activeRenderShotNos]
  );
  const canStartRenderForShot = useCallback(
    (shotNo: number) =>
      !continuityWorkflowLocked &&
      canStartShotRender({
        shotNo,
        activeShotNos: activeRenderShotNos,
      }),
    [activeRenderShotNos, continuityWorkflowLocked]
  );
  const beginShotRender = useCallback((shotNo: number) => {
    setRerenderingShotNos(current => addShotToRenderSlots(current, shotNo));
  }, []);
  const finishShotRender = useCallback((shotNo: number) => {
    setRerenderingShotNos(current =>
      removeShotFromRenderSlots(current, shotNo)
    );
  }, []);

  const beginContinuityCheck = useCallback(
    (shotNo: number, renderKind: "image" | "video") => {
      setContinuityCheckingByShot(current => ({
        ...current,
        [shotNo]: renderKind,
      }));
    },
    []
  );
  const finishContinuityCheck = useCallback((shotNo: number) => {
    setContinuityCheckingByShot(current => {
      const next = { ...current };
      delete next[shotNo];
      return next;
    });
  }, []);
  const [draggedMatrixCell, setDraggedMatrixCell] = useState<{
    sourceIndex: number;
    field: StoryboardMatrixField;
  } | null>(null);

  useEffect(() => {
    if (imageRenderMonitor?.status !== "running") return;
    const timer = window.setInterval(() => {
      setImageRenderMonitorNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [imageRenderMonitor?.status]);
  const [matrixDropTarget, setMatrixDropTarget] = useState<{
    targetIndex: number;
    field: StoryboardMatrixField;
  } | null>(null);
  const matrixDraftsRef = useRef(
    new Map<string, Partial<Record<StoryboardMatrixField, string>>>()
  );
  const [, refreshMatrixDraftGuards] = useState(0);
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
      new Promise<StoryboardContinuityResolution>(resolve => {
        continuityChoiceResolverRef.current?.(
          STORYBOARD_CONTINUITY_REQUEST_INTERRUPTED
        );
        continuityChoiceResolverRef.current = resolve;
        setContinuityDialog(request);
      }),
    []
  );
  useEffect(
    () => () => {
      continuityChoiceResolverRef.current?.(
        STORYBOARD_CONTINUITY_REQUEST_INTERRUPTED
      );
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
  const selectStoryboardMedia = useCallback(
    (target: StoryboardMediaSelectionTarget, shotNo: number) => {
      onSelectShot?.(shotNo);
      setSelectedStoryboardMedia(storyboardMediaSelection(target));
      setHoveredImagePreview(null);
    },
    [onSelectShot]
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
  /** 手动滚动的宽限截止时间戳；0 表示跟随照常。 */
  const manualBoardScrollUntilRef = useRef(0);
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
    () =>
      buildStoryboardTimingRows(
        creationShots,
        timelineShotIds,
        creationShots.flatMap(shot =>
          shot.timelineItem ? [shot.timelineItem] : []
        )
      ),
    [creationShots, timelineShotIds]
  );
  // 整条片长按最大结束时间算：移动之后靠前的镜头完全可能结束得最晚。
  const storyboardTimelineDurationMs =
    storyboardTimingTotalMs(storyboardTimingRows);
  // 剪辑时间条按成片顺序铺开，所以这里用时间线顺序而不是镜头列顺序。
  const storyboardEditShots = useMemo<StoryboardEditShot[]>(
    () =>
      storyboardTimingRows.flatMap(timing => {
        const creationShot = creationShots.find(
          shot => creationTimelineShotId(shot) === timing.stableShotId
        );
        if (!creationShot) return [];
        return [
          {
            timing,
            shotLabel: displayShotCode(creationShot),
            shotNo: creationShot.shotNo,
            stableShotId: timing.stableShotId,
            timelineItem: creationShot.timelineItem ?? null,
            posterUrl: creationShot.imageUrl ?? null,
            primaryFrameSource: storyboardPrimaryFrameSource(creationShot),
            extractedFrames: (creationShot.imageVersions ?? []).flatMap(
              image => {
                const atMs = storyboardExtractedFrameTimeMs(image.prompt);
                return atMs == null
                  ? []
                  : [
                      {
                        id: `image-${image.id}`,
                        imageId: image.id,
                        imageUrl: image.imageUrl,
                        atMs,
                      },
                    ];
              }
            ),
          },
        ];
      }),
    [creationShots, storyboardTimingRows]
  );
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
  // 滚轮/触摸滑动是「我自己在翻表格」，跟随先让开；按下去点某一镜是
  // 明确要定位到它，立刻把宽限收回来，否则点完还得等两秒才滚过去。
  useEffect(() => {
    const scroller = boardScrollRef.current;
    if (!scroller) return;
    const holdAutoFollow = () => {
      manualBoardScrollUntilRef.current =
        Date.now() + MANUAL_BOARD_SCROLL_GRACE_MS;
    };
    const releaseAutoFollow = () => {
      manualBoardScrollUntilRef.current = 0;
    };
    scroller.addEventListener("wheel", holdAutoFollow, { passive: true });
    scroller.addEventListener("touchmove", holdAutoFollow, { passive: true });
    scroller.addEventListener("pointerdown", releaseAutoFollow);
    return () => {
      scroller.removeEventListener("wheel", holdAutoFollow);
      scroller.removeEventListener("touchmove", holdAutoFollow);
      scroller.removeEventListener("pointerdown", releaseAutoFollow);
    };
  }, [shouldShow, viewMode]);

  // 播放时让整张表逐帧从固定播放头下面滑过。用几何位置算本帧差值，
  // 不依赖镜头切点；因此短镜头、长镜头都保持相同的连续滚动节奏。
  useLayoutEffect(() => {
    if (
      viewMode !== "full" ||
      !boardTimeline?.isPlaying ||
      Date.now() < manualBoardScrollUntilRef.current
    ) {
      return;
    }
    const scroller = boardScrollRef.current;
    const track = boardRef.current?.querySelector<HTMLElement>(
      '[data-testid="storyboard-edit-track"]'
    );
    if (!scroller || !track) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const delta = storyboardPlaybackFollowDelta({
      scrollerLeft: scrollerRect.left,
      trackLeft: trackRect.left,
      trackWidth: trackRect.width,
      playheadMs: boardTimeline.playheadMs,
      totalMs: boardTimeline.totalMs,
      leftInset: storyboardPlaybackCenterInset(scrollerRect.width, 76),
    });
    if (delta !== 0) scroller.scrollBy({ left: delta, behavior: "auto" });
  }, [
    boardTimeline?.isPlaying,
    boardTimeline?.playheadMs,
    boardTimeline?.totalMs,
    viewMode,
  ]);

  useEffect(() => {
    if (selectedShotNo == null || boardTimeline?.isPlaying) return;
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => {
        if (Date.now() < manualBoardScrollUntilRef.current) return;
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
  }, [boardTimeline?.isPlaying, selectedShotNo, viewMode]);
  useEffect(() => {
    if (
      viewMode !== "full" ||
      selectedShotNo == null ||
      boardTimeline?.isPlaying ||
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
        if (Date.now() < manualBoardScrollUntilRef.current) return;
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
  }, [boardTimeline?.isPlaying, selectedShotNo, shots.length, viewMode]);

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
  }): Promise<StoryboardContinuityResolution> => {
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
    if (
      persistedReference &&
      storyboardCharacterContinuityMatchesTarget(
        input.creationShot.generationParams,
        {
          imageId: input.creationShot.imageId,
          imageUrl: input.creationShot.imageUrl,
        }
      )
    ) {
      return anchorOption;
    }
    if (!onAnalyzeShotConsistency) return anchorOption;

    try {
      const cacheKey = JSON.stringify([
        referenceAnchor.imageUrl,
        input.creationShot.imageId,
        input.creationShot.imageUrl,
      ]);
      let analysisPromise = continuityAnalysisCacheRef.current.get(cacheKey);
      if (!analysisPromise) {
        analysisPromise = onAnalyzeShotConsistency({
          anchorImageUrl: referenceAnchor.imageUrl,
          targetImage: {
            imageId: input.creationShot.imageId,
            imageUrl: input.creationShot.imageUrl,
            shotNo: displayShotCode(input.shot),
          },
        });
        continuityAnalysisCacheRef.current.set(cacheKey, analysisPromise);
        void analysisPromise.catch(() => {
          if (
            continuityAnalysisCacheRef.current.get(cacheKey) === analysisPromise
          ) {
            continuityAnalysisCacheRef.current.delete(cacheKey);
          }
        });
      }
      const analysis = await analysisPromise;
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
    // 不使用 window.confirm：剪辑台嵌入式页面中的原生确认框会阻塞渲染，
    // 用户看不到确认按钮，最终表现为点击删除没有反应。删除前的最后一道
    // 业务保护仍由服务端的“至少保留一个镜头”校验负责。
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

  // 剪辑行右键菜单里的「加一镜 / 删掉这一镜」，复用镜头行上那两个按钮的逻辑。
  // 增删镜头认的是 storyShotInsertIdentity，跟时间线用的 stableShotId 不是一个，
  // 所以这里按镜号回查一次。
  // 不 memo：insertShotAfter / deleteShot 闭包里读的是本次渲染的进行中状态，
  // 缓存住反而会拿到过期的守卫值。
  const storyboardEditShotActions: StoryboardEditShotActions = (() => {
    const insertIdentityByShotNo = new Map(
      shots.map((shot, index) => [
        shot.shotNo,
        storyShotInsertIdentity(shot, index),
      ])
    );
    return {
      onInsertShotAfter: onInsertShotAfter
        ? (input: { shotNo: number }) =>
            insertShotAfter(
              input.shotNo,
              insertIdentityByShotNo.get(input.shotNo)
            )
        : undefined,
      onDeleteShot: onDeleteShot
        ? (input: { shotNo: number }) =>
            deleteShot(input.shotNo, insertIdentityByShotNo.get(input.shotNo))
        : undefined,
    };
  })();

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
      setSelectedStoryboardMedia(current => {
        if (
          !isStoryboardMediaSelected(current, {
            shotIdentity: input.sourceStableShotId,
            kind: "image",
            id: input.imageId,
          })
        ) {
          return current;
        }
        return storyboardMediaSelection({
          shotIdentity: input.targetStableShotId,
          kind: "image",
          id: input.imageId,
        });
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
      setSelectedStoryboardMedia(current => {
        if (!current || current.shotIdentity !== input.stableShotId) {
          return current;
        }
        const deletedImageId = String(input.imageId);
        if (current.kind === "image" && current.id === deletedImageId) {
          return null;
        }
        if (
          current.kind === "candidate" &&
          current.id.startsWith(`${deletedImageId}:`)
        ) {
          return null;
        }
        return current;
      });
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
            setSelectedStoryboardMedia(current => {
              if (
                !isStoryboardMediaSelected(current, {
                  shotIdentity: payload.sourceStableShotId,
                  kind: "video",
                  id: `take-${payload.takeId}`,
                })
              ) {
                return current;
              }
              return storyboardMediaSelection({
                shotIdentity: stableShotId,
                kind: "video",
                id: `take-${payload.takeId}`,
              });
            });
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
  const {
    viewport: storyboardViewport,
    scale: timelineScale,
    setScale: setTimelineScale,
  } = useStoryboardTimelineViewport(storyboardTimelineDurationMs);
  const matrixShotEntries = useMemo(() => {
    const entries = shots.map((shot, originalIndex) => ({
      shot,
      originalIndex,
      stableShotId:
        storyShotInsertIdentity(shot, originalIndex) ??
        `story-shot-${originalIndex}`,
    }));
    return buildStoryboardMatrixLayout({
      entries,
      timings: storyboardTimingRows.map(timing => ({
        stableShotId: timing.stableShotId,
        startFrame: timing.startFrame,
        endFrame: timing.startFrame + timing.durationFrames,
      })),
      // 总宽来自时间视口，不再是「镜头数 × 固定列宽」。
      targetWidth: storyboardViewport.contentWidth,
    });
  }, [shots, storyboardTimingRows, storyboardViewport]);
  const matrixGridTemplateColumns = useMemo(() => {
    if (compactShots) {
      return `76px ${matrixShotEntries.entries
        .map(({ shot }) =>
          shot.shotNo === compactExpandedShotNo
            ? `${matrixShotColumnWidth}px`
            : "72px"
        )
        .join(" ")}`;
    }
    return `76px ${matrixShotEntries.widths
      .map(width => `${Math.max(1, width)}px`)
      .join(" ")}`;
  }, [
    compactExpandedShotNo,
    compactShots,
    matrixShotEntries,
    matrixShotColumnWidth,
  ]);
  const selectMatrixShot = (shotNo: number) => {
    const entryIndex = matrixShotEntries.entries.findIndex(
      entry => entry.shot.shotNo === shotNo
    );
    const alignedWidth = matrixShotEntries.widths[entryIndex] ?? 0;
    if (
      compactShots ||
      shouldCompactStoryboardMatrixForShot(
        alignedWidth,
        matrixShotColumnWidth
      )
    ) {
      setCompactShots(true);
      setCompactExpandedShotNo(shotNo);
    }
    onSelectShot?.(shotNo);
  };

  const showImageHoverPreview = (
    event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
    imageUrl: string,
    label: string,
    cropStyle?: CSSProperties
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const previewSize = 280;
    const gutter = 12;
    const left = Math.max(
      gutter,
      Math.min(
        window.innerWidth - previewSize - gutter,
        rect.left + rect.width / 2 - previewSize / 2
      )
    );
    const top =
      rect.top - previewSize - gutter >= gutter
        ? rect.top - previewSize - gutter
        : Math.min(
            window.innerHeight - previewSize - gutter,
            rect.bottom + gutter
          );
    setHoveredImagePreview({
      imageUrl,
      label,
      left,
      top,
      cropStyle,
    });
  };

  // Hover 预览是辅助信息，不应在焦点切换、滚动或窗口失焦后继续遮挡编辑器。
  useEffect(() => {
    if (!hoveredImagePreview) return;
    const clearHoverPreview = () => setHoveredImagePreview(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearHoverPreview();
    };
    document.addEventListener("pointerdown", clearHoverPreview, true);
    window.addEventListener("scroll", clearHoverPreview, true);
    window.addEventListener("blur", clearHoverPreview);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", clearHoverPreview, true);
      window.removeEventListener("scroll", clearHoverPreview, true);
      window.removeEventListener("blur", clearHoverPreview);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hoveredImagePreview]);

  /** 把用户在指令里点名的图片编号翻成真正的参考图。 */
  const instructionNamedImageReferences = (ids: readonly number[]) => {
    if (ids.length === 0) return [];
    const byId = new Map<
      number,
      { imageUrl: string; cueCode: string | null; shotNo: number }
    >();
    for (const shot of creationShots) {
      for (const frame of storyboardShotFrameImages(shot)) {
        if (!byId.has(frame.id)) {
          byId.set(frame.id, {
            imageUrl: frame.imageUrl,
            cueCode: shot.cueCode ?? null,
            shotNo: shot.shotNo,
          });
        }
      }
    }
    return ids.flatMap(id => {
      const found = byId.get(id);
      return found
        ? [
            {
              imageUrl: found.imageUrl,
              source: "instruction" as const,
              cueCode: found.cueCode,
              shotNo: found.shotNo,
              imageId: id,
            },
          ]
        : [];
    });
  };

  const resolvePersistedNeighborImageReferences = async (
    creationShot: CreationEditorShot
  ) => {
    const currentIdentity =
      creationShot.stableShotId ?? creationShot.shotIdentity ?? null;
    const currentIndex = creationShots.findIndex(
      candidate =>
        candidate === creationShot ||
        (currentIdentity != null &&
          (candidate.stableShotId ?? candidate.shotIdentity) ===
            currentIdentity)
    );
    if (currentIndex < 0) return null;

    let generationParams: Record<string, unknown>;
    try {
      const parsed = creationShot.generationParams
        ? JSON.parse(creationShot.generationParams)
        : {};
      generationParams =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      return null;
    }
    const frameSources =
      generationParams.startEndFrameSources &&
      typeof generationParams.startEndFrameSources === "object" &&
      !Array.isArray(generationParams.startEndFrameSources)
        ? (generationParams.startEndFrameSources as Record<string, unknown>)
        : null;
    const firstSource =
      frameSources?.first &&
      typeof frameSources.first === "object" &&
      !Array.isArray(frameSources.first)
        ? (frameSources.first as Record<string, unknown>)
        : null;
    const lastSource =
      frameSources?.last &&
      typeof frameSources.last === "object" &&
      !Array.isArray(frameSources.last)
        ? (frameSources.last as Record<string, unknown>)
        : null;
    const parsedConfig = parseStartEndVideoConfig(generationParams);
    const firstFrameImageId =
      (Number.isInteger(firstSource?.imageId)
        ? Number(firstSource?.imageId)
        : null) ?? parsedConfig?.firstFrameImageId;
    const lastFrameImageId =
      (Number.isInteger(lastSource?.imageId)
        ? Number(lastSource?.imageId)
        : null) ?? parsedConfig?.lastFrameImageId;
    if (
      firstFrameImageId == null ||
      lastFrameImageId == null ||
      frameSources?.policyVersion !== "neighbor-boundary-frames/v1"
    ) {
      return null;
    }

    const resolveBoundary = async (
      boundary: "first" | "last",
      source: "previous-last" | "next-first"
    ) => {
      const sourceConfig =
        frameSources[boundary] &&
        typeof frameSources[boundary] === "object" &&
        !Array.isArray(frameSources[boundary])
          ? (frameSources[boundary] as Record<string, unknown>)
          : null;
      const configuredImageId =
        boundary === "first" ? firstFrameImageId : lastFrameImageId;
      const expectedSource =
        boundary === "first" ? "previous-last" : "next-first";
      if (sourceConfig?.source !== expectedSource) return null;
      const neighborBoundary: "first" | "last" =
        source === "previous-last" ? "last" : "first";

      const configuredStableShotId =
        typeof sourceConfig.stableShotId === "string"
          ? sourceConfig.stableShotId
          : null;
      const candidates =
        boundary === "first"
          ? [...creationShots.slice(0, currentIndex)].reverse()
          : creationShots.slice(currentIndex + 1);
      const neighbor =
        candidates.find(candidate => {
          const identity =
            candidate.stableShotId ?? candidate.shotIdentity ?? null;
          return (
            configuredStableShotId == null ||
            identity === configuredStableShotId
          );
        }) ?? null;
      if (!neighbor) return null;

      const existing = storyboardShotFrameImages(neighbor).find(
        image => image.id === configuredImageId && Boolean(image.imageUrl)
      );
      if (existing) {
        return {
          imageId: existing.id,
          imageUrl: existing.imageUrl,
          source,
          cueCode: neighbor.cueCode?.trim() || null,
          shotNo: neighbor.shotNo,
        };
      }

      const take = neighbor.selectedVideoTake;
      const stableShotId =
        neighbor.stableShotId ?? neighbor.shotIdentity ?? null;
      if (
        !take ||
        take.status !== "available" ||
        !take.videoUrl ||
        !stableShotId ||
        !onImportStoryMaterial
      ) {
        return null;
      }
      const selectedRange =
        take.selectedRangeId == null
          ? null
          : (take.ranges.find(range => range.id === take.selectedRangeId) ??
            null);
      const startSec = selectedRange?.startSec ?? 0;
      const endSec =
        selectedRange?.endSec ??
        (typeof take.durationSec === "number" ? take.durationSec : null);
      if (endSec == null || endSec <= startSec) return null;
      const atSec =
        neighborBoundary === "first"
          ? startSec
          : Math.max(startSec, endSec - 1 / 30);
      const rangeQuery =
        selectedRange == null ? "" : `&rangeId=${selectedRange.id}`;
      const response = await fetch(
        `/api/video-frames/${take.id}?atSec=${atSec.toFixed(3)}${rangeQuery}`
      );
      if (!response.ok) {
        throw new Error(
          `${displayShotCode(neighbor)} 的${neighborBoundary === "first" ? "首帧" : "尾帧"}提取失败`
        );
      }
      const frameBlob = await response.blob();
      const mimeType = frameBlob.type || "image/png";
      const imported = await onImportStoryMaterial({
        fileName: `${displayShotCode(neighbor)}-${neighborBoundary === "first" ? "first" : "last"}-frame.png`,
        mimeType,
        fileBase64: await readStoryboardMediaBase64(
          new File([frameBlob], "neighbor-frame.png", { type: mimeType })
        ),
        targetStableShotId: stableShotId,
        preserveTimelineSelection: true,
        note: `${displayShotCode(neighbor)} 已采用 Take ${take.id} 的${neighborBoundary === "first" ? "首帧" : "尾帧"}，供相邻镜头连续性生成`,
      });
      if (imported.kind !== "image") return null;

      if (onUpdateShotFields) {
        const neighborFrames = [
          ...storyboardShotFrameImages(neighbor),
          { id: imported.imageId, imageUrl: imported.imageUrl },
        ];
        await onUpdateShotFields(stableShotId, {
          generationParams: storyboardFrameRoleGenerationParams(
            neighbor.generationParams,
            neighborFrames,
            imported.imageId,
            neighborBoundary,
            neighbor.durationMs
          ),
        });
      }
      return {
        imageId: imported.imageId,
        imageUrl: imported.imageUrl,
        source,
        cueCode: neighbor.cueCode?.trim() || null,
        shotNo: neighbor.shotNo,
      };
    };

    const [previousLast, nextFirst] = await Promise.all([
      resolveBoundary("first", "previous-last"),
      resolveBoundary("last", "next-first"),
    ]);
    if (!previousLast || !nextFirst) return null;

    if (onUpdateShotFields && currentIdentity) {
      const nextFrameSources = {
        ...frameSources,
        first: {
          ...((frameSources.first as Record<string, unknown> | undefined) ??
            {}),
          imageId: previousLast.imageId,
        },
        last: {
          ...((frameSources.last as Record<string, unknown> | undefined) ?? {}),
          imageId: nextFirst.imageId,
        },
      };
      await onUpdateShotFields(currentIdentity, {
        generationParams: JSON.stringify({
          ...generationParams,
          firstFrameImageId: previousLast.imageId,
          lastFrameImageId: nextFirst.imageId,
          startEndFrameSources: nextFrameSources,
        }),
      });
    }

    return {
      // 0201 需要向第二幕的红黑人物世界落地：下一镜首帧负责锁人物、
      // 服装和材质，上一镜尾帧负责交代从哪里进入。
      primary: nextFirst,
      context: [previousLast],
    };
  };

  const renderShotImageCandidates = async (
    shot: StoryShot,
    creationShot: CreationEditorShot | undefined,
    shotIndex: number,
    request?: NonNullable<ChatMessage["imageRerenderAction"]>,
    options: {
      skipCostConfirmation?: boolean;
      publishingCoverCandidate?: { id: number; imageUrl: string };
    } = {}
  ): Promise<
    StoryboardImageRerenderResult & { imageId?: number; imageUrl?: string }
  > => {
    const label = displayShotCode(shot);
    if (!creationShot || !onGenerateShotImages) {
      const message = `${label} 还没有可渲染的镜头记录`;
      toast.error(message);
      return { status: "error", message };
    }
    if (!canStartRenderForShot(shot.shotNo)) {
      const message = isShotRenderActive(shot.shotNo)
        ? `${label} 已在渲染线上`
        : continuityWorkflowLocked
          ? "正在确认人物连续性，确认后即可使用另一条渲染线"
          : `两条渲染线都在使用，请等待其中一条完成`;
      toast.info(message);
      return { status: "cancelled", message };
    }
    const stableShotId = storyShotInsertIdentity(shot, shotIndex);
    const pendingDrafts = stableShotId
      ? matrixDraftsRef.current.get(stableShotId)
      : undefined;
    const imageRequirement = (
      pendingDrafts?.promptDraft ??
      shot.promptDraft ??
      ""
    ).trim();
    if (!imageRequirement) {
      const message = `请先在 ${label} 的“图片要求”中写清楚要怎样生成或修改`;
      toast.error(message);
      return { status: "error", message };
    }
    const effectiveShot = storyboardRenderShotWithDraft(
      creationShot,
      shot,
      pendingDrafts
    );
    const selectedFrames = storyboardShotFrameImages(creationShot);
    const selectedFrame =
      request?.imageId != null
        ? selectedFrames.find(frame => frame.id === request.imageId)
        : undefined;
    const selectedFrameRole = selectedFrame
      ? storyboardFrameRoleForImage(
          creationShot.generationParams,
          selectedFrames,
          selectedFrame.id
        )
      : null;
    const exactEditInstruction = request?.instruction?.trim();
    const isExactFrameEdit = Boolean(selectedFrame && exactEditInstruction);
    const instructionImageIds = storyboardInstructionImageIds(
      exactEditInstruction ?? ""
    );
    const instructionReferences =
      instructionNamedImageReferences(instructionImageIds);
    const foundInstructionImageIds = new Set(
      instructionReferences.map(reference => reference.imageId)
    );
    const missingInstructionImageIds = instructionImageIds.filter(
      imageId => !foundInstructionImageIds.has(imageId)
    );
    if (missingInstructionImageIds.length > 0) {
      const message = `找不到用户点名的图片 #${missingInstructionImageIds.join("、#")}，本次不会提交付费生成`;
      toast.error(message);
      return { status: "error", message };
    }
    const editMaskPlan =
      isExactFrameEdit &&
      exactEditInstruction &&
      instructionReferences.length === 0
        ? storyboardExactEditMaskPlan(exactEditInstruction, {
            cueCode: label,
            frameRole: selectedFrameRole,
          })
        : undefined;
    let editMaskImageUrl: string | undefined;
    if (selectedFrame && editMaskPlan) {
      try {
        editMaskImageUrl = await createStoryboardEditMaskDataUrl(
          selectedFrame.imageUrl,
          editMaskPlan
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "裙子区域遮罩创建失败";
        toast.warning(`${reason}，已改用整帧参考编辑；尚未提交付费任务`);
      }
    }
    const templateEnabled = isSheSelf02ImageEditTemplateEnabled(
      storyTitle,
      label
    );
    const imageInstruction = buildSheSelf02ImageEditInstruction({
      storyTitle,
      shotCode: label,
      currentInstruction: imageRequirement,
    });
    const boardInstruction = storyboardExplicitImageInstruction({
      ...effectiveShot,
      promptDraft: imageInstruction,
    });
    const useSingleImageFallback =
      !isExactFrameEdit && shouldUseSingleImageFallback(imageProviderStatus);
    const explicitInstruction = [
      exactEditInstruction
        ? `本次对话修改（最高优先级，必须实际应用）：${exactEditInstruction}`
        : "",
      boardInstruction,
      useSingleImageFallback
        ? "单帧参考编辑保护：只生成一张完整的电影静帧；禁止四宫格、分屏、拼贴、漫画格和联系表。"
        : "",
      isExactFrameEdit
        ? storyboardExactEditConstraint(exactEditInstruction ?? "")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const neighborReferences =
      (await resolvePersistedNeighborImageReferences(creationShot)) ??
      storyboardImageGenerationReferences(creationShot, creationShots);
    const publishingCoverStyle =
      options.publishingCoverCandidate ?? inheritedPublishingCover;
    const coverReference = publishingCoverStyle?.imageUrl
      ? {
          imageUrl: publishingCoverStyle.imageUrl,
          source: options.publishingCoverCandidate
            ? ("publishing-cover-candidate" as const)
            : ("publishing-cover" as const),
          cueCode: null,
          shotNo: creationShot.shotNo,
        }
      : null;
    const primaryReference = selectedFrame
      ? {
          imageUrl: selectedFrame.imageUrl,
          source: "current" as const,
          cueCode: creationShot.cueCode ?? null,
          shotNo: creationShot.shotNo,
        }
      : (neighborReferences?.primary ?? coverReference);
    if (!primaryReference) {
      if (inheritedPublishingCoverCandidates.length > 0) {
        setSelectedPublishingCoverCandidateId(null);
        setPublishingCoverReferenceDialog({
          shot,
          creationShot,
          shotIndex,
          request,
        });
        const message = `${label} 没有镜头参考，请先选择一张已有封面候选作为本次风格参考`;
        toast.info(message);
        return { status: "cancelled", message };
      }
      const message = `${label} 及相邻镜头还没有可信画面。请先拖入一张属于当前故事的图片；本次不会提交付费任务。`;
      toast.error(message);
      return { status: "error", message };
    }
    const imageReferences = {
      primary: primaryReference,
      context: storyboardReferenceContext({
        primaryImageUrl: primaryReference.imageUrl,
        instructionReferences: selectedFrame ? instructionReferences : [],
        continuityReferences: selectedFrame
          ? neighborReferences
            ? [neighborReferences.primary, ...neighborReferences.context]
            : []
          : (neighborReferences?.context ?? []),
        coverReference,
      }),
    };
    const imageProvider =
      isExactFrameEdit || useSingleImageFallback
        ? ("gpt-image" as const)
        : ("midjourney" as const);
    // MJ 的主图锁会主动舍弃上下文图，带遮罩的 GPT 编辑也只发送底图；
    // 只有真正走多图编辑时才附清单，避免提示词引用模型没收到的「图2」。
    const instructionWithReferences = [
      imageProvider === "gpt-image" && !editMaskImageUrl
        ? storyboardReferenceManifest(imageReferences)
        : "",
      explicitInstruction,
    ]
      .filter(Boolean)
      .join("\n\n");
    const providerBlockReason =
      storyboardImageRenderBlockReason(imageProviderStatus);
    if (providerBlockReason) {
      const message = `图片生成当前不可提交：${providerBlockReason}`;
      toast.error(message);
      return { status: "error", message };
    }
    const imageRenderPlan = buildStoryboardImageRenderPlan({
      label,
      isExactFrameEdit,
      exactEditInstruction,
      selectedFrameId: selectedFrame?.id ?? null,
      selectedFrameRole,
      editMaskPlan,
      editMaskImageUrl,
      useSingleImageFallback,
      imageReferences,
      explicitInstruction,
      templateLabel: templateEnabled
        ? SHE_SELF_02_0201_IMAGE_EDIT_TEMPLATE_LABEL
        : undefined,
    });
    const { editRoleLabel, estimate: imageEstimate } = imageRenderPlan;
    const confirmed =
      options.skipCostConfirmation ||
      window.confirm(imageRenderPlan.confirmation);
    if (!confirmed) {
      return {
        status: "cancelled",
        message: `${label} 已取消，本次未提交付费生成`,
      };
    }

    beginShotRender(shot.shotNo);
    onSelectShot?.(shot.shotNo);
    try {
      if (onUpdateShotField && pendingDrafts) {
        for (const field of [
          "action",
          "performance",
          "cameraMove",
          "transitionOut",
          "promptDraft",
        ] as const) {
          const pendingValue = pendingDrafts[field];
          if (
            typeof pendingValue === "string" &&
            pendingValue !== (shot[field] ?? "")
          ) {
            await onUpdateShotField(shotIndex, field, pendingValue);
          }
        }
      }
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
      const generation = await onGenerateShotImages({
        shotNo: shot.shotNo,
        rows,
        explicitInstruction: instructionWithReferences,
        exactFrameEdit: isExactFrameEdit,
        candidateCount: imageRenderPlan.candidateCount,
        imageProvider,
        editMaskImageUrl,
        reference: {
          imageUrl:
            imageReferences.primary.source === "publishing-cover" ||
            imageReferences.primary.source === "publishing-cover-candidate"
              ? undefined
              : imageReferences.primary.imageUrl,
          identityImageUrl:
            imageReferences.primary.source === "publishing-cover" ||
            imageReferences.primary.source === "publishing-cover-candidate"
              ? undefined
              : imageReferences.primary.imageUrl,
          contextImageUrls: imageReferences.context.map(
            reference => reference.imageUrl
          ),
          storyStyleImageUrl: publishingCoverStyle?.imageUrl,
        },
        costConfirmation: {
          accepted: true,
          estimatedCny: imageEstimate.estimatedCny,
        },
      });
      if (
        isExactFrameEdit &&
        selectedFrameRole &&
        generation.imageId != null &&
        generation.imageUrl &&
        stableShotId &&
        onUpdateShotFields
      ) {
        const nextFrames = [
          ...selectedFrames.filter(frame => frame.id !== generation.imageId),
          {
            id: generation.imageId,
            imageUrl: generation.imageUrl,
          },
        ];
        await onUpdateShotFields(stableShotId, {
          generationParams: storyboardFrameRoleGenerationParams(
            creationShot.generationParams,
            nextFrames,
            generation.imageId,
            selectedFrameRole,
            creationShot.durationMs ?? 5_000
          ),
        });
      }
      if (isExactFrameEdit) {
        const message = `${label} 的${editRoleLabel}已生成新版本并放回“画面”行，旧图仍然保留`;
        toast.success(message);
        return {
          status: "success",
          message,
          imageId: generation.imageId,
          imageUrl: generation.imageUrl,
        };
      }
      if (generation.failedCount > 0) {
        const message = `${label} 已生成 ${generation.generatedCount} 张候选，另有 ${generation.failedCount} 张失败；现有结果已放入“画面”行`;
        toast.warning(message);
        return {
          status: "success",
          message,
          imageId: generation.imageId,
          imageUrl: generation.imageUrl,
        };
      } else {
        const message = `${label} 已生成四张候选图，请在“画面”行选择一张`;
        toast.success(message);
        return {
          status: "success",
          message,
          imageId: generation.imageId,
          imageUrl: generation.imageUrl,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${label} 图片生成失败`;
      toast.error(message);
      return { status: "error", message };
    } finally {
      finishShotRender(shot.shotNo);
    }
  };

  const continueWithPublishingCoverCandidate = async () => {
    const dialog = publishingCoverReferenceDialog;
    const candidate = inheritedPublishingCoverCandidates.find(
      item => item.id === selectedPublishingCoverCandidateId
    );
    if (!dialog || !candidate) return;
    setPublishingCoverReferenceDialog(null);
    setSelectedPublishingCoverCandidateId(null);
    await renderShotImageCandidates(
      dialog.shot,
      dialog.creationShot,
      dialog.shotIndex,
      dialog.request,
      { publishingCoverCandidate: candidate }
    );
  };

  const submitSelectedImageEdit = useCallback(async () => {
    const dialog = imageEditDialog;
    const instruction = imageEditInstruction.trim();
    if (!dialog || !instruction || imageEditSubmitting) return;
    const shot = shots[dialog.shotIndex];
    const creationShot = creationShots.find(
      candidate => candidate.shotNo === dialog.shotNo
    );
    if (!shot || !creationShot) {
      toast.error("当前镜头还没有可升级的图像版本");
      return;
    }
    const monitorId = `${dialog.shotNo}-${Date.now()}`;
    const monitorStartedAt = Date.now();
    setImageRenderMonitor({
      id: monitorId,
      label: dialog.label,
      imageUrl: dialog.imageUrl,
      startedAt: monitorStartedAt,
      // 这是基于当前 GPT-image 编辑链路的保守估算，不代表供应商承诺时长。
      estimatedSeconds: 90,
      status: "running",
    });
    setImageRenderMonitorNow(monitorStartedAt);
    setImageEditSubmitting(true);
    try {
      const renderPromise = renderShotImageCandidates(
        shot,
        creationShot,
        dialog.shotIndex,
        {
          storyId: null,
          stableShotId:
            creationShot.stableShotId ?? creationShot.shotIdentity ?? null,
          shotNo: dialog.shotNo,
          cueCode: creationShot.cueCode ?? null,
          imageId: dialog.imageId,
          instruction,
        }
      );
      // 费用确认通过后立即收起大弹窗；任务继续由右下角监控条承载。
      setImageEditDialog(null);
      setImageEditInstruction("");
      const result = await renderPromise;
      if (result.status === "cancelled") {
        setImageRenderMonitor(null);
        return;
      }
      setImageRenderMonitor(current =>
        current?.id === monitorId
          ? {
              ...current,
              imageUrl: result.imageUrl ?? current.imageUrl,
              status: result.status === "success" ? "success" : "error",
              message: result.message,
            }
          : current
      );
    } finally {
      setImageEditSubmitting(false);
    }
  }, [
    creationShots,
    imageEditDialog,
    imageEditInstruction,
    imageEditSubmitting,
    renderShotImageCandidates,
    shots,
  ]);

  useEffect(() => {
    if (!onRegisterImageRerenderRunner) return;
    const runner: StoryboardImageRerenderRunner = async request => {
      const shotIndex = shots.findIndex((candidate, index) => {
        const stableShotId = storyShotInsertIdentity(candidate, index);
        if (request.stableShotId && stableShotId === request.stableShotId) {
          return true;
        }
        if (request.cueCode && candidate.cueCode === request.cueCode) {
          return true;
        }
        return candidate.shotNo === request.shotNo;
      });
      const shot = shots[shotIndex];
      if (!shot) {
        const message = "这个镜头已经不在当前故事中，请刷新后再试";
        toast.error(message);
        return { status: "error", message };
      }
      const stableShotId = storyShotInsertIdentity(shot, shotIndex);
      const creationShot = creationShots.find(candidate => {
        const candidateStableShotId =
          candidate.stableShotId ?? candidate.shotIdentity ?? null;
        return (
          (stableShotId != null && candidateStableShotId === stableShotId) ||
          candidate.shotNo === shot.shotNo
        );
      });
      return renderShotImageCandidates(shot, creationShot, shotIndex, request);
    };
    return onRegisterImageRerenderRunner(runner);
  }, [
    creationShots,
    onRegisterImageRerenderRunner,
    renderShotImageCandidates,
    shots,
  ]);

  const promoteStoryboardFrameCandidate = async (input: {
    shot: StoryShot;
    shotIdentity: string;
    imageId: number;
    imageUrl: string;
    quadrant: FrameQuadrant;
  }) => {
    if (!onPromoteFrameCrop) return;
    onSelectShot?.(input.shot.shotNo);
    try {
      const cropped = await cropFrameQuadrant(input.imageUrl, input.quadrant);
      const promoted = await onPromoteFrameCrop({
        shotNo: input.shot.shotNo,
        imageBase64: cropped.imageBase64,
        mimeType: cropped.mimeType,
        parentImageId: input.imageId,
        quadrant: input.quadrant,
      });
      setSelectedStoryboardMedia(
        storyboardMediaSelection({
          shotIdentity: input.shotIdentity,
          kind: "image",
          id: promoted.imageId,
        })
      );
      toast.success(
        `${displayShotCode(input.shot)} 已采用${FRAME_QUADRANTS.find(item => item.value === input.quadrant)?.label ?? ""}候选`
      );
    } catch (error) {
      setSelectedStoryboardMedia(current =>
        isStoryboardMediaSelected(current, {
          shotIdentity: input.shotIdentity,
          kind: "candidate",
          id: `${input.imageId}:${input.quadrant}`,
        })
          ? null
          : current
      );
      toast.error(error instanceof Error ? error.message : "候选图片保存失败");
    }
  };

  /**
   * 首尾帧的时长与运动幅度。以前只能从镜头时长和 motion 推导，想跑 8 秒或加大
   * 幅度只能去脚本里改；这里让故事版直接写 generationParams，
   * `parseStartEndVideoConfig` 本来就读这两个键。
   *
   * 两个下拉是挨着放的，用户会连着改。所以写入必须串行，而且每次都把这一镜
   * **累积的**选择整体写回——只写当次改动的话，第二次写入会基于还没回读到的旧
   * generationParams，把第一次的选择盖掉（实测：先改时长再改幅度，时长会丢）。
   */
  const [startEndTuningOverrides, setStartEndTuningOverrides] = useState<
    Record<
      string,
      { durationSec?: number; movementAmplitude?: StoryboardStartEndAmplitude }
    >
  >({});
  const startEndTuningOverridesRef = useRef(startEndTuningOverrides);
  startEndTuningOverridesRef.current = startEndTuningOverrides;
  const startEndTuningQueueRef = useRef<Promise<void>>(Promise.resolve());

  const updateStartEndTuning = (
    creationShot: CreationEditorShot | undefined,
    tuning: {
      durationSec?: number;
      movementAmplitude?: StoryboardStartEndAmplitude;
    }
  ) => {
    const stableShotId =
      creationShot?.stableShotId ?? creationShot?.shotIdentity ?? null;
    if (!creationShot || !stableShotId || !onUpdateShotFields) return;
    setStartEndTuningOverrides(previous => ({
      ...previous,
      [stableShotId]: { ...previous[stableShotId], ...tuning },
    }));
    startEndTuningQueueRef.current = startEndTuningQueueRef.current
      .then(async () => {
        const accumulated =
          startEndTuningOverridesRef.current[stableShotId] ?? tuning;
        await onUpdateShotFields(stableShotId, {
          generationParams: storyboardStartEndTuningGenerationParams(
            creationShot.generationParams,
            accumulated
          ),
        });
      })
      .catch(error => {
        toast.error(
          error instanceof Error ? error.message : "保存视频时长或运动幅度失败"
        );
      });
  };

  const rerenderShotVideo = async (
    shot: StoryShot,
    creationShot: CreationEditorShot | undefined,
    options: {
      skipCostConfirmation?: boolean;
      sourceImage?: { imageId: number; imageUrl: string };
    } = {}
  ) => {
    const label = displayShotCode(shot);
    if (!creationShot) {
      toast.error(`${label} 还没有可渲染的镜头记录`);
      return false;
    }
    if (!canStartRenderForShot(shot.shotNo)) {
      toast.info(
        isShotRenderActive(shot.shotNo)
          ? `${label} 已在渲染线上`
          : continuityWorkflowLocked
            ? "正在确认人物连续性，确认后即可使用另一条渲染线"
            : "两条渲染线都在使用，请等待其中一条完成"
      );
      return false;
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
    if (options.sourceImage) {
      effectiveShot = {
        ...effectiveShot,
        imageId: options.sourceImage.imageId,
        imageUrl: options.sourceImage.imageUrl,
      };
    }
    const videoSourceFrame = storyboardVideoSourceFrame(effectiveShot);
    if (
      videoSourceFrame &&
      (effectiveShot.imageId !== videoSourceFrame.id ||
        effectiveShot.imageUrl !== videoSourceFrame.imageUrl)
    ) {
      effectiveShot = {
        ...effectiveShot,
        imageId: videoSourceFrame.id,
        imageUrl: videoSourceFrame.imageUrl,
      };
    }
    const videoBlockReason = storyboardVideoRenderBlockReason(effectiveShot, {
      ready: Boolean(shotVideoProviderStatus?.ready),
      reason:
        shotVideoProviderStatus?.missing.filter(Boolean).join("、") ||
        "视频模型状态尚未就绪",
    });
    if (videoBlockReason) {
      toast.error(`${label} ${videoBlockReason}`);
      return false;
    }
    beginShotRender(shot.shotNo);
    onSelectShot?.(shot.shotNo);
    try {
      beginContinuityCheck(shot.shotNo, "video");
      let continuityChoice: StoryboardContinuityResolution;
      try {
        continuityChoice = await resolveGenerationContinuity({
          shot,
          creationShot: effectiveShot,
          renderKind: "video",
        });
      } finally {
        finishContinuityCheck(shot.shotNo);
      }
      if (continuityChoice === STORYBOARD_CONTINUITY_REQUEST_INTERRUPTED) {
        return false;
      }
      if (shouldAnnounceVideoGenerationCancellation(continuityChoice)) {
        toast.info(`${label} 已取消视频生成，未产生费用`);
        return false;
      }
      if (continuityChoice) {
        effectiveShot = {
          ...effectiveShot,
          generationParams: storyboardCharacterContinuityGenerationParams(
            effectiveShot.generationParams,
            continuityChoice,
            {
              imageId: effectiveShot.imageId,
              imageUrl: effectiveShot.imageUrl,
            }
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
        const confirmed =
          options.skipCostConfirmation ||
          window.confirm(
            usesLocalTransform
              ? `${label} 已判断为简单缩放、平移或定格：${estimate.renderReason} 将在本机免费生成，人民币 ¥0.00，不会请求 302；会创建新 Take 并保留旧版本。确认生成？`
              : `${label} 已先保存本镜文字，视频模型会收到：\n${intentSummary || "当前镜头表格中的动作与运镜"}\n\n人物版本：${continuityChoice?.label ?? "当前镜头"}。并使用首帧 ${estimate.firstFrame.label}（图 #${estimate.firstFrame.imageId}）和末帧 ${estimate.lastFrame.label}（图 #${estimate.lastFrame.imageId}）重新渲染。${frameConstraintNotice}\n\n判断：${estimate.renderReason} 预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，时长 ${estimate.durationSec} 秒、${estimate.resolution}、1:1；会创建新 Take 并保留旧版本。确认提交？`
          );
        if (!confirmed) {
          toast.info(`${label} 已取消视频生成，未产生费用`);
          return false;
        }
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
        return true;
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
      const confirmed =
        options.skipCostConfirmation ||
        window.confirm(
          plan.renderDecision.strategy === "local-transform"
            ? `${label} 已判断为简单缩放、平移或定格：${plan.renderDecision.reason} 将在本机免费生成，人民币 ¥0.00，不会请求 302；会创建新 Take 并保留旧版本。确认生成？`
            : `${label} 已先保存本镜文字，视频模型会收到：\n${intentSummary || "当前镜头表格中的动作与运镜"}\n\n人物版本：${continuityChoice?.label ?? "当前镜头"}。判断：${plan.renderDecision.reason} 预计人民币 ¥${plan.estimatedCny.toFixed(2)}，时长 ${plan.durationSec} 秒、1:1；会创建新 Take 并保留旧版本。确认提交？`
        );
      if (!confirmed) {
        toast.info(`${label} 已取消视频生成，未产生费用`);
        return false;
      }
      const result = (await onGenerateShotVideo({
        shotNo: effectiveShot.shotNo,
        imageId: effectiveShot.imageId,
        characterReferenceImageUrl: continuityChoice?.imageUrl,
        storyStyleReferenceImageUrl: inheritedPublishingCover?.imageUrl,
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
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `${label} 视频提交失败`
      );
      return false;
    } finally {
      finishShotRender(shot.shotNo);
    }
  };

  const generateThirtySecondVideo = async () => {
    if (oneClickVideoProgress) return;
    const singleImageFallback =
      shouldUseSingleImageFallback(imageProviderStatus);
    if (!singleImageFallback && !onPromoteFrameCrop) {
      toast.error("一键生成缺少候选图采用链路，本次不会提交付费任务");
      return;
    }
    const providerStatus = {
      ready: Boolean(shotVideoProviderStatus?.ready),
      reason:
        shotVideoProviderStatus?.missing.filter(Boolean).join("、") ||
        "视频模型状态尚未就绪",
    };
    const imageEstimate = storyboardShotCostEstimate(undefined, {
      singleImageFallback,
    }).imageCny;
    const plan = planStoryboardOneClickVideo(
      creationShots,
      providerStatus,
      30,
      {
        imageProviderReady: Boolean(imageProviderStatus?.ready),
        hasInheritedCover: Boolean(inheritedPublishingCover?.imageUrl),
        estimatedImageCny: imageEstimate,
      }
    );
    if (plan.shots.length === 0) {
      toast.error(
        "还没有可一键生成的镜头，请确认正式封面、图片要求、视频要求和模型状态"
      );
      return;
    }
    const skippedNotice = plan.skippedCount
      ? `\n另有 ${plan.skippedCount} 镜因缺少主图、视频要求或模型未就绪而跳过。`
      : "";
    const coverNotice = inheritedPublishingCover
      ? "\n美术方向将继承当前文字稿封面。"
      : "";
    const imageStageNotice = plan.imageGenerationCount
      ? singleImageFallback
        ? `\n其中 ${plan.imageGenerationCount} 镜缺少主图，将先根据封面和图片要求生成单张主图，再生成视频。`
        : `\n其中 ${plan.imageGenerationCount} 镜缺少主图，将先根据封面和图片要求生成四图候选，并按固定规则采用左上候选作为当前主图，再生成视频。`
      : "";
    const confirmed = window.confirm(
      `将读取整个故事版，根据现有图案和文字生成 ${plan.shots.length} 镜、约 ${plan.durationSec} 秒的视频。${coverNotice}${imageStageNotice}${skippedNotice}\n\n图片与视频预计费用合计 ¥${plan.estimatedCny.toFixed(2)}；新资产会保留旧版本。确认一键生成？`
    );
    if (!confirmed) {
      toast.info("已取消一键生成，未产生费用");
      return;
    }

    setOneClickVideoProgress({ completed: 0, total: plan.shots.length });
    let completed = 0;
    let processed = 0;
    try {
      for (const plannedShot of plan.shots) {
        try {
          const shot = shots.find(item => item.shotNo === plannedShot.shotNo);
          const creationShot = creationShots.find(
            item => item.shotNo === plannedShot.shotNo
          );
          if (!shot || !creationShot) continue;
          let sourceImage: { imageId: number; imageUrl: string } | undefined;
          if (plannedShot.needsImage) {
            const shotIndex = shots.findIndex(item => item === shot);
            const generated = await renderShotImageCandidates(
              shot,
              creationShot,
              shotIndex,
              undefined,
              { skipCostConfirmation: true }
            );
            if (
              generated.status !== "success" ||
              generated.imageId == null ||
              !generated.imageUrl
            ) {
              continue;
            }
            if (singleImageFallback) {
              sourceImage = {
                imageId: generated.imageId,
                imageUrl: generated.imageUrl,
              };
            } else if (onPromoteFrameCrop) {
              const cropped = await cropFrameQuadrant(
                generated.imageUrl,
                "top-left"
              );
              const promoted = await onPromoteFrameCrop({
                shotNo: creationShot.shotNo,
                imageBase64: cropped.imageBase64,
                mimeType: cropped.mimeType,
                parentImageId: generated.imageId,
                quadrant: "top-left",
              });
              sourceImage = {
                imageId: promoted.imageId,
                imageUrl: promoted.imageUrl,
              };
            }
          }
          const submitted = await rerenderShotVideo(shot, creationShot, {
            skipCostConfirmation: true,
            sourceImage,
          });
          if (submitted) completed += 1;
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `${plannedShot.shotNo} 镜一键生成失败：${error.message}`
              : `${plannedShot.shotNo} 镜一键生成失败`
          );
        } finally {
          processed += 1;
          setOneClickVideoProgress({
            completed: processed,
            total: plan.shots.length,
          });
        }
      }
    } finally {
      setOneClickVideoProgress(null);
    }
    if (completed > 0) {
      toast.success(
        `${completed} 镜已进入生成队列${completed === plan.shots.length ? `，成片时长约 ${plan.durationSec} 秒` : `；${plan.shots.length - completed} 镜未提交`}`
      );
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
          {inheritedPublishingCover ? (
            <span
              className="hidden items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] text-muted-foreground sm:inline-flex"
              style={{ borderColor: "var(--panel-border)" }}
              title="人物设计、色板、材质、光线与情绪继承自文字稿正式封面"
            >
              <img
                src={inheritedPublishingCover.imageUrl}
                alt=""
                className="h-4 w-4 rounded-[2px] object-cover"
              />
              继承文字稿封面
            </span>
          ) : null}
          {shots.length > 0 && onGenerateShotVideo ? (
            <button
              type="button"
              onClick={() => void generateThirtySecondVideo()}
              disabled={
                Boolean(oneClickVideoProgress) ||
                (!shouldUseSingleImageFallback(imageProviderStatus) &&
                  !onPromoteFrameCrop)
              }
              className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-[var(--nayin-accent)] px-2.5 text-[10px] font-semibold text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-60"
              aria-label="根据现有图案和文字一键生成约30秒视频"
              data-testid="storyboard-one-click-video"
              title="读取完整故事版；缺图时先继承正式封面生成主图，再生成约 30 秒视频"
            >
              {oneClickVideoProgress ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {oneClickVideoProgress
                ? `${oneClickVideoProgress.completed}/${oneClickVideoProgress.total}`
                : "一键生成 · 约30秒"}
            </button>
          ) : null}
          {!headerAction ? (
            <span className="creation-board-panel-status">
              {isGeneratingScript
                ? "生成故事版中"
                : storyboardTimelineDurationMs > 0
                  ? `${shots.length} 镜 · ${(storyboardTimelineDurationMs / 1000).toFixed(1)}s · ${frames.length} 图`
                  : `${shots.length} 镜 · ${frames.length} 图`}
            </span>
          ) : null}
          {activeRenderShotNos.length > 0 ? (
            <span
              className="creation-board-panel-status"
              aria-label="渲染线状态"
            >
              渲染线 {activeRenderShotNos.length}/
              {MAX_CONCURRENT_STORYBOARD_RENDERS}
            </span>
          ) : null}
          {boardTimeline && shots.length > 0 && viewMode === "full" ? (
            <StoryboardEditTransport timeline={boardTimeline} />
          ) : null}
          {shots.length > 0 && viewMode === "full" ? (
            <button
              type="button"
              aria-pressed={compactShots}
              aria-label={compactShots ? "恢复所有镜头完整宽度" : "缩小所有镜头"}
              data-testid="storyboard-compact-shots-toggle"
              onClick={() => {
                setCompactShots(current => {
                  if (current) setCompactExpandedShotNo(null);
                  return !current;
                });
              }}
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-[10px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
              style={{ borderColor: "var(--panel-border)" }}
              title={
                compactShots
                  ? "恢复所有镜头的完整宽度"
                  : "缩小所有镜头；点击某镜可单独展开"
              }
            >
              {compactShots ? (
                <Maximize2 className="h-3 w-3" />
              ) : (
                <Minimize2 className="h-3 w-3" />
              )}
              {compactShots ? "恢复" : "缩小"}
            </button>
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

      {!imageProviderStatus?.ready ? (
        <div
          className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-900 dark:text-amber-200"
          role="status"
          data-testid="storyboard-image-provider-blocked"
        >
          图片付费生成已暂停：
          {imageProviderStatus?.reason ?? "正在确认图片供应商状态"}
          {imageProviderStatus?.retryAt
            ? `；系统将在 ${new Date(imageProviderStatus.retryAt).toLocaleTimeString()} 后自动重试状态`
            : ""}
        </div>
      ) : null}

      <div
        ref={viewMode === "simple" ? boardScrollRef : undefined}
        className={`creation-board-panel-body min-h-0 flex-1 custom-scrollbar ${
          viewMode === "full" ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {shots.length > 0 && viewMode === "simple" ? (
          <SimpleStoryboardBoard
            shots={shots}
            frameByShotNo={frameByShotNo}
            creationShotByNo={creationShotByNo}
            timelineShotIdSet={timelineShotIdSet}
            selectedShotNo={selectedShotNo}
            videoTakeDropTargetId={videoTakeDropTargetId}
            imageFrameDropTargetId={imageFrameDropTargetId}
            localMediaDropTargetId={localMediaDropTargetId}
            importingMediaShotId={importingMediaShotId}
            isGeneratingScript={isGeneratingScript}
            insertingAfterShotNo={insertingAfterShotNo}
            deletingShotId={deletingShotId}
            shotMediaDropHandlers={shotMediaDropHandlers}
            onOpenShot={openShotEditor}
            onMediaDragEnd={() => {
              stopStoryboardDragScroll();
              setImageFrameDropTargetId(null);
              setVideoTakeDropTargetId(null);
            }}
            onSelectShot={onSelectShot}
            onAddShotToTimeline={onAddShotToTimeline}
            onInsertShotAfter={onInsertShotAfter ? insertShotAfter : undefined}
            onDeleteShot={onDeleteShot ? deleteShot : undefined}
            onEditVideo={onEditVideo}
            onEditImage={onEditImage}
            deferSingleClick={deferVideoSingleClick}
            cancelDeferredSingleClick={cancelDeferredVideoSingleClick}
            candidatesByShot={candidatesByShot}
            onConfirmCandidate={onConfirmCandidate}
            onRejectCandidate={onRejectCandidate}
          />
        ) : shots.length > 0 ? (
          <div className="flex h-full min-h-0 flex-col">
            <StoryboardTimelineZoomBar
              viewport={storyboardViewport}
              scale={timelineScale}
              onScaleChange={setTimelineScale}
            />
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
                  gridTemplateColumns: matrixGridTemplateColumns,
                }}
              >
                <StoryboardTimelineRulerRow
                  viewport={storyboardViewport}
                  columnSpan={matrixShotEntries.entries.length}
                />
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
                {matrixShotEntries.entries.map(({ shot, originalIndex }) => {
                  const index = originalIndex;
                  const creationShot = creationShotByNo.get(shot.shotNo);
                  const title = shortText(
                    shot.dialogue,
                    shortText(shot.action, shortText(shot.subject, "关键镜头"))
                  );
                  const shotLabel = displayShotCode(shot);
                  const selected = selectedShotNo === shot.shotNo;
                  const shotIsCompact =
                    compactShots && compactExpandedShotNo !== shot.shotNo;
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
                  const headerVideoBlockReason = creationShot
                    ? storyboardVideoRenderBlockReason(creationShot, {
                        ready: Boolean(shotVideoProviderStatus?.ready),
                        reason:
                          shotVideoProviderStatus?.missing
                            .filter(Boolean)
                            .join("、") || "视频模型状态尚未就绪",
                      })
                    : "还没有可渲染的镜头记录";
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
                      data-storyboard-shot-compact={shotIsCompact}
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
                        onClick={() => selectMatrixShot(shot.shotNo)}
                        className="flex w-full min-w-0 items-baseline gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                        aria-label={`选择 ${shotLabel} ${title}`}
                      >
                        <span className="shrink-0 font-mono text-[10px] font-semibold text-foreground">
                          {shotLabel}
                        </span>
                        {!shotIsCompact ? (
                          <span className="min-w-0 flex-1 truncate text-[9px] leading-relaxed text-muted-foreground">
                            {title}
                          </span>
                        ) : null}
                      </button>
                      <div
                        className="mt-1 flex h-6 items-center gap-1"
                        data-storyboard-shot-actions="true"
                      >
                        {!shotIsCompact &&
                        onConfirmCandidate &&
                        onRejectCandidate ? (
                          <ShotCandidateBadge
                            compact
                            shotLabel={shotLabel}
                            candidates={
                              (insertStableShotId &&
                                candidatesByShot?.get(insertStableShotId)) ||
                              []
                            }
                            onConfirm={onConfirmCandidate}
                            onReject={onRejectCandidate}
                          />
                        ) : null}
                        {!shotIsCompact &&
                        onAddShotToTimeline &&
                        !isOnTimeline ? (
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
                              ).then(() => {
                                if (compactShots) {
                                  setCompactExpandedShotNo(shot.shotNo + 1);
                                }
                              });
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
                        {!shotIsCompact && onGenerateShotImages ? (
                          <button
                            type="button"
                            data-testid={`storyboard-header-generate-image-${insertStableShotId}`}
                            disabled={
                              !creationShot ||
                              !imageProviderStatus?.ready ||
                              !canStartRenderForShot(shot.shotNo)
                            }
                            onClick={event => {
                              event.stopPropagation();
                              void renderShotImageCandidates(
                                shot,
                                creationShot,
                                index
                              );
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-background hover:text-[var(--nayin-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-45"
                            aria-label={`根据前后画面和图片要求重新生成 ${shotLabel} 图片`}
                            title={
                              imageProviderStatus?.ready
                                ? "根据前后画面和图片要求重新生成图片"
                                : (imageProviderStatus?.reason ??
                                  "正在确认图片供应商状态")
                            }
                          >
                            {generatingImageShotNos.includes(shot.shotNo) ||
                            continuityCheckingByShot[shot.shotNo] ===
                              "image" ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ImagePlus className="h-3 w-3" />
                            )}
                          </button>
                        ) : null}
                        {!shotIsCompact &&
                        creationShot &&
                        (onGenerateShotVideo ||
                          (onEstimateStartEndShotVideo &&
                            onGenerateStartEndShotVideo)) ? (
                          <button
                            type="button"
                            data-testid={`storyboard-header-generate-video-${insertStableShotId}`}
                            disabled={
                              Boolean(headerVideoBlockReason) ||
                              !canStartRenderForShot(shot.shotNo)
                            }
                            onClick={event => {
                              event.stopPropagation();
                              void rerenderShotVideo(shot, creationShot);
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-background hover:text-[var(--nayin-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-45"
                            aria-label={`根据当前图片、正式封面和视频要求生成 ${shotLabel} 视频`}
                            title={
                              headerVideoBlockReason ??
                              "以当前主图为首帧，继承正式封面风格并按视频要求生成"
                            }
                          >
                            {continuityCheckingByShot[shot.shotNo] ===
                              "video" ||
                            rerenderingShotNos.includes(shot.shotNo) ||
                            generatingVideoShotNos.includes(shot.shotNo) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Video className="h-3 w-3" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {boardTimeline ? (
                  <StoryboardEditRow
                    timeline={boardTimeline}
                    shots={storyboardEditShots}
                    selectedShotNo={selectedShotNo}
                    onSelectShot={selectMatrixShot}
                    columnSpan={shots.length}
                    shotActions={storyboardEditShotActions}
                  />
                ) : null}

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
                {matrixShotEntries.entries.map(({ shot, originalIndex }) => {
                  const index = originalIndex;
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
                  const mediaShotIdentity =
                    insertStableShotId ?? shotTimelineId;
                  const mediaExpanded = storyboardMediaShotExpanded(
                    selectedStoryboardMedia,
                    mediaShotIdentity
                  );
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
                  const selectedPlayableTakes = playableTakes.filter(
                    take =>
                      take.isTimelineSelected ||
                      creationShot?.selectedVideoTake?.id === take.id
                  );
                  const unselectedPlayableTakes = playableTakes.filter(
                    take => !selectedPlayableTakes.includes(take)
                  );
                  const videoCandidatesExpanded = Boolean(
                    expandedVideoCandidatesByShot[mediaShotIdentity]
                  );
                  const isSubmittingVideo =
                    rerenderingShotNos.includes(shot.shotNo) ||
                    generatingVideoShotNos.includes(shot.shotNo);
                  const isCheckingVideoContinuity =
                    continuityCheckingByShot[shot.shotNo] === "video";
                  const isAwaitingVideoContinuityChoice =
                    continuityDialog?.renderKind === "video" &&
                    continuityDialog.shotLabel === displayShotCode(shot);
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
                  const candidateSheetIds = new Set(
                    frameImages
                      .filter(frame =>
                        isFrameCandidateSheet(
                          frame,
                          creationShot?.promptRun?.imageId
                        )
                      )
                      .map(frame => frame.id)
                  );
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
                      data-storyboard-shot-no={shot.shotNo}
                      data-storyboard-media-drop-target={displayShotCode(shot)}
                      data-storyboard-media-expanded={mediaExpanded}
                      onClickCapture={() => {
                        if (compactShots) {
                          setCompactExpandedShotNo(shot.shotNo);
                          onSelectShot?.(shot.shotNo);
                        }
                      }}
                      className={`relative min-w-0 border-b border-r p-2 transition-[height] duration-200 ${
                        mediaExpanded ? "h-[164px]" : "h-[75px]"
                      }`}
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
                        className={`flex items-center gap-1 overflow-x-auto overflow-y-hidden transition-[height] duration-200 custom-scrollbar ${
                          mediaExpanded ? "h-[148px]" : "h-[59px]"
                        }`}
                        data-storyboard-media-layout="start-end-strip"
                        data-storyboard-media-height={
                          mediaExpanded ? "expanded" : "compact"
                        }
                      >
                        {isSubmittingVideo ? (
                          <div
                            className="flex h-[59px] w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm bg-amber-500/10 px-1 text-amber-700 dark:text-amber-300"
                            data-video-take-stage="submitting"
                            role="status"
                            aria-live="polite"
                            title={
                              isAwaitingVideoContinuityChoice
                                ? "请在弹窗中选择本次视频要遵循的人物版本"
                                : isCheckingVideoContinuity
                                  ? "正在比较脸、发型和服饰"
                                  : "正在保存镜头信息并提交视频任务"
                            }
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="text-[7px] font-semibold">
                              {isAwaitingVideoContinuityChoice
                                ? "等待确认"
                                : isCheckingVideoContinuity
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
                          const statusLabel =
                            (failed
                              ? videoTakeFailureLabel(take.errorMessage)
                              : null) ?? progress.label;
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
                              aria-label={`${displayShotCode(shot)} Take ${take.id} ${statusLabel}`}
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
                                {statusLabel}
                              </span>
                              <span className="max-w-full truncate font-mono text-[6px] opacity-75">
                                #{take.id}
                              </span>
                            </button>
                          );
                        })}
                        {frameImages.map((frame, frameIndex) => {
                          if (
                            candidateSheetIds.has(frame.id) &&
                            onPromoteFrameCrop
                          ) {
                            const promoting =
                              promotingFrameCropShotNo === shot.shotNo;
                            const deleting = updatingFrameImageId === frame.id;
                            const candidateManageInput =
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
                              <ContextMenu.Root
                                key={`frame-candidates-${frame.id}`}
                              >
                                <ContextMenu.Trigger asChild>
                                  <div
                                    className={`relative order-2 flex h-full shrink-0 items-center gap-1 pr-6 ${
                                      deleting ? "opacity-45" : ""
                                    }`}
                                    role="group"
                                    aria-label={`${displayShotCode(shot)} 四张图片候选`}
                                    title="右键可删除这组候选"
                                  >
                                    {FRAME_QUADRANTS.map(
                                      (candidate, candidateIndex) => {
                                        const candidateTarget = {
                                          shotIdentity: mediaShotIdentity,
                                          kind: "candidate",
                                          id: `${frame.id}:${candidate.value}`,
                                        } satisfies StoryboardMediaSelectionTarget;
                                        const candidateSelected =
                                          isStoryboardMediaSelected(
                                            selectedStoryboardMedia,
                                            candidateTarget
                                          );
                                        return (
                                          <button
                                            key={candidate.value}
                                            type="button"
                                            disabled={promoting || deleting}
                                            onClick={() => {
                                              selectStoryboardMedia(
                                                candidateTarget,
                                                shot.shotNo
                                              );
                                              void promoteStoryboardFrameCandidate(
                                                {
                                                  shot,
                                                  shotIdentity:
                                                    mediaShotIdentity,
                                                  imageId: frame.id,
                                                  imageUrl: frame.imageUrl,
                                                  quadrant: candidate.value,
                                                }
                                              );
                                            }}
                                            onMouseEnter={event =>
                                              showImageHoverPreview(
                                                event,
                                                frame.imageUrl,
                                                `${displayShotCode(shot)} 候选 ${candidateIndex + 1}`,
                                                storyboardCandidateImageStyle(
                                                  candidate.value
                                                )
                                              )
                                            }
                                            onMouseLeave={() =>
                                              setHoveredImagePreview(null)
                                            }
                                            onFocus={event =>
                                              showImageHoverPreview(
                                                event,
                                                frame.imageUrl,
                                                `${displayShotCode(shot)} 候选 ${candidateIndex + 1}`,
                                                storyboardCandidateImageStyle(
                                                  candidate.value
                                                )
                                              )
                                            }
                                            onBlur={() =>
                                              setHoveredImagePreview(null)
                                            }
                                            className={`relative shrink-0 overflow-hidden rounded-sm border bg-muted text-left transition-[width,height,border-color,box-shadow] duration-200 hover:border-[var(--nayin-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-55 ${
                                              candidateSelected
                                                ? "h-[148px] w-[148px] border-[var(--nayin-accent)] ring-2 ring-[var(--nayin-accent)] ring-offset-1 ring-offset-background shadow-md"
                                                : "h-[59px] w-[59px] border-[var(--nayin-accent)]/40"
                                            }`}
                                            aria-label={`采用 ${displayShotCode(shot)} 候选 ${candidateIndex + 1}`}
                                            aria-pressed={candidateSelected}
                                            data-storyboard-media-selected={
                                              candidateSelected
                                            }
                                            title={`${candidate.label}候选 · ${candidateSelected ? "已选中" : "点击设为当前主图"}`}
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
                                            <StoryboardMediaSelectionIndicator
                                              selected={candidateSelected}
                                            />
                                            {promoting ? (
                                              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                              </span>
                                            ) : null}
                                          </button>
                                        );
                                      }
                                    )}
                                    {candidateManageInput &&
                                    onDeleteStoryImage ? (
                                      <button
                                        type="button"
                                        disabled={deleting || promoting}
                                        onClick={event => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void deleteStoryboardFrame(
                                            candidateManageInput
                                          );
                                        }}
                                        className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-sm bg-black/72 text-white shadow-sm transition-colors hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-45"
                                        aria-label={`删除 ${displayShotCode(shot)} 这组候选`}
                                        title="删除这组候选"
                                      >
                                        {deleting ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Trash2 className="h-3 w-3" />
                                        )}
                                      </button>
                                    ) : null}
                                  </div>
                                </ContextMenu.Trigger>
                                <ContextMenu.Portal>
                                  <ContextMenu.Content
                                    className="z-[90] min-w-[178px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                                    data-testid={`storyboard-candidate-menu-${frame.id}`}
                                  >
                                    <ContextMenu.Item
                                      disabled={
                                        !candidateManageInput ||
                                        !onDeleteStoryImage ||
                                        deleting ||
                                        promoting
                                      }
                                      onSelect={() => {
                                        if (!candidateManageInput) return;
                                        void deleteStoryboardFrame(
                                          candidateManageInput
                                        );
                                      }}
                                      className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs text-destructive outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-destructive/10 data-[disabled]:opacity-45"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      删除这组候选
                                    </ContextMenu.Item>
                                  </ContextMenu.Content>
                                </ContextMenu.Portal>
                              </ContextMenu.Root>
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
                          const imageEditTarget =
                            creationShot && insertStableShotId
                              ? imageClipEditorTargetForShot({
                                  shot: creationShot,
                                  stableShotId: insertStableShotId,
                                  imageId: frame.id,
                                  imageUrl: frame.imageUrl,
                                  label: `${displayShotCode(shot)} · ${frameRole}`,
                                })
                              : null;
                          const imageTarget = {
                            shotIdentity: mediaShotIdentity,
                            kind: "image",
                            id: frame.id,
                          } satisfies StoryboardMediaSelectionTarget;
                          const imageSelected = isStoryboardMediaSelected(
                            selectedStoryboardMedia,
                            imageTarget
                          );
                          return (
                            <div
                              key={`frame-${frame.id}`}
                              className={`relative order-3 shrink-0 transition-[width,height] duration-200 ${
                                imageSelected
                                  ? "h-[148px] w-[148px]"
                                  : "h-[59px] w-[59px]"
                              }`}
                            >
                              <ContextMenu.Root>
                                <ContextMenu.Trigger asChild>
                                  <button
                                    type="button"
                                    draggable={Boolean(
                                      insertStableShotId && onMoveStoryImage
                                    )}
                                    data-storyboard-frame-role={frameRole}
                                    className={`relative h-full w-full overflow-hidden rounded-sm bg-muted text-left transition-[box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                                      imageSelected
                                        ? "ring-2 ring-[var(--nayin-accent)] ring-offset-1 ring-offset-background shadow-md"
                                        : ""
                                    } ${
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
                                          sourceStableShotId:
                                            insertStableShotId,
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
                                        selectStoryboardMedia(
                                          imageTarget,
                                          shot.shotNo
                                        );
                                      })
                                    }
                                    onMouseEnter={event =>
                                      showImageHoverPreview(
                                        event,
                                        frame.imageUrl,
                                        `${displayShotCode(shot)} ${frameRole}`
                                      )
                                    }
                                    onMouseLeave={() =>
                                      setHoveredImagePreview(null)
                                    }
                                    onFocus={event =>
                                      showImageHoverPreview(
                                        event,
                                        frame.imageUrl,
                                        `${displayShotCode(shot)} ${frameRole}`
                                      )
                                    }
                                    onBlur={() => setHoveredImagePreview(null)}
                                    onDoubleClick={event => {
                                      cancelDeferredVideoSingleClick();
                                      if (!onEditImage || !imageEditTarget) {
                                        return;
                                      }
                                      event.preventDefault();
                                      event.stopPropagation();
                                      onEditImage(imageEditTarget);
                                    }}
                                    aria-label={`查看 ${displayShotCode(shot)} ${frameRole}`}
                                    aria-pressed={imageSelected}
                                    data-storyboard-media-selected={
                                      imageSelected
                                    }
                                    title={`${frameRole} · 图片 #${frame.id} · ${imageSelected ? "已选中" : "点击选中并放大"} · 双击编辑 · 可右键设置角色，可拖到其他镜头`}
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
                                    <StoryboardMediaSelectionIndicator
                                      selected={imageSelected}
                                    />
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
                              {canManageFrame && onDeleteStoryImage ? (
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (!manageInput) return;
                                    void deleteStoryboardFrame(manageInput);
                                  }}
                                  className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-sm bg-black/72 text-white shadow-sm transition-colors hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-45"
                                  aria-label={`删除 ${displayShotCode(shot)} 图片 #${frame.id}`}
                                  title={`删除图片 #${frame.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              ) : null}
                              {imageSelected && onGenerateShotImages ? (
                                <button
                                  type="button"
                                  disabled={
                                    isUpdating ||
                                    imageEditSubmitting ||
                                    !imageProviderStatus?.ready ||
                                    !canStartRenderForShot(shot.shotNo)
                                  }
                                  onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setImageEditInstruction("");
                                    setImageEditDialog({
                                      shotNo: shot.shotNo,
                                      shotIndex: index,
                                      imageId: frame.id,
                                      imageUrl: frame.imageUrl,
                                      label: `${displayShotCode(shot)} · ${frameRole}`,
                                    });
                                  }}
                                  className="absolute bottom-0.5 right-0.5 z-10 flex h-6 items-center gap-1 rounded-sm bg-[var(--nayin-accent)] px-1.5 text-[9px] font-semibold text-background shadow-sm transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-45"
                                  aria-label={`基于 ${displayShotCode(shot)} 当前图像修改`}
                                  title="保留当前图像，基于它生成并升级一个新版本"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  修改这张
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                        {timelineVisualClips.map((clip, clipIndex) => {
                          const poster = `/api/video-frames/${clip.takeId}?atSec=${clip.sourceStartSec.toFixed(3)}&rangeId=${clip.rangeId}`;
                          const removalKey = `clip-${clip.id}`;
                          const isRemoving = removingVideoKey === removalKey;
                          const sourceTake = creationShot?.videoTakes?.find(
                            item => item.id === clip.takeId
                          );
                          const videoEditTarget = insertStableShotId
                            ? videoClipEditorTargetForVisualClip({
                                stableShotId: insertStableShotId,
                                shotNo: shot.shotNo,
                                cueCode: shot.cueCode,
                                label: `${displayShotCode(shot)} · ${clip.label}`,
                                clip,
                                timelineItem: creationShot?.timelineItem,
                                mediaDurationSec: sourceTake?.durationSec,
                                posterUrl: poster,
                              })
                            : null;
                          const clipTarget = {
                            shotIdentity: mediaShotIdentity,
                            kind: "video",
                            id: `clip-${clip.id}`,
                          } satisfies StoryboardMediaSelectionTarget;
                          const clipSelected = isStoryboardMediaSelected(
                            selectedStoryboardMedia,
                            clipTarget
                          );
                          return (
                            <Fragment key={`timeline-clip-${clip.id}`}>
                              <ContextMenu.Root>
                                <ContextMenu.Trigger asChild>
                                  <button
                                    type="button"
                                    className={`relative order-4 shrink-0 overflow-hidden rounded-sm bg-muted text-left transition-[width,height,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                                      clipSelected
                                        ? "h-[148px] w-[148px] ring-2 ring-[var(--nayin-accent)] ring-offset-1 ring-offset-background shadow-md"
                                        : "h-[59px] w-[59px]"
                                    } ${isRemoving ? "opacity-45" : ""}`}
                                    onClick={() =>
                                      deferVideoSingleClick(() => {
                                        selectStoryboardMedia(
                                          clipTarget,
                                          shot.shotNo
                                        );
                                      })
                                    }
                                    onDoubleClick={event => {
                                      cancelDeferredVideoSingleClick();
                                      if (!onEditVideo || !videoEditTarget) {
                                        return;
                                      }
                                      event.preventDefault();
                                      event.stopPropagation();
                                      onEditVideo(videoEditTarget);
                                    }}
                                    aria-label={`播放 ${displayShotCode(shot)} ${clip.label}`}
                                    aria-pressed={clipSelected}
                                    data-storyboard-media-selected={
                                      clipSelected
                                    }
                                    title={`${clip.label} · ${clipSelected ? "已选中" : "点击选中并放大"} · 双击编辑 · 右键可移除`}
                                  >
                                    <StoryboardVideoThumbnail
                                      src={clip.videoUrl}
                                      poster={poster}
                                      active={clipSelected}
                                      label={`${displayShotCode(shot)} ${clip.label}`}
                                      className="h-full w-full object-cover"
                                    />
                                    <StoryboardMediaSelectionIndicator
                                      selected={clipSelected}
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
                                        if (
                                          !onCopyVideo ||
                                          !insertStableShotId
                                        ) {
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
                                            setSelectedStoryboardMedia(
                                              current =>
                                                isStoryboardMediaSelected(
                                                  current,
                                                  clipTarget
                                                )
                                                  ? null
                                                  : current
                                            );
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
                            </Fragment>
                          );
                        })}
                        {unselectedPlayableTakes.length > 0 ? (
                          <button
                            type="button"
                            className="order-2 flex h-[59px] min-w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm border border-dashed border-emerald-500/35 bg-emerald-500/5 px-1 text-emerald-700 transition-colors hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 dark:text-emerald-300"
                            aria-expanded={videoCandidatesExpanded}
                            aria-label={`${displayShotCode(shot)} 待选择视频 ${unselectedPlayableTakes.length} 个`}
                            title="这些视频仍属于当前镜头，点击展开查看"
                            onClick={() =>
                              setExpandedVideoCandidatesByShot(current => ({
                                ...current,
                                [mediaShotIdentity]: !videoCandidatesExpanded,
                              }))
                            }
                          >
                            <Video className="h-3.5 w-3.5" />
                            <span className="text-[7px] font-semibold">
                              {videoCandidatesExpanded
                                ? "收起候选"
                                : `待选择 ${unselectedPlayableTakes.length}`}
                            </span>
                          </button>
                        ) : null}
                        {(timelineVisualClips.length > 0
                          ? videoCandidatesExpanded
                            ? unselectedPlayableTakes
                            : []
                          : videoCandidatesExpanded
                            ? playableTakes
                            : selectedPlayableTakes
                        ).map(take => {
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
                          const videoEditTarget = insertStableShotId
                            ? videoClipEditorTargetForTake({
                                stableShotId: insertStableShotId,
                                shotNo: shot.shotNo,
                                cueCode: shot.cueCode,
                                label: `${displayShotCode(shot)} · Take ${take.id}`,
                                take,
                                timelineItem: creationShot?.timelineItem,
                                posterUrl: poster,
                              })
                            : null;
                          const takeTarget = {
                            shotIdentity: mediaShotIdentity,
                            kind: "video",
                            id: `take-${take.id}`,
                          } satisfies StoryboardMediaSelectionTarget;
                          const takeMediaSelected = isStoryboardMediaSelected(
                            selectedStoryboardMedia,
                            takeTarget
                          );
                          return (
                            <Fragment key={`take-${take.id}`}>
                              <ContextMenu.Root>
                                <ContextMenu.Trigger asChild>
                                  <button
                                    type="button"
                                    draggable={Boolean(
                                      insertStableShotId && onMoveVideoTake
                                    )}
                                    className={`relative order-1 shrink-0 overflow-hidden rounded-sm bg-muted text-left transition-[width,height,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                                      takeMediaSelected
                                        ? "h-[148px] w-[148px] ring-2 ring-[var(--nayin-accent)] ring-offset-1 ring-offset-background shadow-md"
                                        : "h-[59px] w-[59px]"
                                    } ${
                                      movingVideoTakeId === take.id ||
                                      isRemoving
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
                                          sourceStableShotId:
                                            insertStableShotId,
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
                                        selectStoryboardMedia(
                                          takeTarget,
                                          shot.shotNo
                                        );
                                        if (insertStableShotId) {
                                          setPreviewVideoTakeByShot(
                                            current => ({
                                              ...current,
                                              [insertStableShotId]: take.id,
                                            })
                                          );
                                        }
                                      })
                                    }
                                    onDoubleClick={event => {
                                      cancelDeferredVideoSingleClick();
                                      if (!onEditVideo || !videoEditTarget) {
                                        return;
                                      }
                                      event.preventDefault();
                                      event.stopPropagation();
                                      onEditVideo(videoEditTarget);
                                    }}
                                    aria-label={`播放 ${displayShotCode(shot)} Take ${take.id}`}
                                    aria-pressed={takeMediaSelected}
                                    data-storyboard-media-selected={
                                      takeMediaSelected
                                    }
                                    title={`${progress.label} · Take ${take.id} · ${takeMediaSelected ? "已选中" : "点击选中并放大"} · 双击编辑 · 可拖动`}
                                    data-video-take-stage={progress.stage}
                                    data-video-take-id={take.id}
                                  >
                                    <StoryboardVideoThumbnail
                                      src={take.videoUrl}
                                      poster={poster}
                                      active={
                                        takeMediaSelected ||
                                        (selected &&
                                          (selectedTake || previewSelected))
                                      }
                                      label={`${displayShotCode(shot)} Take ${take.id}`}
                                      className="h-full w-full object-cover"
                                    />
                                    <StoryboardMediaSelectionIndicator
                                      selected={takeMediaSelected}
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
                                        if (
                                          !onCopyVideo ||
                                          !insertStableShotId
                                        ) {
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
                                            setSelectedStoryboardMedia(
                                              current =>
                                                isStoryboardMediaSelected(
                                                  current,
                                                  takeTarget
                                                )
                                                  ? null
                                                  : current
                                            );
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
                            </Fragment>
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
                                selectedPlayableTakes.length === 0 &&
                                unselectedPlayableTakes.length === 0
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
                              selectedPlayableTakes.length === 0 &&
                              unselectedPlayableTakes.length === 0 ? (
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

                {STORYBOARD_MATRIX_VISIBLE_ROWS.map(row => (
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
                      <div className="flex items-center justify-between gap-1">
                        <span className="block">{row.label}</span>
                        {isStoryboardVersionedField(row.field) ? (
                          <StoryboardFieldVersionSelect
                            label={row.label}
                            track={
                              storyboardFieldVersions?.tracks[row.field] ?? {
                                currentRevision: 0,
                                history: [],
                              }
                            }
                            restoring={restoringStoryboardField === row.field}
                            onRestore={revision => {
                              if (!onRestoreStoryboardFieldVersion) return;
                              const field =
                                row.field as StoryboardVersionedField;
                              setRestoringStoryboardField(field);
                              void onRestoreStoryboardFieldVersion(
                                field,
                                revision
                              )
                                .then(() =>
                                  toast.success(
                                    `${row.label}已恢复到 V${revision}，并保存为新版本`
                                  )
                                )
                                .catch(error =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : `${row.label}版本恢复失败`
                                  )
                                )
                                .finally(() =>
                                  setRestoringStoryboardField(current =>
                                    current === field ? null : current
                                  )
                                );
                            }}
                          />
                        ) : null}
                      </div>
                      {row.description ? (
                        <span className="mt-1 block text-[8px] font-normal leading-tight text-muted-foreground/70">
                          {row.description}
                        </span>
                      ) : null}
                    </div>
                    {matrixShotEntries.entries.map(({ shot, originalIndex }) => {
                      const index = originalIndex;
                      const selected = selectedShotNo === shot.shotNo;
                      const creationShot = creationShotByNo.get(shot.shotNo);
                      const dropTarget =
                        matrixDropTarget?.targetIndex === index &&
                        matrixDropTarget.field === row.field;
                      const shotLabel = displayShotCode(shot);
                      const stableShotId = storyShotInsertIdentity(shot, index);
                      const matrixVideoBlockReason = creationShot
                        ? storyboardVideoRenderBlockReason(
                            storyboardRenderShotWithDraft(
                              creationShot,
                              shot,
                              matrixDraftsRef.current.get(
                                storyShotInsertIdentity(shot, index) ?? ""
                              )
                            ),
                            {
                              ready: Boolean(shotVideoProviderStatus?.ready),
                              reason:
                                shotVideoProviderStatus?.missing
                                  .filter(Boolean)
                                  .join("、") || "视频模型状态尚未就绪",
                            }
                          )
                        : "还没有可渲染的镜头记录";
                      if (row.field === "dialogue") {
                        return (
                          <StoryboardVoiceCell
                            key={`matrix-dialogue-${stableShotId ?? shot.shotNo}-${index}`}
                            shot={shot}
                            shotLabel={shotLabel}
                            selected={selected}
                            editable={Boolean(onUpdateShotField)}
                            generating={Boolean(
                              stableShotId &&
                                generatingVoiceShotIds.includes(stableShotId)
                            )}
                            onFocus={() => onSelectShot?.(shot.shotNo)}
                            onCommit={(field, value) =>
                              onUpdateShotField?.(index, field, value)
                            }
                            onGenerate={
                              stableShotId && onGenerateShotVoice
                                ? text =>
                                    onGenerateShotVoice(stableShotId, text)
                                : undefined
                            }
                          />
                        );
                      }
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
                            refreshMatrixDraftGuards(current => current + 1);
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
                                  !imageProviderStatus?.ready ||
                                  !canStartRenderForShot(shot.shotNo)
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
                                aria-label={`按图片要求${isSheSelf02ImageEditTemplateEnabled(storyTitle, shotLabel) ? "并套用长裙连续性模板" : ""}渲染 ${shotLabel} 的四张候选图`}
                                title={
                                  imageProviderStatus?.ready
                                    ? shouldUseSingleImageFallback(
                                        imageProviderStatus
                                      )
                                      ? `${isSheSelf02ImageEditTemplateEnabled(storyTitle, shotLabel) ? "已启用长裙连续性模板；" : ""}四张候选通道刚刚超时；将生成一张完整单帧，提交前会显示费用`
                                      : `${isSheSelf02ImageEditTemplateEnabled(storyTitle, shotLabel) ? "已启用长裙连续性模板；" : ""}原文要求优先，生成四张同风格候选图，提交前会显示费用`
                                    : (imageProviderStatus?.reason ??
                                      "正在确认图片供应商状态")
                                }
                              >
                                {generatingImageShotNos.includes(shot.shotNo) ||
                                continuityCheckingByShot[shot.shotNo] ===
                                  "image" ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ImagePlus className="h-3 w-3" />
                                )}
                                {continuityCheckingByShot[shot.shotNo] ===
                                "image"
                                  ? "检查人物"
                                  : shouldUseSingleImageFallback(
                                        imageProviderStatus
                                      )
                                    ? "渲染 1 张"
                                    : "渲染 4 张"}
                                {isSheSelf02ImageEditTemplateEnabled(
                                  storyTitle,
                                  shotLabel
                                )
                                  ? " · 长裙模板"
                                  : ""}
                              </button>
                            ) : row.field === "videoPrompt" &&
                              creationShot &&
                              (onGenerateShotVideo ||
                                (onEstimateStartEndShotVideo &&
                                  onGenerateStartEndShotVideo)) ? (
                              <div className="flex w-full flex-col gap-1">
                                <div className="flex flex-col gap-1">
                                  <label className="sr-only" htmlFor={`shot-${shot.shotNo}-duration`}>
                                    {`${shotLabel} 视频时长（秒）`}
                                  </label>
                                  <select
                                    id={`shot-${shot.shotNo}-duration`}
                                    value={
                                      startEndTuningOverrides[
                                        creationShot.stableShotId ??
                                          creationShot.shotIdentity ??
                                          ""
                                      ]?.durationSec ??
                                      storyboardStartEndDurationSec(
                                        creationShot.generationParams,
                                        creationShot.durationMs
                                      )
                                    }
                                    disabled={!onUpdateShotFields}
                                    onPointerDown={event => event.stopPropagation()}
                                    onClick={event => event.stopPropagation()}
                                    onChange={event => {
                                      event.stopPropagation();
                                      void updateStartEndTuning(creationShot, {
                                        durationSec: Number(event.target.value),
                                      });
                                    }}
                                    className="h-6 w-full min-w-0 rounded-sm border border-border bg-background px-1 text-[9px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-55"
                                    title="首尾帧视频时长；Vidu Q2 单次上限 8 秒"
                                  >
                                    {STORYBOARD_START_END_DURATION_OPTIONS.map(seconds => (
                                      <option key={seconds} value={seconds}>
                                        {`${seconds} 秒`}
                                      </option>
                                    ))}
                                  </select>
                                  <label className="sr-only" htmlFor={`shot-${shot.shotNo}-amplitude`}>
                                    {`${shotLabel} 运动幅度`}
                                  </label>
                                  <select
                                    id={`shot-${shot.shotNo}-amplitude`}
                                    value={
                                      startEndTuningOverrides[
                                        creationShot.stableShotId ??
                                          creationShot.shotIdentity ??
                                          ""
                                      ]?.movementAmplitude ??
                                      storyboardStartEndAmplitude(
                                        creationShot.generationParams
                                      )
                                    }
                                    disabled={!onUpdateShotFields}
                                    onPointerDown={event => event.stopPropagation()}
                                    onClick={event => event.stopPropagation()}
                                    onChange={event => {
                                      event.stopPropagation();
                                      void updateStartEndTuning(creationShot, {
                                        movementAmplitude: event.target
                                          .value as StoryboardStartEndAmplitude,
                                      });
                                    }}
                                    className="h-6 w-full min-w-0 rounded-sm border border-border bg-background px-1 text-[9px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-55"
                                    title="画面运动幅度；变形大的镜头选「大」"
                                  >
                                    {STORYBOARD_START_END_AMPLITUDE_OPTIONS.map(option => (
                                      <option key={option.value} value={option.value}>
                                        {`幅度 ${option.label}`}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              <button
                                type="button"
                                disabled={
                                  Boolean(matrixVideoBlockReason) ||
                                  !canStartRenderForShot(shot.shotNo)
                                }
                                onPointerDown={event => event.stopPropagation()}
                                onClick={event => {
                                  event.stopPropagation();
                                  void rerenderShotVideo(shot, creationShot);
                                }}
                                className="inline-flex h-6 w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-background px-2 text-[9px] font-semibold text-foreground transition hover:border-[var(--nayin-accent)] hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-55"
                                aria-label={`按视频要求渲染 ${shotLabel} 视频`}
                                title={
                                  matrixVideoBlockReason ??
                                  "先保存本镜文字并确认人民币费用，再生成候选 Take"
                                }
                              >
                                {continuityCheckingByShot[shot.shotNo] ===
                                "video" ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : rerenderingShotNos.includes(shot.shotNo) ||
                                  generatingVideoShotNos.includes(
                                    shot.shotNo
                                  ) ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Video className="h-3 w-3" />
                                )}
                                {continuityCheckingByShot[shot.shotNo] ===
                                "video"
                                  ? "检查人物"
                                  : "渲染视频"}
                              </button>
                              </div>
                            ) : null
                          }
                        />
                      );
                    })}
                  </Fragment>
                ))}

                <div
                  role="rowheader"
                  className="sticky left-0 z-20 border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--panel-border) 62%, transparent)",
                    background: "var(--background)",
                  }}
                >
                  <span className="block">预计费用</span>
                  <span className="mt-1 block text-[8px] font-normal leading-tight text-muted-foreground/70">
                    当前图片与视频链路 · 提交前仍会确认
                  </span>
                </div>
                {shots.map(shot => (
                  <StoryboardCostCell
                    key={`matrix-cost-${shot.stableShotId ?? shot.shotIdentity ?? shot.shotNo}`}
                    selected={selectedShotNo === shot.shotNo}
                    estimate={storyboardShotCostEstimate(
                      creationShotByNo.get(shot.shotNo),
                      {
                        singleImageFallback:
                          shouldUseSingleImageFallback(imageProviderStatus),
                      }
                    )}
                  />
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
      {publishingCoverReferenceDialog
        ? createPortal(
            <div
              className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="storyboard-cover-reference-title"
              data-testid="storyboard-cover-reference-dialog"
            >
              <div className="w-full max-w-lg rounded-lg border border-border bg-background p-4 shadow-2xl">
                <h2
                  id="storyboard-cover-reference-title"
                  className="text-sm font-semibold text-foreground"
                >
                  选择这组画面的封面风格
                </h2>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  当前镜头还没有底图。选一张属于这个故事的封面候选，只作为本次静态画面的风格参考；不会自动采用正式封面，也不会改动视频。
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {inheritedPublishingCoverCandidates.map(candidate => {
                    const selected =
                      candidate.id === selectedPublishingCoverCandidateId;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        className={`overflow-hidden rounded-md border bg-muted/20 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
                          selected
                            ? "border-[var(--nayin-accent)] ring-2 ring-[var(--nayin-accent)]/20"
                            : "border-border hover:border-[var(--nayin-accent)]/55"
                        }`}
                        onClick={() =>
                          setSelectedPublishingCoverCandidateId(candidate.id)
                        }
                        aria-pressed={selected}
                        aria-label={`选择封面候选 ${candidate.id}`}
                      >
                        <img
                          src={candidate.imageUrl}
                          alt=""
                          className="aspect-[3/4] w-full object-cover"
                        />
                        <span className="block truncate px-2 py-1.5 text-[10px] text-muted-foreground">
                          候选 #{candidate.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border px-3 text-[11px] text-muted-foreground transition hover:text-foreground"
                    onClick={() => {
                      setPublishingCoverReferenceDialog(null);
                      setSelectedPublishingCoverCandidateId(null);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nayin-accent)] px-3 text-[11px] font-medium text-background transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={selectedPublishingCoverCandidateId == null}
                    onClick={() =>
                      void continueWithPublishingCoverCandidate()
                    }
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    用作风格参考并继续
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {imageEditDialog
        ? createPortal(
            <div
              className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="storyboard-image-edit-title"
            >
              <div className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-2xl">
                <div className="flex items-start gap-3">
                  <img
                    src={imageEditDialog.imageUrl}
                    alt={imageEditDialog.label}
                    className="h-16 w-16 shrink-0 rounded-md object-cover"
                  />
                  <div className="min-w-0">
                    <h2
                      id="storyboard-image-edit-title"
                      className="text-sm font-semibold text-foreground"
                    >
                      基于当前图像修改
                    </h2>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {imageEditDialog.label} · 图片 #{imageEditDialog.imageId}{" "}
                      · 原图会保留，生成结果会成为新版本
                    </p>
                  </div>
                </div>
                <textarea
                  autoFocus
                  value={imageEditInstruction}
                  onChange={event =>
                    setImageEditInstruction(event.target.value)
                  }
                  onKeyDown={event => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      void submitSelectedImageEdit();
                    }
                  }}
                  placeholder="例如：保留人物和构图，把红色空间改成更深的暗红，增加压迫感。"
                  className="mt-4 min-h-24 w-full resize-y rounded-md border border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                  disabled={imageEditSubmitting}
                />
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  提交前会显示费用确认；不会覆盖当前图像，也不会自动改动视频。
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border px-3 text-[11px] text-muted-foreground transition hover:text-foreground disabled:opacity-45"
                    onClick={() => {
                      setImageEditDialog(null);
                      setImageEditInstruction("");
                    }}
                    disabled={imageEditSubmitting}
                  >
                    取消
                  </button>
                  {imageEditSubmitting ? (
                    <button
                      type="button"
                      className="h-8 rounded-md border border-[var(--nayin-accent)]/35 px-3 text-[11px] text-[var(--nayin-accent)] transition hover:bg-[var(--nayin-accent)]/8"
                      onClick={() => {
                        setImageEditDialog(null);
                        setImageEditInstruction("");
                      }}
                    >
                      后台运行
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nayin-accent)] px-3 text-[11px] font-medium text-background transition hover:brightness-105 disabled:cursor-wait disabled:opacity-45"
                    onClick={() => void submitSelectedImageEdit()}
                    disabled={
                      imageEditSubmitting || !imageEditInstruction.trim()
                    }
                  >
                    {imageEditSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    生成新版本
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {imageRenderMonitor
        ? createPortal(
            <aside
              className={`fixed bottom-4 right-4 z-[150] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur ${
                imageRenderMonitor.status === "success"
                  ? "cursor-pointer transition hover:border-[var(--nayin-accent)]/50 hover:shadow-[0_12px_35px_-18px_var(--nayin-accent)]"
                  : ""
              }`}
              aria-live="polite"
              aria-label="图片渲染监控"
              data-testid="storyboard-image-render-monitor"
              role={
                imageRenderMonitor.status === "success" ? "button" : undefined
              }
              tabIndex={imageRenderMonitor.status === "success" ? 0 : undefined}
              onClick={() => {
                if (imageRenderMonitor.status !== "success") return;
                setPreviewMedia({
                  kind: "image",
                  url: imageRenderMonitor.imageUrl,
                  label: `${imageRenderMonitor.label} · 新版本`,
                });
              }}
              onKeyDown={event => {
                if (
                  imageRenderMonitor.status === "success" &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  setPreviewMedia({
                    kind: "image",
                    url: imageRenderMonitor.imageUrl,
                    label: `${imageRenderMonitor.label} · 新版本`,
                  });
                }
              }}
            >
              <div className="flex items-start gap-2.5">
                <img
                  src={imageRenderMonitor.imageUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {imageRenderMonitor.status === "running"
                        ? "图片正在后台渲染"
                        : imageRenderMonitor.status === "success"
                          ? "图片渲染完成"
                          : "图片渲染失败"}
                    </p>
                    <button
                      type="button"
                      aria-label="关闭渲染提醒"
                      className="shrink-0 text-muted-foreground transition hover:text-foreground"
                      onClick={event => {
                        event.stopPropagation();
                        setImageRenderMonitor(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {imageRenderMonitor.label}
                  </p>
                </div>
              </div>
              {imageRenderMonitor.status === "running" ? (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--nayin-accent)] transition-[width] duration-700"
                      style={{
                        width: `${Math.min(
                          94,
                          Math.max(
                            4,
                            ((imageRenderMonitorNow -
                              imageRenderMonitor.startedAt) /
                              (imageRenderMonitor.estimatedSeconds * 1_000)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    预计还需约{" "}
                    {Math.max(
                      1,
                      Math.ceil(
                        imageRenderMonitor.estimatedSeconds -
                          (imageRenderMonitorNow -
                            imageRenderMonitor.startedAt) /
                            1_000
                      )
                    )}{" "}
                    秒 · 你可以继续编辑其他内容
                  </p>
                </>
              ) : (
                <p
                  className={`mt-2 text-[10px] ${
                    imageRenderMonitor.status === "success"
                      ? "text-emerald-700"
                      : "text-destructive"
                  }`}
                >
                  {imageRenderMonitor.message ??
                    (imageRenderMonitor.status === "success"
                      ? "新版本已回到对应镜头"
                      : "请检查错误信息后再试")}
                </p>
              )}
            </aside>,
            document.body
          )
        : null}
      <StoryboardMediaPreviewDialog
        preview={previewMedia}
        onClose={() => setPreviewMedia(null)}
      />
      {hoveredImagePreview
        ? createPortal(
            <div
              role="tooltip"
              data-storyboard-hover-preview="image"
              className="pointer-events-none fixed z-[120] h-[280px] w-[280px] overflow-hidden rounded-md border border-border bg-black shadow-2xl"
              style={{
                left: hoveredImagePreview.left,
                top: hoveredImagePreview.top,
              }}
            >
              <img
                src={hoveredImagePreview.imageUrl}
                alt={hoveredImagePreview.label}
                className={
                  hoveredImagePreview.cropStyle
                    ? "absolute object-fill"
                    : "h-full w-full object-contain"
                }
                style={hoveredImagePreview.cropStyle}
              />
              <span className="absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-center text-[10px] text-white">
                {hoveredImagePreview.label}
              </span>
            </div>,
            document.body
          )
        : null}
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
