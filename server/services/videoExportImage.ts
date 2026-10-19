import fs from "node:fs/promises";
import sharp from "sharp";
import type { TimelineTransform } from "../../shared/storyMaterial";
import { loadAuthorizedStoryImage } from "../persistence/storyVisualPersistence";
import { localImagePathForUrl } from "./imageAssets";

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));

/** Match preview's cover + center-origin translate/rotate/scale/flip. Decode before SVG embedding. */
export async function renderExportImageBytes(
  bytes: Buffer,
  transform: TimelineTransform,
  dimensions: { width: number; height: number }
): Promise<Buffer> {
  const png = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .png()
    .toBuffer();
  const { width, height } = dimensions;
  const zoom = clamp(transform.zoom, 0.25, 8);
  const x = width / 2 + (clamp(transform.panX, -1, 1) * width) / 2;
  const y = height / 2 + (clamp(transform.panY, -1, 1) * height) / 2;
  const angle = clamp(transform.rotationDeg ?? 0, -180, 180);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><g transform="translate(${x} ${y}) rotate(${angle}) scale(${zoom * (transform.flipX ? -1 : 1)} ${zoom * (transform.flipY ? -1 : 1)})"><image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${png.toString("base64")}"/></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function renderExportImage(input: {
  storyId: number;
  userId: number;
  imageId: number;
  transform: TimelineTransform;
  dimensions: { width: number; height: number };
  outputPath: string;
}) {
  const image = await loadAuthorizedStoryImage(input);
  if (!image)
    throw new Error(
      `图片 #${input.imageId} 不存在或不属于当前故事，请补齐后再导出`
    );
  // Resolve only the authorized durable image, never a clip-supplied URL or arbitrary network path.
  const file = localImagePathForUrl(image.imageUrl);
  if (!file)
    throw new Error(
      `图片 #${input.imageId} 尚未保存在本站，请导入图片后再导出`
    );
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > 32 * 1024 * 1024)
    throw new Error(
      `图片 #${input.imageId} 文件缺失或超过 32MB，请补齐后再导出`
    );
  const bytes = await fs.readFile(file);
  await fs.writeFile(
    input.outputPath,
    await renderExportImageBytes(bytes, input.transform, input.dimensions)
  );
}
