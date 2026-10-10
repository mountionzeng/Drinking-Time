import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { SubscriptionPlans } from "./SubscriptionPlans";
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
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
        >
          充值算力
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>充值算力</DialogTitle>
          <DialogDescription>
            算力用于 AI 生成，登录、浏览和手动编辑不受余额影响。
          </DialogDescription>
        </DialogHeader>
        {open && <RechargeAvailability />}
      </DialogContent>
    </Dialog>
  );
}

function RechargeAvailability() {
  const availability = trpc.computePayment.availability.useQuery(undefined, {
    retry: false,
  });
  if (availability.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        正在查询充值状态…
      </p>
    );
  if (availability.isError || !availability.data)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm">
          暂时无法查询充值状态，请重试。
        </p>
        <Button variant="outline" onClick={() => void availability.refetch()}>
          重试
        </Button>
      </div>
    );
  return (
    <div className="space-y-3 text-sm">
      <SubscriptionPlans plans={availability.data.plans} />
      <section
        aria-label="单次充值算力"
        className="space-y-2 border-t border-border pt-4"
      >
        <h3 className="font-medium">单次充值算力</h3>
        <p className="text-muted-foreground">
          单次充值不自动续费。具体档位将在支付宝收银台启用时一并公布。
        </p>
      </section>
      <p role="status">{availability.data.message}</p>
      <a
        className="text-muted-foreground underline underline-offset-4 break-all"
        href={`mailto:${availability.data.contactEmail}`}
      >
        {availability.data.contactEmail}
      </a>
      <p className="text-muted-foreground">
        微信号：<span className="select-all">JaneZ_0831</span>
      </p>
    </div>
  );
}
