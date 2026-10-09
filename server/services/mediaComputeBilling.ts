import { createHash } from "node:crypto";
import type { VideoTake } from "../../drizzle/schema";
import { formatComputeUnits } from "../../shared/computeMoney";
import { findBillingOperation } from "../repositories/computeLedger";
import { isLocalUnlimitedCompute } from "./computeAccessPolicy";
import {
  reserveForOperation,
  settleOperation,
  recordOperationProviderAttempt,
  listOperationProviderAttempts,
} from "./computeLedger";

export function mediaBillingEnabled(): boolean {
  return process.env.NODE_ENV === "production" || isLocalUnlimitedCompute();
}

export function mediaOperationId(
  kind: string,
  userId: number,
  key: string
): string {
  return `media-${kind}-${userId}-${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

/** The atomic reservation is also the durable, cross-process submission claim. */
export async function reserveMedia(input: {
  operationId: string;
  userId: number;
  storyId: number;
  maxCostMinor: number;
  requestHash: string;
}) {
  const result = await reserveForOperation({
    ...input,
    operationType: input.operationId.startsWith("media-voice-")
      ? "media.voice"
      : "media.video",
  });
  if (result.outcome === "reserved" || result.outcome === "replayed")
    return result;
  if (result.outcome === "insufficient_balance") {
    throw new Error(
      `算力余额不足，需要 ${formatComputeUnits(result.requiredMinor)} 算力`
    );
  }
  throw new Error("生成费用或请求已变化，请重新确认");
}

export async function recordMediaResult(
  operationId: string,
  provider: string,
  result: Record<string, unknown>
) {
  const saved = await recordOperationProviderAttempt({
    operationId,
    attemptIndex: 1,
    provider,
    status: "submitted",
    usage: {
      ...result,
      pricingBasis: "product_quote",
      priceVersion: "media-2026-10-09",
    },
    providerTaskId: typeof result.taskId === "string" ? result.taskId : null,
  });
  if (saved.kind !== "recorded") throw new Error("生成结果未能保存到账本");
}

export async function readMediaResult(
  operationId: string
): Promise<Record<string, unknown> | null> {
  const attempts = await listOperationProviderAttempts(operationId);
  const result = attempts.find(
    attempt => attempt.status === "submitted"
  )?.usage;
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : null;
}

/** Providers currently return media/task IDs, not a monetary receipt. Label the
 * product quote explicitly; never call it a verified supplier invoice. */
export async function settleMediaQuote(operationId: string) {
  const operation = await findBillingOperation(operationId);
  if (!operation) throw new Error("生成费用记录不存在");
  return settleOperation({
    operationId,
    outcome: {
      kind: "succeeded",
      verifiedCostMinor: Number(operation.maxCostMinor),
    },
    reason: "按生成前产品报价结算（供应商未返回实际费用）",
  });
}

export async function finishVideoBilling(
  take: VideoTake,
  result: { videoUrl: string } | { unknown: true }
) {
  const metadata = take.parameterSnapshot as Record<string, unknown> | null;
  const operationId = metadata?.computeOperationId;
  if (typeof operationId !== "string") return; // Never charge legacy/free takes.
  const operation = await findBillingOperation(operationId);
  if (
    !operation ||
    operation.userId !== take.userId ||
    operation.storyId !== take.storyId
  ) {
    throw new Error("视频计费归属不匹配");
  }
  if ("videoUrl" in result) {
    await recordMediaResult(operationId, take.provider, {
      taskId: take.taskId,
      videoUrl: result.videoUrl,
      takeId: take.id,
    });
    await settleMediaQuote(operationId);
  } else {
    await settleOperation({
      operationId,
      outcome: { kind: "submission_unknown" },
    });
  }
}

/** Restore the provider handle when a process died before updating the Take. */
export async function recoverVideoReceipt(take: VideoTake): Promise<VideoTake> {
  const metadata = take.parameterSnapshot as Record<string, unknown> | null;
  const operationId = metadata?.computeOperationId;
  if (take.taskId || typeof operationId !== "string") return take;
  const operation = await findBillingOperation(operationId);
  if (
    !operation ||
    operation.userId !== take.userId ||
    operation.storyId !== take.storyId
  )
    return take;
  const receipt = await readMediaResult(operationId);
  const { updateVideoTake } = await import("../repositories/videos");
  if (typeof receipt?.taskId === "string") {
    return (
      (await updateVideoTake(take.id, take.userId, {
        taskId: receipt.taskId,
        status: "processing",
      })) ?? take
    );
  }
  if (
    typeof receipt?.videoUrl === "string" &&
    metadata?.kind !== "shot-start-end"
  ) {
    await settleMediaQuote(operationId);
    return (
      (await updateVideoTake(take.id, take.userId, {
        videoUrl: receipt.videoUrl,
        status: "available",
      })) ?? take
    );
  }
  return take;
}
