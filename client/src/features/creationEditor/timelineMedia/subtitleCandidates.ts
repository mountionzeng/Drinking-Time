/**
 * Builds the *initial* subtitle candidates offered by "从当前文字生成字幕".
 *
 * Candidates are only ever an offer: nothing here is persisted until the user
 * clicks the CTA, and once a cue exists the subtitle track owns its text and
 * timing (see shared/timelineSubtitleModel). Re-running this after an edit
 * produces a "source updated" hint, never an overwrite.
 *
 * Source preference matches the plan: an attached ChatCut manifest with real
 * cue times wins; otherwise each shot's dialogue over that shot's authoritative
 * absolute span. Empty text never becomes a cue.
 */
import {
  timelineMsToFrames,
  timelineOffsetMsToFrames,
} from "@shared/storyMaterial";
import type { SubtitleCandidate } from "@shared/timelineSubtitleModel";

export type SubtitleChatCutCue = {
  code: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type SubtitleShotDialogue = {
  stableShotId: string;
  dialogue: string;
  startMs: number;
  endMs: number;
};

export type SubtitleCandidateSource = {
  /** Cues from an attached ChatCut manifest, if any carry usable times. */
  chatCutCues?: readonly SubtitleChatCutCue[];
  /** Fallback: shot dialogue over the shot's absolute timeline span. */
  shotDialogues: readonly SubtitleShotDialogue[];
  /** Revision stamp of the upstream text these candidates were read from. */
  sourceTextRevision: number;
};

function spanFrames(startMs: number, endMs: number) {
  const startFrame = timelineOffsetMsToFrames(startMs);
  const durationFrames = timelineMsToFrames(Math.max(0, endMs - startMs));
  return { startFrame, durationFrames };
}

export function buildSubtitleCandidates(
  source: SubtitleCandidateSource
): SubtitleCandidate[] {
  const timedCues = (source.chatCutCues ?? []).filter(
    cue => cue.text.trim().length > 0 && cue.endMs > cue.startMs
  );
  if (timedCues.length > 0) {
    return timedCues
      .map(cue => ({
        ...spanFrames(cue.startMs, cue.endMs),
        text: cue.text.trim(),
        provenance: { kind: "chatcut-cue" as const, cueCode: cue.code },
        sourceTextRevision: source.sourceTextRevision,
      }))
      .sort((left, right) => left.startFrame - right.startFrame);
  }
  return source.shotDialogues
    .filter(shot => shot.dialogue.trim().length > 0 && shot.endMs > shot.startMs)
    .map(shot => ({
      ...spanFrames(shot.startMs, shot.endMs),
      text: shot.dialogue.trim(),
      provenance: {
        kind: "shot-dialogue" as const,
        stableShotId: shot.stableShotId,
      },
      sourceTextRevision: source.sourceTextRevision,
    }))
    .sort((left, right) => left.startFrame - right.startFrame);
}
