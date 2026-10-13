import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({}));
vi.mock("./artRepository", () => ({
  artRepositoryPromptBlocks: vi.fn(async () => []),
}));
import { renderViaGate, engineerImagePrompt } from "./renderGate";
import { defaultArtRecipe } from "../../shared/artDirection";

describe("colour compilation boundaries", () => {
  it("colour-only chat corrections retain open composition diversity", async () => {
    const prompt = await engineerImagePrompt({ prompt: "小猫等我回家", intent: "互补但柔和", outputPurpose: "story-frame", candidateCompositionExploration: true, longPrompt: true });
    expect(prompt).toContain("【自动构图导演】");
    expect(prompt).toContain("【候选构图分叉】");
  });
  it("sends one controlled block and identical metadata to provider", async () => {
    let seen = "";
    await renderViaGate(
      { prompt: "红衣人物在庭院", intent: "互补但柔和", longPrompt: true },
      async (prompt, compiled) => {
        seen = prompt;
        expect(compiled.colorDesign?.harmony).toBe("complementary");
        expect(compiled.prompt).toBe(prompt);
        return "done";
      }
    );
    expect(seen.match(/【配色关系】/g)).toHaveLength(1);
    expect(seen).toContain("有限明暗差");
    expect(seen).toContain("红衣人物");
    expect(seen).not.toContain("蓝橙");
  });
  it("does not add methods to authored, preserved or identity-locked images", async () => {
    for (const protection of [
      { authoredBrief: true },
      { preservePrompt: true },
      { referencePolicy: "preserve-identity" as const },
      {
        lockedVisualAssets: {
          fingerprint: "test",
          kinds: ["style" as const],
          promptContract: "fixed",
        },
      },
    ]) {
      const result = await engineerImagePrompt({
        prompt: "原文",
        intent: "互补",
        ...protection,
      });
      expect(result).not.toContain("【配色关系】");
      if ("preservePrompt" in protection) expect(result).toBe("原文");
    }
  });
  it("keeps local corrections separate from global methods", async () => {
    const prompt = await engineerImagePrompt({
      prompt: "小猫在窗前",
      intent: "别这么居中，亮面移到侧边，颜色保留",
      artDirection: {
        ...defaultArtRecipe(),
        colorDesign: { harmony: "analogous", application: "dryLayers" },
        material: ["彩铅"],
      },
      longPrompt: true,
    });
    expect(prompt).toContain("【本镜头明暗安排】");
    expect(prompt).toContain("干性笔触薄层叠色");
    expect(prompt).not.toContain("【自动构图导演】");
  });
  it.each([false, true])(
    "protects latest corrections and hard rules near length limits (%s)",
    async longPrompt => {
      const result = await engineerImagePrompt({
        prompt: "内容事实。".repeat(longPrompt ? 2400 : 700),
        intent: "最新要求：保留红衣，互补但柔和",
        longPrompt,
      });
      expect(result).toContain("最新要求：保留红衣，互补但柔和");
      expect(result).toContain("【静态图片无字硬约束】");
      expect(result.length).toBeLessThanOrEqual(longPrompt ? 12000 : 3500);
      expect(result).not.toContain("【配色关系】");
    }
  );
});
