import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./storyAgent.prompts";

describe("story agent intent modes", () => {
  it("helps self-reflection understand experience without optimizing for outsiders", () => {
    const prompt = buildAgentSystemPrompt(
      0,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      false,
      {
        purpose: "self_reflection",
        audience: "self",
        platform: "private_archive",
        desiredEffect: "看清自己的选择和变化",
        tone: "坦诚、细腻",
      }
    );

    expect(prompt).toContain("【给自己讲的节奏】");
    expect(prompt).toContain("不按外部观众的注意力包装");
    expect(prompt).toContain("不要默认他已经要公开或说服别人");
    expect(prompt).not.toContain(
      "这些对话会直接成为 Storyboard 表格的生成来源"
    );
  });

  it("keeps raw records factual and does not push production", () => {
    const prompt = buildAgentSystemPrompt(
      0,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      false,
      {
        purpose: "raw_record",
        audience: "self",
        platform: "private_archive",
        desiredEffect: "先准确留下这件事",
        tone: "克制、纪实",
      }
    );

    expect(prompt).toContain("【记录再说的节奏】");
    expect(prompt).toContain("不要催他找主题、补冲突或解释意义");
    expect(prompt).toContain("不要把记录推进成 Storyboard、图片或视频");
    expect(prompt).not.toContain(
      "这些对话会直接成为 Storyboard 表格的生成来源"
    );
  });
});
