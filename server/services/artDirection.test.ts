import { describe, expect, it } from "vitest";
import {
  buildArtCandidatePlans,
  buildArtCandidatePrompt,
} from "./artDirection";
import type { StyleEntry } from "./styleLibrary";

const styles: StyleEntry[] = Array.from({ length: 4 }, (_, index) => ({
  id: `named-style-${index}`,
  name: `具名流派 ${index}`,
  one_liner: "",
  status: "draft",
  style: ["illustration", `in the manner of Artist ${index}`],
  palette: [`色盘 ${index}`],
  light: `光线 ${index}`,
  composition: `构图 ${index}`,
  material: `材质 ${index}`,
  era_culture: `年代 ${index}`,
  signature: `签名 ${index}`,
  negative: ["拼图"],
  emotion_fit: [],
  theme_fit: [],
  affinity: { age: {}, profession: {}, wuxing: {} },
  references: [],
  notes: "",
}));

describe("art direction candidate planning", () => {
  it("creates four full directions and two single-factor comparisons", () => {
    const plans = buildArtCandidatePlans({
      targetContent: "清晨窗边的小草开花",
      references: [],
      round: 1,
      styles,
    });

    expect(plans).toHaveLength(6);
    expect(plans.filter(plan => plan.role === "direction")).toHaveLength(4);
    expect(plans.filter(plan => plan.role === "comparison")).toHaveLength(2);
    expect(plans.every(plan => plan.recipe.negative.includes("多格拼图"))).toBe(true);
  });

  it("keeps story content fixed and forbids composite outputs", () => {
    const [plan] = buildArtCandidatePlans({
      targetContent: "同一个人练八段锦",
      references: [],
      round: 1,
      styles,
    });
    const prompt = buildArtCandidatePrompt({
      targetContent: "同一个人练八段锦",
      references: [],
      plan,
    });

    expect(prompt).toContain("同一个故事瞬间");
    expect(prompt).toContain("禁止多格漫画、九宫格、分镜表、拼图");
    expect(prompt).toContain("同一个人练八段锦");
    expect(plan.recipe.style.join(" ")).not.toContain("Artist");
  });
});
