import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChapterWorkspace, mapChapterImages, chapterImageAssets } from "./ChapterWorkspace";
import type { Chapter } from "./useChapters";
vi.stubGlobal("React", React);
const deliveryState = vi.hoisted(() => ({ enabled: false, externalVersion: null as number | null, inbox: [] as any[], candidates: [] as any[], inboxOptions: null as any, candidateOptions: null as any }));
const chapter: Chapter = {
  id: 2,
  storyId: 1,
  position: 1,
  title: "第二章",
  version: 4,
  updatedAt: new Date(),
  layout: null,
  blocks: {
    body: "这一章自己的正文",
    blockIds: ["id"],
    containsAiText: false,
    settings: null,
    coverKey: null,
    bodyTextureKey: null,
    images: {},
    illustrations: [],
  },
};
vi.mock("./useChapters", () => ({
  useChapters: () => ({
    chapters: [chapter],
    active: chapter,
    imageUrls: {},
    error: "",
    saving: false,
    loading: false,
    epoch: 0,
    externalVersion: deliveryState.externalVersion,
    change: vi.fn(),
    flush: vi.fn(),
    refresh: vi.fn(),
    version: () => 4,
    open: vi.fn(),
    reloadList: vi.fn(),
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    chapterDelivery: {
      status: { useQuery: () => ({ data: { enabled: deliveryState.enabled } }) },
      contacts: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
      inbox: { useQuery: (_input: unknown, options: unknown) => {deliveryState.inboxOptions = options; return { data: deliveryState.inbox, refetch: vi.fn() };} },
      ...Object.fromEntries(
        ["send", "createClaimLink", "return", "resolve"].map(name => [
          name,
          { useMutation: () => ({ mutateAsync: vi.fn() }) },
        ])
      ),
    },
    chapters: Object.fromEntries(
      [
        "create",
        "save",
        "remove",
        "reorder",
        "exportPackage",
        "importPackage",
        "restoreVersion",
        "resolveCandidate",
        "candidates",
        "versions",
        "sharingHistory",
      ].map(name => [
        name,
        {
          useMutation: () => ({ mutateAsync: vi.fn() }),
          useQuery: (_input: unknown, options: unknown) => {if(name === "candidates") deliveryState.candidateOptions = options; return ({
            data: ["versions", "sharingHistory"].includes(name) ? [] : { candidates: deliveryState.candidates },
            refetch: vi.fn(),
          }); },
        },
      ])
    ),
    useUtils: () => ({ chapters: { get: { fetch: vi.fn() } } }),
  },
}));
vi.mock("@/features/writingCompanion/DesktopWritingContext", () => ({ DesktopWritingContext: () => null }));
vi.mock("./BookImageGenerator", () => ({BookImageGenerator: () => <button>生成图片</button>}));
vi.mock("./ChapterComparison", () => ({ ChapterComparison: () => null }));
describe("chapter workspace", () => {
  it("opens chapter writing directly with the same chapter and an inline history entry", () => {
    const render = vi.fn();
    const html = renderToStaticMarkup(<ChapterWorkspace scope="platform:v1" storyId={1} accountId={9} versionId="v1" hasAlbum={false} title="旧平台标题" body="" assets={[]} adoptedCoverId={null} coverBusy={false} mode="text" render={render} />);
    expect(html).toContain('aria-label="章节写作"');
    expect(html).not.toContain('aria-label="当前章节"');
    expect(html).not.toContain('保存章节');
    expect(html).toContain('这一章自己的正文');
    expect(html).toContain('>版本</button>');
    expect(html).not.toContain('对比生成的文字');
    expect(html).not.toContain('平台稿与章节');
    expect(render).not.toHaveBeenCalled();
  });
  it.each([false, true])("renders isolated chapter content with delivery enabled=%s", enabled => {
    deliveryState.enabled = enabled;
    let seen: Record<string, unknown> = {};
    const html = renderToStaticMarkup(
      <ChapterWorkspace
        scope="platform:v1"
        storyId={1}
        accountId={9}
        versionId="v1"
        hasAlbum={false}
        title="平台标题"
        body="不能写进第二章的平台正文"
        assets={[]}
        adoptedCoverId={99}
        coverBusy={false}
        render={props => {
          seen = props;
          return <>{props.layoutHeader}<p>{props.body}</p></>;
        }}
      />
    );
    expect(html).toContain(">版本</button>");
    expect(html).not.toContain("当前版本与分享记录");
    expect(html).not.toContain("新增章节");
    for (const removed of ["更多", "上移", "下移", "删除章节", "打包这一章", "导入章节包", "按章保存", "选择章节包文件"]) {
      expect(html).not.toContain(removed);
    }
    expect(html).toContain("这一章自己的正文");
    expect(html.includes("收件箱")).toBe(enabled);
    expect(html.includes("生成故事链接")).toBe(enabled);
    expect(html).not.toContain("发送到微信 / 亲友");
    expect(html).not.toContain("收件人");
    expect(html).not.toContain("不能写进第二章");
    expect(seen.scope).toBe("chapter:9:1:2:v4:0");
    expect(seen.adoptedCoverId).toBeNull();
  });
  it("generates from the chapter selection and never falls back to the platform manuscript", async () => {
    const generate = vi.fn().mockResolvedValue(undefined);
    let seen: any;
    renderToStaticMarkup(<ChapterWorkspace scope="platform:v1" storyId={1} versionId="v1" hasAlbum={false}
      title="平台稿" body="不能用于章节配图的平台正文" assets={[]} adoptedCoverId={null} coverBusy={false}
      onGenerateCover={generate} render={props => { seen=props; return null; }} />);
    await seen.onGenerateCover("水彩", "蓝色纸船");
    expect(generate).toHaveBeenLastCalledWith("水彩", "蓝色纸船");
    await seen.onGenerateCover("");
    expect(generate).toHaveBeenLastCalledWith("", "这一章自己的正文");
  });
  it("keeps received cover, background and illustration available in the image library", () => {
    const facts = { width: 1, height: 1, mime: "image/png" as const, bytes: 4, sha256: "a".repeat(64), aiGenerated: false };
    const received: Chapter = { ...chapter, blocks: { ...chapter.blocks, images: { cover: facts, background: facts, illustration: facts }, coverKey: "cover", bodyTextureKey: "background" } };
    const images = chapterImageAssets(received, { cover: "https://example.com/cover" });
    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({ imageUrl: "https://example.com/cover", label: "章节 · 封面 1" });
    expect(images[1].kind).toBe("body-texture");
    expect(images[2].kind).toBe("illustration");
    expect(new Set(images.map(image => image.id)).size).toBe(3);
    expect(chapterImageAssets(received, { cover: "https://example.com/refreshed" })[0].id).toBe(images[0].id);
  });
  it("resolves image URLs for rendering without mutating the persisted keys", () => {
    const layout = {
      version: 1 as const,
      pages: [
        {
          label: "页",
          modules: [
            {
              id: "i",
              kind: "image" as const,
              imageUrl: "chapters/9/a.png",
              rect: { x: 0, y: 0, width: 1, height: 1 },
              crop: { x: 0, y: 0, width: 1, height: 1 },
            },
          ],
        },
      ],
    };
    const rendered = mapChapterImages(layout, {
      "chapters/9/a.png": "https://example.com/signed",
    });
    expect(rendered?.pages[0].modules[0]).toMatchObject({
      imageUrl: "https://example.com/signed",
    });
    expect(layout.pages[0].modules[0].imageUrl).toBe("chapters/9/a.png");
  });
});

it('shows actionable saved-version and returned-draft notices without hiding them in history', () => {
  deliveryState.enabled = true;
  deliveryState.externalVersion = 5;
  deliveryState.inbox = [{deliveryId:'delivery',kind:'return',status:'pending'}];
  deliveryState.candidates = [{id:1,status:'pending',senderName:'Jane'}];
  try {
    const html = renderToStaticMarkup(<ChapterWorkspace scope="platform:v1" storyId={1} versionId="v1" hasAlbum={false} title="故事" body="" assets={[]} adoptedCoverId={null} coverBusy={false} mode="text" render={()=>null}/>);
    expect(html).toContain('查看并接收');
    expect(html).toContain('Jane');
    expect(html).toContain('查看更新');
    expect(html).toContain('包含别人发回的修改');
    expect(html).toContain('查看来稿');
    for (const options of [deliveryState.inboxOptions, deliveryState.candidateOptions]) {
      expect(options.refetchInterval).toBe(15000);
      expect(options.refetchOnWindowFocus).toBe('always');
    }
  } finally { deliveryState.externalVersion=null; deliveryState.inbox=[]; deliveryState.candidates=[]; }
});
