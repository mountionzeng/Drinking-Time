import { ENV } from "./env";

export type TextComputeProviderId = "openai-next" | "302";

export type TextComputeProvider = {
  id: TextComputeProviderId;
  label: "OpenAI Next" | "302";
  apiKey: string;
  baseUrl: string;
  chatCompletionsUrl: string;
  model: string;
};

/**
 * 推理用途。每个用途有自己的模型档位，互不借用，避免视觉模型被文本任务
 * 拿去用、或登录页访客回信被拉到通用故事模型的价位上。
 */
export type TextComputeUseCase = "text" | "vision" | "emotion" | "login-guest";

export type TokenLimitField = "max_completion_tokens" | "max_tokens";

export type ModelCapabilities = {
  model: string;
  /** false 表示模型不在登记表内，只发送最小兼容字段。 */
  registered: boolean;
  tokenLimitField: TokenLimitField;
  supportsReasoningEffort: boolean;
  reasoningEfforts: readonly string[];
  supportsTemperature: boolean;
  supportsStructuredOutputs: boolean;
  supportsToolCalls: boolean;
  supportsVisionInput: boolean;
};

export type ComputeCandidateOptions = {
  /** OpenAI Next 不可用时使用的 302 模型名。 */
  fallback302Model: string;
  /** 覆盖该用途默认的 OpenAI Next 模型。 */
  preferredNextModel?: string;
  /** 视觉等自带 302 凭据的调用方可以传入专用 Key / 网关。 */
  fallback302ApiKey?: string;
  fallback302BaseUrl?: string;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function chatCompletionsUrl(value: string): string {
  const normalized = normalizeBaseUrl(value);
  if (normalized.endsWith("/v1/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

const MINIMAL_CAPABILITIES = {
  // max_tokens 是所有 OpenAI 兼容网关都认的字段，未登记模型只用它。
  tokenLimitField: "max_tokens",
  supportsReasoningEffort: false,
  reasoningEfforts: [] as readonly string[],
  supportsTemperature: false,
  supportsStructuredOutputs: false,
  supportsToolCalls: false,
  supportsVisionInput: false,
} satisfies Omit<ModelCapabilities, "model" | "registered">;

type CapabilityTier = Omit<ModelCapabilities, "model" | "registered">;

/**
 * 当前生产在用模型的显式能力档位。新增模型必须在这里登记，否则按最小兼容
 * 字段发送——宁可少发参数被网关接受，也不要发一个它不认的字段整轮失败。
 */
const MODEL_CAPABILITIES: Readonly<Record<string, CapabilityTier>> = {
  "gpt-5.6-terra": {
    tokenLimitField: "max_completion_tokens",
    supportsReasoningEffort: true,
    reasoningEfforts: ["low", "medium", "high"],
    supportsTemperature: false,
    supportsStructuredOutputs: true,
    supportsToolCalls: true,
    supportsVisionInput: false,
  },
  "qwen3-vl-plus": {
    tokenLimitField: "max_tokens",
    supportsReasoningEffort: false,
    reasoningEfforts: [],
    supportsTemperature: true,
    supportsStructuredOutputs: true,
    supportsToolCalls: false,
    supportsVisionInput: true,
  },
  "deepseek-v3.2": {
    tokenLimitField: "max_tokens",
    supportsReasoningEffort: false,
    reasoningEfforts: [],
    supportsTemperature: true,
    supportsStructuredOutputs: true,
    supportsToolCalls: true,
    supportsVisionInput: false,
  },
  "deepseek-v4-flash": {
    tokenLimitField: "max_tokens",
    supportsReasoningEffort: false,
    reasoningEfforts: [],
    supportsTemperature: true,
    supportsStructuredOutputs: false,
    supportsToolCalls: false,
    supportsVisionInput: false,
  },
  // 旧 Forge/302 通用模型（LLM_MODEL）。登记它不是为了启用新能力，而是为了
  // 让回退通道继续收到和今天一模一样的字段——不登记就会按最小集发送，
  // 等于在回退路径上悄悄改了模型行为。
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B": {
    tokenLimitField: "max_tokens",
    supportsReasoningEffort: false,
    reasoningEfforts: [],
    supportsTemperature: true,
    supportsStructuredOutputs: true,
    supportsToolCalls: true,
    supportsVisionInput: false,
  },
  // 故事 Agent 的 Claude 通道模型（DROP_ZONE_MODEL）。Anthropic Messages 协议
  // 没有 OpenAI 那套 response_format / tools 参数，所以两项都是 false。
  "cc-opus-4-7": {
    tokenLimitField: "max_tokens",
    supportsReasoningEffort: false,
    reasoningEfforts: [],
    supportsTemperature: false,
    supportsStructuredOutputs: false,
    supportsToolCalls: false,
    supportsVisionInput: true,
  },
};

export function describeModelCapabilities(model: string): ModelCapabilities {
  const normalized = model.trim();
  const tier = MODEL_CAPABILITIES[normalized];
  return {
    model: normalized,
    registered: Boolean(tier),
    ...(tier ?? MINIMAL_CAPABILITIES),
  };
}

function defaultNextModel(useCase: TextComputeUseCase): string {
  switch (useCase) {
    case "vision":
      return ENV.openaiNextVisionModel;
    case "emotion":
      return ENV.openaiNextEmotionModel;
    case "login-guest":
      return ENV.openaiNextLoginGuestModel;
    case "text":
    default:
      return ENV.openaiNextTextModel;
  }
}

function nextCandidate(
  useCase: TextComputeUseCase,
  options: ComputeCandidateOptions
): TextComputeProvider | null {
  const apiKey = ENV.openaiNextApiKey.trim();
  const model = (options.preferredNextModel ?? defaultNextModel(useCase)).trim();
  if (!apiKey || !model) return null;

  const baseUrl = normalizeBaseUrl(ENV.openaiNextBaseUrl);
  return {
    id: "openai-next",
    label: "OpenAI Next",
    apiKey,
    baseUrl,
    chatCompletionsUrl: chatCompletionsUrl(baseUrl),
    model,
  };
}

function legacy302Candidate(
  useCase: TextComputeUseCase,
  options: ComputeCandidateOptions
): TextComputeProvider | null {
  const isVision = useCase === "vision";
  const apiKey = (
    options.fallback302ApiKey ||
    (isVision ? ENV.vision302ApiKey : "") ||
    ENV.api302Key
  ).trim();
  const model = options.fallback302Model.trim();
  if (!apiKey || !model) return null;

  const baseUrl = normalizeBaseUrl(
    options.fallback302BaseUrl ||
      (isVision ? ENV.vision302BaseUrl : "") ||
      ENV.api302BaseUrl
  );
  return {
    id: "302",
    label: "302",
    apiKey,
    baseUrl,
    chatCompletionsUrl: chatCompletionsUrl(baseUrl),
    model,
  };
}

/**
 * OpenAI-compatible compute split for text and multimodal chat completions.
 * Media generation and transcription keep using their dedicated 302
 * configuration so provider-specific paid-job receipts and recovery semantics
 * are never mixed across gateways.
 *
 * 返回的是有序候选而不是单个供应商：位置 0 是首选通道，其余是可回退通道。
 * 这样「未配置时怎么选」和「运行时失败后回退到谁」可以分开推理和测试。
 */
export function resolveComputeCandidates(
  useCase: TextComputeUseCase,
  options: ComputeCandidateOptions
): TextComputeProvider[] {
  return [
    nextCandidate(useCase, options),
    legacy302Candidate(useCase, options),
  ].filter((candidate): candidate is TextComputeProvider => candidate !== null);
}

export function resolveTextComputeProvider(
  fallback302Model: string,
  preferredNextModel = ENV.openaiNextTextModel
): TextComputeProvider | null {
  return (
    resolveComputeCandidates("text", {
      fallback302Model,
      preferredNextModel,
    })[0] ?? null
  );
}

export function resolveVisionComputeProvider(input: {
  fallback302Model: string;
  fallback302ApiKey?: string;
  fallback302BaseUrl?: string;
}): TextComputeProvider | null {
  return resolveComputeCandidates("vision", input)[0] ?? null;
}

export function resolveLoginGuestComputeProvider(
  fallback302Model: string
): TextComputeProvider | null {
  return (
    resolveComputeCandidates("login-guest", { fallback302Model })[0] ?? null
  );
}
