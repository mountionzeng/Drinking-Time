import { beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as runtime from "../repositories/runtime";
import {
  createWechatBookImportService,
  importRequestId,
  wechatBookContent,
} from "./wechatBookImport";
import { listChapters } from "../repositories/chapters";
import { createStory } from "../repositories/stories";
import { chaptersRouter } from "../routers/chapters";
import { wechatBookImportRouter } from "../routers/wechatBookImport";
import {
  wechatImportSubject,
  ownsWechatImportImage,
} from "../repositories/wechatBookImport";
import type { TrpcContext } from "../_core/context";
import type { WechatBookSnapshot } from "../../shared/wechatBookImport";
import {
  validWritingStyle,
  writingModuleTexts,
} from "../../shared/bookWritingStyle";
import { readBookImage } from "../../shared/bookImageBlock";
import {
  blockAncestors,
  restoreWritingBlocks,
} from "../../client/src/features/publishingAlbum/chapterBlockTree";

const subject = "shiguang:" + "a".repeat(64);
const ref = { storyId: "story-demo", revisionId: "revision-one", version: 1 };
const book: WechatBookSnapshot = {
  ...ref,
  title: "虚构验收：河边的书",
  updatedAt: "2026-11-02T00:00:00.000Z",
  containsAiText: false,
  cover: null,
  editorName: "虚构作者",
  changeSummary: "作者自填说明",
  warnings: [],
  chapters: [
    {
      id: "chapter-one",
      title: "河岸",
      content: [
        { id: "a", text: "第一行\n\n第三行", sourceIds: [] },
        {
          id: "b",
          photo: { ref: "photo-demo", available: true },
          sourceIds: [],
        },
      ],
    },
    { id: "chapter-empty", title: "空章", content: [] },
    {
      id: "chapter-last",
      title: "归家",
      content: [{ id: "c", text: "最后一段", sourceIds: [] }],
    },
  ],
};
const ctx = (id: number | null) =>
  ({
    user: id ? { id, name: "网页编辑者" } : null,
    req: {},
    res: { setHeader: vi.fn() },
  }) as unknown as TrpcContext;
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "true");
  vi.stubEnv("WECHAT_BOOK_IMPORT_ENABLED", "true");
  vi.stubEnv(
    "CHAPTER_MEDIA_DIR",
    path.join(path.dirname(process.env.LOCAL_PERSIST_PATH!), "media")
  );
  runtime.resetMemoryStateForTesting();
});
async function service(snapshot = book) {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#e7d9bd" },
  })
    .png()
    .toBuffer();
  const request = vi.fn(
    async (owner: string, input: Record<string, unknown>) => {
      if (owner !== subject) throw new Error("story_access_revoked");
      if (input.operation === "list")
        return {
          stories: [
            { ...ref, title: snapshot.title, updatedAt: snapshot.updatedAt },
          ],
          nextCursor: null,
        };
      if (input.operation === "media")
        return { base64: bytes.toString("base64") };
      return structuredClone(snapshot);
    }
  );
  return {
    request,
    api: createWechatBookImportService({
      subject: async id => (id === 10 ? subject : null),
      request,
    }),
  };
}
it("lists only metadata and creates nothing before explicit selection", async () => {
  const { api, request } = await service();
  expect((await api.catalog(10)).stories[0].importedStoryId).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].operation).toBe("list");
  expect(runtime.memoryState.stories).toHaveLength(0);
  await expect(api.importBook(20, ref)).rejects.toThrow("请先使用微信登录");
});
it("concurrent retries atomically create one book; saves and later source versions never overwrite it", async () => {
  const { api } = await service();
  await createStory({
    userId: 10,
    title: "原有网页故事",
    body: { original: true },
  });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => api.importBook(10, ref))
  );
  expect(new Set(results.map(r => r.storyId)).size).toBe(1);
  expect(results.filter(r => !r.repeated)).toHaveLength(1);
  expect(importRequestId(subject, ref)).toHaveLength(64);
  const id = results[0].storyId,
    [chapter] = await listChapters(id, 10);
  expect(await listChapters(id, 20)).toHaveLength(0);
  expect(chapter.blocks.wechatImport?.changeSummary).toBe("作者自填说明");
  expect(chapter.blocks.attribution?.changeNote).toBeUndefined();
  expect(chapter.blocks.writingStyle?.map(s => s.format)).toEqual([
    "heading1",
    "text",
    "text",
    "heading1",
    "heading1",
    "text",
  ]);
  const imageKey = Object.keys(chapter.blocks.images)[0];
  expect(await ownsWechatImportImage(10, imageKey)).toBe(true);
  expect(await ownsWechatImportImage(20, imageKey)).toBe(false);
  const text = writingModuleTexts(
    chapter.blocks.body,
    chapter.blocks.writingStyle
  );
  expect(text[1]).toBe("第一行\n\n第三行");
  expect(readBookImage(text[2])?.url).toMatch(
    /^\/api\/wechat-import\/media\/[a-f0-9]{64}\.png$/
  );
  const restored = restoreWritingBlocks(chapter.blocks.body, {
    body: chapter.blocks.body,
    blocks: chapter.blocks.writingStyle?.map((s, i) => ({
      ...s,
      text: text[i],
    })),
  });
  expect(blockAncestors(restored, restored[2].id)).toEqual([restored[0].id]);
  expect(blockAncestors(restored, restored[5].id)).toEqual([restored[4].id]);
  const caller = chaptersRouter.createCaller(ctx(10));
  await caller.save({
    chapterId: chapter.id,
    expectedVersion: chapter.version,
    body: chapter.blocks.body + "\n网页新写的草稿",
  });
  expect((await api.importBook(10, ref)).repeated).toBe(true);
  expect((await listChapters(id, 10))[0].blocks.body).toContain(
    "网页新写的草稿"
  );
  expect((await listChapters(id, 10))[0].blocks.wechatImport?.revisionId).toBe(
    ref.revisionId
  );
  const changed = { ...book, revisionId: "revision-two", version: 2 };
  const next = await service(changed);
  expect((await next.api.importBook(10, changed)).storyId).not.toBe(id);
  expect(runtime.memoryState.stories[0].body).toEqual({ original: true });
  const persisted = JSON.parse(
    await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
  );
  expect(JSON.stringify(persisted)).toContain("网页新写的草稿");
});
it("media failure or revision change creates no partial story; retry can finish", async () => {
  const { api, request } = await service();
  request.mockImplementation(async (_owner, input) => {
    if (input.operation === "media") throw new Error("network");
    return book;
  });
  await expect(api.importBook(10, ref)).rejects.toThrow("network");
  expect(runtime.memoryState.stories).toHaveLength(0);
  const next = await service();
  let reads = 0;
  const original = next.request.getMockImplementation()!;
  next.request.mockImplementation(async (owner, input) =>
    input.operation === "read" && ++reads === 2
      ? { ...book, version: 2 }
      : original(owner, input)
  );
  await expect(next.api.importBook(10, ref)).rejects.toThrow(
    "story_version_conflict"
  );
  expect(runtime.memoryState.stories).toHaveLength(0);
  expect((await (await service()).api.importBook(10, ref)).repeated).toBe(
    false
  );
});
it("handles missing photos, empty/untitled chapters and no chapters without losing ordering", () => {
  const missing = {
    ...book,
    chapters: [
      { id: "empty", title: "", content: [] },
      {
        id: "photo",
        title: "图片",
        content: [
          {
            id: "p",
            sourceIds: [],
            photo: { ref: "photo-local", available: false },
          },
        ],
      },
    ],
  };
  const content = wechatBookContent(missing, new Map());
  expect(content.blocks.body).toBe(
    "未命名章 1\n图片\n〔这张图片未能导入，请在微信原稿查看〕"
  );
  expect(
    validWritingStyle(content.blocks.body, content.blocks.writingStyle!)
  ).toBe(true);
  expect(
    wechatBookContent({ ...book, chapters: [] }, new Map()).blocks.body
  ).toBe("");
});
it("resolves only verified identity records, never user names or request identities", async () => {
  expect(await wechatImportSubject(10)).toBeNull();
  runtime.memoryState.accountIdentities.push({
    id: 1,
    userId: 10,
    provider: "wechat",
    subject,
    verifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  expect(await wechatImportSubject(10)).toBe(subject);
  expect(await wechatImportSubject(20)).toBeNull();
  await expect(
    wechatBookImportRouter.createCaller(ctx(null)).list({ cursor: 0 })
  ).rejects.toThrow();
  await expect(
    wechatBookImportRouter
      .createCaller(ctx(10))
      .import({ ...ref, userId: 20 } as never)
  ).rejects.toThrow();
  vi.stubEnv("WECHAT_BOOK_IMPORT_ENABLED", "false");
  await expect(
    wechatBookImportRouter.createCaller(ctx(10)).list({ cursor: 0 })
  ).rejects.toThrow("尚未开放");
});

it("loads import markers once for a full catalog page without per-story reads", async () => {
  const stories = Array.from({ length: 50 }, (_, index) => ({
    ...ref, storyId: `story-${index}`, title: `故事${index}`, updatedAt: book.updatedAt,
  }));
  const requestIds = stories.map(story => importRequestId(subject, story));
  const receipts = vi.fn(async () => new Map([[requestIds[0], 123]]));
  const receipt = vi.fn(async () => null);
  const api = createWechatBookImportService({
    subject: async () => subject,
    request: async () => ({ stories, nextCursor: 50 }),
    receipts,
    receipt,
  });
  const result = await api.catalog(10);
  expect(receipts).toHaveBeenCalledTimes(1);
  expect(receipts).toHaveBeenCalledWith(10, requestIds);
  expect(receipt).not.toHaveBeenCalled();
  expect(result.nextCursor).toBe(50);
  expect(result.stories).toEqual(stories.map((story, index) => ({
    ...story, importedStoryId: index === 0 ? 123 : null,
  })));
});
