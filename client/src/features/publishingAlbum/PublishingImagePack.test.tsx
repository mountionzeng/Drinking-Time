import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishingImagePack } from "./PublishingImagePack";

vi.stubGlobal("React", React);

const query = vi.hoisted(() => ({ data: undefined as any }));
const previews = vi.hoisted(() => new Map<string, React.ReactNode>());
vi.mock("@/lib/trpc", () => ({ trpc: { publishingDraft: { readAlbum: { useQuery: () => query } } } }));
vi.mock("./ImageCandidatePreview", () => ({ ImageCandidatePreview: ({ children, label, controls }: { children: React.ReactNode; label: string; controls?: React.ReactNode }) => {
  if (controls) previews.set(label, controls);
  return children;
} }));

const props = {
  scope: "1:v1:xiaohongshu", storyId: 1, versionId: "v1", hasAlbum: true,
  title: "文章标题", body: "自己的完整文章", adoptedCoverId: null,
  onOpenCoverStudio: vi.fn(), coverBusy: false,
};

describe("article image pack entry", () => {
  beforeEach(() => { query.data = undefined; previews.clear(); vi.unstubAllGlobals(); vi.stubGlobal("React", React); });

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
    expect(html).toContain("请选择封面");
    expect(html).not.toContain(">制作图片</button>");
    expect(html).not.toContain("下载整套");
    expect(html).not.toContain('aria-label="整套配色"');
    expect(html).toContain("正文纹理");
    expect(html.match(/aria-label="选用底图：/g)).toHaveLength(6);
    expect(html).toContain("换一组免费纹理");
    expect(html).toContain("排版设置</summary>");
  });

  it("keeps article production available with no images and mounts the advanced editor only when requested", () => {
    const advanced = vi.fn(() => <div>逐页编辑器</div>);
    const Advanced = advanced;
    const html = renderToStaticMarkup(<PublishingImagePack {...props} assets={[]}
      advancedEditor={<Advanced />} advancedOpen={false} />);
    expect(html).toContain("暂无配图");
    expect(html).toContain("包含封面");
    expect(html).toContain("逐页编辑画册");
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
    expect(html).not.toContain("无需重复点击");
  });

  it("keeps position and removal controls in each large preview without duplicating them in the page", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ illustrations: [{ assetId: 3, after: null }, { assetId: 4, after: { text: "旧段落", occurrence: 0, matches: 1 } }] }) });
    const html = renderToStaticMarkup(<PublishingImagePack {...props} body={"第一段\n第二段"} assets={[
      { id: 3, imageUrl: "/one.png", label: "插图一", kind: "illustration" },
      { id: 4, imageUrl: "/two.png", label: "插图二", kind: "illustration" },
      { id: 5, imageUrl: "/cover.png", label: "原封面" },
    ]} />);
    expect(html).not.toContain('aria-label="插入位置：');
    expect(html).not.toContain('aria-label="移除插图：');
    expect(html).toContain("请重新定位");
    const firstControls = renderToStaticMarkup(<>{previews.get("插图一")}</>);
    const secondControls = renderToStaticMarkup(<>{previews.get("插图二")}</>);
    expect(firstControls).toContain('aria-label="移除插图：插图一"');
    expect(firstControls).toContain("正文开头（默认）");
    expect(secondControls).toContain('aria-label="移除插图：插图二"');
    expect(secondControls).toContain("第 1 段后 · 第一段");
    expect(secondControls).toContain("第 2 段后 · 第二段");
    expect(secondControls).toContain("原位置无法定位");
    expect(secondControls).toContain("原文：旧段落");
    expect(html).not.toContain("正文中间页");
    expect(html).toContain('aria-label="添加已有图片作插图"');
    expect(html).toContain('<option value="5">原封面</option>');
  });

  it("keeps a missing selected asset removable instead of silently dropping it", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ illustrationId: 99, illustrationPosition: "middle" }) });
    const html = renderToStaticMarkup(<PublishingImagePack {...props} assets={[]} />);
    expect(html).toContain('aria-label="移除插图：99"');
    expect(html).toContain("不可用");
  });
});
