import { createHash } from "node:crypto";
import { ceilYuanToMinor, MINOR_PER_YUAN } from "../../shared/computeMoney";
import { resolveTextPrice } from "../../shared/textComputePricing";
import { isLocalUnlimitedCompute } from "../services/computeAccessPolicy";
import {
  confirmProviderAttemptUsage,
  listOperationProviderAttempts,
  recordOperationProviderAttempt,
  settleOperation,
  type SettleOperationResult,
} from "../services/computeLedger";
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
  const yuanPer1k = Math.max(
    ...candidates.map(c => resolveTextPrice({ provider: c.id, model: c.model }).yuanPer1kTokens)
  );
  return estimateAtRate(request, yuanPer1k);
}

function estimateAtRate(request: InferenceRequest, yuanPer1k: number): number {
  const tokens =
    estimateInputTokens(request.messages) + (request.maxTokens ?? DEFAULT_OUTPUT_TOKENS);
  return Math.max(1, ceilYuanToMinor((tokens / 1000) * yuanPer1k));
}

type FrozenPrice = { provider: string; model: string; yuanPer1kTokens: number };

export function freezeInferenceQuote(request: InferenceRequest, candidates: readonly InferenceCandidate[]) {
  const prices = candidates.map(({ id, model }) => ({
    provider: id, model, ...resolveTextPrice({ provider: id, model }),
  }));
  if (prices.length === 0 || prices.some(price => !price.priced)) return null;
  return { prices, maxCostMinor: estimateAtRate(request, Math.max(...prices.map(p => p.yuanPer1kTokens))) };
}

function trustedTokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function tokensFromResponse(usage: InferenceOutcome["result"]["usage"]): number | null {
  const total = trustedTokens(usage?.total_tokens);
  const parts = [usage?.prompt_tokens, usage?.completion_tokens].filter(part => part !== undefined);
  if (total === null || parts.some(part => trustedTokens(part) === null)) return null;
  const subtotal = parts.reduce((sum, part) => sum + part, 0);
  return subtotal > total || (parts.length === 2 && subtotal !== total) ? null : total;
}

function costAtRate(tokens: number | null, rate: unknown): number | null {
  if (tokens === null || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  const minor = Math.round((tokens / 1000) * rate * MINOR_PER_YUAN);
  return Number.isSafeInteger(minor) ? minor : null;
}

const pendingUsage = "供应商用量待核对";

export async function settleAcceptedInference(
  operationId: string, outcome: InferenceOutcome, prices: readonly FrozenPrice[]
): Promise<SettleOperationResult> {
  const price = prices.find(p => p.provider === outcome.provider && p.model === outcome.model);
  const totalTokens = tokensFromResponse(outcome.result.usage);
  const costMinor = costAtRate(totalTokens, price?.yuanPer1kTokens);
  const receiptId = typeof outcome.result.id === "string" && outcome.result.id.length <= 191
    ? outcome.result.id || null : null;
  try {
    const attempt = await recordOperationProviderAttempt({
      operationId, attemptIndex: outcome.priorFailures.length + 1, receiptId,
      provider: outcome.provider, model: outcome.model,
      status: costMinor === null ? "submission_unknown" : "succeeded",
      usage: { kind: "inference_tokens", yuanPer1kTokens: price?.yuanPer1kTokens, totalTokens },
      costMinor,
    });
    if (attempt.kind !== "recorded") return { outcome: "missing" };
    return await settleOperation({
      operationId,
      outcome: costMinor === null ? { kind: "submission_unknown" } : { kind: "succeeded", verifiedCostMinor: costMinor },
    });
  } catch {
    // A successful model response is still usable. The recovery path uses
    // the original attempt, even if the settlement acknowledgement was lost.
    console.warn("[billing] inference settlement requires reconciliation", { operationId });
    return { outcome: "frozen", reason: pendingUsage };
  }
}

/** Server-only. A late receipt must come from authenticated provider evidence. */
export async function reconcileInferenceUsage(operationId: string, receipt?: {
  provider: string; model: string; receiptId: string; totalTokens: number;
}): Promise<SettleOperationResult | null> {
  const attempts = await listOperationProviderAttempts(operationId);
  const accepted = attempts.filter(a => {
    const usage = a.usage as { kind?: unknown } | null;
    return usage?.kind === "inference_tokens";
  });
  if (accepted.length !== 1) return null;
  const attempt = accepted[0];
  const usage = attempt.usage as { totalTokens?: unknown; yuanPer1kTokens?: unknown };
  const recorded = trustedTokens(usage.totalTokens);
  if (receipt && (
    !attempt.receiptId || receipt.receiptId !== attempt.receiptId ||
    receipt.provider !== attempt.provider || receipt.model !== attempt.model ||
    (recorded !== null && recorded !== receipt.totalTokens)
  )) return null;
  const tokens = recorded ?? trustedTokens(receipt?.totalTokens);
  const rate = usage.yuanPer1kTokens;
  const cost = costAtRate(tokens, rate);
  if (cost === null) return null;
  if (receipt && recorded === null && typeof rate === "number" && tokens !== null) {
    const first = await confirmProviderAttemptUsage(attempt.id, receipt.receiptId, {
      kind: "inference_tokens", yuanPer1kTokens: rate, totalTokens: tokens,
    }, cost);
    if (!first) {
      const current = (await listOperationProviderAttempts(operationId)).find(a => a.id === attempt.id);
      if ((current?.usage as { totalTokens?: unknown } | null)?.totalTokens !== tokens || current?.costMinor !== cost) return null;
    }
  }
  return settleOperation({ operationId, outcome: { kind: "succeeded", verifiedCostMinor: cost } });
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
