import { describe, expect, it } from "vitest";

import { analyzeScene } from "./sceneAnalysis";

describe("analyzeScene", () => {
  it("明确反复出镜人物 → 需要人物锚点", async () => {
    const result = await analyzeScene({
      history: [
        { role: "user", content: "小林每天下班后都去窗边照顾那盆薄荷。" },
        { role: "assistant", content: "这个角色会贯穿整条故事。" },
      ],
      cardHint: "小林在厨房窗边照顾薄荷，神情安静。",
      invoker: async () => ({
        subjectDescription: "小林在厨房窗边照顾薄荷",
        isPerson: true,
        recurringCharacter: { key: "xiaolin", name: "小林" },
        action: "照顾薄荷",
        emotion: "安静、专注",
        keyElements: ["厨房窗边", "薄荷", "晨光"],
        needsCharacterAnchor: true,
        confidence: 100,
      }),
    });

    expect(result.isPerson).toBe(true);
    expect(result.recurringCharacter).toEqual({ key: "xiaolin", name: "小林" });
    expect(result.needsCharacterAnchor).toBe(true);
  });

  it("纯环境/物件 → 不需要人物锚点", async () => {
    const result = await analyzeScene({
      cardHint: "雨后的窄巷，地面积水反射灯光，没有人物。",
      invoker: async () => ({
        subjectDescription: "雨后窄巷的积水和灯光",
        isPerson: false,
        recurringCharacter: null,
        action: "雨水落在巷子里",
        emotion: "清冷",
        keyElements: ["窄巷", "积水", "灯光倒影"],
        needsCharacterAnchor: false,
        confidence: 100,
      }),
    });

    expect(result.isPerson).toBe(false);
    expect(result.recurringCharacter).toBeNull();
    expect(result.needsCharacterAnchor).toBe(false);
  });

  it("一次性路人 → 不需要人物锚点", async () => {
    const result = await analyzeScene({
      history: [{ role: "user", content: "背景里路过一个陌生人就好。" }],
      invoker: async () => ({
        subjectDescription: "雨中街角有一个模糊路人经过",
        isPerson: true,
        recurringCharacter: null,
        action: "路过街角",
        emotion: "疏离",
        keyElements: ["雨", "街角", "模糊路人"],
        needsCharacterAnchor: false,
        confidence: 75,
      }),
    });

    expect(result.isPerson).toBe(true);
    expect(result.recurringCharacter).toBeNull();
    expect(result.needsCharacterAnchor).toBe(false);
  });

  it("history 为空但有 cardHint → 从 cardHint 产出主体", async () => {
    const result = await analyzeScene({
      history: [],
      cardHint: "一只黄色杯子放在蓝白格布旁，午后阳光照进来。",
      invoker: async (messages) => {
        expect(messages[1].content).toContain("黄色杯子");
        return {
          subjectDescription: "午后阳光里的黄色杯子",
          isPerson: false,
          recurringCharacter: null,
          action: "静置在桌面上",
          emotion: "温暖",
          keyElements: ["黄色杯子", "蓝白格布", "午后阳光"],
          needsCharacterAnchor: false,
          confidence: 75,
        };
      },
    });

    expect(result.subjectDescription).toContain("黄色杯子");
    expect(result.keyElements).toContain("蓝白格布");
  });

  it("分类边界模糊 → 返回较低 confidence", async () => {
    const result = await analyzeScene({
      history: [{ role: "user", content: "好像是某个人的背影，也可以只是空房间。" }],
      invoker: async () => ({
        subjectDescription: "房间门口似乎有一个背影",
        isPerson: true,
        recurringCharacter: null,
        action: "停在门口",
        emotion: "犹豫",
        keyElements: ["门口", "背影", "空房间"],
        needsCharacterAnchor: false,
        confidence: 25,
      }),
    });

    expect(result.confidence).toBeLessThanOrEqual(50);
    expect(result.needsCharacterAnchor).toBe(false);
  });

  it("LLM 返回不合 schema → 抛明确错误，不返回半成品", async () => {
    await expect(
      analyzeScene({
        cardHint: "小林在窗边。",
        invoker: async () => ({
          subjectDescription: "小林在窗边",
          isPerson: true,
        }),
      }),
    ).rejects.toThrow(/SceneAnalysis schema mismatch/);
  });
});

