import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** A portal keeps the enlargement outside the horizontal strip's clipping. */
export function ImageCandidatePreview({
  children,
  preview,
  label,
  controls,
  touchOnly = false,
}: {
  children: ReactNode;
  preview: ReactNode;
  label: string;
  controls?: ReactNode;
  touchOnly?: boolean;
}) {
  const t = useUiText();

  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const engaged = useRef(false);
  function cancelClose() {
    clearTimeout(closeTimer.current);
  }
  function leave() {
    cancelClose();
    if (!controls) {
      setOpen(false);
      return;
    }
    // Let the pointer cross the gap into the preview; editing pins it until dismissal.
    closeTimer.current = setTimeout(() => {
      if (!engaged.current) setOpen(false);
    }, 180);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function focusControl() {
    content.current?.querySelector<HTMLElement>("select, button")?.focus();
  }
  if (touchOnly)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent
          showCloseButton={false}
          className="max-h-[96dvh] max-w-[calc(100%-1rem)] gap-3 overflow-y-auto p-3 sm:max-w-3xl"
        >
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-sm">{label}</DialogTitle>
            <DialogClose className="min-h-11 shrink-0 rounded-full border px-4 text-sm">
              {t("关闭预览")}
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">
            {t("图片大图预览，可长按保存图片。")}
          </DialogDescription>
          <div className="[&_img]:mx-auto [&_img]:max-h-[75dvh] [&_img]:w-full [&_img]:object-contain [&_canvas]:max-h-[75dvh] [&_canvas]:w-full [&_canvas]:object-contain">
            {preview}
          </div>
          {controls ? <div className="border-t pt-3">{controls}</div> : null}
        </DialogContent>
      </Dialog>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className="inline-flex shrink-0"
          onPointerEnter={event => {
            if (!touchOnly && event.pointerType === "mouse") {
              cancelClose();
              if (!open) engaged.current = false;
              setOpen(true);
            }
          }}
          onPointerLeave={leave}
          onFocus={() => {
            if (!controls && !touchOnly) setOpen(true);
          }}
          onBlur={() => {
            if (!controls) setOpen(false);
          }}
        >
          {controls ? (
            <PopoverTrigger
              asChild
              onClick={event => {
                // Clicking a hovered preview should open its editor, not toggle it closed.
                event.preventDefault();
                cancelClose();
                engaged.current = true;
                setOpen(true);
                requestAnimationFrame(focusControl);
              }}
            >
              {children}
            </PopoverTrigger>
          ) : (
            children
          )}
        </span>
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        side="top"
        sideOffset={8}
        collisionPadding={16}
        aria-label={t("放大预览：{0}", [label])}
        className={`${controls ? "" : "pointer-events-none"} w-80 max-w-[80vw] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-2`}
        onPointerEnter={cancelClose}
        onPointerLeave={leave}
        onFocusCapture={() => {
          if (controls) engaged.current = true;
        }}
        onOpenAutoFocus={event => {
          if (!controls || !engaged.current) event.preventDefault();
        }}
        onCloseAutoFocus={event => {
          if (!controls || !engaged.current) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (!controls) event.preventDefault();
        }}
      >
        <div
          style={{
            maxHeight: `min(55vh, max(100px, calc(var(--radix-popover-content-available-height) - ${controls ? "8rem" : "3rem"})))`,
          }}
          className="overflow-hidden rounded [&_img]:max-h-[inherit] [&_img]:w-full [&_img]:object-contain [&_canvas]:max-h-[inherit] [&_canvas]:object-contain"
        >
          {preview}
        </div>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {label}
        </p>
        {controls ? (
          <div className="mt-2 border-t border-[var(--panel-border)] pt-2">
            {controls}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
