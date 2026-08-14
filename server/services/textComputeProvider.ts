import { ENV } from "../_core/env";

export type TextComputeProvider = {
  id: "openai-next" | "302";
  label: "OpenAI Next" | "302";
  apiKey: string;
  baseUrl: string;
  chatCompletionsUrl: string;
  model: string;
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

/**
 * Text-only provider split. Media generation, transcription and vision keep
 * using their dedicated 302 configuration so provider-specific paid-job
 * receipts and recovery semantics are never mixed across gateways.
 */
export function resolveTextComputeProvider(
  fallback302Model: string,
  preferredNextModel = ENV.openaiNextTextModel
): TextComputeProvider | null {
  const nextKey = ENV.openaiNextApiKey.trim();
  const nextModel = preferredNextModel.trim();
  if (nextKey && nextModel) {
    const baseUrl = normalizeBaseUrl(ENV.openaiNextBaseUrl);
    return {
      id: "openai-next",
      label: "OpenAI Next",
      apiKey: nextKey,
      baseUrl,
      chatCompletionsUrl: chatCompletionsUrl(baseUrl),
      model: nextModel,
    };
  }

  const key302 = ENV.api302Key.trim();
  const model302 = fallback302Model.trim();
  if (!key302 || !model302) return null;

  const baseUrl = normalizeBaseUrl(ENV.api302BaseUrl);

  return {
    id: "302",
    label: "302",
    apiKey: key302,
    baseUrl,
    chatCompletionsUrl: chatCompletionsUrl(baseUrl),
    model: model302,
  };
}

export function resolveVisionComputeProvider(input: {
  fallback302Model: string;
  fallback302ApiKey?: string;
  fallback302BaseUrl?: string;
}): TextComputeProvider | null {
  const nextKey = ENV.openaiNextApiKey.trim();
  const nextModel = ENV.openaiNextVisionModel.trim();
  if (nextKey && nextModel) {
    const baseUrl = normalizeBaseUrl(ENV.openaiNextBaseUrl);
    return {
      id: "openai-next",
      label: "OpenAI Next",
      apiKey: nextKey,
      baseUrl,
      chatCompletionsUrl: chatCompletionsUrl(baseUrl),
      model: nextModel,
    };
  }

  const apiKey = (
    input.fallback302ApiKey ||
    ENV.vision302ApiKey ||
    ENV.api302Key
  ).trim();
  const model = input.fallback302Model.trim();
  if (!apiKey || !model) return null;

  const baseUrl = normalizeBaseUrl(
    input.fallback302BaseUrl ||
      ENV.vision302BaseUrl ||
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
