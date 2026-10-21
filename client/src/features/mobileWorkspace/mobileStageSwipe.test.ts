import { describe, expect, it } from "vitest";
import { canStartStageSwipe, swipedStoryStage } from "./mobileStageSwipe";

describe("story stage swipe", () => {
  it("moves one stage in either direction and stops at the edges", () => {
    expect(swipedStoryStage("memory", -80, 8, 250)).toBe("text");
    expect(swipedStoryStage("text", -200, 0, 300)).toBe("image");
    expect(swipedStoryStage("video", 80, 8, 250)).toBe("image");
    expect(swipedStoryStage("image", -80, 8, 250)).toBe("video");
    expect(swipedStoryStage("image", 80, 8, 250)).toBe("text");
    expect(swipedStoryStage("text", 80, 8, 250)).toBe("memory");
    expect(swipedStoryStage("memory", 80, 0, 250)).toBe("memory");
    expect(swipedStoryStage("video", -80, 0, 250)).toBe("video");
  });
  it.each([
    [20, 0, 100],
    [-80, 90, 250],
    [-80, 50, 250],
    [-80, 0, 900],
  ])(
    "ignores taps, scrolling, diagonal motion and long presses (%s,%s,%s)",
    (dx, dy, time) => {
      expect(swipedStoryStage("text", dx, dy, time)).toBe("text");
    }
  );
  it("reserves screen edges and editable/media targets", () => {
    const plain = { closest: () => null } as unknown as Element;
    const control = { closest: () => ({}) } as unknown as Element;
    expect(canStartStageSwipe(plain, 20, 390)).toBe(false);
    expect(canStartStageSwipe(plain, 375, 390)).toBe(false);
    expect(canStartStageSwipe(control, 190, 390)).toBe(false);
    expect(canStartStageSwipe(plain, 190, 390)).toBe(true);
  });
});
