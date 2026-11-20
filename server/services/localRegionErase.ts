import sharp from "sharp";
import { pictureRegionSchema, type PictureRegion } from "../../shared/chatPictureRegion";

/** Rebuild the selected rectangle from its adjacent edges. Sampling happens only on the source. */
export async function eraseRegionPixels(bytes: Uint8Array, region: PictureRegion): Promise<Buffer> {
  pictureRegionSchema.parse(region);
  const input = sharp(bytes, { limitInputPixels: 40 * 1024 * 1024 });
  const meta = await input.metadata();
  if ((meta.pages ?? 1) !== 1) throw Error("请选择一张静态图片");
  const { data, info } = await input.rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const left = Math.floor(region.left * width), right = Math.ceil(region.right * width);
  const top = Math.floor(region.top * height), bottom = Math.ceil(region.bottom * height);
  const w = right - left, h = bottom - top;
  if (w === width && h === height) throw Error("选区外需要留出一些背景，才能本地擦除");

  // Median samples suppress nearby strokes and grain without flattening the lighting gradient.
  const at = (x: number, y: number) => 4 * (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x)));
  function edge(length: number, position: (i: number, depth: number) => number) {
    const colors = new Uint8Array(length * 4);
    for (let i = 0; i < length; i++) {
      const offsets = [2, 4, 7, 10, 14].map(depth => position(i, depth));
      for (let ch = 0; ch < 4; ch++) colors[i * 4 + ch] = offsets.map(offset => data[offset + ch]).sort((a,b) => a - b)[2];
    }
    return colors;
  }
  const above = edge(w, (x, d) => at(left + x, top - d));
  const below = edge(w, (x, d) => at(left + x, bottom - 1 + d));
  const before = edge(h, (y, d) => at(left - d, top + y));
  const after = edge(h, (y, d) => at(right - 1 + d, top + y));
  const falloff = (size: number, available: boolean) => Float64Array.from({ length: size }, (_, i) => available ? 1 / (1 + i) ** 2 : 0);
  const up = falloff(h, top > 0), down = falloff(h, bottom < height);
  const west = falloff(w, left > 0), east = falloff(w, right < width);
  const fill = Buffer.allocUnsafe(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = up[y], d = down[h - 1 - y], l = west[x], r = east[w - 1 - x];
      const sum = u + d + l + r, offset = at(left + x, top + y);
      // Carry fine paper texture from a nearby strip. Clip its amplitude so neighbouring letters never transfer.
      const sample = top > 1 ? at(left + x, top - 2 - y % Math.min(16, top - 1))
        : bottom < height ? at(left + x, bottom + y % Math.min(16, height - bottom))
        : left > 0 ? at(left - 1, top + y) : at(right, top + y);
      const background = top > 1 ? above[x * 4] : bottom < height ? below[x * 4] : left > 0 ? before[y * 4] : after[y * 4];
      const grain = Math.max(-2, Math.min(2, data[sample] - background));
      for (let ch = 0; ch < 4; ch++) {
        const color = (u * above[x * 4 + ch] + d * below[x * 4 + ch] + l * before[y * 4 + ch] + r * after[y * 4 + ch]) / sum;
        const value = Math.max(0, Math.min(255, Math.round(color + (ch < 3 ? grain : 0))));
        fill[(y * w + x) * 4 + ch] = value;
        if (Math.abs(data[offset + ch] - value) > 12) mask[y * w + x] = 255;
      }
    }
  }
  // Keep the original paper between letters. Grow the detected strokes to include their antialiasing.
  const expanded = await sharp(mask, { raw: {width:w, height:h, channels:1} })
    .greyscale().erode(2).raw().toBuffer();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (expanded[i]) fill.copy(data, at(left + x, top + y), i * 4, i * 4 + 4);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
