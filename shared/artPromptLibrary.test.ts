import { describe, expect, it } from "vitest";
import {
  artPromptLibraryItemsToLineageItems,
  artRecipeToLibraryItems,
  normalizeArtPromptLibraryImport,
} from "./artPromptLibrary";

describe("artPromptLibrary shared contract", () => {
  it("normalizes items, merges duplicate dimensions, and fingerprints content deterministically", () => {
    const first = normalizeArtPromptLibraryImport({
      name: " 写实记录 ",
      source: "obsidian://style-note",
      items: [
        { dimension: "lighting", content: " soft key light " },
        { dimension: "visual_style", content: "documentary realism" },
        { dimension: "visual_style", content: "soft film grain" },
        { dimension: "visual_style", content: "documentary realism" },
      ],
    });
    const second = normalizeArtPromptLibraryImport({
      name: "写实记录",
      source: "obsidian://style-note",
      items: [
        { dimension: "visual_style", content: "documentary realism" },
        { dimension: "visual_style", content: "soft film grain" },
        { dimension: "lighting", content: "soft key light" },
      ],
    });

    expect(first.items).toEqual([
      {
        dimension: "visual_style",
        content: "documentary realism\nsoft film grain",
        negativeContent: null,
        sortOrder: 0,
      },
      {
        dimension: "lighting",
        content: "soft key light",
        negativeContent: null,
        sortOrder: 1,
      },
    ]);
    expect(first.contentFingerprint).toBe(second.contentFingerprint);
  });

  it("turns a story art recipe into reusable library items", () => {
    const items = artRecipeToLibraryItems({
      style: ["premium commercial film"],
      palette: ["warm neutrals"],
      light: ["golden practical light"],
      composition: ["clean subject focus"],
      material: ["soft film grain"],
      negative: ["multi-panel"],
    });

    expect(items.map(item => item.dimension)).toEqual([
      "visual_style",
      "color_palette",
      "lighting",
      "composition",
      "material",
      "negative_prompt",
    ]);
  });

  it("projects item-level negative content into a lineage negative prompt", () => {
    const items = artPromptLibraryItemsToLineageItems([
      {
        dimension: "visual_style",
        content: "human-centered commercial realism",
        negativeContent: "split-screen, collage layout",
        sortOrder: 0,
      },
    ]);

    expect(items).toEqual([
      {
        dimension: "visual_style",
        content: "human-centered commercial realism",
        negativeContent: null,
        sortOrder: 0,
      },
      {
        dimension: "negative_prompt",
        content: "split-screen, collage layout",
        negativeContent: null,
        sortOrder: 1,
      },
    ]);
  });

  it("rejects empty libraries", () => {
    expect(() =>
      normalizeArtPromptLibraryImport({
        name: "空库",
        items: [{ dimension: "visual_style", content: " " }],
      }),
    ).toThrow("至少需要一个有效条目");
  });
});
