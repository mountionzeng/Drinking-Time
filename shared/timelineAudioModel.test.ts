import { describe, expect, it } from "vitest";
import {
  AUDIO_TRACK_KINDS,
  audioStateEndFrame,
  audioStateSpeedInvariantHolds,
  deleteAudioClip,
  emptyAudioState,
  insertAudioClip,
  moveAudioClip,
  normalizeAudioState,
  reclassifyAudioClip,
  resolveAudioClipsAtFrame,
  setAudioClipFade,
  setAudioClipGain,
  setAudioClipMuted,
  setAudioTrackGain,
  setAudioTrackMuted,
  trimAudioClipEnd,
  trimAudioClipStart,
  type TimelineAudioState,
} from "./timelineAudioModel";

function withMusicClip(): TimelineAudioState {
  const result = insertAudioClip(emptyAudioState(), {
    id: "clip-1",
    kind: "music",
    assetId: 42,
    timelineStartFrame: 30,
    sourceInFrame: 0,
    sourceOutFrame: 300,
  });
  if (result.status !== "ok") throw new Error(result.message);
  return result.state;
}

const musicClip = (state: TimelineAudioState) =>
  state.tracks.find(t => t.kind === "music")!.clips[0];

describe("timelineAudioModel", () => {
  it("empty state has exactly the five fixed tracks in order", () => {
    expect(emptyAudioState().tracks.map(t => t.kind)).toEqual([
      ...AUDIO_TRACK_KINDS,
    ]);
  });

  it("insert rejects an illegal kind, a duplicate id, and a sub-frame source range", () => {
    const base = withMusicClip();
    expect(
      insertAudioClip(base, {
        id: "clip-2",
        kind: "nope" as never,
        assetId: 1,
        timelineStartFrame: 0,
        sourceOutFrame: 10,
      }).status
    ).toBe("error");
    expect(
      insertAudioClip(base, {
        id: "clip-1",
        kind: "music",
        assetId: 1,
        timelineStartFrame: 0,
        sourceOutFrame: 10,
      }).status
    ).toBe("error");
    expect(
      insertAudioClip(base, {
        id: "clip-3",
        kind: "sfx",
        assetId: 1,
        timelineStartFrame: 0,
        sourceInFrame: 5,
        sourceOutFrame: 5,
      }).status
    ).toBe("error");
  });

  it("move only changes timelineStartFrame, never the source range", () => {
    const state = withMusicClip();
    const moved = moveAudioClip(state, { clipId: "clip-1", toStartFrame: 90 });
    expect(moved.status).toBe("ok");
    if (moved.status !== "ok") return;
    expect(musicClip(moved.state)).toMatchObject({
      timelineStartFrame: 90,
      sourceInFrame: 0,
      sourceOutFrame: 300,
      durationFrames: 300,
    });
    expect(audioStateSpeedInvariantHolds(moved.state)).toBe(true);
    expect(
      moveAudioClip(state, { clipId: "clip-1", toStartFrame: 30 })
    ).toMatchObject({ status: "ok", changed: false });
  });

  it("left trim raises sourceIn + shifts start; right trim lowers sourceOut; both shorten duration by the same amount and keep the no-speed invariant", () => {
    const state = withMusicClip();
    const left = trimAudioClipStart(state, {
      clipId: "clip-1",
      deltaFrames: 20,
    });
    expect(left.status).toBe("ok");
    if (left.status === "ok") {
      expect(musicClip(left.state)).toMatchObject({
        sourceInFrame: 20,
        sourceOutFrame: 300,
        durationFrames: 280,
        timelineStartFrame: 50,
      });
      expect(audioStateSpeedInvariantHolds(left.state)).toBe(true);
    }
    const right = trimAudioClipEnd(state, {
      clipId: "clip-1",
      deltaFrames: -50,
    });
    if (right.status === "ok") {
      expect(musicClip(right.state)).toMatchObject({
        sourceInFrame: 0,
        sourceOutFrame: 250,
        durationFrames: 250,
        timelineStartFrame: 30,
      });
    }
    expect(
      trimAudioClipStart(state, { clipId: "clip-1", deltaFrames: -1 }).status
    ).toBe("error"); // past media head
    expect(
      trimAudioClipEnd(state, { clipId: "clip-1", deltaFrames: -400 }).status
    ).toBe("error"); // below one frame
  });

  it("reclassify moves the same clip to another track and blocks a bound narration", () => {
    const state = withMusicClip();
    const moved = reclassifyAudioClip(state, {
      clipId: "clip-1",
      toKind: "ambience",
    });
    expect(moved.status).toBe("ok");
    if (moved.status === "ok") {
      expect(moved.state.tracks.find(t => t.kind === "music")!.clips).toHaveLength(0);
      expect(moved.state.tracks.find(t => t.kind === "ambience")!.clips[0].id).toBe(
        "clip-1"
      );
    }
    const bound: TimelineAudioState = {
      tracks: state.tracks.map(t =>
        t.kind === "music"
          ? {
              ...t,
              clips: t.clips.map(c => ({ ...c, speechBindingId: "b1" })),
            }
          : t
      ),
    };
    expect(
      reclassifyAudioClip(bound, { clipId: "clip-1", toKind: "sfx" }).status
    ).toBe("error");
  });

  it("gain / mute / fade / track-level changes each report changed and no-op correctly", () => {
    const state = withMusicClip();
    expect(setAudioClipGain(state, { clipId: "clip-1", gain: 0.5 })).toMatchObject({
      status: "ok",
      changed: true,
    });
    expect(setAudioClipGain(state, { clipId: "clip-1", gain: 1 })).toMatchObject({
      status: "ok",
      changed: false,
    });
    expect(setAudioClipGain(state, { clipId: "clip-1", gain: 99 })).toMatchObject({
      status: "ok",
      changed: true,
    });
    expect(
      setAudioClipMuted(state, { clipId: "clip-1", muted: true })
    ).toMatchObject({ status: "ok", changed: true });
    const faded = setAudioClipFade(state, {
      clipId: "clip-1",
      fadeInFrames: 15,
    });
    if (faded.status === "ok") {
      expect(musicClip(faded.state).fadeInFrames).toBe(15);
      expect(musicClip(faded.state).fadeOutFrames).toBe(0);
    }
    expect(
      setAudioTrackMuted(state, { kind: "music", muted: true })
    ).toMatchObject({ status: "ok", changed: true });
    expect(
      setAudioTrackGain(state, { kind: "music", gain: 0.18 })
    ).toMatchObject({ status: "ok", changed: true });
  });

  it("delete is a no-op for an unknown id; resolve returns every overlapping clip in fixed track order regardless of mute", () => {
    let state = withMusicClip();
    const withAmbience = insertAudioClip(state, {
      id: "amb-1",
      kind: "ambience",
      assetId: 7,
      timelineStartFrame: 0,
      sourceOutFrame: 600,
    });
    if (withAmbience.status === "ok") state = withAmbience.state;
    const muted = setAudioClipMuted(state, { clipId: "amb-1", muted: true });
    if (muted.status === "ok") state = muted.state;

    const active = resolveAudioClipsAtFrame(state, 60);
    expect(active.map(a => a.kind)).toEqual(["music", "ambience"]);
    expect(active[1].clip.muted).toBe(true);

    expect(deleteAudioClip(state, { clipId: "ghost" })).toMatchObject({
      status: "ok",
      changed: false,
    });
  });

  it("audioStateEndFrame is the max clip end; normalizeAudioState rebuilds the 5 tracks and drops junk clips", () => {
    const state = withMusicClip();
    expect(audioStateEndFrame(state)).toBe(330);

    const normalized = normalizeAudioState({
      tracks: [
        {
          kind: "music",
          muted: true,
          defaultGain: 0.5,
          clips: [
            { id: "ok", assetId: 1, timelineStartFrame: 0, sourceInFrame: 0, sourceOutFrame: 90 },
            { id: "bad-no-asset", timelineStartFrame: 0 },
          ],
        },
        { kind: "not-a-track", clips: [] },
      ],
    });
    expect(normalized.tracks.map(t => t.kind)).toEqual([...AUDIO_TRACK_KINDS]);
    const music = normalized.tracks.find(t => t.kind === "music")!;
    expect(music.muted).toBe(true);
    expect(music.clips.map(c => c.id)).toEqual(["ok"]);
    expect(music.clips[0].durationFrames).toBe(90);
  });
});
