/**
 * 陈旧预占的对账判定——纯函数，不写库。
 *
 * 这里只回答一件事：一笔挂了很久的预占该怎么处置。核心立场是
 * **超时永远不是释放的理由**。
 *
 * 释放一笔其实已经提交并产生费用的调用，等于让同一笔余额被消费两次；
 * 重提一笔状态未知的调用，等于制造双份供应商费用。所以只有「明确证明未提交」
 * 才释放，只有「已经拿到 task id」才去查询，其余一律冻结转人工。
 */
import { planRecovery, type BillingOperationStatus } from "./computeBilling";

export type StaleHoldInput = {
  operationId: string;
  operationType: string;
  status: BillingOperationStatus;
  amountMinor: number;
  createdAt: Date;
  providerTaskIdKnown: boolean;
  /** 明确证明没有提交给供应商——不是「超时了大概没提交」 */
  provenNotSubmitted: boolean;
};

export type ReconciliationAction =
  | "none"
  | "wait"
  | "release"
  | "resume_query"
  | "hold_for_manual";

export type ReconciliationDecision = {
  operationId: string;
  action: ReconciliationAction;
  /** 这笔判定能放回多少预占；只有 release 才是非零 */
  releasesMinor: number;
  reason: string;
};

export type ReconciliationOptions = {
  /** 超过多久算陈旧 */
  staleAfterMs: number;
};

export function classifyStaleHold(
  context: { input: StaleHoldInput; now: Date },
  options: ReconciliationOptions
): ReconciliationDecision {
  const { input, now } = context;
  const recovery = planRecovery({
    status: input.status,
    providerTaskIdKnown: input.providerTaskIdKnown,
    provenNotSubmitted: input.provenNotSubmitted,
  });

  if (recovery.action === "none") {
    return {
      operationId: input.operationId,
      action: "none",
      releasesMinor: 0,
      reason: `operation 已处于终态 ${input.status}`,
    };
  }

  const ageMs = now.getTime() - input.createdAt.getTime();
  if (ageMs < options.staleAfterMs) {
    return {
      operationId: input.operationId,
      action: "wait",
      releasesMinor: 0,
      reason: "还没到陈旧阈值，正常调用本来就需要时间",
    };
  }

  if (recovery.action === "release") {
    return {
      operationId: input.operationId,
      action: "release",
      releasesMinor: input.amountMinor,
      reason: "已明确证明未提交给供应商，可以安全释放预占",
    };
  }

  if (recovery.action === "resume_query") {
    return {
      operationId: input.operationId,
      action: "resume_query",
      releasesMinor: 0,
      reason: "已有供应商 task id：只恢复查询，不重提、不释放",
    };
  }

  return {
    operationId: input.operationId,
    action: "hold_for_manual",
    releasesMinor: 0,
    reason:
      "提交结果不确定：保留预占并转人工对账。超时本身不能作为释放理由——" +
      "释放可能让同一笔余额被消费两次。",
  };
}

export type ReconciliationSummary = {
  releasable: ReconciliationDecision[];
  resumeQuery: ReconciliationDecision[];
  manual: ReconciliationDecision[];
  waiting: ReconciliationDecision[];
  /** 可以安全放回的预占合计 */
  releasableMinor: number;
  /** 因为状态不确定而被冻结的预占合计——这是要给管理员看的数字 */
  frozenMinor: number;
};

export function summarizeReconciliation(
  holds: StaleHoldInput[],
  context: { now: Date } & ReconciliationOptions
): ReconciliationSummary {
  const decisions = holds.map(input =>
    classifyStaleHold({ input, now: context.now }, context)
  );
  const byAction = (action: ReconciliationAction) =>
    decisions.filter(item => item.action === action);

  const releasable = byAction("release");
  const manual = byAction("hold_for_manual");
  const amountOf = (operationId: string) =>
    holds.find(item => item.operationId === operationId)?.amountMinor ?? 0;

  return {
    releasable,
    resumeQuery: byAction("resume_query"),
    manual,
    waiting: byAction("wait"),
    releasableMinor: releasable.reduce(
      (total, item) => total + item.releasesMinor,
      0
    ),
    frozenMinor: manual.reduce(
      (total, item) => total + amountOf(item.operationId),
      0
    ),
  };
}
