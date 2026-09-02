import {
  STORY_TIMELINE_FPS,
  timelineMsToFrames,
  timelineOffsetMsToFrames,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "./storyMaterial";

/** Matches the playback-rate clamp the exporter and preview already apply. */
const MINIMUM_PLAYBACK_RATE = 0.25;
const MAXIMUM_PLAYBACK_RATE = 4;

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
      /** 源秒数 / 时间线秒数。导出按它换算区间要取多长的源。 */
      rate: number;
      /** 这一段可用的源窗口；越过它画面就停在最后一帧。 */
      sourceWindow: { startSec: number; endSec: number } | null;
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

function clampRate(value: number): number {
  return Math.min(MAXIMUM_PLAYBACK_RATE, Math.max(MINIMUM_PLAYBACK_RATE, value));
}

/**
 * The effective source-seconds-per-timeline-second of a source. An explicit
 * playback rate wins; otherwise it is inferred from the source window, which
 * is what the exporter and the preview already do.
 */
export function timelineSourceRate(input: {
  sourceStartSec: number | null;
  sourceEndSec: number | null;
  durationFrames: number;
  effects?: TimelineVideoEffects | null;
}): number {
  const explicit = input.effects?.playbackRate;
  if (Number.isFinite(explicit) && (explicit as number) > 0) {
    return clampRate(explicit as number);
  }
  if (input.sourceStartSec == null || input.sourceEndSec == null) return 1;
  const durationSec = Math.max(1, input.durationFrames) / STORY_TIMELINE_FPS;
  const spanSec = input.sourceEndSec - input.sourceStartSec;
  if (!(spanSec > 0) || !(durationSec > 0)) return 1;
  return clampRate(spanSec / durationSec);
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
  const rate = timelineSourceRate(candidate);
  const offsetSec = (localFrame - candidate.offsetFrame) / STORY_TIMELINE_FPS;
  const spanSec = candidate.sourceEndSec - candidate.sourceStartSec;
  const consumedSec = Math.min(spanSec, Math.max(0, offsetSec * rate));
  return candidate.effects?.reverse
    ? candidate.sourceEndSec - consumedSec
    : candidate.sourceStartSec + consumedSec;
}

export type TimelineSourceWindow = {
  sourceStartSec: number;
  sourceEndSec: number;
};

/**
 * Move a source window so that trimming a shot never changes which source
 * frame any surviving timeline frame shows.
 *
 * `startShiftFrames` is how far the *near* (head) edge moved: positive trims
 * content away, negative extends earlier. A forward source keeps its out point
 * fixed under a head trim and its in point fixed under a tail trim; a reverse
 * source mirrors both.
 */
export function retimeSourceWindow(input: {
  window: TimelineSourceWindow;
  rate: number;
  reverse: boolean;
  startShiftFrames: number;
  durationFrames: number;
}): TimelineSourceWindow {
  const shiftSec = (input.startShiftFrames / STORY_TIMELINE_FPS) * input.rate;
  const spanSec = (Math.max(1, input.durationFrames) / STORY_TIMELINE_FPS) * input.rate;
  if (input.reverse) {
    // A reverse source shows its out point first, so trimming the head moves
    // the out point *earlier* in the source by the same amount.
    const sourceEndSec = input.window.sourceEndSec - shiftSec;
    return { sourceStartSec: sourceEndSec - spanSec, sourceEndSec };
  }
  const sourceStartSec = input.window.sourceStartSec + shiftSec;
  return { sourceStartSec, sourceEndSec: sourceStartSec + spanSec };
}

export function timelineSourceCandidateForVisualClip(
  clip: NonNullable<StoryTimelineItem["visualClips"]>[number]
): TimelineSourceCandidate {
  return {
    sourceType: "visual-clip",
    sourceId: clip.id,
    offsetFrame: timelineOffsetMsToFrames(clip.offsetMs),
    durationFrames: timelineMsToFrames(clip.durationMs),
    sourceStartSec: clip.sourceStartSec,
    sourceEndSec: clip.sourceEndSec,
    effects: clip.effects ?? null,
    transform: clip.transform ?? null,
  };
}

export function timelineSourceCandidateForImage(input: {
  imageId: number | string;
  durationFrames: number;
}): TimelineSourceCandidate {
  return {
    sourceType: "image",
    sourceId: `image-${input.imageId}`,
    offsetFrame: 0,
    durationFrames: input.durationFrames,
    sourceStartSec: null,
    sourceEndSec: null,
  };
}

export function timelineSourceCandidateForPrimary(input: {
  item: StoryTimelineItem;
  durationFrames: number;
}): TimelineSourceCandidate | null {
  const edit = input.item.primaryVideoEdit;
  if (!edit) return null;
  return {
    sourceType: "primary-video",
    sourceId: `take-${edit.takeId}`,
    offsetFrame: 0,
    durationFrames: input.durationFrames,
    sourceStartSec: edit.sourceStartSec,
    sourceEndSec: edit.sourceEndSec,
    effects: edit.effects ?? null,
    transform: input.item.transform ?? null,
  };
}

export function timelineSourceCandidateForOverlay(
  overlay: StoryTimelineOverlay
): TimelineSourceCandidate {
  const durationFrames = Math.max(1, overlay.mediaEndFrame - overlay.startFrame);
  return {
    sourceType: "visual-clip",
    sourceId: `overlay-${overlay.id}`,
    offsetFrame: 0,
    durationFrames,
    sourceStartSec: 0,
    sourceEndSec: durationFrames / STORY_TIMELINE_FPS,
    effects: overlay.effects ?? null,
    transform: overlay.transform,
  };
}

/**
 * The single entry point every surface should use to ask "what does this shot
 * show at this local frame?". Callers supply `fallback` for shots backed by a
 * still image rather than a primary video edit.
 */
export function resolveTimelineItemSource(input: {
  item: StoryTimelineItem;
  localFrame: number;
  durationFrames: number;
  fallback?: TimelineSourceCandidate | null;
}): TimelineSourceResolution {
  const primary =
    timelineSourceCandidateForPrimary({
      item: input.item,
      durationFrames: input.durationFrames,
    }) ??
    input.fallback ??
    null;
  return resolveTimelineSource({
    item: input.item,
    localFrame: input.localFrame,
    primary,
    visualClips: (input.item.visualClips ?? []).map(
      timelineSourceCandidateForVisualClip
    ),
    visualClipsReplacePrimary: input.item.visualClipsReplacePrimary,
  });
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
    rate: timelineSourceRate(candidate),
    sourceWindow:
      candidate.sourceStartSec == null || candidate.sourceEndSec == null
        ? null
        : {
            startSec: candidate.sourceStartSec,
            endSec: candidate.sourceEndSec,
          },
    effects: candidate.effects ?? null,
    transform: candidate.transform ?? null,
  };
}
