import { describe, expect, it } from "vitest";

import {
  estimateStoryboardImageCost,
  STORYBOARD_IMAGE_CANDIDATE_COUNT,
} from "./imageRenderCost";

describe("estimateStoryboardImageCost", () => {
  it("quotes one four-candidate Midjourney task in人民币", () => {
    expect(estimateStoryboardImageCost()).toEqual({
      currency: "CNY",
      estimatedCny: 0.68,
      candidateCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
    });
  });
});
