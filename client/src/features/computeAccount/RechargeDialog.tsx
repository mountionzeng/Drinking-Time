import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
      <DialogContent className="sm:max-w-sm">
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
      <p role="status">{availability.data.message}</p>
      <a
        className="text-muted-foreground underline underline-offset-4 break-all"
        href={`mailto:${availability.data.contactEmail}`}
      >
        {availability.data.contactEmail}
      </a>
    </div>
  );
}
