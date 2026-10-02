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
    expect(html).toContain("下方自动生成成品");
    expect(html).not.toContain(">制作图片</button>");
    expect(html).not.toContain("下载整套");
    expect(html).not.toContain('aria-label="整套配色"');
    expect(html).toContain("正文纹理");
    expect(html.match(/aria-label="选用底图：/g)).toHaveLength(6);
    expect(html).toContain("换一组免费纹理");
    expect(html).toContain("调整标题、字体与插图位置</summary>");
  });

  it("keeps article production available with no images and mounts the advanced editor only when requested", () => {
    const advanced = vi.fn(() => <div>逐页编辑器</div>);
    const Advanced = advanced;
    const html = renderToStaticMarkup(<PublishingImagePack {...props} assets={[]}
      advancedEditor={<Advanced />} advancedOpen={false} />);
    expect(html).toContain("制作纯文字图片");
    expect(html).toContain("包含封面");
    expect(html).toContain("已有画册 · 逐页精细排版");
    expect(advanced).not.toHaveBeenCalled();
    const expanded = renderToStaticMarkup(<PublishingImagePack {...props} assets={[]}
      advancedEditor={<Advanced />} advancedOpen />);
    expect(expanded).toContain("逐页编辑器");
  });

  it("keeps paid illustrations visible after switching covers, with current-cover candidates first", () => {
    const html = renderToStaticMarkup(<PublishingImagePack {...props} adoptedCoverId={2} assets={[
      { id: 1, imageUrl: "/first.png", label: "封面一" },
      { id: 2, imageUrl: "/second.png", label: "封面二" },
      { id: 3, imageUrl: "/old.png", label: "旧插图", kind: "illustration", parentAssetId: 1, warning: "疑似含字" },
      { id: 4, imageUrl: "/new.png", label: "当前插图", kind: "illustration", parentAssetId: 2 },
    ]} />);
    expect(html).toContain('aria-label="选用插图：旧插图"');
    expect(html).toContain("来自其他封面");
    expect(html).toContain("疑似含字");
    expect(html.indexOf('aria-label="选用插图：当前插图"')).toBeLessThan(html.indexOf('aria-label="选用插图：旧插图"'));
    expect(html).not.toContain('aria-label="选为封面：旧插图"');
  });

  it("does not describe an unsaved article or other disabled state as image generation", () => {
    const html = renderToStaticMarkup(<PublishingImagePack {...props} coverBusy assets={[]}
      onGenerateIllustration={async () => {}} />);
    expect(html).not.toContain("正在生成配图");
  });

  it("keeps AI textures in the background strip and preserves risk warnings", () => {
    const html = renderToStaticMarkup(<PublishingImagePack {...props} assets={[
      { id: 7, imageUrl: "/texture.png", label: "AI纹理", kind: "body-texture", warning: "质检未完成" },
    ]} onGenerateTexture={async () => {}} />);
    expect(html).toContain('aria-label="选用底图：AI纹理"');
    expect(html).not.toContain('aria-label="选为封面：AI纹理"');
    expect(html).not.toContain('aria-label="选用插图：AI纹理"');
    expect(html).toContain("质检未完成");
    expect(html).toContain("生成底图");
  });

  it("shows elapsed waiting time only for an actual generation request", () => {
    const html = renderToStaticMarkup(<PublishingImagePack {...props} coverBusy assets={[]}
      generationStartedAt={Date.now() - 125_000} />);
    expect(html).toContain("已等待 2 分 5 秒");
    expect(html).toContain("绘图后还需下载和质检");
  });
});
