import { describe, expect, it } from "vitest";

import { applyExplicitImageRenderInstruction } from "./imageRenderInstruction";

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
});
