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
  // input_modalities 在 OpenAI Next 的模型目录里确认为 ["text","image"]。
  // U1 最初把这项错登记成 false；storyReply.ts 早就在给这个模型发用户上传的
  // 照片（image_url，text use case），U7 加上视觉输入边界检查后这个错误
  // 登记会当场拒绝所有带照片的故事回复——先在这里改对，而不是绕过检查。
  "gpt-5.6-terra": {
    tokenLimitField: "max_completion_tokens",
    supportsReasoningEffort: true,
    reasoningEfforts: ["low", "medium", "high"],
    supportsTemperature: false,
    supportsStructuredOutputs: true,
    supportsToolCalls: true,
    supportsVisionInput: true,
  },
  // 2026-08-17 用真实网关验证过：接受 max_tokens（max_completion_tokens 也
  // 被接受，但 max_tokens 是 Qwen 生态原生约定）；reasoning_effort="low"
  // 被接受且确实驱动了 reasoning_content/reasoning_tokens——U1 最初把这两项
  // 都登记错了（分别错登记成 max_completion_tokens 和不支持推理强度）。
  // 只登记验证过的 "low"，未验证 medium/high 前不敢声称支持。
  "qwen3-vl-plus": {
    tokenLimitField: "max_tokens",
    supportsReasoningEffort: true,
    reasoningEfforts: ["low"],
    supportsTemperature: true,
    supportsStructuredOutputs: true,
    supportsToolCalls: false,
    supportsVisionInput: true,
  },
  // 旧 302 视觉模型（VISION_302_MODEL）。必须登记：视觉档位会拒绝「已登记且
  // 声明不支持图片」的模型，而未登记模型按最小集放行——不登记它就等于让
  // 回退通道永远走最小字段，白白丢掉 temperature 和结构化输出。
  "gemini-3-pro-preview": {
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

/**
 * 缺字段一律读成空串。
 *
 * 这个解析器现在是各业务「有没有配模型」的唯一判据，被大量调用点间接触发，
 * 而那些调用点的测试通常只 mock 出自己关心的几个 ENV 字段。一个没 mock 到的
 * 字段应当解释成「这条通道没配」，而不是抛 TypeError 把整条判断炸掉——判据
 * 崩溃比判据答错更难排查。
 */
const str = (value: string | undefined | null): string => value?.trim() ?? "";

function defaultNextModel(useCase: TextComputeUseCase): string {
  switch (useCase) {
    case "vision":
      return str(ENV.openaiNextVisionModel);
    case "emotion":
      return str(ENV.openaiNextEmotionModel);
    case "login-guest":
      return str(ENV.openaiNextLoginGuestModel);
    case "text":
    default:
      return str(ENV.openaiNextTextModel);
  }
}

function nextCandidate(
  useCase: TextComputeUseCase,
  options: ComputeCandidateOptions
): TextComputeProvider | null {
  const apiKey = str(ENV.openaiNextApiKey);
  const model = str(options.preferredNextModel) || defaultNextModel(useCase);
  if (!apiKey || !model) return null;

  const baseUrl = normalizeBaseUrl(str(ENV.openaiNextBaseUrl));
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
  const apiKey =
    str(options.fallback302ApiKey) ||
    (isVision ? str(ENV.vision302ApiKey) : "") ||
    str(ENV.api302Key);
  const model = str(options.fallback302Model);
  if (!apiKey || !model) return null;

  const baseUrl = normalizeBaseUrl(
    str(options.fallback302BaseUrl) ||
      (isVision ? str(ENV.vision302BaseUrl) : "") ||
      str(ENV.api302BaseUrl)
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
