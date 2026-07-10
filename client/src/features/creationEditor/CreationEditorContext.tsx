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
import type { StoryShotEditableField } from "@/features/storyAgent/StoryAgentContext";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { canonicalizeShotNo } from "@shared/imageAsset";
import {
  ensureShotIdentities,
  normalizeShotIdentity,
  shotIdentityMatchKeys,
  shotIdentityFromShot,
} from "@shared/shotIdentity";
import { rerenderShotImage, type RerenderReference } from "./rerender";
import {
  writePromptOverride,
  writePromptRun,
  writePromptShot,
  writeShotContentSnapshot,
  writeShotDuration,
} from "./promptTable/persist";
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
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryMaterialState,
  type StoryTimelineItem,
} from "@shared/storyMaterial";
import type { StoryPromptAggregate } from "@shared/promptLineage";
import type {
  VideoConformMode,
  VideoTargetAspectRatio,
} from "@shared/videoConform";
import type { ShotConsistencyAnalysis } from "@shared/shotConsistency";

export type CreationEditorStory = {
  id: number;
  title: string;
  logline?: string | null;
};

export type CreationEditorImage = {
  id: number;
  shotNo: number | null;
  shotIdentity?: string | null;
  imageUrl: string;
  prompt?: string | null;
  status?: "selected" | "pending" | "rejected";
  isCurrent?: boolean;
  isPrimary?: boolean;
  generationType?: "generate" | "initial" | "inpaint";
  selectionSource?: "explicit" | "legacy" | "none";
};

export type CreationEditorShot = StoryShot & {
  shotKey: string;
  imageId?: number;
  imageUrl?: string;
  imagePrompt?: string | null;
  imageSelectionSource?: CreationEditorImage["selectionSource"];
  imageIsPrimary?: boolean;
  videoTakes?: VideoTakeAsset[];
  selectedVideoTake?: VideoTakeAsset;
  durationMs?: number;
  narrativeJob?: NarrativeJob;
  promptOverrides?: PromptOverrides;
  promptRun?: PromptRunRecord;
  downstreamStale?: boolean;
};

export type CreationEditorError = {
  message: string;
};

export type ImportedStoryMaterialResult =
  | {
      kind: "image";
      imageId: number;
      imageUrl: string;
    }
  | {
      kind: "video";
      takeId: number;
      videoUrl: string;
      stableShotId: string;
      plannedDurationSec: number;
    };

export type VideoConformBatchResult = {
  status: "ok" | "partial" | "error";
  completedCount: number;
  failedCount: number;
  results: Array<
    | {
        status: "ok";
        sourceTakeId: number;
        takeId: number;
        videoStatus: VideoTakeStatus;
      }
    | { status: "error"; sourceTakeId: number; error: string }
  >;
};

type CreationEditorContextValue = {
  stories: CreationEditorStory[];
  activeStoryId: number | null;
  setActiveStoryId: (storyId: number | null) => void;
  activeStory: CreationEditorStory | null;
  materialState: StoryMaterialState | null;
  promptLineageMode: "legacy" | "lineage";
  promptProjection: StoryPromptAggregate | null;
  shots: CreationEditorShot[];
  timelineShotIds: string[];
  addShotToTimeline: (shotNo: number, stableShotId?: string | null) => void;
  removeShotFromTimeline: (shotId: string) => void;
  resetTimelineShots: () => void;
  selectedShotNo: number | null;
  setSelectedShotNo: (shotNo: number | null) => void;
  selectedShot: CreationEditorShot | null;
  isLoading: boolean;
  error: CreationEditorError | null;
  isSaving: boolean;
  rerenderingShotNo: number | null;
  rerenderError: string | null;
  promotingFrameCropShotNo: number | null;
  generatingVideoShotNo: number | null;
  updateShotDuration: (shotNo: number, durationMs: number) => Promise<void>;
  updatePersistedShotField: (
    stableShotId: string,
    field: StoryShotEditableField,
    value: string
  ) => Promise<void>;
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
    reference?: RerenderReference
  ) => Promise<void>;
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
  }) => Promise<void>;
  importStoryMaterial: (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
  }) => Promise<ImportedStoryMaterialResult>;
  generateShotVideo: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: "low" | "high";
  }) => Promise<{
    takeId: number;
    videoStatus: VideoTakeStatus;
    videoUrl?: string;
    taskId?: string;
    prompt: string;
  }>;
  conformVideoTakes: (input: {
    items: Array<{ takeId: number; stableShotId: string }>;
    targetAspectRatio: VideoTargetAspectRatio;
    mode: VideoConformMode;
  }) => Promise<VideoConformBatchResult>;
  analyzeShotConsistency: (input: {
    anchorImageUrl?: string | null;
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
  }) => Promise<void>;
  createVideoTakeRange: (input: {
    stableShotId: string;
    takeId: number;
    startSec: number;
    endSec: number;
    label?: string;
    useOnTimeline?: boolean;
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
  refetch: () => void;
};

const CreationEditorContext = createContext<CreationEditorContextValue | null>(
  null
);
const EMPTY_STORY_SHOTS: readonly StoryShot[] = [];
const CURRENT_STORY_FRAME_TYPES = new Set<
  CreationEditorImage["generationType"]
>(["generate", "initial", "inpaint"]);

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

function isCurrentStoryFrame(image: CreationEditorImage): boolean {
  return (
    image.status === "pending" &&
    image.isCurrent === true &&
    CURRENT_STORY_FRAME_TYPES.has(image.generationType)
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
    subject: stringValue(obj.subject),
    action: stringValue(obj.action),
    dialogue: stringValue(obj.dialogue),
    shotType: stringValue(obj.shotType),
    beat: stringValue(obj.beat),
    cameraAngle: stringValue(obj.cameraAngle),
    cameraMove: stringValue(obj.cameraMove),
    location: stringValue(obj.location),
    timeLight: stringValue(obj.timeLight),
    mood: stringValue(obj.mood),
    sound: stringValue(obj.sound),
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
    videoPrompt: stringValue(obj.videoPrompt) || undefined,
    emotionCharge: stringValue(obj.emotionCharge) || undefined,
    emotionDelta: stringValue(obj.emotionDelta) || undefined,
    visualAnchorText: stringValue(obj.visualAnchorText) || undefined,
    promptDraft: stringValue(obj.promptDraft) || undefined,
    negativePrompt: stringValue(obj.negativePrompt) || undefined,
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
  return [
    image.shotIdentity ?? "",
    image.shotNo ?? "",
    image.imageUrl,
  ].join("|");
}

export function resolveCreationEditorImages(
  materialState: StoryMaterialState | null | undefined,
  storyImages: unknown
): CreationEditorImage[] {
  const imagesByKey = new Map<string, CreationEditorImage>();
  for (const image of normalizeStoryImages(storyImages)) {
    imagesByKey.set(imageSourceKey(image), image);
  }
  const materialImages = materialState?.shots.flatMap(shot =>
    shot.currentImage ? [shot.currentImage] : []
  );
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
        if (!previous || image.id >= previous.id)
          displayByIdentity.set(key, image);
      }
    }
    if (!image.shotIdentity && image.shotNo != null) {
      const previous = displayByShotNo.get(image.shotNo);
      if (!previous || image.id >= previous.id)
        displayByShotNo.set(image.shotNo, image);
      const previousLegacy = legacyDisplayByShotNo.get(image.shotNo);
      if (!previousLegacy || image.id >= previousLegacy.id)
        legacyDisplayByShotNo.set(image.shotNo, image);
    }
  }

  return shots.map(shot => {
    const identity = shotIdentityFromShot(shot);
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
        ...shot,
        imageId: explicitlySelectedImage.id,
        imageUrl: explicitlySelectedImage.imageUrl,
        imagePrompt: explicitlySelectedImage.prompt,
        imageSelectionSource: explicitlySelectedImage.selectionSource,
        imageIsPrimary: explicitlySelectedImage.isPrimary,
      };
    }
    if (shot.promptRun?.imageUrl) {
      return {
        ...shot,
        imageId: promptRunImage?.id,
        imageUrl: shot.promptRun.imageUrl,
        imagePrompt: shot.promptRun.finalPrompt,
        imageSelectionSource: promptRunImage?.selectionSource,
        imageIsPrimary: promptRunImage?.isPrimary,
      };
    }
    if (!image) return shot;
    return {
      ...shot,
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
  const [rerenderingShotNo, setRerenderingShotNo] = useState<number | null>(
    null
  );
  const [rerenderError, setRerenderError] = useState<string | null>(null);
  const [promotingFrameCropShotNo, setPromotingFrameCropShotNo] = useState<
    number | null
  >(null);
  const [generatingVideoShotNo, setGeneratingVideoShotNo] = useState<
    number | null
  >(null);
  const [timelineShotIds, setTimelineShotIds] = useState<string[]>([]);
  const autoRefreshVideoRef = useRef(false);
  const utils = trpc.useUtils();

  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const storyUpsertMut = trpc.storyAgent.storyUpsert.useMutation();
  const insertStoryShotAfterMut =
    trpc.storyAgent.insertStoryShotAfter.useMutation();
  const deleteStoryShotMut = trpc.storyAgent.deleteStoryShot.useMutation();
  const generateForMobileMut = trpc.storyAgent.generateForMobile.useMutation();
  const promoteFrameCropMut = trpc.creationAgent.promoteFrameCrop.useMutation();
  const promoteStoryImageMut =
    trpc.creationAgent.promoteStoryImage.useMutation();
  const assignStoryImageToShotMut =
    trpc.creationAgent.assignStoryImageToShot.useMutation();
  const importStoryMaterialMut =
    trpc.creationAgent.importStoryMaterial.useMutation();
  const generateShotVideoMut =
    trpc.creationAgent.generateShotVideo.useMutation();
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
  const shotVideoProviderStatusQuery =
    trpc.creationAgent.shotVideoProviderStatus.useQuery(undefined, {
      refetchOnWindowFocus: false,
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
    return mergeShotsWithVideos(withImages, videos);
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
    async (items: StoryTimelineItem[]) => {
      if (activeId == null) return;
      const previousIds = timelineShotIds;
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
        await storyMaterialQuery.refetch();
      } catch (error) {
        setTimelineShotIds(previousIds);
        await storyMaterialQuery.refetch();
        console.warn("timeline save failed", error);
      }
    },
    [activeId, storyMaterialQuery, timelineShotIds, updateStoryTimelineMut]
  );

  const addShotToTimeline = useCallback(
    (shotNo: number, stableShotId?: string | null) => {
      const shotId =
        normalizeShotIdentity(stableShotId) ??
        shots
          .map(creationTimelineShotId)
          .find((id, index) => shots[index]?.shotNo === shotNo);
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
    const ids = new Set<number>();
    for (const shot of shots) {
      for (const take of shot.videoTakes ?? []) {
        if (take.status === "submitted" || take.status === "processing") {
          ids.add(take.id);
        }
      }
    }
    return Array.from(ids).sort((left, right) => left - right);
  }, [shots]);
  const processingVideoTakeKey = processingVideoTakeIds.join(",");

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

  const updatePersistedShotField = async (
    stableShotId: string,
    field: StoryShotEditableField,
    value: string
  ) => {
    const body =
      storyQuery.data?.body &&
      typeof storyQuery.data.body === "object" &&
      !Array.isArray(storyQuery.data.body)
        ? (storyQuery.data.body as Record<string, unknown>)
        : {};
    const source = Array.isArray(body.shots) ? body.shots : [];
    let found = false;
    const nextShots = source.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const shot = raw as Record<string, unknown>;
      if (shotIdentityFromShot(shot, index) !== stableShotId) return raw;
      found = true;
      return { ...shot, [field]: value };
    });
    if (!found) throw new Error("镜头不存在或已经更新");
    await persistBody({ ...body, shots: nextShots });
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
    const body = writeShotDuration(storyQuery.data?.body, shotNo, durationMs);
    await persistBody(body);
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
    reference?: RerenderReference
  ) => {
    if (activeId == null) throw new Error("故事尚未加载，无法重渲");
    const shot = shots.find(item => item.shotNo === shotNo);
    if (!shot) throw new Error(`找不到镜头 ${shotNo}`);
    setRerenderError(null);
    setRerenderingShotNo(shotNo);
    try {
      const result = await rerenderShotImage({
        storyId: activeId,
        shot,
        rows,
        reference,
        generate: input => generateForMobileMut.mutateAsync(input),
      });
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片生成失败";
      setRerenderError(message);
      throw error;
    } finally {
      setRerenderingShotNo(null);
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

  const importStoryMaterial = async (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
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

  const generateShotVideo = async (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: "low" | "high";
  }) => {
    if (activeId == null) throw new Error("故事尚未加载，无法生成视频");
    setGeneratingVideoShotNo(input.shotNo);
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
      await storyVideoAssetsQuery.refetch();
      await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
      await storyMaterialQuery.refetch();
      return {
        takeId: result.takeId,
        videoStatus: result.videoStatus,
        videoUrl: result.videoUrl,
        taskId: result.taskId,
        prompt: result.prompt,
      };
    } finally {
      setGeneratingVideoShotNo(null);
    }
  };

  const conformVideoTakes = async (input: {
    items: Array<{ takeId: number; stableShotId: string }>;
    targetAspectRatio: VideoTargetAspectRatio;
    mode: VideoConformMode;
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
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      results: result.results.map(item =>
        item.status === "ok"
          ? {
              status: "ok" as const,
              sourceTakeId: item.sourceTakeId,
              takeId: item.take.id,
              videoStatus: item.take.status,
            }
          : item
      ),
    };
  };

  const analyzeShotConsistency = async (input: {
    anchorImageUrl?: string | null;
    maxShots?: number;
  }): Promise<ShotConsistencyAnalysis> => {
    if (activeId == null) throw new Error("故事尚未加载，无法做一致性识别");
    return analyzeShotConsistencyMut.mutateAsync({
      storyId: activeId,
      anchorImageUrl: input.anchorImageUrl ?? undefined,
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
  }) => {
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
  };

  useEffect(() => {
    if (activeId == null || processingVideoTakeIds.length === 0) return;
    let cancelled = false;

    const refreshProcessingTakes = async () => {
      if (autoRefreshVideoRef.current) return;
      autoRefreshVideoRef.current = true;
      try {
        for (const takeId of processingVideoTakeIds) {
          if (cancelled) return;
          await refreshShotVideoStatusMut.mutateAsync({ takeId });
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
      promptLineageMode: promptLineageQuery.data?.mode ?? "legacy",
      promptProjection:
        promptLineageQuery.data?.mode === "lineage"
          ? promptLineageQuery.data.projection
          : null,
      shots,
      timelineShotIds,
      addShotToTimeline,
      removeShotFromTimeline,
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
        shotVideoProviderStatusQuery.isLoading,
      error,
      isSaving: storyUpsertMut.isPending,
      rerenderingShotNo,
      rerenderError,
      promotingFrameCropShotNo,
      generatingVideoShotNo,
      updateShotDuration,
      updatePersistedShotField,
      updatePromptOverride,
      ensurePromptShot,
      recordPromptRun,
      rerenderShot,
      promoteFrameCrop,
      promoteStoryImage,
      assignStoryImageToShot,
      importStoryMaterial,
      generateShotVideo,
      conformVideoTakes,
      analyzeShotConsistency,
      refreshShotVideoStatus,
      markVideoTakeUnusable,
      insertPersistedShotAfter,
      deletePersistedShot,
      moveVideoTake: moveVideoTakeToShot,
      adoptVideoTake: adoptVideoTakeForShot,
      reuseVideoTake: reuseVideoTakeForShot,
      createVideoTakeRange,
      selectVideoTimelineSegment,
      clearVideoTimelineSegment,
      createDerivedShotDraft,
      confirmDerivedShot: confirmDerivedShotFromDraft,
      undoStoryOperation,
      shotVideoProviderStatus: shotVideoProviderStatusQuery.data ?? null,
      refetch: () => {
        void storyListQuery.refetch();
        void storyQuery.refetch();
        void storyImagesQuery.refetch();
        void storyVideoAssetsQuery.refetch();
        void storyMaterialQuery.refetch();
        void promptLineageQuery.refetch();
        void shotVideoProviderStatusQuery.refetch();
      },
    }),
    [
      activeId,
      activeStory,
      error,
      selectedShot,
      selectedShotNo,
      setActiveStoryId,
      promotingFrameCropShotNo,
      generatingVideoShotNo,
      rerenderError,
      rerenderingShotNo,
      shots,
      stories,
      timelineShotIds,
      addShotToTimeline,
      removeShotFromTimeline,
      resetTimelineShots,
      insertPersistedShotAfter,
      deletePersistedShot,
      markVideoTakeUnusable,
      moveVideoTakeToShot,
      reuseVideoTakeForShot,
      assignStoryImageToShot,
      importStoryMaterial,
      storyUpsertMut.isPending,
      storyImagesQuery,
      storyVideoAssetsQuery,
      storyMaterialQuery,
      promptLineageQuery,
      shotVideoProviderStatusQuery,
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
