import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MobileModuleTools,
  MobilePageTools,
  MobileModuleTextEditor,
} from "./MobileModuleTools";
import { newTextModule, newImageModule } from "./imagePackModules";

vi.stubGlobal("React", React);
vi.mock("@/features/mobileWorkspace/MobileSheet", () => ({
  MobileSheet: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
  }) => (open ? <section aria-label={title}>{children}</section> : null),
}));
const text = newTextModule("text", "完整文字", (_, size) => size);
const image = newImageModule("image", "/cover.png", {
  width: 600,
  height: 400,
});
const pages = [
  { label: "封面", modules: [image] },
  { label: "正文", modules: [text] },
];
const actions = {
  onOpenChange: vi.fn(),
  onEdit: vi.fn(),
  onCrop: vi.fn(),
  onChange: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
};
describe("mobile module actions", () => {
  it("makes text editing, both styles, backdrop, page movement and deletion available without a context menu", () => {
    const html = renderToStaticMarkup(
      <MobileModuleTools
        {...actions}
        open
        module={{ ...text, emphasis: "bright", backdrop: true }}
        pages={pages}
        pageIndex={1}
        disabled={false}
      />
    );
    for (const label of [
      "编辑文字",
      "正常",
      "加粗提亮",
      "半透明底色",
      "移到其他页",
      "移到新一页",
      "删除文字模块",
    ])
      expect(html).toContain(label);
    expect(html).toMatch(/aria-pressed="true"[^>]*>加粗提亮/);
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(/<option value="1" disabled="">第 2 页/);
    expect(html).not.toContain("裁切图片");
  });
  it("offers crop, page movement and deletion for images without text-only options", () => {
    const html = renderToStaticMarkup(
      <MobileModuleTools
        {...actions}
        open
        module={image}
        pages={pages}
        pageIndex={0}
        disabled={false}
      />
    );
    for (const label of ["裁切图片", "移到其他页", "删除图片模块"])
      expect(html).toContain(label);
    expect(html).not.toContain("编辑文字");
    expect(html).not.toContain("半透明底色");
  });
  it("prevents a tenth page while still allowing movement to existing pages", () => {
    const full = Array.from({ length: 9 }, () => pages[0]);
    const html = renderToStaticMarkup(
      <MobileModuleTools
        {...actions}
        open
        module={image}
        pages={full}
        pageIndex={0}
        disabled={false}
      />
    );
    expect(html).toContain(
      '<option value="9" disabled="">已达 9 页上限</option>'
    );
    expect(html).toContain('<option value="8">第 9 页');
  });
  it.each([1, 4, 9])(
    "offers page insert/delete/arrange with correct limits at %s pages",
    pageCount => {
      const html = renderToStaticMarkup(
        <MobilePageTools
          open
          onOpenChange={vi.fn()}
          pageIndex={0}
          pageCount={pageCount}
          disabled={false}
          onInsert={vi.fn()}
          onDelete={vi.fn()}
          onArrange={vi.fn()}
        />
      );
      for (const label of [
        "在前面插入空白页",
        "在后面插入空白页",
        "整理这一页",
        "删除这一页",
      ])
        expect(html).toContain(label);
      const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g)!;
      expect(buttons[0].includes('disabled=""')).toBe(pageCount >= 9);
      expect(buttons[1].includes('disabled=""')).toBe(pageCount >= 9);
      expect(buttons[3].includes('disabled=""')).toBe(pageCount <= 1);
    }
  );
  it("keeps text and validation errors visible with explicit save and cancel actions", () => {
    const html = renderToStaticMarkup(
      <MobileModuleTextEditor
        text="尚未保存的文字"
        disabled={false}
        error="这段内容超过一页"
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(html).toContain('aria-label="文字模块内容"');
    expect(html).toContain("尚未保存的文字");
    expect(html).toContain('role="alert"');
    expect(html).toContain("这段内容超过一页");
    expect(html).toContain("完成");
    expect(html).toContain("取消改字");
  });
});
