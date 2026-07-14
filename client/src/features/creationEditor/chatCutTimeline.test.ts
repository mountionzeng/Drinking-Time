import { describe, expect, it } from "vitest";

import {
  chatCutBaseName,
  chatCutCueCode,
  chatCutSourceNameFromShot,
  normalizeChatCutTimeline,
} from "./chatCutTimeline";

describe("ChatCut timeline projection", () => {
  it("normalizes frame-based video, audio, and script tracks", () => {
    const timeline = normalizeChatCutTimeline({
      chatCutImport: {
        sourceFormat: "xmeml",
        projectName: "根基",
        sequenceName: "V1",
        fps: 30,
        width: 1080,
        height: 1080,
        durationFrames: 300,
        primaryVideoTrackIndex: 2,
        videoTracks: [
          {
            index: 2,
            clips: [
              {
                id: "v-1",
                name: "shot.mp4",
                mediaKind: "video",
                startFrame: 30,
                endFrame: 90,
                inFrame: 15,
                outFrame: 75,
              },
            ],
          },
        ],
        audioTracks: [
          {
            index: 1,
            clips: [
              {
                id: "a-1",
                name: "VO-0101.mp3",
                mediaKind: "audio",
                startFrame: 30,
                endFrame: 60,
                inFrame: 0,
                outFrame: 30,
              },
            ],
          },
        ],
        scriptCues: [
          { code: "0101", text: "我害怕所有的事情", startFrame: 30, endFrame: 60 },
        ],
      },
    });

    expect(timeline?.durationMs).toBe(10_000);
    expect(timeline?.videoTracks[0].clips[0]).toMatchObject({
      startMs: 1000,
      endMs: 3000,
      sourceInMs: 500,
      sourceOutMs: 2500,
    });
    expect(timeline?.audioTracks[0].clips[0].name).toBe("VO-0101.mp3");
    expect(timeline?.scriptCues[0].text).toBe("我害怕所有的事情");
  });

  it("derives source names and voice cue codes", () => {
    expect(chatCutCueCode("VO-0107-2.mp3")).toBe("0107-2");
    expect(chatCutSourceNameFromShot({ action: "使用素材 画.mp4" })).toBe(
      "画.mp4"
    );
    expect(chatCutBaseName("file://./%E7%94%BB.mp4")).toBe("画.mp4");
  });
});
