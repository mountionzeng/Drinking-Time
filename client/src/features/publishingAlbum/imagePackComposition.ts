import { PUBLISHING_ALBUM_MAX_PAGES, type PublishingAlbumRegionLayout } from "@shared/publishingAlbum";
import { publishingAlbumGraphemes } from "./publishingAlbumLayout";
import { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";
import { preparePublishingAlbumExportPage, renderPublishingAlbumPagePng } from "./publishingAlbumExport";
import { drawPaperMaterial, type ImagePackPalette, type ImagePackTexture } from "./imagePackMaterial";
import type { PublishingImageOutputKind } from "@shared/publishingDraft";

export type PackAsset = { id: number; imageUrl: string; label: string; warning?: string; kind?: PublishingImageOutputKind; parentAssetId?: number | null };
export const IMAGE_PACK_STYLES = {
  sage: { label: "拾光绿", paper: "#eef3e9", ink: "#294936", accent: "#809a77" },
  paper: { label: "暖纸白", paper: "#f7f1e6", ink: "#4d4032", accent: "#b49770" },
  ink: { label: "黑白刊物", paper: "#f5f5f2", ink: "#252824", accent: "#797e75" },
} as const;
export type ImagePackOptions = {
  title: string;
  body: string;
  fontId: string;
  style: keyof typeof IMAGE_PACK_STYLES;
  palette?: ImagePackPalette;
  texture?: ImagePackTexture;
  textureSeed?: number;
  includeCover: boolean;
  coverUrl?: string;
  illustrationUrl?: string;
  bodyTextureUrl?: string;
  illustrationPosition: "above" | "middle";
};
export type ImagePackPage = { kind: "cover" | "body"; text: string; illustration: boolean };
export type ImagePackResult = { label: string; filename: string; blob: Blob };
const repository = new PublishingAlbumFontRepository();

// Bounded pages and grapheme-aware linear pagination: never truncate the article.
export function planImagePack(options: ImagePackOptions): ImagePackPage[] {
  const body = options.body.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new Error("请先写好正文");
  if (options.includeCover && !options.coverUrl) throw new Error("先从上方选择一张封面图片");
  if (options.includeCover && !options.title.trim()) throw new Error("请填写封面标题");
  const text = publishingAlbumGraphemes(body);
  const pages: ImagePackPage[] = [];
  if (options.includeCover) pages.push({ kind: "cover", text: options.title.trim(), illustration: false });
  // Budget explicit newlines and wrapping, preserving the original characters.
  // Only the illustrated page reserves image space; ordinary pages stay full.
  const lines: string[] = [];
  let chunk: string[] = []; let column = 0;
  for (const glyph of text) {
    if (column === 18 && glyph !== "\n") {
      lines.push(chunk.join("")); chunk = []; column = 0;
    }
    chunk.push(glyph);
    if (glyph === "\n") {
      lines.push(chunk.join("")); chunk = []; column = 0;
    } else { column++; }
  }
  if (chunk.length) lines.push(chunk.join(""));
  const count = Math.ceil((lines.length + (options.illustrationUrl ? 7 : 0)) / 14);
  if (count + pages.length > PUBLISHING_ALBUM_MAX_PAGES) {
    throw new Error("整套图片最多 9 张，请精简正文或不插入配图后重试；正文不会被截断");
  }
  const illustrated = options.illustrationPosition === "above" ? 0 : Math.floor(count / 2);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const illustration = Boolean(options.illustrationUrl) && index === illustrated;
    const take = Math.min(illustration ? 7 : 14, lines.length - offset - (count - index - 1));
    pages.push({ kind: "body", text: lines.slice(offset, offset + take).join(""), illustration });
    offset += take;
  }
  return pages;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片合成失败")), "image/png"));
}

export async function makeImagePack(
  options: ImagePackOptions,
  onProgress: (completed: number, total: number) => void,
  signal: AbortSignal,
): Promise<ImagePackResult[]> {
  const pages = planImagePack(options);
  const style = options.palette ?? IMAGE_PACK_STYLES[options.style];
  const bitmaps = new Map<string, ImageBitmap>();
  const results: ImagePackResult[] = [];
  const assertCurrent = () => signal.throwIfAborted();
  async function drawImage(context: CanvasRenderingContext2D, url: string, rect: number[]) {
    let bitmap = bitmaps.get(url);
    if (!bitmap) {
      const response = await fetch(url, { credentials: "same-origin", signal });
      if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
      bitmap = await createImageBitmap(await response.blob());
      bitmaps.set(url, bitmap);
    }
    const [x, y, width, height] = rect;
    // Contain illustrations so important content is not silently cropped.
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    context.drawImage(bitmap, x + (width - bitmap.width * scale) / 2, y + (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  }
  try {
    for (let index = 0; index < pages.length; index++) {
      assertCurrent();
      const page = pages[index]!;
      const canvas = Object.assign(document.createElement("canvas"), { width: 900, height: 1200 });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法制作图片");
      if (options.bodyTextureUrl) {
        // Use the chosen image as-is; its own decoration is the only decoration.
        context.fillStyle = style.paper;
        context.fillRect(0, 0, 900, 1200);
        await drawImage(context, options.bodyTextureUrl, [0, 0, 900, 1200]);
      } else {
        drawPaperMaterial(context, 900, 1200, style, options.texture ?? "paper", options.textureSeed ?? 0);
      }
      if (page.kind === "cover") {
        await drawImage(context, options.coverUrl!, [65, 110, 770, 710]);
      }
      if (page.illustration) await drawImage(context, options.illustrationUrl!, [80, 80, 740, 740 * 9 / 16]);
      assertCurrent();
      const typography: PublishingAlbumRegionLayout = {
        layoutVersion: 1, kind: "region", shape: "rectangle", direction: "horizontal",
        fontId: options.fontId, alignment: page.kind === "cover" ? "center" : "start",
        fontSize: page.kind === "cover" ? 60 : 36, letterSpacing: 1, lineSpacing: 1.6,
        region: page.kind === "cover" ? { x: .07, y: .70, width: .86, height: .19 }
          : page.illustration ? { x: .05, y: .43, width: .9, height: .47 }
          : { x: .05, y: .08, width: .9, height: .82 },
        contrast: { textColor: style.ink, outlineColor: null, outlineWidth: 0, backdropColor: null },
      };
      const url = URL.createObjectURL(await toBlob(canvas));
      try {
        const prepared = await preparePublishingAlbumExportPage({
          pageId: `image-pack-${index}`, ordinal: index + 1, text: page.text,
          backgroundUrl: url, typography, repository,
        });
        assertCurrent();
        const blob = await renderPublishingAlbumPagePng({ page: prepared, repository });
        assertCurrent();
        const label = page.kind === "cover" ? "封面" : page.illustration ? "正文 · 插图" : "正文";
        results.push({ label, filename: `图文-${String(index + 1).padStart(2, "0")}.png`, blob });
        onProgress(index + 1, pages.length);
      } finally { URL.revokeObjectURL(url); }
    }
    return results;
  } finally { for (const bitmap of bitmaps.values()) bitmap.close(); }
}
