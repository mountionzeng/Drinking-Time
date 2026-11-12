import { expect, it } from "vitest";
import sharp from "sharp";
import { compareFrameGeometry } from "./frameColorMatch";

async function fixture(width = 96, height = 96, shift = 0, tint = 0) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= 20 + shift && x < 55 + shift && y >= 18 && y < 68;
    data.set(inside ? [200, 170 + tint, 100] : [30, 50 + tint, 20], (y * width + x) * 3);
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
it("compares positions before color, without mistaking a color change for motion", async () => {
  const match = await compareFrameGeometry(await fixture(96, 96, 0, 20), await fixture());
  expect(match.positionConsistent).toBe(true);
  expect(match.targetSize).toEqual({ width: 96, height: 96 });
  expect((await compareFrameGeometry(await fixture(96, 96, 20), await fixture())).positionConsistent).toBe(false);
});
it("does not accept differing canvases or empty images as matched positions", async () => {
  const mismatch = await compareFrameGeometry(await fixture(), await fixture(96, 160));
  expect(mismatch).toMatchObject({ sameDimensions: false, sameAspect: false, positionConsistent: false });
  const blank = await sharp({ create: { width: 96, height: 96, channels: 3, background: "white" } }).png().toBuffer();
  expect((await compareFrameGeometry(blank, blank)).positionConsistent).toBe(false);
});
it("compares relative positions for same-aspect references at another resolution without resizing either asset", async () => {
  const base = await fixture();
  const larger = await sharp(base).resize(192, 192, { kernel: "nearest" }).png().toBuffer();
  expect(await compareFrameGeometry(larger, base)).toMatchObject({sameDimensions:false,sameAspect:true,positionConsistent:true});
  expect((await sharp(base).metadata()).width).toBe(96);
  expect((await sharp(larger).metadata()).width).toBe(192);
});
