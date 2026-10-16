import { describe, expect, it } from "vitest";
import {
  createModuleDocument,
  editModuleText,
  moduleStorageKey,
  readModuleDocument,
  replaceModule,
  moveModuleToPage,
  insertModulePage,
  deleteModulePage,
  transformModule,
  flowModulePage,
  insertModule,
  newTextModule,
  newImageModule,
  modulePaintOrder,
  type ImageModule,
  type ModuleHandle,
  type TextModule,
} from "./imagePackModules";
import { imagePackParagraphs } from "./imagePackIllustrations";

const options = {
  title: "标题",
  body: "第一段文字。\n第二段👩‍👧é文字。\n第二段👩‍👧é文字。",
  fontId: "noto-serif-sc",
  style: "sage" as const,
  includeCover: true,
  coverUrl: "/cover.png",
};
const measure = (_glyph: string, size: number) => size;
const dimensions = () => ({ width: 900, height: 1200 });
const image: ImageModule = {
  id: "image",
  kind: "image",
  imageUrl: "/cover.png",
  rect: { x: 100, y: 200, width: 400, height: 600 },
  crop: { x: 0, y: 0, width: 1, height: 1 },
};

describe("image pack modules", () => {
  it("never expands the crop beyond source pixels for a very narrow image", () => {
    const narrow = { ...image, rect: { ...image.rect, width: 10 } };
    for (const handle of ["left", "right"] as const) {
      const cropped = transformModule(narrow, handle, 100, 0) as ImageModule;
      expect(cropped.crop.x).toBeGreaterThanOrEqual(0);
      expect(cropped.crop.x + cropped.crop.width).toBeLessThanOrEqual(1);
    }
  });
  it("keeps each paragraph and repeated paragraph a separate complete editable module", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const texts = document.pages.flatMap(page =>
      page.modules.filter(module => module.kind === "text")
    );
    expect(texts.map(module => module.text)).toEqual([
      options.title,
      ...options.body.split("\n"),
    ]);
    expect(new Set(texts.map(module => module.id)).size).toBe(texts.length);
    expect(document.pages[0].modules[0].rect).toEqual({
      x: 183.75,
      y: 110,
      width: 532.5,
      height: 710,
    });
  });
  it("moves a paragraph as a whole to the next page and never silently splits or truncates it", () => {
    const body = ["甲".repeat(170), "乙".repeat(170), "丙".repeat(300)].join(
      "\n"
    );
    const document = createModuleDocument(
      { ...options, body },
      dimensions,
      measure
    );
    const texts = document.pages
      .slice(1)
      .flatMap(page => page.modules.filter(module => module.kind === "text"));
    expect(texts.map(module => module.text)).toEqual(body.split("\n"));
    expect(document.pages).toHaveLength(4);
    expect(
      texts.every(module => module.rect.y + module.rect.height <= 1200)
    ).toBe(true);
  });
  it("places selected images after their anchored paragraph in source order", () => {
    const document = createModuleDocument(
      {
        ...options,
        illustrations: [
          {
            imageUrl: "/illustration.png",
            after: imagePackParagraphs(options.body)[0].anchor,
          },
        ],
      },
      dimensions,
      measure
    );
    const modules = document.pages.slice(1).flatMap(page => page.modules);
    expect(modules.map(module => module.id)).toEqual([
      "paragraph-0",
      "image-0",
      "paragraph-1",
      "paragraph-2",
    ]);
  });
  it.each(["nw", "ne", "sw", "se"] as ModuleHandle[])(
    "scales %s proportionally about the opposite corner and stays inside the page",
    handle => {
      const result = transformModule(image, handle, 300, 200);
      expect(result.rect.width / result.rect.height).toBeCloseTo(2 / 3);
      expect(result.rect.x).toBeGreaterThanOrEqual(0);
      expect(result.rect.y).toBeGreaterThanOrEqual(0);
      expect(result.rect.x + result.rect.width).toBeLessThanOrEqual(900);
      expect(result.rect.y + result.rect.height).toBeLessThanOrEqual(1200);
      expect(
        handle.includes("w") ? result.rect.x + result.rect.width : result.rect.x
      ).toBe(handle.includes("w") ? 500 : 100);
      expect(
        handle.includes("n")
          ? result.rect.y + result.rect.height
          : result.rect.y
      ).toBe(handle.includes("n") ? 800 : 200);
    }
  );
  it("clamps center movement without changing content or crop", () => {
    expect(transformModule(image, "move", 10000, -10000)).toEqual({
      ...image,
      positioned: true,
      rect: { ...image.rect, x: 500, y: 0 },
    });
  });
  it("inserts content in reading order and spills to new pages without shrinking text", () => {
    const first = newTextModule("first", "甲".repeat(160), measure);
    const second = newTextModule("second", "乙".repeat(160), measure);
    const added = newImageModule("added", "/other.png", {
      width: 1600,
      height: 900,
    });
    const document = {
      version: 1 as const,
      flowVersion: 1 as const,
      pages: [{ label: "正文", modules: [first, second] }],
    };
    const next = insertModule(document, 0, added, "first");
    expect(next.pages.length).toBeGreaterThan(1);
    expect(
      next.pages.flatMap(page => page.modules.map(module => module.id))
    ).toEqual(["first", "added", "second"]);
    expect(
      next.pages
        .flatMap(page => page.modules)
        .find(module => module.id === "second")?.rect.width
    ).toBe(second.rect.width);
    expect(document.pages[0].modules).toHaveLength(2);
  });
  it("keeps manually positioned modules and protects existing later pages", () => {
    const fixed = { ...image, positioned: true };
    const added = newTextModule("new", "新增文字", measure);
    const later = {
      label: "后页",
      modules: [newTextModule("later", "后页", measure)],
    };
    const document = {
      version: 1 as const,
      pages: [{ label: "正文", modules: [fixed] }, later],
    };
    const next = flowModulePage(document, 0, [fixed, added]);
    expect(
      next.pages[0].modules.find(module => module.id === image.id)
    ).toEqual(fixed);
    expect(next.pages.at(-1)).toBe(later);
  });
  it("rejects overflowing a nine-page work atomically", () => {
    const page = {
      label: "正文",
      modules: [
        newImageModule("image", "/cover.png", { width: 600, height: 600 }),
      ],
    };
    const document = {
      version: 1 as const,
      pages: Array.from({ length: 9 }, () => page),
    };
    const tall = newTextModule("new", "字".repeat(230), measure);
    expect(() => insertModule(document, 0, tall, "image")).toThrow("最多 9 页");
    expect(document.pages).toHaveLength(9);
    expect(page.modules).toHaveLength(1);
  });
  it("restores added library images only when they belong to this work's available assets", () => {
    const document = createModuleDocument(options, dimensions, measure);
    document.pages[0].modules.push(
      newImageModule("added", "/available.png", dimensions())
    );
    expect(readModuleDocument(JSON.stringify(document), options)).toBeNull();
    expect(
      readModuleDocument(JSON.stringify(document), options, ["/available.png"])
    ).toEqual(document);
  });
  it("preserves positions in legacy drafts when enabling automatic flow", () => {
    const document = createModuleDocument(options, dimensions, measure);
    delete document.flowVersion;
    const restored = readModuleDocument(JSON.stringify(document), options)!;
    expect(
      restored.pages
        .flatMap(page => page.modules)
        .every(module => module.positioned)
    ).toBe(true);
    expect(restored.pages[0].modules[0].rect).toEqual(
      document.pages[0].modules[0].rect
    );
  });
  it.each([
    ["left", 80, 0],
    ["right", -80, 0],
    ["top", 0, 90],
    ["bottom", 0, -90],
  ] as [ModuleHandle, number, number][])(
    "crops %s without stretching pixels and can restore the original edge",
    (handle, dx, dy) => {
      const cropped = transformModule(image, handle, dx, dy) as ImageModule;
      expect(cropped.rect.width / cropped.crop.width).toBeCloseTo(
        image.rect.width
      );
      expect(cropped.rect.height / cropped.crop.height).toBeCloseTo(
        image.rect.height
      );
      const restored = transformModule(
        cropped,
        handle,
        -dx,
        -dy
      ) as ImageModule;
      expect(restored.rect).toEqual(image.rect);
      expect(restored.crop.width).toBeCloseTo(1);
      expect(restored.crop.height).toBeCloseTo(1);
      expect(image.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    }
  );
  it("grows edited text to contain all Unicode and keeps other modules immutable", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const original = document.pages[1].modules[0] as TextModule;
    const text = "新文字👩‍👧é".repeat(50);
    const edited = editModuleText(original, text, measure);
    const next = replaceModule(document, 1, edited);
    expect(edited.text).toBe(text);
    expect(edited.contentHeight).toBeGreaterThan(original.contentHeight);
    expect(edited.rect.y + edited.rect.height).toBeLessThanOrEqual(1200);
    expect(next.pages[0]).toBe(document.pages[0]);
    expect(document.pages[1].modules[0]).toBe(original);
  });
  it("restores valid layouts, rejects bad crops/foreign assets and isolates source and story revisions", () => {
    const document = createModuleDocument(options, dimensions, measure);
    expect(readModuleDocument(JSON.stringify(document), options)).toEqual(
      document
    );
    const wrong = structuredClone(document);
    (wrong.pages[0].modules[0] as ImageModule).crop.width = 2;
    expect(readModuleDocument(JSON.stringify(wrong), options)).toBeNull();
    expect(
      readModuleDocument(JSON.stringify(document), {
        ...options,
        coverUrl: "/other.png",
      })
    ).toBeNull();
    expect(readModuleDocument("bad", options)).toBeNull();
    expect(moduleStorageKey("s1:v1", "old")).not.toBe(
      moduleStorageKey("s1:v1", "new")
    );
    expect(moduleStorageKey("s1:v1", "old")).not.toBe(
      moduleStorageKey("s2:v1", "old")
    );
  });
  it("keeps existing saved edits when only derived paper colors change, but isolates actual settings", () => {
    const key = moduleStorageKey("s1:v1", JSON.stringify(options));
    const tinted = {
      ...options,
      paperPalette: { paper: "#e4d1bd", ink: "#221c16", accent: "#927254" },
    };
    expect(moduleStorageKey("s1:v1", JSON.stringify(tinted))).toBe(key);
    for (const change of [
      { body: "另一篇正文" },
      { coverUrl: "/new.png" },
      { texture: "linen" },
      { illustrations: [{ imageUrl: "/new.png", after: null }] },
    ]) {
      expect(
        moduleStorageKey("s1:v1", JSON.stringify({ ...tinted, ...change }))
      ).not.toBe(key);
    }
    const document = createModuleDocument(options, dimensions, measure);
    const title = document.pages[0].modules[1] as TextModule;
    const edited = replaceModule(
      document,
      0,
      transformModule(
        editModuleText(title, "我修改的标题", measure),
        "move",
        10,
        20
      )
    );
    expect(readModuleDocument(JSON.stringify(edited), tinted)).toEqual(edited);
  });
  it("restores optional text appearance and preserves it through text edits, moves and cropping other modules", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const oldTitle = document.pages[0].modules[1] as TextModule;
    expect(oldTitle.emphasis).toBeUndefined();
    const styled: TextModule = {
      ...oldTitle,
      emphasis: "bright",
      backdrop: true,
    };
    const next = replaceModule(
      document,
      0,
      transformModule(
        editModuleText(styled, "叠在图片上的文字", measure),
        "move",
        10,
        -100
      )
    );
    expect(readModuleDocument(JSON.stringify(next), options)).toEqual(next);
    expect(next.pages[0].modules[1]).toMatchObject({
      emphasis: "bright",
      backdrop: true,
    });
    expect(document.pages[0].modules[1]).toBe(oldTitle);
    const invalid = structuredClone(next);
    Object.assign(invalid.pages[0].modules[1], { emphasis: "neon" });
    expect(readModuleDocument(JSON.stringify(invalid), options)).toBeNull();
  });
  it("paints and targets text above images without changing document flow or saved order", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const [picture, title] = document.pages[0].modules;
    const modules = [title, picture];
    expect(modulePaintOrder(modules)).toEqual([picture, title]);
    expect(modules).toEqual([title, picture]);
  });
  it("moves styled text as one undoable document change without reflowing either page", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const title = document.pages[0].modules[1] as TextModule;
    Object.assign(title, { emphasis: "bright", backdrop: true });
    const original = structuredClone(document);
    const next = moveModuleToPage(document, 0, title.id, 1);
    expect(next.pages).toHaveLength(document.pages.length);
    expect(next.pages[0].modules).toEqual([document.pages[0].modules[0]]);
    expect(next.pages[1].modules).toEqual([
      ...document.pages[1].modules,
      { ...title, positioned: true },
    ]);
    expect(document).toEqual(original);
    expect(readModuleDocument(JSON.stringify(next), options)).toEqual(next);
    const flowed = flowModulePage(next, 1, next.pages[1].modules);
    expect(
      flowed.pages[1].modules.find(module => module.id === title.id)
    ).toEqual({
      ...title,
      positioned: true,
    });
  });
  it("moves a cropped image to an earlier page and retains empty source pages", () => {
    const cropped = transformModule(image, "left", 80, 0);
    const document = {
      version: 1 as const,
      flowVersion: 1 as const,
      pages: [
        { label: "空页", modules: [] },
        { label: "图片页", modules: [cropped] },
        {
          label: "后页",
          modules: [newTextModule("later", "保持位置", measure)],
        },
      ],
    };
    const next = moveModuleToPage(document, 1, cropped.id, 0);
    expect(next.pages).toHaveLength(3);
    expect(next.pages[0].modules).toEqual([cropped]);
    expect(next.pages[1]).toEqual({ label: "图片页", modules: [] });
    expect(next.pages[2]).toBe(document.pages[2]);
    expect(readModuleDocument(JSON.stringify(next), options)).toEqual(next);
  });
  it("can move the only module into a new page, including from a single-page work", () => {
    const document = {
      version: 1 as const,
      pages: [{ label: "原页", modules: [image] }],
    };
    const next = moveModuleToPage(document, 0, image.id, 1);
    expect(next.pages).toEqual([
      { label: "原页", modules: [] },
      { label: "正文", modules: [{ ...image, positioned: true }] },
    ]);
    expect(document.pages[0].modules).toEqual([image]);
    expect(moveModuleToPage(next, 1, image.id, 1)).toBe(next);
  });
  it("allows movement within nine pages but rejects a tenth page atomically", () => {
    const document = {
      version: 1 as const,
      pages: Array.from({ length: 9 }, (_, index) => ({
        label: "正文",
        modules: index === 0 ? [image] : [],
      })),
    };
    expect(
      moveModuleToPage(document, 0, image.id, 8).pages[8].modules
    ).toHaveLength(1);
    expect(() => moveModuleToPage(document, 0, image.id, 9)).toThrow(
      "最多 9 页"
    );
    expect(document.pages[0].modules).toEqual([image]);
    expect(document.pages).toHaveLength(9);
  });
  it("rejects stale destinations, missing modules and target limits without losing content", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const original = structuredClone(document);
    for (const target of [-1, 0.5, NaN, 3])
      expect(() =>
        moveModuleToPage(document, 0, "cover-title", target)
      ).toThrow("目标页面");
    expect(() => moveModuleToPage(document, 0, "missing", 1)).toThrow("找不到");
    expect(() => moveModuleToPage(document, -1, "cover-title", 1)).toThrow(
      "找不到"
    );
    document.pages[1].modules.push(document.pages[0].modules[1]);
    expect(() => moveModuleToPage(document, 0, "cover-title", 1)).toThrow(
      "同名模块"
    );
    document.pages[1].modules.pop();
    expect(document).toEqual(original);
    const full = {
      ...document,
      pages: [
        document.pages[0],
        {
          label: "正文",
          modules: Array.from({ length: 300 }, (_, index) => ({
            ...image,
            id: `image-${index}`,
          })),
        },
      ],
    };
    expect(() => moveModuleToPage(full, 0, "cover-title", 1)).toThrow(
      "数量已达上限"
    );
    expect(full.pages[0]).toEqual(original.pages[0]);
    expect(full.pages[1].modules).toHaveLength(300);
  });
  it.each([0, 1, 2])(
    "inserts a blank page at index %s without changing existing layouts or draft identity",
    index => {
      const document = createModuleDocument(options, dimensions, measure);
      const original = structuredClone(document);
      const next = insertModulePage(document, index);
      expect(next.pages).toHaveLength(3);
      expect(next.pages[index]).toEqual({ label: "正文", modules: [] });
      expect(next.pages.filter((_, i) => i !== index)).toEqual(document.pages);
      for (const page of document.pages) expect(next.pages).toContain(page);
      expect(document).toEqual(original);
      expect(readModuleDocument(JSON.stringify(next), options)).toEqual(next);
      expect(deleteModulePage(next, index)).toEqual(document);
    }
  );
  it.each([0, 1, 2])(
    "deletes page %s including its content while preserving other pages and the undo snapshot",
    index => {
      const document = createModuleDocument(options, dimensions, measure);
      document.pages.push({
        label: "末页",
        modules: [newTextModule("last", "最后一页", measure)],
      });
      const original = structuredClone(document);
      const deletedIds = new Set(
        document.pages[index].modules.map(module => module.id)
      );
      const next = deleteModulePage(document, index);
      expect(next.pages).toHaveLength(2);
      expect(next.pages).toEqual(document.pages.filter((_, i) => i !== index));
      expect(
        next.pages
          .flatMap(page => page.modules)
          .some(module => deletedIds.has(module.id))
      ).toBe(false);
      for (const page of next.pages) expect(document.pages).toContain(page);
      expect(document).toEqual(original);
      expect(readModuleDocument(JSON.stringify(next), options)).toEqual(next);
    }
  );
  it("keeps at least one page and allows replacing the sole page by inserting first", () => {
    const document = {
      version: 1 as const,
      pages: [{ label: "封面", modules: [image] }],
    };
    expect(() => deleteModulePage(document, 0)).toThrow("至少保留一页");
    const next = deleteModulePage(insertModulePage(document, 1), 0);
    expect(next.pages).toEqual([{ label: "正文", modules: [] }]);
    expect(document.pages[0].modules).toEqual([image]);
  });
  it("rejects insertion beyond nine pages and invalid page operations atomically", () => {
    const document = createModuleDocument(options, dimensions, measure);
    const original = structuredClone(document);
    for (const index of [-1, 0.5, NaN, 3]) {
      expect(() => insertModulePage(document, index)).toThrow("目标页面");
      expect(() => deleteModulePage(document, index)).toThrow("目标页面");
    }
    expect(() => deleteModulePage(document, document.pages.length)).toThrow(
      "目标页面"
    );
    expect(document).toEqual(original);
    let full = document;
    while (full.pages.length < 9)
      full = insertModulePage(full, full.pages.length);
    expect(() => insertModulePage(full, 0)).toThrow("最多 9 页");
    expect(full.pages).toHaveLength(9);
    expect(insertModulePage(deleteModulePage(full, 8), 0).pages).toHaveLength(
      9
    );
  });
});
