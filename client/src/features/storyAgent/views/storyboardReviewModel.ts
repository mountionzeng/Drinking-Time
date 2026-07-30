/** Pure rules for the storyboard review workspace. */
import type { CSSProperties } from "react";
import type { StoryShotEditableField } from "@/features/storyAgent/StoryAgentContext";
import type { StoryShot } from "@/features/storyAgent/types";
import type {
  CreationEditorImage,
  CreationEditorShot,
} from "@/features/creationEditor/CreationEditorContext";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import { compileVideoShotRecipe } from "@/features/creationEditor/promptTable/videoRecipe";
import type { FrameQuadrant } from "@/features/creationEditor/video/frameCrop";
import {
  estimateShotVideoCost,
  SHOT_VIDEO_ASPECT_RATIO,
} from "@shared/shotDirector";
import {
  START_END_NEIGHBOR_FRAME_POLICY_VERSION,
  parseStartEndVideoConfig,
} from "@shared/startEndVideo";
import {
  decideVideoRenderStrategy,
  type VideoRenderDecision,
} from "@shared/videoMotionPolicy";
import { shotIdentityFromShot } from "@shared/shotIdentity";
import {
  parseShotNo,
  type GeneratedImageItem,
} from "@/features/mobileChat/types";
import { hasVideoTakeDragPayload } from "./videoTakeDrag";
import {
  STORYBOARD_MATRIX_ROWS,
  type StoryboardMatrixField,
} from "./StoryboardMatrix";
import { hasStoryboardImageDragPayload } from "../storyboardLocalMedia";
import type { StoryboardContinuityOption } from "./StoryboardContinuityDialog";

const STORYBOARD_DRAG_SCROLL_ZONE_PX = 160;
const STORYBOARD_DRAG_SCROLL_MAX_PX = 36;
const STORYBOARD_DRAG_SCROLL_ACCELERATION_MS = 1600;
const STORYBOARD_DRAG_SCROLL_MAX_ACCELERATION = 2.75;
const STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX = 84;
const STORYBOARD_HORIZONTAL_DRAG_SCROLL_MAX_PX = 30;

export function hasStoryboardScrollableDragPayload(
  dataTransfer: DataTransfer
): boolean {
  return (
    hasStoryboardImageDragPayload(dataTransfer) ||
    hasVideoTakeDragPayload(dataTransfer) ||
    Array.from(dataTransfer.types).includes("Files")
  );
}

export function autoScrollElementAtPoint(
  element: HTMLElement | null,
  clientY: number,
  speedMultiplier = 1
): number {
  if (!element) return 0;
  const rect = element.getBoundingClientRect();
  const distanceFromTop = clientY - rect.top;
  const distanceFromBottom = rect.bottom - clientY;
  const speed = Math.max(0.25, speedMultiplier);
  let delta = 0;
  if (distanceFromTop < STORYBOARD_DRAG_SCROLL_ZONE_PX) {
    const ratio =
      (STORYBOARD_DRAG_SCROLL_ZONE_PX - Math.max(0, distanceFromTop)) /
      STORYBOARD_DRAG_SCROLL_ZONE_PX;
    delta = -Math.ceil(ratio * STORYBOARD_DRAG_SCROLL_MAX_PX * speed);
  } else if (distanceFromBottom < STORYBOARD_DRAG_SCROLL_ZONE_PX) {
    const ratio =
      (STORYBOARD_DRAG_SCROLL_ZONE_PX - Math.max(0, distanceFromBottom)) /
      STORYBOARD_DRAG_SCROLL_ZONE_PX;
    delta = Math.ceil(ratio * STORYBOARD_DRAG_SCROLL_MAX_PX * speed);
  }
  if (delta !== 0) element.scrollBy({ top: delta, behavior: "auto" });
  return delta;
}

export function storyboardDragScrollSpeedMultiplier(elapsedMs: number): number {
  const progress =
    Math.max(0, elapsedMs) / STORYBOARD_DRAG_SCROLL_ACCELERATION_MS;
  return Math.min(
    STORYBOARD_DRAG_SCROLL_MAX_ACCELERATION,
    1 + progress * (STORYBOARD_DRAG_SCROLL_MAX_ACCELERATION - 1)
  );
}

export function autoScrollElementHorizontallyAtPoint(
  element: HTMLElement | null,
  clientX: number
): number {
  if (!element) return 0;
  const rect = element.getBoundingClientRect();
  const distanceFromLeft = clientX - rect.left;
  const distanceFromRight = rect.right - clientX;
  let delta = 0;
  if (distanceFromLeft < STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX) {
    const ratio =
      (STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX -
        Math.max(0, distanceFromLeft)) /
      STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX;
    delta = -Math.ceil(ratio * STORYBOARD_HORIZONTAL_DRAG_SCROLL_MAX_PX);
  } else if (distanceFromRight < STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX) {
    const ratio =
      (STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX -
        Math.max(0, distanceFromRight)) /
      STORYBOARD_HORIZONTAL_DRAG_SCROLL_ZONE_PX;
    delta = Math.ceil(ratio * STORYBOARD_HORIZONTAL_DRAG_SCROLL_MAX_PX);
  }
  if (delta !== 0) element.scrollBy({ left: delta, behavior: "auto" });
  return delta;
}

export function scrollElementHorizontallyIntoView(
  scroller: HTMLElement | null,
  target: HTMLElement | null,
  leftInset = 0
): number {
  if (!scroller || !target) return 0;
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const visibleLeft = scrollerRect.left + Math.max(0, leftInset);
  let delta = 0;
  if (targetRect.left < visibleLeft) {
    delta = targetRect.left - visibleLeft;
  } else if (targetRect.right > scrollerRect.right) {
    delta = targetRect.right - scrollerRect.right;
  }
  if (delta !== 0) scroller.scrollBy({ left: delta, behavior: "auto" });
  return delta;
}

export function storyShotInsertIdentity(
  shot: StoryShot,
  index: number
): string | null {
  return shotIdentityFromShot(shot, index);
}

export type QuickShotVideoRenderPlan = {
  prompt: string;
  missing: string[];
  durationSec: number;
  motion: "low" | "high";
  aspectRatio: typeof SHOT_VIDEO_ASPECT_RATIO;
  estimatedCny: number;
  renderDecision: VideoRenderDecision;
};

export function storyboardVideoIntentPatch(
  shot: CreationEditorShot,
  generationParams?: string
): Partial<Record<StoryShotEditableField, string>> {
  return {
    dialogue: shot.dialogue ?? "",
    intent: shot.intent ?? "",
    action: shot.action ?? "",
    performance: shot.performance ?? "",
    environmentMotion: shot.environmentMotion ?? "",
    cameraMove: shot.cameraMove ?? "",
    cameraPath: shot.cameraPath ?? "",
    subjectPath: shot.subjectPath ?? "",
    videoStart: shot.videoStart ?? "",
    videoEnd: shot.videoEnd ?? "",
    transitionIn: shot.transitionIn ?? "",
    transitionOut: shot.transitionOut ?? "",
    videoPrompt: shot.videoPrompt ?? "",
    negativePrompt: shot.negativePrompt ?? "",
    sound: shot.sound ?? "",
    soundBridge: shot.soundBridge ?? "",
    materialTexture: shot.materialTexture ?? "",
    ...(generationParams ? { generationParams } : {}),
  };
}

export function storyboardRenderShotWithDraft(
  creationShot: CreationEditorShot,
  storyboardShot: StoryShot,
  pendingDraft: Partial<Record<StoryboardMatrixField, string>> = {}
): CreationEditorShot {
  const displayedValues = STORYBOARD_MATRIX_ROWS.reduce<
    Partial<Record<StoryboardMatrixField, string>>
  >((patch, row) => {
    const value = storyboardShot[row.field];
    if (typeof value === "string") patch[row.field] = value;
    return patch;
  }, {});
  return {
    ...creationShot,
    ...displayedValues,
    ...pendingDraft,
  };
}

export function storyboardExplicitImageInstruction(
  shot: Partial<
    Pick<
      StoryShot,
      "promptDraft" | "action" | "performance" | "cameraMove" | "transitionOut"
    >
  >,
  pendingDraft: Partial<
    Record<
      "promptDraft" | "action" | "performance" | "cameraMove" | "transitionOut",
      string
    >
  > = {}
): string {
  const value = (
    field:
      | "promptDraft"
      | "action"
      | "performance"
      | "cameraMove"
      | "transitionOut"
  ) => (pendingDraft[field] ?? shot[field] ?? "").trim();
  return [
    value("promptDraft")
      ? `图片要求（最高优先级）：${value("promptDraft")}`
      : "",
    value("action") ? `画面动作：${value("action")}` : "",
    value("performance") ? `表演：${value("performance")}` : "",
    value("cameraMove") ? `运镜构图：${value("cameraMove")}` : "",
    value("transitionOut")
      ? `衔接下一镜：${value("transitionOut")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function storyboardCandidateImageStyle(
  quadrant: FrameQuadrant
): CSSProperties {
  const right = quadrant === "top-right" || quadrant === "bottom-right";
  const bottom = quadrant === "bottom-left" || quadrant === "bottom-right";
  return {
    width: "200%",
    height: "200%",
    maxWidth: "none",
    left: right ? "-100%" : "0",
    top: bottom ? "-100%" : "0",
  };
}

export function storyboardRenderIntentSummary(
  shot: Pick<
    CreationEditorShot,
    "action" | "cameraMove" | "cameraPath" | "videoPrompt"
  >
): string {
  const compact = (value: string | null | undefined) =>
    (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  return [
    compact(shot.action) ? `画面动作：${compact(shot.action)}` : "",
    compact(shot.cameraPath || shot.cameraMove)
      ? `运镜：${compact(shot.cameraPath || shot.cameraMove)}`
      : "",
    compact(shot.videoPrompt)
      ? `视频要求：${compact(shot.videoPrompt)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function quickShotVideoRenderPlan(
  shot: CreationEditorShot,
  previousShots: readonly CreationEditorShot[]
): QuickShotVideoRenderPlan {
  const rows = buildPromptTable(shot, {
    previousShots: [...previousShots],
  });
  const recipe = compileVideoShotRecipe({ shot, rows });
  const motion: "low" | "high" =
    /跑|冲|追|爆|快速|剧烈|摇|甩|推拉|奔|fight|run|fast/i.test(
      [shot.action, shot.cameraMove, shot.cameraPath, shot.emotion]
        .filter(Boolean)
        .join(" ")
    )
      ? "high"
      : "low";
  const durationSec = Math.max(
    3,
    Math.min(10, Math.round((shot.durationMs ?? 5_000) / 1_000))
  );
  const estimate = estimateShotVideoCost({ durationSec, motion });
  const renderDecision = decideVideoRenderStrategy({
    action: shot.action,
    performance: shot.performance,
    environmentMotion: shot.environmentMotion,
    cameraMove: shot.cameraMove,
    cameraPath: shot.cameraPath,
    subjectPath: shot.subjectPath,
    videoStart: shot.videoStart,
    videoEnd: shot.videoEnd,
    videoPrompt: shot.videoPrompt,
  });
  return {
    prompt: recipe.finalPrompt,
    missing: recipe.missing,
    durationSec,
    motion,
    aspectRatio: SHOT_VIDEO_ASPECT_RATIO,
    estimatedCny:
      renderDecision.strategy === "local-transform" ? 0 : estimate.estimatedCny,
    renderDecision,
  };
}

export function storyboardRerenderRequestId(shotNo: number): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `storyboard-rerender-${shotNo}-${randomId}`;
}

export function latestStoryboardFrames(
  images: GeneratedImageItem[],
  shots: readonly StoryShot[] = []
) {
  const shotNoByIdentity = new Map(
    shots.flatMap(shot => {
      const identity = shot.stableShotId ?? shot.shotIdentity;
      return identity ? [[identity, shot.shotNo] as const] : [];
    })
  );
  const byShotNo = new Map<number, GeneratedImageItem>();
  for (const image of images) {
    const shotNo =
      (image.shotIdentity
        ? shotNoByIdentity.get(image.shotIdentity)
        : undefined) ?? parseShotNo(image.shotNo);
    if (!shotNo || image.status === "error" || !image.imageUrl) continue;
    const existing = byShotNo.get(shotNo);
    if (!existing || image.id > existing.id) byShotNo.set(shotNo, image);
  }
  return Array.from(byShotNo.entries())
    .sort(([left], [right]) => left - right)
    .map(([shotNo, image]) => ({ shotNo, image }));
}

function generationParamsRecord(
  generationParams: string | null | undefined
): Record<string, unknown> {
  if (!generationParams?.trim()) return {};
  try {
    const parsed = JSON.parse(generationParams);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function storyboardCharacterContinuityGenerationParams(
  generationParams: string | null | undefined,
  option: StoryboardContinuityOption,
  target?: {
    imageId: number | null | undefined;
    imageUrl: string | null | undefined;
  }
): string {
  const current = generationParamsRecord(generationParams);
  current.characterContinuity = {
    source: option.kind,
    label: option.label,
    imageUrl: option.imageUrl,
    ...(option.imageId != null ? { imageId: option.imageId } : {}),
    ...(target?.imageId != null && target.imageUrl
      ? {
          validatedTarget: {
            imageId: target.imageId,
            imageUrl: target.imageUrl,
          },
        }
      : {}),
    selectedAt: new Date().toISOString(),
  };
  return JSON.stringify(current);
}

export function storyboardCharacterContinuityMatchesTarget(
  generationParams: string | null | undefined,
  target: {
    imageId: number | null | undefined;
    imageUrl: string | null | undefined;
  }
): boolean {
  if (target.imageId == null || !target.imageUrl) return false;
  const continuity =
    generationParamsRecord(generationParams).characterContinuity;
  if (
    !continuity ||
    typeof continuity !== "object" ||
    Array.isArray(continuity)
  ) {
    return false;
  }
  const validatedTarget = (continuity as Record<string, unknown>)
    .validatedTarget;
  if (
    !validatedTarget ||
    typeof validatedTarget !== "object" ||
    Array.isArray(validatedTarget)
  ) {
    return false;
  }
  const record = validatedTarget as Record<string, unknown>;
  return (
    record.imageId === target.imageId &&
    record.imageUrl === target.imageUrl
  );
}

export function storyboardCharacterContinuityReference(
  generationParams: string | null | undefined
): { label: string; imageUrl: string } | null {
  const continuity =
    generationParamsRecord(generationParams).characterContinuity;
  if (
    !continuity ||
    typeof continuity !== "object" ||
    Array.isArray(continuity)
  ) {
    return null;
  }
  const record = continuity as Record<string, unknown>;
  const imageUrl =
    typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
  if (!imageUrl) return null;
  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : "上次确认的人物版本";
  return { label, imageUrl };
}

export type StoryboardFrameRole = "first" | "last" | "reference";

type StoryboardFrameRoleConfig = {
  firstImageId: number | null;
  lastImageId: number | null;
  referenceImageIds: number[];
  explicit: boolean;
};

function positiveImageId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function positiveImageIds(value: unknown): number[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.map(positiveImageId).filter((id): id is number => id != null)
        )
      )
    : [];
}

function storyboardFrameRoleConfig(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[]
): StoryboardFrameRoleConfig {
  const params = generationParamsRecord(generationParams);
  const rawRoles =
    params.storyboardFrameRoles &&
    typeof params.storyboardFrameRoles === "object" &&
    !Array.isArray(params.storyboardFrameRoles)
      ? (params.storyboardFrameRoles as Record<string, unknown>)
      : null;
  const availableIds = new Set(
    images
      .filter(image => image.id > 0 && Boolean(image.imageUrl))
      .map(image => image.id)
  );
  const available = (id: number | null) =>
    id != null && availableIds.has(id) ? id : null;
  const firstImageId = available(
    positiveImageId(rawRoles?.firstImageId ?? params.firstFrameImageId)
  );
  const lastImageId = available(
    positiveImageId(rawRoles?.lastImageId ?? params.lastFrameImageId)
  );
  const referenceImageIds = positiveImageIds(
    rawRoles?.referenceImageIds ?? params.referenceFrameImageIds
  ).filter(
    id => availableIds.has(id) && id !== firstImageId && id !== lastImageId
  );
  return {
    firstImageId,
    lastImageId,
    referenceImageIds,
    explicit: rawRoles != null,
  };
}

function serializeStoryboardFrameRoles(
  generationParams: string | null | undefined,
  roleConfig: Omit<StoryboardFrameRoleConfig, "explicit">,
  durationMs: number
): string {
  const current = generationParamsRecord(generationParams);
  const firstImageId = positiveImageId(roleConfig.firstImageId);
  const lastImageId = positiveImageId(roleConfig.lastImageId);
  const referenceImageIds = Array.from(
    new Set(roleConfig.referenceImageIds)
  ).filter(id => id !== firstImageId && id !== lastImageId);
  current.storyboardFrameRoles = {
    ...(firstImageId != null ? { firstImageId } : {}),
    ...(lastImageId != null ? { lastImageId } : {}),
    referenceImageIds,
  };
  current.referenceFrameImageIds = referenceImageIds;
  if (
    firstImageId != null &&
    lastImageId != null &&
    firstImageId !== lastImageId
  ) {
    current.frameMode = "start_end";
    current.firstFrameImageId = firstImageId;
    current.lastFrameImageId = lastImageId;
    if (
      typeof current.durationSec !== "number" ||
      !Number.isFinite(current.durationSec) ||
      current.durationSec <= 0
    ) {
      current.durationSec = Math.max(
        1,
        Math.min(8, Math.round(durationMs / 1_000))
      );
    }
    if (!["540p", "720p", "1080p"].includes(String(current.resolution))) {
      current.resolution = "1080p";
    }
    if (
      !["auto", "small", "medium", "large"].includes(
        String(current.movementAmplitude)
      )
    ) {
      current.movementAmplitude = "auto";
    }
  } else {
    if (current.frameMode === "start_end") delete current.frameMode;
    delete current.firstFrameImageId;
    delete current.lastFrameImageId;
  }
  return JSON.stringify(current);
}

export function storyboardFrameRoleGenerationParams(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[],
  imageId: number,
  role: StoryboardFrameRole,
  durationMs = 5_000
): string {
  const orderedIds = Array.from(
    new Set(
      images
        .filter(image => image.id > 0 && Boolean(image.imageUrl))
        .map(image => image.id)
    )
  );
  if (!orderedIds.includes(imageId)) return generationParams?.trim() ?? "";
  const configured = storyboardFrameRoleConfig(generationParams, images);
  let firstImageId: number | null =
    configured.firstImageId ?? orderedIds[0] ?? null;
  let lastImageId: number | null =
    configured.lastImageId ??
    (orderedIds.length > 1 ? (orderedIds.at(-1) ?? null) : null);
  const replacement = (excluded: Set<number>, fromEnd = false) => {
    const candidates = fromEnd ? [...orderedIds].reverse() : orderedIds;
    return candidates.find(id => !excluded.has(id)) ?? null;
  };

  if (role === "first") {
    if (lastImageId === imageId) {
      lastImageId = replacement(new Set([imageId]), true);
    }
    firstImageId = imageId;
  } else if (role === "last") {
    if (firstImageId === imageId) {
      firstImageId = replacement(new Set([imageId]));
    }
    lastImageId = imageId;
  } else {
    if (firstImageId === imageId) {
      firstImageId = replacement(
        new Set([imageId, ...(lastImageId != null ? [lastImageId] : [])])
      );
    }
    if (lastImageId === imageId) {
      lastImageId = replacement(
        new Set([imageId, ...(firstImageId != null ? [firstImageId] : [])]),
        true
      );
    }
  }
  return serializeStoryboardFrameRoles(
    generationParams,
    {
      firstImageId,
      lastImageId,
      referenceImageIds: orderedIds.filter(
        id => id !== firstImageId && id !== lastImageId
      ),
    },
    durationMs
  );
}

export function storyboardFrameParamsAfterDelete(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[],
  imageId: number,
  durationMs = 5_000
): string {
  const remaining = images.filter(image => image.id !== imageId);
  const remainingIds = remaining.map(image => image.id);
  const current = generationParamsRecord(generationParams);
  const sources =
    current.startEndFrameSources &&
    typeof current.startEndFrameSources === "object" &&
    !Array.isArray(current.startEndFrameSources)
      ? (current.startEndFrameSources as Record<string, unknown>)
      : null;
  const first =
    sources?.first &&
    typeof sources.first === "object" &&
    !Array.isArray(sources.first)
      ? (sources.first as Record<string, unknown>)
      : null;
  const last =
    sources?.last &&
    typeof sources.last === "object" &&
    !Array.isArray(sources.last)
      ? (sources.last as Record<string, unknown>)
      : null;
  const inheritedFirstImageId = positiveImageId(first?.imageId);
  const inheritedLastImageId = positiveImageId(last?.imageId);
  if (
    sources?.policyVersion === START_END_NEIGHBOR_FRAME_POLICY_VERSION &&
    first?.source === "previous-last" &&
    last?.source === "next-first" &&
    inheritedFirstImageId != null &&
    inheritedLastImageId != null &&
    imageId !== inheritedFirstImageId &&
    imageId !== inheritedLastImageId
  ) {
    const remainingReferenceIds = positiveImageIds(
      (
        current.storyboardFrameRoles as
          | Record<string, unknown>
          | null
          | undefined
      )?.referenceImageIds ?? current.referenceFrameImageIds
    ).filter(id => id !== imageId && remainingIds.includes(id));
    current.storyboardFrameRoles = {
      referenceImageIds: remainingReferenceIds,
    };
    current.referenceFrameImageIds = remainingReferenceIds;
    current.frameMode = "start_end";
    current.firstFrameImageId = inheritedFirstImageId;
    current.lastFrameImageId = inheritedLastImageId;
    return JSON.stringify(current);
  }
  const configured = storyboardFrameRoleConfig(generationParams, images);
  let firstImageId =
    configured.firstImageId === imageId ? null : configured.firstImageId;
  let lastImageId =
    configured.lastImageId === imageId ? null : configured.lastImageId;
  if (firstImageId == null) {
    firstImageId = remainingIds.find(id => id !== lastImageId) ?? null;
  }
  if (lastImageId == null) {
    lastImageId =
      [...remainingIds].reverse().find(id => id !== firstImageId) ?? null;
  }
  return serializeStoryboardFrameRoles(
    generationParams,
    {
      firstImageId,
      lastImageId,
      referenceImageIds: remainingIds.filter(
        id => id !== firstImageId && id !== lastImageId
      ),
    },
    durationMs
  );
}

export function storyboardFrameRoleForImage(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[],
  imageId: number
): StoryboardFrameRole {
  const configured = storyboardFrameRoleConfig(generationParams, images);
  if (configured.firstImageId === imageId) return "first";
  if (configured.lastImageId === imageId) return "last";
  if (configured.referenceImageIds.includes(imageId)) return "reference";
  const index = images.findIndex(image => image.id === imageId);
  if (index <= 0) return "first";
  if (index === images.length - 1) return "last";
  return "reference";
}

export function storyboardStartEndGenerationParams(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[],
  durationMs = 5_000
): string | null {
  const orderedIds = Array.from(
    new Set(
      images
        .filter(image => image.id > 0 && Boolean(image.imageUrl))
        .map(image => image.id)
    )
  );
  if (orderedIds.length < 2) return null;
  const current = generationParamsRecord(generationParams);
  const durationSec =
    typeof current.durationSec === "number" &&
    Number.isFinite(current.durationSec) &&
    current.durationSec > 0
      ? current.durationSec
      : Math.max(1, Math.min(8, Math.round(durationMs / 1_000)));
  const resolution = ["540p", "720p", "1080p"].includes(
    String(current.resolution)
  )
    ? current.resolution
    : "1080p";
  const movementAmplitude = ["auto", "small", "medium", "large"].includes(
    String(current.movementAmplitude)
  )
    ? current.movementAmplitude
    : "auto";
  return JSON.stringify({
    ...current,
    frameMode: "start_end",
    firstFrameImageId: orderedIds[0],
    lastFrameImageId: orderedIds.at(-1),
    durationSec,
    resolution,
    movementAmplitude,
  });
}

export type StoryboardNeighborFrameSource = {
  generationParams?: string | null;
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[];
  stableShotId?: string | null;
  cueCode?: string | null;
};

function storyboardBoundaryImage(
  source: StoryboardNeighborFrameSource | null | undefined,
  boundary: "first" | "last"
) {
  if (!source) return null;
  const ordered = Array.from(
    new Map(
      source.images
        .filter(image => image.id > 0 && Boolean(image.imageUrl))
        .map(image => [image.id, image])
    ).values()
  ).sort((left, right) => left.id - right.id);
  if (ordered.length === 0) return null;
  const configured = storyboardFrameRoleConfig(
    source.generationParams,
    ordered
  );
  const configuredId =
    boundary === "first" ? configured.firstImageId : configured.lastImageId;
  return (
    ordered.find(image => image.id === configuredId) ??
    (boundary === "first" ? ordered[0] : ordered.at(-1)) ??
    null
  );
}

export function storyboardInheritedStartEndGenerationParams(
  generationParams: string | null | undefined,
  currentImages: readonly Pick<CreationEditorImage, "id" | "imageUrl">[],
  previousShot: StoryboardNeighborFrameSource | null | undefined,
  nextShot: StoryboardNeighborFrameSource | null | undefined,
  durationMs = 5_000
): string | null {
  const current = generationParamsRecord(generationParams);
  const expectsStartEnd =
    current.frameMode === "start_end" ||
    current.providerIntent === "vidu-start-end" ||
    Boolean(current.firstFrameFile) ||
    Boolean(current.lastFrameFile);
  if (!expectsStartEnd) return null;

  const currentRoles = storyboardFrameRoleConfig(
    generationParams,
    currentImages
  );
  if (
    currentRoles.firstImageId != null ||
    currentRoles.lastImageId != null ||
    currentRoles.referenceImageIds.length === 0
  ) {
    return null;
  }

  const previousLast = storyboardBoundaryImage(previousShot, "last");
  const nextFirst = storyboardBoundaryImage(nextShot, "first");
  if (!previousLast || !nextFirst || previousLast.id === nextFirst.id) {
    return null;
  }

  const durationSec =
    typeof current.durationSec === "number" &&
    Number.isFinite(current.durationSec) &&
    current.durationSec > 0
      ? current.durationSec
      : Math.max(1, Math.min(8, Math.round(durationMs / 1_000)));
  const resolution = ["540p", "720p", "1080p"].includes(
    String(current.resolution)
  )
    ? current.resolution
    : "1080p";
  const movementAmplitude = ["auto", "small", "medium", "large"].includes(
    String(current.movementAmplitude)
  )
    ? current.movementAmplitude
    : "auto";

  return JSON.stringify({
    ...current,
    frameMode: "start_end",
    firstFrameImageId: previousLast.id,
    lastFrameImageId: nextFirst.id,
    referenceFrameImageIds: currentRoles.referenceImageIds,
    durationSec,
    resolution,
    movementAmplitude,
    startEndFrameSources: {
      policyVersion: START_END_NEIGHBOR_FRAME_POLICY_VERSION,
      first: {
        source: "previous-last",
        imageId: previousLast.id,
        stableShotId: previousShot?.stableShotId ?? null,
        cueCode: previousShot?.cueCode ?? null,
      },
      last: {
        source: "next-first",
        imageId: nextFirst.id,
        stableShotId: nextShot?.stableShotId ?? null,
        cueCode: nextShot?.cueCode ?? null,
      },
    },
  });
}

export function storyboardStartEndFrameIssue(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[]
): string | null {
  const current = generationParamsRecord(generationParams);
  const expectsStartEnd =
    current.frameMode === "start_end" ||
    current.providerIntent === "vidu-start-end" ||
    Boolean(current.firstFrameFile) ||
    Boolean(current.lastFrameFile);
  if (!expectsStartEnd) return null;

  const inheritedSources =
    current.startEndFrameSources &&
    typeof current.startEndFrameSources === "object" &&
    !Array.isArray(current.startEndFrameSources)
      ? (current.startEndFrameSources as Record<string, unknown>)
      : null;
  const inheritedFirst =
    inheritedSources?.first &&
    typeof inheritedSources.first === "object" &&
    !Array.isArray(inheritedSources.first)
      ? (inheritedSources.first as Record<string, unknown>)
      : null;
  const inheritedLast =
    inheritedSources?.last &&
    typeof inheritedSources.last === "object" &&
    !Array.isArray(inheritedSources.last)
      ? (inheritedSources.last as Record<string, unknown>)
      : null;
  const parsedInheritedConfig = parseStartEndVideoConfig(current);
  if (
    parsedInheritedConfig &&
    inheritedSources?.policyVersion ===
      START_END_NEIGHBOR_FRAME_POLICY_VERSION &&
    inheritedFirst?.source === "previous-last" &&
    inheritedLast?.source === "next-first" &&
    inheritedFirst.imageId === parsedInheritedConfig.firstFrameImageId &&
    inheritedLast.imageId === parsedInheritedConfig.lastFrameImageId
  ) {
    return null;
  }

  const configured = storyboardFrameRoleConfig(generationParams, images);
  const missingFirst = configured.firstImageId == null;
  const missingLast = configured.lastImageId == null;
  if (
    !missingFirst &&
    !missingLast &&
    configured.firstImageId !== configured.lastImageId
  ) {
    return null;
  }

  const missingLabel =
    missingFirst && missingLast
      ? configured.referenceImageIds.length > 0
        ? "只有中间参考图，缺少首帧和尾帧"
        : "缺少首帧和尾帧"
      : missingFirst
        ? "缺少首帧"
        : "缺少尾帧";
  return `当前镜头${missingLabel}。请在“画面”里右键图片设置角色，或拖入新的首帧/尾帧后再生成；本次不会提交付费任务。`;
}

export function storyboardFrameOrderGenerationParams(
  generationParams: string | null | undefined,
  images: readonly Pick<CreationEditorImage, "id" | "imageUrl">[],
  durationMs = 5_000
): string {
  const locked = storyboardStartEndGenerationParams(
    generationParams,
    images,
    durationMs
  );
  if (locked) return locked;
  const current = generationParamsRecord(generationParams);
  delete current.frameMode;
  delete current.firstFrameImageId;
  delete current.lastFrameImageId;
  return Object.keys(current).length > 0 ? JSON.stringify(current) : "";
}

export function storyboardFrameOrdersAfterMove(
  sourceImages: readonly CreationEditorImage[],
  targetImages: readonly CreationEditorImage[],
  imageId: number
): {
  sourceImages: CreationEditorImage[];
  targetImages: CreationEditorImage[];
} | null {
  const movingImage = sourceImages.find(image => image.id === imageId);
  if (!movingImage) return null;
  return {
    sourceImages: sourceImages.filter(image => image.id !== imageId),
    targetImages: [
      ...targetImages.filter(image => image.id !== imageId),
      movingImage,
    ],
  };
}

export function storyboardShotFrameImages(
  shot: CreationEditorShot
): CreationEditorImage[] {
  const candidates = [...(shot.imageVersions ?? [])];
  if (
    shot.imageId != null &&
    shot.imageId > 0 &&
    shot.imageUrl &&
    !candidates.some(image => image.id === shot.imageId)
  ) {
    candidates.push({
      id: shot.imageId,
      shotNo: shot.shotNo,
      shotIdentity: shot.stableShotId ?? shot.shotIdentity ?? null,
      imageUrl: shot.imageUrl,
      prompt: shot.imagePrompt ?? null,
      status: "selected",
      isCurrent: true,
      isPrimary: shot.imageIsPrimary,
      selectionSource: shot.imageSelectionSource,
    });
  }
  const unique = Array.from(
    new Map(
      candidates
        .filter(image => image.id > 0 && Boolean(image.imageUrl))
        .map(image => [image.id, image])
    ).values()
  ).sort((left, right) => left.id - right.id);
  const roles = storyboardFrameRoleConfig(shot.generationParams, unique);
  if (
    !roles.explicit &&
    roles.firstImageId == null &&
    roles.lastImageId == null
  )
    return unique;
  const first = unique.find(image => image.id === roles.firstImageId);
  const last = unique.find(image => image.id === roles.lastImageId);
  const references = roles.referenceImageIds.flatMap(imageId => {
    const image = unique.find(candidate => candidate.id === imageId);
    return image ? [image] : [];
  });
  const used = new Set([
    ...(first ? [first.id] : []),
    ...(last ? [last.id] : []),
    ...references.map(image => image.id),
  ]);
  return [
    ...(first ? [first] : []),
    ...references,
    ...unique.filter(image => !used.has(image.id)),
    ...(last ? [last] : []),
  ];
}

export type StoryboardImageGenerationFrameReference = {
  imageUrl: string;
  source: "current" | "previous-last" | "next-first";
  cueCode: string | null;
  shotNo: number;
};

export type StoryboardImageGenerationReferences = {
  primary: StoryboardImageGenerationFrameReference;
  context: StoryboardImageGenerationFrameReference[];
};

function trustedStoryboardBoundaryImage(
  shot: CreationEditorShot,
  boundary: "first" | "last"
): CreationEditorImage | null {
  const images = storyboardShotFrameImages(shot);
  if (images.length === 0) return null;

  const configured = storyboardFrameRoleConfig(shot.generationParams, images);
  const configuredId =
    boundary === "first" ? configured.firstImageId : configured.lastImageId;
  const configuredImage = images.find(image => image.id === configuredId);
  if (configuredImage) return configuredImage;

  const currentImage =
    images.find(image => image.id === shot.imageId) ??
    images.find(image => image.imageUrl === shot.imageUrl);
  if (currentImage) return currentImage;

  const trusted = images.filter(
    image =>
      image.isCurrent ||
      image.isPrimary ||
      image.status === "selected" ||
      image.selectionSource === "explicit"
  );
  return (boundary === "first" ? trusted[0] : trusted.at(-1)) ?? null;
}

function shotGenerationFrameReference(
  shot: CreationEditorShot,
  source: StoryboardImageGenerationFrameReference["source"],
  boundary: "first" | "last"
): StoryboardImageGenerationFrameReference | null {
  const frame = trustedStoryboardBoundaryImage(shot, boundary);
  if (!frame?.imageUrl) return null;
  return {
    imageUrl: frame.imageUrl,
    source,
    cueCode: shot.cueCode?.trim() || null,
    shotNo: shot.shotNo,
  };
}

function exactShotFrameReference(
  shot: CreationEditorShot,
  imageId: number,
  source: StoryboardImageGenerationFrameReference["source"]
): StoryboardImageGenerationFrameReference | null {
  const frame = storyboardShotFrameImages(shot).find(
    image => image.id === imageId
  );
  if (!frame?.imageUrl) return null;
  return {
    imageUrl: frame.imageUrl,
    source,
    cueCode: shot.cueCode?.trim() || null,
    shotNo: shot.shotNo,
  };
}

function persistedNeighborBoundaryReferences(
  currentShot: CreationEditorShot,
  shots: readonly CreationEditorShot[],
  currentIndex: number
): StoryboardImageGenerationReferences | null {
  const params = generationParamsRecord(currentShot.generationParams);
  const config = parseStartEndVideoConfig(params);
  const sources =
    params.startEndFrameSources &&
    typeof params.startEndFrameSources === "object" &&
    !Array.isArray(params.startEndFrameSources)
      ? (params.startEndFrameSources as Record<string, unknown>)
      : null;
  const first =
    sources?.first &&
    typeof sources.first === "object" &&
    !Array.isArray(sources.first)
      ? (sources.first as Record<string, unknown>)
      : null;
  const last =
    sources?.last &&
    typeof sources.last === "object" &&
    !Array.isArray(sources.last)
      ? (sources.last as Record<string, unknown>)
      : null;
  const firstFrameImageId =
    (Number.isInteger(first?.imageId) ? Number(first?.imageId) : null) ??
    config?.firstFrameImageId;
  const lastFrameImageId =
    (Number.isInteger(last?.imageId) ? Number(last?.imageId) : null) ??
    config?.lastFrameImageId;
  if (
    firstFrameImageId == null ||
    lastFrameImageId == null ||
    sources?.policyVersion !== START_END_NEIGHBOR_FRAME_POLICY_VERSION ||
    first?.source !== "previous-last" ||
    last?.source !== "next-first"
  ) {
    return null;
  }

  const previous = [...shots.slice(0, currentIndex)]
    .reverse()
    .map(shot =>
      exactShotFrameReference(
        shot,
        firstFrameImageId,
        "previous-last"
      )
    )
    .find(
      (reference): reference is StoryboardImageGenerationFrameReference =>
        reference != null
    );
  const next = shots
    .slice(currentIndex + 1)
    .map(shot =>
      exactShotFrameReference(shot, lastFrameImageId, "next-first")
    )
    .find(
      (reference): reference is StoryboardImageGenerationFrameReference =>
        reference != null
    );
  return next && previous ? { primary: next, context: [previous] } : null;
}

export function storyboardImageGenerationReferences(
  currentShot: CreationEditorShot,
  shots: readonly CreationEditorShot[]
): StoryboardImageGenerationReferences | null {
  const currentIdentity = shotIdentityFromShot(currentShot);
  const currentIndex = shots.findIndex(
    shot =>
      shot === currentShot ||
      (currentIdentity != null &&
        shotIdentityFromShot(shot) === currentIdentity)
  );
  if (currentIndex < 0) return null;

  const persistedNeighborReferences = persistedNeighborBoundaryReferences(
    currentShot,
    shots,
    currentIndex
  );
  if (persistedNeighborReferences) return persistedNeighborReferences;

  const current = shotGenerationFrameReference(currentShot, "current", "first");
  const previous = [...shots.slice(0, currentIndex)]
    .reverse()
    .map(shot => shotGenerationFrameReference(shot, "previous-last", "last"))
    .find(
      (reference): reference is StoryboardImageGenerationFrameReference =>
        reference != null
    );
  const next = shots
    .slice(currentIndex + 1)
    .map(shot => shotGenerationFrameReference(shot, "next-first", "first"))
    .find(
      (reference): reference is StoryboardImageGenerationFrameReference =>
        reference != null
    );
  const ordered = [current, previous, next].filter(
    (reference): reference is StoryboardImageGenerationFrameReference =>
      reference != null
  );
  const unique = Array.from(
    new Map(ordered.map(reference => [reference.imageUrl, reference])).values()
  );
  const primary = unique[0];
  return primary ? { primary, context: unique.slice(1) } : null;
}

export function shortText(
  value: string | null | undefined,
  fallback: string
): string {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
}
