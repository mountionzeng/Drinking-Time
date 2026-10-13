import { describe, expect, it } from "vitest";
import { stripAssistantReasoning } from "./assistantReplyText";

describe("assistant reply text", () => {
  it("removes multiple multiline reasoning preambles", () => {
    expect(stripAssistantReasoning(" <THINK>private\nplanning</THINK>\n<thinking>more</thinking>\n建议先把逻辑连起来。"))
      .toBe("建议先把逻辑连起来。");
  });

  it("keeps incomplete reasoning out of the visible answer", () => {
    expect(stripAssistantReasoning("<think>unfinished" )).toBe("");
  });

  it("preserves ordinary prose, code and quoted tag examples", () => {
    for (const text of ["建议先把逻辑连起来。", "解释一下 <think> 标签。", "`<think>example</think>`"]) {
      expect(stripAssistantReasoning(text)).toBe(text);
    }
  });
});
