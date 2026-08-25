import { describe, expect, it } from "vitest";
import {
  extractedFrameTimeMs,
  hasCanonicalImageClipIdentity,
  requestedExtractedFrameVideoDurationSec,
  selectExtractedFrameCandidate,
  selectExtractedFrameCandidates,
  selectExtractedFramePair,
} from "./extractedFrameTransition";

describe("hasCanonicalImageClipIdentity", () => {
  it("requires the immutable clip id and canonical absolute frame/layer", () => {
    expect(hasCanonicalImageClipIdentity({ id: "legacy", imageId: 1, atMs: 0 })).toBe(false);
    expect(hasCanonicalImageClipIdentity({ id: "clip", imageId: 1, atMs: 0, clipId: "image-clip-1", timelineFrame: 0, visualLayer: 2 })).toBe(true);
  });
});

describe("extractedFrameTimeMs", () => {
  it("reads durable and legacy extraction prompts without accepting arbitrary numbers", () => {
    expect(extractedFrameTimeMs("时间线抽帧 · 3400ms · 0101")).toBe(3400);
    expect(extractedFrameTimeMs("从时间线 1:02.003 提取帧")).toBe(62_003);
    expect(extractedFrameTimeMs("普通图片 3400ms")).toBeNull();
  });
});

describe("selectExtractedFrameCandidates", () => {
  const start = { id: "b", imageId: 2, atMs: 4_000 };
  const frames = [
    { id: "a", imageId: 1, atMs: 1_000 },
    start,
    { id: "c", imageId: 3, atMs: 9_000 },
  ];

  it("returns the nearest valid candidate on each side", () => {
    expect(
      selectExtractedFrameCandidates({ frames, start }).map(candidate => [
        candidate.side,
        candidate.frame.imageId,
      ])
    ).toEqual([["left", 1], ["right", 3]]);
  });

  it("does not expose sub-second candidates", () => {
    expect(
      selectExtractedFrameCandidates({
        start,
        frames: [start, { id: "near", imageId: 8, atMs: 4_900 }],
      })
    ).toEqual([]);
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

describe("selectExtractedFrameCandidate", () => {
  const frames = [
    { id: "a", imageId: 1, atMs: 1_000 },
    { id: "b", imageId: 2, atMs: 4_000 },
    { id: "c", imageId: 3, atMs: 9_000 },
  ];

  it("returns the nearest usable candidate and chronological pair", () => {
    const result = selectExtractedFrameCandidate({
      frames,
      start: frames[1],
      atMs: 8_500,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.candidate).toEqual(frames[2]);
    expect(result.pair.left).toEqual(frames[1]);
    expect(result.pair.right).toEqual(frames[2]);
  });

  it("rejects invalid starts and too-short endpoints", () => {
    expect(
      selectExtractedFrameCandidate({
        frames: [{ id: "start", imageId: 1, atMs: 2_000 }],
        start: { id: "gone", imageId: 99, atMs: 2_000 },
        atMs: 2_500,
      }).kind
    ).toBe("blocked");
    expect(
      selectExtractedFrameCandidate({
        frames: [
          { id: "start", imageId: 1, atMs: 2_000 },
          { id: "near", imageId: 2, atMs: 2_900 },
        ],
        start: { id: "start", imageId: 1, atMs: 2_000 },
        atMs: 2_500,
      }).kind
    ).toBe("blocked");
  });
});
