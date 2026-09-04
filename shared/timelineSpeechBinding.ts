/**
 * The subtitle-cue ↔ narration-clip binding (U9).
 *
 * A binding is a *relation*, not object nesting: a shared `speechBindingId`
 * lives on one subtitle cue and one narration audio clip. Moving either side
 * applies the same frame delta to both, atomically — a partner that is missing
 * or would go out of bounds fails the whole command, never a half-move.
 * Unbinding drops the id from both sides and they become independent again.
 *
 * Editing a bound cue's text marks the narration `textStale` here; it never
 * deletes audio and never calls TTS.
 *
 * Pure: takes the subtitle state and audio state, returns the next pair.
 */
import {
  audioClipEndFrame,
  type TimelineAudioState,
} from "./timelineAudioModel";
import { type TimelineSubtitleState } from "./timelineSubtitleModel";

export type SpeechBindingOk = {
  status: "ok";
  subtitleState: TimelineSubtitleState;
  audioState: TimelineAudioState;
  changed: boolean;
};
export type SpeechBindingError = { status: "error"; message: string };
export type SpeechBindingResult = SpeechBindingOk | SpeechBindingError;

const ok = (
  subtitleState: TimelineSubtitleState,
  audioState: TimelineAudioState,
  changed: boolean
): SpeechBindingOk => ({ status: "ok", subtitleState, audioState, changed });
const err = (message: string): SpeechBindingError => ({
  status: "error",
  message,
});

function subtitleCues(state: TimelineSubtitleState) {
  return state.tracks[0]?.cues ?? [];
}

function findNarrationClip(state: TimelineAudioState, bindingId: string) {
  const narration = state.tracks.find(t => t.kind === "narration");
  return narration?.clips.find(c => c.speechBindingId === bindingId) ?? null;
}

function findCueByBinding(state: TimelineSubtitleState, bindingId: string) {
  return subtitleCues(state).find(c => c.speechBindingId === bindingId) ?? null;
}

export function bindSpeech(
  subtitleState: TimelineSubtitleState,
  audioState: TimelineAudioState,
  input: { subtitleCueId: string; narrationClipId: string; bindingId: string }
): SpeechBindingResult {
  const cue = subtitleCues(subtitleState).find(
    c => c.id === input.subtitleCueId
  );
  if (!cue) return err("字幕块不存在");
  const narration = audioState.tracks.find(t => t.kind === "narration");
  const clip = narration?.clips.find(c => c.id === input.narrationClipId);
  if (!clip) return err("旁白片段不存在");
  if (cue.speechBindingId || clip.speechBindingId) {
    return err("字幕或旁白已经绑定，请先解除");
  }
  return ok(
    {
      tracks: [
        {
          ...subtitleState.tracks[0],
          cues: subtitleCues(subtitleState).map(c =>
            c.id === cue.id ? { ...c, speechBindingId: input.bindingId } : c
          ),
        },
      ],
    },
    {
      tracks: audioState.tracks.map(t =>
        t.kind === "narration"
          ? {
              ...t,
              clips: t.clips.map(c =>
                c.id === clip.id
                  ? { ...c, speechBindingId: input.bindingId }
                  : c
              ),
            }
          : t
      ),
    },
    true
  );
}

export function unbindSpeech(
  subtitleState: TimelineSubtitleState,
  audioState: TimelineAudioState,
  input: { bindingId: string }
): SpeechBindingResult {
  const cue = findCueByBinding(subtitleState, input.bindingId);
  const clip = findNarrationClip(audioState, input.bindingId);
  if (!cue && !clip) return ok(subtitleState, audioState, false);
  return ok(
    {
      tracks: [
        {
          ...subtitleState.tracks[0],
          cues: subtitleCues(subtitleState).map(c =>
            c.speechBindingId === input.bindingId
              ? { ...c, speechBindingId: undefined }
              : c
          ),
        },
      ],
    },
    {
      tracks: audioState.tracks.map(t => ({
        ...t,
        clips: t.clips.map(c =>
          c.speechBindingId === input.bindingId
            ? { ...c, speechBindingId: undefined, textStale: undefined }
            : c
        ),
      })),
    },
    true
  );
}

/**
 * Move both sides of a binding by the same frame delta. `movedSide` says which
 * side the user dragged; the other follows. Fails atomically if the partner is
 * missing or the move would take either side below frame 0.
 */
export function moveBoundSpeech(
  subtitleState: TimelineSubtitleState,
  audioState: TimelineAudioState,
  input: {
    bindingId: string;
    deltaFrames: number;
  }
): SpeechBindingResult {
  const cue = findCueByBinding(subtitleState, input.bindingId);
  const clip = findNarrationClip(audioState, input.bindingId);
  if (!cue || !clip) {
    return err("绑定的一端已不存在，无法成对移动");
  }
  if (input.deltaFrames === 0) return ok(subtitleState, audioState, false);
  const nextCueStart = cue.startFrame + input.deltaFrames;
  const nextClipStart = clip.timelineStartFrame + input.deltaFrames;
  if (nextCueStart < 0 || nextClipStart < 0) {
    return err("成对移动会越过时间线开头");
  }
  return ok(
    {
      tracks: [
        {
          ...subtitleState.tracks[0],
          cues: subtitleCues(subtitleState).map(c =>
            c.id === cue.id
              ? { ...c, startFrame: nextCueStart, timingEdited: true }
              : c
          ),
        },
      ],
    },
    {
      tracks: audioState.tracks.map(t =>
        t.kind === "narration"
          ? {
              ...t,
              clips: t.clips
                .map(c =>
                  c.id === clip.id
                    ? { ...c, timelineStartFrame: nextClipStart }
                    : c
                )
                .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame),
            }
          : t
      ),
    },
    true
  );
}

/** Mark the narration bound to `bindingId` as out of date with its subtitle text. */
export function markBoundNarrationTextStale(
  audioState: TimelineAudioState,
  input: { bindingId: string }
): { state: TimelineAudioState; changed: boolean } {
  const clip = findNarrationClip(audioState, input.bindingId);
  if (!clip || clip.textStale) return { state: audioState, changed: false };
  return {
    state: {
      tracks: audioState.tracks.map(t =>
        t.kind === "narration"
          ? {
              ...t,
              clips: t.clips.map(c =>
                c.speechBindingId === input.bindingId
                  ? { ...c, textStale: true }
                  : c
              ),
            }
          : t
      ),
    },
    changed: true,
  };
}

export function speechBindingSummary(
  subtitleState: TimelineSubtitleState,
  audioState: TimelineAudioState,
  bindingId: string
): {
  cueId: string | null;
  narrationClipId: string | null;
  narrationEndFrame: number | null;
  textStale: boolean;
} {
  const cue = findCueByBinding(subtitleState, bindingId);
  const clip = findNarrationClip(audioState, bindingId);
  return {
    cueId: cue?.id ?? null,
    narrationClipId: clip?.id ?? null,
    narrationEndFrame: clip ? audioClipEndFrame(clip) : null,
    textStale: clip?.textStale === true,
  };
}
