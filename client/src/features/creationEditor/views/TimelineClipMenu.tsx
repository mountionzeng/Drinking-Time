import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { storyboardVisualObjectMenuFocusIndex } from "../storyboardEditRow";

/** A fixed timeline menu stays at its invocation point during preview/layout updates. */
export function TimelineClipMenu({ x, y, label, testId, children, onClose }: {
  x: number;
  y: number;
  label: string;
  testId: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(0, Math.min(x, window.innerWidth - rect.width)) + "px";
    menu.style.top = Math.max(0, Math.min(y, window.innerHeight - rect.height)) + "px";
    (menu.querySelector<HTMLElement>("button:not(:disabled)") ?? menu).focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, { capture: true, passive: true });
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} tabIndex={-1} role="menu" aria-label={label} data-testid={testId}
      className="fixed z-[120] max-h-[100dvh] min-w-[190px] overflow-y-auto rounded-md border border-border bg-[var(--background)] py-1 shadow-lg"
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = storyboardVisualObjectMenuFocusIndex({
          key: event.key, currentIndex: items.indexOf(document.activeElement as HTMLButtonElement), itemCount: items.length,
        });
        if (index === null) return;
        event.preventDefault();
        event.stopPropagation();
        items[index].focus();
      }}
    >{children}</div>, document.body
  );
}
