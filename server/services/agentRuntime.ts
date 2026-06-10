/**
 * 对话 Agent 运行时 —— 把每个对话型 Agent 重复的「拼消息 → invokeAgent → 宽松 JSON 解析 + 兜底」
 * 骨架收成一处。每个 Agent 只需给出自己的 system prompt、历史、用户消息、和解析失败时的兜底，
 * 不必再把这套样板抄一遍。
 *
 * 不含各 Agent 专属的：system prompt 构造、tool call 解析、未配置兜底（返回形各异，留在各 Agent）。
 */
import { invokeAgent } from "../_core/agentChannel";
import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";

export type AgentTurn = { role: "user" | "assistant"; content: string };

export type RunJsonAgentResult<T> = {
  parsed: T;
  modelLabel: string;
  rawText: string;
};

/**
 * 跑一轮「对话进 → JSON 出」的 Agent。
 *
 * @param opts.systemPrompt  该 Agent 的系统提示
 * @param opts.message       当前用户消息（自动 trim）
 * @param opts.history       历史对话（空内容自动过滤、内容 trim、只留最近 historyLimit 轮）
 * @param opts.maxTokens     默认 800
 * @param opts.historyLimit  保留最近多少轮，默认 12
 * @param opts.fallback      JSON 解析失败时的兜底（拿到原始文本，给一个安全的 parsed）
 */
export async function runJsonAgent<T>(opts: {
  systemPrompt: string;
  message: string;
  history?: AgentTurn[];
  maxTokens?: number;
  historyLimit?: number;
  fallback: (rawText: string) => T;
}): Promise<RunJsonAgentResult<T>> {
  const turns: Message[] = (opts.history ?? [])
    .filter((t) => t.content?.trim())
    .slice(-(opts.historyLimit ?? 12))
    .map((t) => ({ role: t.role, content: t.content.trim() }));

  const messages: Message[] = [
    { role: "system", content: opts.systemPrompt },
    ...turns,
    { role: "user", content: opts.message.trim() },
  ];

  const { text, modelLabel } = await invokeAgent(messages, opts.maxTokens ?? 800);

  let parsed: T;
  try {
    parsed = parseJsonLoose<T>(text);
  } catch {
    parsed = opts.fallback(text);
  }

  return { parsed, modelLabel, rawText: text };
}
