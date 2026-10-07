import { describe, expect, it } from "vitest";
import { paletteFromPixels } from "./imagePackMaterial";

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => {
    const c = parseInt(value, 16) / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

describe("cover-derived paper palette", () => {
  it("follows the dominant cover color and ignores transparent pixels and white margins", () => {
    const warm = [170, 110, 65, 255];
    const palette = paletteFromPixels([...warm, ...warm, 20, 70, 170, 255, 255, 255, 255, 255, 0, 240, 0, 0]);
    expect(palette).toEqual(paletteFromPixels(warm));
    expect(palette).not.toEqual(paletteFromPixels([20, 70, 170, 255]));
  });

  it("keeps text readable on every palette including dark, light and saturated covers", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [170, 110, 65]]) {
      const { paper, ink } = paletteFromPixels([...rgb, 255]);
      expect((luminance(paper) + .05) / (luminance(ink) + .05)).toBeGreaterThan(7);
    }
    expect(paletteFromPixels([]).paper).toMatch(/^#[a-f0-9]{6}$/);
  });

  it("preserves the first encountered dominant color when counts tie", () => {
    const warm = [170, 110, 65, 255];
    const blue = [20, 70, 170, 255];
    expect(paletteFromPixels([...warm, ...blue])).toEqual(paletteFromPixels(warm));
    expect(paletteFromPixels([...blue, ...warm])).toEqual(paletteFromPixels(blue));
  });

});
