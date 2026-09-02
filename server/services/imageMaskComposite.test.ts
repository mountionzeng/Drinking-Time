import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compositeMaskedEditPixels } from "./imageMaskComposite";

async function rawRgba(bytes: Uint8Array): Promise<number[]> {
  return [...await sharp(bytes).ensureAlpha().raw().toBuffer()];
}

describe("compositeMaskedEditPixels", () => {
  it("copies only the hard semantic object patch and preserves every protected byte", async () => {
    const source = await sharp(Buffer.from([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
    ]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const generated = await sharp(Buffer.from([
      110, 120, 130, 255,
      140, 150, 160, 255,
      170, 180, 190, 255,
    ]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const mask = await sharp(Buffer.from([
      0, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 128,
    ]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();

    const result = await compositeMaskedEditPixels(source, generated, mask);

    expect(await rawRgba(result)).toEqual([
      10, 20, 30, 255,
      140, 150, 160, 255,
      70, 80, 90, 255,
    ]);
  });
});
