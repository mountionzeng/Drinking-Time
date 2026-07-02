import { describe, expect, it } from "vitest";
import {
  buildImageRegionSelection,
  buildVideoFrameRegionSelection,
  buildVideoRangeSelection,
} from "./mediaSelectionContext";

const shot = {
  shotNo: 6,
  shotKey: "SH06",
  stableShotId: "shot-06",
  shotIdentity: "shot-06",
  subject: "人物站在窗边",
  action: "缓慢回头",
  dialogue: "我想明白了",
};

describe("media selection context", () => {
  it("builds a normalized image rectangle reference", () => {
    expect(
      buildImageRegionSelection({
        storyId: 36,
        shot,
        imageId: 270,
        rect: { x: 0.125, y: 0.25, width: 0.5, height: 0.4 },
      }),
    ).toMatchObject({
      sourceType: "storyboard-image",
      sourceId: "270",
      storyId: 36,
      stableShotId: "shot-06",
      shotNo: 6,
      imageId: 270,
      objectVersion: "image:270",
      materialStatus: "current-image",
      selection: {
        kind: "rect",
        x: 0.125,
        y: 0.25,
        width: 0.5,
        height: 0.4,
      },
    });
  });

  it("keeps URL-only current frames selectable for Xiaozhuo advice", () => {
    expect(
      buildImageRegionSelection({
        storyId: 36,
        shot,
        imageId: null,
        imageUrl: "https://example.test/frame.png",
        rect: { x: 0.2, y: 0.1, width: 0.4, height: 0.3 },
      }),
    ).toMatchObject({
      sourceType: "storyboard-image",
      sourceId: "shot-06:current-frame",
      imageId: null,
      objectVersion: "image:current-frame",
      materialStatus: "current-image",
      selection: {
        kind: "rect",
        x: 0.2,
        y: 0.1,
        width: 0.4,
        height: 0.3,
      },
    });
  });

  it("builds a bounded video time reference with a persisted range id", () => {
    expect(
      buildVideoRangeSelection({
        storyId: 36,
        shot,
        takeId: 15,
        rangeId: 42,
        startSec: 1.2,
        endSec: 3.7,
        durationSec: 5,
      }),
    ).toMatchObject({
      sourceType: "timeline-range",
      sourceId: "42",
      storyId: 36,
      stableShotId: "shot-06",
      shotNo: 6,
      videoTakeId: 15,
      rangeId: 42,
      objectVersion: "video:15",
      materialStatus: "timeline-range",
      selection: {
        kind: "time",
        startSec: 1.2,
        endSec: 3.7,
      },
    });
  });

  it("keeps a video frame rectangle attached to its take version", () => {
    expect(
      buildVideoFrameRegionSelection({
        storyId: 36,
        shot,
        takeId: 15,
        timeSec: 2.25,
        rect: { x: 0.2, y: 0.1, width: 0.4, height: 0.6 },
      }),
    ).toMatchObject({
      sourceType: "animatic-video",
      sourceId: "15",
      videoTakeId: 15,
      objectVersion: "video:15",
      selection: {
        kind: "rect",
        x: 0.2,
        y: 0.1,
        width: 0.4,
        height: 0.6,
      },
    });
  });
});
