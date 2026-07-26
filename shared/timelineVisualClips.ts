import type {
  StoryTimelineItem,
  StoryTimelineVisualClip,
} from "./storyMaterial";

function clipEndMs(clip: StoryTimelineVisualClip): number {
  return clip.offsetMs + clip.durationMs;
}

function insertionOffset(
  clips: readonly StoryTimelineVisualClip[],
  requestedOffsetMs: number | undefined
): number {
  const endMs = clips.reduce(
    (maximum, clip) => Math.max(maximum, clipEndMs(clip)),
    0
  );
  if (requestedOffsetMs == null || !Number.isFinite(requestedOffsetMs)) {
    return endMs;
  }
  const requested = Math.min(endMs, Math.max(0, requestedOffsetMs));
  const containingClip = clips.find(
    clip => requested > clip.offsetMs && requested < clipEndMs(clip)
  );
  return containingClip ? clipEndMs(containingClip) : requested;
}

/**
 * Inserts one video as a sequential clip. If the shot still uses a primary
 * video, callers can supply its lossless clip representation so the insert
 * switches the shot to multi-clip playback without replacing existing media.
 */
export function insertTimelineVisualClip(input: {
  item: StoryTimelineItem;
  clip: StoryTimelineVisualClip;
  primaryClip?: StoryTimelineVisualClip | null;
  targetOffsetMs?: number;
}): StoryTimelineItem {
  const existing = input.item.visualClipsReplacePrimary
    ? [...(input.item.visualClips ?? [])]
    : [
        ...(input.primaryClip ? [input.primaryClip] : []),
        ...(input.item.visualClips ?? []),
      ];
  const offsetMs = insertionOffset(existing, input.targetOffsetMs);
  const shifted = existing.map(clip =>
    clip.offsetMs >= offsetMs
      ? { ...clip, offsetMs: clip.offsetMs + input.clip.durationMs }
      : clip
  );
  const visualClips = [
    ...shifted,
    {
      ...input.clip,
      offsetMs,
    },
  ].sort(
    (left, right) =>
      left.offsetMs - right.offsetMs || left.id.localeCompare(right.id)
  );
  const endMs = visualClips.reduce(
    (maximum, clip) => Math.max(maximum, clipEndMs(clip)),
    0
  );
  return {
    ...input.item,
    plannedDurationMs: Math.max(100, endMs),
    visualClips,
    visualClipsReplacePrimary: true,
  };
}
