import { ENV } from "../_core/env";
import { resolveComputeCandidates } from "../_core/textComputeProvider";

export type TextComputeProvider = {
  id: "openai-next" | "302";
  label: "OpenAI Next" | "302";
  apiKey: string;
  baseUrl: string;
  chatCompletionsUrl: string;
  model: string;
};

function withoutCapability(
  provider: ReturnType<typeof resolveComputeCandidates>[number] | undefined
): TextComputeProvider | null {
  if (!provider) return null;
  const { capability: _capability, ...legacyShape } = provider;
  return legacyShape;
}

/**
 * OpenAI-compatible compute split for text and multimodal chat completions.
 * Media generation and transcription keep using their dedicated 302
 * configuration so provider-specific paid-job receipts and recovery semantics
 * are never mixed across gateways.
 */
export function resolveTextComputeProvider(
  fallback302Model: string,
  preferredNextModel = ENV.openaiNextTextModel
): TextComputeProvider | null {
  return withoutCapability(
    resolveComputeCandidates("general-text", fallback302Model, {
      preferredNextModel,
    })[0]
  );
}

export function resolveVisionComputeProvider(input: {
  fallback302Model: string;
  fallback302ApiKey?: string;
  fallback302BaseUrl?: string;
}): TextComputeProvider | null {
  return withoutCapability(
    resolveComputeCandidates("vision", input.fallback302Model, {
      fallback302ApiKey:
        input.fallback302ApiKey || ENV.vision302ApiKey || ENV.api302Key,
      fallback302BaseUrl:
        input.fallback302BaseUrl || ENV.vision302BaseUrl || ENV.api302BaseUrl,
    })[0]
  );
}
