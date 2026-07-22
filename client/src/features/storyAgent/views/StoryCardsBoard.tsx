/**
 * StoryCardsBoard — Reorderable list of memory cards harvested from the
 * story-guide chat. The order matters: each ordering produces a different
 * generated script.
 *
 * Sits in the TEMPLATE DRAFT slot of the analysis page.
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
  motion,
  AnimatePresence,
  Reorder,
  useDragControls,
} from "framer-motion";
import {
  GripVertical,
  X,
  Sparkles,
  FlaskConical,
  Loader2,
  Clapperboard,
  ImagePlus,
  Trash2,
  CheckCircle2,
  ListPlus,
  PlusCircle,
  RotateCcw,
  Upload,
  Video,
  Check,
  Focus,
  SkipBack,
  SkipForward,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  isFictionStoryCardConfirmed,
  useStoryAgentActions,
  type GenerationProfileArg,
  type StoryShotEditableField,
} from "@/features/storyAgent/StoryAgentContext";
import { useStoryCardsBoardSlice } from "@/features/storyAgent/spine/selectors";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useStoryGeneratedImages } from "./StoryImagesStrip";
import { useNayin } from "@/features/nayin/NayinContext";
import type {
  GeneratedScript,
  StoryCard,
  StoryShot,
  VisualCanvasItem,
} from "@/features/storyAgent/types";
import {
  creationTimelineShotId,
  type CreationEditorImage,
  type CreationEditorShot,
  type ImportedStoryMaterialResult,
} from "@/features/creationEditor/CreationEditorContext";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import { compileVideoShotRecipe } from "@/features/creationEditor/promptTable/videoRecipe";
import {
  mjVideoVariantLabel,
  videoTakeCandidateToAdopt,
  videoTakeAffordance,
  videoTakeErrorMessage,
  videoTakeFrameUrl,
  videoTakeProgress,
} from "@/features/creationEditor/videoAssetViewModel";
import type { FrameQuadrant } from "@/features/creationEditor/video/frameCrop";
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
import {
  estimateShotVideoCost,
  SHOT_VIDEO_ASPECT_RATIO,
  type ShotDirectorResult,
} from "@shared/shotDirector";
import {
  START_END_NEIGHBOR_FRAME_POLICY_VERSION,
  parseStartEndVideoConfig,
  type StartEndShotVideoEstimate,
} from "@shared/startEndVideo";
import {
  decideVideoRenderStrategy,
  type VideoRenderDecision,
} from "@shared/videoMotionPolicy";
import type { NayinElement } from "@/features/nayin/nayin";
import { displayShotCode, shotIdentityFromShot } from "@shared/shotIdentity";
import {
  buildMobileStoryboardScenes,
  parseShotNo,
  type GeneratedImageItem,
} from "@/features/mobileChat/types";
import StoryCardsGraph from "./StoryCardsGraph";
import {
  hasVideoTakeDragPayload,
  readVideoTakeDragPayload,
  writeVideoTakeDragPayload,
} from "./videoTakeDrag";
import { buildStoryboardTimingRows } from "../storyboardTiming";
import {
  StoryboardMatrixFieldCell,
  STORYBOARD_MATRIX_ROWS,
  storyboardMatrixTextareaHeight,
  storyboardMatrixSwapPlan,
  type StoryboardMatrixField,
  type StoryboardMatrixRow,
} from "./StoryboardMatrix";
import {
  artChoiceKey,
  FALLBACK_VISUAL_STYLES,
  GenerationSettingsPanel,
  narrativeChoicesForIntent,
  type ArtLibraryVersionView,
} from "./GenerationSettingsPanel";
import {
  StoryboardMediaPreviewDialog,
  StoryboardVideoThumbnail,
  storyboardPreviewVideoTake,
  type StoryboardMediaPreview,
} from "./StoryboardMediaPreview";
import { CardReferenceDock } from "./CardReferenceDock";
import {
  hasStoryboardImageDragPayload,
  importStoryboardMediaFiles,
  readStoryboardImageDragPayload,
  storyboardMediaKind,
  writeStoryboardImageDragPayload,
} from "../storyboardLocalMedia";

export {
  STORYBOARD_MATRIX_ROWS,
  storyboardMatrixSwapPlan,
  storyboardMatrixTextareaHeight,
};
export { StoryboardVideoThumbnail, storyboardPreviewVideoTake };
export type { StoryboardMatrixField, StoryboardMatrixRow };

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

export function storyboardRenderIntentSummary(
  shot: Pick<CreationEditorShot, "action" | "cameraMove" | "cameraPath">
): string {
  const compact = (value: string | null | undefined) =>
    (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  return [
    compact(shot.action) ? `画面动作：${compact(shot.action)}` : "",
    compact(shot.cameraPath || shot.cameraMove)
      ? `运镜：${compact(shot.cameraPath || shot.cameraMove)}`
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

function storyboardRerenderRequestId(shotNo: number): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `storyboard-rerender-${shotNo}-${randomId}`;
}

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

const EMPTY_HINT: Record<NayinElement, string> = {
  metal: "先开瓶啤酒，跟小酌聊聊一句让你记住的话",
  wood: "泡上一壶龙井，慢慢回忆那个让你停下来的瞬间",
  water: "剥一颗椰子，把那个画面跟小酌讲讲",
  fire: "冲一泡大红袍，让小酌带你回到那一刻",
  earth: "研一杯咖啡，跟小酌聊一段你忘不掉的事",
};

function emotionAccent(emotion: string): string {
  // Hash-derived hue from the emotion string so similar emotions cluster.
  let h = 0;
  for (let i = 0; i < emotion.length; i++)
    h = (h * 31 + emotion.charCodeAt(i)) % 360;
  return `oklch(0.92 0.04 ${h})`;
}

function latestGeneratedImageForCard(
  images: GeneratedImageItem[],
  sceneImageId: number | undefined,
  shotNo: number
): GeneratedImageItem | undefined {
  const matched = images
    .filter(
      image => image.status !== "error" && parseShotNo(image.shotNo) === shotNo
    )
    .sort((left, right) => left.id - right.id);
  if (matched.length > 0) return matched[matched.length - 1];
  return images.find(image => image.id === sceneImageId);
}

function rationaleForShot(shots: StoryShot[], shotNo: number): string | null {
  return shots.find(shot => shot.shotNo === shotNo)?.rationale?.trim() || null;
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

type StoryboardNeighborFrameSource = {
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
    boundary === "first"
      ? configured.firstImageId
      : configured.lastImageId;
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

function shortText(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
}

function isRealEmotion(emotion?: string): emotion is string {
  const value = emotion?.trim();
  return Boolean(value && value !== "未标" && value !== "未标记");
}

function EmotionBridge({
  previousEmotion,
  currentEmotion,
}: {
  previousEmotion?: string;
  currentEmotion: string;
}) {
  if (
    !isRealEmotion(previousEmotion) ||
    !isRealEmotion(currentEmotion) ||
    previousEmotion === currentEmotion
  ) {
    return null;
  }

  return (
    <div
      className="flex justify-center py-1.5"
      aria-label={`情绪流动：${previousEmotion} 到 ${currentEmotion}`}
    >
      <div className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
        <span
          className="h-3 w-px bg-[var(--panel-border)]"
          aria-hidden="true"
        />
        <span
          className="rounded-full border px-2 py-0.5 font-mono"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel-header)",
            color: "var(--nayin-accent-bright)",
          }}
        >
          {previousEmotion} → {currentEmotion}
        </span>
      </div>
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
  onImportStoryMaterial,
  onUpdateShotFields,
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
  generatingVideoShotNo?: number | null;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
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
  const [previewVideoTakeByShot, setPreviewVideoTakeByShot] = useState<
    Record<string, number>
  >({});
  const [removingVideoKey, setRemovingVideoKey] = useState<string | null>(null);
  const [rerenderingShotNo, setRerenderingShotNo] = useState<number | null>(
    null
  );
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

  const rerenderShotVideo = async (
    shot: StoryShot,
    creationShot: CreationEditorShot | undefined
  ) => {
    const label = displayShotCode(shot);
    if (!creationShot) {
      toast.error(`${label} 还没有可渲染的镜头记录`);
      return;
    }
    if (rerenderingShotNo != null || generatingVideoShotNo != null) {
      toast.info("已有视频任务正在提交，请稍候");
      return;
    }
    const stableShotId =
      creationShot.stableShotId ?? creationShot.shotIdentity ?? null;
    const shotIndex = shots.findIndex(candidate => candidate === shot);
    const draftKey =
      (shotIndex >= 0 ? storyShotInsertIdentity(shot, shotIndex) : null) ??
      stableShotId;
    const effectiveShot = storyboardRenderShotWithDraft(
      creationShot,
      shot,
      draftKey ? matrixDraftsRef.current.get(draftKey) : undefined
    );
    const intentSummary = storyboardRenderIntentSummary(effectiveShot);
    setRerenderingShotNo(shot.shotNo);
    onSelectShot?.(shot.shotNo);
    try {
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
            derivedGenerationParams ?? undefined
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
            : `${label} 已先保存本镜文字，视频模型会收到：\n${intentSummary || "当前镜头表格中的动作与运镜"}\n\n并使用首帧 ${estimate.firstFrame.label}（图 #${estimate.firstFrame.imageId}）和末帧 ${estimate.lastFrame.label}（图 #${estimate.lastFrame.imageId}）重新渲染。${frameConstraintNotice}\n\n判断：${estimate.renderReason} 预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，时长 ${estimate.durationSec} 秒、${estimate.resolution}、1:1；会创建新 Take 并保留旧版本。确认提交？`
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
          : `${label} 已先保存本镜文字，视频模型会收到：\n${intentSummary || "当前镜头表格中的动作与运镜"}\n\n判断：${plan.renderDecision.reason} 预计人民币 ¥${plan.estimatedCny.toFixed(2)}，时长 ${plan.durationSec} 秒、1:1；会创建新 Take 并保留旧版本。确认提交？`
      );
      if (!confirmed) return;
      const result = (await onGenerateShotVideo({
        shotNo: effectiveShot.shotNo,
        imageId: effectiveShot.imageId,
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
                        {creationShot &&
                        (onGenerateShotVideo ||
                          (onEstimateStartEndShotVideo &&
                            onGenerateStartEndShotVideo)) ? (
                          <button
                            type="button"
                            disabled={
                              rerenderingShotNo != null ||
                              generatingVideoShotNo != null
                            }
                            onClick={event => {
                              event.stopPropagation();
                              void rerenderShotVideo(shot, creationShot);
                            }}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-muted/45 text-muted-foreground transition hover:bg-[var(--nayin-glow)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-60"
                            aria-label={`重新渲染 ${shotLabel} 视频`}
                            title="重新渲染视频（先确认人民币费用）"
                          >
                            {rerenderingShotNo === shot.shotNo ||
                            generatingVideoShotNo === shot.shotNo ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                          </button>
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
                            title="正在保存镜头信息并提交视频任务"
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="text-[7px] font-semibold">
                              正在提交
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
                                          creationShot?.timelineItem
                                            ?.transform,
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
                        {frameImages.length === 0 &&
                        timelineVisualClips.length === 0 &&
                        playableTakes.length === 0 ? (
                          <div className="flex h-[59px] min-w-0 flex-1 items-center gap-1.5 px-1 text-[8px] text-muted-foreground">
                            {isGeneratingScript ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            ) : (
                              <ImagePlus className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span className="truncate">拖入图片或视频</span>
                          </div>
                        ) : null}
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
    </section>
  );
}

function CardItem({
  card,
  index,
  previousEmotion,
  visualItems,
  generatedImage,
  imageRationale,
  onRemove,
  onCommitContent,
  onDeleteGeneratedImage,
}: {
  card: StoryCard;
  index: number;
  previousEmotion?: string;
  visualItems: VisualCanvasItem[];
  generatedImage?: GeneratedImageItem;
  imageRationale?: string | null;
  onRemove: () => void;
  onCommitContent: (content: string) => void;
  onDeleteGeneratedImage: (image: GeneratedImageItem) => void;
}) {
  const controls = useDragControls();
  const tint = emotionAccent(card.emotion);

  return (
    <Reorder.Item
      value={card}
      dragListener={false}
      dragControls={controls}
      className="select-none"
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 12px 40px -12px var(--nayin-glow)",
        zIndex: 10,
      }}
    >
      <EmotionBridge
        previousEmotion={previousEmotion}
        currentEmotion={card.emotion}
      />
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="rounded-lg border p-3 group relative"
        style={{
          background: `linear-gradient(135deg, ${tint} 0%, var(--card) 70%)`,
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <button
            type="button"
            onPointerDown={e => controls.start(e)}
            className="shrink-0 mt-0.5 cursor-grab active:cursor-grabbing opacity-30 group-hover:opacity-70 transition-opacity"
            aria-label="拖拽排序"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Index badge */}
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold mt-0.5"
            style={{
              background: "var(--nayin-accent)",
              color: "var(--background)",
            }}
          >
            {index + 1}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold text-foreground truncate">
                {card.title}
              </h4>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                style={{
                  background: "var(--nayin-glow)",
                  color: "var(--nayin-accent-bright)",
                }}
              >
                {card.emotion}
              </span>
            </div>
            <p
              data-selection-source={`card:${card.id}`}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="编辑卡片内容"
              tabIndex={0}
              onPointerDown={e => e.stopPropagation()}
              onKeyDown={e => {
                // Enter commits & blurs; Shift+Enter keeps newline
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
              onBlur={e => {
                const next = (e.currentTarget.innerText || "").trim();
                if (next && next !== card.content) onCommitContent(next);
                else e.currentTarget.innerText = card.content;
              }}
              className="text-[11px] text-muted-foreground leading-relaxed select-text cursor-text rounded-sm outline-none -mx-1 px-1 focus:bg-foreground/[0.04] focus:ring-1 focus:ring-[var(--nayin-accent)]/40 hover:bg-foreground/[0.02] transition-colors"
            >
              {card.content}
            </p>
            {card.dialogue && (
              <div
                className="mt-2 px-2 py-1.5 rounded text-[10px] italic leading-relaxed"
                style={{
                  background: "var(--nayin-glow)",
                  color: "var(--nayin-accent-bright)",
                  borderLeft: "2px solid var(--nayin-accent)",
                }}
              >
                💬 {card.dialogue}
              </div>
            )}
            {card.sensoryDetails.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {card.sensoryDetails.map((d, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                    style={{
                      background: "var(--panel-header)",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    · {d}
                  </span>
                ))}
              </div>
            )}
            <CardReferenceDock
              cardId={card.id}
              visualItems={visualItems}
              generatedImage={generatedImage}
              imageRationale={imageRationale}
              onDeleteGeneratedImage={onDeleteGeneratedImage}
            />
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-all"
            aria-label="删除卡片"
            title="删除这张卡片"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    </Reorder.Item>
  );
}

export default function StoryCardsBoard() {
  const {
    cards,
    isGeneratingScript,
    latestScript,
    storyShots,
    visualCanvasItems,
    confirmedIntent,
    pendingIntentDraft,
  } = useStoryCardsBoardSlice();
  const {
    reorderCards,
    removeCard,
    updateCardContent,
    generateScript,
    removeStoryImage,
    confirmPendingIntent,
    confirmFictionStoryCards,
  } = useStoryAgentActions();
  const { element } = useNayin();
  const [boardView, setBoardView] = useState<"graph" | "list">("graph");
  const lastOrderRef = useRef<string>("");
  const utils = trpc.useUtils();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();
  const activeStoryId = useStorySpine(state => state.activeStoryId);
  const promptProjectionQuery = trpc.promptLineage.getStoryProjection.useQuery(
    { storyId: activeStoryId ?? 0 },
    { enabled: activeStoryId != null && activeStoryId > 0 }
  );
  const artLibraryQuery = trpc.artPromptLibrary.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const bindArtLibraryMut = trpc.artPromptLibrary.bindToStory.useMutation();
  const generatedImages = useStoryGeneratedImages();
  const [selectedNarrativeId, setSelectedNarrativeId] = useState("");
  const [selectedArtChoiceId, setSelectedArtChoiceId] = useState("");
  const [bindingLibraryVersionId, setBindingLibraryVersionId] = useState<
    number | null
  >(null);
  const generatedScenes = useMemo(
    () => buildMobileStoryboardScenes(cards, generatedImages),
    [cards, generatedImages]
  );
  const promptProjection =
    promptProjectionQuery.data?.mode === "lineage"
      ? promptProjectionQuery.data.projection
      : null;
  const artLibraryVersions = (artLibraryQuery.data ??
    []) as ArtLibraryVersionView[];
  const currentLibraryVersionId =
    promptProjection?.artBinding?.libraryVersionId ?? null;
  const handleDeleteGeneratedImage = useCallback(
    async (image: GeneratedImageItem) => {
      removeStoryImage(image.id);
      if (image.storyId == null) return;
      utils.storyAgent.storyGet.setData({ id: image.storyId }, current => {
        if (!current?.body || typeof current.body !== "object") return current;
        const body = current.body as Record<string, unknown>;
        const mobileImages = Array.isArray(body.mobileImages)
          ? body.mobileImages.filter(item => {
              if (!item || typeof item !== "object") return true;
              return (item as { id?: unknown }).id !== image.id;
            })
          : body.mobileImages;
        return { ...current, body: { ...body, mobileImages } };
      });
      try {
        await signalMut.mutateAsync({
          storyId: image.storyId,
          imageId: image.id,
          action: "swipe_left",
          metadata: { source: "story-cards-delete" },
        });
        void utils.storyAgent.storyImages.invalidate({
          storyId: image.storyId,
        });
        void utils.storyAgent.storyGet.invalidate({ id: image.storyId });
      } catch (error) {
        console.warn(
          "[StoryCardsBoard] record image delete signal failed:",
          error instanceof Error ? error.message : error
        );
      }
    },
    [removeStoryImage, signalMut, utils]
  );

  // Detect whether order changed since last script
  const orderChanged = useMemo(() => {
    if (!latestScript) return cards.length > 0;
    if (latestScript.cardOrder.length !== cards.length) return true;
    return cards.some((c, i) => latestScript.cardOrder[i] !== c.id);
  }, [cards, latestScript]);
  const effectiveIntent = confirmedIntent ?? pendingIntentDraft;
  const isFictionIntent = effectiveIntent?.purpose === "fiction";
  const hasPendingFictionIntent =
    !confirmedIntent && pendingIntentDraft?.purpose === "fiction";
  const hasConfirmedFictionIntent = confirmedIntent?.purpose === "fiction";
  const fictionCardsConfirmed = isFictionStoryCardConfirmed(
    confirmedIntent,
    cards
  );
  const shouldGateFictionStoryboard =
    isFictionIntent && (!hasConfirmedFictionIntent || !fictionCardsConfirmed);
  const primaryActionDisabled = isGeneratingScript || cards.length === 0;
  const narrativeChoices = useMemo(
    () => narrativeChoicesForIntent(effectiveIntent?.purpose),
    [effectiveIntent?.purpose]
  );
  const activeNarrativeId = narrativeChoices.some(
    choice => choice.id === selectedNarrativeId
  )
    ? selectedNarrativeId
    : (narrativeChoices[0]?.id ?? "");
  const defaultArtChoiceId = currentLibraryVersionId
    ? artChoiceKey("library", currentLibraryVersionId)
    : artChoiceKey("preset", FALLBACK_VISUAL_STYLES[0]?.id ?? "");
  const activeArtChoiceId =
    selectedArtChoiceId &&
    (FALLBACK_VISUAL_STYLES.some(
      preset => selectedArtChoiceId === artChoiceKey("preset", preset.id)
    ) ||
      artLibraryVersions.some(
        version =>
          selectedArtChoiceId === artChoiceKey("library", version.version.id)
      ))
      ? selectedArtChoiceId
      : defaultArtChoiceId;
  const selectedNarrativeChoice =
    narrativeChoices.find(choice => choice.id === activeNarrativeId) ??
    narrativeChoices[0] ??
    null;
  const selectedArtPreset = FALLBACK_VISUAL_STYLES.find(
    preset => activeArtChoiceId === artChoiceKey("preset", preset.id)
  );
  const selectedArtLibrary = artLibraryVersions.find(
    version => activeArtChoiceId === artChoiceKey("library", version.version.id)
  );
  const generationProfile = useMemo<GenerationProfileArg>(
    () => ({
      scriptStyle: selectedNarrativeChoice
        ? {
            id: selectedNarrativeChoice.id,
            label: selectedNarrativeChoice.label,
            logline: selectedNarrativeChoice.logline,
            arc: selectedNarrativeChoice.arc,
            treatment: selectedNarrativeChoice.treatment,
          }
        : undefined,
      artStyle: selectedArtLibrary
        ? {
            id: artChoiceKey("library", selectedArtLibrary.version.id),
            source: "library",
            title: selectedArtLibrary.library.name,
            description: selectedArtLibrary.library.description,
            libraryVersionId: selectedArtLibrary.version.id,
            items: selectedArtLibrary.items.map(item => ({
              dimension: item.dimension,
              content: item.content,
              negativeContent: item.negativeContent,
            })),
          }
        : selectedArtPreset
          ? {
              id: selectedArtPreset.id,
              source: "preset",
              title: selectedArtPreset.title,
              description: selectedArtPreset.description,
              recipe: selectedArtPreset.recipe,
            }
          : undefined,
    }),
    [selectedArtLibrary, selectedArtPreset, selectedNarrativeChoice]
  );
  const handleBindArtLibrary = useCallback(
    async (libraryVersionId: number) => {
      if (activeStoryId == null || activeStoryId <= 0 || !promptProjection) {
        toast.error("故事保存后才能绑定美术库");
        return;
      }
      setBindingLibraryVersionId(libraryVersionId);
      try {
        const result = await bindArtLibraryMut.mutateAsync({
          storyId: activeStoryId,
          libraryVersionId,
          expectedVersion: promptProjection.state.version,
        });
        if (result.projection) {
          utils.promptLineage.getStoryProjection.setData(
            { storyId: activeStoryId },
            { mode: "lineage", projection: result.projection }
          );
        }
        setSelectedArtChoiceId(artChoiceKey("library", libraryVersionId));
        await Promise.all([
          utils.promptLineage.getStoryProjection.invalidate({
            storyId: activeStoryId,
          }),
          utils.storyAgent.storyGet.invalidate({ id: activeStoryId }),
        ]);
        toast.success("美术库已绑定到故事");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "绑定美术库失败");
      } finally {
        setBindingLibraryVersionId(null);
      }
    },
    [activeStoryId, bindArtLibraryMut, promptProjection, utils]
  );
  const handlePrimaryAction = useCallback(() => {
    if (hasPendingFictionIntent) {
      confirmPendingIntent();
      return;
    }
    if (shouldGateFictionStoryboard) {
      confirmFictionStoryCards();
      return;
    }
    void generateScript(undefined, generationProfile);
  }, [
    confirmFictionStoryCards,
    confirmPendingIntent,
    generateScript,
    generationProfile,
    hasPendingFictionIntent,
    shouldGateFictionStoryboard,
  ]);

  // Track the last order string for animation triggers (reserved for future use)
  const orderKey = cards.map(c => c.id).join("|");
  if (orderKey !== lastOrderRef.current) lastOrderRef.current = orderKey;

  return (
    <div className="creation-board-panel h-full flex flex-col">
      <div className="creation-board-panel-header justify-between">
        <div className="creation-board-panel-title">
          <Sparkles className="creation-board-panel-icon" />
          <h2 className="creation-board-panel-title-text">故事卡片</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="creation-board-panel-status">
            {cards.length > 0 ? `${cards.length} 张卡片` : "等待卡片"}
          </span>
          {cards.length > 0 ? (
            <span
              className="inline-flex rounded-full border p-0.5 text-[10px]"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            >
              <button
                type="button"
                onClick={() => setBoardView("graph")}
                className="rounded-full px-2 py-0.5 transition"
                style={{
                  background:
                    boardView === "graph"
                      ? "var(--nayin-accent)"
                      : "transparent",
                  color:
                    boardView === "graph"
                      ? "var(--background)"
                      : "var(--muted-foreground)",
                }}
              >
                图谱
              </button>
              <button
                type="button"
                onClick={() => setBoardView("list")}
                className="rounded-full px-2 py-0.5 transition"
                style={{
                  background:
                    boardView === "list"
                      ? "var(--nayin-accent)"
                      : "transparent",
                  color:
                    boardView === "list"
                      ? "var(--background)"
                      : "var(--muted-foreground)",
                }}
              >
                列表
              </button>
            </span>
          ) : null}
        </div>
      </div>

      <div className="creation-board-panel-body flex min-h-0 flex-1 flex-col overflow-hidden">
        {cards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-[180px] flex-col items-center justify-center text-center gap-3 px-4"
          >
            <FlaskConical className="w-7 h-7 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
              {EMPTY_HINT[element]}
            </p>
            <p className="text-[10px] text-muted-foreground/70 max-w-[16rem]">
              小酌会在你描述出{" "}
              <span className="text-nayin-bright">
                具体场景 + 情感 + 感官细节
              </span>{" "}
              时，自动把那一刻提炼成卡片，飞到这里来。
            </p>
          </motion.div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
              <GenerationSettingsPanel
                narrativeChoices={narrativeChoices}
                activeNarrativeId={activeNarrativeId}
                onSelectNarrative={setSelectedNarrativeId}
                activeArtChoiceId={activeArtChoiceId}
                artLibraryVersions={artLibraryVersions}
                currentLibraryVersionId={currentLibraryVersionId}
                artLibraryLoading={
                  artLibraryQuery.isLoading || artLibraryQuery.isFetching
                }
                artLibraryError={artLibraryQuery.error?.message ?? null}
                canBindArtLibrary={Boolean(activeStoryId && promptProjection)}
                bindingLibraryVersionId={bindingLibraryVersionId}
                onSelectArtPreset={preset =>
                  setSelectedArtChoiceId(artChoiceKey("preset", preset.id))
                }
                onSelectArtLibrary={libraryVersion =>
                  setSelectedArtChoiceId(
                    artChoiceKey("library", libraryVersion.version.id)
                  )
                }
                onBindArtLibrary={libraryVersionId => {
                  void handleBindArtLibrary(libraryVersionId);
                }}
              />

              {boardView === "graph" ? (
                <StoryCardsGraph
                  cards={cards}
                  storyShots={storyShots}
                  onRemoveCard={removeCard}
                  mode={isFictionIntent ? "fiction" : "default"}
                />
              ) : (
                <Reorder.Group
                  axis="y"
                  values={cards}
                  onReorder={reorderCards}
                  className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1"
                >
                  <AnimatePresence>
                    {cards.map((card, idx) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        index={idx}
                        previousEmotion={cards[idx - 1]?.emotion}
                        visualItems={visualCanvasItems.filter(
                          item => item.cardId === card.id
                        )}
                        generatedImage={latestGeneratedImageForCard(
                          generatedImages,
                          generatedScenes[idx]?.imageId,
                          idx + 1
                        )}
                        imageRationale={rationaleForShot(storyShots, idx + 1)}
                        onRemove={() => removeCard(card.id)}
                        onCommitContent={text =>
                          updateCardContent(card.id, text)
                        }
                        onDeleteGeneratedImage={handleDeleteGeneratedImage}
                      />
                    ))}
                  </AnimatePresence>
                </Reorder.Group>
              )}
            </div>

            <div
              className="mt-2 flex shrink-0 flex-col gap-2 border-t pt-2.5"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {isFictionIntent ? (
                <div
                  className="rounded-lg border p-2 text-[11px] leading-relaxed"
                  style={{
                    borderColor: fictionCardsConfirmed
                      ? "var(--nayin-accent-dim)"
                      : "var(--panel-border)",
                    background: "var(--background)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{
                        color: fictionCardsConfirmed
                          ? "var(--nayin-accent)"
                          : "var(--muted-foreground)",
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {hasPendingFictionIntent
                          ? "先确认创造另一个世界"
                          : fictionCardsConfirmed
                            ? "虚构故事卡已确认"
                            : "先确认虚构故事卡"}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {hasPendingFictionIntent
                          ? "小酌已经判断这是虚构短片；确认意图后，故事卡会按世界、人物和冲突继续生长。"
                          : fictionCardsConfirmed
                            ? "现在可以生成 3-5 镜短片；如果改卡片，需要重新确认。"
                            : "确认后再进入拆镜，避免还没定故事方向就生成镜头。"}
                      </p>
                    </div>
                    {hasPendingFictionIntent ? (
                      <button
                        type="button"
                        onClick={confirmPendingIntent}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                        style={{
                          borderColor: "var(--nayin-accent-dim)",
                          color: "var(--nayin-accent)",
                        }}
                      >
                        确认意图
                      </button>
                    ) : !fictionCardsConfirmed ? (
                      <button
                        type="button"
                        onClick={confirmFictionStoryCards}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                        style={{
                          borderColor: "var(--nayin-accent-dim)",
                          color: "var(--nayin-accent)",
                        }}
                      >
                        确认故事卡
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={primaryActionDisabled}
                className="text-xs py-2 rounded-md font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{
                  background: "var(--nayin-accent)",
                  color: "var(--background)",
                  boxShadow: "0 4px 16px -6px var(--nayin-glow)",
                }}
              >
                {isGeneratingScript ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在生成故事版…
                  </>
                ) : (
                  <>
                    <Clapperboard className="w-3.5 h-3.5" />
                    {latestScript && !orderChanged
                      ? "重新生成故事版"
                      : latestScript && orderChanged
                        ? "按新顺序生成故事版"
                        : hasPendingFictionIntent
                          ? "先确认意图"
                          : shouldGateFictionStoryboard
                            ? "确认故事卡"
                            : "生成故事版"}
                  </>
                )}
              </button>
              <p className="text-[10px] text-muted-foreground/70 text-center">
                生成剧本 · 统一提示词 · 关键镜头草稿图
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
