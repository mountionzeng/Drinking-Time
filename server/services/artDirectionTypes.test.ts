import { describe, expect, it } from "vitest";
import {
  artCandidatesNeedConvergence,
  deriveStoryArtRecipe,
  normalizeStoryArtDirection,
  type ArtDirectionCandidate,
} from "../../shared/artDirection";

function candidate(
  id: string,
  verdict: ArtDirectionCandidate["verdict"],
  style: string[],
  palette: string[],
): ArtDirectionCandidate {
  return {
    id,
    imageUrl: `https://example.com/${id}.jpg`,
    title: id,
    role: "direction",
    prompt: "",
    verdict,
    recipe: {
      style,
      palette,
      light: ["柔侧光"],
      composition: ["主体偏侧"],
      material: ["纸张颗粒"],
      negative: [],
    },
  };
}

describe("art direction recipe", () => {
  it("aggregates liked DNA and turns rejected-only traits into negatives", () => {
    const recipe = deriveStoryArtRecipe([
      candidate("a", "liked", ["平涂插画"], ["低饱和青绿"]),
      candidate("b", "liked", ["平涂插画"], ["低饱和青绿", "暖黄"]),
      candidate("c", "rejected", ["厚涂写实"], ["高饱和洋红"]),
    ], 2, 123);

    expect(recipe).toMatchObject({
      version: 3,
      style: ["平涂插画"],
      palette: expect.arrayContaining(["低饱和青绿", "暖黄"]),
      sourceCandidateIds: ["a", "b"],
      updatedAt: 123,
    });
    expect(recipe?.negative).toEqual(
      expect.arrayContaining(["厚涂写实", "高饱和洋红"]),
    );
  });

  it("detects visually distant liked candidates", () => {
    expect(
      artCandidatesNeedConvergence([
        candidate("a", "liked", ["水彩晕染"], ["暖土色"]),
        {
          ...candidate("b", "liked", ["几何平涂"], ["冷青蓝"]),
          recipe: {
            style: ["几何平涂"],
            palette: ["冷青蓝"],
            light: ["硬边顶光"],
            composition: ["对称构图"],
            material: ["丝网颗粒"],
            negative: [],
          },
        },
      ]),
    ).toBe(true);
  });

  it("normalizes missing persisted data safely", () => {
    expect(normalizeStoryArtDirection({ phase: "locked", recipe: { style: ["线描"] } }))
      .toMatchObject({
        phase: "locked",
        recipe: {
          style: ["线描"],
          palette: [],
          version: 1,
        },
      });
  });

  it("recovers an interrupted generating phase on reload", () => {
    expect(
      normalizeStoryArtDirection({
        phase: "generating",
        candidates: [],
      }).phase,
    ).toBe("references");
  });
});
