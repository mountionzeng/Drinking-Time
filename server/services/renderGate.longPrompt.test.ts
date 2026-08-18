import { describe, expect, it } from "vitest";

import { engineerImagePrompt } from "./renderGate";

const WARDROBE_TAIL =
  "裙摆是平直硬边、水平切过并落到地面，完全盖住小腿和脚踝，最多只在正中露出一只裸足的脚尖。";

/** 复现界面实跑时的形状：参考图清单 + 用户指令 + 连续性规格，一整段超过 1800 字。 */
function longInstruction(): string {
  return [
    "参考图清单（按顺序对应发给你的图片）：",
    "图1＝当前镜头 0201。".padEnd(700, "环"),
    "本次对话修改（最高优先级，必须实际应用）：女主在该环境下旋转".padEnd(
      700,
      "改"
    ),
    "【连续性规格】".padEnd(700, "白"),
    WARDROBE_TAIL,
  ].join("\n");
}

describe("renderGate prompt budget", () => {
  it("MJ 路径仍然受 1800 字要求预算约束", async () => {
    const prompt = await engineerImagePrompt({
      prompt: "0201",
      userInstructions: [longInstruction()],
    });
    expect(prompt).not.toContain(WARDROBE_TAIL);
  });

  it("gpt-image 路径不再把连续性规格截掉", async () => {
    // 界面实跑时正是这里翻的车：模型收到的是半句「【连」。
    const prompt = await engineerImagePrompt({
      prompt: "0201",
      userInstructions: [longInstruction()],
      longPrompt: true,
    });
    expect(prompt).toContain(WARDROBE_TAIL);
  });
});
