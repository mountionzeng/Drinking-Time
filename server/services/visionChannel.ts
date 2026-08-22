/**
 * 通用视觉模型通道：一次对话、多张图、期望 JSON 回复。
 * 走 orchestrator 的 vision use case，优先 OpenAI Next，未配置时回退 302，
 * 但做成可复用的多图入口，供一致性质检等批量场景使用。
 * 两个通道都未配置时由调用方走 visionChannelConfigured() 优雅降级，不在这里兜底。
 */
import { ENV } from "../_core/env";
import { resolveComputeCandidates } from "../_core/textComputeProvider";
import { runInference } from "../_core/inferenceOrchestrator";
import type { Message } from "../_core/llm";

function visionCandidateOptions() {
  return {
    fallback302Model: ENV.vision302Model,
    fallback302ApiKey: ENV.vision302ApiKey,
    fallback302BaseUrl: ENV.vision302BaseUrl,
  };
}

export function visionChannelConfigured(): boolean {
  return resolveComputeCandidates("vision", visionCandidateOptions()).length > 0;
}

export async function invokeVisionJson(params: {
  system: string;
  userText: string;
  imageUrls: string[];
  maxTokens?: number;
  timeoutMs?: number;
  attemptTimeoutMs?: number;
}): Promise<{ text: string; modelLabel: string }> {
  if (!visionChannelConfigured()) {
    throw new Error(
      "视觉通道未配置：需要 OPENAI_NEXT_API_KEY，或 VISION_302_MODEL 与 302 Key"
    );
  }
  if (params.imageUrls.length === 0) {
    throw new Error("至少需要一张图片");
  }

  const messages: Message[] = [
    { role: "system", content: params.system },
    {
      role: "user",
      content: [
        { type: "text", text: params.userText },
        ...params.imageUrls.map(url => ({
          type: "image_url" as const,
          image_url: { url, detail: "high" as const },
        })),
      ],
    },
  ];

  const outcome = await runInference({
    useCase: "vision",
    messages,
    candidates: visionCandidateOptions(),
    // 视觉模型多为 thinking 系（如 gemini-3-pro-preview），思考也消耗
    // completion 预算：给太少会把正式回答截成空串。
    maxTokens: params.maxTokens ?? 4000,
    deadlineMs: params.timeoutMs ?? 45_000,
    attemptTimeoutMs: params.attemptTimeoutMs,
    // 图片一致性质检是纯读取分析，没有工具调用也没有业务写入，可以安全重发。
    replaySafe: true,
  });

  const content = outcome.result.choices[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map(part => (part.type === "text" ? (part.text ?? "") : ""))
            .filter(Boolean)
            .join("\n")
        : "";
  if (!text.trim()) {
    const finishReason = outcome.result.choices[0]?.finish_reason;
    throw new Error(
      `视觉模型返回空内容${finishReason === "length" ? "（thinking 耗尽 max_tokens，需调大预算）" : finishReason ? `（finish_reason=${finishReason}）` : ""}`
    );
  }
  return { text, modelLabel: outcome.result.model || outcome.model };
}
