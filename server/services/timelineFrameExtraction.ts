import {
  STORY_TIMELINE_FPS,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import {
  overlayVisualLayer,
  resolveTimelineVisualFrame,
} from "../../shared/timelineLayout";
import {
  resolveTimelineItemSource,
  resolveTimelineSource,
  timelineSourceCandidateForOverlay,
  type TimelineSourceCandidate,
} from "../../shared/timelineSource";
import { normalizeVisualLayer } from "../../shared/timelineVisualPriority";

export type TimelineFrameExtractionDocument = {
  items: readonly StoryTimelineItem[];
  overlays?: readonly StoryTimelineOverlay[];
};

export type CurrentTimelineVideo = {
  takeId: number;
  durationSec: number | null;
  rangeId?: number | null;
  sourceStartSec?: number;
  sourceEndSec?: number;
  effects?: TimelineVideoEffects | null;
};

export type TimelineImageExtractionDescriptor = {
  kind: "image";
  timelineFrame: number;
  visualLayer: number;
  winnerIdentity: string;
  clipId: string;
  ownerStableShotId: string;
  imageId: number;
  imageUrl: string;
};

export type TimelineVideoExtractionDescriptor = {
  kind: "video";
  timelineFrame: number;
  visualLayer: number;
  winnerIdentity: string;
  ownerStableShotId: string;
  takeId: number;
  rangeId: number | null;
  sourceStableShotId: string;
  sourceClipId: string | null;
  atSec: number;
};

export type TimelineFrameExtractionDescriptor =
  | TimelineImageExtractionDescriptor
  | TimelineVideoExtractionDescriptor;

export type TimelineFrameExtractionResult =
  | { status: "ok"; descriptor: TimelineFrameExtractionDescriptor }
  | { status: "error"; error: "gap" | "media-unavailable" };

function currentVideoCandidate(
  item: StoryTimelineItem,
  durationFrames: number,
  current: CurrentTimelineVideo | undefined
): TimelineSourceCandidate | null {
  if (!current || !Number.isInteger(current.takeId) || current.takeId <= 0) {
    return null;
  }
  const sourceStartSec = Math.max(0, current.sourceStartSec ?? 0);
  const sourceEndSec = current.sourceEndSec ?? current.durationSec;
  if (
    sourceEndSec == null ||
    !Number.isFinite(sourceEndSec) ||
    sourceEndSec <= sourceStartSec
  ) {
    return null;
  }
  return {
    sourceType: "primary-video",
    sourceId: `current-take-${current.takeId}`,
    offsetFrame: 0,
    durationFrames,
    sourceStartSec,
    sourceEndSec,
    effects: current.effects ?? null,
    transform: item.transform,
  };
}

function finiteSourceTime(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Convert the single authoritative visual winner into a capture descriptor.
 *
 * This function deliberately calls `resolveTimelineVisualFrame` exactly once.
 * Once a story row wins, resolving its owned/primary media is an intra-row
 * lookup and must never perform another cross-layer winner election.
 */
export function resolveTimelineFrameExtraction(input: {
  document: TimelineFrameExtractionDocument;
  timelineFrame: number;
  hiddenVisualLayers?: readonly number[];
  currentVideosByShot?: ReadonlyMap<string, CurrentTimelineVideo>;
}): TimelineFrameExtractionResult {
  const timelineFrame = Math.max(0, Math.round(input.timelineFrame));
  const winner = resolveTimelineVisualFrame({
    items: input.document.items,
    overlays: input.document.overlays,
    hiddenVisualLayers: input.hiddenVisualLayers,
    frame: timelineFrame,
  });

  if (winner.kind === "gap") {
    return { status: "error", error: "gap" };
  }

  if (winner.kind === "image") {
    const { clip, stableShotId } = winner.placement;
    return {
      status: "ok",
      descriptor: {
        kind: "image",
        timelineFrame,
        visualLayer: normalizeVisualLayer(clip.visualLayer),
        winnerIdentity: `image-clip:${clip.id}`,
        clipId: clip.id,
        ownerStableShotId: stableShotId,
        imageId: clip.imageId,
        imageUrl: clip.imageUrl,
      },
    };
  }

  if (winner.kind === "overlay") {
    const source = resolveTimelineSource({
      item: {
        stableShotId: winner.overlay.sourceStableShotId,
        included: true,
        position: 0,
        plannedDurationMs:
          ((winner.overlay.mediaEndFrame - winner.overlay.startFrame) * 1_000) /
          STORY_TIMELINE_FPS,
        transform: winner.overlay.transform,
      },
      localFrame: winner.localFrame,
      primary: timelineSourceCandidateForOverlay(winner.overlay),
    });
    const atSec =
      source.kind === "source" ? finiteSourceTime(source.sourceTimeSec) : null;
    if (atSec == null) {
      return { status: "error", error: "media-unavailable" };
    }
    return {
      status: "ok",
      descriptor: {
        kind: "video",
        timelineFrame,
        visualLayer: overlayVisualLayer(winner.overlay),
        winnerIdentity: `legacy-overlay:${winner.overlay.id}`,
        ownerStableShotId: winner.overlay.sourceStableShotId,
        takeId: winner.overlay.takeId,
        rangeId: null,
        sourceStableShotId: winner.overlay.sourceStableShotId,
        sourceClipId: winner.overlay.id,
        atSec,
      },
    };
  }

  const { item } = winner.row;
  const currentVideo = input.currentVideosByShot?.get(item.stableShotId);
  const source = resolveTimelineItemSource({
    item,
    localFrame: winner.localFrame,
    durationFrames: winner.row.durationFrames,
    fallback: currentVideoCandidate(item, winner.row.durationFrames, currentVideo),
  });
  if (source.kind === "gap") {
    return { status: "error", error: "media-unavailable" };
  }
  const atSec = finiteSourceTime(source.sourceTimeSec);
  if (atSec == null) {
    return { status: "error", error: "media-unavailable" };
  }

  if (source.sourceType === "visual-clip") {
    const clip = item.visualClips?.find(candidate => candidate.id === source.sourceId);
    if (!clip) {
      return { status: "error", error: "media-unavailable" };
    }
    return {
      status: "ok",
      descriptor: {
        kind: "video",
        timelineFrame,
        visualLayer: normalizeVisualLayer(clip.visualLayer ?? item.visualLayer),
        winnerIdentity: `owned-video-clip:${item.stableShotId}:${clip.id}`,
        ownerStableShotId: item.stableShotId,
        takeId: clip.takeId,
        rangeId: clip.rangeId,
        sourceStableShotId: clip.sourceStableShotId,
        sourceClipId: clip.id,
        atSec,
      },
    };
  }

  if (source.sourceType !== "primary-video") {
    return { status: "error", error: "media-unavailable" };
  }
  const takeId = item.primaryVideoEdit?.takeId ?? currentVideo?.takeId;
  if (takeId == null || !Number.isInteger(takeId) || takeId <= 0) {
    return { status: "error", error: "media-unavailable" };
  }
  return {
    status: "ok",
    descriptor: {
      kind: "video",
      timelineFrame,
      visualLayer: normalizeVisualLayer(item.visualLayer),
      winnerIdentity: `story-shot:${item.stableShotId}:primary`,
      ownerStableShotId: item.stableShotId,
      takeId,
      rangeId: item.primaryVideoEdit ? null : (currentVideo?.rangeId ?? null),
      sourceStableShotId: item.stableShotId,
      sourceClipId: null,
      atSec,
    },
  };
}
