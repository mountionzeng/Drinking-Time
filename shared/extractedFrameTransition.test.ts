import { describe, expect, it } from "vitest";
import {
  extractedFrameTimeMs,
  requestedExtractedFrameVideoDurationSec,
  selectExtractedFramePair,
} from "./extractedFrameTransition";

describe("extractedFrameTimeMs", () => {
  it("reads durable and legacy extraction prompts without accepting arbitrary numbers", () => {
    expect(extractedFrameTimeMs("时间线抽帧 · 3400ms · 0101")).toBe(3400);
    expect(extractedFrameTimeMs("从时间线 1:02.003 提取帧")).toBe(62_003);
    expect(extractedFrameTimeMs("普通图片 3400ms")).toBeNull();
  });
});

describe("selectExtractedFramePair", () => {
  const frames = [
    { id: "a", imageId: 1, atMs: 1_000 },
    { id: "b", imageId: 2, atMs: 4_000 },
    { id: "c", imageId: 3, atMs: 9_000 },
  ];

  it("selects the nearest strict neighbors around the click", () => {
    expect(selectExtractedFramePair({ frames, atMs: 6_000 })).toEqual({
      kind: "ok",
      pair: {
        left: frames[1],
        right: frames[2],
        startFrame: 120,
        endFrame: 270,
        intervalMs: 5_000,
        requestedDurationSec: 5,
      },
    });
  });

  it("does not use a frame exactly under the click as either endpoint", () => {
    const result = selectExtractedFramePair({ frames, atMs: 4_000 });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pair.left.imageId).toBe(1);
      expect(result.pair.right.imageId).toBe(3);
    }
  });

  it("blocks missing sides and sub-second pairs", () => {
    expect(selectExtractedFramePair({ frames, atMs: 500 }).kind).toBe("blocked");
    expect(
      selectExtractedFramePair({
        frames: [
          { id: "a", imageId: 1, atMs: 1_000 },
          { id: "b", imageId: 2, atMs: 1_900 },
        ],
        atMs: 1_500,
      })
    ).toMatchObject({ kind: "blocked" });
  });
});

describe("requestedExtractedFrameVideoDurationSec", () => {
  it("floors fractional intervals and caps the provider request at eight seconds", () => {
    expect(requestedExtractedFrameVideoDurationSec(900)).toBe(0);
    expect(requestedExtractedFrameVideoDurationSec(3_400)).toBe(3);
    expect(requestedExtractedFrameVideoDurationSec(8_000)).toBe(8);
    expect(requestedExtractedFrameVideoDurationSec(12_700)).toBe(8);
  });
});
