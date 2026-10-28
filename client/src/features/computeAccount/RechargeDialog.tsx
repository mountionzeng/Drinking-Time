import { useUiText } from "@/features/uiLanguage/UiLanguage";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { SubscriptionPlans } from "./SubscriptionPlans";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Shared desktop/mobile entry. No payment instructions until the server enables checkout. */
export function RechargeDialog() {
  const t = useUiText();

  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
        >
          {t("充值算力")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("充值算力")}</DialogTitle>
          <DialogDescription>
            {t("算力用于 AI 生成，登录、浏览和手动编辑不受余额影响。")}
          </DialogDescription>
        </DialogHeader>
        {open && <RechargeAvailability />}
      </DialogContent>
    </Dialog>
  );
}

function RechargeAvailability() {
  const t = useUiText();
  const [paymentMode, setPaymentMode] = useState<"monthly" | "topup">(
    "monthly"
  );
  type Availability =
    inferRouterOutputs<AppRouter>["computePayment"]["availability"];
  const [computeUnits, setComputeUnits] = useState("10");
  const [checkoutError, setCheckoutError] = useState(false);
  const order = trpc.computePayment.createOrder.useMutation({ retry: false });

  const availability = trpc.computePayment.availability.useQuery(undefined, {
    retry: false,
  });
  if (availability.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("正在查询充值状态…")}
      </p>
    );
  const data = availability.data as Availability | undefined;
  if (!data)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm">
          {t("暂时无法查询充值状态，请重试。")}
        </p>
        <Button variant="outline" onClick={() => void availability.refetch()}>
          {t("重试")}
        </Button>
      </div>
    );
  return (
    <div className="space-y-3 text-sm">
      <div
        className="grid grid-cols-2 rounded-lg bg-muted p-1"
        role="tablist"
        aria-label={t("选择充值方式")}
      >
        <button
          type="button"
          role="tab"
          id="compute-payment-monthly-tab"
          aria-selected={paymentMode === "monthly"}
          aria-controls="compute-payment-monthly-panel"
          onClick={() => setPaymentMode("monthly")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${paymentMode === "monthly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t("按月付款")}
        </button>
        <button
          type="button"
          role="tab"
          id="compute-payment-topup-tab"
          aria-selected={paymentMode === "topup"}
          aria-controls="compute-payment-topup-panel"
          onClick={() => setPaymentMode("topup")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${paymentMode === "topup" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t("用多少充多少")}
        </button>
      </div>

      {paymentMode === "monthly" ? (
        <div
          id="compute-payment-monthly-panel"
          role="tabpanel"
          aria-labelledby="compute-payment-monthly-tab"
        >
          <SubscriptionPlans availability={data} />
        </div>
      ) : (
        <section
          id="compute-payment-topup-panel"
          role="tabpanel"
          aria-labelledby="compute-payment-topup-tab"
          aria-label={t("用多少充多少")}
          className="space-y-2 border-t border-border pt-4"
        >
          <h3 className="font-medium">{t("单次充值算力")}</h3>
          <p className="text-muted-foreground">
            {t(
              "输入想充值的算力，按 1 算力 ¥1 计价，不自动续费。付款成功后到账。"
            )}
          </p>
          <label className="block space-y-2">
            <span className="text-sm">{t("充值算力数量")}</span>
            <span className="flex items-center gap-2">
              <input
                aria-label={t("充值算力数量")}
                type="number"
                inputMode="numeric"
                min={1}
                max={10_000}
                step={1}
                value={computeUnits}
                onChange={event => {
                  setComputeUnits(event.target.value);
                  setCheckoutError(false);
                }}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base tabular-nums"
              />
              <span className="text-sm text-muted-foreground">{t("算力")}</span>
            </span>
          </label>
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">{t("应付金额")}</span>
            <strong className="tabular-nums">
              ¥
              {Number.isInteger(Number(computeUnits)) &&
              Number(computeUnits) > 0
                ? Number(computeUnits).toFixed(2)
                : "—"}
            </strong>
          </div>
          <Button
            className="w-full"
            disabled={
              !data.available ||
              !Number.isInteger(Number(computeUnits)) ||
              Number(computeUnits) < 1 ||
              Number(computeUnits) > 10_000 ||
              order.isPending
            }
            onClick={() => {
              const units = Number(computeUnits);
              if (!Number.isInteger(units) || units < 1 || units > 10_000)
                return;
              setCheckoutError(false);
              void order
                .mutateAsync({
                  type: "topup",
                  computeUnits: units,
                  requestId: crypto.randomUUID(),
                })
                .then(result => window.location.assign(result.checkoutUrl))
                .catch(() => setCheckoutError(true));
            }}
          >
            {order.isPending ? t("正在前往支付宝…") : t("支付宝付款")}
          </Button>
          {checkoutError && (
            <p role="alert" className="text-xs text-destructive">
              {t("暂时无法创建订单，请稍后重试。")}
            </p>
          )}
        </section>
      )}
      <p role="status">{data.message}</p>
      <a
        className="text-muted-foreground underline underline-offset-4 break-all"
        href={`mailto:${data.contactEmail}`}
      >
        {data.contactEmail}
      </a>
      <p className="text-muted-foreground">
        {t("微信号：")}
        <span className="select-all">JaneZ_0831</span>
      </p>
    </div>
  );
}
