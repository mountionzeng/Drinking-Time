import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { PictureRegion } from "@shared/chatPictureRegion";
import type { ComposerImage } from "./imageGenerationDraft";

type Point = { x: number; y: number };
type Source = { image: ComposerImage; thumb: HTMLImageElement };
type Props = {
  root: RefObject<HTMLDivElement | null>;
  images: ComposerImage[];
  en: boolean;
  onPick: (image: ComposerImage, region?: PictureRegion) => void;
};
type Rect = { left: number; top: number; width: number; height: number };

function point(event: { clientX: number; clientY: number }, rect: Rect): Point {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

export function selectionBounds(a: Point, b: Point): PictureRegion {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

function imageRect(thumb: HTMLImageElement): Rect {
  const rect = thumb.getBoundingClientRect();
  const fit = getComputedStyle(thumb).objectFit;
  if (fit !== "contain" && fit !== "cover") return rect;
  const scale = (fit === "contain" ? Math.min : Math.max)(rect.width / thumb.naturalWidth, rect.height / thumb.naturalHeight);
  const width = thumb.naturalWidth * scale, height = thumb.naturalHeight * scale;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

export function previewPlacement(anchor: Rect, ratio: number, viewportWidth: number, composerTop: number) {
  const margin = 8, footer = 38;
  const availableHeight = composerTop - footer - 2 * margin;
  if (availableHeight < 72) return null;
  const leftRoom = anchor.left - 2 * margin, rightRoom = viewportWidth - anchor.left - anchor.width - 2 * margin;
  const side = Math.max(leftRoom, rightRoom) >= 200;
  const maxWidth = side ? Math.max(leftRoom, rightRoom) : viewportWidth - 2 * margin;
  const height = Math.min((Math.min(420, maxWidth) - 2) / ratio, availableHeight);
  const width = height * ratio;
  const left = side ? (leftRoom >= rightRoom ? anchor.left - width - margin : anchor.left + anchor.width + margin)
    : (viewportWidth - width) / 2;
  const top = Math.max(margin, Math.min(composerTop - height - footer - margin, anchor.top + (anchor.height - height) / 2));
  return { width, height, left: Math.max(margin, Math.min(viewportWidth - width - margin, left)), top };
}

type Drag = { id: number; source: Source; rect: Rect; start: Point; fromThumb: boolean; moved: boolean };
export function ChatImageRegionHover({ root, images, en, onPick }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [box, setBox] = useState<PictureRegion | null>(null);
  const drag = useRef<Drag | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const suppressed = useRef<HTMLImageElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const thumbClick = useRef<HTMLImageElement | null>(null);
  const options = useRef({ images, onPick }); options.current = { images, onPick };
  const cancelTimer = () => clearTimeout(hoverTimer.current);
  const dismiss = () => {
    cancelTimer(); drag.current = null; setBox(null); setSource(null);
  };
  function start(event: PointerEvent, picked: Source, surface: HTMLElement, fromThumb: boolean) {
    if (!event.isPrimary || event.button !== 0 || event.altKey || drag.current) return;
    const rect = fromThumb ? imageRect(picked.thumb) : surface.getBoundingClientRect();
    const start = point(event, rect);
    event.preventDefault(); cancelTimer(); surface.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, source: picked, rect, start, fromThumb, moved: false };
  }
  function move(event: PointerEvent) {
    if (suppressed.current && !suppressed.current.matches(":hover")) suppressed.current = null;
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const next = selectionBounds(active.start, point(event, active.rect));
    if (!active.moved && (next.right - next.left) * active.rect.width >= 4 && (next.bottom - next.top) * active.rect.height >= 4) {
      active.moved = true; setSource(active.source);
    }
    if (active.moved) setBox(next);
  }
  function finish(event: PointerEvent) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const region = selectionBounds(active.start, point(event, active.rect));
    const selected = (region.right - region.left) * active.rect.width >= 4 && (region.bottom - region.top) * active.rect.height >= 4;
    suppressed.current = active.fromThumb ? active.source.thumb : null;
    dismiss();
    // An ordinary thumbnail click uses its existing shot-aware click handler.
    if (active.fromThumb && !selected) return;
    if (active.fromThumb) thumbClick.current = active.source.thumb;
    options.current.onPick(active.source.image, selected ? region : undefined);
  }
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const resolve = (target: EventTarget | null): Source | null => {
      if (!(target instanceof Element) || target.closest('[contenteditable], [role="textbox"]')) return null;
      const chip = target.closest<HTMLElement>("[data-chat-image-id],[data-ref-key]");
      const thumb = target instanceof HTMLImageElement ? target : chip?.querySelector("img");
      if (!thumb?.naturalWidth) return null;
      const id = chip?.dataset.chatImageId ?? chip?.dataset.refKey?.replace(/^image:/, "");
      const matches = options.current.images.filter(row => row.imageUrl === thumb.getAttribute("src") || row.imageUrl === thumb.src);
      const image = id ? matches.find(row => row.imageId === Number(id))
        : matches.every(row => row.imageId === matches[0]?.imageId) ? matches[0] : null;
      return image?.imageId ? { thumb, image } : null;
    };
    const show = (target: EventTarget | null) => {
      if (drag.current) return;
      const next = resolve(target);
      if (!next || next.thumb === suppressed.current) return;
      cancelTimer();
      hoverTimer.current = setTimeout(() => {
        if (next.thumb.isConnected && next.thumb.matches(":hover")) { setBox(null); setSource(next); }
      }, 160);
    };
    const over = (event: PointerEvent) => { if (event.pointerType === "mouse") show(event.target); };
    const out = (event: PointerEvent) => {
      if (drag.current) return;
      if (event.target === suppressed.current) suppressed.current = null;
      cancelTimer();
      hoverTimer.current = setTimeout(() => {
        if (!drag.current && !panel.current?.matches(":hover") && !resolve(host.querySelector("img:hover"))) dismiss();
      }, 260);
    };
    const loaded = (event: Event) => {
      if (event.target instanceof HTMLImageElement && event.target.matches(":hover")) show(event.target);
    };
    const down = (event: PointerEvent) => {
      thumbClick.current = null;
      if (event.pointerType !== "mouse") return;
      const next = resolve(event.target);
      if (next && event.target === next.thumb) start(event, next, next.thumb, true);
      else dismiss();
    };
    const nativeDrag = (event: DragEvent) => { if (drag.current) event.preventDefault(); };
    const clicked = (event: MouseEvent) => {
      const target = event.target;
      const consumed = thumbClick.current; thumbClick.current = null;
      if (consumed && target instanceof Element && (target === consumed || target.contains(consumed))) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      dismiss();
      if (target instanceof HTMLImageElement && !target.closest('button,a,[role="button"]')) {
        const next = resolve(target); if (next) options.current.onPick(next.image);
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (panel.current || drag.current)) {
        event.preventDefault(); event.stopPropagation(); dismiss();
      } else if (event.target instanceof Element && event.target.closest('[contenteditable], [role="textbox"]')) dismiss();
    };
    // Capture the entire gesture, including drags that leave the thumbnail or preview.
    host.addEventListener("pointerover", over); host.addEventListener("pointerout", out);
    host.addEventListener("pointerdown", down); host.addEventListener("dragstart", nativeDrag);
    host.addEventListener("load", loaded, true); host.addEventListener("click", clicked, true);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", dismiss); window.addEventListener("keydown", keydown, true);
    window.addEventListener("resize", dismiss);
    return () => {
      cancelTimer();
      host.removeEventListener("pointerover", over); host.removeEventListener("pointerout", out);
      host.removeEventListener("pointerdown", down); host.removeEventListener("dragstart", nativeDrag);
      host.removeEventListener("load", loaded, true); host.removeEventListener("click", clicked, true);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", dismiss); window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [root]);
  if (!source) return null;
  const editor = root.current?.querySelector('[data-testid="inline-chat-composer"]');
  const position = previewPlacement(source.thumb.getBoundingClientRect(), source.thumb.naturalWidth / source.thumb.naturalHeight,
    window.innerWidth, Math.min(window.innerHeight, editor?.getBoundingClientRect().top ?? window.innerHeight));
  if (!position) return null;
  const { width, height, left, top } = position;
  return createPortal(<div ref={panel} role="region" aria-label={en ? "Image region preview" : "图片框选预览"} data-testid="chat-image-region-hover"
    className="fixed z-[222] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
    style={{ left, top, width: width + 2 }} onPointerEnter={cancelTimer} onPointerLeave={() => {
      if (!drag.current) hoverTimer.current = setTimeout(() => { if (!drag.current && !panel.current?.matches(":hover") && !source.thumb.matches(":hover")) dismiss(); }, 260);
    }}>
    <div data-testid="chat-region-canvas" className="relative cursor-crosshair touch-none select-none" style={{ width, height }}
      onPointerDown={event => start(event.nativeEvent, source, event.currentTarget, false)}>
      <img src={source.image.imageUrl} draggable={false} alt={source.image.label} className="pointer-events-none block h-full w-full" />
      {box && <div data-testid="chat-selected-region" className="pointer-events-none absolute border-2 border-white bg-primary/15 ring-1 ring-black/60"
        style={{ left: box.left * 100 + "%", top: box.top * 100 + "%", width: (box.right - box.left) * 100 + "%", height: (box.bottom - box.top) * 100 + "%" }} />}
    </div>
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className="text-muted-foreground">#{source.image.imageId}</span>
      <span className="min-w-0 flex-1 truncate">{en ? "Click for the image · Drag for a region" : "点选整图 · 拖框选局部"}</span>
      <button type="button" className="shrink-0 rounded p-1 hover:bg-muted" aria-label={en ? "Close preview" : "关闭预览"} onClick={dismiss}><X size={14} /></button>
    </div>
  </div>, document.body);
}
