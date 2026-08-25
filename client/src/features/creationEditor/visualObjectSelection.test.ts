import { describe, expect, it } from "vitest";
import {
  reconcileVisualObjectSelection,
  selectedShotNoForVisualObject,
} from "./visualObjectSelection";

describe("visual object selection", () => {
  const shot = { type: "story-shot", stableShotId: "s1", shotNo: 7 } as const;
  const image = {
    type: "image-clip",
    clipId: "i1",
    ownerStableShotId: "s1",
  } as const;

  it("projects only a complete story shot into the legacy information column", () => {
    expect(selectedShotNoForVisualObject(shot)).toBe(7);
    expect(selectedShotNoForVisualObject(image)).toBeNull();
  });

  it("clears a selection when the story changes or the object disappears", () => {
    expect(reconcileVisualObjectSelection(shot, [shot], true)).toEqual(shot);
    expect(reconcileVisualObjectSelection(shot, [], true)).toBeNull();
    expect(reconcileVisualObjectSelection(shot, [shot], false)).toBeNull();
  });
});
