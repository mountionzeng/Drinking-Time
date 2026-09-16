import { describe, expect, it } from "vitest";
import type { Story } from "../../drizzle/schema";
import { compileStorySoundContextFromSources } from "./storySoundContext";

const story = (body: Story["body"]): Story => ({
  id: 101,
  userId: 7,
  projectId: null,
  title: "雨夜回家",
  logline: "女儿在雨夜回家。",
  theme: "和解",
  arc: null,
  summary: null,
  body,
  createdAt: new Date("2026-09-16T00:00:00.000Z"),
  updatedAt: new Date("2026-09-16T00:00:00.000Z"),
});

describe("storySoundContext", () => {
  it("extracts only explicit dialogue, rain, subtitles and existing audio", () => {
    const packet = compileStorySoundContextFromSources({
      story: story({
        cards: [],
        characters: [{ name: "女儿", role: "主角", oneLiner: "回家道歉" }],
        shots: [
          {
            stableShotId: "shot-rain",
            shotNo: 1,
            sceneNo: "scene-1",
            subject: "女儿",
            action: "她走进屋里",
            dialogue: "妈，我回来了。",
            shotType: "中景",
            beat: "开场",
            cameraAngle: "平视",
            cameraMove: "固定",
            location: "室内",
            timeLight: "雨夜",
            mood: "克制",
            sound: "窗外持续的雨声",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
        ],
      }),
      timeline: {
        version: 3,
        extensions: {
          subtitleTracks: {
            tracks: [
              {
                id: "subtitle-main",
                cues: [
                  {
                    id: "cue-1",
                    startFrame: 30,
                    durationFrames: 60,
                    text: "妈，我回来了。",
                    provenance: {
                      kind: "shot-dialogue",
                      stableShotId: "shot-rain",
                    },
                    sourceTextRevision: 1,
                    textRevision: 0,
                  },
                ],
              },
            ],
          },
          audioTracks: {
            tracks: [
              {
                kind: "ambience",
                muted: false,
                defaultGain: 1,
                clips: [
                  {
                    id: "rain-existing",
                    assetId: 10,
                    timelineStartFrame: 0,
                    sourceInFrame: 0,
                    sourceOutFrame: 90,
                    gain: 1,
                    muted: false,
                    fadeInFrames: 0,
                    fadeOutFrames: 0,
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(
      packet.evidence.some(
        item => item.text === "妈，我回来了。" && item.soundKind === "dialogue"
      )
    ).toBe(true);
    expect(
      packet.evidence.some(
        item => item.text.includes("雨声") && item.soundKind === "ambience"
      )
    ).toBe(true);
    expect(
      packet.evidence.some(
        item => item.existingTimelineClipId === "rain-existing"
      )
    ).toBe(true);
    expect(packet.evidence.some(item => /枪|车/.test(item.text))).toBe(false);
    expect(packet.evidenceSnapshotDigest).toHaveLength(64);
  });

  it("keeps paraphrased speech as intent instead of inventing quoted words", () => {
    const packet = compileStorySoundContextFromSources({
      story: story({
        cards: [],
        characters: [{ name: "她", role: "女儿", oneLiner: "" }],
        shots: [
          {
            stableShotId: "shot-apology",
            shotNo: 1,
            subject: "她",
            action: "她向母亲道歉",
            dialogue: "",
            shotType: "近景",
            beat: "转折",
            cameraAngle: "平视",
            cameraMove: "固定",
            location: "家中",
            timeLight: "夜",
            mood: "歉疚",
            sound: "",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
        ],
      }),
    });
    const intent = packet.evidence.find(item =>
      item.sourceId.endsWith(":speech-intent")
    );
    expect(intent).toMatchObject({
      text: "她向母亲道歉",
      soundKind: "dialogue",
      certainty: "explicit",
    });
    expect(packet.evidence.some(item => /对不起/.test(item.text))).toBe(false);
  });
});
