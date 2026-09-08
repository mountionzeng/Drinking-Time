/**
 * 算力余额：电脑端和手机端**共用同一个来源和同一套读法**。
 *
 * 两端各写一遍的话，迟早会在「预占算不算在余额里」这种地方分叉——同一个
 * 账户在两块屏幕上显示两个数字，是最伤信任的一类 bug。
 */
import { formatCnyBalance } from "@shared/computeMoney";
import { trpc } from "@/lib/trpc";

export type ComputeBalanceView = {
  /** 还在读 */
  loading: boolean;
  /** 读失败。余额读不到时不要显示 ¥0.00——那和「真的没钱了」看起来一样。 */
  failed: boolean;
  /** 可用余额，已格式化成「¥30.00」。 */
  text: string | null;
  /** 生成中被占住的钱，没有占用时为 null。 */
  reservedText: string | null;
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
    // 生成一次就会动一次，但没必要盯着轮询；切回窗口时刷新足够。
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const data = query.data ?? null;
  return {
    loading: query.isLoading,
    failed: query.isError,
    text: data ? formatCnyBalance(data.availableMinor) : null,
    reservedText:
      data && data.reservedMinor > 0
        ? formatCnyBalance(data.reservedMinor)
        : null,
    ...(data
      ? classifyComputeBalance(data)
      : { unprovisioned: false, depleted: false, negative: false }),
    refetch: () => void query.refetch(),
  };
}
