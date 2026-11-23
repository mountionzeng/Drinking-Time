import type { MouseEvent } from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function EditingConfirmationDialog({
  open, title, description, confirmLabel, pendingLabel, error, onCancel, onConfirm, onCloseAutoFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const ui = useUiText();
  const pending = pendingLabel != null;
  return <Dialog open={open} onOpenChange={value => { if (!value && !pending) onCancel(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      {pending && <p role="status" className="text-sm text-muted-foreground">{pendingLabel}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} className="rounded border px-3 py-2 disabled:opacity-50" onClick={onCancel}>{ui("取消 / Cancel")}</button>
        <button type="button" disabled={pending} className="rounded bg-destructive px-3 py-2 text-destructive-foreground disabled:opacity-50" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
