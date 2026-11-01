import { describe, expect, it } from "vitest";

import {
  estimateStoryboardMaskedEditCost,
  estimateLocalImagePatchCost,
  LOCAL_IMAGE_PATCH_PROFILE,
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

  it("quotes one masked GPT-image 2 edit in人民币", () => {
    expect(STORYBOARD_MASKED_EDIT_PROFILE).toEqual({
      model: "gpt-image-2",
      size: "1024x1024",
      quality: "high",
    });
    expect(estimateStoryboardMaskedEditCost()).toEqual({
      currency: "CNY",
      estimatedCny: 1.43,
      candidateCount: 1,
    });
  });

  it("quotes a low-cost patch without lowering unrelated full-image quotes", () => {
    expect(LOCAL_IMAGE_PATCH_PROFILE).toMatchObject({quality:"low",inputFidelity:"low",inputSide:512});
    expect(estimateLocalImagePatchCost().estimatedCny).toBe(0.27);
    expect(estimateLocalImagePatchCost().estimatedCny).toBeLessThan(estimateStoryboardMaskedEditCost().estimatedCny / 4);
  });

  it("quotes one native 3:4 Midjourney four-candidate publishing round in人民币", () => {
    expect(PUBLISHING_COVER_PROFILE).toEqual({
      provider: "midjourney",
      aspectRatio: "3:4",
      candidateCount: 4,
      mjTimeoutMs: 600_000,
      mjDraft: true,
    });
    expect(estimatePublishingCoverCost()).toEqual({
      currency: "CNY",
      estimatedCny: 0.34,
      candidateCount: 4,
    });
  });
});
