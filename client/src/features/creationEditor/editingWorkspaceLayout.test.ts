import { describe, expect, it } from "vitest";

import {
  fitProjectCanvas,
  timelineAudioTargetSeconds,
  timelineAudioVolume,
  timelineSubtitleText,
  timelineVoiceLaneLabel,
} from "./views/EditingNleWorkspace";
import type { ChatCutTimelineManifest } from "./chatCutTimeline";

describe("editing workspace project canvas", () => {
  it("fits a square project inside the preview stage without changing aspect", () => {
    expect(
      fitProjectCanvas({
        stageWidth: 282,
        stageHeight: 220,
        projectWidth: 1080,
        projectHeight: 1080,
        inset: 12,
      })
    ).toEqual({ width: 208, height: 208 });
  });

  it("fits landscape projects by width or height as space changes", () => {
    expect(
      fitProjectCanvas({
        stageWidth: 400,
        stageHeight: 240,
        projectWidth: 1920,
        projectHeight: 1080,
        inset: 12,
      })
    ).toEqual({ width: 388, height: 218 });

    expect(
      fitProjectCanvas({
        stageWidth: 240,
        stageHeight: 400,
        projectWidth: 1920,
        projectHeight: 1080,
        inset: 12,
      })
    ).toEqual({ width: 228, height: 128 });
  });

  it("falls back to a square and never returns negative dimensions", () => {
    expect(
      fitProjectCanvas({
        stageWidth: 8,
        stageHeight: 8,
        projectWidth: 0,
        projectHeight: Number.NaN,
        inset: 12,
      })
    ).toEqual({ width: 0, height: 0 });
  });

  it("maps the global playhead to imported audio source time", () => {
    const clip = {
      startMs: 1_000,
      endMs: 4_000,
      sourceInMs: 500,
      sourceOutMs: 3_500,
    };
    expect(timelineAudioTargetSeconds(clip, 999)).toBeNull();
    expect(timelineAudioTargetSeconds(clip, 2_250)).toBe(1.75);
    expect(timelineAudioTargetSeconds(clip, 4_000)).toBeNull();
    expect(timelineAudioVolume("BGM-黑暗现代古典.mp3")).toBe(0.18);
    expect(timelineAudioVolume("VO-0101.mp3")).toBe(1);
  });

  it("shows the script cue that is actually speaking at the playhead", () => {
    const manifest: ChatCutTimelineManifest = {
      projectName: "SheSelf",
      sequenceName: "main",
      fps: 30,
      width: 1080,
      height: 1080,
      durationMs: 5_000,
      primaryVideoTrackIndex: 1,
      playbackAudioTrackIndexes: [3],
      videoTracks: [],
      audioTracks: [
        {
          index: 1,
          clips: [
            {
              id: "voice-0101",
              name: "VO-0101.mp3",
              mediaKind: "audio",
              audioUrl: "https://media.example/VO-0101.mp3",
              startMs: 1_000,
              endMs: 3_000,
              sourceInMs: 0,
              sourceOutMs: 2_000,
            },
          ],
        },
        {
          index: 3,
          clips: [
            {
              id: "voice-fr-0104",
              name: "FR 0104 - Arabella.mp3",
              mediaKind: "audio",
              audioUrl: "https://media.example/FR-0104.mp3",
              startMs: 1_000,
              endMs: 3_000,
              sourceInMs: 0,
              sourceOutMs: 2_000,
            },
          ],
        },
      ],
      scriptCues: [
        {
          code: "0101",
          text: "我害怕所有的事情。",
          startMs: 1_000,
          endMs: 3_000,
        },
        {
          code: "0104",
          text: "我的一切都需要改造。",
          startMs: 1_000,
          endMs: 3_000,
        },
      ],
    };

    expect(timelineSubtitleText(manifest, 999, "错误的镜头台词")).toBeNull();
    expect(timelineSubtitleText(manifest, 1_500, "错误的镜头台词")).toBe(
      "我的一切都需要改造。"
    );
    expect(timelineVoiceLaneLabel(manifest)).toBe("A3 法语旁白");
    expect(timelineSubtitleText(null, 1_500, "临时镜头台词")).toBe(
      "临时镜头台词"
    );
  });
});
