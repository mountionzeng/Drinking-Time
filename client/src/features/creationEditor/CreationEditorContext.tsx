import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { trpc } from "@/lib/trpc";
import { useTimelineCommands } from "./useTimelineCommands";
import type { NarrativeJob, StoryShot } from "@/features/storyAgent/types";
import {
  resolveEditCandidatePlans,
  type ShotFieldChange,
} from "@/features/storyAgent/editPromptCandidate";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { canonicalizeShotNo } from "@shared/imageAsset";
import {
  ensureShotIdentities,
  normalizeShotIdentity,
  shotIdentityMatchKeys,
  shotIdentityFromShot,
} from "@shared/shotIdentity";
import {
  rerenderShotImage,
  rerenderShotImageCandidates,
  type RerenderReference,
} from "./rerender";
import { MAX_SHOT_DURATION_MS, MIN_SHOT_DURATION_MS } from "./playback";
import { compilePromptRecipe } from "./promptTable/promptRecipe";
import type {
  PromptOverride,
  PromptOverrides,
  PromptRow,
  PromptRunRecord,
} from "./promptTable/types";
import type { FrameQuadrant } from "./video/frameCrop";
import type {
  ShotVideoProviderStatus,
  VideoTakeAsset,
  VideoTakeStatus,
} from "@shared/videoAsset";
import { isVideoTakeTerminal } from "@shared/videoAsset";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  timelineMsToFrames,

  type ShotMaterialState,
  type StoryMaterialState,
  type StoryTimelineItem,
  type StoryTimelineImageTextOverlay,
  type StoryTimelineOverlay,
  type StoryTimelineVisualLayerState,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "@shared/storyMaterial";
import {
  normalizePersistedVisualLayerState,
  resolveTimelineVisualLayerState,
  type ResolvedTimelineVisualLayerState,
  type TimelineVisualLayerAction,
} from "@shared/timelineVisualLayers";
import { visualTrackId } from "@shared/visualClipModel";
import {
  buildTimelineLayout,
  overlayVisualLayer,
  resolveTimelineFrame,
  type TimelineLayoutRow,
} from "@shared/timelineLayout";
import {
  createTimelineWriteLock,
  previewTimelineGroup as previewTimelineGroupFrom,
  resolveTimelineFrameSource as resolveTimelineFrameSourceFrom,
  type CreationTimelineFrameResolution,
  type TimelineGroupPreview,
  type TimelineResolverShot,
} from "@shared/timelineCommands";
import type { StoryPromptAggregate } from "@shared/promptLineage";
import type { VisualObjectRef } from "@shared/visualObject";
import type { ImageClipClipboardSnapshot } from "@shared/visualObjectClipboard";
import type { VisualEditOperationRef } from "@shared/visualEditReceipt";
import type { StoryShotCommandUpdate } from "@shared/storyContract";
import type { ImageProvider, ImageProviderStatus } from "@shared/imageProvider";
import type {
  VideoCropPath,
  VideoConformMode,
  VideoTargetAspectRatio,
} from "@shared/videoConform";
import {
  normalizeChatCutTimeline,
  type ChatCutTimelineManifest,
} from "./chatCutTimeline";
import type { ShotConsistencyAnalysis } from "@shared/shotConsistency";
import type {
  ShotDirectorResult,
  ShotVideoMotion,
  StoryShotEditableField,
} from "@shared/shotDirector";
import type { StartEndShotVideoEstimate } from "@shared/startEndVideo";
import {
  normalizeStoryboardFieldVersions,
  type StoryboardFieldVersions,
  type StoryboardVersionedField,
} from "@shared/storyboardFieldVersions";
import {
  buildPublishingVideoHandoff,
  type PublishingVideoHandoff,
} from "@/features/publishingDraft/publishingVideoHandoff";
import { resolveScopedPublishingHandoff } from "./publishingHandoffScope";
import { videoTakeIdsToRefresh } from "./videoAssetViewModel";
import {
  recordDeletedStoryShotUndo,
  recordInsertedStoryShotUndo,
  recordSplitStoryShotUndo,
  recordTimelineCommandUndo,
  recordTimelineUndoSnapshot,
  registerTimelineUndoExecutor,
  takeCreationEditorUndoEntry,
  trackCreationEditorOperation,
  waitForCreationEditorOperations,
} from "./timelineUndoStore";
import { addShotToRenderSlots, removeShotFromRenderSlots } from "./renderSlots";
import type {
  CreationEditorError,
  CreationEditorImage,
  CreationEditorShot,
  CreationEditorStory,
  ImportedStoryMaterialResult,
  StoryImageAdviceResult,
  StoryImageMaterialAdvice,
  VideoConformBatchResult,
} from "./types";

export type {
  CreationEditorError,
  CreationEditorImage,
  CreationEditorShot,
  CreationEditorStory,
  ImportedStoryMaterialResult,
  StoryImageAdviceResult,
  StoryImageMaterialAdvice,
  VideoConformBatchResult,
} from "./types";

export type { CreationTimelineFrameResolution } from "@shared/timelineCommands";

type CreationEditorContextValue = {
  stories: CreationEditorStory[];
  activeStoryId: number | null;
  setActiveStoryId: (storyId: number | null) => void;
  activeStory: CreationEditorStory | null;
  publishingHandoff: PublishingVideoHandoff | null;
  materialState: StoryMaterialState | null;
  chatCutTimeline: ChatCutTimelineManifest | null;
  promptLineageMode: "legacy" | "lineage";
  promptProjection: StoryPromptAggregate | null;
  storyboardFieldVersions: StoryboardFieldVersions;
  shots: CreationEditorShot[];
  timelineShotIds: string[];
  addShotToTimeline: (shotNo: number, stableShotId?: string | null) => void;
  removeShotFromTimeline: (shotId: string) => void;
  moveShotInTimeline: (shotId: string, direction: -1 | 1) => void;
  /** 把一个镜头整体拖到另一个镜头的位置上（故事版看板里的顺序重排）。 */
  reorderShotInTimeline: (
    sourceShotId: string,
    targetShotId: string
  ) => Promise<void>;
  /** 拖镜头本体：只移动这一镜，同方向的邻居原地不动。 */
  moveTimelineShot: (
    stableShotId: string,
    deltaFrames: number,
    snapThresholdFrames?: number,
    visualLayer?: number
  ) => Promise<{ applied: boolean; reason?: string }>;
  moveTimelineGroup: (
    sourceShotId: string,
    direction: "left" | "right",
    deltaFrames: number
  ) => Promise<{ applied: boolean; reason?: string }>;
  /**
   * Absolute rows for the current story, already resolved for gaps and
   * overlaps. Every surface should read placement from here.
   */
  timelineLayoutRows: TimelineLayoutRow[];
  /** 当前故事的时间线条目，绝对帧位置和锚点都在里面。 */
  timelineItems: StoryTimelineItem[];
  timelineOverlays: StoryTimelineOverlay[];
  /** 渲染形态：`count` 含派生的空白投放层，`explicitCount` 才是落库值。 */
  timelineVisualLayerState: ResolvedTimelineVisualLayerState;
  manageTimelineVisualLayer: (
    action: TimelineVisualLayerAction
  ) => Promise<void>;
  /** 方向批量移动的预览：这次会带上谁、被谁挡住。 */
  previewTimelineGroup: (
    sourceShotId: string,
    direction: "left" | "right"
  ) => TimelineGroupPreview;
  /** What the timeline actually shows at an absolute frame. */
  resolveTimelineFrameSource: (
    timelineFrame: number
  ) => CreationTimelineFrameResolution;
  /** True while a timeline write is in flight; conflicting edits are ignored. */
  timelineWritePending: boolean;
  /**
   * Create a position anchor at an absolute frame. The visible source is
   * resolved here rather than trusted from the caller, so a gap can never be
   * marked and the anchor always records the picture it locks.
   */
  addTimelineAnchorAtFrame: (
    timelineFrame: number
  ) => Promise<{ applied: boolean; reason?: string; anchorId?: string }>;
  removeTimelineAnchor: (
    stableShotId: string,
    anchorId: string
  ) => Promise<{ applied: boolean; reason?: string }>;
  trimTimelineItemEdge: (
    stableShotId: string,
    edge: "start" | "end",
    requestedBoundaryFrame: number
  ) => Promise<{ applied: boolean; reason?: string }>;
  rollTimelineJoin: (
    leftStableShotId: string,
    rightStableShotId: string,
    requestedBoundaryFrame: number
  ) => Promise<{ applied: boolean; reason?: string }>;
  detachTimelineMagnet: (
    leftStableShotId: string,
    rightStableShotId: string
  ) => Promise<{ applied: boolean; reason?: string }>;
  resetTimelineShots: () => void;
  selectedShotNo: number | null;
  setSelectedShotNo: (shotNo: number | null) => void;
  selectedShot: CreationEditorShot | null;
  isLoading: boolean;
  error: CreationEditorError | null;
  isSaving: boolean;
  rerenderingShotNos: readonly number[];
  rerenderError: string | null;
  promotingFrameCropShotNo: number | null;
  generatingVideoShotNos: readonly number[];
  generatingVoiceShotIds: readonly string[];
  generateShotVoice: (
    stableShotId: string,
    text: string
  ) => Promise<{ audioUrl: string; provider: string; voice: string }>;
  updateShotDuration: (shotNo: number, durationMs: number) => Promise<void>;
  updatePersistedShotField: (
    stableShotId: string,
    field: StoryShotEditableField,
    value: string
  ) => Promise<void>;
  updatePersistedShotFields: (
    stableShotId: string,
    patch: Partial<Record<StoryShotEditableField, string>>
  ) => Promise<void>;
  restoreStoryboardFieldVersion: (
    field: StoryboardVersionedField,
    revision: number
  ) => Promise<void>;
  /** 阶段 E：确认/放弃一条候选修订（划词编辑 / 聊天提议 / 直接编辑 / 手改产生的都走这里）。 */
  confirmPromptCandidate: (candidateRevisionId: number) => Promise<void>;
  rejectPromptCandidate: (candidateRevisionId: number) => Promise<void>;
  insertPersistedShotAfter: (
    stableShotId: string,
    dialogue?: string
  ) => Promise<number | null>;
  /** 新建一个独立普通镜头，并把它精确放到绝对帧和视觉层。 */
  insertTimelineShotAt: (input: {
    timelineFrame: number;
    visualLayer: number;
    dialogue?: string;
    referencedImageId?: number;
  }) => Promise<{ shotNo: number; stableShotId: string }>;
  commitInsertedTimelineShotUndo: (stableShotId: string) => void;
  discardPersistedShot: (stableShotId: string) => Promise<void>;
  deletePersistedShot: (stableShotId: string) => Promise<number | null>;
  updatePromptOverride: (
    shotNo: number,
    dimension: string,
    override: PromptOverride
  ) => Promise<void>;
  rerenderShot: (
    shotNo: number,
    rows: PromptRow[],
    reference?: RerenderReference,
    options?: {
      explicitInstruction?: string;
      exactFrameEdit?: boolean;
      candidateCount?: 4;
      costConfirmation?: {
        accepted: true;
        estimatedCny: number;
      };
      imageProvider?: ImageProvider;
      editMaskImageUrl?: string;
    }
  ) => Promise<{
    generatedCount: number;
    failedCount: number;
    imageId?: number;
    imageUrl?: string;
  }>;
  promoteFrameCrop: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => Promise<{ imageId: number; imageUrl: string }>;
  promoteStoryImage: (imageId: number) => Promise<void>;
  assignStoryImageToShot: (input: {
    imageId: number;
    targetStableShotId: string;
    preserveTimelineSelection?: boolean;
  }) => Promise<void>;
  deleteStoryImage: (imageId: number) => Promise<void>;
  deleteExtractedFrame: (imageId: number) => Promise<void>;
  importStoryMaterial: (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
    preserveTimelineSelection?: boolean;
  }) => Promise<ImportedStoryMaterialResult>;
  attachChatCutXml: (xml: string) => Promise<{
    primaryClipCount: number;
    audioClipCount: number;
    width: number;
    height: number;
  }>;
  adviseStoryImages: (input: {
    imageIds: number[];
  }) => Promise<StoryImageAdviceResult>;
  applyStoryImageAdvice: (input: {
    imageId: number;
    targetShotNo: number;
    targetStableShotId: string;
    reason?: string;
    videoDirection: StoryImageMaterialAdvice["videoDirection"];
  }) => Promise<void>;
  generateShotVideo: (input: {
    shotNo: number;
    imageId: number;
    characterReferenceImageUrl?: string;
    storyStyleReferenceImageUrl?: string;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: ShotVideoMotion;
    aspectRatio?: "1:1";
    directorPromptApproved?: boolean;
    rerenderRequestId?: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<{
    takeId: number;
    videoStatus: VideoTakeStatus;
    videoUrl?: string;
    taskId?: string;
    prompt: string;
    estimatedCny: number;
  }>;
  estimateStartEndShotVideo: (
    stableShotId: string
  ) => Promise<StartEndShotVideoEstimate>;
  generateStartEndShotVideo: (input: {
    shotNo: number;
    stableShotId: string;
    rerenderRequestId?: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<{
    takeId: number;
    videoStatus: VideoTakeStatus;
    videoUrl?: string;
    taskId?: string;
    prompt: string;
    estimatedCny: number;
  }>;
  analyzeShotVideoDirection: (input: {
    shotNo: number;
    stableShotId: string;
    draftPrompt: string;
    subtitle?: string;
  }) => Promise<ShotDirectorResult>;
  conformVideoTakes: (input: {
    items: Array<{
      takeId: number;
      stableShotId: string;
      mode: VideoConformMode;
      cropPath?: VideoCropPath;
    }>;
    targetAspectRatio: VideoTargetAspectRatio;
  }) => Promise<VideoConformBatchResult>;
  analyzeShotConsistency: (input: {
    anchorImageUrl?: string | null;
    targetImage?: {
      imageId: number;
      imageUrl: string;
      shotNo?: string | null;
    };
    maxShots?: number;
  }) => Promise<ShotConsistencyAnalysis>;
  refreshShotVideoStatus: (takeId: number) => Promise<void>;
  markVideoTakeUnusable: (
    takeId: number,
    sourceStoryId?: number | null
  ) => Promise<void>;
  moveVideoTake: (input: {
    takeId: number;
    targetStableShotId: string;
  }) => Promise<void>;
  adoptVideoTake: (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => Promise<void>;
  reuseVideoTake: (input: {
    sourceTakeId: number;
    targetStableShotId: string;
    plannedDurationSec: number;
  }) => Promise<{ takeId: number }>;
  appendTimelineVideoClip: (input: {
    sourceTakeId: number;
    targetStableShotId: string;
    sourceStartSec: number;
    sourceEndSec: number;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
    targetOffsetMs?: number;
  }) => Promise<void>;
  undoTimeline: () => Promise<boolean>;
  createVideoTakeRange: (input: {
    stableShotId: string;
    takeId: number;
    startSec: number;
    endSec: number;
    label?: string;
    useOnTimeline?: boolean;
  }) => Promise<void>;
  splitTimelineVideoClip: (input: {
    stableShotId: string;
    cutFrame: number;
    takeStableShotId: string;
    existingClipId?: string | null;
    takeId: number;
    videoUrl: string;
    sourceStartSec: number;
    sourceEndSec: number;
    splitSourceSec: number;
    offsetMs: number;
    durationMs: number;
    splitOffsetMs: number;
    label: string;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
    overlayId?: string;
  }) => Promise<void>;
  addTimelineImageClip: (input: {
    clipId?: string;
    timelineFrame: number;
    imageId: number;
    imageUrl: string;
    label: string;
    visualLayer?: number;
  }) => Promise<void>;
  /** 服务端权威抽帧：赢家、仓库备份、相邻层和落位都由一个可重放请求完成。 */
  extractTimelineFrame: (input: {
    timelineFrame: number;
    operationLayer: number;
  }) => Promise<void>;
  /** 唯一的素材移动命令：图片和视频共用，一次调用同时定轨道和起点。 */
  moveVisualClip: (input: {
    clipId: string;
    toTrackId: string;
    toStartFrame: number;
  }) => Promise<void>;
  pasteVisualImage: (input: {
    operation: VisualEditOperationRef;
    pasteId: string;
    snapshot: ImageClipClipboardSnapshot;
    targetFrame: number;
    targetLayer: number;
  }) => Promise<void>;
  deleteVisualObject: (input: {
    operation: VisualEditOperationRef;
    object: VisualObjectRef;
  }) => Promise<void>;
  removeTimelineVideoClip: (input: {
    stableShotId: string;
    clipId: string;
  }) => Promise<void>;
  updateTimelineVideoEdit: (input: {
    stableShotId: string;
    takeId: number;
    clipId?: string | null;
    sourceStartSec: number;
    sourceEndSec: number;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
  }) => Promise<void>;
  updateTimelineImageTransform: (input: {
    stableShotId: string;
    imageId: number;
    transform: TimelineTransform;
    textOverlay: StoryTimelineImageTextOverlay | null;
  }) => Promise<void>;
  selectVideoTimelineSegment: (input: {
    stableShotId: string;
    takeId: number;
    rangeId?: number | null;
    selectionType: "full_take" | "range";
  }) => Promise<void>;
  clearVideoTimelineSegment: (stableShotId: string) => Promise<void>;
  createDerivedShotDraft: (input: {
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
  confirmDerivedShot: (
    draftId: number,
    selectedImageId: number
  ) => Promise<number>;
  undoStoryOperation: (operationId: number) => Promise<void>;
  shotVideoProviderStatus: ShotVideoProviderStatus | null;
  imageProviderStatus: ImageProviderStatus | null;
  refetch: () => void;
};

const CreationEditorContext = createContext<CreationEditorContextValue | null>(
  null
);
const EMPTY_STORY_SHOTS: readonly StoryShot[] = [];

const SHOT_STORY_IDENTITY_FIELDS = [
  "shotNo",
  "subject",
  "action",
  "scriptText",
  "dialogue",
  "shotType",
  "beat",
  "cameraAngle",
  "cameraMove",
  "location",
  "timeLight",
  "mood",
  "sound",
  "styleRef",
  "note",
  "emotion",
  "sourceCardContent",
  "intent",
  "rationale",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
  "videoPrompt",
  "emotionCharge",
  "emotionDelta",
  "visualAnchorText",
  "negativePrompt",
] as const;

export function creationTimelineShotId(
  shot: Pick<
    CreationEditorShot,
    "stableShotId" | "shotIdentity" | "shotKey" | "shotNo"
  >,
  index = 0
): string {
  return (
    normalizeShotIdentity(shot.stableShotId) ??
    normalizeShotIdentity(shot.shotIdentity) ??
    normalizeShotIdentity(shot.shotKey) ??
    `legacy-sh${String(shot.shotNo).padStart(2, "0")}-${index + 1}`
  );
}

export function resolveTimelineShots(
  shots: readonly CreationEditorShot[],
  shotIds: readonly string[]
): CreationEditorShot[] {
  const byId = new Map(
    shots.map((shot, index) => [creationTimelineShotId(shot, index), shot])
  );
  return shotIds
    .map(id => byId.get(id))
    .filter((shot): shot is CreationEditorShot => Boolean(shot));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = /(\d+)/.exec(value);
    if (match) return Number(match[1]);
  }
  return null;
}

function normalizePromptOverrides(raw: unknown): PromptOverrides | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const overrides: PromptOverrides = {};
  Object.entries(raw as Record<string, unknown>).forEach(
    ([dimension, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const obj = value as Record<string, unknown>;
      const next = {
        value: typeof obj.value === "string" ? obj.value : undefined,
        weight:
          typeof obj.weight === "number" && Number.isFinite(obj.weight)
            ? obj.weight
            : undefined,
      };
      if (next.value !== undefined || next.weight !== undefined) {
        overrides[dimension] = next;
      }
    }
  );
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function normalizePromptRun(raw: unknown): PromptRunRecord | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const finalPrompt = stringValue(obj.finalPrompt);
  const generatedAt =
    typeof obj.generatedAt === "number" && Number.isFinite(obj.generatedAt)
      ? obj.generatedAt
      : undefined;
  if (!finalPrompt || generatedAt == null) return undefined;
  return {
    finalPrompt,
    generatedAt,
    source:
      obj.source === "prompt-table-rerender" || obj.source === "creation-agent"
        ? obj.source
        : "draw-this-moment",
    imageId:
      typeof obj.imageId === "number" && Number.isFinite(obj.imageId)
        ? obj.imageId
        : undefined,
    imageUrl: stringValue(obj.imageUrl) || undefined,
    usedDimensions: Array.isArray(obj.usedDimensions)
      ? obj.usedDimensions.filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    references: Array.isArray(obj.references)
      ? obj.references.flatMap(rawRef => {
          if (!rawRef || typeof rawRef !== "object" || Array.isArray(rawRef))
            return [];
          const ref = rawRef as Record<string, unknown>;
          const label = stringValue(ref.label);
          if (!label) return [];
          return [
            {
              kind:
                ref.kind === "characterRef" || ref.kind === "styleRef"
                  ? ref.kind
                  : "baseImage",
              label,
              url: stringValue(ref.url) || undefined,
            },
          ];
        })
      : undefined,
  };
}

function normalizeNarrativeJob(raw: unknown): NarrativeJob | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const intentSummary = stringValue(obj.intentSummary);
  const audience = stringValue(obj.audience);
  const claim = stringValue(obj.claim);
  const roleConcern = stringValue(obj.roleConcern);
  const causalExplanation = stringValue(obj.causalExplanation);
  const evidence = stringValue(obj.evidence);
  const storyContext = stringValue(obj.storyContext);
  const visualTranslation = stringValue(obj.visualTranslation);
  const externalValue = stringValue(obj.externalValue);
  const recommendationStatus = stringValue(obj.recommendationStatus);
  const avoidMisread = stringValue(obj.avoidMisread);
  if (!claim || !visualTranslation) return undefined;
  return {
    intentSummary,
    audience,
    claim,
    roleConcern: roleConcern || undefined,
    causalExplanation: causalExplanation || undefined,
    evidence,
    storyContext: storyContext || undefined,
    visualTranslation,
    externalValue: externalValue || undefined,
    recommendationStatus: recommendationStatus || undefined,
    avoidMisread,
  };
}

function shotKey(shotNo: number) {
  return `SH${String(shotNo).padStart(2, "0")}`;
}

function sourceCardMarker(value: string): string | null {
  const match = /^\s*\[(\d+)\]/.exec(value);
  return match?.[1] ?? null;
}

function promptSourceMarker(value: string): string | null {
  const match = /Source material:\s*\[(\d+)\]/i.exec(value);
  return match?.[1] ?? null;
}

function promptShotNo(value: string): number | null {
  const match =
    /(?:Rerender only|Create exactly one (?:storyboard|cinematic) key frame for) SH0*(\d+)/i.exec(
      value
    );
  return match ? Number(match[1]) : null;
}

function isPromptRunStaleForShot(
  shot: Pick<CreationEditorShot, "shotNo" | "sourceCardContent">,
  promptRun?: PromptRunRecord
) {
  if (!promptRun?.finalPrompt) return false;
  const renderedShotNo = promptShotNo(promptRun.finalPrompt);
  if (renderedShotNo != null && renderedShotNo !== shot.shotNo) return true;

  const expectedSource = sourceCardMarker(shot.sourceCardContent);
  const renderedSource = promptSourceMarker(promptRun.finalPrompt);
  return Boolean(
    expectedSource && renderedSource && expectedSource !== renderedSource
  );
}

function normalizeShot(raw: unknown, index: number): CreationEditorShot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const shotNo = numberValue(obj.shotNo) ?? index + 1;
  if (!Number.isSafeInteger(shotNo) || shotNo < 1) return null;
  const identity =
    shotIdentityFromShot(obj, index) ??
    normalizeShotIdentity(`legacy-sh${String(shotNo).padStart(2, "0")}`);

  const promptRun = normalizePromptRun(obj.promptRun);
  const shot: CreationEditorShot = {
    stableShotId: identity ?? undefined,
    shotIdentity: identity ?? undefined,
    shotNo,
    shotKey: shotKey(shotNo),
    sceneNo: stringValue(obj.sceneNo) || undefined,
    sceneTitle: stringValue(obj.sceneTitle) || undefined,
    sceneArtBrief: stringValue(obj.sceneArtBrief) || undefined,
    cueCode: stringValue(obj.cueCode) || undefined,
    actNo: stringValue(obj.actNo) || undefined,
    subject: stringValue(obj.subject),
    action: stringValue(obj.action),
    scriptText: stringValue(obj.scriptText) || undefined,
    publishingVideo:
      obj.publishingVideo &&
      typeof obj.publishingVideo === "object" &&
      !Array.isArray(obj.publishingVideo)
        ? (obj.publishingVideo as StoryShot["publishingVideo"])
        : undefined,
    performance: stringValue(obj.performance) || undefined,
    environmentMotion: stringValue(obj.environmentMotion) || undefined,
    dialogue: stringValue(obj.dialogue),
    voiceAudioUrl: stringValue(obj.voiceAudioUrl) || undefined,
    voiceAudioText: stringValue(obj.voiceAudioText) || undefined,
    voiceAudioProvider: stringValue(obj.voiceAudioProvider) || undefined,
    voiceAudioVoice: stringValue(obj.voiceAudioVoice) || undefined,
    voiceAudioGeneratedAt:
      typeof obj.voiceAudioGeneratedAt === "number" &&
      Number.isFinite(obj.voiceAudioGeneratedAt)
        ? obj.voiceAudioGeneratedAt
        : undefined,
    shotType: stringValue(obj.shotType),
    beat: stringValue(obj.beat),
    cameraAngle: stringValue(obj.cameraAngle),
    cameraMove: stringValue(obj.cameraMove),
    cameraHeight: stringValue(obj.cameraHeight) || undefined,
    lens: stringValue(obj.lens) || undefined,
    cameraPath: stringValue(obj.cameraPath) || undefined,
    subjectPath: stringValue(obj.subjectPath) || undefined,
    location: stringValue(obj.location),
    timeLight: stringValue(obj.timeLight),
    lighting: stringValue(obj.lighting) || undefined,
    colorPalette: stringValue(obj.colorPalette) || undefined,
    materialTexture: stringValue(obj.materialTexture) || undefined,
    mood: stringValue(obj.mood),
    sound: stringValue(obj.sound),
    soundBridge: stringValue(obj.soundBridge) || undefined,
    styleRef: stringValue(obj.styleRef),
    note: stringValue(obj.note),
    emotion: stringValue(obj.emotion),
    sourceCardContent: stringValue(obj.sourceCardContent),
    intent: nullableStringValue(obj.intent),
    rationale: nullableStringValue(obj.rationale),
    videoStart: stringValue(obj.videoStart) || undefined,
    videoEnd: stringValue(obj.videoEnd) || undefined,
    transitionIn: stringValue(obj.transitionIn) || undefined,
    transitionOut: stringValue(obj.transitionOut) || undefined,
    transitionIntent: stringValue(obj.transitionIntent) || undefined,
    videoPrompt: stringValue(obj.videoPrompt) || undefined,
    emotionCharge: stringValue(obj.emotionCharge) || undefined,
    emotionDelta: stringValue(obj.emotionDelta) || undefined,
    visualAnchorText: stringValue(obj.visualAnchorText) || undefined,
    promptDraft: stringValue(obj.promptDraft) || undefined,
    negativePrompt: stringValue(obj.negativePrompt) || undefined,
    characterReference: stringValue(obj.characterReference) || undefined,
    wardrobeReference: stringValue(obj.wardrobeReference) || undefined,
    hairReference: stringValue(obj.hairReference) || undefined,
    sceneReference: stringValue(obj.sceneReference) || undefined,
    textureReference: stringValue(obj.textureReference) || undefined,
    generationModel: stringValue(obj.generationModel) || undefined,
    generationParams: stringValue(obj.generationParams) || undefined,
    chatCutMapping:
      obj.chatCutMapping &&
      typeof obj.chatCutMapping === "object" &&
      !Array.isArray(obj.chatCutMapping)
        ? (obj.chatCutMapping as CreationEditorShot["chatCutMapping"])
        : undefined,
    durationMs:
      typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs)
        ? obj.durationMs
        : undefined,
    narrativeJob: normalizeNarrativeJob(obj.narrativeJob),
    promptOverrides: normalizePromptOverrides(obj.promptOverrides),
    promptRun,
    fragmentRefs: Array.isArray(obj.fragmentRefs)
      ? obj.fragmentRefs.filter(
          (item): item is string => typeof item === "string"
        )
      : undefined,
  };
  if (!isPromptRunStaleForShot(shot, promptRun)) return shot;
  return {
    ...shot,
    promptRun: undefined,
    downstreamStale: true,
  };
}

export function normalizeStoryShots(body: unknown): CreationEditorShot[] {
  if (!body || typeof body !== "object") return [];
  const shots = (body as { shots?: unknown }).shots;
  if (!Array.isArray(shots)) return [];
  return ensureShotIdentities(
    shots
      .map(normalizeShot)
      .filter((shot): shot is CreationEditorShot => Boolean(shot))
      .sort((left, right) => left.shotNo - right.shotNo)
  );
}

function preserveEditorMetadata(
  canonical: CreationEditorShot,
  persisted?: CreationEditorShot
): CreationEditorShot {
  if (!persisted) return canonical;
  const stableIdentity =
    shotIdentityFromShot(persisted) ?? shotIdentityFromShot(canonical);
  const sameStoryContent = SHOT_STORY_IDENTITY_FIELDS.every(
    field => (canonical[field] ?? "") === (persisted[field] ?? "")
  );
  const inheritedPromptRun = sameStoryContent
    ? (persisted.promptRun ?? canonical.promptRun)
    : persisted.promptRun;
  const promptRun = isPromptRunStaleForShot(persisted, inheritedPromptRun)
    ? undefined
    : inheritedPromptRun;
  const downstreamStale =
    (!sameStoryContent && !promptRun) ||
    Boolean(inheritedPromptRun && !promptRun);
  return {
    ...canonical,
    ...persisted,
    stableShotId: stableIdentity ?? canonical.stableShotId,
    shotIdentity: stableIdentity ?? canonical.shotIdentity,
    shotKey: persisted.shotKey || canonical.shotKey,
    durationMs:
      persisted.durationMs !== undefined
        ? persisted.durationMs
        : canonical.durationMs,
    narrativeJob: sameStoryContent
      ? (persisted.narrativeJob ?? canonical.narrativeJob)
      : persisted.narrativeJob,
    promptOverrides: sameStoryContent
      ? (persisted.promptOverrides ?? canonical.promptOverrides)
      : persisted.promptOverrides,
    promptRun,
    fragmentRefs: sameStoryContent
      ? (persisted.fragmentRefs ?? canonical.fragmentRefs)
      : persisted.fragmentRefs,
    downstreamStale,
  };
}

export function mergeCanonicalStoryShots(
  canonicalShots: readonly StoryShot[],
  body: unknown
): CreationEditorShot[] {
  const persistedShots = normalizeStoryShots(body);
  if (canonicalShots.length === 0) return persistedShots;

  const persistedByIdentity = new Map(
    persistedShots
      .map((shot, index) => [shotIdentityFromShot(shot, index), shot] as const)
      .filter((entry): entry is [string, CreationEditorShot] =>
        Boolean(entry[0])
      )
  );
  const persistedByShotNo = new Map(
    persistedShots.map(shot => [shot.shotNo, shot])
  );
  const canonicalResult = ensureShotIdentities(canonicalShots)
    .map((raw, index) => {
      const canonical = normalizeShot(raw, index);
      if (!canonical) return null;
      const persisted =
        persistedByIdentity.get(shotIdentityFromShot(canonical, index) ?? "") ??
        persistedByShotNo.get(canonical.shotNo);
      return preserveEditorMetadata(canonical, persisted);
    })
    .filter((shot): shot is CreationEditorShot => Boolean(shot));
  const canonicalByIdentity = new Map(
    canonicalResult
      .map((shot, index) => [shotIdentityFromShot(shot, index), shot] as const)
      .filter((entry): entry is [string, CreationEditorShot] =>
        Boolean(entry[0])
      )
  );
  const included = new Set<string>();
  const ordered = persistedShots.map((persisted, index) => {
    const identity = shotIdentityFromShot(persisted, index);
    if (!identity) return persisted;
    included.add(identity);
    return canonicalByIdentity.get(identity) ?? persisted;
  });
  for (const canonical of canonicalResult) {
    const identity = shotIdentityFromShot(canonical);
    if (!identity || included.has(identity)) continue;
    included.add(identity);
    ordered.push(canonical);
  }
  return ensureShotIdentities(ordered).map((shot, index) => ({
    ...shot,
    shotNo: index + 1,
    shotKey: shotKey(index + 1),
  }));
}

export function normalizeStoryImages(
  rawImages: unknown
): CreationEditorImage[] {
  if (!Array.isArray(rawImages)) return [];
  return rawImages
    .map((raw): CreationEditorImage | null => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const imageUrl = stringValue(obj.imageUrl);
      if (!imageUrl) return null;
      const canonical = canonicalizeShotNo(
        (obj.shotNo ?? obj.canonicalShotNo ?? obj.rawShotNo) as
          | string
          | number
          | null
          | undefined
      );
      const shotNo = canonical ? Number(canonical.slice(2)) : null;
      const shotIdentity = normalizeShotIdentity(
        obj.shotIdentity ?? obj.stableShotId
      );
      const id = numberValue(obj.id);
      const status =
        obj.status === "selected" ||
        obj.status === "pending" ||
        obj.status === "rejected"
          ? obj.status
          : undefined;
      const generationType =
        obj.generationType === "generate" ||
        obj.generationType === "initial" ||
        obj.generationType === "inpaint"
          ? obj.generationType
          : undefined;
      const selectionSource =
        obj.selectionSource === "explicit" ||
        obj.selectionSource === "legacy" ||
        obj.selectionSource === "none"
          ? obj.selectionSource
          : undefined;
      return {
        id: id ?? 0,
        shotNo,
        shotIdentity,
        imageUrl,
        prompt: stringValue(obj.prompt) || null,
        status,
        isCurrent:
          typeof obj.isCurrent === "boolean" ? obj.isCurrent : undefined,
        isPrimary:
          typeof obj.isPrimary === "boolean" ? obj.isPrimary : undefined,
        generationType,
        parentImageId: numberValue(obj.parentImageId),
        selectionSource,
      } satisfies CreationEditorImage;
    })
    .filter((image): image is CreationEditorImage => image != null);
}

function imageSourceKey(image: CreationEditorImage): string {
  if (image.id > 0) return `id:${image.id}`;
  return [image.shotIdentity ?? "", image.shotNo ?? "", image.imageUrl].join(
    "|"
  );
}

export function resolveCreationEditorImages(
  materialState: StoryMaterialState | null | undefined,
  storyImages: unknown
): CreationEditorImage[] {
  const imagesByKey = new Map<string, CreationEditorImage>();
  const mergeImage = (image: CreationEditorImage) => {
    const key = imageSourceKey(image);
    const previous = imagesByKey.get(key);
    imagesByKey.set(key, {
      ...previous,
      ...image,
      relatedShotIdentities: Array.from(
        new Set([
          ...(previous?.relatedShotIdentities ?? []),
          ...(image.relatedShotIdentities ?? []),
        ])
      ),
    });
  };
  for (const image of normalizeStoryImages(storyImages)) {
    mergeImage(image);
  }
  for (const shot of materialState?.shots ?? []) {
    const ownedImages = [
      ...(Array.isArray(shot.imageVersions) ? shot.imageVersions : []),
      ...(shot.currentImage ? [shot.currentImage] : []),
    ];
    for (const image of normalizeStoryImages(ownedImages)) mergeImage(image);
    for (const image of normalizeStoryImages(shot.relatedImages)) {
      mergeImage({
        ...image,
        relatedShotIdentities: [shot.stableShotId],
      });
    }
  }
  return Array.from(imagesByKey.values());
}

function isCurrentMaterialImage(image: CreationEditorImage): boolean {
  return (
    image.isPrimary === true ||
    image.selectionSource === "explicit" ||
    image.selectionSource === "legacy" ||
    image.status === "selected"
  );
}

function shouldPreferDisplayImage(
  previous: CreationEditorImage | undefined,
  candidate: CreationEditorImage
): boolean {
  if (!previous) return true;
  if (previous.isPrimary !== candidate.isPrimary) {
    return candidate.isPrimary === true;
  }
  return candidate.id >= previous.id;
}

function imageRelatesExactlyToShot(
  image: CreationEditorImage,
  shotIdentity: string | null
): boolean {
  const normalizedShotIdentity = normalizeShotIdentity(shotIdentity);
  return Boolean(
    normalizedShotIdentity &&
      image.relatedShotIdentities?.some(
        relatedIdentity =>
          normalizeShotIdentity(relatedIdentity) === normalizedShotIdentity
      )
  );
}

export function mergeShotsWithImages(
  shots: readonly CreationEditorShot[],
  images: readonly CreationEditorImage[]
): CreationEditorShot[] {
  const shotNoCounts = new Map<number, number>();
  for (const shot of shots) {
    shotNoCounts.set(shot.shotNo, (shotNoCounts.get(shot.shotNo) ?? 0) + 1);
  }
  const displayByShotNo = new Map<number, CreationEditorImage>();
  const displayByIdentity = new Map<string, CreationEditorImage>();
  const byImageId = new Map<number, CreationEditorImage>();
  for (const image of images) {
    byImageId.set(image.id, image);
    // Match filtering in latestStoryboardFrames(): exclude rejected and images without URLs
    if (image.status === "rejected" || !image.imageUrl) continue;
    if (!isCurrentMaterialImage(image)) continue;
    if (image.shotIdentity) {
      for (const key of shotIdentityMatchKeys(
        image.shotIdentity,
        image.shotNo
      )) {
        const previous = displayByIdentity.get(key);
        if (shouldPreferDisplayImage(previous, image))
          displayByIdentity.set(key, image);
      }
    }
    if (!image.shotIdentity && image.shotNo != null) {
      const previous = displayByShotNo.get(image.shotNo);
      if (shouldPreferDisplayImage(previous, image))
        displayByShotNo.set(image.shotNo, image);
    }
  }

  return shots.map(shot => {
    const identity = shotIdentityFromShot(shot);
    const hasUniqueShotNo = shotNoCounts.get(shot.shotNo) === 1;
    const identityKeys = new Set(
      hasUniqueShotNo
        ? shotIdentityMatchKeys(identity, shot.shotNo)
        : [normalizeShotIdentity(identity)].filter(
            (key): key is string => key != null
          )
    );
    const imageVersions = images
      .filter(image => {
        if (image.status === "rejected" || !image.imageUrl) return false;
        if (image.shotIdentity) {
          const imageIdentityKeys = hasUniqueShotNo
            ? shotIdentityMatchKeys(image.shotIdentity, image.shotNo)
            : [normalizeShotIdentity(image.shotIdentity)].filter(
                (key): key is string => key != null
              );
          if (imageIdentityKeys.some(key => identityKeys.has(key))) {
            return true;
          }
        }
        if (
          image.relatedShotIdentities?.some(
            relatedIdentity =>
            normalizeShotIdentity(relatedIdentity) ===
            normalizeShotIdentity(identity)
          )
        ) {
          return true;
        }
        return (
          image.shotNo === shot.shotNo && shotNoCounts.get(shot.shotNo) === 1
        );
      })
      .sort((left, right) => left.id - right.id);
    const shotWithVersions =
      imageVersions.length > 0 ? { ...shot, imageVersions } : shot;
    const matchedIdentityImage = shotIdentityMatchKeys(
      identity,
      hasUniqueShotNo ? shot.shotNo : null
    )
      .filter(key => hasUniqueShotNo || key === normalizeShotIdentity(identity))
      .reduce<CreationEditorImage | undefined>((selected, key) => {
      const candidate = displayByIdentity.get(key);
      if (!candidate) return selected;
      if (!selected || candidate.id >= selected.id) return candidate;
      return selected;
      }, undefined);
    const promptRunImage =
      shot.promptRun?.imageId != null
        ? byImageId.get(shot.promptRun.imageId)
        : undefined;
    const matchedImageCandidate =
      matchedIdentityImage ??
      (hasUniqueShotNo ? displayByShotNo.get(shot.shotNo) : undefined);
    const matchedImage =
      matchedImageCandidate &&
      !imageRelatesExactlyToShot(matchedImageCandidate, identity)
        ? matchedImageCandidate
        : undefined;
    const explicitlySelectedImage =
      matchedImage?.selectionSource === "explicit" ||
      matchedImage?.status === "selected"
        ? matchedImage
        : undefined;
    // Story metadata becoming stale invalidates derived prompts, not a user's
    // explicit material choice. Keep the selected image visible across panels.
    const displayImage = shot.downstreamStale
      ? explicitlySelectedImage
      : matchedImage;
    const image = explicitlySelectedImage ?? promptRunImage ?? displayImage;

    if (explicitlySelectedImage) {
      return {
        ...shotWithVersions,
        imageId: explicitlySelectedImage.id,
        imageUrl: explicitlySelectedImage.imageUrl,
        imagePrompt: explicitlySelectedImage.prompt,
        imageSelectionSource: explicitlySelectedImage.selectionSource,
        imageIsPrimary: explicitlySelectedImage.isPrimary,
      };
    }
    if (promptRunImage && !isCurrentMaterialImage(promptRunImage)) {
      return {
        ...shotWithVersions,
        imageUrl: promptRunImage.imageUrl,
        imagePrompt: shot.promptRun?.finalPrompt ?? promptRunImage.prompt,
      };
    }
    if (shot.promptRun?.imageUrl) {
      return {
        ...shotWithVersions,
        imageId:
          promptRunImage && isCurrentMaterialImage(promptRunImage)
            ? promptRunImage.id
            : undefined,
        imageUrl: shot.promptRun.imageUrl,
        imagePrompt: shot.promptRun.finalPrompt,
        imageSelectionSource:
          promptRunImage && isCurrentMaterialImage(promptRunImage)
            ? promptRunImage.selectionSource
            : undefined,
        imageIsPrimary:
          promptRunImage && isCurrentMaterialImage(promptRunImage)
            ? promptRunImage.isPrimary
            : undefined,
      };
    }
    if (!image) return shotWithVersions;
    return {
      ...shotWithVersions,
      imageId: image.id,
      imageUrl: image.imageUrl,
      imagePrompt: image.prompt,
      imageSelectionSource: image.selectionSource,
      imageIsPrimary: image.isPrimary,
    };
  });
}

/** Apply non-owning timeline image references without mutating asset ownership. */
export function applyTimelineImageReferences(
  shots: readonly CreationEditorShot[],
  images: readonly CreationEditorImage[],
  items: readonly StoryTimelineItem[]
): CreationEditorShot[] {
  const imageById = new Map(images.map(image => [image.id, image]));
  const itemByShotId = new Map(items.map(item => [item.stableShotId, item]));
  return shots.map(shot => {
    const referencedImageId = itemByShotId.get(
      creationTimelineShotId(shot)
    )?.referencedImageId;
    const image =
      referencedImageId == null
        ? null
        : (imageById.get(referencedImageId) ?? null);
    if (!image || image.status === "rejected" || !image.imageUrl) return shot;
    return {
      ...shot,
      imageId: image.id,
      imageUrl: image.imageUrl,
      imagePrompt: image.prompt,
      imageSelectionSource: image.selectionSource,
      imageIsPrimary: image.isPrimary,
      imageVersions: Array.from(
        new Map(
          [...(shot.imageVersions ?? []), image].map(candidate => [
            candidate.id,
            candidate,
          ])
        ).values()
      ),
    };
  });
}

export function normalizeStoryVideoAssets(
  rawAssets: unknown
): VideoTakeAsset[] {
  if (!Array.isArray(rawAssets)) return [];
  return rawAssets
    .map((raw): VideoTakeAsset | null => {
      if (!raw || typeof raw !== "object") return null;
      const asset = raw as VideoTakeAsset;
      const stableShotId = normalizeShotIdentity(asset.stableShotId);
      if (!stableShotId || typeof asset.id !== "number") return null;
      return {
        ...asset,
        stableShotId,
        ranges: Array.isArray(asset.ranges) ? asset.ranges : [],
        selectedSelectionType:
          asset.selectedSelectionType === "full_take" ||
          asset.selectedSelectionType === "range"
            ? asset.selectedSelectionType
            : null,
      };
    })
    .filter((asset): asset is VideoTakeAsset => asset != null);
}

export function mergeShotsWithVideos(
  shots: readonly CreationEditorShot[],
  videoTakes: readonly VideoTakeAsset[],
  materialShots: readonly Pick<
    ShotMaterialState,
    "stableShotId" | "currentVideo" | "videoTakes"
  >[] = []
): CreationEditorShot[] {
  const takesByShot = new Map<string, Map<number, VideoTakeAsset>>();
  for (const take of videoTakes) {
    for (const key of shotIdentityMatchKeys(take.stableShotId)) {
      const group = takesByShot.get(key) ?? new Map<number, VideoTakeAsset>();
      group.set(take.id, take);
      takesByShot.set(key, group);
    }
  }
  const materialByShot = new Map(
    materialShots.map(shot => [shot.stableShotId, shot])
  );

  return shots.map(shot => {
    const identity = shotIdentityFromShot(shot);
    const matched = new Map<number, VideoTakeAsset>();
    for (const key of shotIdentityMatchKeys(identity, shot.shotNo)) {
      const group = takesByShot.get(key);
      if (!group) continue;
      group.forEach((take, takeId) => {
        matched.set(takeId, take);
      });
    }
    const material = identity ? materialByShot.get(identity) : undefined;
    for (const take of material?.videoTakes ?? []) {
      matched.set(take.id, take);
    }
    if (material?.currentVideo) {
      matched.set(material.currentVideo.id, material.currentVideo);
    }
    const takes = Array.from(matched.values()).sort((left, right) => {
      const selectedDiff =
        Number(right.isTimelineSelected) - Number(left.isTimelineSelected);
      if (selectedDiff) return selectedDiff;
      return (
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.id - left.id
      );
    });
    if (takes.length === 0) return shot;
    const timelineTake =
      material?.currentVideo ?? takes.find(take => take.isTimelineSelected);
    return {
      ...shot,
      videoTakes: takes,
      selectedVideoTake: timelineTake,
    };
  });
}

function adjacentVideoReferenceImageIds(
  shots: readonly CreationEditorShot[],
  shotNo: number
): {
  previousReferenceImageId?: number;
  nextReferenceImageId?: number;
} {
  const ordered = [...shots]
    .filter(
      shot =>
        Number.isFinite(shot.shotNo) &&
        typeof shot.imageId === "number" &&
        Number.isFinite(shot.imageId)
    )
    .sort((left, right) => left.shotNo - right.shotNo);
  const index = ordered.findIndex(shot => shot.shotNo === shotNo);
  if (index < 0) return {};
  return {
    previousReferenceImageId: ordered[index - 1]?.imageId,
    nextReferenceImageId: ordered[index + 1]?.imageId,
  };
}

export function selectInitialShotNo(
  selectedShotNo: number | null,
  shots: readonly CreationEditorShot[]
): number | null {
  if (
    selectedShotNo != null &&
    shots.some(shot => shot.shotNo === selectedShotNo)
  ) {
    return selectedShotNo;
  }
  return shots[0]?.shotNo ?? null;
}

export function resolveCreationEditorActiveId({
  isControlled,
  controlledActiveStoryId,
  localActiveStoryId,
  firstStoryId,
  spineActiveStoryId,
  spineRemoteStoryId,
}: {
  isControlled: boolean;
  controlledActiveStoryId: number | null | undefined;
  localActiveStoryId: number | null;
  firstStoryId: number | null | undefined;
  spineActiveStoryId: number | null | undefined;
  spineRemoteStoryId: number | null | undefined;
}): number | null {
  const spineStoryId = spineActiveStoryId ?? spineRemoteStoryId ?? null;
  if (isControlled) {
    return controlledActiveStoryId ?? spineStoryId;
  }
  return localActiveStoryId ?? firstStoryId ?? spineStoryId;
}

async function waitForMaterialListRefresh(
  promise: Promise<unknown>
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("素材已保存，但列表刷新超时，请刷新页面查看")),
          12_000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type CreationEditorProviderProps = PropsWithChildren<{
  activeStoryId?: number | null;
}>;

export function CreationEditorProvider({
  children,
  activeStoryId: controlledActiveStoryId,
}: CreationEditorProviderProps) {
  const isControlled = controlledActiveStoryId !== undefined;
  const [localActiveStoryId, setLocalActiveStoryId] = useState<number | null>(
    null
  );
  const [selectedShotNo, setSelectedShotNo] = useState<number | null>(null);
  const [rerenderingShotNos, setRerenderingShotNos] = useState<number[]>([]);
  const [rerenderError, setRerenderError] = useState<string | null>(null);
  const [promotingFrameCropShotNo, setPromotingFrameCropShotNo] = useState<
    number | null
  >(null);
  const [generatingVideoShotNos, setGeneratingVideoShotNos] = useState<
    number[]
  >([]);
  const [generatingVoiceShotIds, setGeneratingVoiceShotIds] = useState<
    string[]
  >([]);
  const [recentVideoTakeIds, setRecentVideoTakeIds] = useState<number[]>([]);
  const [timelineShotIds, setTimelineShotIds] = useState<string[]>([]);
  const autoRefreshVideoRef = useRef(false);
  const storyShotSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const utils = trpc.useUtils();

  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const updateStoryShotFieldsMut =
    trpc.storyAgent.updateStoryShotFields.useMutation();
  const generateStoryShotVoiceMut =
    trpc.storyAgent.generateStoryShotVoice.useMutation();
  const restoreStoryShotFieldVersionMut =
    trpc.storyAgent.restoreStoryShotFieldVersion.useMutation();
  const insertStoryShotAfterMut =
    trpc.storyAgent.insertStoryShotAfter.useMutation();
  const deleteStoryShotMut = trpc.storyAgent.deleteStoryShot.useMutation();
  const restoreDeletedStoryShotMut =
    trpc.storyAgent.restoreDeletedStoryShot.useMutation();
  const splitStoryShotMut = trpc.storyAgent.splitStoryShot.useMutation();
  const undoSplitStoryShotMut =
    trpc.storyAgent.undoSplitStoryShot.useMutation();
  const generateForMobileMut = trpc.storyAgent.generateForMobile.useMutation();
  const promoteFrameCropMut = trpc.creationAgent.promoteFrameCrop.useMutation();
  const promoteStoryImageMut =
    trpc.creationAgent.promoteStoryImage.useMutation();
  const assignStoryImageToShotMut =
    trpc.creationAgent.assignStoryImageToShot.useMutation();
  const deleteStoryImageMut = trpc.storyAgent.deleteShotImage.useMutation();
  const deleteExtractedFrameMut =
    trpc.storyAgent.deleteExtractedFrame.useMutation();
  const importStoryMaterialMut =
    trpc.creationAgent.importStoryMaterial.useMutation();
  const attachChatCutXmlMut = trpc.storyAgent.attachChatCutXml.useMutation();
  const adviseStoryImagesMut =
    trpc.creationAgent.adviseStoryImages.useMutation();
  const applyImageAdviceMut = trpc.creationAgent.applyImageAdvice.useMutation();
  const generateShotVideoMut =
    trpc.creationAgent.generateShotVideo.useMutation();
  const estimateStartEndShotVideoMut =
    trpc.creationAgent.estimateStartEndShotVideo.useMutation();
  const submitStartEndShotVideoMut =
    trpc.creationAgent.submitStartEndShotVideo.useMutation();
  const analyzeShotVideoDirectionMut =
    trpc.creationAgent.analyzeShotVideoDirection.useMutation();
  const conformVideoTakesMut =
    trpc.creationAgent.conformVideoTakes.useMutation();
  const analyzeShotConsistencyMut =
    trpc.creationAgent.analyzeShotConsistency.useMutation();
  const refreshShotVideoStatusMut =
    trpc.creationAgent.refreshShotVideoStatus.useMutation();
  const markVideoTakeUnusableMut =
    trpc.creationAgent.markVideoTakeUnusable.useMutation();
  const createVideoTakeRangeMut =
    trpc.creationAgent.createVideoTakeRange.useMutation();
  const selectVideoTimelineSegmentMut =
    trpc.creationAgent.selectVideoTimelineSegment.useMutation();
  const clearVideoTimelineSegmentMut =
    trpc.creationAgent.clearVideoTimelineSegment.useMutation();
  const moveVideoTakeMut = trpc.creationAgent.moveVideoTake.useMutation();
  const adoptVideoTakeMut = trpc.creationAgent.adoptVideoTake.useMutation();
  const reuseVideoTakeMut = trpc.creationAgent.reuseVideoTake.useMutation();
  const appendVideoTakeToTimelineMut =
    trpc.creationAgent.appendVideoTakeToTimeline.useMutation();
  const updateStoryTimelineMut =
    trpc.creationAgent.updateStoryTimeline.useMutation();
  const moveVisualClipMut = trpc.creationAgent.moveVisualClip.useMutation();
  const insertVisualImageClipMut =
    trpc.creationAgent.insertVisualImageClip.useMutation();
  const extractTimelineFrameMut =
    trpc.creationAgent.extractTimelineFrame.useMutation();
  const createDerivationDraftMut =
    trpc.creationAgent.createDerivationDraft.useMutation();
  const analyzeDerivationDraftMut =
    trpc.creationAgent.analyzeDerivationDraft.useMutation();
  const generateDerivedCandidatesMut =
    trpc.creationAgent.generateDerivedCandidates.useMutation();
  const confirmDerivedShotMut =
    trpc.creationAgent.confirmDerivedShot.useMutation();
  const undoStoryOperationMut =
    trpc.creationAgent.undoStoryOperation.useMutation();
  const undoVisualEditReceiptMut =
    trpc.creationAgent.undoVisualEditReceipt.useMutation();
  const spineActiveStoryId = useStorySpine(state => state.activeStoryId);
  const spineRemoteStoryId = useStorySpine(state => state.remoteStoryId);
  const setCanonicalStoryShots = useStorySpine(state => state.setStoryShots);
  const setSpineServerRevision = useStorySpine(
    state => state.setServerRevision
  );
  const activeId = resolveCreationEditorActiveId({
    isControlled,
    controlledActiveStoryId,
    localActiveStoryId,
    firstStoryId: storyListQuery.data?.stories?.[0]?.id,
    spineActiveStoryId,
    spineRemoteStoryId,
  });
  const activeStoryIdRef = useRef(activeId);
  const renderedExtractionStorySessionToken = useMemo(
    () => Symbol(`timeline-extraction-story:${activeId ?? "none"}`),
    [activeId]
  );
  const committedExtractionStorySessionTokenRef = useRef(
    renderedExtractionStorySessionToken
  );
  useLayoutEffect(() => {
    // Concurrent rendering may prepare another Story and then abandon it.
    // Advance the active Story and extraction session only after React commits
    // that render, so the still-visible Story keeps ownership of late results.
    activeStoryIdRef.current = activeId;
    committedExtractionStorySessionTokenRef.current =
      renderedExtractionStorySessionToken;
  }, [activeId, renderedExtractionStorySessionToken]);
  const extractionIntentByPositionRef = useRef(
    new Map<
      string,
      {
        requestId: string;
        inFlight?: {
          promise: Promise<void>;
          originStorySessionToken: symbol;
          undoRecorded: boolean;
        };
      }
    >()
  );
  const canonicalStoryShots = useStorySpine(state =>
    activeId != null &&
    (state.activeStoryId === activeId || state.remoteStoryId === activeId)
      ? state.storyShots
      : EMPTY_STORY_SHOTS
  );
  const spinePublishing = useStorySpine(state =>
    activeId != null &&
    (state.activeStoryId === activeId || state.remoteStoryId === activeId)
      ? state.publishing
      : null
  );
  const storyQuery = trpc.storyAgent.storyGet.useQuery(
    { id: activeId ?? 0 },
    {
      // 草稿故事的 activeId 是 -1，服务端只认正数 id，别让 400 进入重试循环
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
    }
  );
  const publishingDraftQuery = trpc.publishingDraft.read.useQuery(
    { storyId: activeId ?? 1 },
    {
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const storyboardCoverReferencesQuery =
    trpc.publishingDraft.storyboardCoverReferences.useQuery(
      { storyId: activeId ?? 1 },
      {
        enabled: activeId != null && activeId > 0,
        refetchOnWindowFocus: false,
        retry: false,
      }
    );
  const storyImagesQuery = trpc.storyAgent.storyImages.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
    }
  );
  const storyVideoAssetsQuery = trpc.storyAgent.storyVideoAssets.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
    }
  );
  const storyMaterialQuery = trpc.storyAgent.storyMaterialState.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
    }
  );
  const promptLineageQuery = trpc.promptLineage.getStoryProjection.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
    }
  );
  const promptCandidateMut = trpc.promptLineage.createCandidate.useMutation();
  const rejectPromptCandidateMut =
    trpc.promptLineage.rejectCandidate.useMutation();
  const confirmPromptCandidateMut =
    trpc.promptLineage.confirmCandidate.useMutation();
  const shotVideoProviderStatusQuery =
    trpc.creationAgent.shotVideoProviderStatus.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });
  const imageProviderStatusQuery =
    trpc.creationAgent.imageProviderStatus.useQuery(undefined, {
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    });

  useEffect(() => {
    if (isControlled || localActiveStoryId != null) return;
    const firstId = storyListQuery.data?.stories?.[0]?.id;
    if (typeof firstId === "number") setLocalActiveStoryId(firstId);
  }, [isControlled, localActiveStoryId, storyListQuery.data?.stories]);

  const setActiveStoryId = useCallback(
    (storyId: number | null) => {
      if (!isControlled) setLocalActiveStoryId(storyId);
    },
    [isControlled]
  );

  const stories = useMemo<CreationEditorStory[]>(
    () =>
      (storyListQuery.data?.stories ?? []).map(story => ({
        id: story.id,
        title: story.title || "未命名故事",
        logline: story.logline,
      })),
    [storyListQuery.data?.stories]
  );

  const activeStory = useMemo<CreationEditorStory | null>(() => {
    const row = storyQuery.data;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title || "未命名故事",
      logline: row.logline,
    };
  }, [storyQuery.data]);
  const publishingHandoff = useMemo(() => {
    if (activeId == null || activeId <= 0) return null;
    const { publishing, coverAsset, coverCandidates } =
      resolveScopedPublishingHandoff({
        activeStoryId: activeId,
        spinePublishing,
        story: storyQuery.data,
        publishingRead: publishingDraftQuery.data,
        storyboardCoverRead: storyboardCoverReferencesQuery.data,
      });
    return buildPublishingVideoHandoff({
      storyId: activeId,
      publishing,
      coverAsset,
      coverCandidates,
    });
  }, [
    activeId,
    publishingDraftQuery.data?.coverAsset,
    publishingDraftQuery.data?.publishing,
    storyboardCoverReferencesQuery.data,
    spinePublishing,
    storyQuery.data?.body,
    storyQuery.data?.id,
  ]);
  const chatCutTimeline = useMemo(
    () => normalizeChatCutTimeline(storyQuery.data?.body),
    [storyQuery.data?.body]
  );
  const storyboardFieldVersions = useMemo(() => {
    const body =
      storyQuery.data?.body &&
      typeof storyQuery.data.body === "object" &&
      !Array.isArray(storyQuery.data.body)
        ? (storyQuery.data.body as Record<string, unknown>)
        : {};
    return normalizeStoryboardFieldVersions(body.storyboardFieldVersions);
  }, [storyQuery.data?.body]);

  const shots = useMemo(() => {
    const body = storyQuery.data?.body;
    const storyShots = mergeCanonicalStoryShots(canonicalStoryShots, body);
    const images = resolveCreationEditorImages(
      storyMaterialQuery.data as StoryMaterialState | null | undefined,
      storyImagesQuery.data
    );
    const withImages = applyTimelineImageReferences(
      mergeShotsWithImages(storyShots, images),
      images,
      storyMaterialQuery.data?.timeline.items ?? []
    );
    const materialVideos = storyMaterialQuery.data?.shots.flatMap(
      shot => shot.videoTakes
    );
    const videos = normalizeStoryVideoAssets(
      materialVideos ?? storyVideoAssetsQuery.data
    );
    const timelineByShotId = new Map(
      (storyMaterialQuery.data?.timeline.items ?? []).map(item => [
        item.stableShotId,
        item,
      ])
    );
    return mergeShotsWithVideos(
      withImages,
      videos,
      storyMaterialQuery.data?.shots ?? []
    ).map(shot => {
      const timelineItem =
        timelineByShotId.get(creationTimelineShotId(shot)) ?? null;
      return {
        ...shot,
        timelineItem,
        durationMs: timelineItem?.plannedDurationMs ?? shot.durationMs,
      };
    });
  }, [
    canonicalStoryShots,
    storyImagesQuery.data,
    storyMaterialQuery.data,
    storyQuery.data?.body,
    storyVideoAssetsQuery.data,
  ]);

  useEffect(() => {
    const items = storyMaterialQuery.data?.timeline.items;
    const next = items
      ? [...items]
          .filter(item => item.included)
          .sort((left, right) => left.position - right.position)
          .map(item => item.stableShotId)
      : shots.map(creationTimelineShotId);
    setTimelineShotIds(current =>
      next.length === current.length &&
      next.every((shotId, index) => shotId === current[index])
        ? current
        : next
    );
  }, [shots, storyMaterialQuery.data?.timeline.items]);

  const timelineItems = useMemo<StoryTimelineItem[]>(
    () =>
      storyMaterialQuery.data?.timeline.items ??
      shots.map((shot, position) => ({
        stableShotId: creationTimelineShotId(shot),
        included: true,
        position,
        plannedDurationMs: shot.durationMs ?? 3000,
        durationFrames: timelineMsToFrames(shot.durationMs ?? 3000),
        timelineStartFrame: shots
          .slice(0, position)
          .reduce(
            (total, previous) =>
              total + timelineMsToFrames(previous.durationMs ?? 3000),
            0
          ),
        stackOrder: position,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      })),
    [shots, storyMaterialQuery.data?.timeline.items]
  );
  const timelineOverlays = useMemo<StoryTimelineOverlay[]>(
    () => storyMaterialQuery.data?.timeline.overlays ?? [],
    [storyMaterialQuery.data?.timeline.overlays]
  );
  /** 落库形态：显式层数 + 隐藏集合。图层操作和撤销都以它为输入。 */
  const persistedVisualLayerState = useMemo(
    () =>
      normalizePersistedVisualLayerState(
        storyMaterialQuery.data?.timeline.visualLayerState
      ),
    [storyMaterialQuery.data?.timeline.visualLayerState]
  );
  /** 渲染形态：显式层之上再算出一层空白投放层。 */
  const timelineVisualLayerState = useMemo(
    () =>
      resolveTimelineVisualLayerState(
        persistedVisualLayerState,
        timelineItems,
        timelineOverlays
      ),
    [persistedVisualLayerState, timelineItems, timelineOverlays]
  );

  const saveTimelineItems = useCallback(
    async (
      items: StoryTimelineItem[],
      options: {
        throwOnError?: boolean;
        recordUndo?: boolean;
        overlays?: StoryTimelineOverlay[];
        visualLayerState?: StoryTimelineVisualLayerState;
      } = {}
    ) => {
      if (activeId == null) return;
      const previousIds = timelineShotIds;
      const previousItems = timelineItems;
      const previousVisualLayerState = persistedVisualLayerState;
      const previousOverlays = timelineOverlays;
      const projectedRows = buildTimelineLayout(items);
      const projectedById = new Map(
        projectedRows.map(row => [row.item.stableShotId, row] as const)
      );
      const normalized = items.map((item, position) => {
        const row = projectedById.get(item.stableShotId);
        return {
          ...item,
          position,
          durationFrames:
            row?.durationFrames ?? timelineMsToFrames(item.plannedDurationMs),
          timelineStartFrame: row?.startFrame ?? 0,
        };
      });
      setTimelineShotIds(
        normalized.filter(item => item.included).map(item => item.stableShotId)
      );
      const persist = async () => {
        try {
          const result = await updateStoryTimelineMut.mutateAsync({
            storyId: activeId,
            expectedVersion: storyMaterialQuery.data?.timeline.version ?? 0,
            items: normalized,
            ...(options.overlays === undefined
              ? {}
              : { overlays: options.overlays }),
            ...(options.visualLayerState === undefined
              ? {}
              : { visualLayerState: options.visualLayerState }),
          });
          if (result.status !== "ok") throw new Error(result.error);
          const changed =
            JSON.stringify(previousItems) !== JSON.stringify(normalized) ||
            (options.visualLayerState !== undefined &&
              JSON.stringify(previousVisualLayerState) !==
                JSON.stringify(options.visualLayerState)) ||
            (options.overlays !== undefined &&
              JSON.stringify(previousOverlays) !==
                JSON.stringify(options.overlays));
          if (options.recordUndo !== false && changed) {
            // 图层顺序、层数和显隐必须和素材一起进同一条撤销记录，
            // 否则一次 Cmd+Z 只还原一半。
            recordTimelineUndoSnapshot(activeId, previousItems, {
              visualLayerState: previousVisualLayerState,
              overlays: previousOverlays,
            });
          }
          await storyMaterialQuery.refetch();
        } catch (error) {
          setTimelineShotIds(previousIds);
          await storyMaterialQuery.refetch();
          console.warn("timeline save failed", error);
          if (options.throwOnError) throw error;
        }
      };
      await trackCreationEditorOperation(activeId, persist());
    },
    [
      activeId,
      persistedVisualLayerState,
      storyMaterialQuery,
      timelineItems,
      timelineOverlays,
      timelineShotIds,
      updateStoryTimelineMut,
    ]
  );

  const timelineLayoutRows = useMemo(
    () => buildTimelineLayout(timelineItems),
    [timelineItems]
  );

  const timelineResolverShots = useMemo(
    () =>
      new Map<string, TimelineResolverShot>(
        (storyMaterialQuery.data?.shots ?? []).map(shot => [
          shot.stableShotId,
          {
            currentImageId: shot.currentImage?.id ?? null,
            currentVideoDurationSec: shot.currentVideo?.durationSec ?? null,
          },
        ])
      ),
    [storyMaterialQuery.data?.shots]
  );

  const resolveTimelineFrameSource = useCallback(
    (timelineFrame: number): CreationTimelineFrameResolution =>
      resolveTimelineFrameSourceFrom({
        rows: timelineLayoutRows,
        shotsById: timelineResolverShots,
        overlays: timelineOverlays,
        hiddenVisualLayers: timelineVisualLayerState.hidden,
        timelineFrame,
      }),
    [
      timelineLayoutRows,
      timelineOverlays,
      timelineResolverShots,
      timelineVisualLayerState.hidden,
    ]
  );

  const [timelineWritePending, setTimelineWritePending] = useState(false);
  const timelineWriteLockRef = useRef(
    createTimelineWriteLock(setTimelineWritePending)
  );

  const previewTimelineGroup = useCallback(
    (sourceShotId: string, direction: "left" | "right"): TimelineGroupPreview =>
      previewTimelineGroupFrom({
        rows: timelineLayoutRows,
        sourceShotId,
        direction,
      }),
    [timelineLayoutRows]
  );


  // 时间线领域命令的客户端住在自己的文件里（见 useTimelineCommands）：
  // 它是一层独立职责，不是本 Context 的一部分。
  const {
    moveTimelineGroup,
    moveTimelineShot,
    addTimelineAnchorAtFrame,
    removeTimelineAnchorFromShot,
    trimTimelineItemEdge,
    rollTimelineJoin,
    detachTimelineMagnet,
    setTimelineShotDuration,
    updateTimelineImageTransform,
    manageTimelineVisualLayer,
    addShotToTimeline: addShotToTimelineById,
    removeShotFromTimeline,
    moveShotInTimeline,
    reorderShotInTimeline: reorderShotInTimelineCommand,
    resetTimelineShots,
    removeTimelineVideoClip,
    undoVisualEdit,
    updateTimelineVideoEdit,
    pasteVisualImage,
    deleteVisualObject,
  } = useTimelineCommands({
    activeStoryId: activeId,
    refetchStoryMaterial: storyMaterialQuery.refetch,
    writeLock: timelineWriteLockRef.current,
  });

  // 这两个包一层只为保住既有消费者的签名：shotNo → stableShotId 的解析要用
  // shots，属于本 Context 的数据；命令本身只认稳定镜头 id。
  const addShotToTimeline = useCallback(
    (shotNo: number, stableShotId?: string | null) => {
      const shotId =
        normalizeShotIdentity(stableShotId) ??
        shots
          .map(creationTimelineShotId)
          .find((_, index) => shots[index]?.shotNo === shotNo);
      if (!shotId) return;
      void addShotToTimelineById(shotId);
    },
    [addShotToTimelineById, shots]
  );

  const reorderShotInTimeline = useCallback(
    async (sourceShotId: string, targetShotId: string): Promise<void> => {
      await reorderShotInTimelineCommand(sourceShotId, targetShotId);
    },
    [reorderShotInTimelineCommand]
  );
  const selectedShot = useMemo(
    () => shots.find(shot => shot.shotNo === selectedShotNo) ?? null,
    [selectedShotNo, shots]
  );
  const processingVideoTakeIds = useMemo(() => {
    return videoTakeIdsToRefresh(shots, recentVideoTakeIds);
  }, [recentVideoTakeIds, shots]);
  const processingVideoTakeKey = processingVideoTakeIds.join(",");

  const watchVideoTake = useCallback(
    (takeId: number, status: VideoTakeStatus) => {
      if (isVideoTakeTerminal(status)) return;
      setRecentVideoTakeIds(current =>
        current.includes(takeId) ? current : [...current, takeId]
      );
    },
    []
  );

  useEffect(() => {
    if (recentVideoTakeIds.length === 0) return;
    const statusById = new Map<number, VideoTakeStatus>();
    for (const shot of shots) {
      for (const take of shot.videoTakes ?? []) {
        statusById.set(take.id, take.status);
      }
    }
    setRecentVideoTakeIds(current => {
      const next = current.filter(takeId => {
        const status = statusById.get(takeId);
        return status == null || !isVideoTakeTerminal(status);
      });
      return next.length === current.length ? current : next;
    });
  }, [recentVideoTakeIds, shots]);

  /**
   * 职责：串行提交一条镜头命令，并以服务端返回快照统一刷新 spine 与查询缓存。
   * 调用方：`updatePersistedShotFields`、`updateShotDuration`、`updatePromptOverride`、`rerenderShot`。
   * 下游：调用 `storyAgent.updateStoryShotFields`，不再发送整份 Story body。
   */
  const persistStoryShotUpdate = async (
    stableShotId: string,
    update: StoryShotCommandUpdate
  ) => {
    const storyId = activeId;
    const targetStableShotId = normalizeShotIdentity(stableShotId);
    if (storyId == null || !targetStableShotId) {
      throw new Error("故事或镜头身份无效，无法保存");
    }
    const save = async () => {
      const result = await updateStoryShotFieldsMut.mutateAsync({
        storyId,
        stableShotId: targetStableShotId,
        ...update,
      });
      if (result.status !== "ok" || !result.story) {
        throw new Error(
          result.status === "error" ? result.error : "镜头保存失败"
        );
      }
      const savedBody =
        result.story.body &&
        typeof result.story.body === "object" &&
        !Array.isArray(result.story.body)
          ? (result.story.body as Record<string, unknown>)
          : null;
      const savedShots = Array.isArray(savedBody?.shots) ? savedBody.shots : [];
      const savedShot = savedShots.find((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
        return shotIdentityFromShot(raw, index) === targetStableShotId;
      }) as Record<string, unknown> | undefined;
      if (!savedShot) throw new Error("服务器没有返回已保存的镜头");

      if (activeStoryIdRef.current === storyId) {
        setCanonicalStoryShots(normalizeStoryShots(savedBody));
        if (typeof result.story.revision === "number") {
          setSpineServerRevision(result.story.revision);
        }
      }
      await Promise.all([
        utils.storyAgent.storyGet.invalidate({ id: storyId }),
        utils.storyAgent.storyList.invalidate(),
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
      ]);
      await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
      return savedShot;
    };
    const queued = storyShotSaveQueueRef.current.then(save, save);
    storyShotSaveQueueRef.current = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  };

  /**
   * 职责：把已保存的镜头字段变化转换为可确认的提示词候选。
   * 调用方：`updatePersistedShotFields` 在镜头命令成功后调用。
   * 下游：调用 prompt-lineage 的 reject/create mutation；失败不回滚镜头字段。
   */
  const proposeEditPromptCandidates = async (
    changes: ShotFieldChange[],
    aggregate: StoryPromptAggregate
  ) => {
    const storyId = activeId;
    if (storyId == null || changes.length === 0) return;
    try {
      const plans = resolveEditCandidatePlans({ changes, aggregate });
      let expectedVersion = aggregate.state.version;
      for (const plan of plans) {
        if (plan.supersedesRevisionId != null) {
          const rejected = await rejectPromptCandidateMut.mutateAsync({
            storyId,
            candidateRevisionId: plan.supersedesRevisionId,
            expectedVersion,
          });
          expectedVersion = rejected.version;
        }
        const created = await promptCandidateMut.mutateAsync({
          storyId,
          nodeId: plan.nodeId,
          targetStableShotId: plan.stableShotId,
          content: plan.content,
          reason: plan.reason,
          // 用户直接打字改的字段，不是 agent 推断。
          authorType: "user",
          expectedVersion,
        });
        expectedVersion = created.version;
      }
      void promptLineageQuery.refetch();
    } catch (error) {
      console.warn(
        "[creationEditor] 阶段D 候选提议落库失败（不影响镜头表本身）：",
        error
      );
    }
  };

  /**
   * 职责：镜头字段编辑的客户端唯一入口，串行提交并用服务端快照回灌 spine。
   * 调用方：StoryboardReviewBoard、ShotMaterialBasket 等编辑面板。
   * 下游：调用 `persistStoryShotUpdate`，保存成功后再提议提示词候选。
   */
  const updatePersistedShotFields = async (
    stableShotId: string,
    patch: Partial<Record<StoryShotEditableField, string>>
  ) => {
    const storyId = activeId;
    const targetStableShotId = normalizeShotIdentity(stableShotId);
    if (storyId == null || !targetStableShotId) {
      throw new Error("故事或镜头身份无效，无法保存");
    }
    const previousShot = canonicalStoryShots.find(
      (shot, index) => shotIdentityFromShot(shot, index) === targetStableShotId
    ) as Record<string, unknown> | undefined;
    // 必须在镜头命令落库之前发起，否则谱系迁移会把本次编辑吸收为新基线。
    const preEditProjection = utils.promptLineage.getStoryProjection
      .fetch({ storyId })
      .catch(() => null);
    const savedShot = await persistStoryShotUpdate(targetStableShotId, {
      patch,
    });
    if (
      !Object.entries(patch).every(
        ([field, value]) => savedShot[field] === value
      )
    ) {
      throw new Error("服务器没有确认镜头字段，已保留为未保存状态");
    }
    const loaded = await preEditProjection;
    if (loaded?.mode === "lineage") {
      void proposeEditPromptCandidates(
        Object.entries(patch).flatMap(([field, value]) =>
          value == null
            ? []
            : [
                {
                  stableShotId: targetStableShotId,
                  previousValue:
                    previousShot != null
                      ? String(previousShot[field] ?? "")
                      : undefined,
                  nextValue: value,
                  field,
                },
              ]
        ),
        loaded.projection
      );
    }
  };

  /**
   * 职责：把单字段编辑适配为批量 patch 命令，避免维护第二套保存逻辑。
   * 调用方：只编辑一个单元格的镜头面板。
   * 下游：仅调用 `updatePersistedShotFields`。
   */
  const updatePersistedShotField = async (
    stableShotId: string,
    field: StoryShotEditableField,
    value: string
  ) => updatePersistedShotFields(stableShotId, { [field]: value });

  const generateShotVoice = async (stableShotId: string, text: string) => {
    const storyId = activeId;
    if (storyId == null) throw new Error("故事尚未加载，无法生成旁白");
    setGeneratingVoiceShotIds(current =>
      current.includes(stableShotId) ? current : [...current, stableShotId]
    );
    try {
      const result = await generateStoryShotVoiceMut.mutateAsync({
        storyId,
        stableShotId,
        text,
      });
      if (result.status !== "ok" || !result.story) {
        throw new Error(
          result.status === "error" ? result.error : "旁白生成后保存失败"
        );
      }
      const savedBody =
        result.story.body &&
        typeof result.story.body === "object" &&
        !Array.isArray(result.story.body)
          ? (result.story.body as Record<string, unknown>)
          : null;
      if (activeStoryIdRef.current === storyId) {
        setCanonicalStoryShots(normalizeStoryShots(savedBody));
        if (typeof result.story.revision === "number") {
          setSpineServerRevision(result.story.revision);
        }
      }
      await Promise.all([
        utils.storyAgent.storyGet.invalidate({ id: storyId }),
        utils.storyAgent.storyList.invalidate(),
      ]);
      await storyQuery.refetch();
      return {
        audioUrl: result.audioUrl,
        provider: result.provider,
        voice: result.voice,
      };
    } finally {
      setGeneratingVoiceShotIds(current =>
        current.filter(identity => identity !== stableShotId)
      );
    }
  };

  const restoreStoryboardFieldVersion = async (
    field: StoryboardVersionedField,
    revision: number
  ) => {
    const storyId = activeId;
    if (storyId == null) throw new Error("故事尚未加载，无法恢复版本");
    const result = await restoreStoryShotFieldVersionMut.mutateAsync({
      storyId,
      field,
      revision,
    });
    if (result.status !== "ok" || !result.story) {
      throw new Error(
        result.status === "error" ? result.error : "故事版版本恢复失败"
      );
    }
    const savedBody =
      result.story.body &&
      typeof result.story.body === "object" &&
      !Array.isArray(result.story.body)
        ? (result.story.body as Record<string, unknown>)
        : null;
    if (activeStoryIdRef.current === storyId) {
      setCanonicalStoryShots(normalizeStoryShots(savedBody));
      if (typeof result.story.revision === "number") {
        setSpineServerRevision(result.story.revision);
      }
    }
    await Promise.all([
      utils.storyAgent.storyGet.invalidate({ id: storyId }),
      utils.storyAgent.storyList.invalidate(),
      utils.storyAgent.storyMaterialState.invalidate({ storyId }),
    ]);
    await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
  };

  // ── 阶段 E：确认/放弃候选 ──
  // 用 promptLineageQuery.data 里已经订阅好的版本号，不额外发一次 fetch——
  // 跟阶段 D 的 proposeEditPromptCandidates 不同，这两个是用户主动点按钮
  // 触发的操作，一旦并发冲突（expectedVersion 不匹配）应该让用户看见真实
  // 错误，而不是静默吞掉重试。
  const confirmPromptCandidate = async (candidateRevisionId: number) => {
    const storyId = activeId;
    if (storyId == null || promptLineageQuery.data?.mode !== "lineage") {
      throw new Error("故事提示词尚未初始化，无法确认候选");
    }
    const result = await confirmPromptCandidateMut.mutateAsync({
      storyId,
      candidateRevisionId,
      expectedVersion: promptLineageQuery.data.projection.state.version,
    });
    // 服务端确认候选时会把确认值写回 stories.body 的镜头字段（见
    // promptLineage router 的 writeConfirmedCandidateToShot）。本地的 spine
    // 快照在 mergeCanonicalStoryShots 里**优先级高于** body，所以只 refetch
    // storyQuery 不够——不同步 spine 的话，故事版会继续显示旧值，出图也继续用
    // 旧值，回写等于白做。
    if (result.writeback?.status === "applied") {
      const refreshed = await storyQuery.refetch();
      const savedBody =
        refreshed.data?.body &&
        typeof refreshed.data.body === "object" &&
        !Array.isArray(refreshed.data.body)
          ? (refreshed.data.body as Record<string, unknown>)
          : null;
      if (savedBody) setCanonicalStoryShots(normalizeStoryShots(savedBody));
      await storyMaterialQuery.refetch();
    }
    await promptLineageQuery.refetch();
    // 确认本身已经提交成功，不可回滚；但镜头表没跟上必须让用户看见，
    // 否则又变回「点了确认，出图毫无变化，且不报错」。
    if (result.writeback?.status === "failed") {
      throw new Error(
        `候选已确认，但写回镜头表失败：${result.writeback.error}`
      );
    }
  };

  const rejectPromptCandidate = async (candidateRevisionId: number) => {
    const storyId = activeId;
    if (storyId == null || promptLineageQuery.data?.mode !== "lineage") {
      throw new Error("故事提示词尚未初始化，无法放弃候选");
    }
    await rejectPromptCandidateMut.mutateAsync({
      storyId,
      candidateRevisionId,
      expectedVersion: promptLineageQuery.data.projection.state.version,
    });
    await promptLineageQuery.refetch();
  };

  const insertPersistedShotAfterDetailed = async (
    stableShotId: string,
    dialogue = "",
    placement?: {
      timelineFrame: number;
      visualLayer: number;
      referencedImageId?: number;
    }
  ) => {
    if (activeId == null) throw new Error("故事尚未加载，无法添加镜头");
    const result = await insertStoryShotAfterMut.mutateAsync({
      storyId: activeId,
      stableShotId,
      dialogue,
      ...placement,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "添加镜头失败");
    }
    const savedBody =
      result.story?.body &&
      typeof result.story.body === "object" &&
      !Array.isArray(result.story.body)
        ? (result.story.body as Record<string, unknown>)
        : null;
    if (savedBody && Array.isArray(savedBody.shots)) {
      setCanonicalStoryShots(normalizeStoryShots(savedBody));
    }
    if (result.story && typeof result.story.revision === "number") {
      setSpineServerRevision(result.story.revision);
    }
    await Promise.all([
      utils.storyAgent.storyGet.invalidate({ id: activeId }),
      utils.storyAgent.storyList.invalidate(),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
    await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
    const insertedStableShotId = normalizeShotIdentity(
      result.insertedStableShotId
    );
    if (!insertedStableShotId) {
      throw new Error("新镜头已创建，但无法确认它的稳定身份");
    }
    return {
      shotNo: result.insertedShotNo,
      stableShotId: insertedStableShotId,
    };
  };

  const insertPersistedShotAfter = async (
    stableShotId: string,
    dialogue = ""
  ) => (await insertPersistedShotAfterDetailed(stableShotId, dialogue)).shotNo;

  const insertTimelineShotAt = async (input: {
    timelineFrame: number;
    visualLayer: number;
    dialogue?: string;
    referencedImageId?: number;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法添加镜头");
    const targetFrame = Math.max(0, Math.round(input.timelineFrame));
    const targetLayer = Math.max(0, Math.round(input.visualLayer));
    const resolvedTarget = resolveTimelineFrame(
      timelineLayoutRows,
      targetFrame
    );
    const previousRow = [...timelineLayoutRows]
      .filter(row => row.endFrame <= targetFrame)
      .sort((left, right) => right.endFrame - left.endFrame)[0];
    const anchorStableShotId =
      resolvedTarget.kind === "shot"
        ? resolvedTarget.row.item.stableShotId
        : (previousRow?.item.stableShotId ??
          timelineLayoutRows[0]?.item.stableShotId);
    if (!anchorStableShotId) throw new Error("故事还没有可作为插入锚点的镜头");
    const inserted = await insertPersistedShotAfterDetailed(
      anchorStableShotId,
      input.dialogue ?? "",
      {
        timelineFrame: targetFrame,
        visualLayer: targetLayer,
        referencedImageId: input.referencedImageId,
      }
    );
    return { shotNo: inserted.shotNo, stableShotId: inserted.stableShotId };
  };

  const deletePersistedShot = async (stableShotId: string) => {
    if (activeId == null) throw new Error("故事尚未加载，无法删除镜头");
    const result = await deleteStoryShotMut.mutateAsync({
      storyId: activeId,
      stableShotId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "删除镜头失败");
    }
    recordDeletedStoryShotUndo(activeId, {
      deletedShot: result.deletedShot,
      deletedIndex: result.deletedIndex,
      deletedStableShotId: result.deletedStableShotId,
      expectedRevision: result.deletedAtRevision,
      afterDeleteBody: result.afterDeleteBody,
    });
    const savedBody =
      result.story?.body &&
      typeof result.story.body === "object" &&
      !Array.isArray(result.story.body)
        ? (result.story.body as Record<string, unknown>)
        : null;
    if (savedBody && Array.isArray(savedBody.shots)) {
      setCanonicalStoryShots(normalizeStoryShots(savedBody));
    }
    if (result.story && typeof result.story.revision === "number") {
      setSpineServerRevision(result.story.revision);
    }
    await Promise.all([
      utils.storyAgent.storyGet.invalidate({ id: activeId }),
      utils.storyAgent.storyList.invalidate(),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
    await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
    return result.nextSelectedShotNo;
  };

  const discardPersistedShot = async (stableShotId: string) => {
    if (activeId == null) throw new Error("故事尚未加载，无法清理镜头");
    const result = await deleteStoryShotMut.mutateAsync({
      storyId: activeId,
      stableShotId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "清理未完成镜头失败");
    }
    await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
  };

  const commitInsertedTimelineShotUndo = (stableShotId: string) => {
    if (activeId == null) return;
    recordInsertedStoryShotUndo(activeId, stableShotId);
  };

  /**
   * 职责：同时更新镜头时长元数据和 timeline 计划时长，不发送整份 Story body。
   * 调用方：AnimaticPanel 的拖拽和时长输入控件。
   * 下游：调用 `persistStoryShotUpdate`，时长那一半走 setShotDuration 窄命令。
   */
  const updateShotDuration = async (shotNo: number, durationMs: number) => {
    const normalizedDurationMs = Math.min(
      MAX_SHOT_DURATION_MS,
      Math.max(MIN_SHOT_DURATION_MS, Math.round(durationMs))
    );
    const targetShot = shots.find(shot => shot.shotNo === shotNo);
    const targetShotId = targetShot ? shotIdentityFromShot(targetShot) : null;
    if (!targetShot || !targetShotId) throw new Error(`找不到镜头 ${shotNo}`);
    const savedShot = await persistStoryShotUpdate(targetShotId, {
      metadata: { durationMs: normalizedDurationMs },
    });
    if (savedShot.durationMs !== normalizedDurationMs) {
      throw new Error("服务器没有确认镜头时长");
    }
    // 时长那一半交给窄命令：服务端自己判断要不要写，客户端不再比对整份 items。
    await setTimelineShotDuration(
      creationTimelineShotId(targetShot),
      normalizedDurationMs
    );
  };

  /**
   * 职责：只合并目标镜头的单个提示词维度覆盖，保留其他维度和兄弟镜头。
   * 调用方：PromptTablePanel 的旧版提示词编辑流程。
   * 下游：仅调用 `persistStoryShotUpdate` 的 `promptOverride` 元数据命令。
   */
  const updatePromptOverride = async (
    shotNo: number,
    dimension: string,
    override: PromptOverride
  ) => {
    const targetShot = shots.find(shot => shot.shotNo === shotNo);
    const targetShotId = targetShot ? shotIdentityFromShot(targetShot) : null;
    if (!targetShotId) throw new Error(`找不到镜头 ${shotNo}`);
    const savedShot = await persistStoryShotUpdate(targetShotId, {
      metadata: {
        promptOverride: { dimension, override },
      },
    });
    const savedOverrides =
      savedShot.promptOverrides &&
      typeof savedShot.promptOverrides === "object" &&
      !Array.isArray(savedShot.promptOverrides)
        ? (savedShot.promptOverrides as Record<string, unknown>)
        : {};
    const savedDimension =
      savedOverrides[dimension] &&
      typeof savedOverrides[dimension] === "object" &&
      !Array.isArray(savedOverrides[dimension])
        ? (savedOverrides[dimension] as Record<string, unknown>)
        : {};
    if (
      !Object.entries(override).every(
        ([field, value]) => savedDimension[field] === value
      )
    ) {
      throw new Error("服务器没有确认提示词覆盖");
    }
  };

  /**
   * 职责：重渲目标镜头，并把本次使用的镜头快照与提示词记录原子落库。
   * 调用方：PromptTablePanel、StoryboardReviewBoard 的单图或四图重渲操作。
   * 下游：调用图片生成服务；旧版提示词模式再调用 `persistStoryShotUpdate`。
   */
  const rerenderShot = async (
    shotNo: number,
    rows: PromptRow[],
    reference?: RerenderReference,
    options?: {
      explicitInstruction?: string;
      exactFrameEdit?: boolean;
      candidateCount?: 4;
      costConfirmation?: {
        accepted: true;
        estimatedCny: number;
      };
      imageProvider?: ImageProvider;
      editMaskImageUrl?: string;
    }
  ) => {
    if (activeId == null) throw new Error("故事尚未加载，无法重渲");
    const shot = shots.find(item => item.shotNo === shotNo);
    const targetStableShotId = shot ? shotIdentityFromShot(shot) : null;
    if (!shot || !targetStableShotId) throw new Error(`找不到镜头 ${shotNo}`);
    setRerenderError(null);
    setRerenderingShotNos(current => addShotToRenderSlots(current, shotNo));
    try {
      let batch;
      if (options?.candidateCount === 4) {
        if (!options.explicitInstruction) {
          throw new Error("四张候选图缺少图片要求");
        }
        if (!options.costConfirmation) {
          throw new Error("四张候选图尚未确认费用");
        }
        batch = await rerenderShotImageCandidates({
          storyId: activeId,
          shot,
          rows,
          reference,
          explicitInstruction: options.explicitInstruction,
          exactFrameEdit: options.exactFrameEdit,
          candidateCount: options.candidateCount,
          costConfirmation: options.costConfirmation,
          generate: input => generateForMobileMut.mutateAsync(input),
        });
      } else {
        batch = {
          results: [
            await rerenderShotImage({
              storyId: activeId,
              shot,
              rows,
              reference,
              explicitInstruction: options?.explicitInstruction,
              exactFrameEdit: options?.exactFrameEdit,
              costConfirmation: options?.costConfirmation,
              imageProvider: options?.imageProvider,
              editMaskImageUrl: options?.editMaskImageUrl,
              generate: input => generateForMobileMut.mutateAsync(input),
            }),
          ],
          generatedCount: 1,
          failedCount: 0,
        };
      }
      const result = batch.results.at(-1);
      if (!result) throw new Error("图片生成没有返回候选结果");
      if (promptLineageQuery.data?.mode !== "lineage") {
        const compiled = compilePromptRecipe({ shot, rows });
        const patch = Object.fromEntries(
          Object.entries({
            subject: shot.subject,
            action: shot.action,
            dialogue: shot.dialogue,
            shotType: shot.shotType,
            beat: shot.beat,
            cameraAngle: shot.cameraAngle,
            cameraMove: shot.cameraMove,
            location: shot.location,
            timeLight: shot.timeLight,
            mood: shot.mood,
            sound: shot.sound,
            styleRef: shot.styleRef,
            note: shot.note,
            emotion: shot.emotion,
            intent: shot.intent,
            rationale: shot.rationale,
            videoPrompt: shot.videoPrompt,
            videoStart: shot.videoStart,
            videoEnd: shot.videoEnd,
            transitionIn: shot.transitionIn,
            transitionOut: shot.transitionOut,
            negativePrompt: shot.negativePrompt,
          }).filter(([, value]) => typeof value === "string")
        ) as Partial<Record<StoryShotEditableField, string>>;
        const promptRun: PromptRunRecord = {
          finalPrompt: result.prompt || compiled.finalPrompt,
          generatedAt: Date.now(),
          imageId: result.imageId,
          imageUrl: result.imageUrl,
          source: "prompt-table-rerender",
          usedDimensions: compiled.usedDimensions,
        };
        const savedShot = await persistStoryShotUpdate(targetStableShotId, {
          patch,
          metadata: { promptRun },
        });
        const savedPromptRun =
          savedShot.promptRun &&
          typeof savedShot.promptRun === "object" &&
          !Array.isArray(savedShot.promptRun)
            ? (savedShot.promptRun as Record<string, unknown>)
            : null;
        if (
          savedPromptRun?.generatedAt !== promptRun.generatedAt ||
          savedPromptRun.imageId !== promptRun.imageId
        ) {
          throw new Error("服务器没有确认本次重渲记录");
        }
      }
      await Promise.all([
        storyImagesQuery.refetch(),
        storyMaterialQuery.refetch(),
        utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
      ]);
      return {
        generatedCount: batch.generatedCount,
        failedCount: batch.failedCount,
        imageId: result.imageId,
        imageUrl: result.imageUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片生成失败";
      setRerenderError(message);
      await imageProviderStatusQuery.refetch();
      throw error;
    } finally {
      setRerenderingShotNos(current =>
        removeShotFromRenderSlots(current, shotNo)
      );
    }
  };

  const promoteFrameCrop = async (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法保存首帧");
    setPromotingFrameCropShotNo(input.shotNo);
    try {
      const result = await promoteFrameCropMut.mutateAsync({
        storyId: activeId,
        ...input,
      });
      if (result.status !== "ok" || !result.imageUrl || !result.imageId) {
        throw new Error(result.error || "首帧保存失败");
      }
      await Promise.all([
        storyImagesQuery.refetch(),
        storyMaterialQuery.refetch(),
        utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
      ]);
      return { imageId: result.imageId, imageUrl: result.imageUrl };
    } finally {
      setPromotingFrameCropShotNo(null);
    }
  };

  const promoteStoryImage = async (imageId: number) => {
    if (activeId == null) throw new Error("故事尚未加载，无法选择图片");
    const result = await promoteStoryImageMut.mutateAsync({
      storyId: activeId,
      imageId,
    });
    if (result.status !== "ok") throw new Error(result.error || "图片选择失败");
    await Promise.all([
      storyImagesQuery.refetch(),
      storyMaterialQuery.refetch(),
    ]);
  };

  const assignStoryImageToShot = async (input: {
    imageId: number;
    targetStableShotId: string;
    preserveTimelineSelection?: boolean;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法绑定图片");
    const result = await assignStoryImageToShotMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "图片绑定失败");
    }
    await Promise.all([
      storyImagesQuery.refetch(),
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
  };

  const deleteStoryImage = async (imageId: number) => {
    if (activeId == null) throw new Error("故事尚未加载，无法删除图片");
    const result = await deleteStoryImageMut.mutateAsync({
      storyId: activeId,
      imageId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "图片删除失败");
    }
    await Promise.all([
      utils.storyAgent.storyGet.invalidate({ id: activeId }),
      utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
    await Promise.all([
      storyQuery.refetch(),
      storyImagesQuery.refetch(),
      storyMaterialQuery.refetch(),
    ]);
  };

  const deleteExtractedFrame = async (imageId: number) => {
    if (activeId == null) throw new Error("故事尚未加载，无法删除抽帧");
    const result = await deleteExtractedFrameMut.mutateAsync({
      storyId: activeId,
      imageId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "抽帧删除失败");
    }
    await Promise.all([
      utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
    await Promise.all([
      storyImagesQuery.refetch(),
      storyMaterialQuery.refetch(),
    ]);
  };

  const importStoryMaterial = async (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
    preserveTimelineSelection?: boolean;
  }): Promise<ImportedStoryMaterialResult> => {
    if (activeId == null) throw new Error("故事尚未加载，无法导入素材");
    const result = await importStoryMaterialMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "素材导入失败");
    }
    // 图片导入不应该等待视频列表，反之亦然。之前把三类 refetch 和三次
    // invalidate 全绑进一个 Promise.all，任何一条慢请求都会让“提帧中…”永不结束。
    await waitForMaterialListRefresh(
      result.kind === "image"
        ? storyImagesQuery.refetch()
        : storyVideoAssetsQuery.refetch()
    );
    void storyMaterialQuery.refetch().catch(error => {
      console.warn(
        "[creation-editor] material refresh after import failed",
        error
      );
    });
    if (result.kind === "image") {
      return {
        kind: "image",
        imageId: result.imageId,
        imageUrl: result.imageUrl,
      };
    }
    return {
      kind: "video",
      takeId: result.takeId,
      videoUrl: result.videoUrl,
      stableShotId: result.stableShotId,
      plannedDurationSec: result.plannedDurationSec,
    };
  };

  const attachChatCutXml = async (xml: string) => {
    if (activeId == null) throw new Error("故事尚未加载，无法同步 ChatCut XML");
    const result = await attachChatCutXmlMut.mutateAsync({
      storyId: activeId,
      xml,
    });
    await Promise.all([
      storyQuery.refetch(),
      storyMaterialQuery.refetch(),
      storyListQuery.refetch(),
      utils.storyAgent.storyList.invalidate(),
    ]);
    return {
      primaryClipCount: result.summary.primaryClipCount,
      audioClipCount: result.summary.audioClipCount,
      width: result.summary.width,
      height: result.summary.height,
    };
  };

  const adviseStoryImages = async (input: {
    imageIds: number[];
  }): Promise<StoryImageAdviceResult> => {
    if (activeId == null) throw new Error("故事尚未加载，无法分析素材");
    return adviseStoryImagesMut.mutateAsync({
      storyId: activeId,
      imageIds: input.imageIds,
    });
  };

  const applyStoryImageAdvice = async (input: {
    imageId: number;
    targetShotNo: number;
    targetStableShotId: string;
    reason?: string;
    videoDirection: StoryImageMaterialAdvice["videoDirection"];
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法归类素材");
    const result = await applyImageAdviceMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") throw new Error(result.message);
    await Promise.all([
      storyQuery.refetch(),
      storyImagesQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyGet.invalidate({ id: activeId }),
      utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
  };

  const generateShotVideo = async (input: {
    shotNo: number;
    imageId: number;
    characterReferenceImageUrl?: string;
    storyStyleReferenceImageUrl?: string;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: ShotVideoMotion;
    aspectRatio?: "1:1";
    directorPromptApproved?: boolean;
    rerenderRequestId?: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法生成视频");
    setGeneratingVideoShotNos(current =>
      addShotToRenderSlots(current, input.shotNo)
    );
    try {
      const result = await generateShotVideoMut.mutateAsync({
        storyId: activeId,
        stableShotId: shots.find(shot => shot.shotNo === input.shotNo)
          ?.stableShotId,
        ...adjacentVideoReferenceImageIds(shots, input.shotNo),
        ...input,
      });
      if (result.status !== "ok") {
        throw new Error(result.error || "视频生成失败");
      }
      watchVideoTake(result.takeId, result.videoStatus);
      await storyVideoAssetsQuery.refetch();
      await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
      await storyMaterialQuery.refetch();
      return {
        takeId: result.takeId,
        videoStatus: result.videoStatus,
        videoUrl: result.videoUrl,
        taskId: result.taskId,
        prompt: result.prompt,
        estimatedCny: result.estimatedCny,
      };
    } finally {
      setGeneratingVideoShotNos(current =>
        removeShotFromRenderSlots(current, input.shotNo)
      );
    }
  };

  const estimateStartEndShotVideo = async (
    stableShotId: string
  ): Promise<StartEndShotVideoEstimate> => {
    if (activeId == null) throw new Error("故事尚未加载，无法估算视频费用");
    const result = await estimateStartEndShotVideoMut.mutateAsync({
      storyId: activeId,
      stableShotId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "首尾帧视频报价失败");
    }
    return result.estimate;
  };

  const generateStartEndShotVideo = async (input: {
    shotNo: number;
    stableShotId: string;
    rerenderRequestId?: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法生成视频");
    setGeneratingVideoShotNos(current =>
      addShotToRenderSlots(current, input.shotNo)
    );
    try {
      const result = await submitStartEndShotVideoMut.mutateAsync({
        storyId: activeId,
        stableShotId: input.stableShotId,
        rerenderRequestId: input.rerenderRequestId,
        costConfirmation: input.costConfirmation,
      });
      if (result.status !== "ok") {
        throw new Error(result.error || "首尾帧视频生成失败");
      }
      watchVideoTake(result.takeId, result.videoStatus);
      await Promise.all([
        storyVideoAssetsQuery.refetch(),
        storyMaterialQuery.refetch(),
        utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
      ]);
      return {
        takeId: result.takeId,
        videoStatus: result.videoStatus,
        videoUrl: result.videoUrl,
        taskId: result.taskId,
        prompt: result.prompt,
        estimatedCny: result.estimatedCny,
      };
    } finally {
      setGeneratingVideoShotNos(current =>
        removeShotFromRenderSlots(current, input.shotNo)
      );
    }
  };

  const analyzeShotVideoDirection = async (input: {
    shotNo: number;
    stableShotId: string;
    draftPrompt: string;
    subtitle?: string;
  }): Promise<ShotDirectorResult> => {
    if (activeId == null) throw new Error("故事尚未加载，无法分析镜头衔接");
    return analyzeShotVideoDirectionMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
  };

  const conformVideoTakes = async (input: {
    items: Array<{
      takeId: number;
      stableShotId: string;
      mode: VideoConformMode;
      cropPath?: VideoCropPath;
    }>;
    targetAspectRatio: VideoTargetAspectRatio;
  }): Promise<VideoConformBatchResult> => {
    if (activeId == null) throw new Error("故事尚未加载，无法统一视频尺寸");
    const result = await conformVideoTakesMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    await Promise.all([
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
    return {
      status: result.status,
      acceptedCount: result.acceptedCount,
      completedCount: result.completedCount,
      availableCount: result.availableCount,
      processingCount: result.processingCount,
      failedCount: result.failedCount,
      results: result.results.map(item =>
        item.status === "ok"
          ? {
              status: "ok" as const,
              sourceTakeId: item.sourceTakeId,
              stableShotId: item.stableShotId,
              takeId: item.take.id,
              videoStatus: item.take.status,
            }
          : item
      ),
    };
  };

  const analyzeShotConsistency = async (input: {
    anchorImageUrl?: string | null;
    targetImage?: {
      imageId: number;
      imageUrl: string;
      shotNo?: string | null;
    };
    maxShots?: number;
  }): Promise<ShotConsistencyAnalysis> => {
    if (activeId == null) throw new Error("故事尚未加载，无法做一致性识别");
    return analyzeShotConsistencyMut.mutateAsync({
      storyId: activeId,
      anchorImageUrl: input.anchorImageUrl ?? undefined,
      targetImage: input.targetImage,
      maxShots: input.maxShots,
    });
  };

  const refreshShotVideoStatus = async (takeId: number) => {
    if (activeId == null) throw new Error("故事尚未加载，无法刷新视频状态");
    const result = await refreshShotVideoStatusMut.mutateAsync({ takeId });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频状态刷新失败");
    }
    await storyVideoAssetsQuery.refetch();
    await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
    await storyMaterialQuery.refetch();
  };

  const markVideoTakeUnusable = async (
    takeId: number,
    sourceStoryId?: number | null
  ) => {
    if (activeId == null) throw new Error("故事尚未加载，无法标记视频 Take");
    const ownerStoryId = sourceStoryId ?? activeId;
    const result = await markVideoTakeUnusableMut.mutateAsync({
      storyId: ownerStoryId,
      takeId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频 Take 标记失败");
    }
    await Promise.all([
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
      ownerStoryId !== activeId
        ? utils.storyAgent.storyMaterialState.invalidate({
            storyId: ownerStoryId,
          })
        : Promise.resolve(),
      ownerStoryId !== activeId
        ? utils.storyAgent.storyVideoAssets.invalidate({
            storyId: ownerStoryId,
          })
        : Promise.resolve(),
    ]);
  };

  const adoptVideoTakeForShot = async (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法采用视频");
    const result = await adoptVideoTakeMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频采用失败");
    }
    await Promise.all([
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
    ]);
  };

  const reuseVideoTakeForShot = async (input: {
    sourceTakeId: number;
    targetStableShotId: string;
    plannedDurationSec: number;
  }): Promise<{ takeId: number }> => {
    if (activeId == null) throw new Error("故事尚未加载，无法复用视频");
    const result = await reuseVideoTakeMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频 Take 复用失败");
    }
    await Promise.all([
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
    return { takeId: result.take.id };
  };

  const appendTimelineVideoClip = async (input: {
    sourceTakeId: number;
    targetStableShotId: string;
    sourceStartSec: number;
    sourceEndSec: number;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
    targetOffsetMs?: number;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法追加视频片段");
    const result = await appendVideoTakeToTimelineMut.mutateAsync({
      storyId: activeId,
      expectedTimelineVersion: storyMaterialQuery.data?.timeline.version ?? 0,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频片段追加失败");
    }
    recordTimelineUndoSnapshot(activeId, result.beforeItems);
    await Promise.all([
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
  };

  const undoTimeline = useCallback(async (): Promise<boolean> => {
    if (activeId == null) return false;
    await waitForCreationEditorOperations(activeId);
    const entry = takeCreationEditorUndoEntry(activeId);
    if (!entry) return false;
    try {
      if (entry.kind === "timeline-command") {
        // 回退由服务端完成：客户端这一格只是占位，用来保住撤销顺序。
        const ok = entry.receipt
          ? (
              await undoVisualEditReceiptMut.mutateAsync({
                storyId: activeId,
                operation: {
                  editorSessionEpoch: entry.receipt.editorSessionEpoch,
                  operationId: entry.receipt.operationId,
                },
              })
            ).status === "ok"
          : await undoVisualEdit(activeId);
        if (!ok) throw new Error("撤销失败，剪辑已保留在撤销栈中");
        if (entry.receipt) await storyMaterialQuery.refetch();
      } else if (entry.kind === "timeline") {
        await saveTimelineItems(entry.items, {
          throwOnError: true,
          recordUndo: false,
          ...(entry.visualLayerState === undefined
            ? {}
            : { visualLayerState: entry.visualLayerState }),
          ...(entry.overlays === undefined ? {} : { overlays: entry.overlays }),
        });
      } else if (entry.kind === "deleted-story-shot") {
        const result = await restoreDeletedStoryShotMut.mutateAsync({
          storyId: activeId,
          deletedShot: entry.deletedShot,
          deletedIndex: entry.deletedIndex,
          deletedStableShotId: entry.deletedStableShotId,
          expectedRevision: entry.expectedRevision,
          afterDeleteBody: entry.afterDeleteBody,
        });
        if (result.status !== "ok") {
          throw new Error(result.error || "恢复镜头失败");
        }
        const savedBody =
          result.story?.body &&
          typeof result.story.body === "object" &&
          !Array.isArray(result.story.body)
            ? (result.story.body as Record<string, unknown>)
            : null;
        if (savedBody && Array.isArray(savedBody.shots)) {
          setCanonicalStoryShots(normalizeStoryShots(savedBody));
        }
        if (result.story && typeof result.story.revision === "number") {
          setSpineServerRevision(result.story.revision);
        }
        setSelectedShotNo(result.restoredShotNo);
        await Promise.all([
          utils.storyAgent.storyGet.invalidate({ id: activeId }),
          utils.storyAgent.storyList.invalidate(),
          utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
        ]);
        await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
      } else if (entry.kind === "inserted-story-shot") {
        await discardPersistedShot(entry.insertedStableShotId);
      } else {
        const result = await undoSplitStoryShotMut.mutateAsync({
          storyId: activeId,
          splitStableShotId: entry.splitStableShotId,
          beforeStoryBody: entry.beforeStoryBody,
          beforeTimelineItems: entry.beforeTimelineItems,
          expectedStoryRevision: entry.expectedStoryRevision,
          expectedTimelineVersion: entry.expectedTimelineVersion,
        });
        if (result.status !== "ok") {
          throw new Error(result.error || "撤销镜头拆分失败");
        }
        const savedBody =
          result.story?.body &&
          typeof result.story.body === "object" &&
          !Array.isArray(result.story.body)
            ? (result.story.body as Record<string, unknown>)
            : null;
        if (savedBody && Array.isArray(savedBody.shots)) {
          setCanonicalStoryShots(normalizeStoryShots(savedBody));
          setSpineServerRevision(Number(savedBody._revision) || 0);
        }
        setSelectedShotNo(entry.restoreShotNo);
        await Promise.all([
          utils.storyAgent.storyGet.invalidate({ id: activeId }),
          utils.storyAgent.storyList.invalidate(),
          utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
        ]);
        await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
      }
      return true;
    } catch (error) {
      if (entry.kind === "timeline-command") {
        // 服务端那一格在写入失败时自己放回去了，这里只补回客户端的占位。
        recordTimelineCommandUndo(activeId, entry.receipt);
      } else if (entry.kind === "timeline") {
        recordTimelineUndoSnapshot(activeId, entry.items);
      } else if (entry.kind === "deleted-story-shot") {
        recordDeletedStoryShotUndo(activeId, entry);
      } else if (entry.kind === "inserted-story-shot") {
        recordInsertedStoryShotUndo(activeId, entry.insertedStableShotId);
      } else {
        recordSplitStoryShotUndo(activeId, entry);
      }
      throw error;
    }
  }, [
    activeId,
    restoreDeletedStoryShotMut,
    undoSplitStoryShotMut,
    undoVisualEditReceiptMut,
    undoVisualEdit,
    saveTimelineItems,
    storyMaterialQuery,
    storyQuery,
    utils.storyAgent.storyGet,
    utils.storyAgent.storyList,
    utils.storyAgent.storyMaterialState,
  ]);

  useEffect(() => {
    if (activeId == null) return;
    return registerTimelineUndoExecutor(activeId, undoTimeline);
  }, [activeId, undoTimeline]);

  useEffect(() => {
    if (activeId == null || processingVideoTakeIds.length === 0) return;
    let cancelled = false;

    const refreshProcessingTakes = async () => {
      if (autoRefreshVideoRef.current) return;
      autoRefreshVideoRef.current = true;
      try {
        for (const takeId of processingVideoTakeIds) {
          if (cancelled) return;
          const refreshed = await refreshShotVideoStatusMut.mutateAsync({
            takeId,
          });
          if (
            refreshed.status === "ok" &&
            isVideoTakeTerminal(refreshed.videoStatus)
          ) {
            setRecentVideoTakeIds(current =>
              current.filter(candidate => candidate !== takeId)
            );
          }
        }
        if (!cancelled) {
          await Promise.all([
            storyVideoAssetsQuery.refetch(),
            storyMaterialQuery.refetch(),
            utils.storyAgent.storyVideoAssets.invalidate({
              storyId: activeId,
            }),
            utils.storyAgent.storyMaterialState.invalidate({
              storyId: activeId,
            }),
          ]);
        }
      } catch (error) {
        console.warn("auto refresh video take failed", error);
      } finally {
        autoRefreshVideoRef.current = false;
      }
    };

    void refreshProcessingTakes();
    const intervalId = window.setInterval(refreshProcessingTakes, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeId,
    processingVideoTakeKey,
    processingVideoTakeIds,
    refreshShotVideoStatusMut,
    storyMaterialQuery,
    storyVideoAssetsQuery,
    utils.storyAgent.storyMaterialState,
    utils.storyAgent.storyVideoAssets,
  ]);

  const createVideoTakeRange = async (input: {
    stableShotId: string;
    takeId: number;
    startSec: number;
    endSec: number;
    label?: string;
    useOnTimeline?: boolean;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法保存视频片段");
    const result = await createVideoTakeRangeMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "片段保存失败");
    }
    await storyVideoAssetsQuery.refetch();
    await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
  };

  const splitTimelineVideoClip = async (input: {
    stableShotId: string;
    cutFrame: number;
    takeStableShotId: string;
    existingClipId?: string | null;
    takeId: number;
    videoUrl: string;
    sourceStartSec: number;
    sourceEndSec: number;
    splitSourceSec: number;
    offsetMs: number;
    durationMs: number;
    splitOffsetMs: number;
    label: string;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
    overlayId?: string;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法切割视频");
    const revisionFromBody = (body: unknown) =>
      body && typeof body === "object" && !Array.isArray(body)
        ? Number((body as Record<string, unknown>)._revision) || 0
        : 0;
    const requestSplit = (
      expectedStoryRevision: number,
      expectedTimelineVersion: number
    ) =>
      splitStoryShotMut.mutateAsync({
        storyId: activeId,
        stableShotId: input.stableShotId,
        cutFrame: input.cutFrame,
        expectedStoryRevision,
        expectedTimelineVersion,
      });
    let timelineVersion = storyMaterialQuery.data?.timeline.version ?? 0;
    if (input.overlayId) {
      // 迁移到 overlay 当前真正所在的那一层，而不是写死的 1：图层排序之后
      // 遗留 overlay 可能已经被重编号，写死会让切割出来的镜头落在错误的层。
      const promotedOverlay = timelineOverlays.find(
        overlay => overlay.id === input.overlayId
      );
      const promotedLayer = promotedOverlay
        ? overlayVisualLayer(promotedOverlay)
        : 1;
      const promoted = await updateStoryTimelineMut.mutateAsync({
        storyId: activeId,
        expectedVersion: timelineVersion,
        items: timelineItems.map(item =>
          item.stableShotId === input.stableShotId
            ? { ...item, visualLayer: promotedLayer }
            : item
        ),
        overlays: timelineOverlays.filter(
          overlay => overlay.id !== input.overlayId
        ),
      });
      if (promoted.status !== "ok") {
        throw new Error(promoted.error || "历史覆盖视频迁移失败");
      }
      timelineVersion = promoted.timeline.version;
    }
    let result = await requestSplit(
      revisionFromBody(storyQuery.data?.body),
      timelineVersion
    );
    if (
      result.status !== "ok" &&
      /故事已经更新|时间线已经更新/.test(result.error || "")
    ) {
      const [freshStory, freshMaterial] = await Promise.all([
        storyQuery.refetch(),
        storyMaterialQuery.refetch(),
      ]);
      result = await requestSplit(
        revisionFromBody(freshStory.data?.body),
        freshMaterial.data?.timeline.version ?? 0
      );
    }
    if (result.status !== "ok") {
      throw new Error(result.error || "镜头拆分失败");
    }
    recordSplitStoryShotUndo(activeId, {
      splitStableShotId: result.splitStableShotId,
      beforeStoryBody: result.beforeStoryBody,
      beforeTimelineItems: result.beforeTimelineItems,
      expectedStoryRevision: result.expectedStoryRevision,
      expectedTimelineVersion: result.expectedTimelineVersion,
      restoreShotNo: Math.max(1, result.rightShotNo - 1),
    });
    const savedBody =
      result.story?.body &&
      typeof result.story.body === "object" &&
      !Array.isArray(result.story.body)
        ? (result.story.body as Record<string, unknown>)
        : null;
    if (savedBody && Array.isArray(savedBody.shots)) {
      setCanonicalStoryShots(normalizeStoryShots(savedBody));
      setSpineServerRevision(Number(savedBody._revision) || 0);
    }
    setSelectedShotNo(result.rightShotNo);
    await Promise.all([
      utils.storyAgent.storyGet.invalidate({ id: activeId }),
      utils.storyAgent.storyList.invalidate(),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
    ]);
    await Promise.all([
      storyQuery.refetch(),
      storyMaterialQuery.refetch(),
      storyVideoAssetsQuery.refetch(),
    ]);
  };
  /**
   * 服务端权威抽帧。位置相同的并发点击共享一个 Promise；如果网络在服务端
   * 已成功后断开，下一次点击沿用同一 requestId，回执会把成功结果原样重放。
   */
  const extractTimelineFrame = async (input: {
    timelineFrame: number;
    operationLayer: number;
  }): Promise<void> => {
    if (activeId == null) throw new Error("故事尚未加载，无法抽帧");
    const storyId = activeId;
    const storySessionToken = renderedExtractionStorySessionToken;
    const timelineFrame = Math.max(0, Math.round(input.timelineFrame));
    const operationLayer = Math.max(0, Math.round(input.operationLayer));
    const positionKey = `${storyId}:${timelineFrame}:${operationLayer}`;
    let intent = extractionIntentByPositionRef.current.get(positionKey);
    if (!intent) {
      intent = {
        requestId:
          globalThis.crypto?.randomUUID?.() ??
          `frame-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      };
      extractionIntentByPositionRef.current.set(positionKey, intent);
    }
    let inFlight = intent.inFlight;
    if (!inFlight) {
      const requestId = intent.requestId;
      const forgetCurrentIntent = () => {
        if (extractionIntentByPositionRef.current.get(positionKey) === intent) {
          extractionIntentByPositionRef.current.delete(positionKey);
        }
      };

      const promise = (async () => {
        const pollingStartedAt = Date.now();
        let pendingDelayMs = 1_000;
        while (true) {
          const result = await trackCreationEditorOperation(
            storyId,
            extractTimelineFrameMut.mutateAsync({
              storyId,
              requestId,
              timelineFrame,
              operationLayer,
            })
          );
          if (result.status === "pending") {
            if (Date.now() - pollingStartedAt >= 20_000) {
              throw new Error(
                `${result.message}；完成后再次点击会沿用同一次请求，不会重复创建`
              );
            }
            await new Promise(resolve =>
              globalThis.setTimeout(resolve, pendingDelayMs)
            );
            pendingDelayMs = Math.min(4_000, pendingDelayMs * 2);
            continue;
          }
          if (result.status === "error") {
            if (result.requestDisposition === "replace") {
              forgetCurrentIntent();
            }
            throw new Error(result.error);
          }

          await Promise.all([
            utils.storyAgent.storyMaterialState.invalidate({ storyId }),
            utils.storyAgent.storyImages.invalidate({ storyId }),
          ]);
          forgetCurrentIntent();
          return;
        }
      })();
      inFlight = {
        promise,
        originStorySessionToken: storySessionToken,
        undoRecorded: false,
      };
      intent.inFlight = inFlight;
    }
    try {
      await inFlight.promise;
      if (
        activeStoryIdRef.current === storyId &&
        committedExtractionStorySessionTokenRef.current ===
          inFlight.originStorySessionToken &&
        !inFlight.undoRecorded
      ) {
        inFlight.undoRecorded = true;
        recordTimelineCommandUndo(storyId);
      }
    } finally {
      const current = extractionIntentByPositionRef.current.get(positionKey);
      if (current === intent && current.inFlight === inFlight) {
        current.inFlight = undefined;
      }
    }
  };

  /**
   * 唯一的图片落位入口：普通导入和显式放置走这里；时间线抽帧走上面的
   * extractTimelineFrame 聚合命令，避免客户端自己裁决赢家和分两次写入。
   *
   * 调用方不再需要知道这张图会挂在哪个镜头下面——位置是绝对帧，宿主只是存储细节。
   */
  const addTimelineImageClip = async (input: {
    clipId?: string;
    timelineFrame: number;
    imageId: number;
    imageUrl: string;
    label: string;
    visualLayer?: number;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法放置素材");
    const previousItems = timelineItems;
    const previousVisualLayerState = persistedVisualLayerState;
    const previousOverlays = timelineOverlays;
    const result = await trackCreationEditorOperation(
      activeId,
      insertVisualImageClipMut.mutateAsync({
        storyId: activeId,
        clipId: input.clipId ?? `image-clip-${input.imageId}`,
        imageId: input.imageId,
        imageUrl: input.imageUrl,
        label: input.label,
        toTrackId: visualTrackId(Math.max(0, Math.round(input.visualLayer ?? 1))),
        toStartFrame: Math.max(0, Math.round(input.timelineFrame)),
      })
    );
    if (result.status !== "ok") throw new Error(result.error);
    recordTimelineUndoSnapshot(activeId, previousItems, {
      visualLayerState: previousVisualLayerState,
      overlays: previousOverlays,
    });
    await storyMaterialQuery.refetch();
  };



  /**
   * 唯一的素材移动入口。
   *
   * 只把「哪个 clip、去哪条轨、去哪一帧」交给服务端：不重建 items、不带
   * expectedVersion，因此别处的自动保存不会再把一次拖动顶掉。失败会抛出，
   * 由调用方明确提示，不再静默回弹。
   */
  const moveVisualClip = async (input: {
    clipId: string;
    toTrackId: string;
    toStartFrame: number;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法移动素材");
    const previousItems = timelineItems;
    const previousVisualLayerState = persistedVisualLayerState;
    const previousOverlays = timelineOverlays;
    const result = await trackCreationEditorOperation(
      activeId,
      moveVisualClipMut.mutateAsync({
        storyId: activeId,
        clipId: input.clipId,
        toTrackId: input.toTrackId,
        toStartFrame: Math.max(0, Math.round(input.toStartFrame)),
      })
    );
    if (result.status !== "ok") throw new Error(result.error);
    // 没有实际位移就不该占用一次撤销。
    if (result.changed) {
      recordTimelineUndoSnapshot(activeId, previousItems, {
        visualLayerState: previousVisualLayerState,
        overlays: previousOverlays,
      });
    }
    await storyMaterialQuery.refetch();
  };

  const selectVideoTimelineSegment = async (input: {
    stableShotId: string;
    takeId: number;
    rangeId?: number | null;
    selectionType: "full_take" | "range";
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法更新时间轴");
    const result = await selectVideoTimelineSegmentMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "时间轴选择保存失败");
    }
    await storyVideoAssetsQuery.refetch();
    await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
  };

  const clearVideoTimelineSegment = async (stableShotId: string) => {
    if (activeId == null) throw new Error("故事尚未加载，无法清除时间轴");
    const result = await clearVideoTimelineSegmentMut.mutateAsync({
      storyId: activeId,
      stableShotId,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "时间轴选择清除失败");
    }
    await storyVideoAssetsQuery.refetch();
    await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
  };

  const moveVideoTakeToShot = async (input: {
    takeId: number;
    targetStableShotId: string;
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法移动视频素材");
    const result = await moveVideoTakeMut.mutateAsync({
      storyId: activeId,
      ...input,
    });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频 Take 移动失败");
    }
    await Promise.all([
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
  };

  const createDerivedShotDraft: CreationEditorContextValue["createDerivedShotDraft"] =
    async input => {
      if (activeId == null) throw new Error("故事尚未加载，无法派生镜头");
      const created = await createDerivationDraftMut.mutateAsync({
        storyId: activeId,
        sourceStableShotId: input.sourceStableShotId,
        sourceTakeId: input.sourceTakeId,
        sourceTimeSec: input.sourceTimeSec,
        crop: input.crop,
        fullFrameBase64: input.fullFrameBase64,
        cropBase64: input.cropBase64,
        mimeType: "image/png",
      });
      if (created.status !== "ok") throw new Error(created.error);
      const analyzed = await analyzeDerivationDraftMut.mutateAsync({
        draftId: created.draft.id,
        instruction: input.instruction,
        referenceRole: input.referenceRole,
      });
      if (analyzed.status !== "ok") throw new Error(analyzed.error);
      const generated = await generateDerivedCandidatesMut.mutateAsync({
        draftId: created.draft.id,
      });
      if (generated.status !== "ok") throw new Error(generated.error);
      const proposal =
        analyzed.draft.proposal &&
        typeof analyzed.draft.proposal === "object" &&
        !Array.isArray(analyzed.draft.proposal)
          ? (analyzed.draft.proposal as Record<string, unknown>)
          : null;
      return {
        draftId: created.draft.id,
        proposal,
        images: generated.images,
      };
    };

  const confirmDerivedShotFromDraft = async (
    draftId: number,
    selectedImageId: number
  ) => {
    const body = storyQuery.data?.body;
    const expectedStoryRevision =
      body && typeof body === "object" && !Array.isArray(body)
        ? Number((body as Record<string, unknown>)._revision) || 0
        : 0;
    const result = await confirmDerivedShotMut.mutateAsync({
      draftId,
      selectedImageId,
      expectedStoryRevision,
      expectedTimelineVersion: storyMaterialQuery.data?.timeline.version ?? 0,
    });
    if (result.status !== "ok") throw new Error(result.error);
    await Promise.all([
      storyQuery.refetch(),
      storyImagesQuery.refetch(),
      storyMaterialQuery.refetch(),
    ]);
    return result.operationId;
  };

  const undoStoryOperation = async (operationId: number) => {
    const result = await undoStoryOperationMut.mutateAsync({ operationId });
    if (result.status !== "ok") throw new Error(result.error);
    await Promise.all([
      storyQuery.refetch(),
      storyImagesQuery.refetch(),
      storyMaterialQuery.refetch(),
    ]);
  };

  const rawError =
    storyListQuery.error ??
    storyQuery.error ??
    storyImagesQuery.error ??
    storyVideoAssetsQuery.error ??
    storyMaterialQuery.error ??
    promptLineageQuery.error ??
    shotVideoProviderStatusQuery.error ??
    imageProviderStatusQuery.error ??
    null;
  const error = rawError ? { message: rawError.message } : null;

  const value = useMemo<CreationEditorContextValue>(
    () => ({
      stories,
      activeStoryId: activeId,
      setActiveStoryId,
      activeStory,
      publishingHandoff,
      materialState:
        (storyMaterialQuery.data as StoryMaterialState | null | undefined) ??
        null,
      chatCutTimeline,
      promptLineageMode: promptLineageQuery.data?.mode ?? "legacy",
      promptProjection:
        promptLineageQuery.data?.mode === "lineage"
          ? promptLineageQuery.data.projection
          : null,
      storyboardFieldVersions,
      shots,
      timelineShotIds,
      addShotToTimeline,
      removeShotFromTimeline,
      moveShotInTimeline,
      reorderShotInTimeline,
      moveTimelineShot,
      moveTimelineGroup,
      timelineLayoutRows,
      timelineItems,
      timelineOverlays,
      timelineVisualLayerState,
      manageTimelineVisualLayer,
      previewTimelineGroup,
      resolveTimelineFrameSource,
      timelineWritePending,
      addTimelineAnchorAtFrame,
      removeTimelineAnchor: removeTimelineAnchorFromShot,
      trimTimelineItemEdge,
      rollTimelineJoin,
      detachTimelineMagnet,
      resetTimelineShots,
      selectedShotNo,
      setSelectedShotNo,
      selectedShot,
      isLoading:
        storyListQuery.isLoading ||
        storyQuery.isLoading ||
        publishingDraftQuery.isLoading ||
        storyboardCoverReferencesQuery.isLoading ||
        storyImagesQuery.isLoading ||
        storyVideoAssetsQuery.isLoading ||
        storyMaterialQuery.isLoading ||
        promptLineageQuery.isLoading ||
        shotVideoProviderStatusQuery.isLoading ||
        imageProviderStatusQuery.isLoading,
      error,
      isSaving:
        updateStoryShotFieldsMut.isPending ||
        updateStoryTimelineMut.isPending ||
        moveVisualClipMut.isPending ||
        extractTimelineFrameMut.isPending,
      rerenderingShotNos,
      rerenderError,
      promotingFrameCropShotNo,
      generatingVideoShotNos,
      generatingVoiceShotIds,
      generateShotVoice,
      updateShotDuration,
      updatePersistedShotField,
      updatePersistedShotFields,
      restoreStoryboardFieldVersion,
      confirmPromptCandidate,
      rejectPromptCandidate,
      updatePromptOverride,
      rerenderShot,
      promoteFrameCrop,
      promoteStoryImage,
      assignStoryImageToShot,
      deleteStoryImage,
      deleteExtractedFrame,
      importStoryMaterial,
      attachChatCutXml,
      adviseStoryImages,
      applyStoryImageAdvice,
      generateShotVideo,
      estimateStartEndShotVideo,
      generateStartEndShotVideo,
      analyzeShotVideoDirection,
      conformVideoTakes,
      analyzeShotConsistency,
      refreshShotVideoStatus,
      markVideoTakeUnusable,
      insertPersistedShotAfter,
      insertTimelineShotAt,
      commitInsertedTimelineShotUndo,
      discardPersistedShot,
      deletePersistedShot,
      moveVideoTake: moveVideoTakeToShot,
      adoptVideoTake: adoptVideoTakeForShot,
      reuseVideoTake: reuseVideoTakeForShot,
      appendTimelineVideoClip,
      undoTimeline,
      createVideoTakeRange,
      splitTimelineVideoClip,
      addTimelineImageClip,
      extractTimelineFrame,
      moveVisualClip,
      pasteVisualImage,
      deleteVisualObject,
      removeTimelineVideoClip,
      updateTimelineVideoEdit,
      updateTimelineImageTransform,
      selectVideoTimelineSegment,
      clearVideoTimelineSegment,
      createDerivedShotDraft,
      confirmDerivedShot: confirmDerivedShotFromDraft,
      undoStoryOperation,
      shotVideoProviderStatus: shotVideoProviderStatusQuery.data ?? null,
      imageProviderStatus: imageProviderStatusQuery.data ?? null,
      refetch: () => {
        void storyListQuery.refetch();
        void storyQuery.refetch();
        void storyImagesQuery.refetch();
        void storyVideoAssetsQuery.refetch();
        void storyMaterialQuery.refetch();
        void promptLineageQuery.refetch();
        void shotVideoProviderStatusQuery.refetch();
        void imageProviderStatusQuery.refetch();
      },
    }),
    [
      activeId,
      activeStory,
      publishingHandoff,
      chatCutTimeline,
      storyboardFieldVersions,
      error,
      selectedShot,
      selectedShotNo,
      setActiveStoryId,
      promotingFrameCropShotNo,
      generatingVideoShotNos,
      generatingVoiceShotIds,
      rerenderError,
      rerenderingShotNos,
      shots,
      stories,
      timelineShotIds,
      addShotToTimeline,
      removeShotFromTimeline,
      moveShotInTimeline,
      reorderShotInTimeline,
      moveTimelineShot,
      moveTimelineGroup,
      timelineLayoutRows,
      timelineItems,
      timelineOverlays,
      timelineVisualLayerState,
      manageTimelineVisualLayer,
      previewTimelineGroup,
      resolveTimelineFrameSource,
      timelineWritePending,
      addTimelineAnchorAtFrame,
      removeTimelineAnchorFromShot,
      trimTimelineItemEdge,
      rollTimelineJoin,
      detachTimelineMagnet,
      resetTimelineShots,
      insertPersistedShotAfter,
      insertTimelineShotAt,
      commitInsertedTimelineShotUndo,
      discardPersistedShot,
      deletePersistedShot,
      markVideoTakeUnusable,
      moveVideoTakeToShot,
      reuseVideoTakeForShot,
      assignStoryImageToShot,
      deleteStoryImage,
      deleteExtractedFrame,
      importStoryMaterial,
      attachChatCutXml,
      adviseStoryImages,
      applyStoryImageAdvice,
      updateStoryShotFieldsMut.isPending,
      updateStoryTimelineMut.isPending,
      storyImagesQuery,
      storyVideoAssetsQuery,
      storyMaterialQuery,
      promptLineageQuery,
      shotVideoProviderStatusQuery,
      imageProviderStatusQuery,
      storyListQuery,
      storyQuery,
      publishingDraftQuery,
      storyboardCoverReferencesQuery,
    ]
  );

  return (
    <CreationEditorContext.Provider value={value}>
      {children}
    </CreationEditorContext.Provider>
  );
}

export function useCreationEditor() {
  const ctx = useContext(CreationEditorContext);
  if (!ctx)
    throw new Error(
      "useCreationEditor must be used within CreationEditorProvider"
    );
  return ctx;
}

export function useOptionalCreationEditor() {
  return useContext(CreationEditorContext);
}
