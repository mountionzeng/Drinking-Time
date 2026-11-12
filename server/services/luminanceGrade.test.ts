import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodeImage } from "./colorTransfer";
import {
  applyLuminanceCurve,
  buildLuminanceCube,
  buildLuminanceCurve,
  gradeImageLuminance,
  gradePixel,
  hslSaturation,
  measureGrade,
  rgb01ToLab,
  cubeSampler,
} from "./luminanceGrade";

const W = 64, H = 64;
const png = (data: Uint8Array, channels: 3 | 4 = 3) => sharp(Buffer.from(data), { raw: { width: W, height: H, channels } }).png().toBuffer();

/** 偏暗、偏浓的「Vidu 压暗」画面：绿褐渐变。 */
function darkTarget(channels: 3 | 4 = 3) {
  const data = new Uint8Array(W * H * channels);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * channels, t = (x + y) / (W + H - 2);
    data[o] = Math.round(40 + 90 * t); data[o + 1] = Math.round(70 + 100 * t); data[o + 2] = Math.round(30 + 60 * t);
    if (channels === 4) data[o + 3] = (x * 5 + y) % 256;
  }
  return data;
}
/** 淡亮的奶油色参考，带一块深色文字（L<60，不参与）。 */
function brightReference() {
  const data = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, text = x < 6;
    const t = (i % W) / (W - 1);
    data.set(text ? [20, 20, 20] : [Math.round(225 + 25 * t), Math.round(215 + 25 * t), Math.round(195 + 25 * t)], i * 3);
  }
  return data;
}

describe("luminance-only grade (keep hue, keep HSL S)", () => {
  it("curve is monotonic, capped at 99, identity at strength 0", () => {
    const src = Float64Array.from({ length: 5000 }, (_, i) => 20 + (i % 500) / 10);
    const dst = Float64Array.from({ length: 5000 }, (_, i) => 70 + (i % 250) / 10);
    const full = buildLuminanceCurve(src, dst, 1);
    for (let i = 1; i < full.y.length; i++) expect(full.y[i]).toBeGreaterThanOrEqual(full.y[i - 1]);
    expect(Math.max(...full.y)).toBeLessThanOrEqual(99);
    expect(applyLuminanceCurve(full, 45)).toBeGreaterThan(70);
    const mid = buildLuminanceCurve(src, dst, 0.5);
    expect(applyLuminanceCurve(mid, 45)).toBeGreaterThan(45);
    expect(applyLuminanceCurve(mid, 45)).toBeLessThan(applyLuminanceCurve(full, 45));
    const none = buildLuminanceCurve(src, dst, 0);
    for (const L of [25, 40, 55]) expect(applyLuminanceCurve(none, L)).toBeCloseTo(L, 0);
  });

  it("brightens toward the reference body, hue locked, HSL S kept, no clipping, alpha kept", async () => {
    const target = darkTarget(4);
    const [mid, full] = await gradeImageLuminance(await png(brightReference()), await png(target, 4));
    expect(mid.strength).toBe("mid");
    expect(full.strength).toBe("full");
    for (const r of [mid, full]) {
      expect(r.metrics.lMeanAfter).toBeGreaterThan(r.metrics.lMeanBefore + 5);
      expect(r.metrics.hueP95Deg).toBeLessThanOrEqual(4);
      expect(Math.abs(r.metrics.hslSMeanAfter - r.metrics.hslSMeanBefore)).toBeLessThanOrEqual(0.02);
      expect(r.metrics.clipPctAfter).toBeLessThanOrEqual(1);
      const out = await decodeImage(r.png);
      expect([out.width, out.height, out.channels]).toEqual([W, H, 4]);
      for (let i = 0; i < W * H; i++) expect(out.data[i * 4 + 3]).toBe(target[i * 4 + 3]);
    }
    expect(full.metrics.lMeanAfter).toBeGreaterThan(mid.metrics.lMeanAfter);
    // 参考图的深色文字不参与：全档贴近奶油色主体（L≈88），不是被文字拉低的均值
    expect(Math.abs(full.metrics.lMeanAfter - full.metrics.referenceBodyLMean)).toBeLessThan(6);
  });

  it("a single pixel keeps its Lab hue and HSL S", () => {
    const src = Float64Array.from({ length: 1000 }, (_, i) => 30 + (i % 40));
    const dst = Float64Array.from({ length: 1000 }, (_, i) => 70 + (i % 20));
    const curve = buildLuminanceCurve(src, dst, 1);
    for (const [r, g, b] of [[0.3, 0.45, 0.2], [0.5, 0.3, 0.25], [0.2, 0.3, 0.5]]) {
      const [L0, a0, b0] = rgb01ToLab(r, g, b);
      const out = gradePixel(curve, r, g, b);
      const [L1, a1, b1] = rgb01ToLab(...out);
      expect(L1).toBeGreaterThan(L0);
      const dh = Math.abs(Math.atan2(b1, a1) - Math.atan2(b0, a0)) * 180 / Math.PI;
      expect(dh).toBeLessThan(3);
      expect(Math.abs(hslSaturation(...out) - hslSaturation(r, g, b))).toBeLessThan(0.03);
    }
  });

  it("the 65³ .cube used for video matches the exact per-pixel grade on natural colors", () => {
    const src = Float64Array.from({ length: 4000 }, (_, i) => 25 + (i % 60));
    const dst = Float64Array.from({ length: 4000 }, (_, i) => 65 + (i % 30));
    const curve = buildLuminanceCurve(src, dst, 0.5);
    const cube = buildLuminanceCube(curve);
    expect(cube).toMatch(/LUT_3D_SIZE 65/);
    const sample = cubeSampler(cube);
    const errs: number[] = [];
    // 画面里常见的中低饱和颜色（HSL S ≤ 0.6，不贴黑）
    for (let k = 0; k < 3000; k++) {
      const base = 0.15 + ((k * 0.6180339) % 1) * 0.8, spread = ((k * 0.4142135) % 1) * 0.35;
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      const r = clamp(base + spread * Math.sin(k)), g = clamp(base + spread * Math.sin(k * 1.7)), b = clamp(base + spread * Math.sin(k * 2.3));
      if (hslSaturation(r, g, b) > 0.6) continue;
      const exact = gradePixel(curve, r, g, b), lut = sample(r, g, b);
      errs.push(Math.max(...[0, 1, 2].map(c => Math.abs(exact[c] - lut[c]) * 255)));
    }
    errs.sort((a, b) => a - b);
    expect(errs.length).toBeGreaterThan(1000);
    expect(errs.reduce((s, v) => s + v, 0) / errs.length).toBeLessThan(0.5);
    expect(errs[Math.floor(errs.length * 0.99)]).toBeLessThan(2.5);
  });

  it("refuses a reference without a bright body instead of guessing", async () => {
    await expect(gradeImageLuminance(await png(new Uint8Array(W * H * 3).fill(30)), await png(darkTarget()))).rejects.toThrow(/参考图太暗/);
  });

  it("matches the accepted Python end frames for #2047 (set DT_LUMA_GOLDEN_DIR)", async () => {
    const dir = process.env.DT_LUMA_GOLDEN_DIR;
    if (!dir || !existsSync(path.join(dir, "2047-original.png"))) return;
    const results = await gradeImageLuminance(readFileSync(path.join(dir, "2045-original.png")), readFileSync(path.join(dir, "2047-original.png")));
    const expected = { mid: [91.29, 87.89, 0.2922], full: [91.29, 84.47, 0.2854] } as const;
    for (const r of results) {
      const [before, after, s] = expected[r.strength];
      const py = await decodeImage(readFileSync(path.join(dir, r.strength === "mid" ? "endframe-2047-bright-mid.png" : "endframe-2047-bright.png")));
      const ts = await decodeImage(r.png);
      const m = measureGrade(py.data, ts.data, 3, 0);
      console.log(`[golden ${r.strength}] ts L ${r.metrics.lMeanBefore}->${r.metrics.lMeanAfter} S ${r.metrics.hslSMeanAfter} hue95 ${r.metrics.hueP95Deg} | py-vs-ts L ${m.lMeanBefore} vs ${m.lMeanAfter}`);
      expect(r.metrics.lMeanBefore).toBeCloseTo(before, 0);
      expect(Math.abs(r.metrics.lMeanAfter - after)).toBeLessThan(0.3);
      expect(Math.abs(r.metrics.hslSMeanAfter - s)).toBeLessThan(0.005);
      expect(Math.abs(m.lMeanBefore - m.lMeanAfter)).toBeLessThan(0.3);
    }
  }, 120_000);
});
