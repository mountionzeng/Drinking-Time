import type { Story } from "../../drizzle/schema";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryMaterialState,
  type StoryTimelineItem,
  type TimelineDocument,
  type TimelineTransform,
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
  getReusableVideoAssetsForStory,
  getStoryVideoAssets,
} from "./videoAssets";

type StoryShotFact = {
  stableShotId: string;
  shotNo: number;
  plannedDurationMs: number;
};

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function shotNoFromCanonical(value: unknown): number | null {
  const canonical = canonicalizeShotNo(
    value as string | number | null | undefined
  );
  return canonical ? Number(canonical.slice(2)) : null;
}

function keysOverlap(left: readonly string[], right: readonly string[]): boolean {
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
  const clamp = (key: keyof TimelineTransform, min: number, max: number) =>
    Math.min(max, Math.max(min, finite(record[key], DEFAULT_TIMELINE_TRANSFORM[key])));
  return {
    cropX: clamp("cropX", 0, 1),
    cropY: clamp("cropY", 0, 1),
    cropWidth: clamp("cropWidth", 0.01, 1),
    cropHeight: clamp("cropHeight", 0.01, 1),
    zoom: clamp("zoom", 1, 8),
    panX: clamp("panX", -1, 1),
    panY: clamp("panY", -1, 1),
  };
}

export function normalizeTimelineItems(
  value: unknown,
  facts: readonly StoryShotFact[]
): StoryTimelineItem[] {
  const known = new Map(facts.map(fact => [fact.stableShotId, fact]));
  const source = Array.isArray(value) ? value : [];
  const normalized: StoryTimelineItem[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const stableShotId = normalizeShotIdentity(item.stableShotId);
    const fact = stableShotId ? known.get(stableShotId) : undefined;
    if (!stableShotId || !fact || seen.has(stableShotId)) continue;
    seen.add(stableShotId);
    normalized.push({
      stableShotId,
      included: item.included !== false,
      position: normalized.length,
      plannedDurationMs: Math.max(
        100,
        finite(item.plannedDurationMs, fact.plannedDurationMs)
      ),
      transform: transform(item.transform),
    });
  }
  for (const fact of facts) {
    if (seen.has(fact.stableShotId)) continue;
    normalized.push({
      stableShotId: fact.stableShotId,
      included: true,
      position: normalized.length,
      plannedDurationMs: fact.plannedDurationMs,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    });
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
  const [images, videos, reusableVideos, timelineRow, promptProjection] =
    await Promise.all([
      getStoryImageAssets(storyId, userId),
      getStoryVideoAssets(storyId, userId),
      getReusableVideoAssetsForStory(storyId, userId),
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
    const videoTakes = videos
      .filter(take =>
        keysOverlap(
          shotMaterialKeys(fact),
          shotIdentityMatchKeys(take.stableShotId)
        )
      )
      .map(take => {
        const promptFreshness = resolvePromptAssetFreshness(
          take.promptCompilationId,
          videoCompilationId
        );
        const staleReasons = resolveVideoStaleReasons({
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
    reusableVideoTakes: reusableVideos,
    shots,
  };
}
