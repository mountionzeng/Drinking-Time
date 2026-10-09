import { describe, expect, it } from "vitest";

import type { CreationEditorShot } from "@/features/creationEditor/types";
import { storyboardShotCostEstimate, storyboardVideoCostEstimate, quickShotVideoRenderPlan } from "./storyboardReviewModel";

const shot = {
  shotNo: 1,
  action: "人物缓慢抬手",
  cameraMove: "缓慢推进",
  videoPrompt: "从中景推进到近景",
  durationMs: 5_000,
  imageId: 1,
  imageUrl: "/image.png",
} as CreationEditorShot;

describe("storyboardShotCostEstimate", () => {
  it("shows the four-candidate image path plus video estimate", () => {
    const estimate = storyboardShotCostEstimate(shot, {
      singleImageFallback: false,
    });
    expect(estimate.imageCandidateCount).toBe(4);
    expect(estimate.imageCny).toBe(0.68);
    expect(estimate.videoCny).toBe(0.88);
    expect(estimate.totalCny).toBe(1.56);
  });

  it("shows the truthful one-image fallback price", () => {
    const estimate = storyboardShotCostEstimate(shot, {
      singleImageFallback: true,
    });
    expect(estimate.imageCandidateCount).toBe(1);
    expect(estimate.imageCny).toBe(1.49);
    expect(estimate.totalCny).toBe(2.37);
  });
});


describe("start/end storyboard estimate", () => {
  it("uses Vidu resolution and duration instead of the generic 0.175/sec rate", () => {
    const configured = { ...shot, generationParams: JSON.stringify({frameMode: "start_end", firstFrameImageId: 1, lastFrameImageId: 2, durationSec: 3, resolution: "1080p"}) };
    expect(storyboardVideoCostEstimate(configured)).toBe(1.87);
    expect(storyboardShotCostEstimate(configured, {}).totalCny).toBe(2.55);
  });
  it("derives the same default 1080p route when two frames select start/end automatically", () => {
    const configured = { ...shot, imageVersions: [{id: 1, imageUrl: "/first.png"}, {id: 2, imageUrl: "/last.png"}] } as CreationEditorShot;
    expect(storyboardVideoCostEstimate(configured)).toBe(2.54);
  });
});


it("does not advertise free local motion when the endpoints require different pixels", () => {
  const moving = { ...shot, action: "", performance: "", environmentMotion: "", videoPrompt: "缓慢放大", cameraMove: "缓慢放大", generationParams: JSON.stringify({frameMode: "start_end", firstFrameImageId: 1, lastFrameImageId: 2, durationSec: 3, resolution: "1080p"}) } as CreationEditorShot;
  expect(storyboardVideoCostEstimate(moving)).toBe(1.87);
  expect(storyboardVideoCostEstimate({...moving, generationParams: undefined})).toBe(0);
});

it("quotes and submits the visible eight-second duration instead of a hidden ten-second cap", () => {
  const longShot = { ...shot, durationMs: 12_000 };
  expect(quickShotVideoRenderPlan(longShot, []).durationSec).toBe(8);
  expect(storyboardVideoCostEstimate(longShot)).toBe(1.4);
  const edited = { ...longShot, generationParams: JSON.stringify({durationSec: 4}) };
  expect(quickShotVideoRenderPlan(edited, []).durationSec).toBe(4);
  expect(storyboardVideoCostEstimate(edited)).toBe(0.7);
});
