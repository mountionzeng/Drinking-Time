import sharp from "sharp";
import { z } from "zod";
import { decodeImage, labToRgb, rgbToLab } from "./colorTransfer";

export const OBJECT_PALETTE_ALGORITHM = "semantic-regions-lab-v1";
const point = z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000)]);
export const objectPaletteAssignment = z.object({
  targetEnglish: z.string().min(2).max(100).regex(/^[a-zA-Z][a-zA-Z -]+$/),
  referenceObjectEnglish: z.string().min(2).max(100).regex(/^[a-zA-Z][a-zA-Z -]+$/),
  colors: z.array(z.object({ hex: z.string().regex(/^#[0-9a-f]{6}$/i), sharePercent: z.number().int().min(1).max(100) })).min(1).max(6),
  regions: z.array(z.object({ contour: z.array(point).min(6).max(32), anchor: point })).min(1).max(64),
  protectedSamples: z.array(point).min(3).max(24),
}).refine(value => value.colors.reduce((sum, color) => sum + color.sharePercent, 0) === 100);
type Point = [number, number];

function inside(x: number, y: number, contour: Point[]) {
  let yes = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i], b = contour[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

/** Coordinates describe semantic silhouettes, never bounding rectangles or user lassos. */
function rasterize(contour: Point[], width: number, height: number) {
  const points = contour.map(([x, y]): Point => [x * width / 1000, y * height / 1000]);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a[1] > y + 0.5) !== (b[1] > y + 0.5)) intersections.push(a[0] + (y + 0.5 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2)
      for (let x = Math.max(0, Math.ceil(intersections[i] - 0.5)); x <= Math.min(width - 1, Math.floor(intersections[i + 1] - 0.5)); x++) mask[y * width + x] = 1;
  }
  return mask;
}

/** Inward-only feathering: it can never expand an approximate semantic contour. */
function inwardWeights(mask: Uint8Array, width: number, height: number) {
  const distances = Float32Array.from(mask, value => value ? 10000 : 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (mask[p]) distances[p] = Math.min(distances[p], x ? distances[p - 1] + 1 : 1, y ? distances[p - width] + 1 : 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const p = y * width + x;
    if (mask[p]) distances[p] = Math.min(distances[p], x + 1 < width ? distances[p + 1] + 1 : 1, y + 1 < height ? distances[p + width] + 1 : 1);
  }
  const feather = Math.max(2, Math.min(width, height) / 240);
  return distances.map(distance => Math.max(0, Math.min(1, (distance - 1) / feather)));
}

export async function gradeObjectPalette(bytes: Uint8Array, rawAssignments: unknown) {
  const assignments = z.array(objectPaletteAssignment).min(1).max(4).parse(rawAssignments);
  const source = await decodeImage(bytes);
  const { width, height, channels } = source;
  const lab = rgbToLab(source.data, width, height, channels);
  const output = { ...lab, a: lab.a.slice(), b: lab.b.slice() };
  const weights = new Float32Array(width * height);
  const owner = new Int16Array(width * height).fill(-1);
  const regions: Array<{ assignment: number; indices: number[]; a: number; b: number; area: number }> = [];
  const sampleIndex = ([x, y]: Point) => Math.min(height - 1, Math.floor(y * height / 1000)) * width + Math.min(width - 1, Math.floor(x * width / 1000));
  const distance = (p: number, q: number) => Math.hypot(lab.a[p] - lab.a[q], lab.b[p] - lab.b[q], (lab.L[p] - lab.L[q]) * 0.25);
  for (const [ai, assignment] of assignments.entries()) {
    const protectedIndices = assignment.protectedSamples.map(sampleIndex);
    for (const region of assignment.regions) {
      if (!inside(...region.anchor, region.contour)) throw new Error("对象定位点不在轮廓内 / Object anchor is outside its contour");
      const mask = rasterize(region.contour, width, height);
      const localWeights = inwardWeights(mask, width, height);
      const anchor = sampleIndex(region.anchor);
      const indices: number[] = [];
      let a = 0, b = 0, area = 0;
      for (let p = 0; p < mask.length; p++) {
        if (!localWeights[p] || (channels === 4 && !source.data[p * channels + 3])) continue;
        // Color evidence only narrows AI's silhouette; it cannot select another similar-colored object.
        const foregroundDistance = distance(p, anchor);
        const backgroundDistance = Math.min(...protectedIndices.map(q => distance(p, q)));
        const confidence = Math.max(0, Math.min(1, (backgroundDistance - foregroundDistance) / 8));
        // Persist exactly the same discrete mask that is used to edit pixels.
        const weight = Math.floor(localWeights[p] * confidence * 255) / 255;
        if (!weight) continue;
        if (owner[p] >= 0) {
          if (regions[owner[p]].assignment !== ai) throw new Error("不同目标的修改区域重叠 / Different target regions overlap");
          continue;
        }
        owner[p] = regions.length;
        weights[p] = weight;
        indices.push(p); area += weight; a += lab.a[p] * weight; b += lab.b[p] * weight;
      }
      if (area >= 4) regions.push({ assignment: ai, indices, a: a / area, b: b / area, area });
      else { for (const p of indices) { owner[p] = -1; weights[p] = 0; } }
    }
  }
  const editedPixels = weights.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
  if (editedPixels < Math.max(16, width * height * 0.001) || editedPixels > width * height * 0.85)
    throw new Error("对象范围为空、过小或过大，未交付 / Object mask is empty, too small or too broad");

  const allocations: Array<{ target: string; areaShares: number[] }> = [];
  for (const [ai, assignment] of assignments.entries()) {
    const parts = regions.filter(region => region.assignment === ai).sort((a, b) => b.area - a.area);
    if (!parts.length) throw new Error("目标未形成有效范围 / No usable target region");
    const total = parts.reduce((sum, region) => sum + region.area, 0);
    const palette = assignment.colors.map(color => {
      const rgb = Uint8Array.from([1, 3, 5].map(i => parseInt(color.hex.slice(i, i + 2), 16)));
      const c = rgbToLab(rgb, 1, 1, 3);
      return { a: c.a[0], b: c.b[0], budget: total * color.sharePercent / 100 };
    });
    const used = palette.map(() => 0);
    // Allocate entire existing surfaces, not synthetic color patches or stripes.
    // Shares are requested area budgets; actual allocation is measured and stored, never called exact.
    for (const part of parts) {
      let chosen = 0, best = Infinity;
      for (const [index, color] of palette.entries()) {
        const overflow = Math.max(0, used[index] + part.area - color.budget) / total;
        const deficit = (color.budget - used[index]) / total;
        const score = overflow * 1000 - deficit * 100 + Math.hypot(part.a - color.a, part.b - color.b) * 0.05;
        if (score < best) { chosen = index; best = score; }
      }
      used[chosen] += part.area;
      for (const p of part.indices) {
        output.a[p] += (palette[chosen].a - part.a) * weights[p];
        output.b[p] += (palette[chosen].b - part.b) * weights[p];
      }
    }
    allocations.push({ target: assignment.targetEnglish, areaShares: used.map(area => Math.round(area / total * 1000) / 10) });
  }
  const { data } = labToRgb(output, channels, channels === 4 ? source.data : undefined);
  // Even RGB/Lab roundtrip rounding is forbidden outside the actual modification mask.
  for (let p = 0; p < weights.length; p++) if (!weights[p])
    for (let c = 0; c < channels; c++) data[p * channels + c] = source.data[p * channels + c];
  const actual = rgbToLab(data, width, height, channels);
  let outsideChangedPixels = 0, maxLDrift = 0, totalChromaChange = 0, changedPixels = 0;
  for (let p = 0; p < weights.length; p++) {
    const delta = Math.hypot(actual.a[p] - lab.a[p], actual.b[p] - lab.b[p]);
    maxLDrift = Math.max(maxLDrift, Math.abs(actual.L[p] - lab.L[p]));
    if (weights[p]) { totalChromaChange += delta; if (delta >= 3) changedPixels++; }
    else if ([0, 1, 2].some(c => data[p * channels + c] !== source.data[p * channels + c])) outsideChangedPixels++;
  }
  const meanChromaChange = totalChromaChange / editedPixels;
  if (outsideChangedPixels || maxLDrift > 1) throw new Error("保护区域或明暗校验失败 / Protected pixels or luminance check failed");
  if (meanChromaChange < 3 || changedPixels / editedPixels < 0.25) throw new Error("配色变化太小，未作为成功候选交付 / Color change is too small; no successful candidate delivered");
  const png = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  const maskPng = await sharp(Uint8Array.from(weights, w => Math.round(w * 255)), { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { png, maskPng, stats: { algorithm: OBJECT_PALETTE_ALGORITHM, width, height, regions: regions.length,
    editedPixels, outsideChangedPixels, maxLDrift, meanChromaChange, changedFraction: changedPixels / editedPixels, allocations } };
}
