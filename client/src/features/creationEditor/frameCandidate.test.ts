import { describe, expect, it } from "vitest";
import { latestFrameCandidateSheet } from "./frameCandidate";

describe("latestFrameCandidateSheet", () => {
  it("finds the four-up parent referenced by the current prompt run", () => {
    const candidate = latestFrameCandidateSheet(
      [
        {
          id: 41,
          imageUrl: "/api/images/older-grid.png",
          generationType: "initial",
          parentImageId: null,
        },
        {
          id: 42,
          imageUrl: "/api/images/latest-grid.png",
          prompt: "Single-frame rule: one cinematic frame only.",
          generationType: "initial",
          parentImageId: null,
        },
        {
          id: 43,
          imageUrl: "/api/images/selected-crop.png",
          generationType: "initial",
          parentImageId: 42,
        },
      ],
      42
    );

    expect(candidate).toEqual({
      imageId: 42,
      imageUrl: "/api/images/latest-grid.png",
      label: "候选版本 V1",
    });
  });

  it("does not split draft or cropped single-frame images into quadrants", () => {
    expect(
      latestFrameCandidateSheet(
        [
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
        ],
        40
      )
    ).toBeNull();
  });

  it("does not split an imported full-frame image without a matching prompt run", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 46,
          imageUrl: "/api/images/imported-full-frame.webp",
          generationType: "initial",
          parentImageId: null,
        },
      ])
    ).toBeNull();
  });

  it("splits the current storyboard-reference MJ render into four quadrants", () => {
    expect(
      latestFrameCandidateSheet(
        [
          {
            id: 48,
            imageUrl: "/api/images/story-reference-render.png",
            prompt:
              "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:",
            generationType: "inpaint",
            parentImageId: null,
          },
        ],
        48
      )
    ).toEqual({
      imageId: 48,
      imageUrl: "/api/images/story-reference-render.png",
      label: "候选版本 V1",
    });
  });

  it("does not infer an older storyboard-reference image is a candidate sheet", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 49,
          imageUrl: "/api/images/story-reference-render.png",
          prompt:
            "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:",
          generationType: "inpaint",
          parentImageId: null,
        },
      ])
    ).toBeNull();
  });

  it("recognizes a generated candidate sheet when the prompt run was not persisted", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 47,
          imageUrl: "/api/images/generated-grid.png",
          prompt:
            "USER DIRECT EDIT INSTRUCTION — HIGHEST PRIORITY:\nSingle-frame rule: one frame.",
          generationType: "initial",
          parentImageId: null,
        },
      ])
    ).toEqual({
      imageId: 47,
      imageUrl: "/api/images/generated-grid.png",
      label: "候选版本 V1",
    });
  });
});
