import { readImagePackBlob } from "./imagePackImageBlob";
import { publishingAlbumFontById } from "@shared/publishingAlbumFonts";
import {
  IMAGE_PACK_STYLES,
  type ImagePackOptions,
  type ImagePackResult,
} from "./imagePackComposition";
import { drawPaperMaterial } from "./imagePackMaterial";
import { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";
import {
  buildPublishingAlbumLayout,
  type PublishingAlbumLayoutPlan,
} from "./publishingAlbumLayout";
import {
  createModuleDocument,
  modulePaintOrder,
  type ModuleDocument,
  type ModuleRect,
  type TextModule,
} from "./imagePackModules";

const repository = new PublishingAlbumFontRepository();

/** One canvas renderer for the live canvas, thumbnails and downloadable PNGs. */
export async function createModuleRenderer(
  options: ImagePackOptions,
  signal: AbortSignal
) {
  const bitmaps = new Map<string, ImageBitmap>();
  const plans = new Map<
    string,
    PublishingAlbumLayoutPlan & { backdropRect: ModuleRect }
  >();
  const style =
    (!options.bodyTextureUrl && options.paperPalette) ||
    options.palette ||
    IMAGE_PACK_STYLES[options.style];
  const family =
    publishingAlbumFontById(options.fontId)?.family ?? "sans-serif";
  const measuring = document.createElement("canvas").getContext("2d");
  if (!measuring) throw new Error("当前浏览器无法编辑图片");
  const measure = (glyph: string, size: number) => {
    measuring.font = `${size}px "${family}"`;
    return measuring.measureText(glyph).width || size;
  };
  const dispose = () => {
    for (const bitmap of bitmaps.values()) bitmap.close();
    bitmaps.clear();
    plans.clear();
  };
  async function loadImage(url: string) {
    signal.throwIfAborted();
    const existing = bitmaps.get(url);
    if (existing) return { width: existing.width, height: existing.height };
    const bitmap = await createImageBitmap(await readImagePackBlob(url, signal));
    if (signal.aborted) {
      bitmap.close();
      signal.throwIfAborted();
    }
    // A concurrent validation may already have loaded this image.
    if (bitmaps.has(url)) bitmap.close();
    else bitmaps.set(url, bitmap);
    const stored = bitmaps.get(url)!;
    return { width: stored.width, height: stored.height };
  }
  try {
    signal.throwIfAborted();
    await repository.load(options.fontId);
    const urls = new Set([
      options.includeCover ? options.coverUrl : undefined,
      options.bodyTextureUrl,
      ...(options.illustrations ?? []).map(image => image.imageUrl),
    ]);
    for (const url of urls) {
      if (!url) continue;
      await loadImage(url);
    }
    signal.throwIfAborted();
  } catch (cause) {
    dispose();
    throw cause;
  }

  const background = Object.assign(document.createElement("canvas"), {
    width: 1800,
    height: 2400,
  });
  const backgroundContext = background.getContext("2d");
  if (!backgroundContext) {
    dispose();
    throw new Error("无法创建画布");
  }
  backgroundContext.scale(2, 2);
  if (options.bodyTextureUrl) {
    const bitmap = bitmaps.get(options.bodyTextureUrl)!;
    backgroundContext.fillStyle = style.paper;
    backgroundContext.fillRect(0, 0, 900, 1200);
    const scale = Math.min(900 / bitmap.width, 1200 / bitmap.height);
    backgroundContext.drawImage(
      bitmap,
      (900 - bitmap.width * scale) / 2,
      (1200 - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale
    );
  } else
    drawPaperMaterial(
      backgroundContext,
      900,
      1200,
      style,
      options.texture ?? "paper",
      options.textureSeed ?? 0
    );

  function textPlan(module: TextModule) {
    const key = JSON.stringify([
      module.text,
      module.contentWidth,
      module.contentHeight,
      module.fontSize,
      module.alignment,
    ]);
    const cached = plans.get(key);
    if (cached) return cached;
    const result = buildPublishingAlbumLayout({
      text: module.text,
      fontId: options.fontId,
      canvas: { width: module.contentWidth, height: module.contentHeight },
      geometry: {
        kind: "region",
        shape: "rectangle",
        direction: "horizontal",
        region: { x: 0, y: 0, width: 1, height: 1 },
        points: [],
      },
      fontSize: module.fontSize,
      alignment: module.alignment,
      letterSpacing: 1,
      lineSpacing: 1.6,
      contrast: {
        textColor: style.ink,
        outlineColor: null,
        outlineWidth: 0,
        backdropColor: null,
      },
      metrics: {
        isLoaded: () => true,
        supportsText: () => true,
        measure: (glyph, _font, size) => measure(glyph, size),
      },
    });
    if (result.status !== "ok") throw new Error(result.suggestion);
    const plan = result.plan;
    const paddingX = plan.fontSize * 0.45,
      paddingY = plan.fontSize * 0.3;
    let left = module.contentWidth,
      top = module.contentHeight,
      right = 0,
      bottom = 0;
    for (const glyph of plan.graphemes) {
      const half = measure(glyph.grapheme, plan.fontSize) / 2;
      left = Math.min(left, glyph.x - half - paddingX);
      right = Math.max(right, glyph.x + half + paddingX);
      top = Math.min(top, glyph.y - plan.fontSize - paddingY);
      bottom = Math.max(bottom, glyph.y + plan.fontSize * 0.25 + paddingY);
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    const prepared = {
      ...plan,
      backdropRect: {
        x: left,
        y: top,
        width: Math.min(module.contentWidth, right) - left,
        height: Math.min(module.contentHeight, bottom) - top,
      },
    };
    if (plans.size > 300) plans.clear();
    plans.set(key, prepared);
    return prepared;
  }
  function draw(
    page: ModuleDocument["pages"][number],
    canvas: HTMLCanvasElement
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法绘制图片");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(background, 0, 0, canvas.width, canvas.height);
    context.save();
    try {
      context.scale(canvas.width / 900, canvas.height / 1200);
      for (const module of modulePaintOrder(page.modules)) {
        const r = module.rect;
        if (module.kind === "image") {
          const bitmap = bitmaps.get(module.imageUrl);
          if (!bitmap) throw new Error("图片已不可用，请重新选图");
          const c = module.crop;
          context.drawImage(
            bitmap,
            c.x * bitmap.width,
            c.y * bitmap.height,
            c.width * bitmap.width,
            c.height * bitmap.height,
            r.x,
            r.y,
            r.width,
            r.height
          );
        } else if (module.text) {
          const plan = textPlan(module);
          context.save();
          context.translate(r.x, r.y);
          context.scale(
            r.width / module.contentWidth,
            r.height / module.contentHeight
          );
          const bright = module.emphasis === "bright";
          if (module.backdrop) {
            context.globalAlpha = bright ? 0.72 : 0.8;
            context.fillStyle = bright ? style.ink : style.paper;
            const backdrop = plan.backdropRect;
            context.fillRect(
              backdrop.x,
              backdrop.y,
              backdrop.width,
              backdrop.height
            );
            context.globalAlpha = 1;
          }
          context.font = `${plan.fontSize}px "${family}"`;
          context.fillStyle = bright ? "#fffaf0" : style.ink;
          context.textAlign = "center";
          context.textBaseline = "alphabetic";
          context.lineJoin = "round";
          for (const glyph of plan.graphemes) {
            if (bright) {
              // Synthetic weight preserves saved line wrapping for variable and single-weight fonts.
              if (!module.backdrop) {
                context.strokeStyle = style.ink;
                context.lineWidth = plan.fontSize * 0.08;
                context.strokeText(glyph.grapheme, glyph.x, glyph.y);
              }
              context.strokeStyle = "#fffaf0";
              context.lineWidth = plan.fontSize * 0.035;
              context.strokeText(glyph.grapheme, glyph.x, glyph.y);
            }
            context.fillText(glyph.grapheme, glyph.x, glyph.y);
          }
          context.restore();
        }
      }
    } finally {
      context.restore();
    }
  }
  async function validate(document: ModuleDocument) {
    for (const page of document.pages)
      for (const module of page.modules)
        if (module.kind === "image") await loadImage(module.imageUrl);
    const text = document.pages
      .flatMap(page =>
        page.modules.flatMap(module =>
          module.kind === "text" ? [module.text] : []
        )
      )
      .join("\n");
    if (
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
        text
      )
    )
      throw new Error("文字包含不可导出的控制字符");
    const missing = await repository.missingCharacters(options.fontId, text);
    if (missing.length)
      throw new Error(`所选字体缺少字形：${missing.slice(0, 8).join("")}`);
    for (const page of document.pages)
      for (const module of page.modules)
        if (module.kind === "text" && module.text) textPlan(module);
  }
  return {
    draw,
    validate,
    measure,
    dispose,
    loadImage,
    createDocument: () =>
      createModuleDocument(
        options,
        url => {
          const bitmap = bitmaps.get(url);
          if (!bitmap) throw new Error("图片已不可用");
          return bitmap;
        },
        measure
      ),
  };
}
export type ModuleRenderer = Awaited<ReturnType<typeof createModuleRenderer>>;

export async function renderModulePack(
  renderer: ModuleRenderer,
  document: ModuleDocument,
  signal: AbortSignal
): Promise<ImagePackResult[]> {
  signal.throwIfAborted();
  await renderer.validate(document);
  const results: ImagePackResult[] = [];
  for (const [index, page] of document.pages.entries()) {
    signal.throwIfAborted();
    const canvas = Object.assign(globalThis.document.createElement("canvas"), {
      width: 1800,
      height: 2400,
    });
    renderer.draw(page, canvas);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        value => (value ? resolve(value) : reject(new Error("图片合成失败"))),
        "image/png"
      )
    );
    signal.throwIfAborted();
    results.push({
      label: page.label,
      filename: `图文-${String(index + 1).padStart(2, "0")}.png`,
      blob,
    });
  }
  return results;
}

export async function makeModulePack(
  options: ImagePackOptions,
  document: ModuleDocument,
  signal: AbortSignal
) {
  const renderer = await createModuleRenderer(options, signal);
  try {
    return await renderModulePack(renderer, document, signal);
  } finally {
    renderer.dispose();
  }
}
