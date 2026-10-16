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
