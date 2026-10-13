import { describe, it, expect } from "vitest";
import {
  normalizeColorDesign,
  colorDesignSummary,
  colorDesignFromSummary,
  commonColorDesign,
  colorDesignsConflict,
} from "./colorHarmony";
import {
  artRecipeToLibraryItems,
  normalizeArtPromptLibraryImport,
} from "./artPromptLibrary";
import {
  defaultArtRecipe,
  deriveStoryArtRecipe,
  artCandidatesNeedConvergence,
  normalizeStoryArtDirection,
} from "./artDirection";

describe("controlled colour methods", () => {
  it("drops untrusted fields individually and requires local scale", () => {
    expect(
      normalizeColorDesign({
        harmony: "red /private/source",
        saturation: "restrained",
        localHarmony: "complementary",
        artist: "secret",
      })
    ).toEqual({ saturation: "restrained" });
    for (const input of [null, [], "red", { harmony: "unknown" }])
      expect(normalizeColorDesign(input)).toBeUndefined();
  });
  it("round trips readable library summaries through whitespace normalization", () => {
    const colorDesign = {
      harmony: "analogous",
      localHarmony: "complementary",
      localScale: "marks",
      valueMasses: "connected",
    } as const;
    const library = normalizeArtPromptLibraryImport({
      name: "test",
      items: artRecipeToLibraryItems({ ...defaultArtRecipe(), colorDesign }),
    });
    expect(
      colorDesignFromSummary(library.items.map(item => item.content).join(" "))
    ).toEqual(colorDesign);
    expect(
      colorDesignFromSummary('{"harmony":"complementary"} arbitrary prose')
    ).toBeUndefined();
    expect(colorDesignSummary(colorDesign)).not.toContain("harmony");
  });
  it("preserves versions, and requires convergence for conflicting liked methods", () => {
    const candidates = ["monochromatic", "complementary"].map((harmony, i) => ({
      id: String(i),
      imageUrl: "test",
      title: "test",
      role: "direction",
      prompt: "test",
      verdict: "liked",
      recipe: {
        ...defaultArtRecipe(),
        colorDesign: { harmony, saturation: "restrained" },
      },
    }));
    const direction = normalizeStoryArtDirection({
      candidates,
      recipeVersions: [],
    });
    expect(direction.candidates[0].recipe.colorDesign?.harmony).toBe(
      "monochromatic"
    );
    const single = deriveStoryArtRecipe(direction.candidates.slice(0, 1))!;
    const saved = normalizeStoryArtDirection(JSON.parse(JSON.stringify({ phase: "locked", recipe: single, recipeVersions: [single] })));
    expect(saved.recipe?.colorDesign).toEqual(direction.candidates[0].recipe.colorDesign);
    expect(saved.recipeVersions[0].colorDesign).toEqual(single.colorDesign);
    expect(deriveStoryArtRecipe(direction.candidates)?.colorDesign).toEqual({
      saturation: "restrained",
    });
    expect(artCandidatesNeedConvergence(direction.candidates)).toBe(true);
    expect(
      commonColorDesign([undefined, { harmony: "triadic" }])
    ).toBeUndefined();
    expect(
      colorDesignsConflict(
        { harmony: "analogous" },
        { localHarmony: "complementary", localScale: "marks" }
      )
    ).toBe(false);
  });
});
