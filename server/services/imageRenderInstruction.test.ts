import { describe, expect, it } from "vitest";

import {
  applyExplicitImageRenderInstruction,
  applyStoryFrameVisualTruth,
} from "./imageRenderInstruction";

describe("applyExplicitImageRenderInstruction", () => {
  it("keeps the user's exact wording and marks it as mandatory", () => {
    const instruction = "把背景调亮一点，人物、发型和已有物体都不要变。";
    const prompt = applyExplicitImageRenderInstruction(
      "Established SheSelf visual language.",
      instruction
    );

    expect(prompt).toContain(instruction);
    expect(prompt).toContain("HIGHEST PRIORITY");
    expect(prompt).toContain("not a weighted suggestion");
    expect(prompt).toContain("Established SheSelf visual language.");
  });

  it("trims inherited context before truncating the explicit instruction", () => {
    const instruction = "只把门打开，其他内容完全不变。";
    const prompt = applyExplicitImageRenderInstruction(
      "x".repeat(5_000),
      instruction,
      600
    );

    expect(prompt.length).toBeLessThanOrEqual(600);
    expect(prompt).toContain(instruction);
    expect(prompt.endsWith("x")).toBe(true);
  });

  it("returns the existing prompt when no explicit instruction is present", () => {
    expect(
      applyExplicitImageRenderInstruction("  existing prompt  ", " ")
    ).toBe("existing prompt");
  });

  it("makes supplied storyboard frames outrank unrelated art-library context", () => {
    const prompt = applyStoryFrameVisualTruth(
      "Scene art library: unrelated blindfolded horror portrait."
    );

    expect(prompt).toContain(
      "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH"
    );
    expect(prompt).toContain(
      "Ignore any art-library element that conflicts with"
    );
    expect(prompt).toContain(
      "Scene art library: unrelated blindfolded horror portrait."
    );
    expect(prompt).toContain("NO NEW ACCESSORIES");
    expect(prompt).toContain("sunglasses");
    expect(prompt).toContain("exact clothing construction");
    expect(prompt).toContain("GARMENT LENGTH IS IDENTITY");
    expect(prompt).toContain("Never shorten it");
    expect(prompt).toContain("PRIMARY PALETTE LOCK");
    expect(prompt).toContain("blue, cyan, teal");
  });

  it("preserves a candidate camera direction when the inherited prompt is long", () => {
    const candidateDirection = [
      "CANDIDATE TAKE 2 OF 4:",
      "Physically move the camera to a clearly different three-quarter side.",
      "Do not simulate this alternative by merely zooming, cropping, resizing, or translating the same camera angle.",
    ].join("\n");
    const prompt = applyStoryFrameVisualTruth(
      applyExplicitImageRenderInstruction(
        "inherited context ".repeat(500),
        candidateDirection
      )
    );

    expect(prompt.length).toBeLessThanOrEqual(3_400);
    expect(prompt).toContain("CANDIDATE TAKE 2 OF 4");
    expect(prompt).toContain(
      "Do not simulate this alternative by merely zooming"
    );
  });
});
