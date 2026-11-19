import type { MouseEvent } from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function EditingConfirmationDialog({ open, title, description, confirmLabel, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const ui = useUiText();
  return <Dialog open={open} onOpenChange={value => { if (!value) onCancel(); }}>
    <DialogContent>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded border px-3 py-2" onClick={onCancel}>{ui("取消 / Cancel")}</button>
        <button type="button" className="rounded bg-destructive px-3 py-2 text-destructive-foreground" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
