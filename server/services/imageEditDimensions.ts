import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ImageDimensions, ImageEditDimensionCheck } from "../../shared/chatImageRevision";
import { materializeImageInput } from "./imageAssets";
import { storeImageBytes, type ImageGenResult } from "./imageGen";

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096;

async function readImage(imageUrl: string) {
  const input = await materializeImageInput(imageUrl);
  const inline = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(input);
  let bytes: Buffer;
  if (inline) bytes = Buffer.from(inline[1], "base64");
  else {
    if (!/^https:\/\//i.test(input)) throw new Error("图片无法读取 / Image unavailable");
    const response = await fetch(input, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES)
      throw new Error("图片无法读取 / Image unavailable");
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("图片过大或为空 / Invalid image size");
  const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
    throw new Error("需要静态图片 / A still image is required");
  const swapped = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  return {
    bytes,
    size: { width: swapped ? metadata.height : metadata.width, height: swapped ? metadata.width : metadata.height },
  };
}

export async function readImageDimensions(imageUrl: string): Promise<ImageDimensions> {
  return (await readImage(imageUrl)).size;
}

/** Only uniform resizing is allowed. Wrong-aspect/unreadable outputs remain visible but cannot be adopted. */
export async function normalizeImageEditResult(result: ImageGenResult, expected: ImageDimensions) {
  const checks: Record<string, ImageEditDimensionCheck> = {};
  if (result.status !== "ok") return { result, checks };
  const candidates = result.candidates?.length ? result.candidates : result.imageUrl ? [{ imageUrl: result.imageUrl, imageKey: result.imageKey }] : [];
  const normalized = [];
  for (const candidate of candidates) {
    let output = candidate;
    const check: ImageEditDimensionCheck = { status: "unverified", expected, originalImageUrl: candidate.imageUrl };
    try {
      const { bytes, size } = await readImage(candidate.imageUrl);
      check.provider = check.output = size;
      if (size.width === expected.width && size.height === expected.height) check.status = "matched";
      else if (size.width * expected.height !== size.height * expected.width) check.status = "mismatch";
      else {
        // Exact ratio equality above guarantees this is uniform scaling, never crop, stretch or padding.
        const resized = await sharp(bytes).rotate().resize(expected.width, expected.height).png().toBuffer();
        const hash = createHash("sha256").update(bytes).update(`${expected.width}x${expected.height}`).digest("hex");
        const stored = await storeImageBytes(resized, "image/png", { storageKey: `generated/edit-dimensions/${hash}.png`, requireLocal: true });
        if (stored.status !== "ok" || !stored.imageUrl) throw new Error("Image storage unavailable");
        output = { imageUrl: stored.imageUrl, imageKey: stored.imageKey };
        check.status = "resized";
        check.output = expected;
      }
    } catch { /* Preserve the paid result and mark it unverified; never resubmit. */ }
    checks[output.imageUrl] = check;
    normalized.push(output);
  }
  return { result: { ...result, ...normalized[0], candidates: normalized }, checks };
}
