import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import {
  PublishingAlbumTypographyEditor,
  resolvePublishingAlbumTypographyArtDirectionTags,
} from "./PublishingAlbumTypographyEditor";

describe("PublishingAlbumTypographyEditor", () => {
  it("reuses one stable empty art-direction list across rerenders", () => {
    expect(resolvePublishingAlbumTypographyArtDirectionTags()).toBe(
      resolvePublishingAlbumTypographyArtDirectionTags()
    );
  });

  it("offers the keyboard entry and only the minimal draw toolbar", () => {
    const html = renderToStaticMarkup(
      <PublishingAlbumTypographyEditor
        text="这是一页中文"
        backgroundUrl="/page.png"
        initialLayout={null}
        onSave={vi.fn()}
      />
    );
    expect(html).toContain("双击进入画册文字排版");
    expect(html).toContain("排版文字");
    expect(html).toContain("撤销");
    expect(html).toContain("重画");
    expect(html).toContain("字体");
    expect(html).toContain("对齐");
    expect(html).toContain("字号");
    expect(html).toContain("字间距");
    expect(html).toContain("保存");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("逐字编辑");
    expect(html).not.toContain("节点编辑");
  });

  it("blocks layout persistence until locally edited page text is saved", () => {
    const html = renderToStaticMarkup(
      <PublishingAlbumTypographyEditor
        text="尚未保存的新文字"
        backgroundUrl="/page.png"
        initialLayout={null}
        saveBlocked
        onSave={vi.fn()}
      />
    );
    expect(html).toContain("请先保存这一页文字");
    expect(html).toContain("disabled");
  });

  it("reuses the layout editor on a square storyboard image", () => {
    const html = renderToStaticMarkup(
      <PublishingAlbumTypographyEditor
        text="镜头文字"
        backgroundUrl="/frame.png"
        initialLayout={null}
        canvas={{ width: 900, height: 900 }}
        editorLabel="镜头图片文字排版编辑器"
        saveLabel="完成排版"
        onSave={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="镜头图片文字排版编辑器"');
    expect(html).toContain('style="aspect-ratio:900 / 900"');
    expect(html).toContain("完成排版");
  });
});
