type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** Full-resolution RGBA comparison. Planned edit masks must not stand in for this. */
export function imagePixelChanges(source: Pixels, candidate: Pixels) {
  if (source.width !== candidate.width || source.height !== candidate.height) throw new Error("size-mismatch");
  const totalPixels = source.width * source.height;
  if (!Number.isSafeInteger(totalPixels) || totalPixels <= 0 || source.data.length !== totalPixels * 4 || candidate.data.length !== totalPixels * 4) throw new Error("invalid-pixels");
  const pixels = new Uint8ClampedArray(source.data.length);
  let changedPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const changed = source.data[offset] !== candidate.data[offset] || source.data[offset + 1] !== candidate.data[offset + 1]
      || source.data[offset + 2] !== candidate.data[offset + 2] || source.data[offset + 3] !== candidate.data[offset + 3];
    if (changed) changedPixels++;
    // Changed pixels are pink; unchanged source pixels remain visible at low contrast.
    pixels[offset] = changed ? 236 : source.data[offset];
    pixels[offset + 1] = changed ? 72 : source.data[offset + 1];
    pixels[offset + 2] = changed ? 153 : source.data[offset + 2];
    pixels[offset + 3] = changed ? 255 : Math.round(source.data[offset + 3] * .3);
  }
  return { pixels, changedPixels, totalPixels };
}

async function readImagePixels(url: string, signal: AbortSignal): Promise<Pixels> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("image-unavailable");
  // Compare stored color samples: browser gamma/profile conversion can otherwise
  // mark the whole image as changed when an exporter drops PNG color metadata.
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas-unavailable");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

export async function compareImagePixels(sourceUrl: string, candidateUrl: string, signal: AbortSignal, read = readImagePixels) {
  const [source, candidate] = await Promise.all([read(sourceUrl, signal), read(candidateUrl, signal)]);
  signal.throwIfAborted();
  return { ...imagePixelChanges(source, candidate), width: source.width, height: source.height };
}
