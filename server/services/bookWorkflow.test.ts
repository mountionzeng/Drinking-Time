import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ManuscriptContent } from "../../shared/bookWorkflow";
const compute = vi.hoisted(() => vi.fn());
vi.mock("./publishingVideoStoryboard", () => ({
  runPublishingVideoStoryboardTextCompute: compute,
}));
const dir = await mkdtemp(path.join(os.tmpdir(), "book-workflow-"));
const previous = {
  path: process.env.LOCAL_PERSIST_PATH,
  db: process.env.DATABASE_URL,
};
process.env.LOCAL_PERSIST_PATH = path.join(dir, "state.json");
process.env.DATABASE_URL = "";
const { createStory, getStoryById } = await import("../repositories/stories");
const chapters = await import("../repositories/chapters");
const service = await import("./bookWorkflow");
afterAll(async () => {
  if (previous.path === undefined) delete process.env.LOCAL_PERSIST_PATH;
  else process.env.LOCAL_PERSIST_PATH = previous.path;
  if (previous.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.db;
  await rm(dir, { recursive: true, force: true });
});
const intent = { purpose: "介绍产品", audience: "朋友", platform: "朋友圈" };
const actor = { userId: 61, name: "测试作者" };
const source: ManuscriptContent = {
  title: "原文",
  layout: null,
  blocks: {
    body: "原文事实\n![图片](/api/images/original.png)",
    blockIds: ["a", "b"],
    containsAiText: false,
    settings: null,
    coverKey: null,
    bodyTextureKey: null,
    images: {},
    illustrations: [],
  },
};
const generated = {
  chapters: [
    {
      title: "产品分镜",
      modules: [
        { format: "scene", text: "使用现场", parent: null },
        { format: "shot", text: "产品近景", parent: 0 },
        {
          format: "text",
          text: "展示产品用途，与原文不同的画面描述",
          parent: 1,
        },
        { format: "text", text: "", parent: 1, media: 0 },
      ],
    },
  ],
};
beforeEach(() => {
  compute.mockReset();
  compute.mockResolvedValue({ parsed: generated });
});
async function fixture() {
  const story = await createStory({
    userId: 61,
    title: "版本测试",
    body: { _revision: 1, untouched: "保留" },
  });
  const owner = { storyId: story.id, userId: 61, actor };
  const chapter = await chapters.insertChapter({ ...owner, content: source });
  const status = await service.getBookWorkflow(owner);
  const version = await service.saveManuscriptVersion({
    ...owner,
    id: randomUUID(),
    kind: "text",
    intent,
    summary: "初稿",
    expectedFingerprint: status.drafts.text.fingerprint,
  });
  return { ...owner, chapter, version };
}
it("saves immutable independently numbered versions; ordinary edits only dirty the draft", async () => {
  const input = await fixture();
  await chapters.saveChapterContent({
    id: input.chapter.id,
    userId: 61,
    expectedVersion: 1,
    content: { blocks: { ...source.blocks, body: "修改后的事实" } },
    reason: "autosave",
  });
  const state = await service.getBookWorkflow(input);
  expect(state.state.versions).toHaveLength(1);
  expect(state.drafts.text.dirty).toBe(true);
  expect(state.state.versions[0].chapters[0].blocks.body).toBe(
    source.blocks.body
  );
  const request = {
    ...input,
    id: randomUUID(),
    kind: "text" as const,
    intent,
    summary: "更新文字",
    expectedFingerprint: state.drafts.text.fingerprint,
  };
  const next = await service.saveManuscriptVersion(request);
  expect(next.number).toBe(2);
  expect(next.parentId).toBe(input.version.id);
  expect(await service.saveManuscriptVersion(request)).toEqual(next);
  expect((await getStoryById(input.storyId, 61))?.body).toMatchObject({
    untouched: "保留",
  });
});
it("conversion is purpose-driven, preserves media, remains preview until explicitly adopted and is idempotent", async () => {
  const input = await fixture(),
    id = randomUUID();
  const request = {
    ...input,
    id,
    sourceId: input.version.id,
    target: "storyboard" as const,
    intent,
    request: "画面先展示产品的用途",
  };
  const draft = await service.proposeManuscriptConversion(request);
  expect(await service.proposeManuscriptConversion(request)).toEqual(draft);
  expect(compute).toHaveBeenCalledTimes(1);
  expect(compute.mock.calls[0][0].context.intent).toEqual(intent);
  expect(
    await chapters.listChapters(input.storyId, 61, "storyboard")
  ).toHaveLength(0);
  expect(draft.chapters?.[0].blocks.body).toContain("展示产品用途");
  const saved = await service.adoptManuscriptConversion({
    ...input,
    id,
    revision: draft.revision,
  });
  expect(saved.number).toBe(1);
  expect(saved.source?.id).toBe(input.version.id);
  expect(saved.author).toEqual(actor);
  expect(saved.confirmedBy).toEqual(actor);
  expect(
    (await chapters.listChapters(input.storyId, 61, "text"))[0].blocks.body
  ).toBe(source.blocks.body);
  expect(
    (await chapters.listChapters(input.storyId, 61, "storyboard"))[0].blocks
      .body
  ).toContain("/api/images/original.png");
  expect(
    await service.adoptManuscriptConversion({
      ...input,
      id,
      revision: draft.revision,
    })
  ).toEqual(saved);
  const status = await service.getBookWorkflow(input);
  const revised = await service.saveManuscriptVersion({
    ...input,
    id: randomUUID(),
    kind: "storyboard",
    intent,
    summary: "调整用途",
    expectedFingerprint: status.drafts.storyboard.fingerprint,
  });
  expect(revised.source).toEqual(saved.source);
  const restored = await service.restoreManuscriptVersion({
    ...input,
    id: randomUUID(),
    versionId: revised.id,
    expectedFingerprint: status.drafts.storyboard.fingerprint,
  });
  const { textManuscriptSource } = await import("../../shared/bookWorkflow");
  expect(
    textManuscriptSource((await service.getBookWorkflow(input)).state, restored)
      ?.id
  ).toBe(input.version.id);
});
it("rejects source changes and wrong owners without altering either manuscript", async () => {
  const input = await fixture();
  const draft = await service.proposeManuscriptConversion({
    ...input,
    id: randomUUID(),
    sourceId: input.version.id,
    target: "storyboard",
    intent,
    request: "",
  });
  await chapters.saveChapterContent({
    id: input.chapter.id,
    userId: 61,
    expectedVersion: 1,
    content: { title: "刚修改" },
    reason: "autosave",
  });
  await expect(
    service.adoptManuscriptConversion({
      ...input,
      id: draft.id,
      revision: draft.revision,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.getBookWorkflow({ ...input, userId: 99 })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service.adoptManuscriptConversion({
      ...input,
      userId: 99,
      id: draft.id,
      revision: draft.revision,
    })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await chapters.listChapters(input.storyId, 61, "storyboard")
  ).toHaveLength(0);
});
it("reverse conversion creates narrative chapters rather than copying shot descriptions and restores as a new version", async () => {
  const input = await fixture();
  const draft = await service.proposeManuscriptConversion({
    ...input,
    id: randomUUID(),
    sourceId: input.version.id,
    target: "storyboard",
    intent,
    request: "",
  });
  const board = await service.adoptManuscriptConversion({
    ...input,
    id: draft.id,
    revision: draft.revision,
  });
  compute.mockResolvedValue({
    parsed: {
      chapters: [
        {
          title: "朋友圈文字",
          modules: [
            { format: "heading1", text: "我和产品的故事", parent: null },
            { format: "text", text: "适合朋友圈的叙事新文字。", parent: 0 },
            { format: "text", text: "", parent: 0, media: 0 },
          ],
        },
      ],
    },
  });
  const reverse = await service.proposeManuscriptConversion({
    ...input,
    id: randomUUID(),
    sourceId: board.id,
    target: "text",
    intent,
    request: "像给朋友讲故事",
  });
  const text = await service.adoptManuscriptConversion({
    ...input,
    id: reverse.id,
    revision: reverse.revision,
  });
  expect(text.number).toBe(2);
  expect(text.chapters[0].blocks.body).toContain("叙事新文字");
  const state = await service.getBookWorkflow(input);
  const restored = await service.restoreManuscriptVersion({
    ...input,
    id: randomUUID(),
    versionId: input.version.id,
    expectedFingerprint: state.drafts.text.fingerprint,
  });
  expect(restored.number).toBe(3);
  expect(restored.chapters[0].blocks.body).toBe(source.blocks.body);
  expect((await service.getBookWorkflow(input)).state.versions).toHaveLength(4);
});
it("refuses stale preview edits, prevents media replacement and rejects omitted media", async () => {
  const input = await fixture(),
    draft = await service.proposeManuscriptConversion({
      ...input,
      id: randomUUID(),
      sourceId: input.version.id,
      target: "storyboard",
      intent,
      request: "",
    });
  const texts = [
    ["使用现场", "产品近景", "改写描述", "![图片](/api/images/original.png)"],
  ];
  await service.editConversionDraft({
    ...input,
    id: draft.id,
    revision: draft.revision,
    texts,
  });
  await expect(
    service.editConversionDraft({
      ...input,
      id: draft.id,
      revision: draft.revision,
      texts,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.editConversionDraft({
      ...input,
      id: draft.id,
      revision: draft.revision + 1,
      texts: [[...texts[0].slice(0, 3), "图片已删除"]],
    })
  ).rejects.toThrow("素材");
  expect(() =>
    service.applyConversion([source], "storyboard", {
      chapters: [
        {
          ...generated.chapters[0],
          modules: generated.chapters[0].modules.slice(0, 3),
        },
      ],
    })
  ).toThrow("遗漏");
});
it("rejects stale draft saves after restore while retaining chapter identity and history", async () => {
  const input = await fixture();
  const state = await service.getBookWorkflow(input);
  await service.restoreManuscriptVersion({
    ...input,
    id: randomUUID(),
    versionId: input.version.id,
    expectedFingerprint: state.drafts.text.fingerprint,
  });
  const old = await chapters.getChapter(input.chapter.id, 61);
  await expect(
    chapters.saveChapterContent({
      id: input.chapter.id,
      userId: 61,
      expectedVersion: input.chapter.version,
      content: { title: "过时写入" },
      reason: "autosave",
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(old?.id).toBe(input.chapter.id);
  expect(
    (await chapters.listChapters(input.storyId, 61, "text"))[0].title
  ).toBe(source.title);
});
it("provider failure remains visible and preserves both drafts", async () => {
  const input = await fixture();
  compute.mockRejectedValue(new Error("provider failure"));
  await expect(
    service.proposeManuscriptConversion({
      ...input,
      id: randomUUID(),
      sourceId: input.version.id,
      target: "storyboard",
      intent,
      request: "",
    })
  ).rejects.toThrow();
  expect(
    (await service.getBookWorkflow(input)).state.conversions[0].status
  ).toBe("failed");
  expect((await chapters.listChapters(input.storyId, 61))[0].blocks.body).toBe(
    source.blocks.body
  );
});
