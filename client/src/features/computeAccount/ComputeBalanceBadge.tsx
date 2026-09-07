/**
 * 余额的显示件。两端共用，只有排布密度不同（compact 给手机和顶栏）。
 *
 * 显示的是**可用余额**，不是已入账余额：生成中被占住的钱花不出去，把它算进
 * 「你还有多少」是在骗人。有预占时单独带一行说明，用户才知道数字为什么少了。
 */
import { Loader2, Wallet } from "lucide-react";
import React from "react";

import { cn } from "@/lib/utils";
import { useComputeBalance } from "./useComputeBalance";

/**
 * 外壳**不调任何 hook**，未登录时直接返回 null，内核压根不挂载。
 *
 * 这不只是为了让脱离 tRPC Provider 的单渲测试能过（TopBar 的测试就是这么渲
 * 的）——「没有用户就没有余额」本来就是对的行为，把 useQuery 挂在那里再靠
 * enabled 关掉，只是把同一件事说得更绕。
 */
export function ComputeBalanceBadge({
  enabled = true,
  compact = false,
  className,
}: {
  enabled?: boolean;
  /** 顶栏和手机上用：只留图标加数字一行。 */
  compact?: boolean;
  className?: string;
}) {
  if (!enabled) return null;
  return <ComputeBalanceBadgeInner compact={compact} className={className} />;
}

function ComputeBalanceBadgeInner({
  compact,
  className,
}: {
  compact: boolean;
  className?: string;
}) {
  const balance = useComputeBalance(true);

  if (balance.loading) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className
        )}
      >
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        {compact ? null : "正在读余额…"}
      </span>
    );
  }

  // 读不到就说读不到。显示 ¥0.00 会和「真的花光了」混为一谈，
  // 用户会以为自己没钱了而不是网络出了问题。
  if (balance.failed || balance.text === null) {
    return (
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline",
          className
        )}
        onClick={balance.refetch}
      >
        <Wallet aria-hidden="true" className="size-3.5" />
        余额没读到，点这里重试
      </button>
    );
  }

  return (
    <span
      className={cn("inline-flex flex-col gap-0.5", className)}
      aria-label={`可用余额 ${balance.text}`}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-sm tabular-nums",
          balance.negative
            ? "text-destructive"
            : balance.depleted
              ? "text-amber-700"
              : "text-foreground"
        )}
      >
        <Wallet aria-hidden="true" className="size-3.5 shrink-0" />
        {balance.text}
      </span>

      {balance.negative ? (
        <span className="text-[10px] leading-4 text-destructive">
          账目对不上，请联系我们，先别继续生成
        </span>
      ) : balance.depleted ? (
        <span className="text-[10px] leading-4 text-amber-700">
          余额已用完，生成会被拦下
        </span>
      ) : balance.reservedText && !compact ? (
        <span className="text-[10px] leading-4 text-muted-foreground">
          另有 {balance.reservedText} 正在生成中占用
        </span>
      ) : null}
    </span>
  );
}
