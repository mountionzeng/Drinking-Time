import { ENV } from "../_core/env";
import { invokeAgent } from "../_core/agentChannel";
import type { ChatTurn, SummaryPayload } from "./storyAgent.types";

// ── 历史压缩 ──
// 当对话超过 12 轮时，把早期 turns 折叠成"导演工作笔记"，新的总结
// 会替换 priorSummary。前端把 summary + 最近 6 轮原文一起发给 chat 接口。
export async function summarizeHistory(params: {
  priorSummary?: string;
  turnsToAbsorb: ChatTurn[];
}): Promise<SummaryPayload | { error: string; configured: boolean; modelLabel: string }> {
  if (!ENV.forgeApiKey) {
    return {
      error: "本地未配置 LLM API Key，无法压缩历史。",
      configured: false,
      modelLabel: "未配置 API",
    };
  }

  const turns = (params.turnsToAbsorb ?? []).filter(t => t.content?.trim());
  if (turns.length === 0) {
    // 没东西可压时直接回上一份
    return {
      configured: true,
      modelLabel: ENV.llmModel,
      summary: params.priorSummary?.trim() || "",
    };
  }

  const transcript = turns
    .map(t => `${t.role === "user" ? "对方" : "导演"}：${t.content.trim()}`)
    .join("\n");

  const priorSummary = params.priorSummary?.trim() || "";

  const systemPrompt = [
    "你还是刚才那个朋友。你和对方已经聊过一段，对话开始走到比较深的位置了。",
    "为了之后接着聊时不丢线索，请把下面这段早期对话收拢成一份【只给你自己看的小记】，方便回头查。",
    "",
    "小记要求：",
    "- 每一句一个独立信息点，最多 6 句",
    "- 必须保留：对方提到过的具体人 / 事 / 地点；已经显形过的情感倾向；你之前在心里判过的状态（trait，如果有）；任何已经被收成故事素材的关键句",
    "- 不要抒情、不要替对方解释、不要复述完整对话",
    "- 用第二人称对自己写：「对方提过…」「你判过 ta 在防御」",
    priorSummary
      ? `- 已经有一份旧的小记，把下面新的对话内容并进去，输出**合并后**的一份新小记（不要分两段）：\n旧小记：\n${priorSummary}`
      : "",
    "",
    "【返回格式：纯文本，不要 JSON、不要 markdown 代码块、不要任何其他解释】",
  ]
    .filter(line => line !== "")
    .join("\n");

  const { text, modelLabel } = await invokeAgent(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ],
    700,
  );

  // 模型有时仍会包 ``` 或加引言，简单清理一下
  const cleaned = text
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/, "")
    .trim();

  if (!cleaned) {
    return {
      error: "压缩失败：模型返回为空。",
      configured: true,
      modelLabel,
    };
  }

  return {
    configured: true,
    modelLabel,
    summary: cleaned,
  };
}
