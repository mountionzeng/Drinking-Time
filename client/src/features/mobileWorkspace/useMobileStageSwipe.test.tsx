import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMobileStageSwipe } from "./useMobileStageSwipe";

class Target {
  constructor(private control = false) {}
  closest() {
    return this.control ? this : null;
  }
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("window", { innerWidth: 390, getSelection: () => "" });
});
afterEach(() => vi.unstubAllGlobals());
function setup(disabled = false, stage: "memory" | "text" = "text") {
  const change = vi.fn();
  let handlers!: ReturnType<typeof useMobileStageSwipe>;
  function Harness() {
    handlers = useMobileStageSwipe(stage, change, disabled);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  return { handlers, change };
}
const point = (x: number, y: number, timeStamp = 0, control = false) =>
  ({
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    target: new Target(control),
    clientX: x,
    clientY: y,
    timeStamp,
  }) as unknown as React.PointerEvent<HTMLElement>;

it("switches once and consumes the synthetic card click after a swipe", () => {
  const { handlers, change } = setup();
  handlers.onPointerDown(point(250, 100));
  handlers.onPointerUp(point(120, 105, 250));
  handlers.onPointerUp(point(80, 105, 280));
  expect(change.mock.calls).toEqual([["image"]]);
  const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture(click as unknown as React.MouseEvent<HTMLElement>);
  expect(click.preventDefault).toHaveBeenCalledOnce();
});
it("does not open a card when swiping beyond the first stage", () => {
  const { handlers, change } = setup(false, "memory");
  handlers.onPointerDown(point(100, 100));
  handlers.onPointerUp(point(250, 105, 250));
  expect(change).not.toHaveBeenCalled();
  const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handlers.onClickCapture(click as unknown as React.MouseEvent<HTMLElement>);
  expect(click.preventDefault).toHaveBeenCalledOnce();
});
it("locks vertical reading and cancels interrupted or multi-touch gestures", () => {
  const { handlers, change } = setup();
  handlers.onPointerDown(point(250, 100));
  handlers.onPointerMove(point(248, 125));
  handlers.onPointerUp(point(120, 130, 250));
  handlers.onPointerDown(point(250, 100));
  handlers.onPointerCancel();
  handlers.onPointerUp(point(120, 105, 250));
  handlers.onPointerDown(point(250, 100));
  handlers.onPointerDown({ ...point(240, 100), isPrimary: false });
  handlers.onPointerUp(point(120, 105, 250));
  expect(change).not.toHaveBeenCalled();
});
it.each([false, true])(
  "leaves form controls and edit mode untouched (disabled: %s)",
  disabled => {
    const { handlers, change } = setup(disabled);
    handlers.onPointerDown(point(250, 100, 0, true));
    handlers.onPointerUp(point(120, 105, 250));
    if (disabled) {
      handlers.onPointerDown(point(250, 100));
      handlers.onPointerUp(point(120, 105, 250));
    }
    expect(change).not.toHaveBeenCalled();
  }
);
