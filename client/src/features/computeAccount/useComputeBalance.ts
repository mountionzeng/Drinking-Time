/**
 * 算力余额：电脑端和手机端**共用同一个来源和同一套读法**。
 *
 * 两端各写一遍的话，迟早会在「预占算不算在余额里」这种地方分叉——同一个
 * 账户在两块屏幕上显示两个数字，是最伤信任的一类 bug。
 */
import { formatComputeBalance, formatComputeUnits } from "@shared/computeMoney";
import { trpc } from "@/lib/trpc";

export type ComputeBalanceView = {
  /** 还在读 */
  loading: boolean;
  /** 读失败时不能伪装成余额为零。 */
  failed: boolean;
  /** 可用余额，只显示算力。 */
  text: string | null;
  /** 生成中被占住的钱，没有占用时为 null。 */
  reservedText: string | null;
  /** 本机开发模式下，不拦余额，但仍显示本机实际累计供应商成本。 */
  localUnlimited: boolean;
  localCostText: string | null;
  /**
   * 这个账户从来没入过账、也没花过钱——计费还没对它生效。
   *
   * 这和「余额用完了」是两回事，必须分开：新账户余额天然是 0，把它说成
   * 「用完了」会让人以为自己欠费，而实际上聊天、写正文、读来信都不查余额。
   */
  unprovisioned: boolean;
  /** 真的花到见底了（用过，且可用 ≤ 0）。 */
  depleted: boolean;
  /**
   * 账务异常：预占超过了已入账余额，可用余额为负。
   * 这不是「余额不足」，是账对不上，值得单独说。
   */
  negative: boolean;
  refetch: () => void;
};

export type ComputeBalanceAmounts = {
  postedMinor: number;
  reservedMinor: number;
  availableMinor: number;
  lifetimeSpentMinor: number;
  billingMode?: "metered" | "local_unlimited";
};

/**
 * 把四个数字判成一种状态。抽成纯函数是因为这三者混淆过一次：
 * 新账户的 0 被当成「余额用完」，在顶栏常驻了一句不成立的警告。
 */
export function classifyComputeBalance(amounts: ComputeBalanceAmounts): {
  unprovisioned: boolean;
  depleted: boolean;
  negative: boolean;
} {
  const untouched =
    amounts.postedMinor === 0 && amounts.lifetimeSpentMinor === 0;
  return {
    unprovisioned: untouched,
    depleted: !untouched && amounts.availableMinor <= 0,
    negative: amounts.availableMinor < 0,
  };
}

export function useComputeBalance(enabled = true): ComputeBalanceView {
  const query = trpc.computeAccount.balance.useQuery(undefined, {
    enabled,
    retry: false,
    // 回到页面立即刷新；前台短轮询同步其他设备已结算的用量。
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    refetchInterval: 5_000,
  });

  const data = query.data ?? null;
  return {
    loading: query.isLoading,
    failed: query.isError,
    text: data ? formatComputeBalance(data.availableMinor) : null,
    reservedText:
      data && data.reservedMinor > 0
        ? formatComputeBalance(data.reservedMinor)
        : null,
    localUnlimited: data?.billingMode === "local_unlimited",
    localCostText:
      data?.billingMode === "local_unlimited"
        ? formatComputeUnits(data.lifetimeSpentMinor)
        : null,
    ...(data
      ? classifyComputeBalance(data)
      : { unprovisioned: false, depleted: false, negative: false }),
    refetch: () => void query.refetch(),
  };
}
