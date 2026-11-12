import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  decodeImage,
  gamutScale,
  inGamut,
  luminanceRank,
  mklTransform,
  rgbToLab,
  transferImageColor,
  type LabImage,
} from "./colorTransfer";

const W = 64, H = 64;

/** 背景偏绿的渐变，中间放一块近白中性方块（模拟纸飞机）。 */
function targetPixels(channels: 3 | 4 = 3) {
  const data = new Uint8Array(W * H * channels);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * channels;
    const t = (x + y) / (W + H - 2);
    const plane = x >= 24 && x < 40 && y >= 24 && y < 40;
    data[o] = plane ? 242 : Math.round(60 + 110 * t);
    data[o + 1] = plane ? 242 : Math.round(110 + 110 * t);
    data[o + 2] = plane ? 240 : Math.round(70 + 90 * t);
    if (channels === 4) data[o + 3] = (x * 7 + y * 3) % 256;
  }
  return data;
}

/** 暖色参考图（偏橙粉）。 */
function referencePixels() {
  const data = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const t = (i % W) / (W - 1);
    data[i * 3] = Math.round(200 + 50 * t);
    data[i * 3 + 1] = Math.round(150 + 60 * t);
    data[i * 3 + 2] = Math.round(120 + 50 * t);
  }
  return data;
}

const png = (data: Uint8Array, channels: 3 | 4) => sharp(Buffer.from(data), { raw: { width: W, height: H, channels } }).png().toBuffer();
const mean = (values: Float64Array, keep: (i: number) => boolean) => {
  let sum = 0, count = 0;
  values.forEach((v, i) => { if (keep(i)) { sum += v; count++; } });
  return sum / count;
};
const inPlane = (i: number) => { const x = i % W, y = Math.floor(i / W); return x >= 27 && x < 37 && y >= 27 && y < 37; };
const background = (i: number) => { const x = i % W, y = Math.floor(i / W); return x < 16 || x >= 48 || y < 16 || y >= 48; };

describe("local Lab color transfer (method B)", () => {
  it("keeps L, moves a/b toward the reference, protects the near-white object", async () => {
    const targetRaw = targetPixels();
    const result = await transferImageColor(await png(referencePixels(), 3), await png(targetRaw, 3));
    expect([result.width, result.height]).toEqual([W, H]);
    expect(result.lMaxAbsDiff).toBeLessThanOrEqual(0.5);

    const out = await decodeImage(result.png);
    const outLab = rgbToLab(out.data, W, H, out.channels);
    const tgtLab = rgbToLab(targetRaw, W, H, 3);
    const refLab = rgbToLab(referencePixels(), W, H, 3);
    for (let i = 0; i < W * H; i++) expect(Math.abs(outLab.L[i] - tgtLab.L[i])).toBeLessThanOrEqual(0.5);

    const all = () => true;
    for (const channel of ["a", "b"] as const) {
      const before = Math.abs(mean(tgtLab[channel], background) - mean(refLab[channel], all));
      const after = Math.abs(mean(outLab[channel], background) - mean(refLab[channel], all));
      expect(after).toBeLessThan(before * 0.5);
      // 物体（近白）不被染色
      expect(Math.abs(mean(outLab[channel], inPlane) - mean(tgtLab[channel], inPlane))).toBeLessThan(0.5);
    }
    expect(result.stats.protectedObjectPixels).toBeGreaterThan(0);
    expect(result.stats.algorithm).toBe("lab-banded-mkl-v1");
  });

  it("keeps the target's alpha channel byte for byte", async () => {
    const targetRaw = targetPixels(4);
    const result = await transferImageColor(await png(referencePixels(), 3), await png(targetRaw, 4));
    const out = await decodeImage(result.png);
    expect(out.channels).toBe(4);
    for (let i = 0; i < W * H; i++) expect(out.data[i * 4 + 3]).toBe(targetRaw[i * 4 + 3]);
  });

  it("refuses a reference with no usable (L>60) pixels instead of guessing", async () => {
    const dark = new Uint8Array(W * H * 3).fill(20);
    await expect(transferImageColor(await png(dark, 3), await png(targetPixels(), 3))).rejects.toThrow(/参考图太暗/);
  });

  it("MKL maps the source covariance onto the target covariance", () => {
    const Cs: [number, number, number] = [4, 1.2, 2.5];
    const Ct: [number, number, number] = [9, -2, 6];
    const T = mklTransform(Cs, Ct);
    // T Cs Tᵀ
    const a = [T[0] * Cs[0] + T[1] * Cs[1], T[0] * Cs[1] + T[1] * Cs[2], T[2] * Cs[0] + T[3] * Cs[1], T[2] * Cs[1] + T[3] * Cs[2]];
    const r = [a[0] * T[0] + a[1] * T[1], a[0] * T[2] + a[1] * T[3], a[2] * T[2] + a[3] * T[3]];
    expect(r[0]).toBeCloseTo(Ct[0], 9);
    expect(r[1]).toBeCloseTo(Ct[1], 9);
    expect(r[2]).toBeCloseTo(Ct[2], 9);
  });

  it("luminance rank is stable for ties and spans [0,1]", () => {
    expect(Array.from(luminanceRank(Float64Array.from([5, 1, 5, 3])))).toEqual([2 / 3, 0, 1, 1 / 3]);
  });

  it("gamut fit only shrinks chroma", () => {
    expect(gamutScale(50, 10, 10)).toBe(1);
    const s = gamutScale(90, 80, 90);
    expect(s).toBeLessThan(1);
    expect(inGamut(90, 80 * s, 90 * s)).toBe(true);
  });

  it("matches the accepted Python output on #2046/#2047 (set COLOR_TRANSFER_GOLDEN_DIR)", async () => {
    const dir = process.env.COLOR_TRANSFER_GOLDEN_DIR;
    if (!dir || !existsSync(path.join(dir, "2045-filter-medium.png"))) return;
    const lab = async (bytes: Uint8Array): Promise<LabImage> => { const d = await decodeImage(bytes); return rgbToLab(d.data, d.width, d.height, d.channels); };
    for (const id of ["2046", "2047"]) {
      const result = await transferImageColor(readFileSync(path.join(dir, "2045-filter-medium.png")), readFileSync(path.join(dir, `${id}-original.png`)));
      const ts = await lab(result.png);
      const py = await lab(readFileSync(path.join(dir, `${id}-match2045.png`)));
      const original = await lab(readFileSync(path.join(dir, `${id}-original.png`)));
      const avg = (x: Float64Array) => x.reduce((s, v) => s + v, 0) / x.length;
      let lMax = 0, abMax = 0;
      for (let i = 0; i < ts.L.length; i++) {
        lMax = Math.max(lMax, Math.abs(ts.L[i] - original.L[i]));
        abMax = Math.max(abMax, Math.hypot(ts.a[i] - py.a[i], ts.b[i] - py.b[i]));
      }
      console.log(`[golden ${id}] a_mean ts=${avg(ts.a).toFixed(3)} py=${avg(py.a).toFixed(3)} b_mean ts=${avg(ts.b).toFixed(3)} py=${avg(py.b).toFixed(3)} L_max_vs_original=${lMax.toFixed(3)} ab_max_vs_py=${abMax.toFixed(3)}`);
      expect(Math.abs(avg(ts.a) - avg(py.a))).toBeLessThan(0.05);
      expect(Math.abs(avg(ts.b) - avg(py.b))).toBeLessThan(0.05);
      expect(lMax).toBeLessThanOrEqual(0.5);
    }
  }, 60_000);
});
