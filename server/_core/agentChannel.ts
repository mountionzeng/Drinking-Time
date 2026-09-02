/** Story Agent compute routing: OpenAI Next first, 302 Claude fallback. */
import { ENV } from "./env";
import {
  classifyHttpStatus,
  InferenceAttemptError,
  runInferenceCandidates,
  type InferenceCandidate,
} from "./inferenceOrchestrator";
import {
  invokeLLM,
  type InvokeParams,
  type Message,
  type ResponseFormat,
} from "./llm";
import { resolveComputeCandidates } from "./textComputeProvider";

type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
};

export type ClaudeFallbackConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  label?: string;
};

function defaultClaudeFallback(): ClaudeFallbackConfig {
  return {
    apiUrl: ENV.dropZoneApiUrl || ENV.forgeApiUrl || "",
    apiKey: ENV.forgeApiKey,
    model: ENV.dropZoneModel || ENV.llmModel,
    label: "302 Claude",
  };
}

function hasClaudeFallback(config: ClaudeFallbackConfig): boolean {
  return Boolean(
    String(config.apiKey ?? "").trim() &&
      (config.model?.startsWith("cc-") || config.apiUrl?.includes("/cc"))
  );
}

function resolveClaudeUrl(config: ClaudeFallbackConfig): string {
  const raw = String(config.apiUrl ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/cc")) return `${normalized}/v1/messages`;
  return normalized;
}

function textContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    return content.type === "text" ? content.text : JSON.stringify(content);
  }
  return content
    .map(part => {
      if (typeof part === "string") return part;
      return part.type === "text" ? part.text : JSON.stringify(part);
    })
    .join("\n");
}

function toClaudeContent(content: Message["content"]): unknown {
  if (!Array.isArray(content)) return textContent(content);
  return content.map(part => {
    if (typeof part === "string") return { type: "text", text: part };
    if (part.type === "text") return part;
    if (part.type !== "image_url") {
      return { type: "text", text: JSON.stringify(part) };
    }
    const url = part.image_url.url;
    const data = url.match(/^data:(image\/[-+.\w]+);base64,(.+)$/);
    return data
      ? {
          type: "image",
          source: { type: "base64", media_type: data[1], data: data[2] },
        }
      : { type: "image", source: { type: "url", url } };
  });
}

async function invokeClaudeMessages(
  messages: Message[],
  maxTokens: number,
  signal: AbortSignal,
  config: ClaudeFallbackConfig
): Promise<{ text: string; model: string }> {
  const apiUrl = resolveClaudeUrl(config);
  if (!apiUrl || !hasClaudeFallback(config)) {
    throw new InferenceAttemptError({
      category: "unknown",
      safeCode: "not_configured",
    });
  }
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system: messages
          .filter(message => message.role === "system")
          .map(message => textContent(message.content))
          .join("\n\n"),
        messages: messages
          .filter(message => message.role !== "system")
          .map(message => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: toClaudeContent(message.content),
          })),
      }),
      signal,
    });
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new InferenceAttemptError({ category: "cancelled" });
    }
    throw new InferenceAttemptError({ category: "network" });
  }
  if (!response.ok) {
    throw new InferenceAttemptError({
      category: classifyHttpStatus(response.status),
      status: response.status,
    });
  }
  const data = (await response.json()) as ClaudeMessageResponse;
  const text =
    data.content
      ?.filter(block => block.type === "text" && block.text)
      .map(block => block.text)
      .join("\n")
      .trim() || "";
  return { text, model: data.model || config.model };
}

function resultText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .map(part => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";
}

function hasReplayBoundary(messages: Message[]): boolean {
  return messages.some(
    message =>
      message.role === "tool" ||
      message.role === "function" ||
      Boolean(message.tool_call_id)
  );
}

export async function invokeAgent(
  messages: Message[],
  maxTokens: number,
  responseFormat?: ResponseFormat,
  options?: { claudeFallback?: ClaudeFallbackConfig }
): Promise<{ text: string; modelLabel: string }> {
  const params: InvokeParams = {
    messages,
    maxTokens,
    responseFormat,
    useCase: "story-agent",
    replaySafe: true,
  };
  const candidates: InferenceCandidate<{ text: string; model: string }>[] = [];
  const claudeFallback = options?.claudeFallback ?? defaultClaudeFallback();
  const next = resolveComputeCandidates("story-agent", ENV.llmModel).find(
    provider => provider.id === "openai-next"
  );
  if (next) {
    candidates.push({
      provider: "openai-next",
      model: next.model,
      run: async signal => {
        const result = await invokeLLM({
          ...params,
          signal,
          replaySafe: false,
          allowedProviders: ["openai-next"],
        });
        return { text: resultText(result), model: result.model || next.model };
      },
    });
  } else if (typeof ENV.openaiNextApiKey === "undefined") {
    // A few characterization tests replace ENV with the pre-routing shape and
    // mock invokeLLM. Keep that seam while production ENV always has this field.
    candidates.push({
      provider: "openai-next",
      model: ENV.llmModel,
      run: async signal => {
        const result = await invokeLLM({ ...params, signal });
        return {
          text: resultText(result),
          model: result.model || ENV.llmModel,
        };
      },
    });
  }
  if (hasClaudeFallback(claudeFallback)) {
    candidates.push({
      provider: "302-claude",
      model: claudeFallback.model,
      run: signal =>
        invokeClaudeMessages(messages, maxTokens, signal, claudeFallback),
    });
  }

  const outcome = await runInferenceCandidates({
    useCase: "story-agent",
    candidates,
    replaySafe: !hasReplayBoundary(messages),
    timeoutMs: 60_000,
  });
  return {
    text: outcome.value.text,
    modelLabel:
      typeof ENV.openaiNextApiKey === "undefined"
        ? outcome.value.model
        : `${outcome.provider === "openai-next" ? "OpenAI Next" : claudeFallback.label || "302 Claude"} · ${outcome.value.model}`,
  };
}
