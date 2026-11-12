import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  DEFAULT_TIMELINE_TRANSFORM as transform,
  DEFAULT_TIMELINE_VIDEO_EFFECTS as effects,
  type StoryMaterialState,
} from "../../shared/storyMaterial";
import { planPausedFrame } from "./pausedFrameReference";
import { extractChatFrameReferences } from "./chatFrameReferences";
import { renderExportImageBytes } from "./videoExportImage";
import { resetTimelineFrameExtractionLimitsForTesting } from "./timelineFrameExtractionLimits";
const snapshot = {
  storyId: 7,
  timelineVersion: 16,
  timelineFrame: 90,
  hiddenVisualLayers: [],
  width: 1080,
  height: 1920,
};
function fixture(): StoryMaterialState {
  const take = {
    id: 10,
    storyId: 7,
    status: "available",
    durationSec: 10,
    ranges: [],
    selectedSelectionType: "full_take",
  };
  return {
    storyId: 7,
    shots: [
      { stableShotId: "s3", shotNo: 3, currentVideo: take, videoTakes: [take] },
    ],
    reusableVideoTakes: [],
    unassignedVideoTakes: [],
    timeline: {
      storyId: 7,
      version: 16,
      items: [
        {
          stableShotId: "s3",
          position: 0,
          included: true,
          timelineStartFrame: 30,
          durationFrames: 120,
          plannedDurationMs: 4000,
          transform,
          primaryVideoEdit: {
            takeId: 10,
            sourceStartSec: 2,
            sourceEndSec: 10,
            effects: { ...effects, playbackRate: 2, reverse: true },
          },
        },
      ],
    },
  } as unknown as StoryMaterialState;
}
beforeEach(resetTimelineFrameExtractionLimitsForTesting);
it("uses native-sized source pixels for editing instead of the portrait preview canvas", async () => {
  const source = await sharp({ create: { width: 320, height: 180, channels: 3, background: "red" } }).png().toBuffer();
  const capture = vi.fn().mockResolvedValue({ path: "native" });
  const renderFrame = vi.fn();
  const storeBytes = vi.fn(async (_bytes: ArrayBuffer | Uint8Array) => ({ status: "ok" as const, imageKey: "native-key", imageUrl: "/api/images/native.png" }));
  const result = await extractChatFrameReferences({
    storyId: 7, userId: 1, instruction: "改这一帧", pausedFrame: { ...snapshot, imageMode: "source" },
  }, {
    getMaterial: vi.fn().mockResolvedValue(fixture()), listImages: vi.fn().mockResolvedValue([]),
    capture, readFile: vi.fn().mockResolvedValue(source), renderFrame,
    preflight: vi.fn(), storeLimited: vi.fn(async ({ store }: any) => store()), storeBytes,
    createImage: vi.fn(async (data: any) => ({ ...data, id: 101 })),
  });
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ preserveDimensions: true, atSec: 6 }));
  expect(renderFrame).not.toHaveBeenCalled();
  expect(storeBytes.mock.calls[0]?.[0]).toEqual(source);
  expect(result.frames[0]).toMatchObject({ sourceFrame: true, imageSize: { width: 320, height: 180 }, timelineVersion: 16, timelineFrame: 90 });
});
it("pins the exact trimmed/reversed/rate-adjusted frame without mutating placement", () => {
  const state = fixture(),
    before = JSON.stringify(state);
  const p = planPausedFrame(state, snapshot);
  expect(p.descriptor).toMatchObject({
    kind: "video",
    takeId: 10,
    atSec: 6,
    timelineFrame: 90,
  });
  expect(p.offset).toBe(60);
  expect(p.dimensions).toEqual({ width: 720, height: 1280 });
  expect(JSON.stringify(state)).toBe(before);
});
it("rejects stale versions, wrong stories, gaps and unavailable media", () => {
  expect(() =>
    planPausedFrame(fixture(), { ...snapshot, timelineVersion: 15 })
  ).toThrow("版本");
  expect(() =>
    planPausedFrame(fixture(), { ...snapshot, storyId: 8 })
  ).toThrow();
  expect(() =>
    planPausedFrame(fixture(), { ...snapshot, timelineFrame: 2 })
  ).toThrow("画面");
  const state = fixture();
  state.shots[0].videoTakes = [];
  expect(() => planPausedFrame(state, snapshot)).toThrow("不可用");
});
it("selects upper stills and respects hidden layers; passes their crop transforms", () => {
  const state = fixture();
  state.timeline.items[0].imageClips = [
    {
      id: "still",
      imageId: 99,
      imageUrl: "/api/images/forged.png",
      label: "still",
      offsetFrames: 0,
      durationFrames: 120,
      visualLayer: 2,
      transform: {
        ...transform,
        zoom: 2,
        panX: 0.3,
        rotationDeg: 90,
        flipX: true,
      },
    },
  ];
  const p = planPausedFrame(state, snapshot);
  expect(p.descriptor).toMatchObject({ kind: "image", imageId: 99 });
  expect(p.transform.zoom).toBe(2);
  expect(
    planPausedFrame(state, { ...snapshot, hiddenVisualLayers: [2] }).descriptor
      .kind
  ).toBe("video");
});
it("does not claim a CSS animated preview was captured", () => {
  const state = fixture();
  state.timeline.items[0].primaryVideoEdit!.effects.motionPreset = {
    kind: "heartbeat",
    bpm: 60,
    scaleAmount: 0.1,
  };
  expect(() => planPausedFrame(state, snapshot)).toThrow("动态预览");
});
it("captures and persists once, including revision, without current-image adoption", async () => {
  const state = fixture();
  const images: any[] = [];
  const deps = {
    getMaterial: vi.fn().mockResolvedValue(state),
    listImages: vi.fn(async () => images),
    createImage: vi.fn(async (data: any) => {
      const image = { ...data, id: 100 };
      images.push(image);
      return image;
    }),
    capture: vi.fn().mockResolvedValue({ path: "source" }),
    readFile: vi.fn().mockResolvedValue(Buffer.from("source")),
    renderFrame: vi.fn().mockResolvedValue(Buffer.from("composed")),
    preflight: vi.fn(),
    storeLimited: vi.fn(async ({ store }: any) => store()),
    storeBytes: vi.fn(async (_a: any, _b: any, options: any) => ({
      status: "ok" as const,
      imageKey: options.storageKey,
      imageUrl: "/api/images/captured.png",
    })),
  };
  const input = {
    storyId: 7,
    userId: 1,
    instruction: "改这一帧",
    pausedFrame: snapshot,
  };
  const result = await extractChatFrameReferences(input, deps);
  expect(result.frames[0]).toMatchObject({
    origin: "paused-preview",
    timelineVersion: 16,
    timelineFrame: 90,
    takeId: 10,
    sourceTimeSec: 6,
  });
  expect(deps.renderFrame).toHaveBeenCalledWith(
    Buffer.from("source"),
    transform,
    { width: 720, height: 1280 },
    "contain"
  );
  expect(deps.createImage.mock.calls[0][0].isCurrent).toBe(false);
  await extractChatFrameReferences(input, deps);
  expect(deps.capture).toHaveBeenCalledTimes(1);
});
it("rejects unauthorized source stills before decoding their URL", async () => {
  const state = fixture();
  state.timeline.items[0].imageClips = [
    {
      id: "x",
      imageId: 99,
      imageUrl: "http://forged",
      label: "x",
      offsetFrames: 0,
      durationFrames: 120,
      visualLayer: 2,
    },
  ];
  const readImage = vi.fn();
  const result = await extractChatFrameReferences(
    { storyId: 7, userId: 1, instruction: "这一帧", pausedFrame: snapshot },
    {
      getMaterial: vi.fn().mockResolvedValue(state),
      listImages: vi.fn().mockResolvedValue([]),
      preflight: vi.fn(),
      readImage,
    }
  );
  expect(result.frames).toEqual([]);
  expect(readImage).not.toHaveBeenCalled();
  expect(result.failures[0]).toContain("无权");
});
it("renders contain letterboxing without independent subtitles and preserves image cover default", async () => {
  const bytes = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const contain = await renderExportImageBytes(
    bytes,
    transform,
    { width: 40, height: 80 },
    "contain"
  );
  const cover = await renderExportImageBytes(bytes, transform, {
    width: 40,
    height: 80,
  });
  const a = await sharp(contain).removeAlpha().raw().toBuffer(),
    b = await sharp(cover).removeAlpha().raw().toBuffer();
  expect([...a.subarray(0, 3)]).toEqual([0, 0, 0]);
  expect([...b.subarray(0, 3)]).toEqual([255, 0, 0]);
  expect([...a.subarray(40 * 40 * 3, 40 * 40 * 3 + 3)]).toEqual([255, 0, 0]);
});

it("does not return a success reference after the timeline changed during capture", async () => {
  const saved = { id: 100, imageUrl: "/api/images/ref.png", imageKey: "" };
  const state = fixture();
  const getMaterial = vi
    .fn()
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({
      ...state,
      timeline: { ...state.timeline, version: 17 },
    });
  await expect(
    extractChatFrameReferences(
      { storyId: 7, userId: 1, instruction: "这一帧", pausedFrame: snapshot },
      {
        getMaterial,
        listImages: vi.fn().mockResolvedValue([]),
        preflight: vi.fn(),
        capture: vi.fn().mockResolvedValue({ path: "source" }),
        readFile: vi.fn().mockResolvedValue(Buffer.from("source")),
        renderFrame: vi.fn().mockResolvedValue(Buffer.from("composed")),
        storeLimited: vi.fn(async ({ store }: any) => store()),
        storeBytes: vi.fn(async () => ({
          status: "ok" as const,
          imageKey: "key",
          imageUrl: saved.imageUrl,
        })),
        createImage: vi.fn().mockResolvedValue(saved),
      }
    )
  ).rejects.toThrow("版本已变化");
});
