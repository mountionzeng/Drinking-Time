import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  MemorySpaceOperation,
  MemoryShelfView,
} from "@shared/memorySpace";

export type BookDrop = { target: string; beforeStoryId: number | null };
export function useMobileBookGesture({
  enabled,
  blocked,
  revision,
  onArrange,
  onDrop,
}: {
  enabled: boolean;
  blocked: boolean;
  revision?: number;
  onArrange: (id: number) => void;
  onDrop: (op: MemorySpaceOperation) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const suppressUntil = useRef(0);
  const callbacks = useRef({ onArrange, onDrop });
  callbacks.current = { onArrange, onDrop };
  const [held, setHeld] = useState<{
    id: number;
    title: string;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  useEffect(() => {
    const host = root.current;
    if (!enabled || !host || blocked) return;
    let press: {
      id: number;
      title: string;
      x: number;
      y: number;
      view: MemoryShelfView;
      active: boolean;
      dragged: boolean;
    } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0,
      x = 0,
      y = 0;
    let drop: BookDrop | null = null;
    let marker: HTMLElement | null = null;
    const clearMarker = () => {
      marker?.removeAttribute("data-drop-target");
      marker = null;
    };
    const finish = () => {
      if (press?.active) suppressUntil.current = Date.now() + 800;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      clearMarker();
      press = null;
      drop = null;
      setHeld(null);
    };
    const locate = () => {
      clearMarker();
      drop = null;
      const hit = document
        .elementsFromPoint(x, y)
        .find(element => host.contains(element));
      if (!hit || !host.contains(hit)) return;
      const add = hit.closest<HTMLElement>(".memory-add-shelf");
      if (add) {
        marker = add;
        drop = { target: "new", beforeStoryId: null };
      } else {
        const shelf = hit.closest<HTMLElement>("[data-drop-shelf]");
        if (!shelf) return;
        const book = hit.closest<HTMLElement>("[data-story-id]");
        const items = [
          ...shelf.querySelectorAll<HTMLElement>("[data-story-id]"),
        ];
        let beforeStoryId: number | null = null;
        if (book) {
          const r = book.getBoundingClientRect();
          const before =
            book.dataset.bookView === "horizontal"
              ? y < r.top + r.height / 2
              : x < r.left + r.width / 2;
          const next = before ? book : items[items.indexOf(book) + 1];
          beforeStoryId = next ? Number(next.dataset.storyId) : null;
          marker = next ?? shelf;
        } else marker = shelf;
        drop = { target: shelf.dataset.dropShelf!, beforeStoryId };
      }
      marker?.setAttribute("data-drop-target", "true");
    };
    const animate = () => {
      if (!press?.active || !press.dragged) return;
      // Scroll the shelf under the finger and the enclosing page near its edges.
      const hit = document
        .elementsFromPoint(x, y)
        .find(element => host.contains(element));
      const row = hit?.closest<HTMLElement>(".memory-book-row");
      if (row && host.contains(row)) {
        const r = row.getBoundingClientRect();
        row.scrollLeft += x < r.left + 32 ? -7 : x > r.right - 32 ? 7 : 0;
      }
      let parent: HTMLElement | null = host.parentElement;
      while (parent && parent.scrollHeight <= parent.clientHeight)
        parent = parent.parentElement;
      if (parent) {
        const r = parent.getBoundingClientRect();
        parent.scrollTop +=
          y < Math.max(r.top, 0) + 64
            ? -8
            : y > Math.min(r.bottom, innerHeight) - 64
              ? 8
              : 0;
      }
      locate();
      frame = requestAnimationFrame(animate);
    };
    const start = (target: EventTarget | null, px: number, py: number) => {
      if (!(target instanceof Element)) return;
      const cover = target.closest(".memory-book");
      const item = cover?.closest<HTMLElement>("[data-story-id]");
      if (!item || !host.contains(item)) return;
      finish();
      x = px;
      y = py;
      press = {
        id: Number(item.dataset.storyId),
        title: item.dataset.storyTitle ?? "故事",
        x,
        y,
        view: item.dataset.bookView as MemoryShelfView,
        active: false,
        dragged: false,
      };
      timer = setTimeout(() => {
        if (!press) return;
        press.active = true;
        setHeld({ id: press.id, title: press.title, x, y, dragging: false });
      }, 500);
    };
    const move = (px: number, py: number, event: Event) => {
      if (!press) return;
      x = px;
      y = py;
      const distance = Math.hypot(x - press.x, y - press.y);
      if (!press.active) {
        if (distance > 10) finish();
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (!press.dragged && distance > 10) {
        press.dragged = true;
        frame = requestAnimationFrame(animate);
      }
      setHeld({
        id: press.id,
        title: press.title,
        x,
        y,
        dragging: press.dragged,
      });
      if (press.dragged) locate();
    };
    const end = (event: Event) => {
      if (press?.active) {
        if (event.cancelable) event.preventDefault();
        suppressUntil.current = Date.now() + 800;
        if (!press.dragged) callbacks.current.onArrange(press.id);
        else if (drop)
          callbacks.current.onDrop({
            kind: "dragBook",
            storyId: press.id,
            view: press.view,
            ...drop,
            newShelfId: crypto.randomUUID(),
          });
      }
      finish();
    };
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        finish();
        return;
      }
      start(e.target, e.touches[0].clientX, e.touches[0].clientY);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        finish();
        return;
      }
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    const pointerStart = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0)
        start(e.target, e.clientX, e.clientY);
    };
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") move(e.clientX, e.clientY, e);
    };
    const pointerEnd = (e: PointerEvent) => {
      if (e.pointerType === "mouse") end(e);
    };
    const click = (e: MouseEvent) => {
      if (Date.now() < suppressUntil.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const menu = (e: Event) => {
      if (press) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    host.addEventListener("touchstart", touchStart, { passive: true });
    host.addEventListener("touchmove", touchMove, { passive: false });
    host.addEventListener("touchend", end, { passive: false });
    host.addEventListener("touchcancel", finish);
    host.addEventListener("pointerdown", pointerStart);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerEnd);
    window.addEventListener("pointercancel", finish);
    host.addEventListener("click", click, true);
    host.addEventListener("contextmenu", menu);
    window.addEventListener("blur", finish);
    window.addEventListener("keydown", key);
    return () => {
      finish();
      host.removeEventListener("touchstart", touchStart);
      host.removeEventListener("touchmove", touchMove);
      host.removeEventListener("touchend", end);
      host.removeEventListener("touchcancel", finish);
      host.removeEventListener("pointerdown", pointerStart);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerEnd);
      window.removeEventListener("pointercancel", finish);
      host.removeEventListener("click", click, true);
      host.removeEventListener("contextmenu", menu);
      window.removeEventListener("blur", finish);
      window.removeEventListener("keydown", key);
    };
  }, [enabled, blocked, revision]);
  return {
    root,
    held,
    onClickCapture: (event: ReactMouseEvent) => {
      if (Date.now() < suppressUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
