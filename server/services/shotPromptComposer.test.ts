import { describe, expect, it } from "vitest";
import { applyShotPromptComposition, composeShotPrompt, type ShotForPrompt } from "./shotPromptComposer";

function makeShot(overrides: Partial<ShotForPrompt>): ShotForPrompt {
  return {
    shotNo: 1,
    subject: "用户",
    action: "坐在厨房桌边",
    dialogue: "",
    shotType: "中",
    beat: "起势",
    cameraAngle: "",
    cameraMove: "",
    location: "厨房",
    timeLight: "傍晚",
    mood: "",
    sound: "",
    styleRef: "",
    note: "",
    emotion: "平静",
    sourceCardContent: "用户说这只是一个普通傍晚。",
    ...overrides,
  };
}

describe("shotPromptComposer", () => {
  it("让转折镜表达情绪转变本身，而不是静态悲伤", () => {
    const shots = applyShotPromptComposition(
      [
        makeShot({ shotNo: 1, beat: "开场", emotion: "暖" }),
        makeShot({ shotNo: 2, beat: "转折", emotion: "失落", action: "停在门口没有说话" }),
      ],
      { arc: "暖 → 失落" },
    );

    expect(shots[1].emotionDelta).toContain("转变：从「暖」向「失落」偏移");
    expect(shots[1].promptDraft).toContain("转折镜重点");
    expect(shots[1].promptDraft).toContain("表现情绪正在变化");
  });

  it("平淡延续的故事不被强行造转折", () => {
    const composition = composeShotPrompt({
      shot: makeShot({ shotNo: 2, beat: "起势", emotion: "平静" }),
      previousShot: makeShot({ shotNo: 1, beat: "开场", emotion: "平静" }),
      arc: "平静 → 平静",
    });

    expect(composition.emotionDelta).toContain("延续：平静");
    expect(composition.promptDraft).toContain("保持克制");
    expect(composition.promptDraft).not.toContain("转折镜重点");
  });

  it("同一个合成缝能接入视觉锚", () => {
    const composition = composeShotPrompt({
      shot: makeShot({ beat: "开场", emotion: "期待" }),
      visualAnchors: [
        {
          title: "旧照片",
          aesthetic: "颗粒感、温柔但有距离",
          visualStyle: ["胶片", "手持"],
          mood: ["怀旧"],
          colorPalette: ["奶油黄", "褪色绿"],
        },
      ],
    });

    expect(composition.visualAnchorText).toContain("旧照片");
    expect(composition.promptDraft).toContain("视觉锚");
    expect(composition.promptDraft).toContain("颗粒感");
  });
});
