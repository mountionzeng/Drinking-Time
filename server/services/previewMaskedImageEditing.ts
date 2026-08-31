import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { GeneratedImage } from "../../drizzle/schema";
import { estimateStoryboardMaskedEditCost } from "../../shared/imageRenderCost";
import { ENV } from "../_core/env";

export type PreviewMaskedImageTarget = {
  targetKind: "shot-primary" | "timeline-image-clip";
  stableShotId: string;
  clipId?: string | null;
};

export type PreviewMaskedImageQuote = PreviewMaskedImageTarget & {
  quoteId: string;
  storyId: number;
  imageId: number;
  maskKey: string;
  inputHash: string;
  currency: "CNY";
  estimatedCny: number;
  candidateCount: 1;
  expiresAt: number;
};

type OperationResult =
  | { status: "ok"; image: GeneratedImage }
  | {
      status: "error";
      message: string;
      providerTaskId?: string;
      submissionUncertain?: boolean;
    };

type Operation = {
  inputHash: string;
  promise: Promise<OperationResult>;
};

const operations = new Map<string, Operation>();

export function resetPreviewMaskedImageOperationsForTesting(): void {
  operations.clear();
}

export function previewMaskedImageInputHash(input: {
  storyId: number;
  userId: number;
  imageId: number;
  maskKey: string;
  prompt: string;
} & PreviewMaskedImageTarget): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        storyId: input.storyId,
        userId: input.userId,
        imageId: input.imageId,
        maskKey: input.maskKey,
        prompt: input.prompt.trim(),
        targetKind: input.targetKind,
        stableShotId: input.stableShotId,
        clipId: input.clipId ?? null,
        provider: "302",
        model: "gpt-image-1.5",
        priceVersion: "storyboard-masked-edit-v1",
      })
    )
    .digest("hex");
}

function quoteSigningKey(): string {
  const key = ENV.cookieSecret || ENV.api302Key;
  if (!key && ENV.isProduction) {
    throw new Error("服务器未配置局部图片修改报价签名密钥");
  }
  return key || "local-preview-masked-image-quote-key";
}

function quoteSignature(
  quote: Omit<PreviewMaskedImageQuote, "quoteId">
): string {
  return createHmac("sha256", quoteSigningKey())
    .update(JSON.stringify(quote))
    .digest("hex");
}

function quoteSignatureIsValid(quote: PreviewMaskedImageQuote): boolean {
  const { quoteId: _quoteId, ...unsigned } = quote;
  if (!/^[a-f0-9]{64}$/.test(quote.quoteId)) return false;
  const expected = Buffer.from(quoteSignature(unsigned), "hex");
  const actual = Buffer.from(quote.quoteId, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function quotePreviewMaskedImageEdit(input: {
  storyId: number;
  userId: number;
  imageId: number;
  maskKey: string;
  prompt: string;
  now?: number;
} & PreviewMaskedImageTarget): PreviewMaskedImageQuote {
  const estimate = estimateStoryboardMaskedEditCost();
  const unsigned: Omit<PreviewMaskedImageQuote, "quoteId"> = {
    storyId: input.storyId,
    imageId: input.imageId,
    maskKey: input.maskKey,
    targetKind: input.targetKind,
    stableShotId: input.stableShotId,
    clipId: input.clipId ?? null,
    inputHash: previewMaskedImageInputHash(input),
    currency: estimate.currency,
    estimatedCny: estimate.estimatedCny,
    candidateCount: 1,
    expiresAt: (input.now ?? Date.now()) + 10 * 60_000,
  };
  return { ...unsigned, quoteId: quoteSignature(unsigned) };
}

export function previewMaskedImageQuoteIsValid(input: {
  quote: PreviewMaskedImageQuote;
  storyId: number;
  userId: number;
  imageId: number;
  maskKey: string;
  prompt: string;
  now?: number;
} & PreviewMaskedImageTarget): boolean {
  const expectedHash = previewMaskedImageInputHash(input);
  const estimate = estimateStoryboardMaskedEditCost();
  return (
    quoteSignatureIsValid(input.quote) &&
    input.quote.expiresAt >= (input.now ?? Date.now()) &&
    input.quote.storyId === input.storyId &&
    input.quote.imageId === input.imageId &&
    input.quote.maskKey === input.maskKey &&
    input.quote.targetKind === input.targetKind &&
    input.quote.stableShotId === input.stableShotId &&
    (input.quote.clipId ?? null) === (input.clipId ?? null) &&
    input.quote.inputHash === expectedHash &&
    input.quote.currency === estimate.currency &&
    input.quote.estimatedCny === estimate.estimatedCny &&
    input.quote.candidateCount === 1
  );
}

/** Coalesce duplicate HTTP retries in this process. The task itself must first
 * acquire the durable database receipt before crossing the paid boundary. */
export async function runPreviewMaskedImageOperation(input: {
  operationToken: string;
  inputHash: string;
  task: () => Promise<OperationResult>;
}): Promise<OperationResult> {
  const existing = operations.get(input.operationToken);
  if (existing) {
    if (existing.inputHash !== input.inputHash) {
      return { status: "error", message: "这个费用确认已绑定另一组图片修改参数" };
    }
    return existing.promise;
  }
  const promise = input.task();
  operations.set(input.operationToken, { inputHash: input.inputHash, promise });
  void promise.then(
    () => {
      if (operations.get(input.operationToken)?.promise === promise) {
        operations.delete(input.operationToken);
      }
    },
    () => {
      if (operations.get(input.operationToken)?.promise === promise) {
        operations.delete(input.operationToken);
      }
    }
  );
  return promise;
}
