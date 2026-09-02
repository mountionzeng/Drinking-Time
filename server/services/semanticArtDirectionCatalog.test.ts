import { describe, expect, it } from "vitest";
import type { SemanticArtCard } from "../../shared/semanticArtDirection";
import { normalizeSemanticArtEvidence } from "./semanticEvidenceNormalizer";
import { selectSemanticArtDirection } from "./semanticArtDirectionCatalog";

const cards: SemanticArtCard[] = [
  {
    id: "pencil",
    version: "1",
    scope: "main",
    concepts: ["quiet-grief-memory", "dream-dissolve", "sparse-negative-space"],
    counterSignals: [],
    providerFragments: ["soft colored-pencil grain"],
    allowedAuxiliaryDimensions: ["edge-motion"],
    compatibleMainIds: [],
    forbiddenPurposes: ["product", "standard-view", "factual"],
    provenance: ["reviewed:test"],
  },
  {
    id: "memory",
    version: "1",
    scope: "main",
    concepts: ["memory", "intimate-interior"],
    counterSignals: [],
    providerFragments: ["layered opaque marks"],
    allowedAuxiliaryDimensions: [],
    compatibleMainIds: [],
    forbiddenPurposes: ["product"],
    provenance: ["reviewed:test"],
  },
  {
    id: "blur",
    version: "1",
    scope: "auxiliary",
    concepts: ["motion", "diffusion"],
    counterSignals: [],
    providerFragments: ["directional edge diffusion"],
    allowedAuxiliaryDimensions: ["edge-motion"],
    compatibleMainIds: ["pencil"],
    forbiddenPurposes: ["product", "standard-view", "factual"],
    provenance: ["reviewed:test"],
  },
];

describe("semantic art selector", () => {
  it("skips zero evidence and an ordinary conversation mentioning memory", () => {
    const zero = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        storyText: "两个人在室内聊天",
      }),
      purpose: "story-frame",
      cards,
    });
    expect(zero.main).toBeNull();
    expect(zero.reason).toBe("no_evidence");
    const near = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        storyText: "两个人在客厅谈起一段回忆",
      }),
      purpose: "story-frame",
      cards,
    });
    expect(near.main).toBeNull();
    expect(near.reason).toBe("low_confidence");
  });

  it("selects at most one main and compatible auxiliary", () => {
    const result = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        explicitDirection: "画面像消散的梦，大片留白",
        shotText: "人物奔跑，边缘出现弥散拖影",
      }),
      purpose: "story-frame",
      cards,
    });
    expect(result.main?.id).toBe("pencil");
    expect(result.auxiliary?.id).toBe("blur");
  });

  it("rejects an auxiliary without a compatible main", () => {
    const result = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        shotText: "人物奔跑，边缘弥散拖影",
      }),
      purpose: "story-frame",
      cards,
    });
    expect(result.main).toBeNull();
    expect(result.auxiliary).toBeNull();
    expect(result.reason).toBe("incompatible_auxiliary");
  });

  it("lets explicit negation veto a matching auxiliary", () => {
    const result = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        explicitDirection: "人物奔跑，但不要动态模糊",
      }),
      purpose: "story-frame",
      cards,
    });

    expect(result.auxiliary).toBeNull();
    expect(result.scores.blur).toBe(0);
  });

  it("applies a shot auxiliary against the persisted story main", () => {
    const result = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        shotText: "人物奔跑，边缘弥散拖影",
      }),
      purpose: "story-frame",
      cards,
      currentMainId: "pencil",
    });
    expect(result.main).toBeNull();
    expect(result.auxiliary?.id).toBe("blur");
    expect(result.reason).toBe("applied");
  });

  it("skips close-score ties and suppresses forbidden purposes", () => {
    const tied = cards.concat({ ...cards[0]!, id: "pencil-2" });
    const ambiguous = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        explicitDirection: "画面像消散的梦",
      }),
      purpose: "story-frame",
      cards: tied,
    });
    expect(ambiguous.main).toBeNull();
    expect(ambiguous.reason).toBe("ambiguous");
    const product = selectSemanticArtDirection({
      normalized: normalizeSemanticArtEvidence({
        explicitDirection: "画面像消散的梦，大片留白",
      }),
      purpose: "product",
      cards,
    });
    expect(product.main).toBeNull();
  });

  it("keeps internal provenance out of provider fragments", () => {
    expect(cards[0]!.provenance.join(" ")).toContain("reviewed");
    expect(cards[0]!.providerFragments.join(" ")).not.toMatch(
      /常玉|Seurat|吴冠中/
    );
  });
});
