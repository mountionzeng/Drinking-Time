import { expect, it } from "vitest";
import type { FrameRegionReview } from "@shared/frameRegionReview";
import { missingFrameReviewMessages, withoutDuplicateFrameReviewRecovery } from "./frameReviewRecovery";
const review = (id: string, revision: number, updatedAt: number, phase = "scope_review") => ({ id, revision, updatedAt, phase, storyId: 7, stableShotId: "third" }) as FrameRegionReview;
it("recovers completed results once and never borrows another story's review", () => {
  const saved = review("a", 2, 20);
  const recovered = missingFrameReviewMessages([], [saved], 7, "en");
  expect(recovered).toHaveLength(1);
  expect(missingFrameReviewMessages(recovered, [saved], 7, "en")).toEqual([]);
  expect(missingFrameReviewMessages([], [saved], 8, "en")).toEqual([]);
});
it("does not resurrect an earlier session after the latest review is cancelled", () => {
  expect(missingFrameReviewMessages([], [review("a", 2, 20), review("b", 3, 30, "cancelled")], 7, "en")).toEqual([]);
});

it("removes only duplicate recovery placeholders, retaining other frames and revisions", () => {
  const saved = review("a", 2, 20);
  const placeholder = missingFrameReviewMessages([], [saved], 7, "en")[0];
  const response = { ...placeholder, id: "actual-reply", content: "Forest and cloud regions" };
  const earlier = { ...placeholder, id: "region-review:a:1", frameReview: review("a", 1, 10) };
  const otherFrame = { ...placeholder, id: "region-review:b:0", frameReview: review("b", 0, 30) };
  const result = withoutDuplicateFrameReviewRecovery([earlier, placeholder, response, otherFrame]);
  expect(result).toEqual([earlier, response, otherFrame]);
  expect(withoutDuplicateFrameReviewRecovery(result)).toBe(result);
});
