import sharp from "sharp";
import { getStoryById } from "../repositories/stories";
import { getStoryGeneratedImages } from "../repositories/images";
import { readStoryImageBytes } from "./chatColorTransfer";

/** A geometry check, not semantic recognition or an editing mask. Never writes media. */
export async function compareFrameGeometry(reference: Uint8Array, target: Uint8Array) {
  const decode = async (bytes: Uint8Array) => {
    const image = sharp(bytes).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > 4096 * 4096)
      throw new Error("图片尺寸无法核对 / Image dimensions unavailable");
    const swapped = [5, 6, 7, 8].includes(meta.orientation ?? 1);
    const size = { width: swapped ? meta.height : meta.width, height: swapped ? meta.width : meta.height };
    // Resampling is for the comparison only. Neither source asset is resized.
    const pixels = await image.resize(96, 96, { fit: "fill" }).removeAlpha().greyscale().raw().toBuffer();
    const edges: number[] = [];
    for (let y = 1; y < 95; y++) for (let x = 1; x < 95; x++) {
      const i = y * 96 + x;
      edges.push(pixels[i + 1] - pixels[i - 1], pixels[i + 96] - pixels[i - 96]);
    }
    return { size, edges };
  };
  const [a, b] = await Promise.all([decode(reference), decode(target)]);
  const sameDimensions = a.size.width === b.size.width && a.size.height === b.size.height;
  const sameAspect = a.size.width * b.size.height === b.size.width * a.size.height;
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < a.edges.length; i++) {
    aa += a.edges[i] ** 2; bb += b.edges[i] ** 2; ab += a.edges[i] * b.edges[i];
  }
  const edgeCorrelation = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null;
  return {
    referenceSize: a.size, targetSize: b.size, sameDimensions,
    sameAspect,
    edgeCorrelation,
    // High similarity is only a local correspondence hint, never object-mask approval.
    positionConsistent: sameAspect && edgeCorrelation !== null && edgeCorrelation >= 0.96,
  };
}

export async function inspectFrameColorMatch(input: {
  storyId: number; userId: number; targetImageId: number; referenceImageId: number;
}) {
  if (!await getStoryById(input.storyId, input.userId)) throw new Error("故事不存在或无权访问 / Story unavailable");
  const images = await getStoryGeneratedImages(input.storyId, input.userId);
  const target = images.find(image => image.id === input.targetImageId);
  const reference = images.find(image => image.id === input.referenceImageId);
  if (!target || !reference) throw new Error("两张图必须属于当前故事 / Both images must belong to this story");
  return compareFrameGeometry(await readStoryImageBytes(reference), await readStoryImageBytes(target));
}
