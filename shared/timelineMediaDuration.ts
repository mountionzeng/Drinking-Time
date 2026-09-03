/**
 * The one place total Timeline length is computed across media kinds.
 *
 * U3 covers visual + subtitle. U9 extends `timelineMediaTotalFrames` with the
 * audio end frame. Preview and export both consume this so a subtitle or sound
 * that runs past the last picture still extends the finished piece instead of
 * being clipped.
 */
import {
  subtitleStateEndFrame,
  type TimelineSubtitleState,
} from "./timelineSubtitleModel";

export type TimelineMediaDurationInput = {
  /** Highest end frame of the resolved visual layout (0 when there is none). */
  visualEndFrame: number;
  /** Subtitle slice, if the document has one. */
  subtitleState?: TimelineSubtitleState | null;
};

/** Highest end frame across every media kind, as a non-negative integer. */
export function timelineMediaTotalFrames(
  input: TimelineMediaDurationInput
): number {
  const visual = Number.isFinite(input.visualEndFrame)
    ? Math.max(0, Math.round(input.visualEndFrame))
    : 0;
  const subtitle = input.subtitleState
    ? subtitleStateEndFrame(input.subtitleState)
    : 0;
  return Math.max(visual, subtitle);
}
