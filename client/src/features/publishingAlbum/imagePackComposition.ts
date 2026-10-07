import { PUBLISHING_ALBUM_MAX_PAGES, type PublishingAlbumRegionLayout } from "@shared/publishingAlbum";
import { imagePackParagraphs, normalizeImagePackBody, resolveIllustrationOffset, type ParagraphAnchor } from "./imagePackIllustrations";
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
  illustrations?: { imageUrl: string; after: ParagraphAnchor | null }[];
  bodyTextureUrl?: string;
};
export type ImagePackBlock = ({ kind: "text"; text: string } | { kind: "illustration"; imageUrl: string }) & { top: number; height: number };
export type ImagePackPage = { kind: "cover" | "body"; text: string; illustration: boolean; blocks: ImagePackBlock[] };
export type ImagePackResult = { label: string; filename: string; blob: Blob };
const repository = new PublishingAlbumFontRepository();

const BODY_TOP = 96;
const LINE_HEIGHT = 66;
const PAGE_LINES = 14;
const IMAGE_LINES = 7;

// Flow text and images in article order. Image blocks never split across pages.
export function planImagePack(options: ImagePackOptions): ImagePackPage[] {
  const body = normalizeImagePackBody(options.body);
  if (!body) throw new Error("请先写好正文");
  if (options.includeCover && !options.coverUrl) throw new Error("先从上方选择一张封面图片");
  if (options.includeCover && !options.title.trim()) throw new Error("请填写封面标题");
  const paragraphs = imagePackParagraphs(body);
  const images = (options.illustrations ?? []).map(image => {
    const offset = resolveIllustrationOffset(paragraphs, image.after);
    if (offset === null) throw new Error("插图对应的段落已变化，请重新选择插入位置");
    if (!image.imageUrl) throw new Error("所选插图已不可用，请重新选择");
    return { ...image, offset };
  }).sort((a, b) => a.offset - b.offset);
  const pages: ImagePackPage[] = [];
  if (options.includeCover) pages.push({ kind: "cover", text: options.title.trim(), illustration: false, blocks: [] });
  let page: ImagePackPage | undefined;
  let used = 0;
  function ensureSpace(lines: number) {
    if (!page || used + lines > PAGE_LINES) {
      if (pages.length >= PUBLISHING_ALBUM_MAX_PAGES) throw new Error("整套图片最多 9 张，请精简正文或减少插图后重试；正文不会被截断");
      page = { kind: "body", text: "", illustration: false, blocks: [] };
      pages.push(page);
      used = 0;
    }
    return page;
  }
  function appendLine(text: string) {
    const current = ensureSpace(1);
    const last = current.blocks.at(-1);
    if (last?.kind === "text") { last.text += text; last.height += LINE_HEIGHT; }
    else current.blocks.push({ kind: "text", text, top: BODY_TOP + used * LINE_HEIGHT, height: LINE_HEIGHT });
    current.text += text;
    used++;
  }
  function appendText(text: string) {
    let chunk: string[] = []; let column = 0;
    for (const glyph of publishingAlbumGraphemes(text)) {
      if (column === 18 && glyph !== "\n") { appendLine(chunk.join("")); chunk = []; column = 0; }
      chunk.push(glyph);
      if (glyph === "\n") { appendLine(chunk.join("")); chunk = []; column = 0; }
      else column++;
    }
    if (chunk.length) appendLine(chunk.join(""));
  }
  let offset = 0;
  for (const image of images) {
    appendText(body.slice(offset, image.offset));
    const current = ensureSpace(IMAGE_LINES);
    current.blocks.push({ kind: "illustration", imageUrl: image.imageUrl, top: BODY_TOP + used * LINE_HEIGHT, height: IMAGE_LINES * LINE_HEIGHT });
    current.illustration = true;
    used += IMAGE_LINES;
    offset = image.offset;
  }
  appendText(body.slice(offset));
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
      // Text pages get their final 2x render below. Image-only pages are already final.
      const scale = page.text.replace(/\n/g, "") ? 1 : 2;
      const canvas = Object.assign(document.createElement("canvas"), { width: 900 * scale, height: 1200 * scale });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法制作图片");
      context.scale(scale, scale);
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
      for (const block of page.blocks) {
        if (block.kind === "illustration") await drawImage(context, block.imageUrl, [80, block.top + (block.height - 740 * 9 / 16) / 2, 740, 740 * 9 / 16]);
      }
      assertCurrent();
      const background = await toBlob(canvas);
      const url = URL.createObjectURL(background);
      try {
        const textBlocks = page.kind === "cover"
          ? [{ text: page.text, top: 840, height: 228 }]
          : page.blocks.filter(block => block.kind === "text");
        const preparedBlocks = [];
        let textOffset = 0;
        for (const block of textBlocks) {
          // A trailing newline belongs to the text flow, not an extra line in this region.
          const visibleText = block.text.replace(/\n$/, "");
          if (visibleText) {
            const typography: PublishingAlbumRegionLayout = {
              layoutVersion: 1, kind: "region", shape: "rectangle", direction: "horizontal",
              fontId: options.fontId, alignment: page.kind === "cover" ? "center" : "start",
              fontSize: page.kind === "cover" ? 60 : 36, letterSpacing: 1, lineSpacing: 1.6,
              region: { x: page.kind === "cover" ? .07 : .05, y: block.top / 1200, width: page.kind === "cover" ? .86 : .9, height: block.height / 1200 },
              contrast: { textColor: style.ink, outlineColor: null, outlineWidth: 0, backdropColor: null },
            };
            const prepared = await preparePublishingAlbumExportPage({
              pageId: `image-pack-${index}`, ordinal: index + 1, text: visibleText,
              backgroundUrl: url, typography, repository,
            });
            prepared.plan.graphemes = prepared.plan.graphemes.map(glyph => ({ ...glyph, index: glyph.index + textOffset }));
            preparedBlocks.push(prepared);
            assertCurrent();
          }
          textOffset += publishingAlbumGraphemes(block.text).length;
        }
        const first = preparedBlocks[0];
        // One PNG render per page, regardless of the number of text/image blocks.
        const blob = first ? await renderPublishingAlbumPagePng({
          page: { ...first, plan: { ...first.plan, text: page.text, graphemes: preparedBlocks.flatMap(block => block.plan.graphemes) } }, repository,
        }) : background;
        assertCurrent();
        const label = page.kind === "cover" ? "封面" : page.illustration ? "正文 · 插图" : "正文";
        results.push({ label, filename: `图文-${String(index + 1).padStart(2, "0")}.png`, blob });
        onProgress(index + 1, pages.length);
      } finally { URL.revokeObjectURL(url); }
    }
    return results;
  } finally { for (const bitmap of bitmaps.values()) bitmap.close(); }
}
