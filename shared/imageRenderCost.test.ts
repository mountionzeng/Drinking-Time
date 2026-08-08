import { describe, expect, it } from "vitest";

import {
  estimateStoryboardMaskedEditCost,
  estimateStoryboardImageCost,
  estimatePublishingCoverCost,
  PUBLISHING_COVER_PROFILE,
  STORYBOARD_IMAGE_CANDIDATE_COUNT,
  STORYBOARD_MASKED_EDIT_PROFILE,
} from "./imageRenderCost";

describe("estimateStoryboardImageCost", () => {
  it("quotes one four-candidate Midjourney grid task in人民币", () => {
    expect(estimateStoryboardImageCost()).toEqual({
      currency: "CNY",
      estimatedCny: 0.68,
      candidateCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
    });
  });

  it("quotes one masked GPT-image 1.5 edit in人民币", () => {
    expect(STORYBOARD_MASKED_EDIT_PROFILE).toEqual({
      model: "gpt-image-1.5",
      size: "1024x1024",
      quality: "high",
    });
    expect(estimateStoryboardMaskedEditCost()).toEqual({
      currency: "CNY",
      estimatedCny: 1.49,
      candidateCount: 1,
    });
  });

  it("quotes one native 3:4 Midjourney four-candidate publishing round in人民币", () => {
    expect(PUBLISHING_COVER_PROFILE).toEqual({
      provider: "midjourney",
      aspectRatio: "3:4",
      candidateCount: 4,
      mjTimeoutMs: 600_000,
    });
    expect(estimatePublishingCoverCost()).toEqual({
      currency: "CNY",
      estimatedCny: 0.68,
      candidateCount: 4,
    });
  });
});
