import { storyboardZoomViewport } from "./StoryboardTimelineRuler";

export type StoryboardGestureView = { scale: number; scrollLeft: number; totalMs: number; availableWidth: number };
export type StoryboardGestureTarget = { scale: number; scrollLeft: number };
type SafariGesture = Event & { scale: number; clientX: number };

/** View-only gestures: no selection, playhead, clip-edit or persistence commands. */
export function bindStoryboardViewportGestures(element: HTMLElement, options: {
  headerWidth: number;
  read: () => StoryboardGestureView;
  change: (view: StoryboardGestureTarget) => void;
  onInteraction: () => void;
  blocked?: () => boolean;
}) {
  let safari: { scale: number; time: number } | null = null;
  const editing = (event: Event) => {
    const target = event.target as Element | null;
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]'));
  };
  const anchor = (clientX: number) => {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, element.clientWidth - options.headerWidth);
    return Number.isFinite(clientX) ? Math.max(0, Math.min(width, clientX - rect.left - options.headerWidth)) : width / 2;
  };
  const zoom = (next: number, x: number, fixedTime?: number) => {
    if (!Number.isFinite(next) || next <= 0) return;
    const view = options.read();
    const min = storyboardZoomViewport(view.totalMs, view.availableWidth, 0).scale;
    const max = storyboardZoomViewport(view.totalMs, view.availableWidth, 100).scale;
    const scale = Math.max(min, Math.min(max, next));
    const time = fixedTime ?? (view.scrollLeft + x) / view.scale;
    options.change({ scale, scrollLeft: Math.max(0, time * scale - x) });
  };
  const wheel = (event: WheelEvent) => {
    if (editing(event)) return;
    const pinch = event.ctrlKey || event.metaKey;
    const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!pinch && !horizontal) return; // Ordinary vertical scrolling stays native.
    event.preventDefault(); // Also contains overscroll at the ends; no page zoom/history swipe.
    if (event.buttons || options.blocked?.()) return;
    options.onInteraction();
    if (safari) return; // Safari can emit both GestureEvents and wheel events.
    const view = options.read();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.availableWidth : 1;
    if (pinch) {
      zoom(view.scale * Math.exp(-Math.max(-200, Math.min(200, event.deltaY * unit)) * 0.005), anchor(event.clientX));
    } else {
      const delta = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
      if (Number.isFinite(delta)) options.change({scale: view.scale, scrollLeft: Math.max(0, view.scrollLeft + delta)});
    }
  };
  const start = (event: Event) => {
    if (editing(event) || options.blocked?.()) return;
    event.preventDefault();
    options.onInteraction();
    const view = options.read();
    safari = { scale: view.scale, time: (view.scrollLeft + anchor((event as SafariGesture).clientX)) / view.scale };
  };
  const change = (event: Event) => {
    if (!safari) return;
    event.preventDefault();
    options.onInteraction();
    const gesture = event as SafariGesture;
    zoom(safari.scale * gesture.scale, anchor(gesture.clientX), safari.time);
  };
  const end = (event: Event) => { if (safari) event.preventDefault(); safari = null; };
  const handlers: Array<[string, EventListener]> = [
    ["wheel", wheel as EventListener], ["gesturestart", start], ["gesturechange", change], ["gestureend", end],
  ];
  handlers.forEach(([name, handler]) => element.addEventListener(name, handler, {passive: false}));
  return () => { safari = null; handlers.forEach(([name, handler]) => element.removeEventListener(name, handler)); };
}
