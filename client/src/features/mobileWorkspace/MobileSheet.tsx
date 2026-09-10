/**
 * 底部弹层：选目标、预览、外形、电脑登录都用它。
 *
 * 用 Radix Dialog 的可达性（焦点圈定、Esc 关闭、aria-modal），只把位置和形状
 * 换成从底部升起的一张纸——手机上从底部升起比居中对话框好够到。
 */
import React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-1/2 top-auto bottom-0 flex max-h-[93dvh] w-full max-w-xl translate-x-[-50%] translate-y-0 flex-col gap-0 rounded-t-[23px] rounded-b-none border-x-0 border-b-0 p-0"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/70 px-5 pb-3 pt-4 text-left">
          <DialogTitle className="font-chat-brand text-[21px] leading-tight">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-sm leading-6">
              {description}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
        {footer ? (
          <div className="mobile-workspace-composer shrink-0 border-t border-border/70 px-5 pt-3">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 「尚未接入」。
 *
 * 演示里能点的东西，产品里未必真接上了。凡是没接的，就明说没接——
 * 不用示例数据、假余额、模拟成功冒充真实功能。
 */
export function MobileNotConnected({ what }: { what: string }) {
  return (
    <p
      className="rounded-xl border border-dashed border-border px-4 py-3 text-sm leading-6 text-muted-foreground"
      role="note"
    >
      <span className="font-medium text-foreground">尚未接入</span>：{what}
    </p>
  );
}
