import sharp from "sharp";
import { LOCAL_IMAGE_PATCH_PROFILE } from "../../shared/imageRenderCost";

type Bounds = { left: number; top: number; width: number; height: number };
const decodeOptions = { limitInputPixels: 16_777_216 };

async function readSelection(sourceBytes: Uint8Array, maskBytes: Uint8Array) {
  const [source, mask] = await Promise.all([
    sharp(sourceBytes, decodeOptions)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(maskBytes, decodeOptions)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  const { width, height } = source.info;
  if (width !== mask.info.width || height !== mask.info.height)
    throw new Error("选区与原图尺寸不一致");
  let left = width,
    right = -1,
    top = height,
    bottom = -1,
    count = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const alpha = mask.data[(y * width + x) * 4 + 3];
      if (alpha !== 0 && alpha !== 255)
        throw new Error("选区必须为已确认的二值蒙版");
      if (alpha !== 0) continue;
      count++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  if (!count || count === width * height) throw new Error("没有有效的局部选区");
  // Include nearby edges, light and texture so the replacement fits its setting.
  const padding = Math.max(
    2,
    Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.25)
  );
  const x = Math.max(0, left - padding),
    y = Math.max(0, top - padding);
  const bounds: Bounds = {
    left: x,
    top: y,
    width: Math.min(width, right + padding + 1) - x,
    height: Math.min(height, bottom + padding + 1) - y,
  };
  const side = LOCAL_IMAGE_PATCH_PROFILE.inputSide;
  const scale = side / Math.max(bounds.width, bounds.height);
  const frame = {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
    left: 0,
    top: 0,
  };
  frame.left = Math.floor((side - frame.width) / 2);
  frame.top = Math.floor((side - frame.height) / 2);
  return { source, mask, bounds, frame };
}

export async function prepareLocalImagePatch(
  sourceBytes: Uint8Array,
  maskBytes: Uint8Array
) {
  const { bounds, frame } = await readSelection(sourceBytes, maskBytes);
  const side = LOCAL_IMAGE_PATCH_PROFILE.inputSide;
  const extend = {
    left: frame.left,
    top: frame.top,
    right: side - frame.width - frame.left,
    bottom: side - frame.height - frame.top,
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  };
  const [referencePng, maskPng, overviewPng] = await Promise.all([
    sharp(sourceBytes, decodeOptions)
      .extract(bounds)
      .resize(frame.width, frame.height)
      .extend(extend)
      .png()
      .toBuffer(),
    sharp(maskBytes, decodeOptions)
      .extract(bounds)
      .resize(frame.width, frame.height, { kernel: "nearest" })
      .extend(extend)
      .png()
      .toBuffer(),
    sharp(sourceBytes, decodeOptions)
      .resize(side, side, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer(),
  ]);
  return { bounds, referencePng, maskPng, overviewPng };
}

export function localImagePatchPrompt(instruction: string): string {
  return [
    "Edit image 1 only. It is a cropped detail with surrounding context. Keep its exact framing and positions; preserve any black padding.",
    "Image 2 is the whole original artwork, for style reference only. Never return image 2 or a collage.",
    "Change only the transparent area of the mask on image 1. Inherit the original medium, brushwork, grain, line weight, palette, lighting direction, contrast, perspective and object scale. Do not restyle or redesign the surrounding artwork.",
    "Return the edited crop on the same square canvas, not an isolated object. The application will extract a transparent patch using the confirmed mask and place it back in the original artwork.",
    `Requested local change: ${instruction.trim()}`,
  ].join("\n");
}

/** Build a small transparent layer locally; no second AI background-removal call.
 * Copy only editable pixels back, so protected pixels remain byte-for-byte exact. */
export async function compositeLocalImagePatch(
  sourceBytes: Uint8Array,
  generatedBytes: Uint8Array,
  maskBytes: Uint8Array
) {
  const { source, mask, bounds, frame } = await readSelection(
    sourceBytes,
    maskBytes
  );
  const side = LOCAL_IMAGE_PATCH_PROFILE.inputSide;
  // Two pipelines keep extract coordinates relative to the resized output.
  const normalized = await sharp(generatedBytes, decodeOptions)
    .resize(side, side, { fit: "fill" })
    .png()
    .toBuffer();
  const generated = await sharp(normalized)
    .extract(frame)
    .resize(bounds.width, bounds.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const patch = Buffer.alloc(bounds.width * bounds.height * 4);
  const composited = Buffer.from(source.data);
  for (let y = 0; y < bounds.height; y++)
    for (let x = 0; x < bounds.width; x++) {
      const src = ((bounds.top + y) * source.info.width + bounds.left + x) * 4;
      if (mask.data[src + 3] !== 0) continue;
      const dst = (y * bounds.width + x) * 4;
      generated.copy(patch, dst, dst, dst + 4);
      generated.copy(composited, src, dst, dst + 4);
    }
  const [patchPng, compositedPng] = await Promise.all([
    sharp(patch, {
      raw: { width: bounds.width, height: bounds.height, channels: 4 },
    })
      .png()
      .toBuffer(),
    sharp(composited, {
      raw: {
        width: source.info.width,
        height: source.info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer(),
  ]);
  return { bounds, patchPng, compositedPng };
}
