import { describe, expect, it } from "vitest";

import { planImageGenerationReferences } from "./imageGenerationReference";

describe("planImageGenerationReferences", () => {
  it("uses shot frames only when the storyboard supplies visual context", () => {
    expect(
      planImageGenerationReferences({
        shotReferenceImageUrl: "/story/0102.webp",
        shotContextImageUrls: [
          "/story/0101.webp",
          "/story/0103.webp",
          "/story/0102.webp",
        ],
        originalImageUrl: "/uploads/original.webp",
        characterReferenceImageUrl: "/art-library/unrelated-person.webp",
        storyReferenceImageUrls: ["/art-library/unrelated-scene.webp"],
      })
    ).toEqual({
      primaryImage: "/story/0102.webp",
      referencePurpose: "current-frame",
      gateReferenceImages: [
        "/story/0102.webp",
        "/story/0101.webp",
        "/story/0103.webp",
      ],
      usesStoryboardFrames: true,
    });
  });

  it("retains the legacy art-library fallback when no storyboard frame exists", () => {
    expect(
      planImageGenerationReferences({
        characterReferenceImageUrl: "/art-library/character.webp",
        storyReferenceImageUrls: ["/art-library/scene.webp"],
      })
    ).toEqual({
      primaryImage: "/art-library/character.webp",
      referencePurpose: "character",
      gateReferenceImages: [
        "/art-library/character.webp",
        "/art-library/scene.webp",
      ],
      usesStoryboardFrames: false,
    });
  });
});
