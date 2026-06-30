import { describe, expect, it } from "vitest";
import {
  resolvePromptAssetFreshness,
  resolveVideoStaleReasons,
} from "./promptMaterialProjection";

describe("promptMaterialProjection", () => {
  it("treats unbound assets as legacy freshness", () => {
    expect(resolvePromptAssetFreshness(null, 12)).toBe("legacy");
    expect(resolvePromptAssetFreshness(12, null)).toBe("legacy");
  });

  it("marks freshness stale only when the bound compilation differs", () => {
    expect(resolvePromptAssetFreshness(12, 12)).toBe("current");
    expect(resolvePromptAssetFreshness(12, 18)).toBe("stale");
  });

  it("derives video stale reasons independently for prompt and source image", () => {
    expect(
      resolveVideoStaleReasons({
        sourceImageId: 1,
        currentImageId: 2,
        promptFreshness: "stale",
      })
    ).toEqual(["source_image", "prompt"]);
    expect(
      resolveVideoStaleReasons({
        sourceImageId: 1,
        currentImageId: 1,
        promptFreshness: "current",
      })
    ).toEqual([]);
  });
});
