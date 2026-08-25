import { describe, expect, it, vi } from "vitest";
import { storyboardVisualClipArrowMove } from "./storyboardVisualObjectInteraction";

describe("storyboardVisualClipArrowMove", () => {
  it.each([
    ["ArrowLeft", false, -1, 0],
    ["ArrowRight", false, 1, 0],
    ["ArrowLeft", true, -15, 0],
    ["ArrowRight", true, 15, 0],
    ["ArrowUp", false, 0, 1],
    ["ArrowDown", false, 0, -1],
  ] as const)(
    "routes %s (shift=%s) to (%s, %s)",
    (key, shiftKey, deltaFrames, deltaVisualLayers) => {
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const onMove = vi.fn();
      const handled = storyboardVisualClipArrowMove({
        event: {
          key,
          shiftKey,
          preventDefault,
          stopPropagation,
        } as never,
        onMove,
      });

      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(onMove).toHaveBeenCalledWith(deltaFrames, deltaVisualLayers);
    }
  );

  it("leaves unrelated keys to the surrounding editor", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const onMove = vi.fn();
    expect(
      storyboardVisualClipArrowMove({
        event: {
          key: "Enter",
          shiftKey: false,
          preventDefault,
          stopPropagation,
        } as never,
        onMove,
      })
    ).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
