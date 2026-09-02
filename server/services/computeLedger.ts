/**
 * 算力账本的领域命令层。
 *
 * 把 `computeBilling.ts` 的纯判断接到 `server/db.ts` 的事务原语上，是业务代码
 * 唯一该调用的入口。这里不直接写表，也不发供应商请求——
 * **预占提交之后、结算开始之前**，才是调用供应商的窗口。
 */
import {
  appendCreditLedgerEntry,
  applyComputeSettlement,
  findActiveCreditHold,
  findBillingOperation,
  getCreditAccountSummary,
  reserveComputeCredit,
  type CreditAccountSummary,
} from "../db";
import {
  planReservation,
  planSettlement,
  type BillingOperationStatus,
  type ProviderOutcome,
} from "./computeBilling";

export type ReserveForOperationInput = {
  userId: number;
  operationId: string;
  operationType: string;
  /** 稳定参数的规范化哈希 */
  requestHash: string;
  /** 可信最高费用（微元） */
  maxCostMinor: number;
  storyId?: number | null;
  /** 高成本媒体报价的过期时间；文字调用传 null */
  quoteExpiresAt?: Date | null;
  now?: Date;
};

export type ReserveForOperationResult =
  | { outcome: "reserved"; amountMinor: number; availableMinor: number }
  | { outcome: "replayed"; status: BillingOperationStatus }
  | { outcome: "conflict"; reason: string }
  | { outcome: "insufficient_balance"; availableMinor: number; requiredMinor: number }
  | { outcome: "no_trusted_max_cost" }
  | { outcome: "quote_expired" };

/**
 * 预占：供应商调用之前必须先过这一关。
 *
 * 判断在 `planReservation` 里，落库在 `reserveComputeCredit` 的短事务里。
 * 两个并发请求同时走到这里时，锁在余额行上，只有一个能占住。
 */
export async function reserveForOperation(
  input: ReserveForOperationInput
): Promise<ReserveForOperationResult> {
  const now = input.now ?? new Date();
  const existingOperation = await findBillingOperation(input.operationId);

  const plan = planReservation({
    operationId: input.operationId,
    requestHash: input.requestHash,
    maxCostMinor: input.maxCostMinor,
    availableMinor: (await getCreditAccountSummary(input.userId)).availableMinor,
    existing: existingOperation
      ? {
          operationId: existingOperation.operationId,
          requestHash: existingOperation.requestHash,
          status: existingOperation.status,
          maxCostMinor: Number(existingOperation.maxCostMinor),
        }
      : null,
    quoteExpiresAt: input.quoteExpiresAt ?? null,
    now,
  });

  if (plan.action === "replay") return { outcome: "replayed", status: plan.status };
  if (plan.action === "conflict") return { outcome: "conflict", reason: plan.reason };
  if (plan.action === "reject") {
    if (plan.reason === "no_trusted_max_cost") return { outcome: "no_trusted_max_cost" };
    if (plan.reason === "quote_expired") return { outcome: "quote_expired" };
    const summary = await getCreditAccountSummary(input.userId);
    return {
      outcome: "insufficient_balance",
      availableMinor: summary.availableMinor,
      requiredMinor: input.maxCostMinor,
    };
  }

  // 上面读到的可用余额只是快照；真正的判定在事务的锁内重做一次。
  const reserved = await reserveComputeCredit({
    userId: input.userId,
    operationId: input.operationId,
    operationType: input.operationType,
    requestHash: input.requestHash,
    amountMinor: plan.amountMinor,
    storyId: input.storyId ?? null,
    quoteExpiresAt: input.quoteExpiresAt ?? null,
  });

  if (reserved.kind === "reserved") {
    return {
      outcome: "reserved",
      amountMinor: plan.amountMinor,
      availableMinor: reserved.availableMinor,
    };
  }
  if (reserved.kind === "insufficient") {
    return {
      outcome: "insufficient_balance",
      availableMinor: reserved.availableMinor,
      requiredMinor: reserved.requiredMinor,
    };
  }
  // 竞态：在快照与事务之间，同一个 operationId 被另一条路径抢先建立
  return reserved.requestHash === input.requestHash
    ? { outcome: "replayed", status: reserved.status }
    : {
        outcome: "conflict",
        reason: `operation ${input.operationId} 已存在且参数不同`,
      };
}

export type SettleOperationInput = {
  operationId: string;
  outcome: ProviderOutcome;
  reason?: string | null;
};

export type SettleOperationResult =
  | { outcome: "settled"; chargeMinor: number; releaseMinor: number; balanceMinor: number }
  | { outcome: "released"; releaseMinor: number; balanceMinor: number }
  | { outcome: "frozen"; reason: string }
  | {
      outcome: "exception";
      chargeMinor: number;
      overageMinor: number;
      balanceMinor: number;
      reason: string;
    }
  | { outcome: "already_final"; status: BillingOperationStatus }
  | { outcome: "missing" };

/**
 * 结算：供应商调用之后的独立短事务。
 *
 * `submission_unknown` 在这里只会得到 `frozen`——保留预占、进入对账。
 * 既不自动释放（可能让同一笔余额被消费两次），也不自动重提（可能产生双份费用）。
 */
export async function settleOperation(
  input: SettleOperationInput
): Promise<SettleOperationResult> {
  const operation = await findBillingOperation(input.operationId);
  if (!operation) return { outcome: "missing" };

  const hold = await findActiveCreditHold(input.operationId);
  const holdMinor = Number(hold?.amountMinor ?? 0);

  const plan = planSettlement({
    status: operation.status,
    holdMinor,
    outcome: input.outcome,
  });

  if (plan.action === "noop") {
    return { outcome: "already_final", status: operation.status };
  }

  if (plan.action === "freeze") {
    await applyComputeSettlement({
      operationId: input.operationId,
      chargeMinor: 0,
      releaseMinor: 0,
      nextOperationStatus: "submission_unknown",
      nextHoldStatus: "active",
      reason: plan.reason,
    });
    return { outcome: "frozen", reason: plan.reason };
  }

  if (plan.action === "release") {
    const applied = await applyComputeSettlement({
      operationId: input.operationId,
      chargeMinor: 0,
      releaseMinor: plan.releaseMinor,
      nextOperationStatus: "released",
      nextHoldStatus: "released",
      reason: input.reason ?? null,
    });
    return applied.kind === "applied"
      ? {
          outcome: "released",
          releaseMinor: plan.releaseMinor,
          balanceMinor: applied.balanceMinor,
        }
      : { outcome: "already_final", status: operation.status };
  }

  if (plan.action === "exception") {
    const applied = await applyComputeSettlement({
      operationId: input.operationId,
      chargeMinor: plan.chargeMinor,
      releaseMinor: plan.releaseMinor,
      nextOperationStatus: "exception",
      nextHoldStatus: "exception",
      reason: plan.reason,
    });
    return applied.kind === "applied"
      ? {
          outcome: "exception",
          chargeMinor: plan.chargeMinor,
          overageMinor: plan.overageMinor,
          balanceMinor: applied.balanceMinor,
          reason: plan.reason,
        }
      : { outcome: "already_final", status: operation.status };
  }

  const applied = await applyComputeSettlement({
    operationId: input.operationId,
    chargeMinor: plan.chargeMinor,
    releaseMinor: plan.releaseMinor,
    nextOperationStatus: "settled",
    nextHoldStatus: "settled",
    reason: input.reason ?? null,
  });
  return applied.kind === "applied"
    ? {
        outcome: "settled",
        chargeMinor: plan.chargeMinor,
        releaseMinor: plan.releaseMinor,
        balanceMinor: applied.balanceMinor,
      }
    : { outcome: "already_final", status: operation.status };
}

export async function getAccountBalance(
  userId: number
): Promise<CreditAccountSummary> {
  return getCreditAccountSummary(userId);
}

/** 赠送入账（赠送卡、旧邀请迁移补偿）。同一幂等键重复调用零新增。 */
export async function grantCredit(input: {
  userId: number;
  amountMinor: number;
  idempotencyKey: string;
  giftCardId?: number | null;
  reason?: string | null;
  /** 领卡同时开通工作台 */
  enableAccess?: boolean;
}) {
  if (input.amountMinor <= 0) {
    throw new Error("赠送金额必须为正");
  }
  return appendCreditLedgerEntry({
    userId: input.userId,
    entryType: "gift",
    amountMinor: input.amountMinor,
    idempotencyKey: input.idempotencyKey,
    giftCardId: input.giftCardId ?? null,
    reason: input.reason ?? null,
    enableAccess: input.enableAccess,
  });
}

/**
 * 人工调整。
 *
 * 只能追加新 entry，永远不去改旧的消费记录；操作者、时间、金额和原因都留痕。
 */
export async function recordAdjustment(input: {
  userId: number;
  /** 带符号：补偿为正，扣减为负 */
  amountMinor: number;
  actorUserId: number;
  reason: string;
  idempotencyKey: string;
}) {
  if (!input.reason.trim()) {
    throw new Error("人工调整必须写明原因");
  }
  return appendCreditLedgerEntry({
    userId: input.userId,
    entryType: "adjustment",
    amountMinor: input.amountMinor,
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
}
