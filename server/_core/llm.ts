import { ENV } from "./env";
import { runInference } from "./inferenceOrchestrator";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  onTextDelta?: (text: string) => void;
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  temperature?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /**
   * 显式声明这次推理跨供应商重放是安全的（无副作用、可重复执行）。
   * 默认 false：不声明就绝不换供应商重发。
   */
  replaySafe?: boolean;
  /** 整条候选链的外层预算（毫秒）。 */
  deadlineMs?: number;
  reasoningEffort?: string;
  signal?: AbortSignal;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

/**
 * Forge 配置作为候选链末端的兼容通道，保留独立聊天凭据。
 * 已配置 302 国内入口时，旧 302 聊天入口共用其传输域名；自定义网关不变。
 */
const legacyFallbackBaseUrl = () => {
  const legacy = ENV.forgeApiUrl?.trim() || "https://forge.manus.im";
  // The legacy chat key can differ from the media key. Share only the configured
  // transport host, and only between the provider's two known HTTPS origins.
  try {
    const source = new URL(legacy);
    const configured = new URL(ENV.api302BaseUrl);
    const hosts = new Set(["api.302.ai", "api.302ai.cn"]);
    if (source.hostname === "api.302.ai" && configured.hostname === "api.302ai.cn" &&
        [source, configured].every(url => url.protocol === "https:" && hosts.has(url.hostname) && !url.port && !url.username && !url.password)) {
      source.hostname = configured.hostname;
      return source.href.replace(/\/$/, "");
    }
  } catch { /* Custom gateways keep their own configuration. */ }
  return legacy;
};

/** An explicit recovery model opts text-only requests into the existing 302
 * service account. Never route image/file messages to a text-only model. */
export function textOnlyRecoveryCandidates(messages: Message[]) {
  const textOnly = messages.every(message =>
    (Array.isArray(message.content) ? message.content : [message.content])
      .every(part => typeof part === "string" || part.type === "text")
  );
  const model = ENV.llmTextOnly302Model?.trim();
  if (model && ENV.api302Key && textOnly) return {
    fallback302Model: model,
    fallback302ApiKey: ENV.api302Key,
    fallback302BaseUrl: ENV.api302BaseUrl,
  };
  return null;
}

function fallbackCandidates(messages: Message[]) {
  const recovery = textOnlyRecoveryCandidates(messages);
  if (recovery) return recovery;
  return {
    fallback302Model: ENV.llmModel,
    fallback302ApiKey: ENV.forgeApiKey,
    fallback302BaseUrl: legacyFallbackBaseUrl(),
  };
}

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

// ── 核心函数：调用大模型 ──
// 统一封装了 OpenAI 兼容格式的 chat/completions 请求
// 支持：多模态消息、function calling (tools)、structured output (json_schema)
// 所有 Agent 最终都通过这个函数发请求
//
// 网络执行、候选顺序、参数适配、错误分类和回退全部由
// `inferenceOrchestrator` 负责；这里只保留旧签名和 InvokeResult 契约，
// 让既有调用点不必改一行就能吃到 OpenAI Next 优先。
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    maxTokens,
    max_tokens,
    temperature,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    replaySafe,
    deadlineMs,
    reasoningEffort,
    signal,
  } = params;

  const thinkingBudgetRaw = process.env.LLM_THINKING_BUDGET;
  const thinkingBudget = thinkingBudgetRaw ? Number(thinkingBudgetRaw) : NaN;

  const outcome = await runInference({
    useCase: "text",
    messages,
    candidates: fallbackCandidates(messages),
    ...(params.onTextDelta ? { onTextDelta: params.onTextDelta } : {}),
    tools,
    toolChoice: toolChoice || tool_choice,
    maxTokens: maxTokens ?? max_tokens,
    temperature,
    responseFormat: normalizeResponseFormat({
      responseFormat,
      response_format,
      outputSchema,
      output_schema,
    }),
    thinkingBudgetTokens:
      Number.isFinite(thinkingBudget) && thinkingBudget > 0
        ? thinkingBudget
        : undefined,
    replaySafe,
    deadlineMs,
    reasoningEffort,
    signal,
  });

  return outcome.result;
}

/**
 * 与 `invokeLLM` 相同，但额外返回实际命中的供应商与模型，供 `modelLabel`
 * 和安全诊断使用。新调用点优先用它。
 */
export async function invokeLLMWithProvider(params: InvokeParams) {
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    maxTokens,
    max_tokens,
    temperature,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    replaySafe,
    deadlineMs,
    reasoningEffort,
    signal,
  } = params;

  return runInference({
    useCase: "text",
    messages,
    candidates: fallbackCandidates(messages),
    ...(params.onTextDelta ? { onTextDelta: params.onTextDelta } : {}),
    tools,
    toolChoice: toolChoice || tool_choice,
    maxTokens: maxTokens ?? max_tokens,
    temperature,
    responseFormat: normalizeResponseFormat({
      responseFormat,
      response_format,
      outputSchema,
      output_schema,
    }),
    replaySafe,
    deadlineMs,
    reasoningEffort,
    signal,
  });
}
