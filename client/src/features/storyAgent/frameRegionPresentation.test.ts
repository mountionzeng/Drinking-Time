import { expect, it } from "vitest";
import { frameRegionReviewSchema } from "@shared/frameRegionReview";
import { findReviewImageFrame, frameLocationLabel, regionTreatmentLabel } from "./frameRegionPresentation";

const review = frameRegionReviewSchema.parse({ id: "bda828e0-e427-4d67-9adb-4af3ec045b10", revision: 7, storyId: 7, stableShotId: "third", shotNo: 3,
  timelineVersion: 28, phase: "image_review", instructions: [], createdAt: 1, updatedAt: 2, editorUserId: 1,
  frames: [{ storyId: 7, stableShotId: "third", shotNo: 3, imageId: 2109, imageUrl: "/api/images/source.png", timelineFrame: 738, sourceTimeSec: 6.333, shotTimeSec: 6.333 }],
  tasks: [{ target: "forest", imageId: 2109, instruction: "forest green", threshold: .35, area: "all", sourceSha: "source", maskSha: "mask", maskUrl: "/api/images/mask.png", protectedUrl: "/api/images/protected.png", overlayUrl: "/api/images/overlay.png", selectedPixels: 40,
    candidate: { imageId: 2111, imageUrl: "/api/images/result.png", changedPixels: 20, outsideChangedPixels: 0 } }],
});
it("locates a candidate by its saved frame provenance and labels both time coordinates", () => {
  const frame = findReviewImageFrame([review], 7, "third", 2111)!;
  expect(frame.imageId).toBe(2109);
  expect(frameLocationLabel(frame, false)).toBe("镜内 6.33s · 全片 24.60s");
  expect(frameLocationLabel(frame, true)).toBe("In shot 6.33s · Timeline 24.60s");
});
it("never attaches another story, another shot, or an unknown image to a frame", () => {
  expect(findReviewImageFrame([review], 8, "third", 2111)).toBeUndefined();
  expect(findReviewImageFrame([review], 7, "other", 2111)).toBeUndefined();
  expect(findReviewImageFrame([review], 7, "third", 999)).toBeUndefined();
});

it("describes and restores the separately frozen less-blue forest recipe", () => {
  const value = structuredClone(review);
  value.tasks[0].forestTone = "harmonize_green_less_blue";
  const restored = frameRegionReviewSchema.parse(value);
  expect(regionTreatmentLabel(restored.tasks[0], true)).toContain("less blue in shadows");
});
