import { ENV } from "./env";

export type ComputeUseCase =
  | "general-text"
  | "story-agent"
  | "vision"
  | "emotion"
  | "login-guest";

export type ComputeProviderId = "openai-next" | "302";

export type ModelCapability = {
  tokenField: "max_tokens" | "max_completion_tokens";
  supportsTemperature: boolean;
  supportsReasoningEffort: boolean;
  supportsJsonObject: boolean;
  supportsJsonSchema: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
};

export type TextComputeProvider = {
  id: ComputeProviderId;
  label: "OpenAI Next" | "302";
  apiKey: string;
  baseUrl: string;
  chatCompletionsUrl: string;
  model: string;
  capability: ModelCapability;
};

function normalizeBaseUrl(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

export function resolveOpenAICompatibleUrl(value: string): string {
  const normalized = normalizeBaseUrl(value);
  if (normalized.endsWith("/v1/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

const MODERN_CAPABILITY: ModelCapability = {
  tokenField: "max_completion_tokens",
  supportsTemperature: false,
  supportsReasoningEffort: true,
  supportsJsonObject: true,
  supportsJsonSchema: true,
  supportsTools: true,
  supportsVision: false,
};

const VISION_CAPABILITY: ModelCapability = {
  tokenField: "max_completion_tokens",
  supportsTemperature: true,
  supportsReasoningEffort: true,
  supportsJsonObject: true,
  supportsJsonSchema: false,
  supportsTools: false,
  supportsVision: true,
};

const LEGACY_CAPABILITY: ModelCapability = {
  tokenField: "max_tokens",
  supportsTemperature: true,
  supportsReasoningEffort: false,
  supportsJsonObject: true,
  supportsJsonSchema: false,
  supportsTools: true,
  supportsVision: false,
};

const MINIMAL_CAPABILITY: ModelCapability = {
  tokenField: "max_tokens",
  supportsTemperature: false,
  supportsReasoningEffort: false,
  supportsJsonObject: false,
  supportsJsonSchema: false,
  supportsTools: false,
  supportsVision: false,
};

export function getModelCapability(
  model: string,
  provider: ComputeProviderId
): ModelCapability {
  if (provider === "302") return LEGACY_CAPABILITY;
  if (model === ENV.openaiNextVisionModel || /^qwen3-(?:vl|omni)/.test(model)) {
    return VISION_CAPABILITY;
  }
  if (
    model === ENV.openaiNextTextModel ||
    model === ENV.openaiNextEmotionModel ||
    model === ENV.openaiNextLoginModel ||
    /^(?:gpt-5|deepseek-v4)/.test(model)
  ) {
    return MODERN_CAPABILITY;
  }
  return MINIMAL_CAPABILITY;
}

function candidate(input: {
  id: ComputeProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): TextComputeProvider | null {
  const apiKey = String(input.apiKey ?? "").trim();
  const model = String(input.model ?? "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!apiKey || !model || !baseUrl) return null;
  return {
    id: input.id,
    label: input.id === "openai-next" ? "OpenAI Next" : "302",
    apiKey,
    baseUrl,
    chatCompletionsUrl: resolveOpenAICompatibleUrl(baseUrl),
    model,
    capability: getModelCapability(model, input.id),
  };
}

export function resolveComputeCandidates(
  useCase: ComputeUseCase,
  fallback302Model: string,
  overrides: {
    fallback302ApiKey?: string;
    fallback302BaseUrl?: string;
    preferredNextModel?: string;
  } = {}
): TextComputeProvider[] {
  const nextModel =
    overrides.preferredNextModel ??
    (useCase === "vision"
      ? ENV.openaiNextVisionModel
      : useCase === "login-guest"
        ? ENV.openaiNextLoginModel
        : useCase === "emotion"
          ? ENV.openaiNextEmotionModel
          : ENV.openaiNextTextModel);
  const next = candidate({
    id: "openai-next",
    apiKey: ENV.openaiNextApiKey,
    baseUrl: ENV.openaiNextBaseUrl,
    model: nextModel,
  });

  if (useCase === "login-guest") return next ? [next] : [];

  const legacy = candidate({
    id: "302",
    apiKey:
      overrides.fallback302ApiKey ??
      (useCase === "vision" ? ENV.vision302ApiKey : ENV.api302Key),
    baseUrl:
      overrides.fallback302BaseUrl ??
      (useCase === "vision" ? ENV.vision302BaseUrl : ENV.api302BaseUrl),
    model: fallback302Model,
  });
  return [next, legacy].filter(
    (value): value is TextComputeProvider => value !== null
  );
}
