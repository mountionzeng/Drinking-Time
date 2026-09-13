export type ComputeStatementBalance = {
  postedMinor: number;
  reservedMinor: number;
  availableMinor: number;
  lifetimeSpentMinor: number;
};

export type ComputeStatementStatus =
  | "posted"
  | "reserved"
  | "processing"
  | "reconciliation"
  | "released"
  | "exception";

/** 用户可见的安全账单投影；不含身份、提示词、正文或供应商凭据。 */
export type ComputeStatementItem = {
  createdAt: string;
  label: string;
  /** 已经影响入账余额的带符号金额；预占不是扣款，因此保持为 0。 */
  amountMinor: number;
  /** 仍被占用的金额；只有进行中或待对账项目才会大于 0。 */
  reservedMinor: number;
  /** 已从预占中放回、但不改变入账余额的金额。 */
  releasedMinor: number;
  status: ComputeStatementStatus;
  /** 当前数据结构无法证明已与供应商账单核验时，必须保守标为估算。 */
  estimated: boolean;
};

export type ComputeAccountStatement = {
  version: 1;
  currency: "CNY";
  balance: ComputeStatementBalance;
  /** 当前一页预占和待对账项目；余额中的 reservedMinor 始终是全部预占合计。 */
  attentionItems: ComputeStatementItem[];
  attentionHasMore: boolean;
  /** 已达到微信端安全展示上限，但服务端仍有更早待处理记录。 */
  attentionTruncated: boolean;
  /** 当前一页已入账或已释放记录。 */
  historyItems: ComputeStatementItem[];
  historyHasMore: boolean;
  /** 已达到微信端安全展示上限，但服务端仍有更早历史记录。 */
  historyTruncated: boolean;
  coverageNote: string;
};

export const COMPUTE_STATEMENT_PAGE_LIMIT = 50;
export const COMPUTE_STATEMENT_MAX_PAGE_LIMIT = 100;
export const COMPUTE_STATEMENT_MAX_OFFSET = 500;

export type ComputeStatementQuery = {
  attentionOffset?: number;
  attentionLimit?: number;
  historyOffset?: number;
  historyLimit?: number;
};

const STATUSES = new Set<ComputeStatementStatus>([
  "posted",
  "reserved",
  "processing",
  "reconciliation",
  "released",
  "exception",
]);

function isSafeMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isBalance(value: unknown): value is ComputeStatementBalance {
  if (!value || typeof value !== "object") return false;
  const balance = value as Record<string, unknown>;
  return (
    isSafeMinor(balance.postedMinor) &&
    isSafeMinor(balance.reservedMinor) &&
    isSafeMinor(balance.availableMinor) &&
    isSafeMinor(balance.lifetimeSpentMinor)
  );
}

function isItem(value: unknown): value is ComputeStatementItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.createdAt === "string" &&
    Number.isFinite(Date.parse(item.createdAt)) &&
    typeof item.label === "string" &&
    item.label.length > 0 &&
    item.label.length <= 80 &&
    isSafeMinor(item.amountMinor) &&
    isSafeMinor(item.reservedMinor) &&
    isSafeMinor(item.releasedMinor) &&
    typeof item.status === "string" &&
    STATUSES.has(item.status as ComputeStatementStatus) &&
    typeof item.estimated === "boolean"
  );
}

/**
 * 微信端的运行时协议边界。网络返回值只有通过版本、币种、金额和条目校验后
 * 才能进入画布状态，避免服务端版本漂移或畸形响应把整个“我”页面画崩。
 */
export function parseComputeAccountStatement(
  value: unknown
): ComputeAccountStatement | null {
  if (!value || typeof value !== "object") return null;
  const statement = value as Record<string, unknown>;
  if (
    statement.version !== 1 ||
    statement.currency !== "CNY" ||
    !isBalance(statement.balance) ||
    !Array.isArray(statement.attentionItems) ||
    statement.attentionItems.length > COMPUTE_STATEMENT_MAX_PAGE_LIMIT ||
    !statement.attentionItems.every(isItem) ||
    typeof statement.attentionHasMore !== "boolean" ||
    typeof statement.attentionTruncated !== "boolean" ||
    !Array.isArray(statement.historyItems) ||
    statement.historyItems.length > COMPUTE_STATEMENT_MAX_PAGE_LIMIT ||
    !statement.historyItems.every(isItem) ||
    typeof statement.historyHasMore !== "boolean" ||
    typeof statement.historyTruncated !== "boolean" ||
    typeof statement.coverageNote !== "string" ||
    statement.coverageNote.length > 1_000
  )
    return null;
  return statement as ComputeAccountStatement;
}
