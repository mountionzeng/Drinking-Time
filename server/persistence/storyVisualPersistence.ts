import type {
  GeneratedImage,
  Story,
  StoryTimeline,
  VideoTake,
} from "../../drizzle/schema";
import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "../../shared/storyMaterial";
import type { VisualEditDocument } from "../../shared/visualClipModel";
import {
  getGeneratedImageById,
  getStoryById,
  getStoryTimeline,
  getStoryVideoTakes,
  getVideoTakeRangeById,
  updateStoryAndTimelineAtomic,
  updateStoryTimeline,
} from "../db";

export type StoryVisualTimelineRecord = StoryTimeline & {
  overlays?: unknown;
  visualLayerState?: unknown;
};

export type OwnedStoryVisualAggregate = {
  story: Story;
  timeline: StoryVisualTimelineRecord | null;
  videoTakes: VideoTake[];
};

export type AuthorizedStoryVisualReferences = {
  referencedImage: GeneratedImage | null;
  videoTakes: VideoTake[];
};

/** Lightweight ownership check for command replay/preflight paths. */
export async function loadOwnedStory(input: {
  storyId: number;
  userId: number;
}): Promise<Story | null> {
  return getStoryById(input.storyId, input.userId);
}

/**
 * Persistence owner for the Story + Timeline visual aggregate.
 *
 * This module deliberately returns owned aggregate facts instead of exposing
 * the database's unrelated row helpers to editing services. Pure planners and
 * Story material projection remain in the service/shared layers.
 */
export async function loadOwnedStoryVisualAggregate(input: {
  storyId: number;
  userId: number;
  includeVideoTakes?: boolean;
}): Promise<OwnedStoryVisualAggregate | null> {
  const [story, timeline, videoTakes] = await Promise.all([
    getStoryById(input.storyId, input.userId),
    getStoryTimeline(input.storyId, input.userId),
    input.includeVideoTakes
      ? getStoryVideoTakes(input.storyId, input.userId)
      : Promise.resolve([]),
  ]);
  if (!story) return null;
  return { story, timeline, videoTakes };
}

/**
 * Projects the stored timeline to the visual-only editing document. Non-visual
 * slices (subtitles in U3, audio in U9) are intentionally NOT surfaced here —
 * `updateStoryTimeline` / `updateStoryAndTimelineAtomic` preserve them from the
 * stored row on every save, so a visual writer never needs to see or thread
 * them. See server/persistence/storyTimelinePersistence.ts.
 */
export function visualDocumentFromTimeline(
  timeline: StoryVisualTimelineRecord
): VisualEditDocument | null {
  if (!Array.isArray(timeline.items)) return null;
  return {
    items: timeline.items as StoryTimelineItem[],
    ...(Array.isArray(timeline.overlays)
      ? { overlays: timeline.overlays as StoryTimelineOverlay[] }
      : {}),
    ...(timeline.visualLayerState
      ? {
          visualLayerState:
            timeline.visualLayerState as StoryTimelineVisualLayerState,
        }
      : {}),
  };
}

export async function saveStoryVisualTimelineCas(input: {
  storyId: number;
  userId: number;
  expectedVersion: number;
  document: VisualEditDocument;
}): Promise<StoryVisualTimelineRecord> {
  return updateStoryTimeline({
    storyId: input.storyId,
    userId: input.userId,
    expectedVersion: input.expectedVersion,
    items: input.document.items,
    ...(input.document.overlays === undefined
      ? {}
      : { overlays: input.document.overlays }),
    ...(input.document.visualLayerState === undefined
      ? {}
      : { visualLayerState: input.document.visualLayerState }),
  });
}

export async function saveStoryVisualAggregateCas(input: {
  storyId: number;
  userId: number;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextDocument: VisualEditDocument;
}) {
  return updateStoryAndTimelineAtomic({
    storyId: input.storyId,
    userId: input.userId,
    expectedStoryRevision: input.expectedStoryRevision,
    expectedTimelineVersion: input.expectedTimelineVersion,
    nextStoryBody: input.nextStoryBody,
    nextTimeline: {
      items: input.nextDocument.items,
      ...(input.nextDocument.overlays === undefined
        ? {}
        : { overlays: input.nextDocument.overlays }),
      ...(input.nextDocument.visualLayerState === undefined
        ? {}
        : { visualLayerState: input.nextDocument.visualLayerState }),
    },
  });
}

export async function loadStoryVideoSources(input: {
  storyId: number;
  userId: number;
}): Promise<VideoTake[]> {
  return getStoryVideoTakes(input.storyId, input.userId);
}

export async function loadAuthorizedStoryImage(input: {
  storyId: number;
  userId: number;
  imageId: number;
}): Promise<GeneratedImage | null> {
  const image = await getGeneratedImageById(input.imageId);
  return image &&
    image.storyId === input.storyId &&
    (image.userId == null || image.userId === input.userId)
    ? image
    : null;
}

/**
 * Re-authorize every durable media reference captured by a Story clipboard.
 * The caller gets one coherent allow-listed source set, never raw cross-Story
 * rows that it must remember to validate itself.
 */
export async function authorizeStoryVisualReferences(input: {
  storyId: number;
  userId: number;
  referencedImageId: number | null;
  takeRefs: readonly { takeId: number; rangeId: number | null }[];
}): Promise<AuthorizedStoryVisualReferences | null> {
  const [referencedImage, videoTakes] = await Promise.all([
    input.referencedImageId == null
      ? Promise.resolve(null)
      : loadAuthorizedStoryImage({
          storyId: input.storyId,
          userId: input.userId,
          imageId: input.referencedImageId,
        }),
    getStoryVideoTakes(input.storyId, input.userId),
  ]);
  if (input.referencedImageId != null && !referencedImage) return null;

  const takeById = new Map(videoTakes.map(take => [take.id, take] as const));
  for (const ref of input.takeRefs) {
    const take = takeById.get(ref.takeId);
    if (!take?.videoUrl) return null;
  }

  const rangeRefs = [
    ...new Map(
      input.takeRefs
        .filter(
          (ref): ref is { takeId: number; rangeId: number } =>
            ref.rangeId != null
        )
        .map(ref => [`${ref.takeId}:${ref.rangeId}`, ref] as const)
    ).values(),
  ];
  const ranges = await Promise.all(
    rangeRefs.map(ref => getVideoTakeRangeById(ref.rangeId, input.userId))
  );
  for (let index = 0; index < rangeRefs.length; index += 1) {
    const ref = rangeRefs[index];
    const range = ranges[index];
    if (
      !range ||
      range.storyId !== input.storyId ||
      range.takeId !== ref.takeId
    ) {
      return null;
    }
  }
  return { referencedImage, videoTakes };
}
