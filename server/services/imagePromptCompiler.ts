import { ENV } from "../_core/env";
import { InferenceError, runInference } from "../_core/inferenceOrchestrator";
import type { Message } from "../_core/llm";

/** Short art-brief translation uses the existing image-prompt model, not the
 * general conversation model. Keep the shared admission and billing boundary. */
export async function invokeImagePromptCompiler(messages: Message[]) {
  const model = ENV.imagePrompt302Model.trim();
  if (!model) throw new Error("图片提示词模型未配置");
  const configuredTimeout = Number(ENV.imagePrompt302TimeoutMs);
  const deadlineMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.floor(configuredTimeout)
      : 30_000;
  const outcome = await runInference({
    useCase: "text",
    messages,
    candidates: {
      preferredNextModel: model,
      fallback302Model: model,
      fallback302ApiKey: ENV.api302Key,
      fallback302BaseUrl: ENV.api302BaseUrl,
    },
    maxTokens: 800,
    deadlineMs,
    // A text timeout can still have incurred a charge. Never silently replay.
    replaySafe: false,
    // A rejected 429 can use the existing fallback; uncertain submissions cannot.
    retryRejected: true,
  });
  const choice = outcome.result.choices[0];
  const content = choice?.message.content;
  const text = (
    typeof content === "string"
      ? content
      : (content
          ?.map(part => (part.type === "text" ? part.text : ""))
          .join("\n") ?? "")
  ).trim();
  if (!text || choice?.finish_reason === "length") {
    throw new Error("配图提示词未完整生成，本次未提交图片生成");
  }
  return { text, modelLabel: outcome.result.model || outcome.model };
}

export function imagePromptPreparationError(error: unknown): string {
  if (error instanceof InferenceError && error.category === "rate_limit") {
    return "配图文字服务当前繁忙，尚未提交出图，请稍后重试。";
  }
  const timeout =
    (error instanceof InferenceError && error.category === "timeout") ||
    (error instanceof Error && error.name === "TimeoutError");
  return timeout
    ? "配图文字准备超时，尚未提交出图，请稍后重试。"
    : "配图准备失败，尚未提交出图，请重试。";
}
