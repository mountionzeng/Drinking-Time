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
  /** 可用余额是不是已经见底（≤0），调用方据此变色或提示。 */
  depleted: boolean;
  /**
   * 账务异常：预占超过了已入账余额，可用余额为负。
   * 这不是「余额不足」，是账对不上，值得单独说。
   */
  negative: boolean;
  refetch: () => void;
};

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
    depleted: data ? data.availableMinor <= 0 : false,
    negative: data ? data.availableMinor < 0 : false,
    refetch: () => void query.refetch(),
  };
}
