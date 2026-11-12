/**
 * 本地 Lab 调色（按参考图套色，锁亮度）—— 档位 image.local-color-transfer 的算法。
 *
 * 移植自已验收的 /workspace/chatcut-refine-20261111/match_2045_color.py 方法 B：
 * - RGB → CIE Lab（D65，与 skimage rgb2lab 同一公式）；
 * - 目标图 L 通道逐像素原样保留，只改 a/b；
 * - 按亮度排名分 6 个软分段（高斯权重，宽 0.12），每段做 a/b 协方差 MKL 线性迁移，段间加权融合；
 * - 参考图丢掉 L≤60 的暗像素（文字、线稿），避免把色盘拉偏；
 * - 低色度亮区（纸飞机等近白物体）用软权重保护，不染色：自动取「L>80 且色度<3」、不碰边、外框不超过
 *   画面 60% 的最大连通域（开运算去噪、填洞、膨胀 7 像素包住灰描边），没有就只做近白微粒软保护；
 *   （Python 版用手工种子点选纸飞机，这里改成自动挑选，#2046/#2047 选中的是同一块。）
 * - 色域外的颜色在 L 不变的前提下收缩色度，再转回 sRGB。
 *
 * 纯计算，不发网络请求，不读环境变量，不新增 npm 依赖（编解码用仓库已有的 sharp）。
 */
import sharp from "sharp";

export const COLOR_TRANSFER_ALGORITHM = "lab-banded-mkl-v1";
/** 单张最大像素（约 4096×4096），超出直接报错，不缩放、不降级。 */
export const COLOR_TRANSFER_MAX_PIXELS = 4096 * 4096;
/** 交付前自检：L 最大偏差超过这个值就不交付（正常只有 8bit 量化误差，约 0.2）。 */
export const COLOR_TRANSFER_MAX_L_DRIFT = 1;

const BANDS = 6;
const BAND_SIGMA = 0.12;
const REF_MIN_L = 60;

export type LabImage = { width: number; height: number; L: Float64Array; a: Float64Array; b: Float64Array };

// ── 颜色空间（与 skimage 0.2x 的 rgb2lab / lab2rgb 一致）──

const XYZ_FROM_RGB = [
  [0.412453, 0.35758, 0.180423],
  [0.212671, 0.71516, 0.072169],
  [0.019334, 0.119193, 0.950227],
];
const WHITE = [0.95047, 1, 1.08883];
const RGB_FROM_XYZ = invert3(XYZ_FROM_RGB);

function invert3(m: number[][]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const DECODE = new Float64Array(256);
for (let v = 0; v < 256; v++) {
  const x = v / 255;
  DECODE[v] = x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
}

function fLab(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** 8bit sRGB（3 或 4 通道交错）→ Lab。 */
export function rgbToLab(data: Uint8Array, width: number, height: number, channels: number): LabImage {
  const n = width * height;
  const L = new Float64Array(n), a = new Float64Array(n), b = new Float64Array(n);
  const [m0, m1, m2] = XYZ_FROM_RGB;
  for (let p = 0, o = 0; p < n; p++, o += channels) {
    const r = DECODE[data[o]], g = DECODE[data[o + 1]], bl = DECODE[data[o + 2]];
    const fx = fLab((m0[0] * r + m0[1] * g + m0[2] * bl) / WHITE[0]);
    const fy = fLab((m1[0] * r + m1[1] * g + m1[2] * bl) / WHITE[1]);
    const fz = fLab((m2[0] * r + m2[1] * g + m2[2] * bl) / WHITE[2]);
    L[p] = 116 * fy - 16;
    a[p] = 500 * (fx - fy);
    b[p] = 200 * (fy - fz);
  }
  return { width, height, L, a, b };
}

function labToXyzInv(f: number): number {
  return f > 0.2068966 ? f * f * f : (f - 16 / 116) / 7.787;
}

function encode(x: number): number {
  const v = x > 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Lab → 8bit sRGB，写进 out（channels 3/4，alpha 位不动）。 */
function labToRgbInto(L: number, a: number, b: number, out: Uint8Array, o: number) {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  let fz = fy - b / 200;
  if (fz < 0) fz = 0;
  const X = labToXyzInv(fx) * WHITE[0], Y = labToXyzInv(fy) * WHITE[1], Z = labToXyzInv(fz) * WHITE[2];
  for (let c = 0; c < 3; c++) {
    const m = RGB_FROM_XYZ[c];
    out[o + c] = Math.floor(encode(m[0] * X + m[1] * Y + m[2] * Z) * 255 + 0.5);
  }
}

// 色域判断（与 Python 脚本的 in_gamut 一致：不裁剪的 Lab→线性 sRGB，容差 1e-3）
const GAMUT_M = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];
const K = 6 / 29;
function finv(f: number): number {
  return f > K ? f * f * f : 3 * K * K * (f - 4 / 29);
}
export function inGamut(L: number, a: number, b: number): boolean {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = WHITE[0] * finv(fx), Y = finv(fy), Z = WHITE[2] * finv(fz);
  for (const m of GAMUT_M) {
    const v = m[0] * X + m[1] * Y + m[2] * Z;
    if (v < -1e-3 || v > 1 + 1e-3) return false;
  }
  return true;
}

/** L 不变，色度按比例收缩到色域内（12 次二分，同 Python gamut_fit）。返回收缩比例。 */
export function gamutScale(L: number, a: number, b: number): number {
  if (inGamut(L, a, b)) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, a * mid, b * mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// ── 小工具 ──

/** 稳定排序后的排名，映射到 [0,1]（同 Python rank：argsort stable + linspace）。 */
export function luminanceRank(values: Float64Array): Float64Array {
  const n = values.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => values[x] - values[y] || x - y);
  const rank = new Float64Array(n);
  const step = n > 1 ? 1 / (n - 1) : 0;
  for (let k = 0; k < n; k++) rank[order[k]] = k * step;
  return rank;
}

type Sym2 = [number, number, number]; // [xx, xy, yy]

function sqrtSym(m: Sym2): Sym2 {
  const [p, q, r] = m;
  const mean = (p + r) / 2;
  const d = Math.sqrt(((p - r) / 2) ** 2 + q * q);
  let l1 = mean + d, l2 = mean - d;
  let v1x: number, v1y: number;
  if (Math.abs(q) > 1e-300) { v1x = l1 - r; v1y = q; } else if (p >= r) { v1x = 1; v1y = 0; } else { v1x = 0; v1y = 1; }
  const norm = Math.hypot(v1x, v1y);
  v1x /= norm; v1y /= norm;
  l1 = Math.sqrt(Math.max(l1, 1e-8)); l2 = Math.sqrt(Math.max(l2, 1e-8));
  // V diag V^T，第二特征向量 = (-v1y, v1x)
  return [
    l1 * v1x * v1x + l2 * v1y * v1y,
    (l1 - l2) * v1x * v1y,
    l1 * v1y * v1y + l2 * v1x * v1x,
  ];
}

type Mat2 = [number, number, number, number]; // row-major
function mul(A: Mat2, B: Mat2): Mat2 {
  return [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
}
const full = (s: Sym2): Mat2 => [s[0], s[1], s[1], s[2]];
function inv(A: Mat2): Mat2 {
  const det = A[0] * A[3] - A[1] * A[2];
  return [A[3] / det, -A[1] / det, -A[2] / det, A[0] / det];
}

/** MKL：线性映射 T，使 T·Cs·Tᵀ = Ct（Pitié & Kokaram）。 */
export function mklTransform(source: Sym2, target: Sym2): Mat2 {
  const Ds = full(sqrtSym(source));
  const Dsi = inv(Ds);
  const middle = mul(mul(Ds, full(target)), Ds);
  const sym: Sym2 = [middle[0], (middle[1] + middle[2]) / 2, middle[3]];
  return mul(mul(Dsi, full(sqrtSym(sym))), Dsi);
}

/** 加权均值 + numpy.cov(aweights, ddof=1) 协方差。 */
function weightedStats(a: Float64Array, b: Float64Array, w: Float64Array) {
  let sw = 0, sww = 0, ma = 0, mb = 0;
  for (let i = 0; i < w.length; i++) { sw += w[i]; sww += w[i] * w[i]; ma += w[i] * a[i]; mb += w[i] * b[i]; }
  ma /= sw; mb /= sw;
  let xx = 0, xy = 0, yy = 0;
  for (let i = 0; i < w.length; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    xx += w[i] * da * da; xy += w[i] * da * db; yy += w[i] * db * db;
  }
  const fact = sw - sww / sw;
  return { mean: [ma, mb] as const, cov: [xx / fact, xy / fact, yy / fact] as Sym2 };
}

function bandWeights(rank: Float64Array, center: number): Float64Array {
  const w = new Float64Array(rank.length);
  for (let i = 0; i < rank.length; i++) { const z = (rank[i] - center) / BAND_SIGMA; w[i] = Math.exp(-0.5 * z * z); }
  return w;
}

// ── 二值形态学（4 邻域十字结构，越界视为 0，同 scipy.ndimage 默认）──

function erode(m: Uint8Array, w: number, h: number): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = m[i] && x > 0 && m[i - 1] && x < w - 1 && m[i + 1] && y > 0 && m[i - w] && y < h - 1 && m[i + w] ? 1 : 0;
  }
  return out;
}
function dilate(m: Uint8Array, w: number, h: number): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0;
  }
  return out;
}

/**
 * 4 邻域连通标记，挑出「主体物件」：不碰画面边缘、外框宽高都不超过画面 60%、
 * 像素数够大，在这些里面取最大的一块。铺满画面的大片浅色背景（云、天空）不算物件。
 */
export function pickObjectComponent(m: Uint8Array, w: number, h: number, minSize: number): { mask: Uint8Array; size: number } {
  const label = new Int32Array(m.length);
  const stack = new Int32Array(m.length);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++;
    let top = 0, size = 0, border = false;
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    stack[top++] = s; label[s] = next;
    while (top) {
      const i = stack[--top]; size++;
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && m[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && m[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w; }
      if (y < h - 1 && m[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w; }
    }
    const compact = x1 - x0 + 1 <= w * 0.6 && y1 - y0 + 1 <= h * 0.6;
    if (!border && compact && size >= minSize && size > bestSize) { bestSize = size; best = next; }
  }
  const mask = new Uint8Array(m.length);
  if (best) for (let i = 0; i < m.length; i++) mask[i] = label[i] === best ? 1 : 0;
  return { mask, size: bestSize };
}

/** 填洞：与边界不连通的背景都算前景（scipy binary_fill_holes）。 */
function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(m.length);
  const stack = new Int32Array(m.length);
  let top = 0;
  const push = (i: number) => { if (!m[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const i = stack[--top];
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** 可分离高斯（scipy gaussian_filter：mode=reflect，truncate=4）。 */
export function gaussianBlur(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  const r = Math.floor(4 * sigma + 0.5);
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i * i) / (sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const reflect = (i: number, n: number) => {
    for (;;) {
      if (i < 0) i = -i - 1;
      else if (i >= n) i = 2 * n - i - 1;
      else return i;
    }
  };
  const tmp = new Float64Array(src.length), out = new Float64Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += k[j + r] * src[y * w + reflect(x + j, w)];
    tmp[y * w + x] = acc;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += k[j + r] * tmp[reflect(y + j, h) * w + x];
    out[y * w + x] = acc;
  }
  return out;
}

/**
 * 保护权重：1 = 换色，0 = 保持原 a/b。
 * 纸飞机一类近白物体整块保护；其他近白中性微粒（C<1.5 且 L>95）软保护。
 */
export function protectionWeight(lab: LabImage): { weight: Float64Array; objectPixels: number } {
  const { width: w, height: h, L, a, b } = lab;
  const n = w * h;
  let m: Uint8Array<ArrayBufferLike> = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = Math.hypot(a[i], b[i]) < 3 && L[i] > 80 ? 1 : 0;
  m = erode(erode(m, w, h), w, h);
  m = dilate(dilate(m, w, h), w, h);
  // 太小的连通域只是噪点，不当成物体（至少 0.05% 画面且 ≥ 64 像素）。
  const { mask: comp, size } = pickObjectComponent(m, w, h, Math.max(64, Math.round(n * 0.0005)));
  const object = new Float64Array(n);
  let objectPixels = 0;
  if (size > 0) {
    let pm: Uint8Array<ArrayBufferLike> = fillHoles(comp, w, h);
    for (let i = 0; i < 7; i++) pm = dilate(pm, w, h);
    for (let i = 0; i < n; i++) { object[i] = pm[i]; objectPixels += pm[i]; }
  }
  const objectSoft = objectPixels ? gaussianBlur(object, w, h, 1.5) : object;
  const spec = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const C = Math.hypot(a[i], b[i]);
    spec[i] = Math.min(Math.max(1.5 - C, 0), 1) * Math.min(Math.max((L[i] - 95) / 2, 0), 1);
  }
  const specSoft = gaussianBlur(spec, w, h, 1);
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.min(Math.max(objectSoft[i] * 1.15, 0), 1), specSoft[i]);
    weight[i] = 1 - p;
  }
  return { weight, objectPixels };
}

export type ColorTransferStats = {
  algorithm: typeof COLOR_TRANSFER_ALGORITHM;
  width: number;
  height: number;
  referencePixels: number;
  protectedObjectPixels: number;
  gamutFittedPixels: number;
};

/**
 * 方法 B：把 reference 的 a/b 分布按亮度分段迁移到 target，target 的 L 原样保留。
 * 返回新的 Lab（L 与 target 完全相同）。
 */
export function bandedLabTransfer(reference: LabImage, target: LabImage): { lab: LabImage; stats: Omit<ColorTransferStats, "width" | "height" | "gamutFittedPixels" | "algorithm"> } {
  // 参考色盘：去掉暗像素（文字、线稿）
  const keep: number[] = [];
  for (let i = 0; i < reference.L.length; i++) if (reference.L[i] > REF_MIN_L) keep.push(i);
  if (keep.length < 16) throw new Error("参考图太暗，可用于取色的像素不足，未调色");
  const rL = new Float64Array(keep.length), ra = new Float64Array(keep.length), rb = new Float64Array(keep.length);
  keep.forEach((src, i) => { rL[i] = reference.L[src]; ra[i] = reference.a[src]; rb[i] = reference.b[src]; });
  const refRank = luminanceRank(rL);
  const tRank = luminanceRank(target.L);
  const n = target.L.length;
  const accA = new Float64Array(n), accB = new Float64Array(n), wsum = new Float64Array(n);
  for (let k = 0; k < BANDS; k++) {
    const center = (k + 0.5) / BANDS;
    const wt = bandWeights(tRank, center);
    const wr = bandWeights(refRank, center);
    const t = weightedStats(target.a, target.b, wt);
    const r = weightedStats(ra, rb, wr);
    const T = mklTransform(t.cov, r.cov);
    for (let i = 0; i < n; i++) {
      const da = target.a[i] - t.mean[0], db = target.b[i] - t.mean[1];
      accA[i] += wt[i] * (T[0] * da + T[1] * db + r.mean[0]);
      accB[i] += wt[i] * (T[2] * da + T[3] * db + r.mean[1]);
      wsum[i] += wt[i];
    }
  }
  const { weight, objectPixels } = protectionWeight(target);
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = weight[i];
    a[i] = target.a[i] * (1 - w) + (accA[i] / wsum[i]) * w;
    b[i] = target.b[i] * (1 - w) + (accB[i] / wsum[i]) * w;
  }
  return {
    lab: { width: target.width, height: target.height, L: Float64Array.from(target.L), a, b },
    stats: { referencePixels: keep.length, protectedObjectPixels: objectPixels },
  };
}

/** Lab → 8bit RGB(A)，色域外收缩色度；alpha 从 alphaSource 原样拷贝。 */
export function labToRgb(lab: LabImage, channels: 3 | 4, alphaSource?: Uint8Array): { data: Uint8Array; gamutFittedPixels: number } {
  const n = lab.width * lab.height;
  const out = new Uint8Array(n * channels);
  let fitted = 0;
  for (let i = 0, o = 0; i < n; i++, o += channels) {
    const s = gamutScale(lab.L[i], lab.a[i], lab.b[i]);
    if (s < 1) fitted++;
    labToRgbInto(lab.L[i], lab.a[i] * s, lab.b[i] * s, out, o);
    if (channels === 4) out[o + 3] = alphaSource ? alphaSource[o + 3] : 255;
  }
  return { data: out, gamutFittedPixels: fitted };
}

export type DecodedImage = { data: Uint8Array; width: number; height: number; channels: 3 | 4 };

export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  const image = sharp(bytes, { limitInputPixels: COLOR_TRANSFER_MAX_PIXELS });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("图片无法解码，未调色");
  if (meta.width * meta.height > COLOR_TRANSFER_MAX_PIXELS) throw new Error("图片超过 4096×4096，未调色");
  const { data, info } = await image.toColourspace("srgb").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 && info.channels !== 4) throw new Error("不支持的图片通道数，未调色");
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: info.channels };
}

export type ColorTransferResult = {
  png: Buffer;
  width: number;
  height: number;
  /** 输出与目标图 L 的最大绝对差（只来自 8bit 量化）。 */
  lMaxAbsDiff: number;
  lMeanAbsDiff: number;
  stats: ColorTransferStats;
};

/** 读两张图 → 套色 → PNG。输出尺寸、alpha 与目标图一致；L 偏差超限就报错，不交付。 */
export async function transferImageColor(referenceBytes: Uint8Array, targetBytes: Uint8Array): Promise<ColorTransferResult> {
  const [ref, tgt] = await Promise.all([decodeImage(referenceBytes), decodeImage(targetBytes)]);
  const reference = rgbToLab(ref.data, ref.width, ref.height, ref.channels);
  const target = rgbToLab(tgt.data, tgt.width, tgt.height, tgt.channels);
  const { lab, stats } = bandedLabTransfer(reference, target);
  const { data, gamutFittedPixels } = labToRgb(lab, tgt.channels, tgt.channels === 4 ? tgt.data : undefined);
  const check = rgbToLab(data, tgt.width, tgt.height, tgt.channels);
  let maxDiff = 0, sumDiff = 0;
  for (let i = 0; i < check.L.length; i++) {
    const d = Math.abs(check.L[i] - target.L[i]);
    sumDiff += d;
    if (d > maxDiff) maxDiff = d;
  }
  if (maxDiff > COLOR_TRANSFER_MAX_L_DRIFT) throw new Error(`调色后亮度偏差 ${maxDiff.toFixed(2)} 超过上限，未交付`);
  const png = await sharp(Buffer.from(data.buffer, data.byteOffset, data.length), { raw: { width: tgt.width, height: tgt.height, channels: tgt.channels } }).png().toBuffer();
  return {
    png, width: tgt.width, height: tgt.height,
    lMaxAbsDiff: maxDiff, lMeanAbsDiff: sumDiff / check.L.length,
    stats: { algorithm: COLOR_TRANSFER_ALGORITHM, width: tgt.width, height: tgt.height, ...stats, gamutFittedPixels },
  };
}
