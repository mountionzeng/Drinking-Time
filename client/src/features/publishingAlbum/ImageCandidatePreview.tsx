import { useState, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/** A portal keeps the enlargement outside the horizontal strip's clipping. */
export function ImageCandidatePreview({ children, preview, label }: {
  children: ReactNode;
  preview: ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverAnchor asChild>
      <span className="inline-flex shrink-0"
        onPointerEnter={event => { if (event.pointerType === "mouse") setOpen(true); }}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        {children}
      </span>
    </PopoverAnchor>
    <PopoverContent side="top" sideOffset={8} collisionPadding={16}
      aria-label={`放大预览：${label}`} className="pointer-events-none w-80 max-w-[80vw] p-2"
      onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => event.preventDefault()}>
      <div style={{ maxHeight: "min(55vh, max(100px, calc(var(--radix-popover-content-available-height) - 3rem)))" }}
        className="overflow-hidden rounded [&_img]:max-h-[inherit] [&_img]:w-full [&_img]:object-contain [&_canvas]:max-h-[inherit] [&_canvas]:object-contain">{preview}</div>
      <p className="mt-1 text-center text-xs text-muted-foreground">{label}</p>
    </PopoverContent>
  </Popover>;
}
