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
import { resolveComputeCandidates } from "./textComputeProvider";

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

function claudeCandidate(): InferenceCandidate | null {
  const endpointUrl = resolveClaudeUrl();
  if (!endpointUrl) return null;
  const model = ENV.dropZoneModel || ENV.llmModel;
  return {
    id: "302",
    label: "302",
    apiKey: ENV.forgeApiKey,
    baseUrl: endpointUrl,
    chatCompletionsUrl: endpointUrl,
    endpointUrl,
    protocol: "claude-messages",
    model,
  };
}

/**
 * 故事 Agent 的候选链：OpenAI Next 打头，配置了的话 Claude Messages 兜底。
 *
 * 顺序是这次改动的全部要点。Claude 通道打在 302 网关上，而那条链路的 TLS
 * 会中途断开，于是每一轮回话和意图识别都退到本地兜底——用户看到的「切换
 * 意图很不顺畅」其实是模型压根没被调用到。
 */
function storyAgentCandidates(): InferenceCandidate[] {
  const chain: InferenceCandidate[] = [];

  // fallback302Model 留空 = 只取 Next，302 的 chat/completions 不进这条链；
  // 这条链上的降级对象是下面的 Claude 通道。
  for (const candidate of resolveComputeCandidates("text", {
    fallback302Model: "",
  })) {
    if (candidate.id === "openai-next") {
      chain.push({ ...candidate, protocol: "openai-compatible" });
    }
  }

  const claude = claudeCandidate();
  if (claude) chain.push(claude);

  return chain;
}

async function invokeViaStoryAgentChain(
  messages: Message[],
  maxTokens: number,
  responseFormat?: ResponseFormat,
): Promise<{ text: string; modelLabel: string }> {
  const chain = storyAgentCandidates();
  if (chain.length === 0) {
    throw new Error("Claude messages endpoint is not configured");
  }

  const outcome = await runInference({
    useCase: "text",
    messages,
    maxTokens,
    // Claude Messages 没有 response_format，adapter 会忽略它；Next 承接时
    // 则真正用得上，JSON 模式因此从「靠 prompt 约定」变成协议级保证。
    responseFormat,
    candidates: { fallback302Model: "" },
    explicitCandidates: chain,
    // 故事回复是纯文本生成，没有工具调用也没有副作用，可以安全重发。
    replaySafe: true,
  });

  const content = outcome.result.choices[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map(c => (c.type === "text" ? c.text : ""))
            .filter(Boolean)
            .join("\n")
        : "";

  return { text, modelLabel: outcome.result.model || outcome.model };
}

export async function invokeAgent(
  messages: Message[],
  maxTokens: number,
  responseFormat?: ResponseFormat, // 透传给 OpenAI 兼容通道（如 { type: "json_object" }）；Claude 通道会忽略
): Promise<{ text: string; modelLabel: string }> {
  if (shouldUseClaudeChannel()) {
    return invokeViaStoryAgentChain(messages, maxTokens, responseFormat);
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
