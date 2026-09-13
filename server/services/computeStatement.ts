import type {
  ComputeAccountStatement,
  ComputeStatementItem,
  ComputeStatementQuery,
  ComputeStatementStatus,
} from "../../shared/computeStatement";
import {
  COMPUTE_STATEMENT_MAX_OFFSET,
  COMPUTE_STATEMENT_MAX_PAGE_LIMIT,
  COMPUTE_STATEMENT_PAGE_LIMIT,
} from "../../shared/computeStatement";
import type { BillingOperationStatus } from "./computeBilling";
import { readAccountComputeStatementSnapshot } from "./computeLedger";

const STATEMENT_COVERAGE_NOTE =
  "这里只显示已经进入算力账本的调用。消费金额目前按系统记录展示；标记“估算”的金额尚未与供应商最终账单核对。状态不明的调用不会重复扣费或自动重提。";

function operationLabel(operationType: string): string {
  const labels: Record<string, string> = {
    "text.generate": "文字生成",
    "image.generate": "图片生成",
    "video.generate": "视频生成",
    personal_memory_extraction: "记忆整理",
    "tts.narration": "故事朗读",
    "audio.scene-generation": "故事配音",
  };
  return labels[operationType] ?? "AI 生成";
}

function assertNever(value: never): never {
  throw new Error(`未知计费状态：${String(value)}`);
}

function operationStatus(
  status: BillingOperationStatus
): ComputeStatementStatus {
  switch (status) {
    case "submission_unknown":
      return "reconciliation";
    case "reserved":
    case "created":
      return "reserved";
    case "submitted":
      return "processing";
    case "released":
      return "released";
    case "exception":
      return "exception";
    case "settled":
      return "posted";
    default:
      return assertNever(status);
  }
}

function entryLabel(entryType: string, operationType?: string): string {
  if (entryType === "consumption")
    return operationType ? operationLabel(operationType) : "AI 生成";
  if (entryType === "gift") return "赠送算力";
  if (entryType === "refund") return "费用退回";
  if (entryType === "release") return "预占释放";
  return "额度调整";
}

function isoDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function pageValue(
  value: number | undefined,
  fallback: number,
  maximum: number
): number {
  const requested = Number.isFinite(value) ? Math.trunc(value!) : fallback;
  return Math.max(0, Math.min(maximum, requested));
}

function normalizeQuery(query: ComputeStatementQuery) {
  return {
    attentionOffset: pageValue(
      query.attentionOffset,
      0,
      COMPUTE_STATEMENT_MAX_OFFSET
    ),
    attentionLimit: Math.max(
      1,
      pageValue(
        query.attentionLimit,
        COMPUTE_STATEMENT_PAGE_LIMIT,
        COMPUTE_STATEMENT_MAX_PAGE_LIMIT
      )
    ),
    historyOffset: pageValue(
      query.historyOffset,
      0,
      COMPUTE_STATEMENT_MAX_OFFSET
    ),
    historyLimit: Math.max(
      1,
      pageValue(
        query.historyLimit,
        COMPUTE_STATEMENT_PAGE_LIMIT,
        COMPUTE_STATEMENT_MAX_PAGE_LIMIT
      )
    ),
  };
}

/**
 * 当前用户的安全账单投影。
 *
 * 账本 entry 表示已经影响余额的事实；没有 entry 的 released operation 表示全额
 * 释放。待处理和历史分别分页，余额则始终来自包含全部预占的账户快照。
 */
export async function getAccountStatement(
  userId: number,
  query: ComputeStatementQuery = {}
): Promise<ComputeAccountStatement> {
  const page = normalizeQuery(query);
  const snapshot = await readAccountComputeStatementSnapshot({
    userId,
    ...page,
  });
  const operationsById = new Map(
    snapshot.entryOperations.map(operation => [
      operation.operationId,
      operation,
    ])
  );

  const posted: ComputeStatementItem[] = snapshot.ledgerEntries.map(entry => {
    const operation = entry.operationId
      ? operationsById.get(entry.operationId)
      : undefined;
    return {
      createdAt: isoDate(entry.createdAt),
      label: entryLabel(entry.entryType, operation?.operationType),
      amountMinor: Number(entry.amountMinor),
      reservedMinor: 0,
      releasedMinor: 0,
      status:
        entry.entryType === "consumption" && operation?.status === "exception"
          ? "exception"
          : "posted",
      // The current schema records a charge but not supplier reconciliation proof.
      estimated: entry.entryType === "consumption",
    };
  });
  const released: ComputeStatementItem[] = snapshot.releasedOperations.map(
    operation => ({
      createdAt: isoDate(operation.updatedAt),
      label: operationLabel(operation.operationType),
      amountMinor: 0,
      reservedMinor: 0,
      releasedMinor: Number(operation.maxCostMinor),
      status: operationStatus(operation.status),
      estimated: false,
    })
  );
  const attentionCandidates: ComputeStatementItem[] =
    snapshot.attentionOperations
      .map(operation => {
        const status = operationStatus(operation.status);
        return {
          createdAt: isoDate(operation.updatedAt),
          label: operationLabel(operation.operationType),
          amountMinor: 0,
          reservedMinor: Number(operation.maxCostMinor),
          releasedMinor: 0,
          status,
          estimated: true,
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const historyCandidates = [...posted, ...released].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
  const hasMoreAttentionRecords =
    attentionCandidates.length > page.attentionLimit;
  const canLoadMoreAttention =
    page.attentionOffset + page.attentionLimit <= COMPUTE_STATEMENT_MAX_OFFSET;
  const hasMoreHistoryRecords =
    historyCandidates.length > page.historyOffset + page.historyLimit;
  const canLoadMoreHistory =
    page.historyOffset + page.historyLimit <= COMPUTE_STATEMENT_MAX_OFFSET;

  return {
    version: 1,
    currency: "CNY",
    balance: {
      postedMinor: snapshot.summary.balanceMinor,
      reservedMinor: snapshot.summary.reservedMinor,
      availableMinor: snapshot.summary.availableMinor,
      lifetimeSpentMinor: snapshot.summary.lifetimeSpentMinor,
    },
    attentionItems: attentionCandidates.slice(0, page.attentionLimit),
    attentionHasMore: hasMoreAttentionRecords && canLoadMoreAttention,
    attentionTruncated: hasMoreAttentionRecords && !canLoadMoreAttention,
    historyItems: historyCandidates.slice(
      page.historyOffset,
      page.historyOffset + page.historyLimit
    ),
    historyHasMore: hasMoreHistoryRecords && canLoadMoreHistory,
    historyTruncated: hasMoreHistoryRecords && !canLoadMoreHistory,
    coverageNote: STATEMENT_COVERAGE_NOTE,
  };
}
