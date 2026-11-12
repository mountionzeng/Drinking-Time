/**
 * 本地「只调亮度」：亮度按分位数贴近参考图，Lab 色相锁死，HSL 饱和度 S 保持原值。
 *
 * 移植自已验收的 /workspace/chatcut-refine-20261111/video-03-v02/grade_bright.py：
 * - 参考图只取 L≥60 的主体（去掉文字、线稿、深色物体），目标的 L 分布按分位数映射过去；
 * - strength 0.5 = 中档（半程），1 = 全档（贴近参考图）；位移曲线平滑约 1.2 个 L 单位，L 上限 99；
 * - 每个像素：换上新 L，色相角不变，迭代调整色度让 HSL S 回到原值，出色域只压色度。
 *
 * 这个映射只和像素自身的 RGB 有关，所以同一条曲线可以烘成 65³ 的 3D LUT（.cube），
 * 图片逐像素精确计算，视频用 ffmpeg lut3d 套同一条整片固定曲线（不逐帧统计，不闪）。
 *
 * 纯计算：不发网络请求、不读环境变量、不扣费。
 */
import sharp from "sharp";
import { decodeImage, gamutScale, rgbToLab, type LabImage } from "./colorTransfer";

export const LUMINANCE_GRADE_ALGORITHM = "luminance-hsl-v1";
export type LuminanceStrength = "mid" | "full";
export const LUMINANCE_STRENGTH_VALUE: Record<LuminanceStrength, number> = { mid: 0.5, full: 1 };
export const LUMINANCE_STRENGTH_LABEL: Record<LuminanceStrength, string> = { mid: "中档（半程）", full: "全档（贴近参考图）" };

const REF_MIN_L = 60;
const L_CAP = 99;
const CURVE_POINTS = 10001;
const QUANTILES = 2001;
const SMOOTH_L = 1.2;

// ── 浮点颜色转换（与 skimage rgb2lab / lab2rgb 同一公式）──
const M_XYZ = [
  [0.412453, 0.35758, 0.180423],
  [0.212671, 0.71516, 0.072169],
  [0.019334, 0.119193, 0.950227],
];
const WHITE = [0.95047, 1, 1.08883];
const M_RGB = (() => {
  const [[a, b, c], [d, e, f], [g, h, i]] = M_XYZ;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
})();

const lin = (x: number) => (x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92);
const gam = (x: number) => (x > 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x);
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const finv = (t: number) => (t > 0.2068966 ? t * t * t : (t - 16 / 116) / 7.787);
const clip01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function rgb01ToLab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const fx = f((M_XYZ[0][0] * R + M_XYZ[0][1] * G + M_XYZ[0][2] * B) / WHITE[0]);
  const fy = f((M_XYZ[1][0] * R + M_XYZ[1][1] * G + M_XYZ[1][2] * B) / WHITE[1]);
  const fz = f((M_XYZ[2][0] * R + M_XYZ[2][1] * G + M_XYZ[2][2] * B) / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab → sRGB [0,1]，已裁剪。 */
export function labToRgb01(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  let fz = fy - b / 200;
  if (fz < 0) fz = 0;
  const X = finv(fx) * WHITE[0], Y = finv(fy) * WHITE[1], Z = finv(fz) * WHITE[2];
  return [0, 1, 2].map(c => clip01(gam(M_RGB[c][0] * X + M_RGB[c][1] * Y + M_RGB[c][2] * Z))) as [number, number, number];
}

/** HSL 饱和度（与 grade_bright.py rgb_to_hsl 一致）。 */
export function hslSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const denom = 1 - Math.abs(max + min - 1);
  return denom > 1e-8 ? (max - min) / denom : 0;
}

// ── 亮度曲线 ──

export type LuminanceCurve = { strength: number; y: Float64Array };

function quantilesSorted(sorted: Float64Array, count: number): Float64Array {
  const out = new Float64Array(count);
  const n = sorted.length;
  for (let k = 0; k < count; k++) {
    const pos = (k / (count - 1)) * (n - 1);
    const lo = Math.floor(pos), hi = Math.min(lo + 1, n - 1);
    out[k] = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  return out;
}

function interp(x: number, xs: Float64Array, ys: Float64Array): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return span > 0 ? ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span : ys[lo];
}

/** 参考图的亮度主体：只取 L≥60 的像素（文字、线稿、深色物体不参与）。 */
export function referenceBodyL(reference: LabImage): Float64Array {
  const kept: number[] = [];
  for (let i = 0; i < reference.L.length; i++) if (reference.L[i] >= REF_MIN_L) kept.push(reference.L[i]);
  if (kept.length < 16) throw new Error("参考图太暗，可用来对齐亮度的像素不足，未调整");
  return Float64Array.from(kept);
}

/**
 * 单调的 L→L' 曲线（同 build_lut）：strength 0 = 不变，1 = 分位数贴近参考，0.5 = 半程。
 * src、dst 不需要预先排序。
 */
export function buildLuminanceCurve(srcL: Float64Array, dstL: Float64Array, strength: number): LuminanceCurve {
  if (!(strength >= 0 && strength <= 1)) throw new Error("强度必须在 0–1 之间");
  if (srcL.length < 16 || dstL.length < 16) throw new Error("像素太少，无法拟合亮度曲线");
  const qs = quantilesSorted(Float64Array.from(srcL).sort(), QUANTILES);
  const qd = quantilesSorted(Float64Array.from(dstL).sort(), QUANTILES);
  for (let i = 0; i < qs.length; i++) qs[i] += i * 1e-10;
  for (let i = 1; i < qs.length; i++) if (qs[i] < qs[i - 1]) qs[i] = qs[i - 1];
  const target = new Float64Array(QUANTILES);
  for (let i = 0; i < QUANTILES; i++) target[i] = qs[i] + strength * (qd[i] - qs[i]);
  const step = 100 / (CURVE_POINTS - 1);
  const disp = new Float64Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) disp[i] = interp(i * step, qs, target) - i * step;
  // gaussian_filter1d(mode="nearest", truncate=4)
  const sigma = SMOOTH_L / step;
  const radius = Math.floor(4 * sigma + 0.5);
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) { kernel[k + radius] = Math.exp(-0.5 * (k * k) / (sigma * sigma)); sum += kernel[k + radius]; }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const y = new Float64Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k < 0 ? 0 : i + k >= CURVE_POINTS ? CURVE_POINTS - 1 : i + k;
      acc += kernel[k + radius] * disp[j];
    }
    y[i] = Math.min(Math.max(i * step + acc, 0), L_CAP);
  }
  for (let i = 0; i < CURVE_POINTS; i++) {
    y[i] += i * 1e-12;
    if (i && y[i] < y[i - 1]) y[i] = y[i - 1];
    if (y[i] > L_CAP) y[i] = L_CAP;
  }
  return { strength, y };
}

export function applyLuminanceCurve(curve: LuminanceCurve, L: number): number {
  const pos = (Math.min(Math.max(L, 0), 100) / 100) * (CURVE_POINTS - 1);
  const lo = Math.floor(pos), hi = Math.min(lo + 1, CURVE_POINTS - 1);
  return curve.y[lo] + (curve.y[hi] - curve.y[lo]) * (pos - lo);
}

/** 曲线摘要（写进记录，方便复查）。 */
export function sampleLuminanceCurve(curve: LuminanceCurve): Array<[number, number]> {
  return [5, 15, 25, 35, 50, 65, 75, 85, 95, 100].map(L => [L, Math.round(applyLuminanceCurve(curve, L) * 100) / 100]);
}

/** 一个像素：新 L，Lab 色相锁死，HSL S 保持（同 grade_keep_hsl_s，迭代 5 次）。 */
export function gradePixel(curve: LuminanceCurve, r: number, g: number, b: number): [number, number, number] {
  const sOrig = hslSaturation(r, g, b);
  const [L, a0, b0] = rgb01ToLab(r, g, b);
  const Lnew = applyLuminanceCurve(curve, L);
  const h = Math.atan2(b0, a0);
  const cos = Math.cos(h), sin = Math.sin(h);
  let C = Math.hypot(a0, b0);
  C *= gamutScale(Lnew, C * cos, C * sin);
  const cap = Math.max(C * 1.8, C + 8);
  const cMax = cap * gamutScale(Lnew, cap * cos, cap * sin);
  for (let it = 0; it < 5; it++) {
    const [rr, gg, bb] = labToRgb01(Lnew, C * cos, C * sin);
    const s = hslSaturation(rr, gg, bb);
    const factor = s > 1e-4 ? Math.min(Math.max(sOrig / s, 0.05), 8) : 1;
    C = Math.min(Math.max(C * factor, 0), cMax);
  }
  C *= gamutScale(Lnew, C * cos, C * sin);
  return labToRgb01(Lnew, C * cos, C * sin);
}

/** 把曲线烘成 .cube 3D LUT（R 最快变化），视频用 ffmpeg lut3d 套用。 */
export function buildLuminanceCube(curve: LuminanceCurve, size = 65): string {
  const lines = [
    `TITLE "${LUMINANCE_GRADE_ALGORITHM} strength ${curve.strength}"`,
    `LUT_3D_SIZE ${size}`,
    "DOMAIN_MIN 0 0 0",
    "DOMAIN_MAX 1 1 1",
  ];
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const [r, g, b] = gradePixel(curve, ri / (size - 1), gi / (size - 1), bi / (size - 1));
        lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
  return `${lines.join("\n")}\n`;
}

/** 解析 .cube，返回三线性插值采样函数（测试用：检查视频 LUT 与逐像素精确结果的误差）。 */
export function cubeSampler(cube: string): (r: number, g: number, b: number) => [number, number, number] {
  const size = Number(/LUT_3D_SIZE\s+(\d+)/.exec(cube)?.[1]);
  const rows = cube.split("\n").filter(line => /^[\d.-]+ [\d.-]+ [\d.-]+$/.test(line)).map(line => line.split(" ").map(Number));
  if (!size || rows.length !== size ** 3) throw new Error("LUT 格式不对");
  const at = (ri: number, gi: number, bi: number) => rows[bi * size * size + gi * size + ri];
  return (r, g, b) => {
    const pr = r * (size - 1), pg = g * (size - 1), pb = b * (size - 1);
    const r0 = Math.min(Math.floor(pr), size - 2), g0 = Math.min(Math.floor(pg), size - 2), b0 = Math.min(Math.floor(pb), size - 2);
    const fr = pr - r0, fg = pg - g0, fb = pb - b0;
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const c00 = at(r0, g0, b0)[c] * (1 - fr) + at(r0 + 1, g0, b0)[c] * fr;
      const c10 = at(r0, g0 + 1, b0)[c] * (1 - fr) + at(r0 + 1, g0 + 1, b0)[c] * fr;
      const c01 = at(r0, g0, b0 + 1)[c] * (1 - fr) + at(r0 + 1, g0, b0 + 1)[c] * fr;
      const c11 = at(r0, g0 + 1, b0 + 1)[c] * (1 - fr) + at(r0 + 1, g0 + 1, b0 + 1)[c] * fr;
      out[c] = (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb;
    }
    return out;
  };
}

// ── 指标 ──

export type LuminanceGradeMetrics = {
  lMeanBefore: number; lMeanAfter: number; referenceBodyLMean: number;
  hslSMeanBefore: number; hslSMeanAfter: number;
  hueP95Deg: number; clipPctBefore: number; clipPctAfter: number;
};

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function measureGrade(before: Uint8Array, after: Uint8Array, channels: number, referenceBodyLMean: number): LuminanceGradeMetrics {
  const n = before.length / channels;
  let lb = 0, la = 0, sb = 0, sa = 0, cb = 0, ca = 0;
  const hue: number[] = [];
  for (let i = 0, o = 0; i < n; i++, o += channels) {
    const [L1, a1, b1] = rgb01ToLab(before[o] / 255, before[o + 1] / 255, before[o + 2] / 255);
    const [L2, a2, b2] = rgb01ToLab(after[o] / 255, after[o + 1] / 255, after[o + 2] / 255);
    lb += L1; la += L2;
    sb += hslSaturation(before[o] / 255, before[o + 1] / 255, before[o + 2] / 255);
    sa += hslSaturation(after[o] / 255, after[o + 1] / 255, after[o + 2] / 255);
    if (before[o] === 255 || before[o + 1] === 255 || before[o + 2] === 255) cb++;
    if (after[o] === 255 || after[o + 1] === 255 || after[o + 2] === 255) ca++;
    if (Math.hypot(a1, b1) >= 2) {
      const d = Math.abs(((Math.atan2(b2, a2) - Math.atan2(b1, a1)) * 180) / Math.PI);
      hue.push(Math.min(d % 360, 360 - (d % 360)));
    }
  }
  hue.sort((x, y) => x - y);
  return {
    lMeanBefore: round(lb / n, 2), lMeanAfter: round(la / n, 2), referenceBodyLMean: round(referenceBodyLMean, 2),
    hslSMeanBefore: round(sb / n, 4), hslSMeanAfter: round(sa / n, 4),
    hueP95Deg: round(hue.length ? hue[Math.min(hue.length - 1, Math.floor(hue.length * 0.95))] : 0, 2),
    clipPctBefore: round((cb / n) * 100, 2), clipPctAfter: round((ca / n) * 100, 2),
  };
}

// ── 图片 ──

export type LuminanceImageResult = { strength: LuminanceStrength; png: Buffer; metrics: LuminanceGradeMetrics; curve: Array<[number, number]> };

/** 目标图按参考图的亮度调整，返回每个强度一张 PNG。尺寸、alpha 与目标图一致。 */
export async function gradeImageLuminance(
  referenceBytes: Uint8Array,
  targetBytes: Uint8Array,
  strengths: readonly LuminanceStrength[] = ["mid", "full"]
): Promise<LuminanceImageResult[]> {
  const [ref, tgt] = await Promise.all([decodeImage(referenceBytes), decodeImage(targetBytes)]);
  const dst = referenceBodyL(rgbToLab(ref.data, ref.width, ref.height, ref.channels));
  const target = rgbToLab(tgt.data, tgt.width, tgt.height, tgt.channels);
  const dstMean = dst.reduce((s, v) => s + v, 0) / dst.length;
  const results: LuminanceImageResult[] = [];
  for (const strength of strengths) {
    const curve = buildLuminanceCurve(target.L, dst, LUMINANCE_STRENGTH_VALUE[strength]);
    const out = new Uint8Array(tgt.data.length);
    const cache = new Map<number, number>();
    for (let o = 0; o < tgt.data.length; o += tgt.channels) {
      const key = (tgt.data[o] << 16) | (tgt.data[o + 1] << 8) | tgt.data[o + 2];
      let packed = cache.get(key);
      if (packed === undefined) {
        const [r, g, b] = gradePixel(curve, tgt.data[o] / 255, tgt.data[o + 1] / 255, tgt.data[o + 2] / 255);
        packed = (Math.floor(r * 255 + 0.5) << 16) | (Math.floor(g * 255 + 0.5) << 8) | Math.floor(b * 255 + 0.5);
        cache.set(key, packed);
      }
      out[o] = (packed >> 16) & 255; out[o + 1] = (packed >> 8) & 255; out[o + 2] = packed & 255;
      if (tgt.channels === 4) out[o + 3] = tgt.data[o + 3];
    }
    const png = await sharp(Buffer.from(out.buffer, out.byteOffset, out.length), { raw: { width: tgt.width, height: tgt.height, channels: tgt.channels } }).png().toBuffer();
    results.push({ strength, png, metrics: measureGrade(tgt.data, out, tgt.channels, dstMean), curve: sampleLuminanceCurve(curve) });
  }
  return results;
}
