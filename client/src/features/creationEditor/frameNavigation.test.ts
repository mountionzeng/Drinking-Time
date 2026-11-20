import { expect, it } from "vitest";
import {
  isFrameNavigationKey,
  isFrameNavigationTarget,
} from "./frameNavigation";
it("plain arrows navigate; modified arrows keep their existing commands", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    const event = {
      key,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    };
    expect(isFrameNavigationKey(event)).toBe(true);
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey"])
      expect(isFrameNavigationKey({ ...event, [modifier]: true })).toBe(false);
  }
});
it("routes arrows by focus within the preview and visual layers", () => {
  // Model closest() on a control or on an icon inside that control.
  const within = (...ancestors: string[]) =>
    ({ closest: (selector: string) =>
      ancestors.find(ancestor => selector.split(", ").includes(ancestor)) ?? null,
    }) as unknown as Element;
  const layer = "[data-storyboard-visual-layer]";
  expect(isFrameNavigationTarget(within(layer))).toBe(true);
  expect(isFrameNavigationTarget(within('[data-frame-navigation="true"]'))).toBe(true);
  expect(isFrameNavigationTarget(within('[data-visual-clip-move-target="true"]', layer))).toBe(false);
  expect(isFrameNavigationTarget(within("input", layer))).toBe(false);
  expect(isFrameNavigationTarget(within('[role="dialog"]', layer))).toBe(false);
  expect(isFrameNavigationTarget(within())).toBe(false);
});
