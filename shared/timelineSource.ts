import {
  timelineMsToFrames,
  type StoryTimelineItem,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "./storyMaterial";

export type TimelineSourceCandidate = {
  sourceType: "primary-video" | "visual-clip" | "image";
  sourceId: string;
  offsetFrame: number;
  durationFrames: number;
  sourceStartSec: number | null;
  sourceEndSec: number | null;
  effects?: TimelineVideoEffects | null;
  transform?: TimelineTransform | null;
};

export type TimelineSourceResolution =
  | { kind: "gap"; localFrame: number }
  | {
      kind: "source";
      sourceType: TimelineSourceCandidate["sourceType"];
      sourceId: string;
      localFrame: number;
      sourceTimeSec: number | null;
      effects: TimelineVideoEffects | null;
      transform: TimelineTransform | null;
    };

export type TimelineSourceInput = {
  item: StoryTimelineItem;
  localFrame: number;
  primary?: TimelineSourceCandidate | null;
  visualClips?: readonly TimelineSourceCandidate[];
  visualClipsReplacePrimary?: boolean;
};

function containing(
  candidate: TimelineSourceCandidate,
  localFrame: number
): boolean {
  return (
    localFrame >= candidate.offsetFrame &&
    localFrame < candidate.offsetFrame + Math.max(1, candidate.durationFrames)
  );
}

function sourceTimeForCandidate(
  candidate: TimelineSourceCandidate,
  localFrame: number
): number | null {
  if (
    candidate.sourceStartSec == null ||
    candidate.sourceEndSec == null ||
    candidate.sourceEndSec <= candidate.sourceStartSec
  ) {
    return null;
  }
  const durationFrames = Math.max(1, candidate.durationFrames);
  const progress = Math.min(
    1,
    Math.max(0, (localFrame - candidate.offsetFrame) / durationFrames)
  );
  const directedProgress = candidate.effects?.reverse ? 1 - progress : progress;
  return (
    candidate.sourceStartSec +
    (candidate.sourceEndSec - candidate.sourceStartSec) * directedProgress
  );
}

export function timelineSourceCandidateForVisualClip(
  clip: NonNullable<StoryTimelineItem["visualClips"]>[number]
): TimelineSourceCandidate {
  return {
    sourceType: "visual-clip",
    sourceId: clip.id,
    offsetFrame: timelineMsToFrames(clip.offsetMs),
    durationFrames: timelineMsToFrames(clip.durationMs),
    sourceStartSec: clip.sourceStartSec,
    sourceEndSec: clip.sourceEndSec,
    effects: clip.effects ?? null,
    transform: clip.transform ?? null,
  };
}

export function resolveTimelineSource(
  input: TimelineSourceInput
): TimelineSourceResolution {
  const localFrame = Math.max(0, Math.floor(input.localFrame));
  const visualClips = [...(input.visualClips ?? [])]
    .filter(clip => containing(clip, localFrame))
    .sort(
      (left, right) =>
        right.offsetFrame - left.offsetFrame || right.sourceId.localeCompare(left.sourceId)
    );
  const candidate = visualClips[0] ??
    (input.visualClipsReplacePrimary ? null : input.primary ?? null);
  if (!candidate || !containing(candidate, localFrame)) {
    return { kind: "gap", localFrame };
  }
  return {
    kind: "source",
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    localFrame,
    sourceTimeSec: sourceTimeForCandidate(candidate, localFrame),
    effects: candidate.effects ?? null,
    transform: candidate.transform ?? null,
  };
}
