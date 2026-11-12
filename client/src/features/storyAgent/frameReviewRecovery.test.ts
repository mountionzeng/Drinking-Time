import { expect, it } from "vitest";
import type { FrameRegionReview } from "@shared/frameRegionReview";
import { missingFrameReviewMessages } from "./frameReviewRecovery";
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
