import { describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_STORYBOARD_RENDERS,
  addShotToRenderSlots,
  canStartShotRender,
  mergeActiveRenderShotNos,
  removeShotFromRenderSlots,
} from "./renderSlots";

describe("storyboard render slots", () => {
  it("allows a second shot while the first shot is rendering", () => {
    expect(
      canStartShotRender({
        shotNo: 2,
        activeShotNos: [1],
      })
    ).toBe(true);
  });

  it("blocks duplicate work for the same shot and a third concurrent shot", () => {
    expect(
      canStartShotRender({
        shotNo: 1,
        activeShotNos: [1],
      })
    ).toBe(false);
    expect(
      canStartShotRender({
        shotNo: 3,
        activeShotNos: [1, 2],
      })
    ).toBe(false);
    expect(MAX_CONCURRENT_STORYBOARD_RENDERS).toBe(2);
  });

  it("adds, merges, and removes shot slots without duplicates", () => {
    expect(addShotToRenderSlots([1], 2)).toEqual([1, 2]);
    expect(addShotToRenderSlots([1, 2], 2)).toEqual([1, 2]);
    expect(mergeActiveRenderShotNos([1, 2], [2, 3], [1])).toEqual([
      1, 2, 3,
    ]);
    expect(removeShotFromRenderSlots([1, 2], 1)).toEqual([2]);
  });
});
