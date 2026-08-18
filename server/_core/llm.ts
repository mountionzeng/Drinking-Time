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
 * 旧的 Forge 配置现在只作为候选链末端的兼容通道：Key 和网关原样传给
 * orchestrator，回退路径因此与改动前逐字节一致，变的只是「Next 排在它前面」。
 */
const legacyFallbackBaseUrl = () =>
  ENV.forgeApiUrl?.trim() || "https://forge.manus.im";

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
    signal,
  } = params;

  const thinkingBudgetRaw = process.env.LLM_THINKING_BUDGET;
  const thinkingBudget = thinkingBudgetRaw ? Number(thinkingBudgetRaw) : NaN;

  const outcome = await runInference({
    useCase: "text",
    messages,
    candidates: {
      fallback302Model: ENV.llmModel,
      fallback302ApiKey: ENV.forgeApiKey,
      fallback302BaseUrl: legacyFallbackBaseUrl(),
    },
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
    signal,
  } = params;

  return runInference({
    useCase: "text",
    messages,
    candidates: {
      fallback302Model: ENV.llmModel,
      fallback302ApiKey: ENV.forgeApiKey,
      fallback302BaseUrl: legacyFallbackBaseUrl(),
    },
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
    signal,
  });
}
