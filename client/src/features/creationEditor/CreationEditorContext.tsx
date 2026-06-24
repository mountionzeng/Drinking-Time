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
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { canonicalizeShotNo } from "@shared/imageAsset";
import {
  ensureShotIdentities,
  normalizeShotIdentity,
  shotIdentityFromShot,
} from "@shared/shotIdentity";
import { rerenderShotImage } from "./rerender";
import {
  writePromptOverride,
  writePromptRun,
  writePromptShot,
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

type CreationEditorContextValue = {
  stories: CreationEditorStory[];
  activeStoryId: number | null;
  setActiveStoryId: (storyId: number | null) => void;
  activeStory: CreationEditorStory | null;
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
  rerenderShot: (shotNo: number, rows: PromptRow[]) => Promise<void>;
  promoteFrameCrop: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => Promise<{ imageId: number; imageUrl: string }>;
  generateShotVideo: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
  }) => Promise<{
    takeId: number;
    videoStatus: VideoTakeStatus;
    videoUrl?: string;
    taskId?: string;
    prompt: string;
  }>;
  refreshShotVideoStatus: (takeId: number) => Promise<void>;
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

function preserveEditorMetadata(
  canonical: CreationEditorShot,
  persisted?: CreationEditorShot
): CreationEditorShot {
  if (!persisted) return canonical;
  const sameStoryContent = SHOT_STORY_IDENTITY_FIELDS.every(
    field => (canonical[field] ?? "") === (persisted[field] ?? "")
  );
  const inheritedPromptRun = sameStoryContent
    ? (canonical.promptRun ?? persisted.promptRun)
    : canonical.promptRun;
  const promptRun = isPromptRunStaleForShot(canonical, inheritedPromptRun)
    ? undefined
    : inheritedPromptRun;
  const downstreamStale =
    (!sameStoryContent && !promptRun) ||
    Boolean(inheritedPromptRun && !promptRun);
  return {
    ...persisted,
    ...canonical,
    shotKey: persisted.shotKey || canonical.shotKey,
    durationMs:
      canonical.durationMs !== undefined
        ? canonical.durationMs
        : persisted.durationMs,
    narrativeJob: sameStoryContent
      ? (canonical.narrativeJob ?? persisted.narrativeJob)
      : canonical.narrativeJob,
    promptOverrides: sameStoryContent
      ? (canonical.promptOverrides ?? persisted.promptOverrides)
      : canonical.promptOverrides,
    promptRun,
    fragmentRefs: sameStoryContent
      ? (canonical.fragmentRefs ?? persisted.fragmentRefs)
      : canonical.fragmentRefs,
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
  return ensureShotIdentities(canonicalShots)
    .map((raw, index) => {
      const canonical = normalizeShot(raw, index);
      if (!canonical) return null;
      const persisted =
        persistedByIdentity.get(shotIdentityFromShot(canonical, index) ?? "") ??
        persistedByShotNo.get(canonical.shotNo);
      return preserveEditorMetadata(canonical, persisted);
    })
    .filter((shot): shot is CreationEditorShot => Boolean(shot))
    .sort((left, right) => left.shotNo - right.shotNo);
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
        obj.shotNo as string | number | null | undefined
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

export function mergeShotsWithImages(
  shots: readonly CreationEditorShot[],
  images: readonly CreationEditorImage[]
): CreationEditorShot[] {
  const displayByShotNo = new Map<number, CreationEditorImage>();
  const displayByIdentity = new Map<string, CreationEditorImage>();
  const byImageId = new Map<number, CreationEditorImage>();
  for (const image of images) {
    byImageId.set(image.id, image);
    // Match filtering in latestStoryboardFrames(): exclude rejected and images without URLs
    if (image.status === "rejected" || !image.imageUrl) continue;
    if (image.shotIdentity) {
      const previous = displayByIdentity.get(image.shotIdentity);
      if (!previous || image.id >= previous.id)
        displayByIdentity.set(image.shotIdentity, image);
    }
    if (image.shotNo != null) {
      const previous = displayByShotNo.get(image.shotNo);
      if (!previous || image.id >= previous.id)
        displayByShotNo.set(image.shotNo, image);
    }
  }

  return shots.map(shot => {
    const identity = shotIdentityFromShot(shot);
    const promptRunImage =
      shot.promptRun?.imageId != null
        ? byImageId.get(shot.promptRun.imageId)
        : undefined;
    const displayImage = shot.downstreamStale
      ? undefined
      : ((identity ? displayByIdentity.get(identity) : undefined) ??
        displayByShotNo.get(shot.shotNo));
    const explicitlySelectedImage =
      displayImage?.selectionSource === "explicit" ||
      displayImage?.status === "selected"
        ? displayImage
        : undefined;
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
  const takesByShot = new Map<string, VideoTakeAsset[]>();
  for (const take of videoTakes) {
    const group = takesByShot.get(take.stableShotId) ?? [];
    group.push(take);
    takesByShot.set(take.stableShotId, group);
  }

  return shots.map(shot => {
    const identity = shotIdentityFromShot(shot);
    if (!identity) return shot;
    const takes = [...(takesByShot.get(identity) ?? [])].sort((left, right) => {
      const selectedDiff =
        Number(right.isTimelineSelected) - Number(left.isTimelineSelected);
      if (selectedDiff) return selectedDiff;
      return (
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.id - left.id
      );
    });
    if (takes.length === 0) return shot;
    return {
      ...shot,
      videoTakes: takes,
      selectedVideoTake:
        takes.find(take => take.isTimelineSelected) ?? takes[0],
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
  const timelineStoryIdRef = useRef<number | null>(null);
  const removedTimelineShotIdsRef = useRef<Set<string>>(new Set());
  const utils = trpc.useUtils();

  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const storyUpsertMut = trpc.storyAgent.storyUpsert.useMutation();
  const generateForMobileMut = trpc.storyAgent.generateForMobile.useMutation();
  const promoteFrameCropMut = trpc.creationAgent.promoteFrameCrop.useMutation();
  const generateShotVideoMut =
    trpc.creationAgent.generateShotVideo.useMutation();
  const refreshShotVideoStatusMut =
    trpc.creationAgent.refreshShotVideoStatus.useMutation();
  const createVideoTakeRangeMut =
    trpc.creationAgent.createVideoTakeRange.useMutation();
  const selectVideoTimelineSegmentMut =
    trpc.creationAgent.selectVideoTimelineSegment.useMutation();
  const clearVideoTimelineSegmentMut =
    trpc.creationAgent.clearVideoTimelineSegment.useMutation();
  const spineActiveStoryId = useStorySpine(state => state.activeStoryId);
  const spineRemoteStoryId = useStorySpine(state => state.remoteStoryId);
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
      enabled: activeId != null,
      refetchOnWindowFocus: false,
    }
  );
  const storyImagesQuery = trpc.storyAgent.storyImages.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null,
      refetchOnWindowFocus: false,
    }
  );
  const storyVideoAssetsQuery = trpc.storyAgent.storyVideoAssets.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null,
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
    const images = normalizeStoryImages(storyImagesQuery.data);
    const withImages = mergeShotsWithImages(storyShots, images);
    const videos = normalizeStoryVideoAssets(storyVideoAssetsQuery.data);
    return mergeShotsWithVideos(withImages, videos);
  }, [
    canonicalStoryShots,
    storyImagesQuery.data,
    storyQuery.data?.body,
    storyVideoAssetsQuery.data,
  ]);

  useEffect(() => {
    const allShotIds = shots.map(creationTimelineShotId);
    if (timelineStoryIdRef.current !== activeId) {
      timelineStoryIdRef.current = activeId;
      removedTimelineShotIdsRef.current.clear();
      setTimelineShotIds(allShotIds);
      return;
    }

    const available = new Set(allShotIds);
    setTimelineShotIds(current => {
      const kept = current.filter(shotId => available.has(shotId));
      const keptSet = new Set(kept);
      const appended = allShotIds.filter(
        shotId =>
          !keptSet.has(shotId) && !removedTimelineShotIdsRef.current.has(shotId)
      );
      const next = [...kept, ...appended];
      if (
        next.length === current.length &&
        next.every((shotId, index) => shotId === current[index])
      ) {
        return current;
      }
      return next;
    });
  }, [activeId, shots]);

  const addShotToTimeline = useCallback(
    (shotNo: number, stableShotId?: string | null) => {
      const shotId =
        normalizeShotIdentity(stableShotId) ??
        shots
          .map(creationTimelineShotId)
          .find((id, index) => shots[index]?.shotNo === shotNo);
      if (!shotId) return;
      removedTimelineShotIdsRef.current.delete(shotId);
      setTimelineShotIds(current =>
        current.includes(shotId) ? current : [...current, shotId]
      );
    },
    [shots]
  );

  const removeShotFromTimeline = useCallback((shotId: string) => {
    removedTimelineShotIdsRef.current.add(shotId);
    setTimelineShotIds(current => current.filter(item => item !== shotId));
  }, []);

  const resetTimelineShots = useCallback(() => {
    removedTimelineShotIdsRef.current.clear();
    setTimelineShotIds(shots.map(creationTimelineShotId));
  }, [shots]);

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
    await storyUpsertMut.mutateAsync({
      id: row.id,
      title: row.title,
      logline: row.logline,
      theme: row.theme,
      arc: row.arc,
      summary: row.summary,
      projectId: row.projectId,
      body,
    });
    await utils.storyAgent.storyGet.invalidate({ id: row.id });
    await storyQuery.refetch();
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

  const rerenderShot = async (shotNo: number, rows: PromptRow[]) => {
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
        generate: input => generateForMobileMut.mutateAsync(input),
      });
      const compiled = compilePromptRecipe({ shot, rows });
      const body = writePromptRun(storyQuery.data?.body, shotNo, {
        finalPrompt: result.prompt || compiled.finalPrompt,
        generatedAt: Date.now(),
        imageId: result.imageId,
        imageUrl: result.imageUrl,
        source: "prompt-table-rerender",
        usedDimensions: compiled.usedDimensions,
      });
      await persistBody(body);
      await storyImagesQuery.refetch();
      await utils.storyAgent.storyImages.invalidate({ storyId: activeId });
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
      await storyImagesQuery.refetch();
      await utils.storyAgent.storyImages.invalidate({ storyId: activeId });
      return { imageId: result.imageId, imageUrl: result.imageUrl };
    } finally {
      setPromotingFrameCropShotNo(null);
    }
  };

  const generateShotVideo = async (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
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

  const refreshShotVideoStatus = async (takeId: number) => {
    if (activeId == null) throw new Error("故事尚未加载，无法刷新视频状态");
    const result = await refreshShotVideoStatusMut.mutateAsync({ takeId });
    if (result.status !== "ok") {
      throw new Error(result.error || "视频状态刷新失败");
    }
    await storyVideoAssetsQuery.refetch();
    await utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeId });
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
          await storyVideoAssetsQuery.refetch();
          await utils.storyAgent.storyVideoAssets.invalidate({
            storyId: activeId,
          });
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
    storyVideoAssetsQuery,
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

  const rawError =
    storyListQuery.error ??
    storyQuery.error ??
    storyImagesQuery.error ??
    storyVideoAssetsQuery.error ??
    shotVideoProviderStatusQuery.error ??
    null;
  const error = rawError ? { message: rawError.message } : null;

  const value = useMemo<CreationEditorContextValue>(
    () => ({
      stories,
      activeStoryId: activeId,
      setActiveStoryId,
      activeStory,
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
        shotVideoProviderStatusQuery.isLoading,
      error,
      isSaving: storyUpsertMut.isPending,
      rerenderingShotNo,
      rerenderError,
      promotingFrameCropShotNo,
      generatingVideoShotNo,
      updateShotDuration,
      updatePromptOverride,
      ensurePromptShot,
      recordPromptRun,
      rerenderShot,
      promoteFrameCrop,
      generateShotVideo,
      refreshShotVideoStatus,
      createVideoTakeRange,
      selectVideoTimelineSegment,
      clearVideoTimelineSegment,
      shotVideoProviderStatus: shotVideoProviderStatusQuery.data ?? null,
      refetch: () => {
        void storyListQuery.refetch();
        void storyQuery.refetch();
        void storyImagesQuery.refetch();
        void storyVideoAssetsQuery.refetch();
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
      storyUpsertMut.isPending,
      storyImagesQuery,
      storyVideoAssetsQuery,
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
