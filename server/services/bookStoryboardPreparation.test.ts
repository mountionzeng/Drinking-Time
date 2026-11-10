import { beforeEach, expect, it, vi } from "vitest";
import type { StoredChapterBlocks } from "../../shared/chapterStore";
import { writingModuleTexts } from "../../shared/bookWritingStyle";
const mocks = vi.hoisted(() => ({
  story: vi.fn(),
  chapters: vi.fn(),
  save: vi.fn(),
  compute: vi.fn(),
  images: vi.fn(),
}));
vi.mock("../repositories/stories", () => ({ getStoryById: mocks.story }));
vi.mock("../repositories/chapters", () => ({ listChapters: mocks.chapters }));
vi.mock("../repositories/bookStoryboard", () => ({
  saveBookStoryboard: mocks.save,
}));
vi.mock("./publishingVideoStoryboard", () => ({
  runPublishingVideoStoryboardTextCompute: mocks.compute,
}));
vi.mock("./imageAssets", () => ({ getStoryImageAssets: mocks.images }));
import {
  applyStoryboardPlan,
  prepareBookStoryboard,
  storyboardSourceUnits,
} from "./bookStoryboardPreparation";
const blocks = (body: string): StoredChapterBlocks => ({
  body,
  blockIds: body
    .split("\n")
    .filter(Boolean)
    .map((_, i) => `line-${i}`),
  containsAiText: false,
  settings: null,
  coverKey: null,
  bodyTextureKey: null,
  images: {},
  illustrations: [],
});
const plan = {
  scenes: [
    {
      title: "相遇",
      shots: [
        { title: "雨中开伞", units: [0, 1, 2] },
        { title: "道别", units: [3, 4] },
      ],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.story.mockResolvedValue({ id: 4 });
  mocks.images.mockResolvedValue([]);
  mocks.save.mockResolvedValue([{ id: 1, version: 2 }]);
});
it("preserves every source text/media, stable ID, dialogue role, layout and import metadata", () => {
  const source = blocks(
    "小雨：你好\n![图片](/api/images/a.png)\n![图片](/api/images/b.png)\n轻轻关门\n"
  );
  source.writingStyle = writingModuleTexts(source.body).map((_, i) => ({
    id: `m${i}`,
    format: "text",
    parentId: null,
    collapsed: false,
    ...(i === 0 ? { videoRole: "dialogue" as const } : {}),
  }));
  const result = applyStoryboardPlan(1, source, plan),
    texts = writingModuleTexts(result.body, result.writingStyle);
  expect(
    result.writingStyle
      ?.filter(r => r.id.startsWith("m"))
      .map(r => texts[result.writingStyle!.indexOf(r)])
  ).toEqual(writingModuleTexts(source.body));
  expect(result.writingStyle?.find(r => r.id === "m0")?.videoRole).toBe(
    "dialogue"
  );
  expect(result.blockIds.filter(id => id.startsWith("line"))).toEqual(
    source.blockIds
  );
  expect(result.images).toBe(source.images);
  expect(result.settings).toBe(source.settings);
  expect(result.writingStyle?.filter(r => r.format === 'scene').every(r => !r.collapsed)).toBe(true);
  expect(result.writingStyle?.filter(r => r.format === 'shot').every(r => r.collapsed)).toBe(true);
});
it("treats an existing subtree and paired columns as indivisible units", () => {
  const source = blocks("章\n正文\n左图\n右图");
  source.writingStyle = [
    { id: "a", format: "heading1", parentId: null, collapsed: true },
    { id: "b", format: "text", parentId: "a", collapsed: false },
    {
      id: "c",
      format: "text",
      parentId: null,
      collapsed: false,
      columnGroup: "pair",
    },
    {
      id: "d",
      format: "text",
      parentId: null,
      collapsed: false,
      columnGroup: "pair",
    },
  ];
  expect(
    storyboardSourceUnits(1, source).map(u => u.rows.map(r => r.id))
  ).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
});
it.each([
  [0, 2],
  [0, 1, 1, 2],
  [2, 1, 0],
])("rejects missing, repeated, or reordered coverage %j", (...units) => {
  expect(() =>
    applyStoryboardPlan(1, blocks("a\nb\nc"), {
      scenes: [
        { title: "场", shots: [{ title: "镜", units: units as number[] }] },
      ],
    })
  ).toThrow("完整保留");
});
it("handles a different story through the same service and saves all chapters only after validation", async () => {
  mocks.chapters.mockResolvedValue([
    { id: 10, version: 4, title: "修伞", blocks: blocks("撑开旧伞\n递给旅人") },
    { id: 11, version: 8, title: "回家", blocks: blocks("收起伞\n回到家") },
  ]);
  mocks.compute.mockResolvedValue({
    parsed: {
      scenes: [{ title: "场", shots: [{ title: "镜", units: [0, 1] }] }],
    },
  });
  await prepareBookStoryboard({
    storyId: 88,
    userId: 2,
    request: "两场生活短片",
  });
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      storyId: 88,
      userId: 2,
      expected: [
        { id: 10, version: 4 },
        { id: 11, version: 8 },
      ],
      updates: expect.arrayContaining([
        expect.objectContaining({ id: 10 }),
        expect.objectContaining({ id: 11 }),
      ]),
    })
  );
});
it("does not save the first chapter when the second model result loses a module", async () => {
  mocks.chapters.mockResolvedValue(
    [1, 2].map(id => ({
      id,
      version: 1,
      title: "章节",
      blocks: blocks("a\nb"),
    }))
  );
  mocks.compute
    .mockResolvedValueOnce({
      parsed: {
        scenes: [{ title: "场", shots: [{ title: "镜", units: [0, 1] }] }],
      },
    })
    .mockResolvedValueOnce({
      parsed: {
        scenes: [{ title: "场", shots: [{ title: "镜", units: [0] }] }],
      },
    });
  await expect(
    prepareBookStoryboard({ storyId: 1, userId: 2, request: "test" })
  ).rejects.toThrow("完整保留");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("reuses a prepared manuscript without model calls, duplication or writes", async () => {
  const source = applyStoryboardPlan(3, blocks("a\nb\nc\nd\ne"), plan);
  mocks.chapters.mockResolvedValue([{ id: 3, version: 9, blocks: source }]);
  expect(
    await prepareBookStoryboard({ storyId: 1, userId: 2, request: "继续" })
  ).toMatchObject({ changed: false, shotCount: 2 });
  expect(mocks.compute).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("checks ownership before reading or planning", async () => {
  mocks.story.mockResolvedValue(null);
  await expect(
    prepareBookStoryboard({ storyId: 1, userId: 2, request: "test" })
  ).rejects.toThrow("故事不存在");
  expect(mocks.chapters).not.toHaveBeenCalled();
});
it("rejects oversized manuscripts before spending text compute", async () => {
  mocks.chapters.mockResolvedValue([
    { id: 1, version: 1, blocks: blocks("文".repeat(100001)) },
  ]);
  await expect(
    prepareBookStoryboard({ storyId: 1, userId: 2, request: "整理" })
  ).rejects.toThrow("文字长度");
  expect(mocks.compute).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("classifies proposed dialogue only when the manuscript has no existing dialogue decisions", () => {
  const source = blocks("描述\n你好");
  source.writingStyle = [
    { id: "a", format: "text", parentId: null, collapsed: false },
    { id: "b", format: "text", parentId: null, collapsed: false },
  ];
  const proposed = {
    scenes: [
      {
        title: "场",
        shots: [{ title: "镜", units: [0, 1], dialogueModuleIds: ["b"] }],
      },
    ],
  };
  const prepared = applyStoryboardPlan(1, source, proposed);
  expect(prepared.writingStyle?.find(row => row.id === "b")?.videoRole).toBe(
    "dialogue"
  );
  source.writingStyle[0].videoRole = "dialogue";
  const preserved = applyStoryboardPlan(1, source, proposed);
  expect(preserved.writingStyle?.find(row => row.id === "a")?.videoRole).toBe(
    "dialogue"
  );
  expect(
    preserved.writingStyle?.find(row => row.id === "b")?.videoRole
  ).toBeUndefined();
});
it.each(["image", "unknown"])(
  "rejects a non-prose dialogue selection: %s",
  id => {
    const source = blocks("![图片](/api/images/a.png)");
    source.writingStyle = [
      { id: "image", format: "text", parentId: null, collapsed: false },
    ];
    expect(() =>
      applyStoryboardPlan(1, source, {
        scenes: [
          {
            title: "场",
            shots: [{ title: "镜", units: [0], dialogueModuleIds: [id] }],
          },
        ],
      })
    ).toThrow("非文字或未知模块");
  }
);
