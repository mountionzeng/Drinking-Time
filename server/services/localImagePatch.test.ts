import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  prepareLocalImagePatch,
  compositeLocalImagePatch,
} from "./localImagePatch";

async function fixture(width = 80, height = 40) {
  const source = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 23, g: 47, b: 83, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const mask = Buffer.alloc(width * height * 4, 255);
  // Non-square source and off-centre object exercise crop/padding inversion.
  for (let y = 4; y < 12; y++)
    for (let x = 62; x < 74; x++) mask[(y * width + x) * 4 + 3] = 0;
  return {
    source,
    mask: await sharp(mask, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  };
}

describe("local transparent image patch", () => {
  it("sends a bounded crop plus a small whole-image style reference", async () => {
    const { source, mask } = await fixture();
    const p = await prepareLocalImagePatch(source, mask);
    expect(p.bounds.width).toBeLessThan(80);
    expect(p.bounds.height).toBeLessThan(40);
    expect(await sharp(p.referencePng).metadata()).toMatchObject({
      width: 512,
      height: 512,
    });
    expect(await sharp(p.maskPng).metadata()).toMatchObject({
      width: 512,
      height: 512,
    });
    const overview = await sharp(p.overviewPng).metadata();
    expect(Math.max(overview.width!, overview.height!)).toBeLessThanOrEqual(
      512
    );
  });
  it("extracts an RGBA patch and leaves every pixel outside the original mask untouched", async () => {
    const { source, mask } = await fixture();
    const generated = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 190, g: 90, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const result = await compositeLocalImagePatch(source, generated, mask);
    const out = await sharp(result.compositedPng)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const before = await sharp(source).ensureAlpha().raw().toBuffer();
    const m = await sharp(mask).ensureAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (m[i + 3] === 255)
        expect(out.subarray(i, i + 4)).toEqual(before.subarray(i, i + 4));
      else {
        expect([...out.subarray(i, i + 4)]).toEqual([190, 90, 30, 255]);
        changed++;
      }
    }
    expect(changed).toBe(96);
    const patch = await sharp(result.patchPng).ensureAlpha().raw().toBuffer();
    expect(patch.some((v, i) => i % 4 === 3 && v === 0)).toBe(true);
    expect(await sharp(result.patchPng).metadata()).toMatchObject({
      width: result.bounds.width,
      height: result.bounds.height,
    });
  });
  it("rejects mismatched, empty, whole-image and soft masks before generation", async () => {
    const { source } = await fixture();
    const solid = async (width: number, alpha: number) =>
      sharp({
        create: {
          width,
          height: 40,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha },
        },
      })
        .png()
        .toBuffer();
    for (const mask of [
      await solid(79, 0),
      await solid(80, 0),
      await solid(80, 1),
      await solid(80, 0.5),
    ]) {
      await expect(prepareLocalImagePatch(source, mask)).rejects.toThrow();
    }
  });
});
