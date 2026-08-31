import { describe, expect, it } from "vitest";
import { normalizeSemanticArtEvidence } from "./semanticEvidenceNormalizer";

describe("semanticEvidenceNormalizer", () => {
  it("recognizes paraphrase and is deterministic", () => {
    const input = { explicitDirection: "画面要像逐渐消散的梦，空旷而克制" };
    const first = normalizeSemanticArtEvidence(input);
    const second = normalizeSemanticArtEvidence(input);
    expect(first).toEqual(second);
    expect(first.evidence.some(item => item.concept === "dream-dissolve" && item.polarity === "positive")).toBe(true);
    expect(first.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not promote negation, quotation, or another subject", () => {
    const normalized = normalizeSemanticArtEvidence({
      storyText: "我不要动态模糊。角色说：“这里像消散的梦”。参考图中的人喜欢大片留白。",
    });
    expect(normalized.evidence.filter(item => item.polarity === "positive")).toEqual([]);
    expect(normalized.evidence.find(item => item.concept === "diffusion")?.polarity).toBe("negative");
    expect(normalized.evidence.find(item => item.concept === "dream-dissolve")?.quoted).toBe(true);
  });
});
