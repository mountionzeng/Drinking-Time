import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A node-only hook harness: keep refs across renders and explicitly commit layout effects.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) => hooks.refs[hooks.cursor++] ?? (hooks.refs[hooks.cursor - 1] = { current: initial }),
  useLayoutEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
import { useStoryboardViewportGestures } from "./useStoryboardViewportGestures";
import { storyboardZoomViewport } from "./StoryboardTimelineRuler";

beforeEach(() => { hooks.cursor = 0; hooks.refs = []; hooks.effects = []; });
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  const cancel = vi.fn((key: number) => callbacks.delete(key));
  vi.stubGlobal("window", {
    requestAnimationFrame: (cb: FrameRequestCallback) => { callbacks.set(++id, cb); return id; },
    cancelAnimationFrame: cancel,
  });
  const element = Object.assign(new EventTarget(), {
    clientWidth: 660, scrollLeft: 100,
    getBoundingClientRect: () => ({ left: 100 }),
    closest: () => null,
  });
  const input = {
    scroller: { current: element as unknown as HTMLDivElement },
    enabled: true, scope: 1, blocked: false,
    viewport: { ...storyboardZoomViewport(60000, 500, 0), scale: 20 },
    availableWidth: 500, headerWidth: 160,
    onZoom: vi.fn(), onInteraction: vi.fn(),
  };
  const render = () => { hooks.cursor = 0; hooks.effects = []; useStoryboardViewportGestures(input); };
  render();
  hooks.effects[0]();
  const dispose = hooks.effects[1]() as () => void;
  const send = (values: Record<string, unknown>) => {
    element.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }),
      { deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 460 }, values));
  };
  const flush = () => {
    const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(cb => cb(0));
  };
  const commitZoom = () => {
    input.viewport = storyboardZoomViewport(60000, 500, input.onZoom.mock.lastCall![0]);
    render(); hooks.effects[0]();
  };
  return { input, element, send, flush, commitZoom, dispose, callbacks, cancel, render };
}

describe("Storyboard gesture rendering", () => {
  it("coalesces rapid pinch and pan input and restores the time anchor after layout", () => {
    const s = setup();
    s.send({ ctrlKey: true, deltaY: -40 });
    s.send({ ctrlKey: true, deltaY: -40 });
    s.send({ deltaX: 50 });
    expect(s.callbacks.size).toBe(1);
    expect(s.input.onZoom).not.toHaveBeenCalled();
    expect(s.element.scrollLeft).toBe(100); // Wait for the wider content before scrolling.
    s.flush(); s.commitZoom();
    const scale = 20 * Math.exp(0.4);
    expect(s.input.onZoom).toHaveBeenCalledOnce();
    expect(s.input.viewport.scale).toBeCloseTo(scale);
    expect(s.element.scrollLeft).toBeCloseTo(15 * scale - 200 + 50);
    s.dispose();
  });

  it("applies a pinch round trip with a pan even when the scale does not change", () => {
    const s = setup();
    s.send({ ctrlKey: true, deltaY: -40 });
    s.send({ ctrlKey: true, deltaY: 40 });
    s.send({ deltaX: 50 });
    s.flush();
    expect(s.element.scrollLeft).toBeCloseTo(150);
    s.send({ deltaX: 10 });
    expect(s.element.scrollLeft).toBeCloseTo(160);
    expect(s.callbacks.size).toBe(0);
    s.dispose();
  });

  it("cancels uncommitted zoom when leaving the view or switching stories", () => {
    const s = setup();
    s.send({ ctrlKey: true, deltaY: -40 });
    s.dispose();
    expect(s.cancel).toHaveBeenCalledOnce();
    s.input.scope = 2;
    s.input.enabled = false;
    s.element.scrollLeft = 0;
    s.render(); hooks.effects.forEach(effect => effect());
    s.flush();
    s.send({ deltaX: 50 });
    expect(s.input.onZoom).not.toHaveBeenCalled();
    expect(s.element.scrollLeft).toBe(0);
  });
});
