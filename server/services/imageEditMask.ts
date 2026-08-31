import sharp from "sharp";

export type CanonicalEditMask = {
  editMask: Buffer;
  previewMask: Buffer;
  width: number;
  height: number;
  editablePixelCount: number;
};

type RawMask = {
  data: Buffer;
  info: { width: number; height: number; channels: number };
};

export type SourceMaskPoint = { x: number; y: number };

// A canonical mask temporarily needs the decoded source plus a selection map
// and two RGBA outputs. Keep this below a single 4K-ish frame and serialize a
// small number of conversions so concurrent clicks cannot exhaust the process.
const MAX_MASK_PIXELS = 12_000_000;
const MAX_CONCURRENT_CANONICALIZATIONS = 2;
let activeCanonicalizations = 0;
const canonicalizationWaiters: Array<() => void> = [];

async function withCanonicalizationSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeCanonicalizations >= MAX_CONCURRENT_CANONICALIZATIONS) {
    await new Promise<void>(resolve => canonicalizationWaiters.push(resolve));
  }
  activeCanonicalizations += 1;
  try {
    return await task();
  } finally {
    activeCanonicalizations -= 1;
    canonicalizationWaiters.shift()?.();
  }
}

function pixelSignal(raw: RawMask, pixelIndex: number, useAlpha: boolean): number {
  const offset = pixelIndex * raw.info.channels;
  if (useAlpha && raw.info.channels >= 4) return raw.data[offset + 3] ?? 0;
  const red = raw.data[offset] ?? 0;
  const green = raw.data[offset + Math.min(1, raw.info.channels - 1)] ?? red;
  const blue = raw.data[offset + Math.min(2, raw.info.channels - 1)] ?? red;
  return Math.round((red + green + blue) / 3);
}

function varyingAlpha(raw: RawMask): boolean {
  if (raw.info.channels < 4) return false;
  let minimum = 255;
  let maximum = 0;
  for (let offset = 3; offset < raw.data.length; offset += raw.info.channels) {
    const value = raw.data[offset] ?? 0;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return maximum - minimum >= 16;
}

function selectedPixels(raw: RawMask, clickX: number, clickY: number): Uint8Array {
  const width = raw.info.width;
  const height = raw.info.height;
  const x = Math.min(width - 1, Math.max(0, Math.round(clickX)));
  const y = Math.min(height - 1, Math.max(0, Math.round(clickY)));
  const useAlpha = varyingAlpha(raw);
  const clickSignal = pixelSignal(raw, y * width + x, useAlpha);
  const clickIsHigh = clickSignal >= 128;
  const selected = new Uint8Array(width * height);
  for (let index = 0; index < selected.length; index += 1) {
    const high = pixelSignal(raw, index, useAlpha) >= 128;
    selected[index] = high === clickIsHigh ? 1 : 0;
  }
  return selected;
}

function pointInPolygon(point: SourceMaskPoint, polygon: SourceMaskPoint[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function assertSafeSelection(selected: Uint8Array, message: string): void {
  const count = selected.reduce((sum, value) => sum + value, 0);
  if (count === 0 || count / selected.length >= 0.98) throw new Error(message);
}

function constrainSelectionToPolygon(input: {
  selected: Uint8Array;
  width: number;
  height: number;
  clickX: number;
  clickY: number;
  polygon: SourceMaskPoint[];
}): Uint8Array {
  const { polygon, width, height } = input;
  if (
    polygon.length < 3 ||
    polygon.length > 512 ||
    polygon.some(point =>
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > width ||
      point.y > height
    ) ||
    !pointInPolygon({ x: input.clickX, y: input.clickY }, polygon)
  ) {
    throw new Error("圈选路径无效，请重新圈住要修改的物体");
  }
  const constrained = input.selected.slice();
  for (let index = 0; index < constrained.length; index += 1) {
    if (constrained[index] === 0) continue;
    const point = {
      x: index % width + 0.5,
      y: Math.floor(index / width) + 0.5,
    };
    if (!pointInPolygon(point, polygon)) constrained[index] = 0;
  }
  assertSafeSelection(constrained, "圈选范围内没有识别到可修改的语义对象");
  return constrained;
}

async function encodeCanonicalMasks(
  selected: Uint8Array,
  width: number,
  height: number,
  wholeImageMessage: string
): Promise<CanonicalEditMask> {
  const editablePixelCount = selected.reduce((sum, value) => sum + value, 0);
  const ratio = editablePixelCount / selected.length;
  if (editablePixelCount === 0 || ratio >= 0.98) {
    throw new Error(wholeImageMessage);
  }

  const editRgba = Buffer.alloc(width * height * 4);
  const previewRgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < selected.length; index += 1) {
    const offset = index * 4;
    const editable = selected[index] === 1;
    editRgba[offset + 3] = editable ? 0 : 255;
    if (!editable) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const boundary =
      x === 0 ||
      y === 0 ||
      x === width - 1 ||
      y === height - 1 ||
      selected[index - 1] === 0 ||
      selected[index + 1] === 0 ||
      selected[index - width] === 0 ||
      selected[index + width] === 0;
    previewRgba[offset] = 34;
    previewRgba[offset + 1] = 211;
    previewRgba[offset + 2] = 238;
    previewRgba[offset + 3] = boundary ? 230 : 92;
  }

  const [editMask, previewMask] = await Promise.all([
    sharp(editRgba, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    sharp(previewRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  ]);
  return { editMask, previewMask, width, height, editablePixelCount };
}

/**
 * Convert provider-specific SAM output into the single mask contract used by
 * GPT-image and imageMaskComposite: transparent pixels are editable and
 * opaque pixels are protected.
 */
export async function canonicalizeEditMask(input: {
  maskBytes: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  clickX: number;
  clickY: number;
  selectionPolygon?: SourceMaskPoint[];
}): Promise<CanonicalEditMask> {
  return withCanonicalizationSlot(() => canonicalizeEditMaskWithinBudget(input));
}

async function canonicalizeEditMaskWithinBudget(input: {
  maskBytes: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  clickX: number;
  clickY: number;
  selectionPolygon?: SourceMaskPoint[];
}): Promise<CanonicalEditMask> {
  const width = Math.round(input.sourceWidth);
  const height = Math.round(input.sourceHeight);
  if (width <= 0 || height <= 0 || width * height > MAX_MASK_PIXELS) {
    throw new Error("源图尺寸无效");
  }
  if (
    !Number.isFinite(input.clickX) ||
    !Number.isFinite(input.clickY) ||
    input.clickX < 0 ||
    input.clickY < 0 ||
    input.clickX >= width ||
    input.clickY >= height
  ) {
    throw new Error("点击位置超出源图范围");
  }

  const raw = await sharp(input.maskBytes)
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const providerSelection = selectedPixels(raw, input.clickX, input.clickY);
  assertSafeSelection(
    providerSelection,
    "没有识别到可安全编辑的单个物体"
  );
  const selected = input.selectionPolygon
    ? constrainSelectionToPolygon({
        selected: providerSelection,
        width,
        height,
        clickX: input.clickX,
        clickY: input.clickY,
        polygon: input.selectionPolygon,
      })
    : providerSelection;
  return encodeCanonicalMasks(
    selected,
    width,
    height,
    "没有识别到可安全编辑的单个物体"
  );
}
