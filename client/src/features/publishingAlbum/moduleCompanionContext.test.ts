import { afterEach, describe, expect, it, vi } from "vitest";
import { moduleCompanionContext } from "./moduleCompanionContext";
import {
  layoutModuleContextSchema,
  layoutModuleLabel,
} from "@shared/layoutModuleContext";
import {
  newTextModule,
  newImageModule,
  moveModuleToPage,
  type ModuleDocument,
} from "./imagePackModules";

const text = newTextModule("text", "原来的文字", (_, size) => size);
const image = newImageModule("image", "/private-image.png", {
  width: 600,
  height: 400,
});
const document: ModuleDocument = {
  version: 1,
  pages: [
    { label: "第一页", modules: [text, image] },
    { label: "第二页", modules: [] },
  ],
};
const jpeg = "data:image/jpeg;base64,AAAA";
function snapshot(
  selectedId: string | null,
  overrides: Partial<Parameters<typeof moduleCompanionContext>[0]> = {}
) {
  vi.stubGlobal("document", {
    createElement: () => ({ toDataURL: () => jpeg }),
  });
  return moduleCompanionContext({
    storyId: 7,
    scope: "7:v1:source",
    document,
    pageIndex: 0,
    selectedId,
    renderer: { draw: vi.fn() },
    ...overrides,
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("selected layout module discussion snapshot", () => {
  it("includes the latest text, displayed size, style and page image without original asset URLs", () => {
    const styled = {
      ...text,
      emphasis: "bright" as const,
      backdrop: true,
      rect: { ...text.rect, width: text.rect.width * 0.5 },
    };
    const result = snapshot(text.id, {
      document: {
        ...document,
        pages: [
          { ...document.pages[0], modules: [styled, image] },
          document.pages[1],
        ],
      },
      editing: { id: text.id, text: "正在输入的文字" },
    });
    expect(result).toMatchObject({
      kind: "text",
      text: "正在输入的文字",
      emphasis: "bright",
      backdrop: true,
      page: 1,
      pageCount: 2,
      pagePreview: jpeg,
    });
    expect(result!.fontSize).toBe(text.fontSize * 0.5);
    expect(result!.pageText).toBe("正在输入的文字");
    expect(JSON.stringify(result)).not.toContain("private-image");
    expect(layoutModuleContextSchema.safeParse(result).success).toBe(true);
  });
  it("follows a moved image and keeps its crop, then restores the original context after undo", () => {
    const moved = moveModuleToPage(document, 0, image.id, 1);
    const result = snapshot(image.id, { document: moved, pageIndex: 1 });
    expect(result).toMatchObject({
      kind: "image",
      page: 2,
      crop: image.crop,
      rect: image.rect,
    });
    expect(layoutModuleLabel(result!)).toBe("第 2 页 · 图片模块");
    expect(snapshot(image.id)!.page).toBe(1);
  });
  it("clears on deselection, deletion and changing to a page without the selected module", () => {
    expect(snapshot(null)).toBeNull();
    expect(snapshot("deleted")).toBeNull();
    expect(snapshot(text.id, { pageIndex: 1 })).toBeNull();
  });
  it("keeps text/layout available when preview drawing fails", () => {
    const result = snapshot(image.id, {
      renderer: {
        draw: () => {
          throw new Error("missing bitmap");
        },
      },
    });
    expect(result?.kind).toBe("image");
    expect(result?.pagePreview).toBeUndefined();
  });
  it("rejects remote image URLs, oversized pictures, invalid numbers and nonexistent pages", () => {
    const valid = snapshot(image.id)!;
    for (const patch of [
      { pagePreview: "http://localhost/private" },
      { pagePreview: `data:image/jpeg;base64,${"A".repeat(240_000)}` },
      { rect: { ...valid.rect, x: NaN } },
      { page: 3, pageCount: 2 },
    ])
      expect(
        layoutModuleContextSchema.safeParse({ ...valid, ...patch }).success
      ).toBe(false);
  });
});

it("resolves repeated lines by module identity across pages and skips images/title", () => {
  const a = newTextModule("a", "重复", (_, size) => size);
  const b = newTextModule("b", "重复", (_, size) => size);
  const title = newTextModule("cover-title", "封面", (_, size) => size);
  const result = snapshot("b", { document: { version: 1, pages: [
    { label: "一", modules: [title, a, image] }, { label: "二", modules: [b] },
  ] }, pageIndex: 1 });
  expect(result?.line?.position).toMatchObject({ index: 1, total: 2, blockId: "b:line:0", prevText: "重复", text: "重复" });
  expect(result?.line?.source).toBe("layout");
  expect(snapshot(image.id)?.line).toBeUndefined();
});

it("uses canonical chapter order and stable block bindings even when visual order changes", () => {
  const first = newTextModule("first", "相同", (_, size) => size);
  const second = newTextModule("second", "相同", (_, size) => size);
  const lineSource = { chapterId: "chapter-2", blocks: [{ id: "b1", text: "相同" }, { id: "b2", text: "相同" }], moduleBlockIds: { first: "b1", second: "b2" }, titles: ["章一", "章二"] };
  const result = snapshot("second", { document: { version: 1, pages: [{ label: "一", modules: [second, first] }] }, lineSource, editing: { id: "second", text: "输入中的新字" } });
  expect(result?.line?.position).toEqual({ chapterId: "chapter-2", blockId: "b2", index: 1, total: 2, prevText: "相同", text: "输入中的新字", nextText: "" });
  expect(result?.line?.excerpt).toContain("全书目录：章一 / 章二");
  expect(lineSource.blocks[1].text).toBe("相同");
  expect(snapshot("second", { lineSource, document: { version: 1, pages: [{ label: "一", modules: [second] }] }, editing: { id: "second", text: "多行\n粘贴" } })?.line).toBeUndefined();
});

it("locates a multi-line pending layout edit only with its native cursor", () => {
  const result = snapshot(text.id, { editing: { id: text.id, text: "甲\n\n乙\n丙", cursor: 4 } });
  expect(result?.line?.position).toMatchObject({ index: 1, total: 3, text: "乙", nextText: "丙" });
  expect(snapshot(text.id, { editing: { id: text.id, text: "甲\n乙" } })?.line).toBeUndefined();
  expect(layoutModuleContextSchema.safeParse(result).success).toBe(true);
});


it("keeps valid maximum-length legacy module ids chat-compatible after adding a line suffix", () => {
  const longId = "m".repeat(200);
  const result = snapshot(longId, { document: { version: 1, pages: [{ label: "一", modules: [newTextModule(longId, "正文", () => 20)] }] } });
  expect(layoutModuleContextSchema.safeParse(result).success).toBe(true);
});
