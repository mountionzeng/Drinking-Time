import { describe, it, expect } from "vitest";
import {
  gatherResonantVoices,
  buildScriptResonanceContext,
  buildScriptResonanceContextForUser,
} from "./scriptAgent";
import { clearLiteratureLibraryCache } from "./literatureLibrary";

describe("scriptAgent —— 剧本侧消费共鸣信号 + 文学库", () => {
  it("gatherResonantVoices：按情绪信号取共鸣声音（含可注入片段）", () => {
    clearLiteratureLibraryCache();
    const voices = gatherResonantVoices({ emotion: ["苍凉"] }, 2);
    // 张爱玲 emotion_fit 含「苍凉」→ 排第一
    expect(voices[0].id).toBe("zhang-ailing");
    expect(voices[0].fragments.length).toBeGreaterThan(0);
    expect(voices[0].fragments.find((f) => f.tag === "观点")).toBeDefined();
  });

  it("buildScriptResonanceContext：空信号 → 空串（剧本行为不变）", () => {
    clearLiteratureLibraryCache();
    expect(buildScriptResonanceContext({})).toBe("");
  });

  it("buildScriptResonanceContext：有信号 → 含情绪描述 + 共鸣文学声音", () => {
    clearLiteratureLibraryCache();
    const ctx = buildScriptResonanceContext({ emotion: ["苍凉"] });
    expect(ctx).toContain("情绪：苍凉");
    expect(ctx).toContain("张爱玲");
    expect(ctx).toContain("不要照抄");
  });

  it("buildScriptResonanceContextForUser：无画像也能从卡片情绪组出共鸣上下文，且不抛错", async () => {
    clearLiteratureLibraryCache();
    // 测试库为内存模式（无该用户画像）→ 只靠卡片情绪
    const ctx = await buildScriptResonanceContextForUser(999999, ["苍凉"]);
    expect(ctx).toContain("张爱玲");
  });

  it("buildScriptResonanceContextForUser：无画像无情绪 → 空串", async () => {
    clearLiteratureLibraryCache();
    const ctx = await buildScriptResonanceContextForUser(999999, []);
    expect(ctx).toBe("");
  });
});
