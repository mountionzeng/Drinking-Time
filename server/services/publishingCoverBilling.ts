import { createHash } from "node:crypto";
import { ceilYuanToMinor, formatComputeUnits } from "../../shared/computeMoney";
import type { ImageGenResult } from "./imageGen";
import { mediaBillingEnabled } from "./mediaComputeBilling";
import { reserveForOperation, settleOperation } from "./computeLedger";

/**
 * 发布稿封面 / 配图 / 正文底图的出图计费。
 *
 * 规则（与分镜出图、视频、配音一致）：
 * - 供应商调用之前按**服务端**报价预占；余额不足直接拦截，不出图。
 * - 同一个 operationToken 只对应一个 billing operation，重复点击 = replay，不会二次预占。
 * - 出图成功按报价结算；没有生成成功且供应商已明确失败 / 从未受理 → 释放。
 * - 结果不确定（连接中断、已受理但超时、已受理但本地没存下任务号）→ 冻结，保留预占进对账。
 */
export const PUBLISHING_COVER_OPERATION_TYPE = "image.publishing-cover";

export function publishingCoverOperationId(
  userId: number,
  storyId: number,
  operationToken: string
): string {
  const digest = createHash("sha256")
    .update(`${storyId}:${operationToken}`)
    .digest("hex")
    .slice(0, 40);
  return `media-cover-${userId}-${digest}`;
}

export class PublishingCoverBillingError extends Error {
  constructor(
    message: string,
    readonly code: "insufficient_balance" | "conflict"
  ) {
    super(message);
    this.name = "PublishingCoverBillingError";
  }
}

export type PublishingCoverReservation =
  | { billed: false; operationId: null }
  | { billed: true; operationId: string; maxCostMinor: number; replayed: boolean };

/** 只接受服务端算出来的报价（estimatePublishingCover*Cost），不要传前端值。 */
export async function reservePublishingCoverRender(input: {
  userId: number;
  storyId: number;
  operationToken: string;
  provider: string;
  serverEstimateCny: number;
}): Promise<PublishingCoverReservation> {
  if (!mediaBillingEnabled()) return { billed: false, operationId: null };
  const operationId = publishingCoverOperationId(
    input.userId,
    input.storyId,
    input.operationToken
  );
  const maxCostMinor = ceilYuanToMinor(input.serverEstimateCny);
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        storyId: input.storyId,
        operationToken: input.operationToken,
        provider: input.provider,
        maxCostMinor,
      })
    )
    .digest("hex");
  const result = await reserveForOperation({
    operationId,
    operationType: PUBLISHING_COVER_OPERATION_TYPE,
    userId: input.userId,
    storyId: input.storyId,
    maxCostMinor,
    requestHash,
  });
  if (result.outcome === "reserved" || result.outcome === "replayed") {
    return {
      billed: true,
      operationId,
      maxCostMinor,
      replayed: result.outcome === "replayed",
    };
  }
  if (result.outcome === "insufficient_balance") {
    throw new PublishingCoverBillingError(
      `算力余额不足：本次出图需要 ${formatComputeUnits(result.requiredMinor)} 算力，当前可用 ${formatComputeUnits(Math.max(0, result.availableMinor))} 算力。请充值后再生成，本次未出图、未扣费。`,
      "insufficient_balance"
    );
  }
  throw new PublishingCoverBillingError(
    "出图费用或请求已变化，请重新确认后再生成",
    "conflict"
  );
}

export type PublishingCoverRenderOutcome =
  | "succeeded"
  | "definite_failure"
  | "uncertain";

/** 把出图结果归类；只有供应商明确失败或从未受理才算 definite_failure。 */
export function classifyPublishingCoverRender(input: {
  generated: Pick<ImageGenResult, "status" | "submissionUncertain" | "providerTaskId" | "errorCode">;
  deliveredCount: number;
  hadPersistedTaskId: boolean;
}): PublishingCoverRenderOutcome {
  const { generated } = input;
  if (generated.status === "ok" && input.deliveredCount > 0) return "succeeded";
  if (
    generated.submissionUncertain === true ||
    generated.errorCode === "uncertain" ||
    generated.errorCode === "timeout_pending"
  ) {
    return "uncertain";
  }
  // 302 受理了新任务但本地没来得及存任务号：上游可能仍会出图，不能释放。
  if (generated.providerTaskId?.trim() && !input.hadPersistedTaskId) {
    return "uncertain";
  }
  return "definite_failure";
}

/** 没有 billing operation（旧轮次、本地免计费）时安全地什么都不做。 */
export async function finishPublishingCoverBilling(
  operationId: string | null,
  outcome: PublishingCoverRenderOutcome,
  reason?: string
) {
  if (!operationId) return { outcome: "skipped" as const };
  if (outcome === "succeeded") {
    const { findBillingOperation } = await import("../repositories/computeLedger");
    const operation = await findBillingOperation(operationId);
    if (!operation) return { outcome: "missing" as const };
    return settleOperation({
      operationId,
      outcome: {
        kind: "succeeded",
        verifiedCostMinor: Number(operation.maxCostMinor),
      },
      reason: "按出图前服务端报价结算（供应商未返回实际费用）",
    });
  }
  if (outcome === "definite_failure") {
    return settleOperation({
      operationId,
      outcome: { kind: "not_charged_failure" },
      reason: reason || "封面出图失败，未交付，释放预占",
    });
  }
  return settleOperation({
    operationId,
    outcome: { kind: "submission_unknown" },
    reason: reason || "封面出图结果不确定，保留预占待对账",
  });
}
