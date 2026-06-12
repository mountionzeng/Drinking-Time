import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeAgentMock = vi.fn();
vi.mock("../_core/agentChannel", () => ({
  invokeAgent: (...args: unknown[]) => invokeAgentMock(...args),
}));

import { runJsonAgent } from "./agentRuntime";

beforeEach(() => {
  invokeAgentMock.mockReset();
});

describe("runJsonAgent（对话 Agent 骨架）", () => {
  it("拼消息(system+过滤后的历史+user)，解析合法 JSON", async () => {
    invokeAgentMock.mockResolvedValue({ text: '{"reply":"hi"}', modelLabel: "m" });

    const res = await runJsonAgent<{ reply: string }>({
      systemPrompt: "SYS",
      message: "  你好  ",
      history: [
        { role: "user", content: " a " },
        { role: "assistant", content: "  " }, // 空内容应被过滤
      ],
      fallback: () => ({ reply: "fb" }),
    });

    expect(res.parsed).toEqual({ reply: "hi" });
    expect(res.modelLabel).toBe("m");

    const [messages, maxTokens] = invokeAgentMock.mock.calls[0];
    expect(maxTokens).toBe(800);
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    // 空内容历史被过滤、内容被 trim
    expect(messages).toContainEqual({ role: "user", content: "a" });
    expect(messages).not.toContainEqual({ role: "assistant", content: "" });
    // 末条是 trim 后的当前消息
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "你好" });
  });

  it("JSON 解析失败 → 用 fallback（拿到原始文本）", async () => {
    invokeAgentMock.mockResolvedValue({ text: "这不是 JSON", modelLabel: "m" });

    const res = await runJsonAgent<{ reply: string }>({
      systemPrompt: "S",
      message: "x",
      fallback: raw => ({ reply: `FB:${raw}` }),
    });

    expect(res.parsed).toEqual({ reply: "FB:这不是 JSON" });
  });

  it("maxTokens / historyLimit 可配", async () => {
    invokeAgentMock.mockResolvedValue({ text: "{}", modelLabel: "m" });
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }));

    await runJsonAgent({
      systemPrompt: "S",
      message: "x",
      history: longHistory,
      maxTokens: 1200,
      historyLimit: 3,
      fallback: () => ({}),
    });

    const [messages, maxTokens] = invokeAgentMock.mock.calls[0];
    expect(maxTokens).toBe(1200);
    // system + 最近 3 条历史 + user = 5
    expect(messages.length).toBe(5);
  });
});
