import { expect, it } from "vitest";
import { mobileStageMotion, type MobileStageStyle } from "./mobileStageMotion";
it("has six brief distinct styles, reverses direction, and settles at a neutral readable pose", () => {
  const styles: MobileStageStyle[] = [
    "shiguang",
    "metal",
    "wood",
    "water",
    "fire",
    "earth",
  ];
  const motions = styles.map(style => mobileStageMotion(style, 1));
  expect(new Set(motions.map(m => JSON.stringify(m.initial))).size).toBe(6);
  for (const style of styles) {
    const a = mobileStageMotion(style, 1),
      b = mobileStageMotion(style, -1);
    expect(a.initial.x).toBe(-b.initial.x);
    expect(a.transition.duration).toBeLessThanOrEqual(0.24);
    expect(a.animate).toMatchObject({
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      rotate: 0,
    });
  }
});
