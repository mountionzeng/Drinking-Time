import { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";
import type { PublishingAlbumTypographyLayout } from "../../../../shared/publishingAlbum";
import { publishingAlbumFontById } from "../../../../shared/publishingAlbumFonts";
import { buildPublishingAlbumLayout, type PublishingAlbumLayoutPlan } from "./publishingAlbumLayout";
import type { PublishingAlbumCanonicalGeometry } from "./publishingAlbumGeometry";

export type PublishingAlbumExportPage = {
  pageId: string;
  ordinal: number;
  backgroundUrl: string;
  plan: PublishingAlbumLayoutPlan;
};

export async function preparePublishingAlbumExportPage(input: {
  pageId: string;
  ordinal: number;
  text: string;
  backgroundUrl: string;
  typography: PublishingAlbumTypographyLayout;
  repository?: PublishingAlbumFontRepository;
}): Promise<PublishingAlbumExportPage> {
  const repository = input.repository ?? new PublishingAlbumFontRepository();
  await repository.load(input.typography.fontId);
  const missing = await repository.missingCharacters(input.typography.fontId, input.text);
  if (missing.length > 0) throw new Error(`所选字体缺少字形：${missing.slice(0, 8).join("")}`);
  const geometry: PublishingAlbumCanonicalGeometry = input.typography.kind === "path"
    ? { kind: "path", points: input.typography.points }
    : {
        kind: "region", shape: input.typography.shape, direction: input.typography.direction,
        region: input.typography.region, points: [],
      };
  const family = publishingAlbumFontById(input.typography.fontId)?.family ?? "sans-serif";
  const context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const result = buildPublishingAlbumLayout({
    text: input.text,
    fontId: input.typography.fontId,
    geometry,
    canvas: { width: 900, height: 1200 },
    alignment: input.typography.alignment,
    metrics: {
      isLoaded: () => true,
      supportsText: () => true,
      measure: (grapheme, _fontId, fontSize) => {
        if (!context) return fontSize;
        context.font = `${fontSize}px "${family}"`;
        return context.measureText(grapheme).width || fontSize;
      },
    },
  });
  if (result.status !== "ok") throw new Error(result.suggestion);
  return { pageId: input.pageId, ordinal: input.ordinal, backgroundUrl: input.backgroundUrl, plan: result.plan };
}

type CanvasLike = HTMLCanvasElement;

const ILLEGAL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

function assertSafeExportText(text: string): void {
  if (ILLEGAL_TEXT.test(text)) throw new Error("文字包含不可安全导出的控制字符，请先删除后重试");
}

function canvasToBlob(canvas: CanvasLike): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error("浏览器没有生成画册 PNG"));
  }, "image/png"));
}

export async function renderPublishingAlbumPagePng(input: {
  page: PublishingAlbumExportPage;
  width?: number;
  height?: number;
  repository?: PublishingAlbumFontRepository;
  dependencies?: {
    fetcher?: typeof fetch;
    createCanvas?: (width: number, height: number) => CanvasLike;
    createBitmap?: (blob: Blob) => Promise<ImageBitmap>;
    fontsReady?: Promise<unknown>;
  };
}): Promise<Blob> {
  assertSafeExportText(input.page.plan.text);
  const repository = input.repository ?? new PublishingAlbumFontRepository();
  await repository.load(input.page.plan.fontId);
  const missing = await repository.missingCharacters(input.page.plan.fontId, input.page.plan.text);
  if (missing.length > 0) throw new Error(`所选字体缺少字形：${missing.slice(0, 8).join("")}`);
  await (input.dependencies?.fontsReady ?? document.fonts.ready);

  const fetcher = input.dependencies?.fetcher ?? globalThis.fetch;
  const response = await fetcher(input.page.backgroundUrl, { credentials: "include" });
  if (!response.ok) throw new Error(`画册底图读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("画册底图不是可用图片");
  const createBitmap = input.dependencies?.createBitmap ?? globalThis.createImageBitmap;
  const bitmap = await createBitmap(blob);
  const width = input.width ?? 1800;
  const height = input.height ?? 2400;
  const canvas = input.dependencies?.createCanvas?.(width, height) ?? Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法合成画册页面");

  const sourceRatio = bitmap.width / bitmap.height;
  const targetRatio = width / height;
  let sourceX = 0; let sourceY = 0; let sourceWidth = bitmap.width; let sourceHeight = bitmap.height;
  if (sourceRatio > targetRatio) {
    sourceWidth = bitmap.height * targetRatio;
    sourceX = (bitmap.width - sourceWidth) / 2;
  } else {
    sourceHeight = bitmap.width / targetRatio;
    sourceY = (bitmap.height - sourceHeight) / 2;
  }
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  const scaleX = width / 900;
  const scaleY = height / 1200;
  const scale = Math.min(scaleX, scaleY);
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.font = `${input.page.plan.fontSize * scale}px "${input.page.plan.fontFamily}"`;
  for (const glyph of input.page.plan.graphemes) {
    if (glyph.grapheme === "\n") continue;
    context.save();
    context.translate(glyph.x * scaleX, glyph.y * scaleY);
    context.rotate(glyph.rotation * Math.PI / 180);
    if (input.page.plan.contrast.backdropColor) {
      const measured = context.measureText(glyph.grapheme).width;
      context.fillStyle = input.page.plan.contrast.backdropColor;
      context.fillRect(-measured / 2 - 4 * scale, -input.page.plan.fontSize * scale, measured + 8 * scale, input.page.plan.fontSize * 1.25 * scale);
    }
    if (input.page.plan.contrast.outlineColor && input.page.plan.contrast.outlineWidth > 0) {
      context.strokeStyle = input.page.plan.contrast.outlineColor;
      context.lineWidth = input.page.plan.contrast.outlineWidth * scale;
      context.strokeText(glyph.grapheme, 0, 0);
    }
    context.fillStyle = input.page.plan.contrast.textColor;
    context.fillText(glyph.grapheme, 0, 0);
    context.restore();
  }
  bitmap.close?.();
  return canvasToBlob(canvas);
}

export function downloadPublishingAlbumBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPublishingAlbum(input: {
  pages: PublishingAlbumExportPage[];
  filenamePrefix: string;
  repository?: PublishingAlbumFontRepository;
  onProgress?: (completed: number, total: number) => void;
  render?: typeof renderPublishingAlbumPagePng;
}): Promise<Array<{ pageId: string; filename: string; blob: Blob }>> {
  if (input.pages.length === 0) throw new Error("没有可导出的画册页面");
  const render = input.render ?? renderPublishingAlbumPagePng;
  const results: Array<{ pageId: string; filename: string; blob: Blob }> = [];
  for (let index = 0; index < input.pages.length; index += 1) {
    const page = input.pages[index]!;
    const blob = await render({ page, repository: input.repository });
    const filename = `${input.filenamePrefix}-${String(page.ordinal).padStart(2, "0")}.png`;
    results.push({ pageId: page.pageId, filename, blob });
    input.onProgress?.(index + 1, input.pages.length);
  }
  return results;
}
