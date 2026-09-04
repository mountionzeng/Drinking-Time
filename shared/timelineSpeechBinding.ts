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
  type AudioClip,
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

/**
 * Adopt one immutable TTS candidate as the narration for a subtitle cue.
 *
 * The candidate asset itself remains outside the Timeline. Replacing a clip
 * only swaps its non-owning asset reference and source range; existing gain,
 * mute, fades, and the user's chosen Timeline start are preserved. A first
 * adoption starts with the cue. Subtitles that have never been timing-edited
 * follow the real media duration, while hand-timed subtitles stay untouched.
 */
export function adoptNarrationCandidate(
  subtitleState: TimelineSubtitleState,
  audioState: TimelineAudioState,
  input: {
    subtitleCueId: string;
    expectedTextRevision: number;
    bindingId: string;
    narrationClipId: string;
    assetId: number;
    assetDurationFrames: number;
  }
): SpeechBindingResult {
  const cue = subtitleCues(subtitleState).find(
    candidate => candidate.id === input.subtitleCueId
  );
  if (!cue) return err("字幕块不存在或已被删除");
  if (cue.textRevision !== input.expectedTextRevision) {
    return err("字幕文字已经更新，请重新生成旁白");
  }
  if (!Number.isInteger(input.assetDurationFrames) || input.assetDurationFrames < 1) {
    return err("旁白音频时长不可用");
  }
  if (cue.speechBindingId && cue.speechBindingId !== input.bindingId) {
    return err("字幕绑定已经更新，请重新生成旁白");
  }

  const narration = audioState.tracks.find(track => track.kind === "narration");
  if (!narration) return err("旁白轨不存在");
  const existing = cue.speechBindingId
    ? narration.clips.find(clip => clip.speechBindingId === cue.speechBindingId)
    : undefined;
  if (cue.speechBindingId && !existing) {
    return err("字幕绑定的旁白已经不存在，请先解除绑定");
  }
  if (
    !cue.speechBindingId &&
    narration.clips.some(clip => clip.speechBindingId === input.bindingId)
  ) {
    return err("这条旁白绑定已经被其它字幕使用");
  }

  const nextClip: AudioClip = existing
    ? {
        ...existing,
        assetId: input.assetId,
        sourceInFrame: 0,
        sourceOutFrame: input.assetDurationFrames,
        durationFrames: input.assetDurationFrames,
        speechBindingId: input.bindingId,
        textStale: false,
      }
    : {
        id: input.narrationClipId,
        assetId: input.assetId,
        timelineStartFrame: cue.startFrame,
        sourceInFrame: 0,
        sourceOutFrame: input.assetDurationFrames,
        durationFrames: input.assetDurationFrames,
        gain: 1,
        muted: false,
        fadeInFrames: 0,
        fadeOutFrames: 0,
        speechBindingId: input.bindingId,
        textStale: false,
      };
  const unchanged =
    existing?.assetId === input.assetId &&
    existing.sourceInFrame === 0 &&
    existing.sourceOutFrame === input.assetDurationFrames &&
    existing.durationFrames === input.assetDurationFrames &&
    existing.textStale !== true &&
    cue.speechBindingId === input.bindingId &&
    (cue.timingEdited || cue.durationFrames === input.assetDurationFrames);
  if (unchanged) return ok(subtitleState, audioState, false);

  return ok(
    {
      tracks: [
        {
          ...subtitleState.tracks[0],
          cues: subtitleCues(subtitleState).map(candidate =>
            candidate.id === cue.id
              ? {
                  ...candidate,
                  speechBindingId: input.bindingId,
                  ...(candidate.timingEdited
                    ? {}
                    : { durationFrames: input.assetDurationFrames }),
                }
              : candidate
          ),
        },
      ],
    },
    {
      tracks: audioState.tracks.map(track =>
        track.kind === "narration"
          ? {
              ...track,
              clips: existing
                ? track.clips.map(clip =>
                    clip.id === existing.id ? nextClip : clip
                  )
                : [...track.clips, nextClip].sort(
                    (left, right) =>
                      left.timelineStartFrame - right.timelineStartFrame
                  ),
            }
          : track
      ),
    },
    true
  );
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
