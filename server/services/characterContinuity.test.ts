import { describe, expect, it } from "vitest";
import {
  buildCharacterContinuityBlock,
  withCharacterContinuityPrompt,
} from "./characterContinuity";

describe("characterContinuity", () => {
  it("builds a stable character bible from story characters", () => {
    const prompt = withCharacterContinuityPrompt("主角走进雨夜", {
      characters: [
        { name: "小林", role: "主角", oneLiner: "短发，深色外套，总是背着旧包" },
      ],
    });

    expect(prompt).toContain("Character continuity across all generated shots");
    expect(prompt).toContain("小林, 主角: 短发，深色外套，总是背着旧包");
    expect(prompt).toContain("Preserve face shape");
    expect(prompt).toContain("hairstyle");
    expect(prompt).toContain("outfit silhouette");
  });

  it("uses the character reference image as identity source when present", () => {
    const block = buildCharacterContinuityBlock({
      body: { characters: [] },
      hasCharacterReference: true,
    });

    expect(block).toContain("story character reference image");
    expect(block).toContain("source of truth");
  });

  it("does not add a block when the story has no character signal", () => {
    expect(withCharacterContinuityPrompt("雨后的空巷", { characters: [] })).toBe("雨后的空巷");
  });

  it("keeps empty-scene prompts from inventing the recurring person", () => {
    const prompt = withCharacterContinuityPrompt(
      "雨后的空巷",
      { characters: [{ name: "小林", role: "主角", oneLiner: "短发" }] },
      {
        sceneAnalysis: {
          subjectDescription: "雨后的空巷",
          isPerson: false,
          recurringCharacter: null,
          action: "积水反射路灯",
          emotion: "清冷",
          keyElements: ["空巷", "积水"],
          needsCharacterAnchor: false,
          confidence: 80,
        },
      }
    );

    expect(prompt).toContain("do not introduce the recurring person");
  });
});
