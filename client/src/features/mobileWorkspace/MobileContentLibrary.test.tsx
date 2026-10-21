import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { MobileContentLibrary } from "./MobileContentLibrary";
vi.stubGlobal("React", React);
const api = vi.hoisted(() => ({
  memories: vi.fn(),
  space: vi.fn(),
  text: vi.fn(),
  body: vi.fn(),
  videos: vi.fn(),
  images: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ memorySpace: { list: { invalidate: vi.fn() } } }),
    memorySpace: { list: { useQuery: api.space }, change: { useMutation: () => ({ isPending: false }) } },
    memoryWarehouse: { list: { useQuery: api.memories } },
    textDrafts: { read: { useQuery: api.text } },
    publishingDraft: { readBody: { useQuery: api.body } },
    storyAgent: { accountImages: { useQuery: api.images }, storyVideoAssets: { useQuery: api.videos } },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  api.space.mockReturnValue({ data: { revision: 0, shelves: [], books: [{ id: 1, title: "书架里的故事", hasText: true, updatedAt: null }], people: [], relationships: [] } });
  api.memories.mockReturnValue({
    data: {
      cards: [{ id: "m1", title: "独立回忆", content: "回忆原文" }],
      nextOffset: null,
    },
  });
  api.text.mockReturnValue({
    data: {
      versions: [
        {
          id: "v1",
          sequence: 1,
          generated: { title: "旧稿", body: "版本正文" },
        },
      ],
    },
  });
  api.body.mockReturnValue({ data: { body: "当前正文内容" } });
  api.videos.mockReturnValue({
    data: [
      { id: 1, subtitle: "片段", status: "available", videoUrl: "/clip.mp4" },
    ],
  });
});
const stories = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  title: `故事${i + 1}`,
}));
function render(stage: "memory" | "people" | "warehouse" | "text" | "image" | "video") {
  return renderToStaticMarkup(
    <MobileContentLibrary
      stage={stage}
      stories={stories}
      onBack={() => {}}
      onOpenStory={() => {}}
    />
  );
}
it("opens the account bookshelf and retains the notes tool without fetching other media", () => {
  const html = render("memory");
  expect(html).toContain("书架里的故事");
  expect(html).toContain("记事工具");
  expect(html).not.toContain("整理书架");
  expect(html).toContain("长按拖动换位置");
  expect(api.space).toHaveBeenCalled();
  expect(api.memories).not.toHaveBeenCalled();
  expect(api.text).not.toHaveBeenCalled();
  expect(api.videos).not.toHaveBeenCalled();
});
it("shows both authoritative body and historical text with bounded story pagination", () => {
  const html = render("text");
  expect(html).toContain("版本正文");
  expect(html).toContain("当前正文内容");
  expect(api.text).toHaveBeenCalledTimes(5);
  expect(api.body.mock.calls.map(c => c[0].storyId)).toEqual([1, 2, 3, 4, 5]);
  expect(html).toContain("下一页");
  expect(api.videos).not.toHaveBeenCalled();
});
it("does not treat an absent publishing body as a network failure", () => {
  api.body.mockReturnValue({
    isError: true,
    error: {
      data: { code: "BAD_REQUEST" },
      message: "当前发布版本还没有可编辑正文，请先在电脑端生成发布稿",
    },
  });
  expect(render("text")).not.toContain('role="alert"');
  api.body.mockReturnValue({
    isError: true,
    error: { data: { code: "UNAUTHORIZED" }, message: "登录过期" },
  });
  expect(render("text")).toContain('role="alert"');
});
it("renders playable video without preloading and only queries video", () => {
  const html = render("video");
  expect(html).toContain('preload="none"');
  expect(html).toContain("/clip.mp4");
  expect(api.body).not.toHaveBeenCalled();
  expect(api.memories).not.toHaveBeenCalled();
});

it("reads the account image cursor without restricting to the supplied stories", () => {
  api.images.mockReturnValue({ data: { items: [{ id: 200, storyId: 99, storyTitle: "更早的故事", imageUrl: "/image.webp" }], nextCursor: 200 } });
  const html = render("image");
  expect(api.images).toHaveBeenCalledWith({ before: undefined }, { retry: false });
  expect(html).toContain("更早的故事");
  expect(html).toContain("放大图片 200");
  expect(html).toContain("下一页");
  expect(api.text).not.toHaveBeenCalled();
  expect(api.videos).not.toHaveBeenCalled();
});
it("distinguishes an empty image library from a failed read", () => {
  api.images.mockReturnValue({ data: { items: [], nextCursor: null } });
  expect(render("image")).toContain("图片，从一个故事开始");
  api.images.mockReturnValue({ isError: true });
  expect(render("image")).toContain("重试");
  expect(render("image")).not.toContain("图片，从一个故事开始");
});

it("opens people directly without displaying the bookshelf", () => {
  const html = render("people");
  expect(html).toContain("还没有人物");
  expect(html).not.toContain("书架里的故事");
  expect(api.text).not.toHaveBeenCalled();
});
it("groups text, images and videos in the warehouse and initially reads only text", () => {
  const html = render("warehouse");
  expect(html).toContain('aria-label="仓库分类"');
  expect(html).toContain("图片");
  expect(html).toContain("视频");
  expect(html).toContain("当前正文内容");
  expect(api.images).not.toHaveBeenCalled();
  expect(api.videos).not.toHaveBeenCalled();
});
