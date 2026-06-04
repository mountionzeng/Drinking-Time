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
    .map(m => {
      const role = m.role === "assistant" ? "assistant" : "user";
      // 多模态内容（含图片）：转换为 Anthropic Messages API 格式
      if (Array.isArray(m.content)) {
        const parts = m.content.map(part => {
          if (typeof part === "string") return { type: "text" as const, text: part };
          if (part.type === "text") return part;
          if (part.type === "image_url") {
            const url = part.image_url.url;
            // data URL → base64 source；远程 URL → url source
            if (url.startsWith("data:")) {
              const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
              if (match) {
                return { type: "image" as const, source: { type: "base64" as const, media_type: match[1], data: match[2] } };
              }
            }
            return { type: "image" as const, source: { type: "url" as const, url } };
          }
          return { type: "text" as const, text: JSON.stringify(part) };
        });
        return { role, content: parts };
      }
      return { role, content: String(m.content) };
    });

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

async function invokeAgentOnce(
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

// 网关偶发抖动（502/503、超时、网络层）会让一次本可成功的请求平白失败。
// 只对「临时性」错误自动重试，确定性错误（鉴权 / 参数 / 模型不存在）不重试——重试也没用，只会拖慢真实报错。
const AGENT_RETRY_DELAYS_MS = [700];

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // 端点没配置 → 确定性
  if (/not configured/i.test(msg)) return false;
  // 两条通道的 HTTP 错误都形如 "...failed: <status> ..."，取状态码判断
  const m = msg.match(/failed:\s*(\d{3})\b/);
  if (m) {
    const status = Number(m[1]);
    // 429 限流 / 408 超时 / 5xx 服务端错误 → 临时；其余 4xx（鉴权 / 参数 / 模型）→ 确定性
    return status === 429 || status === 408 || status >= 500;
  }
  // 没有状态码 → 多为网络层错误（cannot reach / fetch failed / timeout），按临时处理
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function invokeAgent(
  messages: Message[],
  maxTokens: number,
): Promise<{ text: string; modelLabel: string }> {
  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await invokeAgentOnce(messages, maxTokens);
    } catch (err) {
      lastErr = err;
      const canRetry =
        attempt < AGENT_RETRY_DELAYS_MS.length && isTransientError(err);
      if (!canRetry) break;
      console.warn(
        `[invokeAgent] 临时失败，第 ${attempt + 1} 次重试中…`,
        err instanceof Error ? err.message : err,
      );
      await delay(AGENT_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}
