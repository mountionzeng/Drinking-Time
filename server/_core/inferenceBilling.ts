import { createHash } from "node:crypto";
import { ceilYuanToMinor, fromYuan } from "../../shared/computeMoney";
import { resolveTextPrice } from "../../shared/textComputePricing";
import { isLocalUnlimitedCompute } from "../services/computeAccessPolicy";
import type { InferenceCandidate, InferenceOutcome, InferenceRequest } from "./inferenceOrchestrator";
import type { Message } from "./llm";

/** Same default as the payload builder when the caller sets no limit. */
const DEFAULT_OUTPUT_TOKENS = 8192;
/** Conservative per-image allowance; providers bill images as input tokens. */
const IMAGE_TOKENS = 1500;
/** CJK text runs about one token per character; Latin text is cheaper. */
const CHARS_PER_TOKEN = 1;

/**
 * Production charges real balances; the local unlimited dev server still
 * records usage. Tests and previews keep the plain admission gate only.
 */
export function shouldMeterInference(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.NODE_ENV === "production" || isLocalUnlimitedCompute(env);
}

function estimateInputTokens(messages: Message[]): number {
  let chars = 0;
  let images = 0;
  for (const message of messages) {
    const parts = Array.isArray(message.content) ? message.content : [message.content];
    for (const part of parts) {
      if (typeof part === "string") chars += part.length;
      else if (part.type === "text") chars += part.text.length;
      else if (part.type === "image_url") images += 1;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
}

/** Upper bound for one successful attempt on the most expensive candidate. */
export function estimateInferenceMaxCostMinor(
  request: InferenceRequest,
  candidates: readonly InferenceCandidate[]
): number {
  const tokens =
    estimateInputTokens(request.messages) + (request.maxTokens ?? DEFAULT_OUTPUT_TOKENS);
  const yuanPer1k = Math.max(
    ...candidates.map(c => resolveTextPrice({ provider: c.id, model: c.model }).yuanPer1kTokens)
  );
  return Math.max(1, ceilYuanToMinor((tokens / 1000) * yuanPer1k));
}

/**
 * Bills the provider that actually answered. Missing usage charges the hold:
 * settling at zero would let an unreported call spend nothing.
 */
export function inferenceVerifiedCostMinor(
  outcome: InferenceOutcome,
  maxCostMinor: number
): number {
  const usage = outcome.result.usage;
  const price = resolveTextPrice({ provider: outcome.provider, model: outcome.model });
  if (!price.priced) {
    console.warn("[billing] 未配置该供应商/模型的单价，按兜底价计费——账目无法对账", {
      provider: outcome.provider,
      model: outcome.model,
    });
  }
  if (!usage || !Number.isFinite(usage.total_tokens)) {
    console.warn("[billing] 供应商未返回用量，按预占上限结算", {
      provider: outcome.provider,
      model: outcome.model,
    });
    return maxCostMinor;
  }
  return fromYuan((usage.total_tokens / 1000) * price.yuanPer1kTokens);
}

export function inferenceRequestHash(
  request: InferenceRequest,
  candidates: readonly InferenceCandidate[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        useCase: request.useCase,
        models: candidates.map(c => `${c.id}/${c.model}`),
        maxTokens: request.maxTokens ?? null,
        messages: request.messages,
      })
    )
    .digest("hex");
}
