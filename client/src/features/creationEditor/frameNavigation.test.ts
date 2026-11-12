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
it("does not take over editing inputs or dialogs", () => {
  const fake = (region: boolean, editable: boolean) =>
    ({
      closest: (selector: string) =>
        selector.startsWith("[data-frame") ? region : editable,
    }) as unknown as Element;
  expect(isFrameNavigationTarget(fake(true, false))).toBe(true);
  expect(isFrameNavigationTarget(fake(true, true))).toBe(false);
  expect(isFrameNavigationTarget(fake(false, false))).toBe(false);
});
