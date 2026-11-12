import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryMaterialState } from "../../shared/storyMaterial";
import { DEFAULT_TIMELINE_TRANSFORM, DEFAULT_TIMELINE_VIDEO_EFFECTS } from "../../shared/storyMaterial";
import { extractChatFrameReferences, planChatReferenceFrames, resolveReferenceShot } from "./chatFrameReferences";
import { resetTimelineFrameExtractionLimitsForTesting } from "./timelineFrameExtractionLimits";

const take = { id: 10, storyId: 7, userId: 1, stableShotId: "third", status: "available", durationSec: 14.5, ranges: [], selectedRangeId: null, selectedSelectionType: "full_take", parameterSnapshot: { fileName: "flight_v1.mp4" } };
function fixture(): StoryMaterialState {
  return { storyId: 7, shots: [{ stableShotId: "third", shotNo: 3, currentVideo: take, videoTakes: [take] }], reusableVideoTakes: [], unassignedVideoTakes: [], timeline: { storyId: 7, version: 16, items: [{ stableShotId: "third", included: true, position: 0, timelineStartFrame: 551, durationFrames: 435, plannedDurationMs: 14500, transform: DEFAULT_TIMELINE_TRANSFORM, primaryVideoEdit: { takeId: 10, sourceStartSec: 0, sourceEndSec: 14.5, effects: DEFAULT_TIMELINE_VIDEO_EFFECTS } }] } } as unknown as StoryMaterialState;
}
const input = { storyId: 7, userId: 1, instruction: "第03镜先抽帧给我看看" };

describe("warehouse-only video references", () => {
  beforeEach(() => resetTimelineFrameExtractionLimitsForTesting());
  it("explicit shot wins over clicked shot and normalizes imported version names", () => {
    expect(resolveReferenceShot(fixture(), { instruction: "第03镜抽帧", stableShotId: "other" }).stableShotId).toBe("third");
    expect(resolveReferenceShot(fixture(), { instruction: "flight_V01抽帧" }).stableShotId).toBe("third");
    expect(() => resolveReferenceShot(fixture(), { instruction: "missing_v1抽帧", stableShotId: "third" })).toThrow();
    expect(() => resolveReferenceShot(fixture(), { instruction: "第04镜抽帧", stableShotId: "third" })).toThrow();
  });
  it("uses exact timeline/source coordinates without modifying the timeline", () => {
    const state = fixture(); const before = JSON.stringify(state);
    const planned = planChatReferenceFrames(state, input);
    expect(planned.map(frame => frame.descriptor.timelineFrame)).toEqual([616,768,920]);
    expect(planned.map(frame => frame.descriptor.atSec)).toEqual([65/30,217/30,369/30]);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("honors trimmed and reversed sources", () => {
    const state = fixture();
    state.timeline.items[0].durationFrames = 120;
    state.timeline.items[0].primaryVideoEdit = { takeId: 10, sourceStartSec: 4, sourceEndSec: 8, effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS, reverse: true } };
    const result = planChatReferenceFrames(state, {instruction: "第03镜第1秒抽帧"});
    expect(result[0].descriptor.atSec).toBeCloseTo(7);
  });
  it("rejects a Take from another story before capture", () => {
    const state = fixture(); state.shots[0] = { ...state.shots[0], videoTakes: [{ ...state.shots[0].videoTakes[0], storyId: 99 }] };
    expect(() => planChatReferenceFrames(state,input)).toThrow("原视频不可用");
  });
  it("checks story ownership before reading/capturing media", async () => {
    const capture = vi.fn();
    await expect(extractChatFrameReferences(input, { getMaterial: vi.fn().mockResolvedValue(null), capture })).rejects.toThrow("无权");
    expect(capture).not.toHaveBeenCalled();
  });
  it("keeps successful frames on partial failure and reuses saved assets on retry", async () => {
    const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: "white" } }).png().toBuffer();
    const images: any[] = [];
    const deps = {
      getMaterial: vi.fn().mockResolvedValue(fixture()), listImages: vi.fn(async () => images), readImage: vi.fn(async () => png),
      createImage: vi.fn(async (data: any) => { const image = { ...data, id: 100+images.length }; images.push(image); return image; }),
      capture: vi.fn().mockResolvedValueOnce({path:"a"}).mockRejectedValueOnce(new Error("decode failed")).mockResolvedValue({path:"b"}),
      readFile: vi.fn().mockResolvedValue(png),
      preflight: vi.fn().mockResolvedValue(undefined),
      storeLimited: vi.fn(async ({store}: any) => store()),
      storeBytes: vi.fn(async (_bytes: any, _mime: any, options: any) => ({status:"ok" as const,imageUrl:`/api/images/${options.storageKey.split("/").pop()}`,imageKey:options.storageKey})),
    };
    const result = await extractChatFrameReferences(input, deps);
    expect(result.frames).toHaveLength(2); expect(result.failures).toEqual(["decode failed"]);
    expect(deps.createImage.mock.calls.every(([image]) => image.isCurrent === false)).toBe(true);
    const retry = await extractChatFrameReferences(input, deps);
    expect(retry.frames).toHaveLength(3); expect(images).toHaveLength(3);
    expect(deps.capture).toHaveBeenCalledTimes(4);
    expect(deps.storeBytes.mock.calls[0][2].storageKey).toMatch(/^generated\/frame-references\/source-ref-[a-f0-9]+\.png$/);
    expect(deps.capture.mock.calls[0][0]).toMatchObject({preserveAspect:true, preserveDimensions:true, userId:1,takeId:10});
  });
});
