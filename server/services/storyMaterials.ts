import type { Story } from "../../drizzle/schema";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  timelineMsToFrames,
  type StoryMaterialState,
  type StoryTimelineAnchor,
  type StoryTimelinePrimaryVideoEdit,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
  type TimelineDocument,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import {
  normalizeShotIdentity,
  shotIdentityMatchKeys,
} from "../../shared/shotIdentity";
import { getStoryById, getStoryTimeline } from "../db";
import { getStoryImageAssets } from "./imageAssets";
import { getStoryPromptProjection } from "./promptLineage";
import {
  resolvePromptAssetFreshness,
  resolveVideoStaleReasons,
} from "./promptMaterialProjection";
import {
  getStoryVideoAssets,
} from "./videoAssets";

type StoryShotFact = {
  stableShotId: string;
  shotNo: number;
  cueCode: string | null;
  plannedDurationMs: number;
};

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

function timelineAnchors(value: unknown): StoryTimelineAnchor[] {
  if (!Array.isArray(value)) return [];
  const anchors: StoryTimelineAnchor[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const timelineFrame = nonNegativeInteger(record.timelineFrame);
    const sourceId =
      typeof record.sourceId === "string" ? record.sourceId.trim() : "";
    const sourceType = record.sourceType;
    const sourceTimeSec =
      record.sourceTimeSec == null
        ? null
        : typeof record.sourceTimeSec === "number" &&
            Number.isFinite(record.sourceTimeSec) &&
            record.sourceTimeSec >= 0
          ? record.sourceTimeSec
          : -1;
    if (
      !id ||
      seen.has(id) ||
      timelineFrame == null ||
      !sourceId ||
      (sourceType !== "primary-video" &&
        sourceType !== "visual-clip" &&
        sourceType !== "image") ||
      sourceTimeSec === -1
    ) {
      continue;
    }
    seen.add(id);
    anchors.push({
      id,
      timelineFrame,
      sourceType,
      sourceId,
      sourceTimeSec,
    });
  }
  return anchors.sort(
    (left, right) => left.timelineFrame - right.timelineFrame || left.id.localeCompare(right.id)
  );
}

function shotNoFromCanonical(value: unknown): number | null {
  const canonical = canonicalizeShotNo(
    value as string | number | null | undefined
  );
  return canonical ? Number(canonical.slice(2)) : null;
}

function keysOverlap(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightKeys = new Set(right);
  return left.some(key => rightKeys.has(key));
}

function shotMaterialKeys(fact: StoryShotFact): string[] {
  return shotIdentityMatchKeys(fact.stableShotId, fact.shotNo);
}

function storyShots(story: Story): StoryShotFact[] {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  return shots.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const shot = raw as Record<string, unknown>;
    const canonical = canonicalizeShotNo(
      shot.shotNo as string | number | null | undefined
    );
    const shotNo = canonical ? Number(canonical.slice(2)) : index + 1;
    const stableShotId =
      normalizeShotIdentity(shot.stableShotId) ??
      normalizeShotIdentity(shot.shotIdentity) ??
      normalizeShotIdentity(shot.shotKey) ??
      `legacy-SH${String(shotNo).padStart(2, "0")}`;
    return [
      {
        stableShotId,
        shotNo,
        cueCode:
          typeof shot.cueCode === "string" && shot.cueCode.trim()
            ? shot.cueCode.trim()
            : null,
        plannedDurationMs: Math.max(
          100,
          finite(shot.durationMs, finite(shot.durationSec, 3) * 1000)
        ),
      },
    ];
  });
}

function transform(value: unknown): TimelineTransform {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const clamp = (
    key:
      | "cropX"
      | "cropY"
      | "cropWidth"
      | "cropHeight"
      | "zoom"
      | "panX"
      | "panY"
      | "rotationDeg",
    min: number,
    max: number
  ) =>
    Math.min(
      max,
      Math.max(min, finite(record[key], DEFAULT_TIMELINE_TRANSFORM[key] ?? 0))
    );
  return {
    cropX: clamp("cropX", 0, 1),
    cropY: clamp("cropY", 0, 1),
    cropWidth: clamp("cropWidth", 0.01, 1),
    cropHeight: clamp("cropHeight", 0.01, 1),
    zoom: clamp("zoom", 0.25, 8),
    panX: clamp("panX", -1, 1),
    panY: clamp("panY", -1, 1),
    rotationDeg: clamp("rotationDeg", -180, 180),
    flipX: record.flipX === true,
    flipY: record.flipY === true,
  };
}

function videoEffects(value: unknown): TimelineVideoEffects {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const motion = record.motionPreset;
  const motionPreset =
    motion &&
    typeof motion === "object" &&
    !Array.isArray(motion) &&
    (motion as Record<string, unknown>).kind === "heartbeat"
      ? {
          kind: "heartbeat" as const,
          bpm: Math.min(
            180,
            Math.max(36, finite((motion as Record<string, unknown>).bpm, 72))
          ),
          scaleAmount: Math.min(
            0.16,
            Math.max(
              0.01,
              finite((motion as Record<string, unknown>).scaleAmount, 0.06)
            )
          ),
        }
      : null;
  return {
    playbackRate: Math.min(
      4,
      Math.max(
        0.25,
        finite(record.playbackRate, DEFAULT_TIMELINE_VIDEO_EFFECTS.playbackRate)
      )
    ),
    reverse: record.reverse === true,
    volume: Math.min(
      2,
      Math.max(0, finite(record.volume, DEFAULT_TIMELINE_VIDEO_EFFECTS.volume))
    ),
    muted: record.muted === true,
    motionPreset,
  };
}

function optionalVideoEffects(
  value: unknown
): TimelineVideoEffects | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? videoEffects(value)
    : undefined;
}

function primaryVideoEdit(
  value: unknown
): StoryTimelinePrimaryVideoEdit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const takeId = finite(record.takeId, 0);
  const sourceStartSec = Math.max(0, finite(record.sourceStartSec, 0));
  const sourceEndSec = Math.max(
    sourceStartSec,
    finite(record.sourceEndSec, sourceStartSec)
  );
  if (takeId <= 0 || sourceEndSec <= sourceStartSec) return undefined;
  return {
    takeId,
    sourceStartSec,
    sourceEndSec,
    effects: videoEffects(record.effects),
  };
}

function visualClips(value: unknown): StoryTimelineVisualClip[] {
  if (!Array.isArray(value)) return [];
  const normalized: StoryTimelineVisualClip[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const clip = raw as Record<string, unknown>;
    const id = typeof clip.id === "string" ? clip.id.trim() : "";
    const videoUrl =
      typeof clip.videoUrl === "string" ? clip.videoUrl.trim() : "";
    const sourceStableShotId = normalizeShotIdentity(clip.sourceStableShotId);
    const takeId = finite(clip.takeId, 0);
    const rangeId = finite(clip.rangeId, 0);
    const sourceStartSec = Math.max(0, finite(clip.sourceStartSec, 0));
    const sourceEndSec = Math.max(
      sourceStartSec,
      finite(clip.sourceEndSec, sourceStartSec)
    );
    const durationMs = Math.max(1, finite(clip.durationMs, 0));
    if (
      !id ||
      seen.has(id) ||
      !videoUrl ||
      !sourceStableShotId ||
      takeId <= 0 ||
      rangeId <= 0 ||
      sourceEndSec <= sourceStartSec ||
      durationMs <= 1
    ) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      takeId,
      rangeId,
      sourceStableShotId,
      videoUrl,
      label:
        typeof clip.label === "string" && clip.label.trim()
          ? clip.label.trim().slice(0, 120)
          : `片段 ${normalized.length + 1}`,
      sourceStartSec,
      sourceEndSec,
      offsetMs: Math.max(0, finite(clip.offsetMs, 0)),
      durationMs,
      effects: optionalVideoEffects(clip.effects),
      transform:
        clip.transform &&
        typeof clip.transform === "object" &&
        !Array.isArray(clip.transform)
          ? transform(clip.transform)
          : undefined,
    });
  }
  return normalized.sort(
    (left, right) =>
      left.offsetMs - right.offsetMs || left.id.localeCompare(right.id)
  );
}

export function normalizeTimelineItems(
  value: unknown,
  facts: readonly StoryShotFact[]
): StoryTimelineItem[] {
  const known = new Map(facts.map(fact => [fact.stableShotId, fact]));
  const source = Array.isArray(value) ? value : [];
  const hasExplicitPlacement = source.some(
    raw =>
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      nonNegativeInteger((raw as Record<string, unknown>).timelineStartFrame) != null
  );
  const normalized: StoryTimelineItem[] = [];
  const seen = new Set<string>();
  let legacyCursorFrame = 0;
  let maximumEndFrame = 0;
  let nextStackOrder = 0;
  for (const raw of source) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const stableShotId = normalizeShotIdentity(item.stableShotId);
    const fact = stableShotId ? known.get(stableShotId) : undefined;
    if (!stableShotId || !fact || seen.has(stableShotId)) continue;
    seen.add(stableShotId);
    const plannedDurationMs = Math.max(
      100,
      finite(item.plannedDurationMs, fact.plannedDurationMs)
    );
    const durationFrames = Math.max(
      1,
      nonNegativeInteger(item.durationFrames) ?? timelineMsToFrames(plannedDurationMs)
    );
    const explicitStartFrame = nonNegativeInteger(item.timelineStartFrame);
    const timelineStartFrame =
      explicitStartFrame ??
      (hasExplicitPlacement ? maximumEndFrame : legacyCursorFrame);
    const stackOrder =
      nonNegativeInteger(item.stackOrder) ?? nextStackOrder;
    const anchors = timelineAnchors(item.anchors);
    normalized.push({
      stableShotId,
      included: item.included !== false,
      position: normalized.length,
      plannedDurationMs,
      durationFrames,
      timelineStartFrame,
      stackOrder,
      ...(anchors.length > 0 ? { anchors } : {}),
      transform: transform(item.transform),
      primaryVideoEdit: primaryVideoEdit(item.primaryVideoEdit),
      visualClips: visualClips(item.visualClips),
      visualClipsReplacePrimary: item.visualClipsReplacePrimary === true,
    });
    legacyCursorFrame = timelineStartFrame + durationFrames;
    maximumEndFrame = Math.max(maximumEndFrame, timelineStartFrame + durationFrames);
    nextStackOrder = Math.max(nextStackOrder, stackOrder + 1);
  }
  for (const fact of facts) {
    if (seen.has(fact.stableShotId)) continue;
    const durationFrames = timelineMsToFrames(fact.plannedDurationMs);
    const timelineStartFrame = hasExplicitPlacement
      ? maximumEndFrame
      : legacyCursorFrame;
    normalized.push({
      stableShotId: fact.stableShotId,
      included: true,
      position: normalized.length,
      plannedDurationMs: fact.plannedDurationMs,
      durationFrames,
      timelineStartFrame,
      stackOrder: nextStackOrder,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    });
    legacyCursorFrame = timelineStartFrame + durationFrames;
    maximumEndFrame = Math.max(maximumEndFrame, timelineStartFrame + durationFrames);
    nextStackOrder += 1;
  }
  return normalized.map((item, position) => ({ ...item, position }));
}

export async function getStoryMaterialState(
  storyId: number,
  userId: number
): Promise<StoryMaterialState | null> {
  const story = await getStoryById(storyId, userId);
  if (!story) return null;
  const facts = storyShots(story);
  const [images, videos, timelineRow, promptProjection] =
    await Promise.all([
      getStoryImageAssets(storyId, userId),
      getStoryVideoAssets(storyId, userId),
      getStoryTimeline(storyId, userId),
      getStoryPromptProjection({ storyId, userId }),
    ]);
  const timeline: TimelineDocument = {
    storyId,
    version: timelineRow?.version ?? 0,
    items: normalizeTimelineItems(timelineRow?.items, facts),
  };
  const timelineByShot = new Map(
    timeline.items.map(item => [item.stableShotId, item])
  );
  const compilationHeadByKey = new Map(
    (promptProjection?.compilationHeads ?? []).map(head => [
      `${head.stableShotId}:${head.modality}`,
      head.currentCompilationId,
    ])
  );

  const shots = facts.map(fact => {
    const imageCompilationId =
      compilationHeadByKey.get(`${fact.stableShotId}:image`) ?? null;
    const videoCompilationId =
      compilationHeadByKey.get(`${fact.stableShotId}:video`) ?? null;
    const imageVersions = images
      .filter(image =>
        keysOverlap(
          shotMaterialKeys(fact),
          shotIdentityMatchKeys(
            image.shotIdentity,
            shotNoFromCanonical(image.canonicalShotNo ?? image.rawShotNo)
          )
        )
      )
      .map(image => ({
        ...image,
        promptFreshness: resolvePromptAssetFreshness(
          image.promptCompilationId,
          imageCompilationId
        ),
      }));
    const currentImage = imageVersions.find(image => image.isPrimary) ?? null;
    const ownVideoTakes = videos
      .filter(take =>
        keysOverlap(
          shotMaterialKeys(fact),
          shotIdentityMatchKeys(take.stableShotId)
        )
      )
      .map(take => {
        // 尺寸统一等派生变体（parameterSnapshot.sourceTakeId 指向源 take）：
        // 画面内容与源一致，不参与 prompt 新鲜度审判——否则统一完的方形版
        // 会因为继承源 take 的旧 promptCompilationId 被判 stale，
        // 导致统一完成的版本无法成为当前视频。
        const isDerivedVariant = Boolean(
          take.parameterSnapshot &&
            typeof take.parameterSnapshot === "object" &&
            !Array.isArray(take.parameterSnapshot) &&
            (take.parameterSnapshot as Record<string, unknown>).sourceTakeId !=
              null
        );
        const promptFreshness = isDerivedVariant
          ? ("legacy" as const)
          : resolvePromptAssetFreshness(
              take.promptCompilationId,
              videoCompilationId
            );
        const staleReasons = isDerivedVariant
          ? []
          : resolveVideoStaleReasons({
              sourceImageId: take.sourceImageId,
              currentImageId: currentImage?.id ?? null,
              promptFreshness,
            });
        return {
          ...take,
          promptFreshness,
          staleReasons,
          isStale: staleReasons.length > 0,
        };
      });
    const videoTakes = ownVideoTakes;
    const currentVideo =
      videoTakes.find(
        take =>
          take.isTimelineSelected &&
          take.status === "available" &&
          Boolean(take.videoUrl) &&
          !take.isStale
      ) ?? null;
    return {
      stableShotId: fact.stableShotId,
      shotNo: fact.shotNo,
      cueCode: fact.cueCode,
      currentImage,
      imageVersions,
      currentVideo,
      videoTakes,
      timelineItem: timelineByShot.get(fact.stableShotId) ?? null,
    };
  });
  const matchedVideoTakeIds = new Set(
    shots.flatMap(shot => shot.videoTakes.map(take => take.id))
  );

  return {
    storyId,
    timeline,
    unassignedImages: images.filter(
      image =>
        image.assignment === "unassigned" &&
        image.status !== "rejected" &&
        image.availability !== "missing"
    ),
    unassignedVideoTakes: videos.filter(
      take => !matchedVideoTakeIds.has(take.id)
    ),
    // 素材仓库严格属于当前故事。保留字段兼容现有客户端结构，但绝不
    // 将同一用户其他故事的素材投影进来。
    reusableVideoTakes: [],
    shots,
  };
}
