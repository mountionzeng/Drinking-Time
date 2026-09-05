import { describe, expect, it } from "vitest";
import { projectLegacyTimelineMedia } from "./legacyTimelineMedia";

function legacyBody() {
  return {
    chatCutImport: {
      sourceFormat: "xmeml",
      fps: 25,
      playbackAudioTrackIndexes: [2],
      scriptCues: [{ code: "0101", text: "保留旧字幕" }],
      audioTracks: [
        {
          index: 1,
          clips: [
            {
              id: "ignored",
              name: "music.mp3",
              audioUrl: "https://s3.amazonaws.com/bucket/ignored.mp3",
              startFrame: 0,
              endFrame: 25,
              inFrame: 0,
              outFrame: 25,
            },
          ],
        },
        {
          index: 2,
          clips: [
            {
              id: "voice-0101",
              name: "VO-0101.wav",
              audioUrl: "https://s3.amazonaws.com/bucket/voice.wav",
              startFrame: 25,
              endFrame: 75,
              inFrame: 5,
              outFrame: 55,
            },
            {
              id: "bgm",
              name: "BGM.mp3",
              audioUrl: "https://s3.amazonaws.com/bucket/bgm.mp3",
              startFrame: 0,
              endFrame: 100,
              inFrame: 0,
              outFrame: 100,
            },
          ],
        },
      ],
    },
  };
}

describe("projectLegacyTimelineMedia", () => {
  it("projects only selected ChatCut playback tracks into canonical 30fps subtitles and audio", () => {
    const projected = projectLegacyTimelineMedia(legacyBody());

    expect(projected.subtitleState.tracks[0].cues).toMatchObject([
      {
        id: "legacy-chatcut-subtitle:voice-0101",
        startFrame: 30,
        durationFrames: 60,
        text: "保留旧字幕",
        provenance: { kind: "chatcut-cue", cueCode: "0101" },
      },
    ]);
    expect(
      projected.audioState.tracks
        .flatMap(track => track.clips.map(clip => [track.kind, clip] as const))
        .map(([kind, clip]) => ({
          kind,
          id: clip.id,
          startFrame: clip.timelineStartFrame,
          durationFrames: clip.durationFrames,
        }))
    ).toEqual([
      {
        kind: "narration",
        id: "legacy-chatcut-audio:voice-0101",
        startFrame: 30,
        durationFrames: 60,
      },
      {
        kind: "music",
        id: "legacy-chatcut-audio:bgm",
        startFrame: 0,
        durationFrames: 120,
      },
    ]);
    expect(projected.audioSources.map(source => source.clipId)).toEqual([
      "voice-0101",
      "bgm",
    ]);
  });

  it("returns empty canonical models for non-ChatCut stories", () => {
    const projected = projectLegacyTimelineMedia({});
    expect(projected.subtitleState.tracks[0].cues).toEqual([]);
    expect(
      projected.audioState.tracks.every(track => track.clips.length === 0)
    ).toBe(true);
    expect(projected.audioSources).toEqual([]);
  });
});
