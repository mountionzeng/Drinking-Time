import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChapterWorkspace, mapChapterImages } from "./ChapterWorkspace";
import type { Chapter } from "./useChapters";
vi.stubGlobal("React", React);
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
      ].map(name => [
        name,
        {
          useMutation: () => ({ mutateAsync: vi.fn() }),
          useQuery: () => ({
            data: name === "versions" ? [] : { candidates: [] },
            refetch: vi.fn(),
          }),
        },
      ])
    ),
    useUtils: () => ({ chapters: { get: { fetch: vi.fn() } } }),
  },
}));
vi.mock("./ChapterComparison", () => ({ ChapterComparison: () => null }));
describe("chapter workspace", () => {
  it("renders chapter actions and supplies chapter two's text and isolated cache to the existing editor", () => {
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
          return <p>{props.body}</p>;
        }}
      />
    );
    expect(html).toContain("新增章节");
    expect(html).toContain("打包这一章");
    expect(html).toContain("导入章节包");
    expect(html).toContain("这一章自己的正文");
    expect(html).not.toContain("不能写进第二章");
    expect(seen.scope).toBe("chapter:9:1:2:v4:0");
    expect(seen.adoptedCoverId).toBeNull();
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
