import type { Story } from "../../drizzle/schema";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  timelineMsToFrames,
  type StoryMaterialState,
  type StoryTimelineAnchor,
  type StoryTimelineImageClip,
  type StoryTimelinePrimaryVideoEdit,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
  type StoryTimelineVisualClip,
  type StoryTimelineVisualLayerState,
  type TimelineDocument,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import { normalizePersistedVisualLayerState } from "../../shared/timelineVisualLayers";
import {
  normalizeShotIdentity,
  shotIdentityMatchKeys,
} from "../../shared/shotIdentity";
import { normalizeStoryVisualAssets } from "../../shared/visualAssets";
import { getStoryById, getStoryTimeline } from "../db";
import { getStoryImageAssets } from "./imageAssets";
import { getStoryPromptCompilationHeads } from "./promptLineage";
import {
  resolvePromptAssetFreshness,
  resolveVideoStaleReasons,
} from "./promptMaterialProjection";
import { getStoryVideoAssets } from "./videoAssets";

type StoryShotFact = {
  stableShotId: string;
  splitSourceStableShotId: string | null;
  relatedImageIds: number[];
  shotNo: number;
  cueCode: string | null;
  plannedDurationMs: number;
};

function positiveImageId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function positiveImageIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(positiveImageId).filter((id): id is number => id != null)
    : [];
}

function imageIdsFromRecord(value: unknown): number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const ids: number[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (/imageId$/i.test(key)) {
      const id = positiveImageId(child);
      if (id != null) ids.push(id);
      continue;
    }
    if (/imageIds$/i.test(key)) {
      ids.push(...positiveImageIds(child));
      continue;
    }
    if (child && typeof child === "object") {
      ids.push(...imageIdsFromRecord(child));
    }
  }
  return Array.from(new Set(ids));
}

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
    (left, right) =>
      left.timelineFrame - right.timelineFrame ||
      left.id.localeCompare(right.id)
  );
}

function timelineOverlays(value: unknown): StoryTimelineOverlay[] {
  if (!Array.isArray(value)) return [];
  const overlays: StoryTimelineOverlay[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const sourceStableShotId =
      typeof record.sourceStableShotId === "string"
        ? record.sourceStableShotId.trim()
        : "";
    const videoUrl =
      typeof record.videoUrl === "string" ? record.videoUrl.trim() : "";
    const takeId = nonNegativeInteger(record.takeId);
    const startFrame = nonNegativeInteger(record.startFrame);
    const targetEndFrame = nonNegativeInteger(record.targetEndFrame);
    const mediaEndFrame = nonNegativeInteger(record.mediaEndFrame);
    const endFrame = nonNegativeInteger(record.endFrame);
    const stackOrder = nonNegativeInteger(record.stackOrder);
    const leftImageId = nonNegativeInteger(record.leftImageId);
    const rightImageId = nonNegativeInteger(record.rightImageId);
    if (
      record.kind !== "generated-video" ||
      !id ||
      seen.has(id) ||
      !sourceStableShotId ||
      !videoUrl ||
      takeId == null ||
      takeId < 1 ||
      startFrame == null ||
      targetEndFrame == null ||
      targetEndFrame <= startFrame ||
      mediaEndFrame == null ||
      mediaEndFrame <= startFrame ||
      endFrame == null ||
      endFrame !== Math.max(targetEndFrame, mediaEndFrame) ||
      stackOrder == null ||
      leftImageId == null ||
      leftImageId < 1 ||
      rightImageId == null ||
      rightImageId < 1
    ) {
      continue;
    }
    seen.add(id);
    overlays.push({
      id,
      kind: "generated-video",
      takeId,
      sourceStableShotId,
      videoUrl,
      startFrame,
      targetEndFrame,
      mediaEndFrame,
      endFrame,
      stackOrder,
      // 没有这个字段的历史 overlay 由解析层按写死的上层 1 处理；写过就必须原样带回，
      // 否则图层重排之后 overlay 会回到错误的层。
      ...(nonNegativeInteger(record.visualLayer) == null
        ? {}
        : { visualLayer: nonNegativeInteger(record.visualLayer)! }),
      leftImageId,
      rightImageId,
      transform: transform(record.transform),
      effects: optionalVideoEffects(record.effects),
    });
  }
  return overlays.sort(
    (left, right) =>
      left.startFrame - right.startFrame || left.id.localeCompare(right.id)
  );
}

function timelineVisualLayerState(
  value: unknown
): StoryTimelineVisualLayerState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const count = nonNegativeInteger(record.count);
  if (count == null || count < 1) return undefined;
  return {
    count,
    hidden: Array.isArray(record.hidden)
      ? record.hidden.flatMap(value => {
          const layer = nonNegativeInteger(value);
          return layer == null ? [] : [layer];
        })
      : [],
  };
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

function identitiesMatchExactly(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeShotIdentity(left);
  const normalizedRight = normalizeShotIdentity(right);
  return normalizedLeft != null && normalizedLeft === normalizedRight;
}

function shotMaterialKeys(
  fact: StoryShotFact,
  allowLegacyAliases = true
): string[] {
  const stableShotId = normalizeShotIdentity(fact.stableShotId);
  const splitSourceStableShotId = normalizeShotIdentity(
    fact.splitSourceStableShotId
  );
  if (!allowLegacyAliases) {
    return [stableShotId, splitSourceStableShotId].filter(
      (identity): identity is string => identity != null
    );
  }
  return Array.from(
    new Set([
      ...shotIdentityMatchKeys(fact.stableShotId, fact.shotNo),
      ...(fact.splitSourceStableShotId
        ? shotIdentityMatchKeys(fact.splitSourceStableShotId)
        : []),
    ])
  );
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
        splitSourceStableShotId:
          normalizeShotIdentity(shot.splitSourceStableShotId) ?? null,
        relatedImageIds: imageIdsFromRecord(shot.sourceTransition),
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

function timelineImageClips(value: unknown): StoryTimelineImageClip[] {
  if (!Array.isArray(value)) return [];
  const normalized: StoryTimelineImageClip[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const clip = raw as Record<string, unknown>;
    const id = typeof clip.id === "string" ? clip.id.trim() : "";
    const imageId = nonNegativeInteger(clip.imageId);
    const imageUrl =
      typeof clip.imageUrl === "string" ? clip.imageUrl.trim() : "";
    const offsetFrames = nonNegativeInteger(clip.offsetFrames);
    const timelineStartFrame = nonNegativeInteger(clip.timelineStartFrame);
    const durationFrames = nonNegativeInteger(clip.durationFrames);
    const visualLayer = nonNegativeInteger(clip.visualLayer);
    if (
      !id ||
      seen.has(id) ||
      imageId == null ||
      imageId < 1 ||
      !imageUrl ||
      offsetFrames == null ||
      durationFrames == null ||
      durationFrames < 1 ||
      visualLayer == null
    ) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      imageId,
      imageUrl,
      label:
        typeof clip.label === "string" && clip.label.trim()
          ? clip.label.trim().slice(0, 120)
          : `图片 ${normalized.length + 1}`,
      offsetFrames,
      ...(timelineStartFrame == null ? {} : { timelineStartFrame }),
      durationFrames,
      visualLayer,
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
      left.offsetFrames - right.offsetFrames ||
      left.visualLayer - right.visualLayer ||
      left.id.localeCompare(right.id)
  );
}

type PreparedTimelineItem = {
  stableShotId: string;
  raw: Record<string, unknown> | null;
  plannedDurationMs: number;
  durationFrames: number;
  explicitStartFrame: number | null;
  explicitStackOrder: number | null;
};

export function normalizeTimelineItems(
  value: unknown,
  facts: readonly StoryShotFact[]
): StoryTimelineItem[] {
  const known = new Map(facts.map(fact => [fact.stableShotId, fact]));
  const source = Array.isArray(value) ? value : [];

  // Pass 1 reads the placement each item already carries. A second pass is
  // required because an item missing a start must be appended after the
  // *global* maximum end, including explicit items that come after it.
  const prepared: PreparedTimelineItem[] = [];
  const seen = new Set<string>();
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
    prepared.push({
      stableShotId,
      raw: item,
      plannedDurationMs,
      durationFrames: Math.max(
        1,
        nonNegativeInteger(item.durationFrames) ??
          timelineMsToFrames(plannedDurationMs)
      ),
      explicitStartFrame: nonNegativeInteger(item.timelineStartFrame) ?? null,
      explicitStackOrder: nonNegativeInteger(item.stackOrder) ?? null,
    });
  }
  for (const fact of facts) {
    if (seen.has(fact.stableShotId)) continue;
    prepared.push({
      stableShotId: fact.stableShotId,
      raw: null,
      plannedDurationMs: fact.plannedDurationMs,
      durationFrames: timelineMsToFrames(fact.plannedDurationMs),
      explicitStartFrame: null,
      explicitStackOrder: null,
    });
  }

  const hasExplicitPlacement = prepared.some(
    entry => entry.explicitStartFrame != null
  );
  const hasExplicitStackOrder = prepared.some(
    entry => entry.explicitStackOrder != null
  );
  let appendCursorFrame = prepared.reduce(
    (maximum, entry) =>
      entry.explicitStartFrame == null
        ? maximum
        : Math.max(maximum, entry.explicitStartFrame + entry.durationFrames),
    0
  );
  let nextStackOrder = prepared.reduce(
    (maximum, entry) =>
      entry.explicitStackOrder == null
        ? maximum
        : Math.max(maximum, entry.explicitStackOrder + 1),
    0
  );
  let legacyCursorFrame = 0;

  return prepared.map((entry, position) => {
    const timelineStartFrame =
      entry.explicitStartFrame ??
      (hasExplicitPlacement ? appendCursorFrame : legacyCursorFrame);
    if (entry.explicitStartFrame == null && hasExplicitPlacement) {
      appendCursorFrame = timelineStartFrame + entry.durationFrames;
    }
    legacyCursorFrame = timelineStartFrame + entry.durationFrames;
    const stackOrder =
      entry.explicitStackOrder ??
      (hasExplicitStackOrder ? nextStackOrder++ : position);
    const item = entry.raw;
    if (!item) {
      return {
        stableShotId: entry.stableShotId,
        included: true,
        position,
        plannedDurationMs: entry.plannedDurationMs,
        durationFrames: entry.durationFrames,
        timelineStartFrame,
        stackOrder,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      } satisfies StoryTimelineItem;
    }
    const anchors = timelineAnchors(item.anchors);
    return {
      stableShotId: entry.stableShotId,
      included: item.included !== false,
      position,
      plannedDurationMs: entry.plannedDurationMs,
      durationFrames: entry.durationFrames,
      timelineStartFrame,
      stackOrder,
      visualLayer: nonNegativeInteger(item.visualLayer) ?? 0,
      ...(positiveImageId(item.referencedImageId) == null
        ? {}
        : { referencedImageId: positiveImageId(item.referencedImageId)! }),
      ...(typeof item.detachedFromPreviousShotId === "string" &&
      item.detachedFromPreviousShotId.trim()
        ? { detachedFromPreviousShotId: item.detachedFromPreviousShotId.trim() }
        : {}),
      ...(anchors.length > 0 ? { anchors } : {}),
      transform: transform(item.transform),
      primaryVideoEdit: primaryVideoEdit(item.primaryVideoEdit),
      visualClips: visualClips(item.visualClips),
      imageClips: timelineImageClips(item.imageClips),
      visualClipsReplacePrimary: item.visualClipsReplacePrimary === true,
    } satisfies StoryTimelineItem;
  });
}

export async function getStoryMaterialState(
  storyId: number,
  userId: number
): Promise<StoryMaterialState | null> {
  const story = await getStoryById(storyId, userId);
  if (!story) return null;
  const facts = storyShots(story);
  const shotNoCounts = new Map<number, number>();
  for (const fact of facts) {
    shotNoCounts.set(fact.shotNo, (shotNoCounts.get(fact.shotNo) ?? 0) + 1);
  }
  const storyBody =
    story.body && typeof story.body === "object" && !Array.isArray(story.body)
      ? (story.body as Record<string, unknown>)
      : {};
  const visualAssetAggregate = normalizeStoryVisualAssets(
    storyBody.visualAssets,
    { legacyArtDirection: storyBody.artDirection ?? {} }
  );
  const visualAssetBindingByShot = new Map(
    visualAssetAggregate.bindings.map(binding => [
      binding.stableShotId,
      binding,
    ])
  );
  const [images, videos, timelineRow, promptCompilationHeads] =
    await Promise.all([
      getStoryImageAssets(storyId, userId),
      getStoryVideoAssets(storyId, userId),
      getStoryTimeline(storyId, userId),
      getStoryPromptCompilationHeads({ storyId, userId }),
    ]);
  const timelineItems = normalizeTimelineItems(timelineRow?.items, facts);
  const timeline: TimelineDocument = {
    storyId,
    version: timelineRow?.version ?? 0,
    items: timelineItems,
    overlays: timelineOverlays(timelineRow?.overlays),
    // 落库形态：显式层数 + 隐藏集合。最高那层空白投放层由客户端和导出各自派生，
    // 不写进文档——写进去就会让「拖上顶层再拖回来」永久多出一层。
    visualLayerState: normalizePersistedVisualLayerState(
      timelineVisualLayerState(timelineRow?.visualLayerState)
    ),
  };
  const timelineByShot = new Map(
    timeline.items.map(item => [item.stableShotId, item])
  );
  const compilationHeadByKey = new Map(
    promptCompilationHeads.map(head => [
      `${head.stableShotId}:${head.modality}`,
      head.currentCompilationId,
    ])
  );
  const availableImages = images.filter(
    image => image.status !== "rejected" && image.availability !== "missing"
  );
  const imageById = new Map(availableImages.map(image => [image.id, image]));
  const childImageIdsByParent = new Map<number, number[]>();
  for (const image of availableImages) {
    if (image.parentImageId == null) continue;
    const children = childImageIdsByParent.get(image.parentImageId) ?? [];
    children.push(image.id);
    childImageIdsByParent.set(image.parentImageId, children);
  }

  const imageLineageIds = (seedIds: Iterable<number>) => {
    const seen = new Set<number>();
    const queue = Array.from(seedIds);
    while (queue.length > 0) {
      const imageId = queue.shift();
      if (imageId == null || seen.has(imageId)) continue;
      const image = imageById.get(imageId);
      if (!image) continue;
      seen.add(imageId);
      if (image.parentImageId != null) queue.push(image.parentImageId);
      queue.push(...(childImageIdsByParent.get(imageId) ?? []));
    }
    return seen;
  };

  const shots = facts.map(fact => {
    const timelineItem = timelineByShot.get(fact.stableShotId) ?? null;
    const referencedImage =
      timelineItem?.referencedImageId == null
        ? null
        : (imageById.get(timelineItem.referencedImageId) ?? null);
    const timelineTakeIds = new Set(
      [
        timelineItem?.primaryVideoEdit?.takeId,
        ...(timelineItem?.visualClips ?? []).map(clip => clip.takeId),
      ].filter((takeId): takeId is number => takeId != null)
    );
    const imageCompilationId =
      compilationHeadByKey.get(`${fact.stableShotId}:image`) ?? null;
    const videoCompilationId =
      compilationHeadByKey.get(`${fact.stableShotId}:video`) ?? null;
    const ownedImageVersions = availableImages
      .filter(image =>
        keysOverlap(
          shotMaterialKeys(fact, shotNoCounts.get(fact.shotNo) === 1),
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
    const imageVersions = [
      ...ownedImageVersions,
      ...(referencedImage &&
      !ownedImageVersions.some(image => image.id === referencedImage.id)
        ? [
            {
              ...referencedImage,
              promptFreshness: resolvePromptAssetFreshness(
                referencedImage.promptCompilationId,
                imageCompilationId
              ),
            },
          ]
        : []),
    ];
    const currentImage =
      (referencedImage
        ? imageVersions.find(image => image.id === referencedImage.id)
        : null) ??
      imageVersions.find(image => image.isPrimary) ??
      null;
    const rawOwnVideoTakes = videos.filter(
      take =>
        timelineTakeIds.has(take.id) ||
        keysOverlap(
          shotMaterialKeys(fact, shotNoCounts.get(fact.shotNo) === 1),
          shotIdentityMatchKeys(take.stableShotId)
        )
      );
    const relatedSeedIds = new Set<number>(fact.relatedImageIds);
    for (const overlay of timeline.overlays ?? []) {
      if (overlay.sourceStableShotId !== fact.stableShotId) continue;
      relatedSeedIds.add(overlay.leftImageId);
      relatedSeedIds.add(overlay.rightImageId);
    }
    const relatedInputTakes = rawOwnVideoTakes.filter(
      take =>
        timelineTakeIds.has(take.id) ||
        identitiesMatchExactly(take.stableShotId, fact.stableShotId) ||
        identitiesMatchExactly(take.stableShotId, fact.splitSourceStableShotId)
    );
    for (const take of relatedInputTakes) {
      if (take.sourceImageId != null) relatedSeedIds.add(take.sourceImageId);
      for (const imageId of imageIdsFromRecord(take.parameterSnapshot)) {
        relatedSeedIds.add(imageId);
      }
    }
    for (const image of imageVersions) relatedSeedIds.add(image.id);
    const directImageIds = new Set(imageVersions.map(image => image.id));
    const relatedImages = Array.from(imageLineageIds(relatedSeedIds))
      .filter(imageId => !directImageIds.has(imageId))
      .flatMap(imageId => {
        const image = imageById.get(imageId);
        return image
          ? [
              {
                ...image,
                promptFreshness: resolvePromptAssetFreshness(
                  image.promptCompilationId,
                  imageCompilationId
                ),
              },
            ]
          : [];
      });
    const ownVideoTakes = rawOwnVideoTakes.map(take => {
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
          take.id === timelineItem?.primaryVideoEdit?.takeId &&
          take.status === "available" &&
          Boolean(take.videoUrl)
      ) ??
      videoTakes.find(
        take =>
          take.isTimelineSelected &&
          take.status === "available" &&
          Boolean(take.videoUrl) &&
          !take.isStale
      ) ??
      null;
    return {
      stableShotId: fact.stableShotId,
      shotNo: fact.shotNo,
      cueCode: fact.cueCode,
      currentImage,
      imageVersions,
      relatedImages,
      currentVideo,
      videoTakes,
      timelineItem,
      visualAssetBinding:
        visualAssetBindingByShot.get(fact.stableShotId) ?? null,
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
    visualAssets: {
      assets: visualAssetAggregate.assets,
      proposals: visualAssetAggregate.proposals,
      bindings: visualAssetAggregate.bindings,
      images: images.filter(image => image.kind === "visual_asset"),
    },
    shots,
  };
}
