import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMELINE_TRANSFORM as transform, DEFAULT_TIMELINE_VIDEO_EFFECTS as effects } from "@shared/storyMaterial";
import type { TimelineVideoSource } from "./previewPlaybackModel";
import { holdOutgoingVideo, nextPreviewVideo, prepareStandbyVideo, previewVideoBoundaries, previewVideoKey } from "./previewVideoHandoff";

const source: TimelineVideoSource = {
  shotNo: 1, stableShotId: "shot", takeStableShotId: "shot", takeId: 1,
  rangeId: null, videoUrl: "/same.mp4", sourceStartSec: 2, sourceEndSec: 5,
  sourceTimeSec: 2, offsetMs: 0, durationMs: 3000, existingClipId: null,
  label: "", effects, transform, visualLayer: 0,
};

describe("preview video handoff", () => {
  it("includes absolute shot, inserted range and overlay boundaries in order", () => {
    const clip = { id: "clip", takeId: 1, rangeId: 1, sourceStableShotId: "shot",
      videoUrl: "/same.mp4", label: "", sourceStartSec: 2, sourceEndSec: 2.5, offsetMs: 300, durationMs: 500 };
    const overlay = { id: "overlay", kind: "generated-video" as const, takeId: 2, sourceStableShotId: "shot",
      videoUrl: "/overlay.mp4", startFrame: 45, targetEndFrame: 90, mediaEndFrame: 75, endFrame: 90,
      stackOrder: 1, leftImageId: 1, rightImageId: 2, transform };
    expect(previewVideoBoundaries([{ stableShotId: "shot", position: 0, included: true, plannedDurationMs: 2000,
      timelineStartFrame: 30, durationFrames: 60, transform, visualClips: [clip] }], [overlay]))
      .toEqual([1000, 1300, 1500, 1800, 2500, 3000]);
  });

  it("prepares a distinct decoder even for another range of the same file", () => {
    const split = { ...source, existingClipId: "right", sourceTimeSec: 4 };
    const resolve = vi.fn().mockReturnValueOnce(source).mockReturnValueOnce(split);
    expect(nextPreviewVideo([0, 1000, 2000], 1, previewVideoKey(source), resolve)).toBe(split);
    expect(resolve.mock.calls).toEqual([[1000], [2000]]);
  });

  it("does not carry an outgoing picture over an intentional gap", () => {
    const resolve = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(source);
    expect(nextPreviewVideo([0, 1000, 2000], 1, previewVideoKey(source), resolve)).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("seeks silently to the actual entry time and caps a reversed start at the last frame", () => {
    const video = { currentTime: 0, duration: 5, readyState: 4, paused: false, muted: false, pause: vi.fn() };
    prepareStandbyVideo(video as unknown as HTMLVideoElement, 2.25);
    expect(video.currentTime).toBe(2.25);
    expect(video.muted).toBe(true);
    expect(video.pause).toHaveBeenCalledOnce();
    prepareStandbyVideo(video as unknown as HTMLVideoElement, 5);
    expect(video.currentTime).toBeCloseTo(4.999);
  });

  it("keeps the last decoded picture through a second cut that still has no frame", () => {
    const drawImage = vi.fn();
    const canvas = { hidden: true, style: {}, getContext: () => ({ drawImage }) };
    const video = { readyState: 4, videoWidth: 320, videoHeight: 180, style: { transform: "scale(2)" } };
    holdOutgoingVideo(video as HTMLVideoElement, canvas as unknown as HTMLCanvasElement);
    holdOutgoingVideo({ readyState: 0 } as HTMLVideoElement, canvas as unknown as HTMLCanvasElement);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(canvas).toMatchObject({ hidden: false, width: 320, height: 180, style: { transform: "scale(2)" } });
  });
});
