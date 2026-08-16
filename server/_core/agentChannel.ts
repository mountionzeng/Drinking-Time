/**
 * Intelligent LLM channel selection — Claude Messages vs OpenAI-compatible.
 *
 * Only `invokeAgent` is exported; the rest are module-private utilities.
 *
 * 网络执行、错误分类和重试全部由 `inferenceOrchestrator` 拥有。这里只负责
 * 「选哪条通道、怎么把结果读成文本」。
 */
import { ENV } from "./env";
import { invokeLLM, type Message, type ResponseFormat } from "./llm";
import {
  runInference,
  type InferenceCandidate,
} from "./inferenceOrchestrator";

function shouldUseClaudeChannel(): boolean {
  return Boolean(
    ENV.dropZoneModel?.startsWith("cc-") ||
      ENV.dropZoneApiUrl?.includes("/cc"),
  );
}

function resolveClaudeUrl(): string {
  const raw = (ENV.dropZoneApiUrl || ENV.forgeApiUrl || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/cc")) return `${normalized}/v1/messages`;
  return normalized;
}

function claudeCandidate(): InferenceCandidate {
  const endpointUrl = resolveClaudeUrl();
  const model = ENV.dropZoneModel || ENV.llmModel;
  return {
    id: "302",
    label: "302",
    apiKey: ENV.forgeApiKey,
    baseUrl: endpointUrl,
    chatCompletionsUrl: endpointUrl,
    endpointUrl,
    model,
  };
}

async function invokeViaClaudeChannel(
  messages: Message[],
  maxTokens: number,
): Promise<{ text: string; modelLabel: string }> {
  const candidate = claudeCandidate();
  if (!candidate.endpointUrl) {
    throw new Error("Claude messages endpoint is not configured");
  }

  const outcome = await runInference({
    useCase: "text",
    protocol: "claude-messages",
    messages,
    maxTokens,
    candidates: { fallback302Model: candidate.model },
    // 单候选链由 orchestrator 自动排成两次尝试，等价于收敛前
    // AGENT_RETRY_DELAYS_MS 的单次重试。U3 会在前面接上 OpenAI Next，
    // 届时这条链自然变成真正的跨供应商回退。
    explicitCandidates: [candidate],
    // 故事回复是纯文本生成，没有工具调用也没有副作用，可以安全重发。
    replaySafe: true,
  });

  const content = outcome.result.choices[0]?.message?.content;
  return {
    text: typeof content === "string" ? content : "",
    modelLabel: outcome.result.model || candidate.model,
  };
}

export async function invokeAgent(
  messages: Message[],
  maxTokens: number,
  responseFormat?: ResponseFormat, // 透传给 OpenAI 兼容通道（如 { type: "json_object" }）；Claude 通道会忽略
): Promise<{ text: string; modelLabel: string }> {
  if (shouldUseClaudeChannel()) {
    // Claude Messages API 没有 OpenAI 那套 response_format 参数，这里只能忽略它，
    // 改由 prompt 约定 + 上层「解析失败再重试」来保证 JSON（见 storyAgent.replyFromStoryAgent）。
    return invokeViaClaudeChannel(messages, maxTokens);
  }

  const result = await invokeLLM({
    messages,
    maxTokens,
    responseFormat,
    replaySafe: true,
  });

  const content = result.choices[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map(c => (c.type === "text" ? c.text : ""))
            .filter(Boolean)
            .join("\n")
        : "";

  // 优先报网关回报的实际模型——发生回退时它和配置里写的那个不是一回事。
  return { text, modelLabel: result.model || ENV.llmModel };
}
