import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { trpc } from "@/lib/trpc";
import type {
  NarrativeJob,
  StoryCard,
  StoryShot,
} from "@/features/storyAgent/types";
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
import {
  writePromptOverride,
  writePromptRun,
  writePromptShot,
  writeShotContentSnapshot,
  writeShotDuration,
} from "./promptTable/persist";
import { MAX_SHOT_DURATION_MS, MIN_SHOT_DURATION_MS } from "./playback";
import { buildPromptTable } from "./promptTable/buildPromptTable";
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
  type StoryMaterialState,
  type StoryTimelineItem,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "@shared/storyMaterial";
import type { StoryPromptAggregate } from "@shared/promptLineage";
import type {
  ImageProvider,
  ImageProviderStatus,
} from "@shared/imageProvider";
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
import { videoTakeIdsToRefresh } from "./videoAssetViewModel";
import {
  recordTimelineUndoSnapshot,
  registerTimelineUndoExecutor,
  takeTimelineUndoSnapshot,
} from "./timelineUndoStore";
import {
  addShotToRenderSlots,
  removeShotFromRenderSlots,
} from "./renderSlots";
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

type CreationEditorContextValue = {
  stories: CreationEditorStory[];
  activeStoryId: number | null;
  setActiveStoryId: (storyId: number | null) => void;
  activeStory: CreationEditorStory | null;
  materialState: StoryMaterialState | null;
  chatCutTimeline: ChatCutTimelineManifest | null;
  promptLineageMode: "legacy" | "lineage";
  promptProjection: StoryPromptAggregate | null;
  shots: CreationEditorShot[];
  timelineShotIds: string[];
  addShotToTimeline: (shotNo: number, stableShotId?: string | null) => void;
  removeShotFromTimeline: (shotId: string) => void;
  moveShotInTimeline: (shotId: string, direction: -1 | 1) => void;
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
  /** 阶段 E：确认/放弃一条候选修订（划词编辑 / 聊天提议 / 直接编辑 / 手改产生的都走这里）。 */
  confirmPromptCandidate: (candidateRevisionId: number) => Promise<void>;
  rejectPromptCandidate: (candidateRevisionId: number) => Promise<void>;
  insertPersistedShotAfter: (
    stableShotId: string,
    dialogue?: string
  ) => Promise<number | null>;
  deletePersistedShot: (stableShotId: string) => Promise<number | null>;
  updatePromptOverride: (
    shotNo: number,
    dimension: string,
    override: PromptOverride
  ) => Promise<void>;
  ensurePromptShot: (input: {
    shotNo: number;
    card?: Pick<StoryCard, "title" | "content" | "emotion" | "sensoryDetails">;
    styleRef?: string;
    narrativeJob?: NarrativeJob;
  }) => Promise<{ shot: CreationEditorShot; rows: PromptRow[] }>;
  recordPromptRun: (
    shotNo: number,
    promptRun: PromptRunRecord
  ) => Promise<void>;
  rerenderShot: (
    shotNo: number,
    rows: PromptRow[],
    reference?: RerenderReference,
    options?: {
      explicitInstruction?: string;
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
  }) => Promise<void>;
  moveTimelineVideoClip: (input: {
    clipId: string;
    sourceStableShotId: string;
    targetStableShotId: string;
    targetOffsetMs: number;
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
    transform: TimelineTransform;
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
    performance: stringValue(obj.performance) || undefined,
    environmentMotion: stringValue(obj.environmentMotion) || undefined,
    dialogue: stringValue(obj.dialogue),
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

export function storyBodyRevision(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const revision = (body as Record<string, unknown>)._revision;
  return typeof revision === "number" && Number.isFinite(revision)
    ? revision
    : 0;
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
  for (const image of normalizeStoryImages(storyImages)) {
    imagesByKey.set(imageSourceKey(image), image);
  }
  const materialImages = materialState?.shots.flatMap(shot => [
    ...(Array.isArray(shot.imageVersions) ? shot.imageVersions : []),
    ...(shot.currentImage ? [shot.currentImage] : []),
  ]);
  for (const image of normalizeStoryImages(materialImages)) {
    imagesByKey.set(imageSourceKey(image), image);
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

export function mergeShotsWithImages(
  shots: readonly CreationEditorShot[],
  images: readonly CreationEditorImage[]
): CreationEditorShot[] {
  const shotNoCounts = new Map<number, number>();
  for (const shot of shots) {
    shotNoCounts.set(shot.shotNo, (shotNoCounts.get(shot.shotNo) ?? 0) + 1);
  }
  const displayByShotNo = new Map<number, CreationEditorImage>();
  const legacyDisplayByShotNo = new Map<number, CreationEditorImage>();
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
      const previousLegacy = legacyDisplayByShotNo.get(image.shotNo);
      if (shouldPreferDisplayImage(previousLegacy, image))
        legacyDisplayByShotNo.set(image.shotNo, image);
    }
  }

  return shots.map(shot => {
    const identity = shotIdentityFromShot(shot);
    const identityKeys = new Set(shotIdentityMatchKeys(identity, shot.shotNo));
    const imageVersions = images
      .filter(image => {
        if (image.status === "rejected" || !image.imageUrl) return false;
        if (image.shotIdentity) {
          return shotIdentityMatchKeys(image.shotIdentity, image.shotNo).some(
            key => identityKeys.has(key)
          );
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
      shot.shotNo
    ).reduce<CreationEditorImage | undefined>((selected, key) => {
      const candidate = displayByIdentity.get(key);
      if (!candidate) return selected;
      if (!selected || candidate.id >= selected.id) return candidate;
      return selected;
    }, undefined);
    const promptRunImage =
      shot.promptRun?.imageId != null
        ? byImageId.get(shot.promptRun.imageId)
        : undefined;
    const matchedImage =
      matchedIdentityImage ??
      (shotNoCounts.get(shot.shotNo) === 1
        ? displayByShotNo.get(shot.shotNo)
        : legacyDisplayByShotNo.get(shot.shotNo));
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
    if (shot.promptRun?.imageUrl) {
      return {
        ...shotWithVersions,
        imageId: promptRunImage?.id,
        imageUrl: shot.promptRun.imageUrl,
        imagePrompt: shot.promptRun.finalPrompt,
        imageSelectionSource: promptRunImage?.selectionSource,
        imageIsPrimary: promptRunImage?.isPrimary,
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
  videoTakes: readonly VideoTakeAsset[]
): CreationEditorShot[] {
  const takesByShot = new Map<string, Map<number, VideoTakeAsset>>();
  for (const take of videoTakes) {
    for (const key of shotIdentityMatchKeys(take.stableShotId)) {
      const group = takesByShot.get(key) ?? new Map<number, VideoTakeAsset>();
      group.set(take.id, take);
      takesByShot.set(key, group);
    }
  }

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
    const timelineTake = takes.find(take => take.isTimelineSelected);
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
  const [recentVideoTakeIds, setRecentVideoTakeIds] = useState<number[]>([]);
  const [timelineShotIds, setTimelineShotIds] = useState<string[]>([]);
  const autoRefreshVideoRef = useRef(false);
  const shotFieldSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const utils = trpc.useUtils();

  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const storyUpsertMut = trpc.storyAgent.storyUpsert.useMutation();
  const updateStoryShotFieldsMut =
    trpc.storyAgent.updateStoryShotFields.useMutation();
  const insertStoryShotAfterMut =
    trpc.storyAgent.insertStoryShotAfter.useMutation();
  const deleteStoryShotMut = trpc.storyAgent.deleteStoryShot.useMutation();
  const generateForMobileMut = trpc.storyAgent.generateForMobile.useMutation();
  const promoteFrameCropMut = trpc.creationAgent.promoteFrameCrop.useMutation();
  const promoteStoryImageMut =
    trpc.creationAgent.promoteStoryImage.useMutation();
  const assignStoryImageToShotMut =
    trpc.creationAgent.assignStoryImageToShot.useMutation();
  const deleteStoryImageMut = trpc.storyAgent.deleteShotImage.useMutation();
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
  const spineActiveStoryId = useStorySpine(state => state.activeStoryId);
  const spineRemoteStoryId = useStorySpine(state => state.remoteStoryId);
  const setCanonicalStoryShots = useStorySpine(state => state.setStoryShots);
  const setSpineRemoteStoryId = useStorySpine(state => state.setRemoteStoryId);
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
  const canonicalStoryShots = useStorySpine(state =>
    activeId != null &&
    (state.activeStoryId === activeId || state.remoteStoryId === activeId)
      ? state.storyShots
      : EMPTY_STORY_SHOTS
  );
  const storyQuery = trpc.storyAgent.storyGet.useQuery(
    { id: activeId ?? 0 },
    {
      // 草稿故事的 activeId 是 -1，服务端只认正数 id，别让 400 进入重试循环
      enabled: activeId != null && activeId > 0,
      refetchOnWindowFocus: false,
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
  const chatCutTimeline = useMemo(
    () => normalizeChatCutTimeline(storyQuery.data?.body),
    [storyQuery.data?.body]
  );

  const shots = useMemo(() => {
    const body = storyQuery.data?.body;
    const storyShots = mergeCanonicalStoryShots(canonicalStoryShots, body);
    const images = resolveCreationEditorImages(
      storyMaterialQuery.data as StoryMaterialState | null | undefined,
      storyImagesQuery.data
    );
    const withImages = mergeShotsWithImages(storyShots, images);
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
    return mergeShotsWithVideos(withImages, videos).map(shot => {
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
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      })),
    [shots, storyMaterialQuery.data?.timeline.items]
  );

  const saveTimelineItems = useCallback(
    async (
      items: StoryTimelineItem[],
      options: { throwOnError?: boolean; recordUndo?: boolean } = {}
    ) => {
      if (activeId == null) return;
      const previousIds = timelineShotIds;
      const previousItems = timelineItems;
      const normalized = items.map((item, position) => ({
        ...item,
        position,
      }));
      setTimelineShotIds(
        normalized.filter(item => item.included).map(item => item.stableShotId)
      );
      try {
        const result = await updateStoryTimelineMut.mutateAsync({
          storyId: activeId,
          expectedVersion: storyMaterialQuery.data?.timeline.version ?? 0,
          items: normalized,
        });
        if (result.status !== "ok") throw new Error(result.error);
        if (
          options.recordUndo !== false &&
          JSON.stringify(previousItems) !== JSON.stringify(normalized)
        ) {
          recordTimelineUndoSnapshot(activeId, previousItems);
        }
        await storyMaterialQuery.refetch();
      } catch (error) {
        setTimelineShotIds(previousIds);
        await storyMaterialQuery.refetch();
        console.warn("timeline save failed", error);
        if (options.throwOnError) throw error;
      }
    },
    [
      activeId,
      storyMaterialQuery,
      timelineItems,
      timelineShotIds,
      updateStoryTimelineMut,
    ]
  );

  const addShotToTimeline = useCallback(
    (shotNo: number, stableShotId?: string | null) => {
      const shotId =
        normalizeShotIdentity(stableShotId) ??
        shots
          .map(creationTimelineShotId)
          .find((_, index) => shots[index]?.shotNo === shotNo);
      if (!shotId) return;
      void saveTimelineItems(
        timelineItems.map(item =>
          item.stableShotId === shotId ? { ...item, included: true } : item
        )
      );
    },
    [saveTimelineItems, shots, timelineItems]
  );

  const removeShotFromTimeline = useCallback(
    (shotId: string) => {
      void saveTimelineItems(
        timelineItems.map(item =>
          item.stableShotId === shotId ? { ...item, included: false } : item
        )
      );
    },
    [saveTimelineItems, timelineItems]
  );

  const moveShotInTimeline = useCallback(
    (shotId: string, direction: -1 | 1) => {
      const ordered = [...timelineItems].sort(
        (left, right) => left.position - right.position
      );
      const index = ordered.findIndex(item => item.stableShotId === shotId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      void saveTimelineItems(
        ordered.map((item, position) => ({ ...item, position }))
      );
    },
    [saveTimelineItems, timelineItems]
  );

  const resetTimelineShots = useCallback(() => {
    void saveTimelineItems(
      timelineItems.map((item, position) => ({
        ...item,
        included: true,
        position,
      }))
    );
  }, [saveTimelineItems, timelineItems]);

  useEffect(() => {
    setSelectedShotNo(current => selectInitialShotNo(current, shots));
  }, [shots]);

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

  const persistBody = async (body: Record<string, unknown>) => {
    const row = storyQuery.data;
    if (!row) throw new Error("故事尚未加载，无法保存");
    const saved = await storyUpsertMut.mutateAsync({
      id: row.id,
      baseRevision:
        typeof row.revision === "number"
          ? row.revision
          : storyBodyRevision(row.body),
      title: row.title,
      logline: row.logline,
      theme: row.theme,
      arc: row.arc,
      summary: row.summary,
      projectId: row.projectId,
      body,
    });
    const savedBody =
      saved?.body &&
      typeof saved.body === "object" &&
      !Array.isArray(saved.body)
        ? (saved.body as Record<string, unknown>)
        : body;
    if (saved && typeof saved.id === "number") {
      setSpineRemoteStoryId(saved.id);
    }
    if (saved && typeof saved.revision === "number") {
      setSpineServerRevision(saved.revision);
    }
    if (Array.isArray(savedBody.shots)) {
      setCanonicalStoryShots(normalizeStoryShots(savedBody));
    }
    await Promise.all([
      utils.storyAgent.storyGet.invalidate({ id: row.id }),
      utils.storyAgent.storyList.invalidate(),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: row.id }),
    ]);
    await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
  };

  // ── 阶段 D：镜头表字段直接编辑 → 额外提议一条提示词候选 ──
  // 刻意不改变 updatePersistedShotFields 本身的行为：镜头表照常立即生效、
  // 立即持久化，这只是叠加在保存成功之后的信号，失败绝不影响镜头表编辑
  // 本身——跟 storyAgent 聊天路径落候选的非致命原则一致。
  //
  // 这是故事版看板（StoryboardPanel → StoryboardReviewBoard）实际调用的
  // 保存函数——它跟 StoryAgentContext 的 updateStoryShotField 是两套并行
  // 的镜头编辑通道，走的是不同的持久化路径（这里是 updateStoryShotFieldsMut
  // + stories.body，那边是 saveArchiveStory）。候选提议接在这里才对真实
  // UI 生效。
  // `aggregate` 必须是编辑落库之前取到的快照——不能在这里现取。
  // 原因（浏览器实测才抓到的真实 bug，不是假设）：getStoryProjection 会先跑
  // maybeResetStaleMigration，一旦发现 stories.body 变了、又没有人工候选记录，
  // 就整体重新迁移谱系，把最新的 body 值当成新基线吸收掉。如果编辑落库*之后*
  // 才现取聚合，读到的"当前确认内容"已经被这次编辑污染成新基线，
  // currentContent === nextValue 永远成立，候选永远提不出来。
  const proposeEditPromptCandidates = async (
    changes: ShotFieldChange[],
    aggregate: StoryPromptAggregate,
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

  const updatePersistedShotFields = async (
    stableShotId: string,
    patch: Partial<Record<StoryShotEditableField, string>>
  ) => {
    const storyId = activeId;
    if (storyId == null) throw new Error("故事尚未加载，无法保存镜头");
    const previousShot = canonicalStoryShots.find(
      (shot, index) => shotIdentityFromShot(shot, index) === stableShotId
    ) as Record<string, unknown> | undefined;
    // 必须在 updateStoryShotFieldsMut 落库之前发起——见 proposeEditPromptCandidates
    // 上面的注释：晚一步取就会取到被这次编辑污染过的谱系基线。这里只发起请求，
    // 不 await，跟保存请求并发进行，不多花时间；哪怕这次编辑最终没有可提议的
    // 候选，这个快照请求本身也无害。
    const preEditProjection = utils.promptLineage.getStoryProjection
      .fetch({ storyId })
      .catch(() => null);
    const save = async () => {
      const result = await updateStoryShotFieldsMut.mutateAsync({
        storyId,
        stableShotId,
        patch,
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
        return shotIdentityFromShot(raw, index) === stableShotId;
      }) as Record<string, unknown> | undefined;
      const confirmed =
        savedShot &&
        Object.entries(patch).every(
          ([field, value]) => savedShot[field] === value
        );
      if (!confirmed) {
        throw new Error("服务器没有确认镜头字段，已保留为未保存状态");
      }
      setCanonicalStoryShots(normalizeStoryShots(savedBody));
      if (typeof result.story.revision === "number") {
        setSpineServerRevision(result.story.revision);
      }
      await Promise.all([
        utils.storyAgent.storyGet.invalidate({ id: storyId }),
        utils.storyAgent.storyList.invalidate(),
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
      ]);
      await Promise.all([storyQuery.refetch(), storyMaterialQuery.refetch()]);
      const loaded = await preEditProjection;
      if (loaded?.mode === "lineage") {
        void proposeEditPromptCandidates(
          Object.entries(patch).flatMap(([field, value]) =>
            value == null
              ? []
              : [
                  {
                    stableShotId,
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
    const queued = shotFieldSaveQueueRef.current.then(save, save);
    shotFieldSaveQueueRef.current = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  };

  const updatePersistedShotField = async (
    stableShotId: string,
    field: StoryShotEditableField,
    value: string
  ) => updatePersistedShotFields(stableShotId, { [field]: value });

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
    await confirmPromptCandidateMut.mutateAsync({
      storyId,
      candidateRevisionId,
      expectedVersion: promptLineageQuery.data.projection.state.version,
    });
    await promptLineageQuery.refetch();
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

  const insertPersistedShotAfter = async (
    stableShotId: string,
    dialogue = ""
  ) => {
    if (activeId == null) throw new Error("故事尚未加载，无法添加镜头");
    const result = await insertStoryShotAfterMut.mutateAsync({
      storyId: activeId,
      stableShotId,
      dialogue,
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
    return result.insertedShotNo;
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

  const updateShotDuration = async (shotNo: number, durationMs: number) => {
    const normalizedDurationMs = Math.min(
      MAX_SHOT_DURATION_MS,
      Math.max(MIN_SHOT_DURATION_MS, Math.round(durationMs))
    );
    const body = writeShotDuration(
      storyQuery.data?.body,
      shotNo,
      normalizedDurationMs
    );
    const targetShot = shots.find(shot => shot.shotNo === shotNo);
    const targetShotId = targetShot ? creationTimelineShotId(targetShot) : null;
    const nextTimelineItems = targetShotId
      ? timelineItems.map(item =>
          item.stableShotId === targetShotId
            ? { ...item, plannedDurationMs: normalizedDurationMs }
            : item
        )
      : timelineItems;
    const timelineChanged = nextTimelineItems.some(
      (item, index) =>
        item.plannedDurationMs !== timelineItems[index]?.plannedDurationMs
    );
    await persistBody(body);
    if (timelineChanged) {
      await saveTimelineItems(nextTimelineItems);
    }
  };

  const updatePromptOverride = async (
    shotNo: number,
    dimension: string,
    override: PromptOverride
  ) => {
    const body = writePromptOverride(
      storyQuery.data?.body,
      shotNo,
      dimension,
      override
    );
    await persistBody(body);
  };

  const ensurePromptShot = async (input: {
    shotNo: number;
    card?: Pick<StoryCard, "title" | "content" | "emotion" | "sensoryDetails">;
    styleRef?: string;
    narrativeJob?: NarrativeJob;
  }) => {
    const existing = shots.find(item => item.shotNo === input.shotNo);
    const fallbackShot: CreationEditorShot = existing ?? {
      shotNo: input.shotNo,
      shotKey: shotKey(input.shotNo),
      subject:
        input.card?.title ||
        input.card?.content?.slice(0, 80) ||
        `镜头 ${input.shotNo}`,
      action: input.card?.content || "",
      dialogue: "",
      shotType: "",
      beat: input.card?.title || `Story Card ${input.shotNo}`,
      cameraAngle: "",
      cameraMove: "",
      location: input.card?.sensoryDetails?.join("，") || "",
      timeLight: "",
      mood: input.card?.emotion || "",
      sound: "",
      styleRef: input.styleRef || "",
      note: "",
      emotion: input.card?.emotion || "",
      sourceCardContent: input.card?.content || "",
      narrativeJob: input.narrativeJob,
    };

    const narrativeChanged = input.narrativeJob
      ? JSON.stringify(existing?.narrativeJob ?? null) !==
        JSON.stringify(input.narrativeJob)
      : false;
    const shouldPersist =
      !existing ||
      (Boolean(input.styleRef) && !existing.styleRef.trim()) ||
      narrativeChanged;
    const nextShot = existing
      ? {
          ...existing,
          styleRef: existing.styleRef || input.styleRef || "",
          narrativeJob: input.narrativeJob ?? existing.narrativeJob,
        }
      : fallbackShot;
    if (shouldPersist) {
      const body = writePromptShot(
        storyQuery.data?.body,
        input.shotNo,
        nextShot as unknown as Record<string, unknown>
      );
      await persistBody(body);
    }

    const previousShots = shots.filter(item => item.shotNo < input.shotNo);
    return {
      shot: nextShot,
      rows: buildPromptTable(nextShot, { previousShots }),
    };
  };

  const recordPromptRun = async (
    shotNo: number,
    promptRun: PromptRunRecord
  ) => {
    const body = writePromptRun(storyQuery.data?.body, shotNo, promptRun);
    await persistBody(body);
  };

  const rerenderShot = async (
    shotNo: number,
    rows: PromptRow[],
    reference?: RerenderReference,
    options?: {
      explicitInstruction?: string;
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
    if (!shot) throw new Error(`找不到镜头 ${shotNo}`);
    setRerenderError(null);
    setRerenderingShotNos(current =>
      addShotToRenderSlots(current, shotNo)
    );
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
        const bodyWithShotContent = writeShotContentSnapshot(
          storyQuery.data?.body,
          shotNo,
          {
            stableShotId: shot.stableShotId,
            shotIdentity: shot.shotIdentity,
            shotKey: shot.shotKey,
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
            sourceCardContent: shot.sourceCardContent,
            intent: shot.intent,
            rationale: shot.rationale,
            videoPrompt: shot.videoPrompt,
            videoStart: shot.videoStart,
            videoEnd: shot.videoEnd,
            transitionIn: shot.transitionIn,
            transitionOut: shot.transitionOut,
            negativePrompt: shot.negativePrompt,
          }
        );
        const body = writePromptRun(bodyWithShotContent, shotNo, {
          finalPrompt: result.prompt || compiled.finalPrompt,
          generatedAt: Date.now(),
          imageId: result.imageId,
          imageUrl: result.imageUrl,
          source: "prompt-table-rerender",
          usedDimensions: compiled.usedDimensions,
        });
        await persistBody(body);
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
    await Promise.all([
      storyImagesQuery.refetch(),
      storyVideoAssetsQuery.refetch(),
      storyMaterialQuery.refetch(),
      utils.storyAgent.storyImages.invalidate({ storyId: activeId }),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId: activeId }),
    ]);
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
    const snapshot = takeTimelineUndoSnapshot(activeId);
    if (!snapshot) return false;
    try {
      await saveTimelineItems(snapshot, {
        throwOnError: true,
        recordUndo: false,
      });
      return true;
    } catch (error) {
      recordTimelineUndoSnapshot(activeId, snapshot);
      throw error;
    }
  }, [activeId, saveTimelineItems]);

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
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法切割视频");
    const sourceStartSec = Math.max(0, input.sourceStartSec);
    const sourceEndSec = Math.max(sourceStartSec, input.sourceEndSec);
    const splitSourceSec = Math.min(
      sourceEndSec,
      Math.max(sourceStartSec, input.splitSourceSec)
    );
    const clipStartMs = Math.max(0, input.offsetMs);
    const clipEndMs = clipStartMs + Math.max(1, input.durationMs);
    const splitOffsetMs = Math.min(
      clipEndMs,
      Math.max(clipStartMs, input.splitOffsetMs)
    );
    if (
      splitSourceSec - sourceStartSec < 1 / 30 ||
      sourceEndSec - splitSourceSec < 1 / 30 ||
      splitOffsetMs - clipStartMs < 1 ||
      clipEndMs - splitOffsetMs < 1
    ) {
      throw new Error("播放头离片段边缘太近，无法切割当前帧");
    }

    const splitId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createRange = async (
      startSec: number,
      endSec: number,
      suffix: string
    ) => {
      const result = await createVideoTakeRangeMut.mutateAsync({
        storyId: activeId,
        stableShotId: input.takeStableShotId,
        takeId: input.takeId,
        startSec,
        endSec,
        label: `时间线切割 ${input.label} ${suffix}`,
        useOnTimeline: false,
      });
      if (result.status !== "ok") {
        throw new Error(result.error || "片段保存失败");
      }
      return result.range;
    };
    const leftSourceStartSec = input.effects.reverse
      ? splitSourceSec
      : sourceStartSec;
    const leftSourceEndSec = input.effects.reverse
      ? sourceEndSec
      : splitSourceSec;
    const rightSourceStartSec = input.effects.reverse
      ? sourceStartSec
      : splitSourceSec;
    const rightSourceEndSec = input.effects.reverse
      ? splitSourceSec
      : sourceEndSec;
    const [leftRange, rightRange] = await Promise.all([
      createRange(leftSourceStartSec, leftSourceEndSec, "前段"),
      createRange(rightSourceStartSec, rightSourceEndSec, "后段"),
    ]);
    const currentItem = timelineItems.find(
      item => item.stableShotId === input.stableShotId
    );
    if (!currentItem) throw new Error("当前镜头不在时间线上");
    const existingClips = currentItem.visualClips ?? [];
    const retainedClips = input.existingClipId
      ? existingClips.filter(clip => clip.id !== input.existingClipId)
      : existingClips;
    const nextClips = [
      ...retainedClips,
      {
        id: `split-${splitId}-left`,
        takeId: input.takeId,
        rangeId: leftRange.id,
        sourceStableShotId: input.takeStableShotId,
        videoUrl: input.videoUrl,
        label: `${input.label} · 前段`,
        sourceStartSec: leftSourceStartSec,
        sourceEndSec: leftSourceEndSec,
        offsetMs: clipStartMs,
        durationMs: splitOffsetMs - clipStartMs,
        effects: input.effects,
        transform: input.transform,
      },
      {
        id: `split-${splitId}-right`,
        takeId: input.takeId,
        rangeId: rightRange.id,
        sourceStableShotId: input.takeStableShotId,
        videoUrl: input.videoUrl,
        label: `${input.label} · 后段`,
        sourceStartSec: rightSourceStartSec,
        sourceEndSec: rightSourceEndSec,
        offsetMs: splitOffsetMs,
        durationMs: clipEndMs - splitOffsetMs,
        effects: input.effects,
        transform: input.transform,
      },
    ].sort((left, right) => left.offsetMs - right.offsetMs);

    await saveTimelineItems(
      timelineItems.map(item =>
        item.stableShotId === input.stableShotId
          ? {
              ...item,
              visualClips: nextClips,
              visualClipsReplacePrimary: true,
            }
          : item
      ),
      { throwOnError: true }
    );
    await storyVideoAssetsQuery.refetch();
    await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
  };

  const moveTimelineVideoClip = async (input: {
    clipId: string;
    sourceStableShotId: string;
    targetStableShotId: string;
    targetOffsetMs: number;
  }) => {
    const sourceItem = timelineItems.find(
      item => item.stableShotId === input.sourceStableShotId
    );
    const movingClip = sourceItem?.visualClips?.find(
      clip => clip.id === input.clipId
    );
    if (!sourceItem || !movingClip) throw new Error("找不到要移动的视频片段");
    const targetItem = timelineItems.find(
      item => item.stableShotId === input.targetStableShotId
    );
    if (!targetItem) throw new Error("目标镜头不在时间线上");
    const movedClip = {
      ...movingClip,
      offsetMs: Math.max(0, input.targetOffsetMs),
    };
    const nextItems = timelineItems.map(item => {
      if (input.sourceStableShotId === input.targetStableShotId) {
        if (item.stableShotId !== input.sourceStableShotId) return item;
        return {
          ...item,
          plannedDurationMs: Math.max(
            item.plannedDurationMs,
            movedClip.offsetMs + movedClip.durationMs
          ),
          visualClips: (item.visualClips ?? [])
            .map(clip => (clip.id === input.clipId ? movedClip : clip))
            .sort((left, right) => left.offsetMs - right.offsetMs),
        };
      }
      if (item.stableShotId === input.sourceStableShotId) {
        return {
          ...item,
          visualClips: (item.visualClips ?? []).filter(
            clip => clip.id !== input.clipId
          ),
        };
      }
      if (item.stableShotId === input.targetStableShotId) {
        return {
          ...item,
          plannedDurationMs: Math.max(
            item.plannedDurationMs,
            movedClip.offsetMs + movedClip.durationMs
          ),
          visualClips: [...(item.visualClips ?? []), movedClip].sort(
            (left, right) => left.offsetMs - right.offsetMs
          ),
        };
      }
      return item;
    });
    await saveTimelineItems(nextItems, { throwOnError: true });
  };

  const removeTimelineVideoClip = async (input: {
    stableShotId: string;
    clipId: string;
  }) => {
    const sourceItem = timelineItems.find(
      item => item.stableShotId === input.stableShotId
    );
    const sourceClips = sourceItem?.visualClips ?? [];
    if (!sourceItem || !sourceClips.some(clip => clip.id === input.clipId)) {
      throw new Error("找不到要移除的视频片段");
    }
    await saveTimelineItems(
      timelineItems.map(item => {
        if (item.stableShotId !== input.stableShotId) return item;
        const visualClips = sourceClips.filter(
          clip => clip.id !== input.clipId
        );
        return {
          ...item,
          visualClips,
          visualClipsReplacePrimary:
            visualClips.length > 0 && item.visualClipsReplacePrimary,
        };
      }),
      { throwOnError: true }
    );
  };

  const updateTimelineVideoEdit = async (input: {
    stableShotId: string;
    takeId: number;
    clipId?: string | null;
    sourceStartSec: number;
    sourceEndSec: number;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
  }) => {
    const sourceStartSec = Math.max(0, input.sourceStartSec);
    const sourceEndSec = Math.max(sourceStartSec + 1 / 30, input.sourceEndSec);
    const effects: TimelineVideoEffects = {
      playbackRate: Math.min(4, Math.max(0.25, input.effects.playbackRate)),
      reverse: Boolean(input.effects.reverse),
      volume: Math.min(2, Math.max(0, input.effects.volume)),
      muted: Boolean(input.effects.muted),
    };
    const durationMs = Math.max(
      100,
      Math.round(
        ((sourceEndSec - sourceStartSec) * 1_000) / effects.playbackRate
      )
    );
    const currentItem = timelineItems.find(
      item => item.stableShotId === input.stableShotId
    );
    if (!currentItem) throw new Error("当前镜头不在时间线上");

    const nextItems = timelineItems.map(item => {
      if (item.stableShotId !== input.stableShotId) return item;
      if (!input.clipId) {
        return {
          ...item,
          plannedDurationMs: durationMs,
          transform: input.transform,
          primaryVideoEdit: {
            takeId: input.takeId,
            sourceStartSec,
            sourceEndSec,
            effects,
          },
        };
      }

      const sourceClips = item.visualClips ?? [];
      const sourceClip = sourceClips.find(clip => clip.id === input.clipId);
      if (!sourceClip || sourceClip.takeId !== input.takeId) {
        throw new Error("找不到要编辑的视频片段");
      }
      const previousEndMs = sourceClip.offsetMs + sourceClip.durationMs;
      const deltaMs = durationMs - sourceClip.durationMs;
      const visualClips = sourceClips
        .map(clip => {
          if (clip.id === input.clipId) {
            return {
              ...clip,
              sourceStartSec,
              sourceEndSec,
              durationMs,
              effects,
              transform: input.transform,
            };
          }
          if (
            item.visualClipsReplacePrimary &&
            clip.offsetMs >= previousEndMs - 1
          ) {
            return { ...clip, offsetMs: Math.max(0, clip.offsetMs + deltaMs) };
          }
          return clip;
        })
        .sort((left, right) => left.offsetMs - right.offsetMs);
      const clipEndMs = visualClips.reduce(
        (maximum, clip) => Math.max(maximum, clip.offsetMs + clip.durationMs),
        0
      );
      return {
        ...item,
        plannedDurationMs: item.visualClipsReplacePrimary
          ? Math.max(100, clipEndMs)
          : Math.max(item.plannedDurationMs, clipEndMs),
        visualClips,
      };
    });

    await saveTimelineItems(nextItems, { throwOnError: true });
  };

  const updateTimelineImageTransform = async (input: {
    stableShotId: string;
    transform: TimelineTransform;
  }) => {
    if (!timelineItems.some(item => item.stableShotId === input.stableShotId)) {
      throw new Error("当前镜头不在时间线上");
    }
    await saveTimelineItems(
      timelineItems.map(item =>
        item.stableShotId === input.stableShotId
          ? { ...item, transform: input.transform }
          : item
      ),
      { throwOnError: true }
    );
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
      materialState:
        (storyMaterialQuery.data as StoryMaterialState | null | undefined) ??
        null,
      chatCutTimeline,
      promptLineageMode: promptLineageQuery.data?.mode ?? "legacy",
      promptProjection:
        promptLineageQuery.data?.mode === "lineage"
          ? promptLineageQuery.data.projection
          : null,
      shots,
      timelineShotIds,
      addShotToTimeline,
      removeShotFromTimeline,
      moveShotInTimeline,
      resetTimelineShots,
      selectedShotNo,
      setSelectedShotNo,
      selectedShot,
      isLoading:
        storyListQuery.isLoading ||
        storyQuery.isLoading ||
        storyImagesQuery.isLoading ||
        storyVideoAssetsQuery.isLoading ||
        storyMaterialQuery.isLoading ||
        promptLineageQuery.isLoading ||
        shotVideoProviderStatusQuery.isLoading ||
        imageProviderStatusQuery.isLoading,
      error,
      isSaving: storyUpsertMut.isPending,
      rerenderingShotNos,
      rerenderError,
      promotingFrameCropShotNo,
      generatingVideoShotNos,
      updateShotDuration,
      updatePersistedShotField,
      updatePersistedShotFields,
      confirmPromptCandidate,
      rejectPromptCandidate,
      updatePromptOverride,
      ensurePromptShot,
      recordPromptRun,
      rerenderShot,
      promoteFrameCrop,
      promoteStoryImage,
      assignStoryImageToShot,
      deleteStoryImage,
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
      deletePersistedShot,
      moveVideoTake: moveVideoTakeToShot,
      adoptVideoTake: adoptVideoTakeForShot,
      reuseVideoTake: reuseVideoTakeForShot,
      appendTimelineVideoClip,
      undoTimeline,
      createVideoTakeRange,
      splitTimelineVideoClip,
      moveTimelineVideoClip,
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
      chatCutTimeline,
      error,
      selectedShot,
      selectedShotNo,
      setActiveStoryId,
      promotingFrameCropShotNo,
      generatingVideoShotNos,
      rerenderError,
      rerenderingShotNos,
      shots,
      stories,
      timelineShotIds,
      addShotToTimeline,
      removeShotFromTimeline,
      moveShotInTimeline,
      resetTimelineShots,
      insertPersistedShotAfter,
      deletePersistedShot,
      markVideoTakeUnusable,
      moveVideoTakeToShot,
      reuseVideoTakeForShot,
      assignStoryImageToShot,
      deleteStoryImage,
      importStoryMaterial,
      attachChatCutXml,
      adviseStoryImages,
      applyStoryImageAdvice,
      storyUpsertMut.isPending,
      storyImagesQuery,
      storyVideoAssetsQuery,
      storyMaterialQuery,
      promptLineageQuery,
      shotVideoProviderStatusQuery,
      imageProviderStatusQuery,
      storyListQuery,
      storyQuery,
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
