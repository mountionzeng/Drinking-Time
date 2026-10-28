import { describe, expect, it } from "vitest";
import type { TextDraftRequest } from "../../shared/textDraftHistory";
import { compileTextDraftPrompt } from "./textDraftPrompt";

describe("exploratory text generation", () => {
  const request: TextDraftRequest = {
    storyId: 1,
    operationToken: "exploration-test",
    expectedRevision: 0,
    platform: "xiaohongshu",
    parentId: "previous",
    basis: { title: "那件事", body: "我终于原谅了他。", tags: [] },
    messages: [
      { id: "m1", role: "user", content: "不是原谅，我只是不再等他的解释。" },
    ],
    instruction: "根据我刚说的重新整理。",
    source: "own",
  };

  it("uses the previous draft and correction without forcing another interview or a conclusion", () => {
    const { systemPrompt, modelMessage } = compileTextDraftPrompt(
      request,
      request.messages,
      []
    );
    expect(systemPrompt).toContain("【共同探索 · 硬性原则】");
    expect(systemPrompt).toContain("用户明确的新感悟、纠正和当前要求优先");
    expect(systemPrompt).toContain("保留尚未想清楚、矛盾或变化中的感受");
    expect(systemPrompt).toContain("当前是用户主动发起的生成");
    expect(systemPrompt).toContain("不要把正文写成问答记录");
    expect(systemPrompt).toContain("完整正文");
    expect(JSON.parse(modelMessage)).toMatchObject({
      basis: request.basis,
      conversationDelta: request.messages,
      instruction: request.instruction,
    });
  });

  it("keeps selection-only and selected-memory boundaries above exploratory suggestions", () => {
    const { systemPrompt } = compileTextDraftPrompt(
      { ...request, selection: { start: 0, end: 3 } },
      [],
      [],
      [],
      "",
      []
    );
    expect(systemPrompt).toContain("【共同探索 · 硬性原则】");
    expect(systemPrompt).toContain("不扩大当前素材或选区范围");
    expect(systemPrompt).toContain("draft.body 只返回选区的新文字");
    expect(systemPrompt).toContain("不得补入未选择的聊天、旧稿或其他记忆");
    expect(systemPrompt).toContain("只输出 JSON");
  });

  it("carries observation lenses but cannot invent a conclusion or turn generation into coaching", () => {
    const { systemPrompt, modelMessage } = compileTextDraftPrompt(
      {
        ...request,
        basis: { title: "面试之后", body: "刚参加了一场面试。", tags: [] },
        messages: [{ id: "m2", role: "user", content: "还不知道想不想去这家公司。" }],
        instruction: "先把没想清楚的这一点写下来。",
      },
      [{ id: "m2", role: "user", content: "还不知道想不想去这家公司。" }],
      []
    );
    expect(systemPrompt).toContain("不再开启素材问答");
    expect(systemPrompt).toContain("不能把探索中的问题、备选解释或文学观察角度写成用户已得出的结论");
    expect(systemPrompt).toContain("不为凑篇幅");
    expect(systemPrompt).not.toContain("【从经历到处境，再到表达】");
    const context = JSON.parse(modelMessage);
    expect(context.techniques.every((card: { perspective?: string }) => card.perspective)).toBe(true);
    expect(context.conversationDelta[0].content).toBe("还不知道想不想去这家公司。");
  });
});
