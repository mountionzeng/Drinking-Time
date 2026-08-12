import { describe, expect, it } from "vitest";

import type { CreationEditorShot } from "@/features/creationEditor/types";
import { storyboardShotCostEstimate } from "./storyboardReviewModel";

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
