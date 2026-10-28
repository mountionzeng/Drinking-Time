import { planImagePack, type ImagePackOptions } from "./imagePackComposition";
import {
  imagePackParagraphs,
  resolveIllustrationOffset,
} from "./imagePackIllustrations";
import { publishingAlbumGraphemes } from "./publishingAlbumLayout";

// The server validates shared layouts with the same schema, so it lives in shared/.
import {
  moduleDocumentSchema,
  type ImagePackModule,
  type ModuleDocument,
  type ModuleRect,
} from "@shared/sharedLayout";
export { moduleDocumentSchema };
export type { ImagePackModule, ModuleDocument, ModuleRect };

export const MODULE_PAGE = { width: 900, height: 1200 };
export type TextModule = Extract<ImagePackModule, { kind: "text" }>;
export type ImageModule = Extract<ImagePackModule, { kind: "image" }>;

/** Keep text readable over pictures, with the same stacking in canvas and hit targets. */
export function modulePaintOrder(
  modules: ImagePackModule[]
): ImagePackModule[] {
  return [
    ...modules.filter(module => module.kind === "image"),
    ...modules.filter(module => module.kind === "text"),
  ];
}
export type ModuleHandle =
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "left"
  | "right"
  | "top"
  | "bottom";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Keep the opposite corner fixed. Corners scale content; image edges crop pixels. */
export function transformModule(
  module: ImagePackModule,
  handle: ModuleHandle,
  dx: number,
  dy: number
): ImagePackModule {
  const r = module.rect;
  if (handle === "move")
    return {
      ...module,
      positioned: true,
      rect: {
        ...r,
        x: clamp(r.x + dx, 0, 900 - r.width),
        y: clamp(r.y + dy, 0, 1200 - r.height),
      },
    };
  if (["nw", "ne", "sw", "se"].includes(handle)) {
    const left = handle.includes("w"),
      top = handle.includes("n");
    const anchorX = left ? r.x + r.width : r.x;
    const anchorY = top ? r.y + r.height : r.y;
    const changeX = left ? -dx : dx,
      changeY = top ? -dy : dy;
    const requested =
      1 +
      (changeX * r.width + changeY * r.height) / (r.width ** 2 + r.height ** 2);
    const maximum = Math.min(
      (left ? anchorX : 900 - anchorX) / r.width,
      (top ? anchorY : 1200 - anchorY) / r.height
    );
    const scale = clamp(
      requested,
      Math.min(maximum, 24 / Math.min(r.width, r.height)),
      maximum
    );
    const width = r.width * scale,
      height = r.height * scale;
    return {
      ...module,
      positioned: true,
      rect: {
        x: left ? anchorX - width : anchorX,
        y: top ? anchorY - height : anchorY,
        width,
        height,
      },
    };
  }
  if (module.kind !== "image") return module;
  const c = module.crop;
  const full = {
    x: r.x - (c.x * r.width) / c.width,
    y: r.y - (c.y * r.height) / c.height,
    width: r.width / c.width,
    height: r.height / c.height,
  };
  let x = r.x,
    y = r.y,
    right = r.x + r.width,
    bottom = r.y + r.height;
  const minWidth = Math.min(24, r.width),
    minHeight = Math.min(24, r.height);
  if (handle === "left")
    x = clamp(x + dx, Math.max(0, full.x), right - minWidth);
  if (handle === "right")
    right = clamp(right + dx, x + minWidth, Math.min(900, full.x + full.width));
  if (handle === "top")
    y = clamp(y + dy, Math.max(0, full.y), bottom - minHeight);
  if (handle === "bottom")
    bottom = clamp(
      bottom + dy,
      y + minHeight,
      Math.min(1200, full.y + full.height)
    );
  return {
    ...module,
    positioned: true,
    rect: { x, y, width: right - x, height: bottom - y },
    crop: {
      x: (x - full.x) / full.width,
      y: (y - full.y) / full.height,
      width: (right - x) / full.width,
      height: (bottom - y) / full.height,
    },
  };
}

export function textModuleHeight(
  text: string,
  width: number,
  fontSize: number,
  measure: (glyph: string, size: number) => number
): number {
  let lines = 1,
    used = 0;
  for (const glyph of publishingAlbumGraphemes(text)) {
    if (glyph === "\n") {
      lines++;
      used = 0;
      continue;
    }
    const advance = measure(glyph, fontSize) + (used > 0 ? 1 : 0);
    if (used + advance > width * 0.89 && used > 0) {
      lines++;
      used = measure(glyph, fontSize);
    } else used += advance;
  }
  return Math.ceil((lines * fontSize * 1.6) / 0.89 + 2);
}

export function editModuleText(
  module: TextModule,
  text: string,
  measure: (glyph: string, size: number) => number
): TextModule {
  const contentHeight = textModuleHeight(
    text,
    module.contentWidth,
    module.fontSize,
    measure
  );
  const scale = module.rect.width / module.contentWidth;
  if (contentHeight * scale > 1200)
    throw new Error("这段文字超过一页，请分成几段，或先缩小这个模块。");
  const height = contentHeight * scale,
    width = module.contentWidth * scale;
  return {
    ...module,
    text,
    contentHeight,
    rect: {
      x: Math.min(module.rect.x, 900 - width),
      y: Math.min(module.rect.y, 1200 - height),
      width,
      height,
    },
  };
}

export function createModuleDocument(
  options: ImagePackOptions,
  dimensions: (url: string) => { width: number; height: number },
  measure: (glyph: string, size: number) => number
): ModuleDocument {
  // Reuse the existing guards: no missing assets/anchors, truncation or >9-page source.
  planImagePack(options);
  const document: ModuleDocument = { version: 1, flowVersion: 1, pages: [] };
  const image = (
    id: string,
    imageUrl: string,
    box: ModuleRect
  ): ImageModule => {
    const size = dimensions(imageUrl);
    const scale = Math.min(box.width / size.width, box.height / size.height);
    const width = size.width * scale,
      height = size.height * scale;
    return {
      id,
      kind: "image",
      imageUrl,
      rect: {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
      },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    };
  };
  if (options.includeCover)
    document.pages.push({
      label: "封面",
      modules: [
        image("cover-image", options.coverUrl!, {
          x: 65,
          y: 110,
          width: 770,
          height: 710,
        }),
        {
          id: "cover-title",
          kind: "text",
          text: options.title.trim(),
          fontSize: 60,
          contentWidth: 774,
          contentHeight: 228,
          alignment: "center",
          rect: { x: 63, y: 840, width: 774, height: 228 },
        },
      ],
    });
  const paragraphs = imagePackParagraphs(options.body);
  const paragraphTexts = options.body
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .filter(text => text.trim());
  const illustrations = (options.illustrations ?? []).map((item, index) => ({
    ...item,
    index,
    offset: resolveIllustrationOffset(paragraphs, item.after),
  }));
  let current: ModuleDocument["pages"][number] | undefined,
    y = 96;
  function append(module: ImagePackModule, space: number) {
    if (!current || y + space > 1120) {
      if (document.pages.length >= 9)
        throw new Error(
          "按完整段落排版超过 9 页，请精简文字或插图；原成品仍保留。"
        );
      current = { label: "正文", modules: [] };
      document.pages.push(current);
      y = 96;
    }
    current.modules.push({
      ...module,
      rect: { ...module.rect, y: y + (space - module.rect.height) / 2 },
    });
    if (module.kind === "image") current.label = "正文 · 插图";
    y += space;
  }
  function appendImages(offset: number) {
    for (const item of illustrations.filter(item => item.offset === offset)) {
      append(
        image(`image-${item.index}`, item.imageUrl, {
          x: 80,
          y: 0,
          width: 740,
          height: 416.25,
        }),
        462
      );
    }
  }
  appendImages(0);
  paragraphs.forEach((paragraph, index) => {
    const text = paragraphTexts[index];
    const contentHeight = textModuleHeight(text, 810, 36, measure);
    const scale = Math.min(1, 1024 / contentHeight);
    const height = contentHeight * scale,
      width = 810 * scale;
    append(
      {
        id: `paragraph-${index}`,
        kind: "text",
        text,
        fontSize: 36,
        contentWidth: 810,
        contentHeight,
        alignment: "start",
        rect: { x: (900 - width) / 2, y: 0, width, height },
      },
      height
    );
    appendImages(paragraph.end);
  });
  return document;
}

export function replaceModule(
  document: ModuleDocument,
  page: number,
  module: ImagePackModule
): ModuleDocument {
  return {
    ...document,
    pages: document.pages.map((item, index) =>
      index === page
        ? {
            ...item,
            modules: item.modules.map(value =>
              value.id === module.id ? module : value
            ),
          }
        : item
    ),
  };
}

/** Move one whole module without reflowing either page; the final index adds a page. */
export function moveModuleToPage(
  document: ModuleDocument,
  fromPage: number,
  moduleId: string,
  toPage: number
): ModuleDocument {
  const source = document.pages[fromPage];
  const module = source?.modules.find(item => item.id === moduleId);
  if (!module) throw new Error("找不到要移动的模块，请重新选择。");
  if (!Number.isInteger(toPage) || toPage < 0 || toPage > document.pages.length)
    throw new Error("目标页面已不存在，请重新选择。");
  if (fromPage === toPage) return document;
  const target = document.pages[toPage];
  if (!target && document.pages.length >= 9)
    throw new Error("整套最多 9 页，请选择已有页面。");
  if (target?.modules.some(item => item.id === moduleId))
    throw new Error("目标页已有同名模块，无法移动。");
  if (target && target.modules.length >= 300)
    throw new Error("目标页的模块数量已达上限，请选择其他页。");
  const moved = { ...module, positioned: true };
  const pages = document.pages.map((page, index) => {
    if (index === fromPage)
      return {
        ...page,
        modules: page.modules.filter(item => item.id !== moduleId),
      };
    if (index === toPage) return { ...page, modules: [...page.modules, moved] };
    return page;
  });
  if (!target) pages.push({ label: "正文", modules: [moved] });
  return { ...document, pages };
}

export function insertModulePage(
  document: ModuleDocument,
  index: number
): ModuleDocument {
  if (!Number.isInteger(index) || index < 0 || index > document.pages.length)
    throw new Error("目标页面已不存在，请重新选择。");
  if (document.pages.length >= 9)
    throw new Error("整套最多 9 页，请先删除不需要的页面。");
  return {
    ...document,
    pages: [
      ...document.pages.slice(0, index),
      { label: "正文", modules: [] },
      ...document.pages.slice(index),
    ],
  };
}

export function deleteModulePage(
  document: ModuleDocument,
  index: number
): ModuleDocument {
  if (!Number.isInteger(index) || !document.pages[index])
    throw new Error("目标页面已不存在，请重新选择。");
  if (document.pages.length <= 1)
    throw new Error("至少保留一页，可以先插入空白页再删除。");
  return { ...document, pages: document.pages.filter((_, i) => i !== index) };
}

// Derived free-paper colors may improve without losing a saved layout. All actual
// source/settings (including selected image URLs) still require an exact match.
export function moduleStorageKey(scope: string, basis: string) {
  try {
    const options = JSON.parse(basis);
    if (options && Object.hasOwn(options, "paperPalette")) {
      delete options.paperPalette;
      basis = JSON.stringify(options);
    }
  } catch {
    // Preserve opaque legacy identities.
  }
  return `publishing-image-modules:v1:${scope}:${basis}`;
}
/** Chapter rendering adds overflow fitting; legacy platform caches did not. */
export function legacyModuleStorageKey(scope: string, basis: string) {
  const options = JSON.parse(basis);
  delete options.fitOverflowText;
  return moduleStorageKey(scope, JSON.stringify(options));
}
export function readModuleDocument(
  value: string | null,
  options: ImagePackOptions,
  availableUrls: string[] = []
): ModuleDocument | null {
  try {
    const result = moduleDocumentSchema.safeParse(JSON.parse(value ?? "null"));
    if (!result.success) return null;
    const urls = new Set([
      ...availableUrls,
      options.coverUrl,
      ...(options.illustrations ?? []).map(image => image.imageUrl),
    ]);
    for (const page of result.data.pages) {
      const ids = new Set<string>();
      for (const module of page.modules) {
        const r = module.rect;
        if (
          ids.has(module.id) ||
          r.x < 0 ||
          r.y < 0 ||
          r.x + r.width > 900.01 ||
          r.y + r.height > 1200.01
        )
          return null;
        ids.add(module.id);
        if (module.kind === "image") {
          const c = module.crop;
          if (
            !urls.has(module.imageUrl) ||
            c.x < 0 ||
            c.y < 0 ||
            c.x + c.width > 1.00001 ||
            c.y + c.height > 1.00001
          )
            return null;
        }
      }
    }
    // Older drafts have no record of manual positioning; preserve every saved rectangle.
    if (!result.data.flowVersion)
      return {
        ...result.data,
        flowVersion: 1,
        pages: result.data.pages.map(page => ({
          ...page,
          modules: page.modules.map(module => ({
            ...module,
            positioned: true,
          })),
        })),
      };
    return result.data;
  } catch {
    return null;
  }
}

export function newTextModule(
  id: string,
  text: string,
  measure: (glyph: string, size: number) => number
): TextModule {
  const contentHeight = textModuleHeight(text, 740, 36, measure);
  if (contentHeight > 1040) throw new Error("这段文字太长，请分成几段添加。");
  return {
    id,
    kind: "text",
    text,
    fontSize: 36,
    contentWidth: 740,
    contentHeight,
    alignment: "start",
    rect: { x: 80, y: 80, width: 740, height: contentHeight },
  };
}

export function newImageModule(
  id: string,
  imageUrl: string,
  size: { width: number; height: number }
): ImageModule {
  const scale = Math.min(640 / size.width, 440 / size.height);
  const width = size.width * scale,
    height = size.height * scale;
  return {
    id,
    kind: "image",
    imageUrl,
    rect: { x: (900 - width) / 2, y: 80, width, height },
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
}

export function modulesOverlap(a: ModuleRect, b: ModuleRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Reflow the current page only. Manually placed modules stay fixed; overflow becomes new pages. */
export function flowModulePage(
  document: ModuleDocument,
  pageIndex: number,
  modules: ImagePackModule[]
): ModuleDocument {
  const fixed = modules.filter(module => module.positioned);
  const pages: ModuleDocument["pages"] = [
    { ...document.pages[pageIndex], modules: [] },
  ];
  let current = pages[0],
    y = 80;
  for (const module of modules) {
    if (module.positioned) {
      pages[0].modules.push(module);
      continue;
    }
    if (module.rect.height > 1040)
      throw new Error("这段内容超过一页，请拆成几段或手动调整大小。");
    let rect = { ...module.rect, y };
    if (current === pages[0]) {
      for (const obstacle of [...fixed].sort((a, b) => a.rect.y - b.rect.y)) {
        if (modulesOverlap(rect, obstacle.rect))
          rect.y = obstacle.rect.y + obstacle.rect.height + 20;
      }
    }
    if (rect.y + rect.height > 1120) {
      if (document.pages.length + pages.length >= 10)
        throw new Error("整套最多 9 页，请删减内容后再添加。");
      current = { label: "正文", modules: [] };
      pages.push(current);
      rect.y = 80;
    }
    current.modules.push({ ...module, rect });
    y = rect.y + rect.height + 20;
  }
  return {
    ...document,
    pages: [
      ...document.pages.slice(0, pageIndex),
      ...pages,
      ...document.pages.slice(pageIndex + 1),
    ],
  };
}

export function insertModule(
  document: ModuleDocument,
  pageIndex: number,
  module: ImagePackModule,
  afterId: string | null
): ModuleDocument {
  const modules = [...document.pages[pageIndex].modules];
  const index = afterId
    ? modules.findIndex(item => item.id === afterId)
    : modules.length - 1;
  modules.splice(index + 1, 0, module);
  return flowModulePage(document, pageIndex, modules);
}
