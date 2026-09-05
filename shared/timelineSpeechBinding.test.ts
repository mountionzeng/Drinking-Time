import { describe, expect, it } from "vitest";
import {
  bindSpeech,
  markBoundNarrationTextStale,
  moveBoundSpeech,
  speechBindingSummary,
  unbindSpeech,
} from "./timelineSpeechBinding";
import {
  emptyAudioState,
  insertAudioClip,
  type TimelineAudioState,
} from "./timelineAudioModel";
import {
  SUBTITLE_TRACK_ID,
  type SubtitleCue,
  type TimelineSubtitleState,
} from "./timelineSubtitleModel";

function subtitle(cues: Partial<SubtitleCue>[]): TimelineSubtitleState {
  return {
    tracks: [
      {
        id: SUBTITLE_TRACK_ID,
        cues: cues.map((c, i) => ({
          id: c.id ?? `cue-${i}`,
          startFrame: c.startFrame ?? 0,
          durationFrames: c.durationFrames ?? 45,
          text: c.text ?? "台词",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
          textEdited: false,
          timingEdited: false,
          textRevision: c.textRevision ?? 1,
          ...(c.speechBindingId ? { speechBindingId: c.speechBindingId } : {}),
        })),
      },
    ],
  };
}

function audioWithNarration(startFrame = 0): TimelineAudioState {
  const result = insertAudioClip(emptyAudioState(), {
    id: "narr-1",
    kind: "narration",
    assetId: 9,
    timelineStartFrame: startFrame,
    sourceOutFrame: 90,
  });
  if (result.status !== "ok") throw new Error(result.message);
  return result.state;
}

describe("timelineSpeechBinding", () => {
  it("binds a cue and a narration clip via a shared id, and refuses a double bind", () => {
    const result = bindSpeech(
      subtitle([{ id: "cue-a" }]),
      audioWithNarration(),
      { subtitleCueId: "cue-a", narrationClipId: "narr-1", bindingId: "b1" }
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.subtitleState.tracks[0].cues[0].speechBindingId).toBe("b1");
    expect(
      result.audioState.tracks.find(t => t.kind === "narration")!.clips[0]
        .speechBindingId
    ).toBe("b1");

    expect(
      bindSpeech(result.subtitleState, result.audioState, {
        subtitleCueId: "cue-a",
        narrationClipId: "narr-1",
        bindingId: "b2",
      }).status
    ).toBe("error");
  });

  it("moving a binding applies the same frame delta to both sides atomically", () => {
    const bound = bindSpeech(
      subtitle([{ id: "cue-a", startFrame: 60 }]),
      audioWithNarration(60),
      { subtitleCueId: "cue-a", narrationClipId: "narr-1", bindingId: "b1" }
    );
    if (bound.status !== "ok") throw new Error("setup");
    const moved = moveBoundSpeech(bound.subtitleState, bound.audioState, {
      bindingId: "b1",
      deltaFrames: 30,
    });
    expect(moved.status).toBe("ok");
    if (moved.status !== "ok") return;
    expect(moved.subtitleState.tracks[0].cues[0].startFrame).toBe(90);
    expect(
      moved.audioState.tracks.find(t => t.kind === "narration")!.clips[0]
        .timelineStartFrame
    ).toBe(90);
  });

  it("a move that would take either side below frame 0 fails atomically (no half-move)", () => {
    const bound = bindSpeech(
      subtitle([{ id: "cue-a", startFrame: 10 }]),
      audioWithNarration(10),
      { subtitleCueId: "cue-a", narrationClipId: "narr-1", bindingId: "b1" }
    );
    if (bound.status !== "ok") throw new Error("setup");
    const moved = moveBoundSpeech(bound.subtitleState, bound.audioState, {
      bindingId: "b1",
      deltaFrames: -50,
    });
    expect(moved.status).toBe("error");
  });

  it("a move whose partner is gone fails rather than moving one side", () => {
    const bound = bindSpeech(
      subtitle([{ id: "cue-a" }]),
      audioWithNarration(),
      { subtitleCueId: "cue-a", narrationClipId: "narr-1", bindingId: "b1" }
    );
    if (bound.status !== "ok") throw new Error("setup");
    const audioNoNarration = emptyAudioState();
    expect(
      moveBoundSpeech(bound.subtitleState, audioNoNarration, {
        bindingId: "b1",
        deltaFrames: 30,
      }).status
    ).toBe("error");
  });

  it("markBoundNarrationTextStale flags the narration; unbind clears both sides and the stale flag", () => {
    const bound = bindSpeech(
      subtitle([{ id: "cue-a" }]),
      audioWithNarration(),
      { subtitleCueId: "cue-a", narrationClipId: "narr-1", bindingId: "b1" }
    );
    if (bound.status !== "ok") throw new Error("setup");
    const stale = markBoundNarrationTextStale(bound.audioState, {
      bindingId: "b1",
    });
    expect(stale.changed).toBe(true);
    expect(
      stale.state.tracks.find(t => t.kind === "narration")!.clips[0].textStale
    ).toBe(true);
    // idempotent
    expect(
      markBoundNarrationTextStale(stale.state, { bindingId: "b1" }).changed
    ).toBe(false);

    const unbound = unbindSpeech(bound.subtitleState, stale.state, {
      bindingId: "b1",
    });
    if (unbound.status !== "ok") return;
    expect(unbound.subtitleState.tracks[0].cues[0].speechBindingId).toBeUndefined();
    const narr = unbound.audioState.tracks.find(t => t.kind === "narration")!
      .clips[0];
    expect(narr.speechBindingId).toBeUndefined();
    expect(narr.textStale).toBeUndefined();
  });

  it("speechBindingSummary reports the pair and stale state", () => {
    const bound = bindSpeech(
      subtitle([{ id: "cue-a" }]),
      audioWithNarration(),
      { subtitleCueId: "cue-a", narrationClipId: "narr-1", bindingId: "b1" }
    );
    if (bound.status !== "ok") throw new Error("setup");
    expect(
      speechBindingSummary(bound.subtitleState, bound.audioState, "b1")
    ).toEqual({
      cueId: "cue-a",
      narrationClipId: "narr-1",
      narrationEndFrame: 90,
      textStale: false,
    });
  });
});
