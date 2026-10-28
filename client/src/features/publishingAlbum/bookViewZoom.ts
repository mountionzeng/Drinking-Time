type Point = { x: number; y: number };
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

export const clampBookZoom = (zoom: number) => Math.max(0.5, Math.min(2, zoom));

/** Only view magnification: never writes blocks, font sizes or document history. */
export function bindBookViewZoom(
  element: HTMLElement,
  change: (zoom: number, anchor: Point) => void,
  cancelBlockGesture: () => void,
) {
  let zoom = 1;
  let pinch: { distance: number; zoom: number } | null = null;
  let safariZoom: number | null = null;
  const apply = (next: number, anchor: Point) => {
    if (!Number.isFinite(next)) return;
    next = clampBookZoom(next);
    if (next === zoom) return;
    cancelBlockGesture();
    zoom = next;
    change(next, anchor);
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (pinch || safariZoom !== null) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
    apply(zoom * Math.exp(-pixels * 0.005), { x: event.clientX, y: event.clientY });
  };
  const touchPair = (event: TouchEvent) => {
    if (event.touches.length !== 2) return null;
    const [a, b] = [event.touches[0], event.touches[1]];
    return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      anchor: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } };
  };
  const touchStart = (event: TouchEvent) => {
    const pair = touchPair(event);
    if (!pair) { pinch = null; return; }
    event.preventDefault();
    cancelBlockGesture();
    pinch = { distance: Math.max(1, pair.distance), zoom };
  };
  const touchMove = (event: TouchEvent) => {
    const pair = touchPair(event);
    if (!pair || !pinch) return;
    event.preventDefault();
    apply(pinch.zoom * pair.distance / pinch.distance, pair.anchor);
  };
  const touchEnd = () => { pinch = null; };
  const gestureStart = (event: Event) => {
    event.preventDefault();
    safariZoom = zoom;
  };
  const gestureChange = (raw: Event) => {
    raw.preventDefault();
    if (pinch || safariZoom === null) return; // iOS also sends TouchEvents.
    const event = raw as GestureEvent;
    const rect = element.getBoundingClientRect();
    apply(safariZoom * event.scale, {
      x: Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width / 2,
      y: Number.isFinite(event.clientY) ? event.clientY : rect.top + Math.min(rect.height, 300) / 2,
    });
  };
  const gestureEnd = () => { safariZoom = null; };
  const keyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || !['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    apply(event.key === '0' ? 1 : zoom * (event.key === '-' ? 1 / 1.1 : 1.1),
      { x: rect.left + rect.width / 2, y: Math.max(0, rect.top) + 80 });
  };
  const handlers: Array<[string, EventListener]> = [
    ['wheel', wheel as EventListener], ['touchstart', touchStart as EventListener],
    ['touchmove', touchMove as EventListener], ['touchend', touchEnd], ['touchcancel', touchEnd],
    ['gesturestart', gestureStart], ['gesturechange', gestureChange], ['gestureend', gestureEnd],
    ['keydown', keyDown as EventListener],
  ];
  handlers.forEach(([type, handler]) => element.addEventListener(type, handler, { passive: false }));
  return () => handlers.forEach(([type, handler]) => element.removeEventListener(type, handler));
}
