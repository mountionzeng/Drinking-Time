import { describe, expect, it } from "vitest";
import type { ImageAsset } from "../../shared/imageAsset";
import { collectShotImageReferences } from "./shotImageReferences";

function asset(
  id: number,
  canonicalShotNo: string,
  overrides: Partial<ImageAsset> = {}
): ImageAsset {
  return {
    id,
    projectId: 1,
    storyId: 1,
    userId: 1,
    rawShotNo: canonicalShotNo,
    canonicalShotNo,
    shotIdentity: `shot-${canonicalShotNo}`,
    imageKey: null,
    imageUrl: `/api/images/${id}.png`,
    prompt: null,
    generationType: "generate",
    parentImageId: null,
    isCurrent: true,
    maskKey: null,
    createdAt: "2026-06-24T00:00:00.000Z",
    kind: "story_frame",
    status: "selected",
    assignment: "shot",
    availability: "available",
    isPrimary: true,
    selectionSource: "explicit",
    selectedAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("collectShotImageReferences", () => {
  it("uses current main image first, adjacent main images next, then story anchors", () => {
    const plan = collectShotImageReferences({
      targetShotNo: "SH02",
      assets: [
        asset(1, "SH01"),
        asset(2, "SH02"),
        asset(3, "SH03"),
        asset(4, "SH02", {
          status: "pending",
          isPrimary: false,
          selectionSource: "none",
          imageUrl: "/api/images/pending.png",
        }),
      ],
      storyReferenceImages: ["/api/images/character.png"],
    });

    expect(plan.editSource?.id).toBe(2);
    expect(plan.referenceImages).toEqual([
      "/api/images/2.png",
      "/api/images/1.png",
      "/api/images/3.png",
      "/api/images/character.png",
    ]);
    expect(plan.referenceImages).not.toContain("/api/images/pending.png");
  });

  it("cold-starts from art direction prompt when no image references exist", () => {
    const plan = collectShotImageReferences({
      targetShotNo: "SH01",
      assets: [],
      artDirection: {
        style: ["documentary realism"],
        palette: ["warm neutral"],
        light: [],
        composition: [],
        material: [],
        negative: ["split panels"],
      },
    });

    expect(plan.editSource).toBeNull();
    expect(plan.referenceImages).toEqual([]);
    expect(plan.coldStartPrompt).toContain("documentary realism");
    expect(plan.coldStartPrompt).toContain("split panels");
  });
});
