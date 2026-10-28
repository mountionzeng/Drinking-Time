import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./storyAgent.prompts";
import { WRITING_EXPLORATION_CONTEXT } from "../services/writingTechniqueLibrary";

describe("story agent intent modes", () => {
  it.each([0, 1, 4])(
    "can explore a situation without waiting for a material quota (%s cards)",
    count => {
      const prompt = buildAgentSystemPrompt(count, 2);
      expect(prompt).toContain(WRITING_EXPLORATION_CONTEXT);
      expect(prompt).not.toContain("等卡片到 4 份及以上");
      expect(prompt).toContain("不是每轮默认的结束语");
    }
  );

  it("explores with the user instead of requiring a question-answer loop", () => {
    const prompt = buildAgentSystemPrompt(0, 1);
    expect(prompt).toContain("【共同探索 · 硬性原则】");
    expect(prompt).toContain("不是固定的一问一答或问卷");
    expect(prompt).toContain("不要求每轮都提问");
    expect(prompt).toContain("没有顺着回答、沉默或换话题不代表认可");
    expect(prompt).toContain("用户明确的新感悟、纠正和当前要求优先");
    expect(prompt).toContain("明确要求就直接推进");
  });

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
    expect(prompt).toContain(WRITING_EXPLORATION_CONTEXT);
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
    expect(prompt).not.toContain(WRITING_EXPLORATION_CONTEXT);
    expect(prompt).not.toContain(
      "这些对话会直接成为 Storyboard 表格的生成来源"
    );
  });

  it.each(["linkedin_job_search", "fiction", "social_post"] as const)(
    "does not insert personal-situation coaching into explicit %s production",
    purpose => {
      const prompt = buildAgentSystemPrompt(
        0, 1, undefined, undefined, undefined, undefined, false, false,
        { purpose, audience: "public", platform: "short_video", desiredEffect: "讲清故事", tone: "自然" }
      );
      expect(prompt).not.toContain(WRITING_EXPLORATION_CONTEXT);
    }
  );

  it("keeps an explicit editing context out of personal-situation coaching", () => {
    const prompt = buildAgentSystemPrompt(
      1, 2, undefined, undefined, undefined, "只讨论选中镜头的剪辑与节奏"
    );
    expect(prompt).not.toContain(WRITING_EXPLORATION_CONTEXT);
    expect(prompt).toContain("只讨论选中镜头的剪辑与节奏");
  });
});
