import type { StoryboardTimingRow } from "@/features/storyAgent/storyboardTiming";
import type { StoryTimelineOverlay } from "@shared/storyMaterial";
import {
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  STORY_TIMELINE_FPS,
  timelineOffsetMsToFrames,
} from "@shared/storyMaterial";
import type { TimelineVisualAudioSource } from "@shared/timelineAudioModel";
import type { CreationEditorShot } from "../types";
import {
  videoClipEditorTargetForTake,
  videoClipEditorTargetForVisualClip,
} from "../videoClipEditorModel";
import { adoptedVideoTake, shotLabel } from "../previewPlaybackModel";

export type BrowserVisualAudioSource = TimelineVisualAudioSource & {
  sourceUrl: string;
};

function secondsToFrame(seconds: number): number {
  return Math.max(0, Math.round(seconds * STORY_TIMELINE_FPS));
}

function audibleTimelineFrames(input: {
  sourceInFrame: number;
  sourceOutFrame: number;
  timelineFrames: number;
  playbackRate: number;
}): number {
  const sourceFrames = Math.max(1, input.sourceOutFrame - input.sourceInFrame);
  const rate = Math.min(
    4,
    Math.max(0.25, Number.isFinite(input.playbackRate) ? input.playbackRate : 1)
  );
  return Math.max(
    1,
    Math.min(input.timelineFrames, Math.ceil(sourceFrames / rate))
  );
}

/**
 * Project every persisted video segment into an embedded-audio source. This is
 * intentionally a flat collection: visual winner order is irrelevant to the
 * audio mixer, and explicit source-track linkage is the only de-duplication.
 */
export function buildBrowserVisualAudioSources(input: {
  shots: readonly CreationEditorShot[];
  timings: readonly StoryboardTimingRow[];
  overlays: readonly StoryTimelineOverlay[];
}): BrowserVisualAudioSource[] {
  const shotsById = new Map(
    input.shots.flatMap(shot => {
      const ids = [shot.stableShotId, shot.shotIdentity, shot.shotKey].filter(
        (id): id is string => typeof id === "string" && id.length > 0
      );
      return ids.map(id => [id, shot] as const);
    })
  );
  const sources: BrowserVisualAudioSource[] = [];

  for (const timing of input.timings) {
    const shot = shotsById.get(timing.stableShotId);
    if (!shot) continue;
    const item = shot.timelineItem;
    if (!item?.visualClipsReplacePrimary) {
      const take = adoptedVideoTake(shot);
      const target = take
        ? videoClipEditorTargetForTake({
            stableShotId: timing.stableShotId,
            shotNo: shot.shotNo,
            cueCode: shot.cueCode,
            label: shotLabel(shot),
            take,
            timelineItem: item,
          })
        : null;
      if (target?.videoUrl) {
        const sourceInFrame = secondsToFrame(target.sourceStartSec);
        const sourceOutFrame = secondsToFrame(target.sourceEndSec);
        sources.push({
          id: `primary:${timing.stableShotId}:take-${target.takeId}`,
          timelineStartFrame: timing.startFrame,
          sourceInFrame,
          sourceOutFrame,
          durationFrames: audibleTimelineFrames({
            sourceInFrame,
            sourceOutFrame,
            timelineFrames: timing.durationFrames,
            playbackRate: target.effects.playbackRate,
          }),
          gain: target.effects.volume,
          muted: target.effects.muted,
          playbackRate: target.effects.playbackRate,
          reverse: target.effects.reverse,
          sourceUrl: target.videoUrl,
        });
      }
    }

    for (const clip of item?.visualClips ?? []) {
      const target = videoClipEditorTargetForVisualClip({
        stableShotId: timing.stableShotId,
        shotNo: shot.shotNo,
        cueCode: shot.cueCode,
        label: clip.label,
        clip,
        timelineItem: item,
        mediaDurationSec: shot.videoTakes?.find(take => take.id === clip.takeId)
          ?.durationSec,
      });
      const sourceInFrame = secondsToFrame(target.sourceStartSec);
      const sourceOutFrame = secondsToFrame(target.sourceEndSec);
      const timelineFrames = timelineOffsetMsToFrames(clip.durationMs);
      sources.push({
        id: `clip:${clip.id}`,
        timelineStartFrame:
          timing.startFrame + timelineOffsetMsToFrames(clip.offsetMs),
        sourceInFrame,
        sourceOutFrame,
        durationFrames: audibleTimelineFrames({
          sourceInFrame,
          sourceOutFrame,
          timelineFrames,
          playbackRate: target.effects.playbackRate,
        }),
        gain: target.effects.volume,
        muted: target.effects.muted,
        playbackRate: target.effects.playbackRate,
        reverse: target.effects.reverse,
        sourceUrl: target.videoUrl,
      });
    }
  }

  for (const overlay of input.overlays) {
    const effects = overlay.effects ?? DEFAULT_TIMELINE_VIDEO_EFFECTS;
    const sourceInFrame = 0;
    const sourceOutFrame = Math.max(
      1,
      overlay.mediaEndFrame - overlay.startFrame
    );
    const timelineFrames = sourceOutFrame;
    sources.push({
      id: `overlay:${overlay.id}`,
      timelineStartFrame: overlay.startFrame,
      sourceInFrame,
      sourceOutFrame,
      durationFrames: audibleTimelineFrames({
        sourceInFrame,
        sourceOutFrame,
        timelineFrames,
        playbackRate: effects.playbackRate,
      }),
      gain: effects.volume,
      muted: effects.muted,
      playbackRate: effects.playbackRate,
      reverse: effects.reverse,
      sourceUrl: overlay.videoUrl,
    });
  }

  return sources.sort(
    (left, right) =>
      left.timelineStartFrame - right.timelineStartFrame ||
      left.id.localeCompare(right.id)
  );
}
