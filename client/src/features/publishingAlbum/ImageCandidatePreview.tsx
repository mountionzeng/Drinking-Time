import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A portal keeps the enlargement outside the horizontal strip's clipping. */
export function ImageCandidatePreview({ children, preview, label, controls }: {
  children: ReactNode;
  preview: ReactNode;
  label: string;
  controls?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const engaged = useRef(false);
  function cancelClose() { clearTimeout(closeTimer.current); }
  function leave() {
    cancelClose();
    if (!controls) { setOpen(false); return; }
    // Let the pointer cross the gap into the preview; editing pins it until dismissal.
    closeTimer.current = setTimeout(() => { if (!engaged.current) setOpen(false); }, 180);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function focusControl() { content.current?.querySelector<HTMLElement>("select, button")?.focus(); }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverAnchor asChild>
      <span className="inline-flex shrink-0"
        onPointerEnter={event => { if (event.pointerType === "mouse") { cancelClose(); if (!open) engaged.current = false; setOpen(true); } }}
        onPointerLeave={leave}
        onFocus={() => { if (!controls) setOpen(true); }} onBlur={() => { if (!controls) setOpen(false); }}>
        {controls ? <PopoverTrigger asChild onClick={event => {
          // Clicking a hovered preview should open its editor, not toggle it closed.
          event.preventDefault(); cancelClose(); engaged.current = true; setOpen(true);
          requestAnimationFrame(focusControl);
        }}>{children}</PopoverTrigger> : children}
      </span>
    </PopoverAnchor>
    <PopoverContent ref={content} side="top" sideOffset={8} collisionPadding={16}
      aria-label={`放大预览：${label}`} className={`${controls ? "" : "pointer-events-none"} w-80 max-w-[80vw] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-2`}
      onPointerEnter={cancelClose} onPointerLeave={leave}
      onFocusCapture={() => { if (controls) engaged.current = true; }}
      onOpenAutoFocus={event => { if (!controls || !engaged.current) event.preventDefault(); }}
      onCloseAutoFocus={event => { if (!controls || !engaged.current) event.preventDefault(); }}
      onInteractOutside={event => { if (!controls) event.preventDefault(); }}>
      <div style={{ maxHeight: `min(55vh, max(100px, calc(var(--radix-popover-content-available-height) - ${controls ? "8rem" : "3rem"})))` }}
        className="overflow-hidden rounded [&_img]:max-h-[inherit] [&_img]:w-full [&_img]:object-contain [&_canvas]:max-h-[inherit] [&_canvas]:object-contain">{preview}</div>
      <p className="mt-1 text-center text-xs text-muted-foreground">{label}</p>
      {controls ? <div className="mt-2 border-t border-[var(--panel-border)] pt-2">{controls}</div> : null}
    </PopoverContent>
  </Popover>;
}
