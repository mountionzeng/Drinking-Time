import { describe, expect, it } from "vitest";

import { composePromptFromAnalysis } from "./composeScenePrompt";
import type { SceneAnalysis } from "../../shared/sceneAnalysis";

function analysis(overrides: Partial<SceneAnalysis> = {}): SceneAnalysis {
  return {
    subjectDescription: "小林站在厨房窗边",
    isPerson: true,
    recurringCharacter: { key: "xiaolin", name: "小林" },
    action: "低头读一封信",
    emotion: "安静但有一点紧张",
    keyElements: ["厨房窗边", "白色衬衫", "晨光"],
    needsCharacterAnchor: true,
    confidence: 100,
    ...overrides,
  };
}

describe("composePromptFromAnalysis", () => {
  it("needsCharacterAnchor=true → prompt 含人物主体与反复角色", () => {
    const prompt = composePromptFromAnalysis(analysis(), {
      styleHint: "delicate watercolor",
    });

    expect(prompt).toContain("小林站在厨房窗边");
    expect(prompt).toContain("recurring character: 小林");
    expect(prompt).toContain("白色衬衫");
    expect(prompt).toContain("delicate watercolor");
  });

  it("isPerson=false → 空镜 prompt 明确无人物", () => {
    const prompt = composePromptFromAnalysis(
      analysis({
        subjectDescription: "雨后的窄巷积水反光",
        isPerson: false,
        recurringCharacter: null,
        action: "雨水沿屋檐落下",
        emotion: "清冷",
        keyElements: ["窄巷", "积水", "路灯倒影"],
        needsCharacterAnchor: false,
        confidence: 75,
      }),
    );

    expect(prompt).toContain("雨后的窄巷");
    expect(prompt).toContain("empty scene");
    expect(prompt).toContain("no people");
    expect(prompt).toContain("no faces");
    expect(prompt).not.toContain("recurring character");
  });

  it("一次性路人不需要人物锚点时仍不要求固定人物", () => {
    const prompt = composePromptFromAnalysis(
      analysis({
        subjectDescription: "雨中街角有一个模糊路人经过",
        isPerson: true,
        recurringCharacter: null,
        action: "路过街角",
        emotion: "疏离",
        keyElements: ["雨", "街角", "模糊路人"],
        needsCharacterAnchor: false,
        confidence: 75,
      }),
    );

    expect(prompt).toContain("show the described person only if they are central");
    expect(prompt).not.toContain("recurring character");
  });
});

