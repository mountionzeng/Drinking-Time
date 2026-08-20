import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import { PublishingAlbumTypographyEditor } from "./PublishingAlbumTypographyEditor";

describe("PublishingAlbumTypographyEditor", () => {
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
    expect(html).toContain("保存");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("逐字编辑");
    expect(html).not.toContain("节点编辑");
  });
});
