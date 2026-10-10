import React, { useId, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { Button } from "@/components/ui/button";

type Plans =
  inferRouterOutputs<AppRouter>["computePayment"]["availability"]["plans"];

/** A visible catalogue, kept separate from the provider checkout integration. */
export function SubscriptionPlans({ plans }: { plans: Plans }) {
  const group = useId();
  const [selected, setSelected] = useState<string | null>(null);
  if (!plans.length) return null;

  return (
    <section className="space-y-4" aria-label="包月自动续费">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">包月自动续费</legend>
        {plans.map(plan => (
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
        未用完的算力自动结转。首次付款和每次续费都将在支付宝确认后到账。
      </p>
      <Button
        className="w-full"
        disabled
        aria-describedby="alipay-checkout-status"
      >
        {selected
          ? "支付宝自动续费 · 正在配置"
          : "选择套餐后开通支付宝自动续费"}
      </Button>
      <p id="alipay-checkout-status" className="text-xs text-muted-foreground">
        正在完成支付宝应用签名与周期扣款权限配置，当前不会创建订单或扣款。
      </p>
    </section>
  );
}
