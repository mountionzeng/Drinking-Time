import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";

// ── 选中编辑（行内选区编辑）──────────────────────────────────

/** 对文本中选中片段执行 AI 编辑指令，返回替换后的完整文本 */
export async function handleSelectionEdit(params: {
  fullText: string;
  selectedText: string;
  instruction: string;
  projectId?: number;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ isApprovalOnly: boolean; modifiedFullText: string; reply: string }> {
  const systemPrompt = `你是一位文字编辑助手。用户会给你一段完整文本和其中被选中的片段，以及一条编辑指令。
请只修改选中的部分，保持其余文字不变，返回修改后的完整文本。

要求：
1. 仅修改选中片段，上下文保持一致
2. 遵循用户的编辑指令
3. 如果指令是确认/赞同性质的（如"好的"、"不错"），不做修改，isApprovalOnly 设为 true
4. 返回 JSON 格式：{"isApprovalOnly":false,"modifiedFullText":"修改后的完整文本","reply":"简短说明做了什么改动"}`;

  const userMessage = `完整文本：
---
${params.fullText}
---

选中片段：
---
${params.selectedText}
---

编辑指令：${params.instruction}`;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...(params.history ?? []).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userMessage },
  ];

  const result = await invokeAgent(messages, 2048);
  const parsed = parseJsonLoose<{ isApprovalOnly: boolean; modifiedFullText: string; reply: string }>(result.text);
  if (parsed && typeof parsed.modifiedFullText === "string") {
    return parsed;
  }
  // 解析失败时回退：直接返回原文
  return { isApprovalOnly: false, modifiedFullText: params.fullText, reply: "未能解析 AI 返回结果，保留原文" };
}
