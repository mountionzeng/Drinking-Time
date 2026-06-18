import { describe, expect, it } from "vitest";

import { composePromptFromAnalysis, composeScenePrompt } from "./composeScenePrompt";
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
    intent: "让招聘者看见她能在压力下做决定",
    rationale: "这一镜用窗边停顿解释她为什么从犹豫转向行动",
    ...overrides,
  };
}

describe("composeScenePrompt rationale", () => {
  it("preserves intent/rationale as siblings without injecting rationale into prompt", () => {
    const composed = composeScenePrompt(analysis());

    expect(composed.prompt).toContain("小林站在厨房窗边");
    expect(composed.intent).toBe("让招聘者看见她能在压力下做决定");
    expect(composed.rationale).toBe("这一镜用窗边停顿解释她为什么从犹豫转向行动");
    expect(composed.prompt).not.toContain("招聘者");
    expect(composed.prompt).not.toContain("为什么");
  });

  it("omits blank rationale fields and keeps the legacy string API stable", () => {
    const input = analysis({ intent: " ", rationale: null });

    expect(composeScenePrompt(input)).toEqual({
      prompt: composePromptFromAnalysis(input),
    });
  });
});
