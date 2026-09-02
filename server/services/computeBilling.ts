/**
 * 付费操作的状态机——纯函数，不碰数据库，也不碰网络。
 *
 * 这里回答的是「该怎么做」，`computeLedger.ts` 才负责「在事务里做」。
 * 分开的原因很实际：预占和结算的判断逻辑是整套计费最容易出错的地方，
 * 把它做成纯函数才能穷举并发、失败、重试、回调乱序和崩溃恢复这些分支。
 *
 * 三条不可破坏的合同贯穿全文：
 *  1. 数据库事务不跨供应商网络调用——先提交预占，再调 provider，最后用新事务结算。
 *  2. `submission_unknown` 既不自动释放也不自动重提，只能进对账。
 *  3. 任何路径都不制造用户负余额。
 */
import { assertMinorAmount, subtractMinor } from "../../shared/computeMoney";

export type BillingOperationStatus =
  | "created"
  | "reserved"
  | "submitted"
  | "submission_unknown"
  | "settled"
  | "released"
  | "exception";

const TERMINAL_STATUSES: ReadonlySet<BillingOperationStatus> = new Set([
  "settled",
  "released",
  "exception",
]);

export type ExistingBillingOperation = {
  operationId: string;
  requestHash: string;
  status: BillingOperationStatus;
  maxCostMinor: number;
};

export type ReservationInput = {
  operationId: string;
  requestHash: string;
  /** 可信最高费用（微元）。拿不到可信上界的入口不允许提交 */
  maxCostMinor: number;
  /** 已入账余额 − 活动预占 */
  availableMinor: number;
  existing: ExistingBillingOperation | null;
  /** 高成本媒体报价的过期时间；文字调用没有报价，传 null */
  quoteExpiresAt: Date | null;
  now: Date;
};

export type ReservationPlan =
  | { action: "reserve"; amountMinor: number }
  | { action: "replay"; status: BillingOperationStatus }
  | { action: "conflict"; reason: string }
  | {
      action: "reject";
      reason: "insufficient_balance" | "no_trusted_max_cost" | "quote_expired";
    };

/**
 * 决定这次调用能不能预占。
 *
 * 顺序是刻意的：先认领重放/冲突（幂等优先），再校验上界与报价，最后才看余额。
 * 这样同一个 operation 重放时，不会因为余额变化而给出不同答案。
 */
export function planReservation(input: ReservationInput): ReservationPlan {
  const { existing } = input;
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      return {
        action: "conflict",
        reason: `operation ${existing.operationId} 已存在且参数不同：同一 operation id 不允许换参数重放`,
      };
    }
    return { action: "replay", status: existing.status };
  }

  if (
    !Number.isSafeInteger(input.maxCostMinor) ||
    input.maxCostMinor <= 0
  ) {
    // 没有可信上界时失败关闭。不能用「调用完再看花了多少」换取暂时可用。
    return { action: "reject", reason: "no_trusted_max_cost" };
  }

  if (input.quoteExpiresAt && input.quoteExpiresAt <= input.now) {
    return { action: "reject", reason: "quote_expired" };
  }

  if (input.availableMinor < input.maxCostMinor) {
    return { action: "reject", reason: "insufficient_balance" };
  }

  return { action: "reserve", amountMinor: input.maxCostMinor };
}

export type ProviderOutcome =
  | { kind: "succeeded"; verifiedCostMinor: number }
  | { kind: "charged_failure"; verifiedCostMinor: number }
  | { kind: "not_charged_failure" }
  | { kind: "submission_unknown" };

export type SettlementInput = {
  status: BillingOperationStatus;
  /** 当前活动预占金额（微元） */
  holdMinor: number;
  outcome: ProviderOutcome;
};

export type SettlementPlan =
  | {
      action: "settle";
      chargeMinor: number;
      releaseMinor: number;
      nextStatus: "settled";
    }
  | { action: "release"; releaseMinor: number; nextStatus: "released" }
  | { action: "freeze"; nextStatus: "submission_unknown"; reason: string }
  | {
      action: "exception";
      chargeMinor: number;
      releaseMinor: number;
      overageMinor: number;
      nextStatus: "exception";
      reason: string;
    }
  | { action: "noop"; reason: string };

/**
 * 决定这次调用怎么结账。
 *
 * 实际费用超过已证明上界时**不**把差额转成用户负余额：最多扣到预占额，
 * 多出来的部分记成 `overageMinor` 并让该 operation type 熔断、转人工对账。
 * 用户不该为我们估价失误买单，我们也不该假装没发生。
 */
export function planSettlement(input: SettlementInput): SettlementPlan {
  const holdMinor = assertMinorAmount(input.holdMinor);

  if (TERMINAL_STATUSES.has(input.status)) {
    return {
      action: "noop",
      reason: `operation 已处于终态 ${input.status}，最终结算只发生一次`,
    };
  }

  const { outcome } = input;

  if (outcome.kind === "submission_unknown") {
    return {
      action: "freeze",
      nextStatus: "submission_unknown",
      reason:
        "提交结果未知：保留预占进入对账。自动释放可能让同一笔余额被消费两次，自动重提可能产生双份供应商费用。",
    };
  }

  if (outcome.kind === "not_charged_failure") {
    return { action: "release", releaseMinor: holdMinor, nextStatus: "released" };
  }

  const verified = assertMinorAmount(outcome.verifiedCostMinor);
  if (verified < 0) {
    throw new Error(`可核验费用不能为负：${verified}`);
  }

  if (verified > holdMinor) {
    return {
      action: "exception",
      chargeMinor: holdMinor,
      releaseMinor: 0,
      overageMinor: subtractMinor(verified, holdMinor),
      nextStatus: "exception",
      reason:
        "实际费用超过已证明上界：只扣到预占额，差额转人工对账并熔断该 operation type。",
    };
  }

  return {
    action: "settle",
    chargeMinor: verified,
    releaseMinor: subtractMinor(holdMinor, verified),
    nextStatus: "settled",
  };
}

export type RecoveryInput = {
  status: BillingOperationStatus;
  /** 是否已经拿到供应商 task id */
  providerTaskIdKnown: boolean;
  /** 是否**明确证明**没有提交给供应商（不是「超时了大概没提交」） */
  provenNotSubmitted: boolean;
};

export type RecoveryPlan =
  | { action: "resume_query" }
  | { action: "release" }
  | { action: "hold_for_manual" }
  | { action: "none" };

/**
 * 崩溃/重启后陈旧 hold 的处理方式。
 *
 * 判断顺序里 `providerTaskIdKnown` 优先于 `provenNotSubmitted`：两个信号矛盾时，
 * 宁可去查询，也不能释放一个可能已经产生费用的调用。
 * 「超时」永远不是释放的理由。
 */
export function planRecovery(input: RecoveryInput): RecoveryPlan {
  if (TERMINAL_STATUSES.has(input.status)) return { action: "none" };
  if (input.providerTaskIdKnown) return { action: "resume_query" };
  if (input.provenNotSubmitted) return { action: "release" };
  return { action: "hold_for_manual" };
}

export type BillingQuote = {
  userId: number;
  storyId: number | null;
  operationType: string;
  /** role / model / count 等全部稳定参数的规范化哈希 */
  parameterHash: string;
  maxCostMinor: number;
  expiresAt: Date;
};

export type QuoteVerification =
  | { ok: true }
  | { ok: false; reason: "quote_expired" | "quote_drifted"; detail: string };

/**
 * 高成本媒体的签名报价校验。
 *
 * 报价绑定账号、Story、操作类型、参数和金额；任何一项漂移都拒绝，
 * 避免「拿一张便宜的报价去跑一个更贵的任务」。
 */
export function verifyQuote(input: {
  quote: BillingQuote;
  request: BillingQuote;
  now: Date;
}): QuoteVerification {
  const { quote, request } = input;
  if (quote.expiresAt <= input.now) {
    return {
      ok: false,
      reason: "quote_expired",
      detail: `报价已于 ${quote.expiresAt.toISOString()} 过期`,
    };
  }

  const fields: Array<keyof BillingQuote> = [
    "userId",
    "storyId",
    "operationType",
    "parameterHash",
    "maxCostMinor",
  ];
  for (const field of fields) {
    if (quote[field] !== request[field]) {
      return {
        ok: false,
        reason: "quote_drifted",
        detail: `${String(field)} 与报价不一致`,
      };
    }
  }
  return { ok: true };
}
