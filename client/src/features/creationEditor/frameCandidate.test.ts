import { describe, expect, it } from "vitest";
import { latestFrameCandidateSheet } from "./frameCandidate";

describe("latestFrameCandidateSheet", () => {
  it("finds the latest four-up parent from material history without promptRun", () => {
    const candidate = latestFrameCandidateSheet([
      {
        id: 41,
        imageUrl: "/api/images/older-grid.png",
        generationType: "initial",
        parentImageId: null,
      },
      {
        id: 42,
        imageUrl: "/api/images/latest-grid.png",
        generationType: "initial",
        parentImageId: null,
      },
      {
        id: 43,
        imageUrl: "/api/images/selected-crop.png",
        generationType: "initial",
        parentImageId: 42,
      },
    ]);

    expect(candidate).toEqual({
      imageId: 42,
      imageUrl: "/api/images/latest-grid.png",
      label: "候选版本 V2",
    });
  });

  it("does not split draft or cropped single-frame images into quadrants", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 44,
          imageUrl: "/api/images/draft.png",
          generationType: "generate",
          parentImageId: null,
        },
        {
          id: 45,
          imageUrl: "/api/images/crop.png",
          generationType: "initial",
          parentImageId: 40,
        },
      ])
    ).toBeNull();
  });
});
