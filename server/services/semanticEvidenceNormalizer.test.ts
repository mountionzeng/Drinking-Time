import { describe, expect, it } from "vitest";
import { normalizeSemanticArtEvidence } from "./semanticEvidenceNormalizer";

describe("semanticEvidenceNormalizer", () => {
  it("recognizes paraphrase and is deterministic", () => {
    const input = { explicitDirection: "画面要像逐渐消散的梦，空旷而克制" };
    const first = normalizeSemanticArtEvidence(input);
    const second = normalizeSemanticArtEvidence(input);
    expect(first).toEqual(second);
    expect(
      first.evidence.some(
        item =>
          item.concept === "dream-dissolve" && item.polarity === "positive"
      )
    ).toBe(true);
    expect(first.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not promote negation, quotation, or another subject", () => {
    const normalized = normalizeSemanticArtEvidence({
      currentEmotion: "我已经不焦虑了，只是释然",
      storyText:
        "我不要动态模糊。角色说：“这里像消散的梦”。参考图中的人喜欢大片留白。",
    });
    expect(
      normalized.evidence.find(item => item.concept === "anxiety-pressure")
        ?.polarity
    ).toBe("negative");
    expect(
      normalized.evidence.find(item => item.concept === "diffusion")?.polarity
    ).toBe("negative");
    expect(
      normalized.evidence.find(item => item.concept === "dream-dissolve")
        ?.quoted
    ).toBe(true);
  });

  it("treats only the current emotion as strong mood evidence", () => {
    const normalized = normalizeSemanticArtEvidence({
      currentEmotion: "离开校园以后有些释然，想重新开始",
      storyText: "她刚刚毕业，正在收拾房间",
    });

    expect(normalized.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concept: "quiet-reflection",
          source: "current-emotion",
          weight: 2,
          polarity: "positive",
        }),
        expect.objectContaining({
          concept: "life-transition",
          source: "current-emotion",
          weight: 2,
          polarity: "positive",
        }),
      ])
    );
  });

  it("recognizes named references internally but does not turn age alone into style evidence", () => {
    const named = normalizeSemanticArtEvidence({
      explicitDirection: "参考常玉、Georges Seurat 和吴冠中的视觉语言",
    });
    expect(named.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          concept: "modernist-lines",
          source: "explicit-direction",
          weight: 3,
        }),
      ])
    );

    const ageOnly = normalizeSemanticArtEvidence({
      storyText: "我今年四十二岁",
    });
    expect(ageOnly.evidence).toEqual([]);
  });
});
