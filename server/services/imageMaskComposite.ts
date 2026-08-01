import sharp from "sharp";

/** Preserve protected source pixels and blend generated pixels through mask alpha. */
export async function compositeMaskedEditPixels(
  sourceBytes: Uint8Array,
  generatedBytes: Uint8Array,
  maskBytes: Uint8Array
): Promise<Buffer> {
  const sourceMetadata = await sharp(sourceBytes).metadata();
  const width = sourceMetadata.width;
  const height = sourceMetadata.height;
  if (!width || !height) {
    throw new Error("源图尺寸不可读");
  }

  const [source, generated, mask] = await Promise.all([
    sharp(sourceBytes).ensureAlpha().raw().toBuffer(),
    sharp(generatedBytes)
      .resize(width, height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer(),
    sharp(maskBytes)
      .resize(width, height, { fit: "fill", kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);
  const composited = Buffer.alloc(source.length);

  for (let offset = 0; offset < source.length; offset += 4) {
    const editableWeight = 255 - mask[offset + 3];
    const protectedWeight = 255 - editableWeight;
    for (let channel = 0; channel < 4; channel += 1) {
      composited[offset + channel] = Math.round(
        (generated[offset + channel] * editableWeight +
          source[offset + channel] * protectedWeight) /
          255
      );
    }
  }

  return sharp(composited, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
