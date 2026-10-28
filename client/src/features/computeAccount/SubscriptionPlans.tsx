import React, { useId, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type Availability =
  inferRouterOutputs<AppRouter>["computePayment"]["availability"];

/** Catalogue selection only identifies a server-owned offer; price and credit never come from the browser. */
export function SubscriptionPlans({
  availability,
}: {
  availability: Availability;
}) {
  const group = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const order = trpc.computePayment.createOrder.useMutation({ retry: false });
  if (!availability.plans.length) return null;
  const beginCheckout = async () => {
    if (!selected || !availability.available) return;
    try {
      const result = await order.mutateAsync({
        type: "subscription",
        offerId: selected,
        requestId: crypto.randomUUID(),
      });
      window.location.assign(result.checkoutUrl);
    } catch {
      /* The visible error keeps order details private. */
    }
  };
  const recurring = availability.recurringEnabled;
  return (
    <section
      className="space-y-4"
      aria-label={recurring ? "包月自动续费" : "购买本月套餐"}
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          {recurring ? "包月自动续费" : "购买本月套餐"}
        </legend>
        {availability.plans.map(plan => (
          <label
            key={plan.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-muted/50 focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="radio"
              name={group}
              value={plan.id}
              checked={selected === plan.id}
              onChange={() => setSelected(plan.id)}
              className="size-4 accent-primary"
            />
            <span className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{plan.computeUnits} 算力 / 月</span>
              <span>
                <strong className="text-lg tabular-nums">
                  ¥{(plan.amountFen / 100).toFixed(2)}
                </strong>
                <span className="text-muted-foreground"> / 月</span>
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-muted-foreground">
        未用完的算力自动结转。
        {recurring
          ? "首次付款和每次续费都将在支付宝确认后到账。"
          : "支付宝付款确认后，本月套餐立即到账。自动续费正在申请支付宝周期扣款权限。"}
      </p>
      <Button
        className="w-full"
        disabled={!selected || !availability.available || order.isPending}
        onClick={() => void beginCheckout()}
        aria-describedby="alipay-checkout-status"
      >
        {order.isPending
          ? "正在前往支付宝…"
          : recurring
            ? "开通支付宝自动续费"
            : "前往支付宝付款"}
      </Button>
      <p id="alipay-checkout-status" className="text-xs text-muted-foreground">
        {order.isError
          ? "暂时无法创建订单，请稍后重试。"
          : availability.message}
      </p>
    </section>
  );
}
