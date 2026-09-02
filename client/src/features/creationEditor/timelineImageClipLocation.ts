import type {
  StoryTimelineImageClip,
  StoryTimelineItem,
} from "@shared/storyMaterial";

export type TimelineImageClipLocation = {
  stableShotId: string;
  clip: StoryTimelineImageClip;
};

/**
 * Resolve an independent timeline image by clip identity, not by the video
 * source that produced it. Absolute placement may persist the image under a
 * different timeline item, so the storage host must come from the refreshed
 * authoritative document.
 */
export function findTimelineImageClipLocation(
  items: readonly StoryTimelineItem[],
  clipId: string
): TimelineImageClipLocation | null {
  for (const item of items) {
    const clip = item.imageClips?.find(candidate => candidate.id === clipId);
    if (clip) return { stableShotId: item.stableShotId, clip };
  }
  return null;
}
