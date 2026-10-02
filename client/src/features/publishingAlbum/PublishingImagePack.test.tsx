import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishingImagePack } from "./PublishingImagePack";

vi.stubGlobal("React", React);

const query = vi.hoisted(() => ({ data: undefined as any }));
vi.mock("@/lib/trpc", () => ({ trpc: { publishingDraft: { readAlbum: { useQuery: () => query } } } }));

const props = {
  scope: "1:v1:xiaohongshu", storyId: 1, versionId: "v1", hasAlbum: true,
  title: "文章标题", body: "自己的完整文章", adoptedCoverId: null,
  onOpenCoverStudio: vi.fn(), coverBusy: false,
};

describe("article image pack entry", () => {
  beforeEach(() => { query.data = undefined; });

  it("combines existing cover and album assets without duplicates and preserves quality warnings", () => {
    query.data = {
      assets: [{ id: 1, imageUrl: "/cover.png" }, { id: 2, imageUrl: "/album.png" }],
      album: { pages: [{ backgroundRounds: [{ assetIds: [2], qualityFlaggedAssetIds: [2] }] }] },
    };
    const html = renderToStaticMarkup(<PublishingImagePack {...props}
      assets={[{ id: 1, imageUrl: "/cover.png", label: "封面候选", warning: "质检未完成" }]} />);
    expect(html).toContain("已有图片 2 张");
    expect(html).toContain("质检未完成");
    expect(html).toContain("疑似含字");
    expect(html).toMatch(/aria-label="封面文字"[^>]*value="文章标题"/);
    expect(html).toMatch(/disabled=""[^>]*>制作图片/);
    expect(html).not.toContain("下载整套");
  });

  it("keeps article production available with no images and mounts the advanced editor only when requested", () => {
    const advanced = vi.fn(() => <div>逐页编辑器</div>);
    const Advanced = advanced;
    const html = renderToStaticMarkup(<PublishingImagePack {...props} assets={[]}
      advancedEditor={<Advanced />} advancedOpen={false} />);
    expect(html).toContain("可以先制作纯文字图片");
    expect(html).toContain("包含封面");
    expect(html).toContain("已有画册 · 逐页精细排版");
    expect(advanced).not.toHaveBeenCalled();
    const expanded = renderToStaticMarkup(<PublishingImagePack {...props} assets={[]}
      advancedEditor={<Advanced />} advancedOpen />);
    expect(expanded).toContain("逐页编辑器");
  });
});
