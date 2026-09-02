import { ENV } from "./env";
import {
  classifyHttpStatus,
  InferenceAttemptError,
  runInferenceCandidates,
} from "./inferenceOrchestrator";
import {
  resolveComputeCandidates,
  type ComputeProviderId,
  type ComputeUseCase,
  type TextComputeProvider,
} from "./textComputeProvider";

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
    mime_type?:
      | "audio/mpeg"
      | "audio/wav"
      | "application/pdf"
      | "audio/mp4"
      | "video/mp4";
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
  useCase?: ComputeUseCase;
  replaySafe?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  reasoningEffort?: "low" | "medium" | "high";
  /** Internal routing constraint used by cross-protocol callers. */
  allowedProviders?: ComputeProviderId[];
  fallback302Model?: string;
  fallback302ApiKey?: string;
  fallback302BaseUrl?: string;
  fetcher?: typeof fetch;
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
  provider?: {
    id: ComputeProviderId;
    label: string;
    model: string;
    attempt: number;
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

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

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
export async function invokeOpenAICompatible(
  provider: TextComputeProvider,
  params: InvokeParams,
  signal?: AbortSignal
): Promise<InvokeResult> {
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
    reasoningEffort,
  } = params;

  const payload: Record<string, unknown> = {
    model: provider.model,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    if (!provider.capability.supportsTools) {
      throw new InferenceAttemptError({
        category: "parameter",
        safeCode: "tools_unsupported",
      });
    }
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload[provider.capability.tokenField] = maxTokens ?? max_tokens ?? 8192;

  if (
    typeof temperature === "number" &&
    provider.capability.supportsTemperature
  ) {
    payload.temperature = temperature;
  }

  if (reasoningEffort && provider.capability.supportsReasoningEffort) {
    payload.reasoning_effort = reasoningEffort;
  }

  const thinkingBudgetRaw = process.env.LLM_THINKING_BUDGET;
  const thinkingBudget = thinkingBudgetRaw ? Number(thinkingBudgetRaw) : NaN;
  if (
    provider.id === "302" &&
    Number.isFinite(thinkingBudget) &&
    thinkingBudget > 0
  ) {
    payload.thinking = { budget_tokens: Math.floor(thinkingBudget) };
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    if (
      normalizedResponseFormat.type === "json_schema" &&
      !provider.capability.supportsJsonSchema
    ) {
      if (provider.capability.supportsJsonObject) {
        payload.response_format = { type: "json_object" };
      }
    } else if (
      normalizedResponseFormat.type !== "json_object" ||
      provider.capability.supportsJsonObject
    ) {
      payload.response_format = normalizedResponseFormat;
    }
  }

  let response: Response;
  try {
    response = await (params.fetcher ?? fetch)(provider.chatCompletionsUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new InferenceAttemptError({ category: "cancelled" });
    }
    throw new InferenceAttemptError({ category: "network" });
  }

  if (!response.ok) {
    // Deliberately do not propagate the provider body: it may echo prompts,
    // image URLs, tool arguments or gateway credentials.
    throw new InferenceAttemptError({
      category: classifyHttpStatus(response.status),
      status: response.status,
    });
  }

  return (await response.json()) as InvokeResult;
}

function hasReplayBoundary(params: InvokeParams): boolean {
  if (params.tools?.length) return true;
  return params.messages.some(
    message =>
      message.role === "tool" ||
      message.role === "function" ||
      Boolean(message.tool_call_id)
  );
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const useCase = params.useCase ?? "general-text";
  const candidates = resolveComputeCandidates(
    useCase,
    params.fallback302Model ?? ENV.llmModel,
    {
      fallback302ApiKey:
        params.fallback302ApiKey ?? (ENV.api302Key || ENV.forgeApiKey),
      fallback302BaseUrl:
        params.fallback302BaseUrl ??
        (ENV.api302Key || !ENV.forgeApiUrl
          ? ENV.api302BaseUrl
          : ENV.forgeApiUrl),
    }
  ).filter(
    provider =>
      !params.allowedProviders || params.allowedProviders.includes(provider.id)
  );
  const outcome = await runInferenceCandidates({
    useCase,
    replaySafe: Boolean(params.replaySafe) && !hasReplayBoundary(params),
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    candidates: candidates.map(provider => ({
      provider: provider.id,
      model: provider.model,
      run: signal => invokeOpenAICompatible(provider, params, signal),
    })),
  });
  return {
    ...outcome.value,
    provider: {
      id: outcome.provider as ComputeProviderId,
      label: outcome.provider === "openai-next" ? "OpenAI Next" : "302",
      model: outcome.model,
      attempt: outcome.attempt,
    },
  };
}
