/**
 * Intelligent LLM channel selection — Claude Messages vs OpenAI-compatible.
 *
 * Only `invokeAgent` is exported; the rest are module-private utilities.
 */
import { ENV } from "./env";
import { invokeLLM, type Message } from "./llm";

type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
};

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

async function invokeClaudeMessages(
  messages: Message[],
  maxTokens: number,
): Promise<{ text: string; modelLabel: string }> {
  const apiUrl = resolveClaudeUrl();
  if (!apiUrl) throw new Error("Claude messages endpoint is not configured");

  const system = messages
    .filter(m => m.role === "system")
    .map(m => String(m.content))
    .join("\n\n");

  const anthropicMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content),
    }));

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ENV.forgeApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ENV.dropZoneModel || ENV.llmModel,
      max_tokens: maxTokens,
      system,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude messages invoke failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as ClaudeMessageResponse;
  const text =
    data.content
      ?.filter(block => block.type === "text" && block.text)
      .map(block => block.text)
      .join("\n")
      .trim() || "";

  return { text, modelLabel: data.model || ENV.dropZoneModel || ENV.llmModel };
}

export async function invokeAgent(
  messages: Message[],
  maxTokens: number,
): Promise<{ text: string; modelLabel: string }> {
  if (shouldUseClaudeChannel()) {
    return invokeClaudeMessages(messages, maxTokens);
  }

  const result = await invokeLLM({ messages, maxTokens });
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
  return { text, modelLabel: ENV.llmModel };
}
