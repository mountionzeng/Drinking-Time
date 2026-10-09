/** Persistence operations for computeLedger. Local and MySQL behavior share this boundary. */
import { eq, and, desc, asc, gt, inArray, or, sql } from "drizzle-orm";
import { createKeyedSerialLock } from "../utils/keyedSerialLock";
import {
  creditAccounts,
  CreditAccount,
  creditLedgerEntries,
  CreditLedgerEntry,
  creditHolds,
  CreditHold,
  billingOperations,
  BillingOperation,
  providerAttempts,
  ProviderAttempt,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

// ══════════════════════════════════════════════════════════════════════
// 算力账本：不可改写的逐笔记录 + 事务内预占
//
// 事实来源是 append-only 的 credit_ledger_entries；credit_accounts 只是账本在
// 事务里维护的派生投影，存在的意义是让「检查余额 → 预占」能在一条
// SELECT ... FOR UPDATE 里原子完成，而不是每次去 SUM 全表。
//
// 这里**没有**通用的「直接设置余额」。人工调整也是新增一条 adjustment，
// 既有消费事实不可 update、不可 delete。
//
// 预占与结算是两个独立的短事务：供应商网络调用发生在它们之间，任何路径都不
// 跨网络持有余额行的锁。
// ══════════════════════════════════════════════════════════════════════

const memoryCreditAccountLock = createKeyedSerialLock<number>();

export type CreditAccountSummary = {
  userId: number;
  /** 已入账余额（微元） */
  balanceMinor: number;
  /** 活动预占合计（微元） */
  reservedMinor: number;
  /** 累计消费（微元） */
  lifetimeSpentMinor: number;
  /** 可用余额 = balanceMinor − reservedMinor */
  availableMinor: number;
  accessEnabledAt: Date | null;
};

function summarizeCreditAccount(
  userId: number,
  row: Pick<
    CreditAccount,
    "balanceMinor" | "reservedMinor" | "lifetimeSpentMinor" | "accessEnabledAt"
  > | null
): CreditAccountSummary {
  const balanceMinor = Number(row?.balanceMinor ?? 0);
  const reservedMinor = Number(row?.reservedMinor ?? 0);
  return {
    userId,
    balanceMinor,
    reservedMinor,
    lifetimeSpentMinor: Number(row?.lifetimeSpentMinor ?? 0),
    availableMinor: balanceMinor - reservedMinor,
    accessEnabledAt: row?.accessEnabledAt ?? null,
  };
}

function memoryCreditAccountRow(userId: number): CreditAccount {
  let row = memoryState.creditAccounts.find(item => item.userId === userId);
  if (!row) {
    const current = now();
    row = {
      id: nextMemoryId("creditAccount"),
      userId,
      balanceMinor: 0,
      reservedMinor: 0,
      lifetimeSpentMinor: 0,
      currency: "CNY",
      accessEnabledAt: null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.creditAccounts.push(row);
  }
  return row;
}

export async function getCreditAccountSummary(
  userId: number
): Promise<CreditAccountSummary> {
  const db = await getDb();
  if (!db) {
    const row =
      memoryState.creditAccounts.find(item => item.userId === userId) ?? null;
    return summarizeCreditAccount(userId, row);
  }

  const [row] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  return summarizeCreditAccount(userId, row ?? null);
}

export type ReserveComputeCreditInput = {
  userId: number;
  operationId: string;
  operationType: string;
  requestHash: string;
  /** 可信最高费用（微元），必须为正 */
  amountMinor: number;
  storyId?: number | null;
  quoteExpiresAt?: Date | null;
  /** 只供本机 development 的服务端策略使用，绝不来自客户端。 */
  allowNegativeBalance?: boolean;
};

export type ReserveComputeCreditResult =
  | { kind: "reserved"; availableMinor: number }
  /** 同一 operationId 已存在。调用方比对 requestHash 决定是重放还是冲突 */
  | {
      kind: "existing";
      status: BillingOperation["status"];
      requestHash: string;
    }
  | { kind: "insufficient"; availableMinor: number; requiredMinor: number };

/**
 * 在一个短事务里锁定账号余额行、检查可用余额、建立 operation 与 hold。
 *
 * 可用余额的比较必须发生在锁内——这是并发两个预占不能同时通过的唯一保证。
 * 业务侧的重放/冲突/上界/报价判断在 `computeBilling.planReservation` 里，
 * 这里只做那件必须原子的事。
 */
export async function reserveComputeCredit(
  input: ReserveComputeCreditInput
): Promise<ReserveComputeCreditResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`预占金额必须是正的安全整数微元：${input.amountMinor}`);
  }

  const db = await getDb();
  if (!db) {
    return memoryCreditAccountLock.run(input.userId, async () => {
      const existing = memoryState.billingOperations.find(
        item => item.operationId === input.operationId
      );
      if (existing) {
        return {
          kind: "existing" as const,
          status: existing.status,
          requestHash: existing.requestHash,
        };
      }

      const account = memoryCreditAccountRow(input.userId);
      const availableMinor =
        Number(account.balanceMinor) - Number(account.reservedMinor);
      if (!input.allowNegativeBalance && availableMinor < input.amountMinor) {
        return {
          kind: "insufficient" as const,
          availableMinor,
          requiredMinor: input.amountMinor,
        };
      }

      const current = now();
      memoryState.billingOperations.push({
        id: nextMemoryId("billingOperation"),
        userId: input.userId,
        operationId: input.operationId,
        operationType: input.operationType,
        requestHash: input.requestHash,
        status: "reserved",
        maxCostMinor: input.amountMinor,
        actualCostMinor: null,
        storyId: input.storyId ?? null,
        quoteExpiresAt: input.quoteExpiresAt ?? null,
        createdAt: current,
        updatedAt: current,
      });
      memoryState.creditHolds.push({
        id: nextMemoryId("creditHold"),
        userId: input.userId,
        operationId: input.operationId,
        amountMinor: input.amountMinor,
        status: "active",
        createdAt: current,
        updatedAt: current,
      });
      account.reservedMinor = Number(account.reservedMinor) + input.amountMinor;
      account.updatedAt = current;
      await persistMemoryState();
      return {
        kind: "reserved" as const,
        availableMinor: availableMinor - input.amountMinor,
      };
    });
  }

  return db.transaction(async tx => {
    await tx
      .insert(creditAccounts)
      .values({ userId: input.userId })
      .onDuplicateKeyUpdate({ set: { userId: input.userId } });

    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, input.userId))
      .for("update")
      .limit(1);

    const [existing] = await tx
      .select()
      .from(billingOperations)
      .where(eq(billingOperations.operationId, input.operationId))
      .limit(1);
    if (existing) {
      return {
        kind: "existing" as const,
        status: existing.status,
        requestHash: existing.requestHash,
      };
    }

    const availableMinor =
      Number(account?.balanceMinor ?? 0) - Number(account?.reservedMinor ?? 0);
    if (!input.allowNegativeBalance && availableMinor < input.amountMinor) {
      return {
        kind: "insufficient" as const,
        availableMinor,
        requiredMinor: input.amountMinor,
      };
    }

    await tx.insert(billingOperations).values({
      userId: input.userId,
      operationId: input.operationId,
      operationType: input.operationType,
      requestHash: input.requestHash,
      status: "reserved",
      maxCostMinor: input.amountMinor,
      storyId: input.storyId ?? null,
      quoteExpiresAt: input.quoteExpiresAt ?? null,
    });
    await tx.insert(creditHolds).values({
      userId: input.userId,
      operationId: input.operationId,
      amountMinor: input.amountMinor,
      status: "active",
    });
    await tx
      .update(creditAccounts)
      .set({
        reservedMinor: sql`${creditAccounts.reservedMinor} + ${input.amountMinor}`,
      })
      .where(eq(creditAccounts.userId, input.userId));

    return {
      kind: "reserved" as const,
      availableMinor: availableMinor - input.amountMinor,
    };
  });
}

export type ApplyComputeSettlementInput = {
  operationId: string;
  /** 实际扣款（微元），可以是 0 */
  chargeMinor: number;
  /** 放回的预占（微元），可以是 0 */
  releaseMinor: number;
  nextOperationStatus: BillingOperation["status"];
  nextHoldStatus: CreditHold["status"];
  reason?: string | null;
};

export type ApplyComputeSettlementResult =
  | {
      kind: "applied";
      balanceMinor: number;
      reservedMinor: number;
      lifetimeSpentMinor: number;
      chargeMinor: number;
    }
  /** operation 已处于终态：最终结算只发生一次 */
  | { kind: "already_final"; status: BillingOperation["status"] }
  | { kind: "missing" };

/**
 * 结算/释放/冻结：一个独立的短事务，发生在供应商调用之后。
 *
 * 幂等靠两层：operation 的终态检查（在锁内）+ 账本 `idempotencyKey` 的唯一约束。
 * 重放同一次结算只会得到 `already_final`，不会二次扣费。
 */
export async function applyComputeSettlement(
  input: ApplyComputeSettlementInput
): Promise<ApplyComputeSettlementResult> {
  const chargeMinor = Number(input.chargeMinor);
  const releaseMinor = Number(input.releaseMinor);
  if (
    !Number.isSafeInteger(chargeMinor) ||
    !Number.isSafeInteger(releaseMinor) ||
    chargeMinor < 0 ||
    releaseMinor < 0
  ) {
    throw new Error("结算金额必须是非负的安全整数微元");
  }
  const reservedDelta = chargeMinor + releaseMinor;
  const finalStatuses = new Set(["settled", "released", "exception"]);

  const db = await getDb();
  if (!db) {
    const operationPeek = memoryState.billingOperations.find(
      item => item.operationId === input.operationId
    );
    if (!operationPeek) return { kind: "missing" };

    return memoryCreditAccountLock.run(operationPeek.userId, async () => {
      const operation = memoryState.billingOperations.find(
        item => item.operationId === input.operationId
      );
      if (!operation) return { kind: "missing" as const };
      if (finalStatuses.has(operation.status)) {
        return { kind: "already_final" as const, status: operation.status };
      }

      const account = memoryCreditAccountRow(operation.userId);
      const current = now();
      if (chargeMinor > 0 || input.nextOperationStatus === "settled") {
        memoryState.creditLedgerEntries.push({
          id: nextMemoryId("creditLedgerEntry"),
          userId: operation.userId,
          entryType: "consumption",
          amountMinor: -chargeMinor,
          currency: "CNY",
          idempotencyKey: `consume:${input.operationId}`,
          operationId: input.operationId,
          giftCardId: null,
          actorUserId: null,
          reason: input.reason ?? null,
          createdAt: current,
        });
        account.balanceMinor = Number(account.balanceMinor) - chargeMinor;
        account.lifetimeSpentMinor =
          Number(account.lifetimeSpentMinor) + chargeMinor;
      }
      account.reservedMinor = Number(account.reservedMinor) - reservedDelta;
      account.updatedAt = current;

      operation.status = input.nextOperationStatus;
      operation.actualCostMinor = finalStatuses.has(input.nextOperationStatus)
        ? chargeMinor
        : operation.actualCostMinor;
      operation.updatedAt = current;

      const hold = memoryState.creditHolds.find(
        item => item.operationId === input.operationId
      );
      if (hold) {
        hold.status = input.nextHoldStatus;
        hold.updatedAt = current;
      }
      await persistMemoryState();
      return {
        kind: "applied" as const,
        balanceMinor: Number(account.balanceMinor),
        reservedMinor: Number(account.reservedMinor),
        lifetimeSpentMinor: Number(account.lifetimeSpentMinor),
        chargeMinor,
      };
    });
  }

  return db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(billingOperations)
      .where(eq(billingOperations.operationId, input.operationId))
      .for("update")
      .limit(1);
    if (!operation) return { kind: "missing" as const };
    if (finalStatuses.has(operation.status)) {
      return { kind: "already_final" as const, status: operation.status };
    }

    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, operation.userId))
      .for("update")
      .limit(1);

    if (chargeMinor > 0 || input.nextOperationStatus === "settled") {
      await tx.insert(creditLedgerEntries).values({
        userId: operation.userId,
        entryType: "consumption",
        amountMinor: -chargeMinor,
        idempotencyKey: `consume:${input.operationId}`,
        operationId: input.operationId,
        reason: input.reason ?? null,
      });
    }

    const nextBalance = Number(account?.balanceMinor ?? 0) - chargeMinor;
    const nextReserved = Number(account?.reservedMinor ?? 0) - reservedDelta;
    const nextLifetime = Number(account?.lifetimeSpentMinor ?? 0) + chargeMinor;
    await tx
      .update(creditAccounts)
      .set({
        balanceMinor: nextBalance,
        reservedMinor: nextReserved,
        lifetimeSpentMinor: nextLifetime,
      })
      .where(eq(creditAccounts.userId, operation.userId));

    await tx
      .update(billingOperations)
      .set({
        status: input.nextOperationStatus,
        ...(finalStatuses.has(input.nextOperationStatus)
          ? { actualCostMinor: chargeMinor }
          : {}),
      })
      .where(eq(billingOperations.operationId, input.operationId));
    await tx
      .update(creditHolds)
      .set({ status: input.nextHoldStatus })
      .where(eq(creditHolds.operationId, input.operationId));

    return {
      kind: "applied" as const,
      balanceMinor: nextBalance,
      reservedMinor: nextReserved,
      lifetimeSpentMinor: nextLifetime,
      chargeMinor,
    };
  });
}

export type AppendCreditEntryInput = {
  userId: number;
  // Purchases require an order and the dedicated atomic settlement transaction.
  entryType: Exclude<CreditLedgerEntry["entryType"], "purchase">;
  /** 带符号金额（微元）：赠送/退款为正，人工扣减为负 */
  amountMinor: number;
  /** 业务幂等键。重复写入被唯一约束挡下 */
  idempotencyKey: string;
  /** Registration gifts additionally deduplicate across identities of one account. */
  oncePerAccountPrefix?: string;
  giftCardId?: number | null;
  actorUserId?: number | null;
  reason?: string | null;
  /** 领卡开通工作台时一并写入 */
  enableAccess?: boolean;
};

export type AppendCreditEntryResult =
  | { kind: "appended"; balanceMinor: number }
  /** 同一幂等键已经写过：重复赠送/重复迁移在这里被挡下 */
  | { kind: "duplicate" };

/**
 * 往账本追加一条记录（赠送、人工调整、退款），并同步余额投影。
 *
 * 这是唯一的入账口径，没有「直接设置余额」的旁路。重复迁移和重复领卡靠
 * `idempotencyKey` 的唯一约束收敛为零新增。
 */
export async function appendCreditLedgerEntry(
  input: AppendCreditEntryInput
): Promise<AppendCreditEntryResult> {
  if ((input.entryType as string) === "purchase") {
    throw new Error("充值必须通过订单结算入账");
  }
  if (!Number.isSafeInteger(input.amountMinor)) {
    throw new Error(`账本金额必须是安全整数微元：${input.amountMinor}`);
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("账本写入必须带幂等键");
  }

  const db = await getDb();
  if (!db) {
    return memoryCreditAccountLock.run(input.userId, async () => {
      const duplicate = memoryState.creditLedgerEntries.some(
        item => item.idempotencyKey === input.idempotencyKey ||
          (Boolean(input.oncePerAccountPrefix) && item.userId === input.userId &&
            Boolean(item.idempotencyKey?.startsWith(input.oncePerAccountPrefix!)))
      );
      if (duplicate) return { kind: "duplicate" as const };

      const account = memoryCreditAccountRow(input.userId);
      const current = now();
      memoryState.creditLedgerEntries.push({
        id: nextMemoryId("creditLedgerEntry"),
        userId: input.userId,
        entryType: input.entryType,
        amountMinor: input.amountMinor,
        currency: "CNY",
        idempotencyKey: input.idempotencyKey,
        operationId: null,
        giftCardId: input.giftCardId ?? null,
        actorUserId: input.actorUserId ?? null,
        reason: input.reason ?? null,
        createdAt: current,
      });
      account.balanceMinor = Number(account.balanceMinor) + input.amountMinor;
      if (input.enableAccess && !account.accessEnabledAt) {
        account.accessEnabledAt = current;
      }
      account.updatedAt = current;
      await persistMemoryState();
      return {
        kind: "appended" as const,
        balanceMinor: Number(account.balanceMinor),
      };
    });
  }

  return db.transaction(async tx => {
    await tx
      .insert(creditAccounts)
      .values({ userId: input.userId })
      .onDuplicateKeyUpdate({ set: { userId: input.userId } });
    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, input.userId))
      .for("update")
      .limit(1);

    const [duplicate] = await tx
      .select({ id: creditLedgerEntries.id })
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (duplicate) return { kind: "duplicate" as const };

    if (input.oncePerAccountPrefix) {
      const [accountGift] = await tx.select({ id: creditLedgerEntries.id })
        .from(creditLedgerEntries)
        .where(and(eq(creditLedgerEntries.userId, input.userId),
          sql`LEFT(${creditLedgerEntries.idempotencyKey}, ${input.oncePerAccountPrefix.length}) = ${input.oncePerAccountPrefix}`))
        .limit(1);
      if (accountGift) return { kind: "duplicate" as const };
    }

    await tx.insert(creditLedgerEntries).values({
      userId: input.userId,
      entryType: input.entryType,
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey,
      giftCardId: input.giftCardId ?? null,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
    });

    const nextBalance = Number(account?.balanceMinor ?? 0) + input.amountMinor;
    await tx
      .update(creditAccounts)
      .set({
        balanceMinor: nextBalance,
        ...(input.enableAccess && !account?.accessEnabledAt
          ? { accessEnabledAt: new Date() }
          : {}),
      })
      .where(eq(creditAccounts.userId, input.userId));

    return { kind: "appended" as const, balanceMinor: nextBalance };
  });
}

export async function listCreditLedgerEntries(
  userId: number,
  limit = 50
): Promise<CreditLedgerEntry[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.creditLedgerEntries
      .filter(item => item.userId === userId)
      .sort((left, right) => right.id - left.id)
      .slice(0, limit)
      .map(item => ({ ...item }));
  }

  return db
    .select()
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.userId, userId))
    .orderBy(desc(creditLedgerEntries.id))
    .limit(limit);
}

export async function findBillingOperation(
  operationId: string
): Promise<BillingOperation | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.billingOperations.find(
        item => item.operationId === operationId
      ) ?? null
    );
  }

  const [operation] = await db
    .select()
    .from(billingOperations)
    .where(eq(billingOperations.operationId, operationId))
    .limit(1);
  return operation ?? null;
}

export type ComputeStatementSnapshot = {
  summary: CreditAccountSummary;
  /** 从最新开始的候选窗口；由服务层合并两种历史来源后再做 offset。 */
  ledgerEntries: CreditLedgerEntry[];
  releasedOperations: BillingOperation[];
  /** 只含 ledgerEntries 所引用、且属于同一用户的 operation。 */
  entryOperations: BillingOperation[];
  /** 当前待处理页多取一条，供服务层判断 hasMore。 */
  attentionOperations: BillingOperation[];
};

export type ComputeStatementSnapshotInput = {
  userId: number;
  attentionOffset: number;
  attentionLimit: number;
  historyOffset: number;
  historyLimit: number;
};

/**
 * 在一份数据库快照里读取余额、账本和操作状态。
 *
 * 账务结算会同时更新这些表；如果分别发起独立查询，用户可能短暂看到“余额已扣、
 * 明细仍在预占”的自相矛盾页面。MySQL 使用 repeatable-read consistent snapshot，
 * 本地模式则在没有 await 间隙的同步区间内复制所有相关数组。
 */
export async function readComputeStatementSnapshot(
  input: ComputeStatementSnapshotInput
): Promise<ComputeStatementSnapshot> {
  const attentionTake = input.attentionLimit + 1;
  const historyTake = input.historyOffset + input.historyLimit + 1;
  const nonterminal = new Set<BillingOperation["status"]>([
    "created",
    "reserved",
    "submitted",
    "submission_unknown",
  ]);
  const db = await getDb();
  if (!db) {
    const summary = summarizeCreditAccount(
      input.userId,
      memoryState.creditAccounts.find(item => item.userId === input.userId) ??
        null
    );
    const ledgerEntries = memoryState.creditLedgerEntries
      .filter(item => item.userId === input.userId)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id - left.id
      )
      .slice(0, historyTake)
      .map(item => ({ ...item }));
    const releasedOperations = memoryState.billingOperations
      .filter(
        item => item.userId === input.userId && item.status === "released"
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.id - left.id
      )
      .slice(0, historyTake)
      .map(item => ({ ...item }));
    const wanted = new Set(
      ledgerEntries.flatMap(item =>
        item.operationId ? [item.operationId] : []
      )
    );
    const entryOperations = memoryState.billingOperations
      .filter(
        item => item.userId === input.userId && wanted.has(item.operationId)
      )
      .map(item => ({ ...item }));
    const attentionOperations = memoryState.billingOperations
      .filter(
        item => item.userId === input.userId && nonterminal.has(item.status)
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.id - left.id
      )
      .slice(input.attentionOffset, input.attentionOffset + attentionTake)
      .map(item => ({ ...item }));
    return {
      summary,
      ledgerEntries,
      releasedOperations,
      entryOperations,
      attentionOperations,
    };
  }

  return db.transaction(
    async tx => {
      const [account] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, input.userId))
        .limit(1);
      const ledgerEntries = await tx
        .select()
        .from(creditLedgerEntries)
        .where(eq(creditLedgerEntries.userId, input.userId))
        .orderBy(
          desc(creditLedgerEntries.createdAt),
          desc(creditLedgerEntries.id)
        )
        .limit(historyTake);
      const releasedOperations = await tx
        .select()
        .from(billingOperations)
        .where(
          and(
            eq(billingOperations.userId, input.userId),
            eq(billingOperations.status, "released")
          )
        )
        .orderBy(desc(billingOperations.updatedAt), desc(billingOperations.id))
        .limit(historyTake);
      const operationIds = [
        ...new Set(
          ledgerEntries.flatMap(item =>
            item.operationId ? [item.operationId] : []
          )
        ),
      ];
      const entryOperations = operationIds.length
        ? await tx
            .select()
            .from(billingOperations)
            .where(
              and(
                eq(billingOperations.userId, input.userId),
                inArray(billingOperations.operationId, operationIds)
              )
            )
        : [];
      const attentionOperations = await tx
        .select()
        .from(billingOperations)
        .where(
          and(
            eq(billingOperations.userId, input.userId),
            or(
              eq(billingOperations.status, "created"),
              eq(billingOperations.status, "reserved"),
              eq(billingOperations.status, "submitted"),
              eq(billingOperations.status, "submission_unknown")
            )
          )
        )
        .orderBy(desc(billingOperations.updatedAt), desc(billingOperations.id))
        .limit(attentionTake)
        .offset(input.attentionOffset);
      return {
        summary: summarizeCreditAccount(input.userId, account ?? null),
        ledgerEntries,
        releasedOperations,
        entryOperations,
        attentionOperations,
      };
    },
    {
      isolationLevel: "repeatable read",
      withConsistentSnapshot: true,
      accessMode: "read only",
    }
  );
}

export async function findActiveCreditHold(
  operationId: string
): Promise<CreditHold | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.creditHolds.find(
        item => item.operationId === operationId && item.status === "active"
      ) ?? null
    );
  }

  const [hold] = await db
    .select()
    .from(creditHolds)
    .where(
      and(
        eq(creditHolds.operationId, operationId),
        eq(creditHolds.status, "active")
      )
    )
    .limit(1);
  return hold ?? null;
}

export type RecordProviderAttemptInput = {
  operationId: string;
  attemptIndex: number;
  provider: string;
  model?: string | null;
  providerTaskId?: string | null;
  receiptId?: string | null;
  status: ProviderAttempt["status"];
  usage?: unknown;
  costMinor?: number | null;
};

/**
 * 记录一次供应商尝试。
 *
 * 供应商层与业务层分开：这里记 fallback、重试和真实用量，但**不动余额**——
 * 扣费只发生在业务层的一次结算里，避免 adapter 重复扣费。
 */
export async function recordProviderAttempt(
  input: RecordProviderAttemptInput
): Promise<{ kind: "recorded" } | { kind: "missing_operation" }> {
  const operation = await findBillingOperation(input.operationId);
  if (!operation) return { kind: "missing_operation" };

  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.providerAttempts.find(
      item =>
        item.billingOperationId === operation.id &&
        item.attemptIndex === input.attemptIndex
    );
    if (existing) {
      existing.status = input.status;
      existing.providerTaskId = input.providerTaskId ?? existing.providerTaskId;
      existing.receiptId = input.receiptId ?? existing.receiptId;
      existing.usage = (input.usage ??
        existing.usage) as ProviderAttempt["usage"];
      existing.costMinor = input.costMinor ?? existing.costMinor;
      existing.updatedAt = current;
      await persistMemoryState();
      return { kind: "recorded" };
    }
    memoryState.providerAttempts.push({
      id: nextMemoryId("providerAttempt"),
      billingOperationId: operation.id,
      attemptIndex: input.attemptIndex,
      provider: input.provider,
      model: input.model ?? null,
      providerTaskId: input.providerTaskId ?? null,
      receiptId: input.receiptId ?? null,
      status: input.status,
      usage: (input.usage ?? null) as ProviderAttempt["usage"],
      costMinor: input.costMinor ?? null,
      submittedAt: null,
      completedAt: null,
      createdAt: current,
      updatedAt: current,
    });
    await persistMemoryState();
    return { kind: "recorded" };
  }

  await db
    .insert(providerAttempts)
    .values({
      billingOperationId: operation.id,
      attemptIndex: input.attemptIndex,
      provider: input.provider,
      model: input.model ?? null,
      providerTaskId: input.providerTaskId ?? null,
      receiptId: input.receiptId ?? null,
      status: input.status,
      usage: input.usage ?? null,
      costMinor: input.costMinor ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        status: input.status,
        providerTaskId: input.providerTaskId ?? null,
        receiptId: input.receiptId ?? null,
        usage: input.usage ?? null,
        costMinor: input.costMinor ?? null,
      },
    });
  return { kind: "recorded" };
}

export async function listProviderAttemptsForOperation(
  operationId: string
): Promise<ProviderAttempt[]> {
  const operation = await findBillingOperation(operationId);
  if (!operation) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.providerAttempts
      .filter(item => item.billingOperationId === operation.id)
      .sort((left, right) => left.attemptIndex - right.attemptIndex)
      .map(item => ({ ...item }));
  }
  return db
    .select()
    .from(providerAttempts)
    .where(eq(providerAttempts.billingOperationId, operation.id))
    .orderBy(providerAttempts.attemptIndex);
}

/** Bounded keyset scan for media recovery; no business content is loaded. */
export async function listUnsettledMediaOperations(afterId = 0, limit = 25): Promise<BillingOperation[]> {
  const db = await getDb();
  const statuses = ["reserved", "submitted", "submission_unknown"] as const;
  if (!db) return memoryState.billingOperations.filter(row =>
    row.id > afterId && ["media.voice", "media.video"].includes(row.operationType) && statuses.some(status => status === row.status)
  ).sort((a, b) => a.id - b.id).slice(0, limit);
  return db.select().from(billingOperations).where(and(
    gt(billingOperations.id, afterId), inArray(billingOperations.operationType, ["media.voice", "media.video"]),
    inArray(billingOperations.status, [...statuses]),
  )).orderBy(asc(billingOperations.id)).limit(limit);
}
