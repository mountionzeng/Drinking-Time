import { readImagePackBlob } from "./imagePackImageBlob";
export type ImagePackPalette = { paper: string; ink: string; accent: string };
export const IMAGE_PACK_TEXTURES = { paper: "细纸", fiber: "宣纸", linen: "织纹" } as const;
export type ImagePackTexture = keyof typeof IMAGE_PACK_TEXTURES;

// A small quantized histogram, not iterative clustering. Sampling is bounded
// to 32×32 pixels, independent of the original image's resolution.
function dominantColor(pixels: ArrayLike<number>, preferColor = false): number[] | null {
  const bins = new Map<number, { count: number; rgb: number[] }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (pixels[i + 3] < 128 || Math.max(...rgb) < 24 || Math.min(...rgb) > 240) continue;
    const key = (rgb[0] >> 5) * 64 + (rgb[1] >> 5) * 8 + (rgb[2] >> 5);
    const bin = bins.get(key) ?? { count: 0, rgb: [0, 0, 0] };
    bin.count++;
    rgb.forEach((value, channel) => { bin.rgb[channel] += value; });
    bins.set(key, bin);
  }
  let dominant: { count: number; rgb: number[] } | undefined;
  let colorful: typeof dominant;
  let total = 0, colorfulCount = 0;
  for (const bin of bins.values()) {
    if (!dominant || bin.count > dominant.count) dominant = bin;
    total += bin.count;
    const rgb = bin.rgb.map(value => value / bin.count);
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    if (chroma >= 20 && chroma / Math.max(...rgb) >= .15) {
      colorfulCount += bin.count;
      if (!colorful || bin.count > colorful.count) colorful = bin;
    }
  }
  // Neutral walls/paper should not hide an artwork's warm or cool colors.
  // Tiny colored marks in otherwise monochrome images should not dominate either.
  if (preferColor && colorfulCount >= total * .1 && colorful) dominant = colorful;
  return dominant ? dominant.rgb.map(value => value / dominant.count) : null;
}

function paletteFromColor(rgb: number[], white: number): ImagePackPalette {
  const mix = (target: number, amount: number) => `#${rgb.map(value => Math.round(value * (1 - amount) + target * amount).toString(16).padStart(2, "0")).join("")}`;
  return { paper: mix(255, white), ink: mix(0, .78), accent: mix(80, .35) };
}

// Keep the original cover palette for selected AI backgrounds and saved draft identity.
export function paletteFromPixels(pixels: ArrayLike<number>): ImagePackPalette {
  return paletteFromColor(dominantColor(pixels) ?? [160, 160, 150], .88);
}

export function paperPaletteFromImages(cover: ArrayLike<number> | undefined,
  illustrations: ArrayLike<number>[]): ImagePackPalette {
  const colors: { rgb: number[]; weight: number }[] = [];
  const coverColor = cover && dominantColor(cover, true);
  if (coverColor) colors.push({ rgb: coverColor, weight: 2 });
  for (const pixels of illustrations) {
    const rgb = dominantColor(pixels, true);
    if (rgb) colors.push({ rgb, weight: 1 });
  }
  const weight = colors.reduce((sum, color) => sum + color.weight, 0);
  const rgb = weight ? [0, 1, 2].map(channel =>
    colors.reduce((sum, color) => sum + color.rgb[channel] * color.weight, 0) / weight
  ) : [160, 160, 150];
  // A visible paper tint, with dark ink and enough luminance for long-form reading.
  return paletteFromColor(rgb, .68);
}

async function readImagePixels(url: string, signal: AbortSignal): Promise<Uint8ClampedArray> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(await readImagePackBlob(url, signal));
  try {
    signal.throwIfAborted();
    const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法读取图片颜色");
    context.drawImage(bitmap, 0, 0, 32, 32);
    return context.getImageData(0, 0, 32, 32).data;
  } finally { bitmap.close(); }
}

export async function readImagePackPalettes(coverUrl: string | undefined,
  illustrationUrls: string[], signal: AbortSignal) {
  const urls = [...new Set([coverUrl, ...illustrationUrls].filter((url): url is string => !!url))];
  const samples = new Map<string, Uint8ClampedArray>();
  for (const url of urls) samples.set(url, await readImagePixels(url, signal));
  signal.throwIfAborted();
  const cover = coverUrl ? samples.get(coverUrl) : undefined;
  return {
    palette: cover ? paletteFromPixels(cover) : undefined,
    paperPalette: paperPaletteFromImages(cover,
      urls.filter(url => url !== coverUrl).map(url => samples.get(url)!)),
  };
}

export function drawPaperMaterial(context: CanvasRenderingContext2D, width: number, height: number,
  palette: ImagePackPalette, texture: ImagePackTexture, seed = 1) {
  context.fillStyle = palette.paper;
  context.fillRect(0, 0, width, height);
  const tile = Object.assign(document.createElement("canvas"), { width: 160, height: 160 });
  const grain = tile.getContext("2d");
  if (!grain) return;
  let state = seed + 1;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  grain.fillStyle = palette.accent;
  for (let i = 0; i < 1600; i++) {
    grain.globalAlpha = .015 + random() * (seed % 2 ? .08 : .05);
    const x = random() * 160; const y = random() * 160;
    const w = seed % 2 ? 1.5 : 1;
    const h = texture === "fiber" ? 2 + random() * (seed % 2 ? 14 : 7) : 1;
    // Wrap strokes at tile edges so repeated paper has no visible seams.
    for (const dx of [0, -160]) for (const dy of [0, -160]) grain.fillRect(x + dx, y + dy, w, h);
  }
  if (texture === "linen") {
    grain.globalAlpha = .055;
    for (let i = 0; i < 160; i += 4) {
      grain.fillRect(i, 0, 1, 160); grain.fillRect(0, i, 160, 1);
    }
  }
  const pattern = context.createPattern(tile, "repeat");
  if (pattern) { context.fillStyle = pattern; context.fillRect(0, 0, width, height); }
}
