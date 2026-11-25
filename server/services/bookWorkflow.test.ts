import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { ManuscriptContent } from "../../shared/bookWorkflow";
const compute = vi.hoisted(() => vi.fn());
const quote = vi.hoisted(() => vi.fn());
vi.mock("./publishingVideoStoryboard", () => ({
  runPublishingVideoStoryboardTextCompute: compute,
  quoteStoryboardCompute: quote,
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
it("asks for material before quoting an empty story with only a video command", async () => {
  const story = await createStory({ userId: actor.userId, title: "新故事", body: {} });
  const request = "把这个故事做成视频";
  const input = { storyId: story.id, userId: actor.userId, request, conversation: [{ role: "user" as const, content: request }] };
  await expect(service.quoteFilmManuscript(input)).rejects.toThrow("告诉我想拍什么");
  expect(compute).not.toHaveBeenCalled();
  expect(await chapters.listChapters(story.id, actor.userId, "all")).toHaveLength(0);
});
it("quotes a chat-only story without saving or spending, then edits and adopts the same draft", async () => {
  const story = await createStory({ userId: actor.userId, title: "雨", body: {} });
  const input = { storyId: story.id, userId: actor.userId, actor, id: randomUUID(), request: "把这个故事做成视频",
    conversation: [{ role: "user" as const, content: "爸爸把伞挪到我这边。" }] };
  quote.mockReturnValue({ fingerprint: "quoted", estimatedCny: 0.01 });
  await expect(service.quoteFilmManuscript(input)).resolves.toMatchObject({ fingerprint: "quoted" });
  await expect(service.generateFilmManuscript({ ...input, quoteFingerprint: "old" })).rejects.toThrow("报价已变化");
  expect(compute).not.toHaveBeenCalled();
  expect(await chapters.listChapters(story.id, actor.userId, "all")).toHaveLength(0);
  compute.mockResolvedValueOnce({ parsed: { chapters: [{ title: "两把伞", modules: [
    { format: "shot", text: "挪伞", parent: null }, { format: "text", text: "我看见了。", parent: 0, dialogue: true },
  ] }] } });
  const candidate = await service.generateFilmManuscript({ ...input, quoteFingerprint: "quoted" });
  expect(candidate.status).toBe("review");
  expect(compute.mock.calls[0][0].context).toEqual(quote.mock.calls.at(-1)![0].context);
  expect(await chapters.listChapters(story.id, actor.userId, "storyboard")).toHaveLength(0);
  expect((await chapters.listChapters(story.id, actor.userId, "text"))[0].blocks.body).toBe("爸爸把伞挪到我这边。");
  expect((await service.generateFilmManuscript(input)).id).toBe(candidate.id);
  expect(compute).toHaveBeenCalledOnce();
  const edited = await service.editConversionDraft({ ...input, revision: candidate.revision, texts: [["挪伞", "爸，我看见啦。"]] });
  await expect(service.adoptManuscriptConversion({ ...input, revision: candidate.revision })).rejects.toThrow();
  await service.adoptManuscriptConversion({ ...input, revision: edited.revision });
  const [chapter] = await chapters.listChapters(story.id, actor.userId, "storyboard");
  expect(chapter.blocks.body).toBe("挪伞\n爸，我看见啦。");
  expect(chapter.blocks.writingStyle?.[1]).toMatchObject({ videoRole: "dialogue", parentId: chapter.blocks.writingStyle?.[0].id });
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
it("accepts a media reference without redundant text while retaining the original image", () => {
  const modules = generated.chapters[0].modules.map(module => ({ ...module }));
  const { text: _unused, ...mediaReference } = modules[3];
  modules[3] = mediaReference as typeof modules[number];
  const result = service.applyConversion([source], "storyboard", {
    chapters: [{ ...generated.chapters[0], modules }],
  });
  expect(result[0].blocks.body).toContain("![图片](/api/images/original.png)");
  expect(source.blocks.body).toBe("原文事实\n![图片](/api/images/original.png)");
});

it("replays the latest sanitized production response and retains the original media", () => {
  const response = JSON.parse('{"chapters":[{"title":"测试章节","modules":[{"format":"text","parent":null,"media":"0","text":"虚构画面"},{"format":"scene","parent":null,"text":"虚构画面"},{"format":"shot","parent":1,"text":"虚构画面"},{"format":"shot","parent":1,"text":"虚构画面"},{"format":"shot","parent":1,"text":"虚构画面"},{"format":"scene","parent":null,"text":"虚构画面"},{"format":"shot","parent":3,"text":"虚构画面"},{"format":"scene","parent":null,"text":"虚构画面"},{"format":"shot","parent":5,"text":"虚构画面"},{"format":"scene","parent":null,"text":"虚构画面"},{"format":"shot","parent":7,"text":"虚构画面"},{"format":"shot","parent":7,"text":"虚构画面"}]}]}');
  const [result] = service.applyConversion([source], "storyboard", response);
  expect(result.blocks.body).toContain("![图片](/api/images/original.png)");
  expect(result.blocks.writingStyle?.some(row => row.format === "shot")).toBe(true);
});

it("preserves an original image listed before the first scene with a numeric-string index", () => {
  const modules = [
    { format: "text", text: "", parent: null, media: "0" },
    { format: "scene", text: "雨后的清晨", parent: null },
    { format: "shot", text: "窗边近景", parent: 1 },
  ];
  const [result] = service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules }] });
  const rows = result.blocks.body.split("\n");
  expect(rows.filter(x => x === "![图片](/api/images/original.png)")).toHaveLength(1);
  expect(rows).toContain("窗边近景");
  const style = result.blocks.writingStyle!;
  expect(style.filter(row => row.format === "scene")).toHaveLength(0);
  expect(rows).toContain("雨后的清晨");
  expect(style[0]).toMatchObject({ format: "shot", parentId: null });
  expect(style[2]).toMatchObject({ format: "shot", parentId: null });
  expect(style.at(-1)).toMatchObject({ format: "text", parentId: style[2].id });
  for (const row of style) {
    const parent = style.find(candidate => candidate.id === row.parentId);
    if (row.format === "scene") expect(row.parentId).toBeNull();
    if (row.format === "text") expect(parent?.format).toBe("shot");
  }
});

it("starts an independent shot after a scene and keeps its dialogue with it", () => {
  const modules = [
    { format: "scene", text: "清晨", parent: null },
    { format: "shot", text: "窗边", parent: 0, media: 0 },
    { format: "shot", text: "片尾", parent: null },
    { format: "text", text: "明天再见。", parent: 2, dialogue: true },
  ];
  const [draft] = service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules }] });
  const style = draft.blocks.writingStyle!;
  expect(style.at(-2)).toMatchObject({ format: "shot", parentId: null });
  expect(style.at(-1)).toMatchObject({ videoRole: "dialogue", parentId: style.at(-2)!.id });
});

it("rejects ambiguous, malformed or out-of-range string media indexes", () => {
  for (const media of ["01", "0.0", "-1", "9", "https://example.com/image"]) {
    const modules = [ { format: "scene", text: "场景", parent: null },
      { format: "shot", text: "镜头", parent: 0 }, { format: "text", text: "", parent: 1, media } ];
    expect(() => service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules }] })).toThrow();
  }
});

it("preserves an original image attached by the model to a shot", () => {
  const modules = [
    { format: "scene", text: "第一场", parent: null },
    { format: "shot", text: "镜头画面", parent: 0, media: 0 },
    { format: "text", text: "旁白内容", parent: 1, dialogue: true },
  ];
  const [result] = service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules }] });
  const rows = result.blocks.body.split("\n");
  expect(rows).toContain("镜头画面");
  expect(rows).toContain("旁白内容");
  expect(rows.filter(x => x === "![图片](/api/images/original.png)")).toHaveLength(1);
  const style = result.blocks.writingStyle!;
  const shot = style.find(x => x.format === "shot")!;
  expect(style.filter(x => x.parentId === shot.id && x.format === "text")).toHaveLength(2);
});

it("rejects an invalid or duplicated image attached to a shot", () => {
  const modules = [
    { format: "scene", text: "第一场", parent: null },
    { format: "shot", text: "镜头", parent: 0, media: 9 },
  ];
  expect(() => service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules }] })).toThrow("素材");
  const duplicated = [modules[0], { ...modules[1], media: 0 }, { format: "text", text: "", parent: 1, media: 0 }];
  expect(() => service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules: duplicated }] })).toThrow("素材");
});

it("repairs invalid storyboard parent indexes within each scene without changing content or media", () => {
  const modules = [
    { format: "scene", text: "第一场", parent: null },
    { format: "shot", text: "镜头一", parent: 0 },
    { format: "text", text: "旁白一", parent: 1 },
    { format: "shot", text: "镜头二", parent: 0 },
    { format: "text", text: "旁白二", parent: 2, dialogue: true },
    { format: "scene", text: "第二场", parent: null },
    { format: "shot", text: "镜头三", parent: 4 },
    { format: "text", text: "旁白三", parent: 5 },
    { format: "scene", text: "第三场", parent: null },
    { format: "text", parent: 7, media: 0 },
    { format: "text", text: "结尾旁白", parent: 7, dialogue: true },
  ];
  const [result] = service.applyConversion([source], "storyboard", { chapters: [{ title: "分镜", modules }] }, true);
  expect(result.blocks.storyboardScenes).toBe(true);
  const style = result.blocks.writingStyle!;
  const rows = result.blocks.body.split("\n");
  expect(rows.filter(x => x === "![图片](/api/images/original.png)")).toHaveLength(1);
  expect(rows).toContain("结尾旁白");
  for (const row of style) {
    const parent = style.find(candidate => candidate.id === row.parentId);
    if (row.format === "scene") expect(row.parentId).toBeNull();
    if (row.format === "shot") expect(parent?.format).toBe("scene");
    if (row.format === "text") expect(parent?.format).toBe("shot");
  }
  expect(style.filter(row => row.format === "shot")).toHaveLength(4);
});

it("rejects missing ordinary text and invalid media references", () => {
  const modules = generated.chapters[0].modules.map(module => ({ ...module }));
  const { text: _unused, ...ordinary } = modules[2];
  modules[2] = ordinary as typeof modules[number];
  expect(() => service.applyConversion([source], "storyboard", {
    chapters: [{ ...generated.chapters[0], modules }],
  })).toThrow();
  const forward = generated.chapters[0].modules.map(module => ({ ...module }));
  forward[2] = { ...forward[2], parent: 3 };
  expect(() => service.applyConversion([source], "storyboard", {
    chapters: [{ ...generated.chapters[0], modules: forward }],
  })).toThrow("层级顺序");
  const invalid = generated.chapters[0].modules.map(module => ({ ...module }));
  invalid[3] = { format: "text", parent: 1, media: 9 } as typeof invalid[number];
  expect(() => service.applyConversion([source], "storyboard", {
    chapters: [{ ...generated.chapters[0], modules: invalid }],
  })).toThrow("素材");
});

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

it("regenerates only the selected trial and preserves the live full film when adopting it", async () => {
  const input = await fixture();
  const [main] = service.applyConversion([source], "storyboard", generated);
  const full = await chapters.insertChapter({ ...input, content: { ...main, title: "整部影片" } });
  const trial = await chapters.insertChapter({ ...input, content: { ...main, title: "单镜试稿", blocks: {
    ...main.blocks, shotTextOrigin: { trialId: randomUUID(), source: "作者", shotId: "雨中的车站" },
  } } });
  const request = { ...input, id: randomUUID(), chapterId: trial.id, request: "把这一镜的节奏放慢", conversation: [] };
  const draft = await service.generateFilmManuscript(request);
  expect(compute.mock.calls.at(-1)![0].context.source.map((c: {title: string}) => c.title)).toEqual(["单镜试稿"]);
  expect(draft.chapters).toHaveLength(1);
  expect(draft.chapters![0].blocks.writingStyle?.find(r => r.format === "shot")?.id).toBe(trial.blocks.writingStyle!.find(r => r.format === "shot")!.id);
  await service.adoptManuscriptConversion({ ...input, id: draft.id, revision: draft.revision });
  const saved = await chapters.listChapters(input.storyId, 61, "storyboard");
  expect(saved.find(c => c.id === full.id)).toEqual(full);
  expect(saved.find(c => c.id === trial.id)?.version).toBe(trial.version + 1);
});

it.each([true, false])("quotes and generates the same author-selected grouping (%s)", async showScenes => {
  const input = await fixture();
  const request = { ...input, id: randomUUID(), chapterId: input.chapter.id, request: showScenes ? "按场显示分镜" : "整理成分镜",
    conversation: [{ role: "assistant" as const, content: "建议分成三场" }] };
  quote.mockReturnValue({ fingerprint: "quoted" });
  await service.quoteFilmManuscript(request);
  const quoted = quote.mock.calls.at(-1)![0].systemPrompt;
  const candidate = await service.generateFilmManuscript({ ...request, quoteFingerprint: "quoted" });
  expect(compute.mock.calls.at(-1)![0].systemPrompt).toBe(quoted);
  expect(quoted).toContain(showScenes ? "已要求分场" : "本版只按连续镜号写");
  expect(candidate.chapters![0].blocks.writingStyle!.some(row => row.format === "scene")).toBe(showScenes);
  expect(Boolean(candidate.chapters![0].blocks.storyboardScenes)).toBe(showScenes);
});

it("generates from the current book and conversation, preserving originals and reusing retries", async () => {
  const input = await fixture();
  const request = { ...input, chapterId: input.chapter.id, id: randomUUID(), request: "给朋友看，轻松一点", conversation: [{ role: "user" as const, content: "发朋友圈，介绍用途，不夸大效果" }] };
  const draft = await service.generateFilmManuscript(request);
  expect(draft.status).toBe("review");
  expect(compute.mock.calls[0][0].context.conversation).toEqual(request.conversation);
  expect((await chapters.listChapters(input.storyId, 61, "text"))[0].blocks.body).toBe(source.blocks.body);
  expect(await service.generateFilmManuscript(request)).toEqual(draft);
  expect(compute).toHaveBeenCalledTimes(1);
  await expect(service.generateFilmManuscript({ ...request, userId: 999 })).rejects.toThrow();
  await expect(service.generateFilmManuscript({ ...request, request: "别的要求" })).rejects.toThrow();
  const adopted = await service.adoptManuscriptConversion({ ...input, id: draft.id, revision: draft.revision });
  expect(adopted.source?.id).toBe(input.version.id);
  const storyboard = (await chapters.listChapters(input.storyId, 61, "storyboard"))[0];
  const regenerated = await service.generateFilmManuscript({ ...request, id: randomUUID(), chapterId: storyboard.id });
  expect(regenerated.source.kind).toBe("storyboard");
  expect(regenerated.status).toBe("review");
});

it("can turn an adopted storyboard back into a separate text version", async () => {
  const input = await fixture();
  const film = await service.generateFilmManuscript({ ...input, id: randomUUID(), request: "影片", conversation: [] });
  const adopted = await service.adoptManuscriptConversion({ ...input, id: film.id, revision: film.revision });
  const storyboard = (await chapters.listChapters(input.storyId, 61, "storyboard"))[0];
  compute.mockResolvedValue({ parsed: { chapters: [{ title: "改编文字", modules: [
    { format: "heading1", text: "新的一章", parent: null },
    { format: "text", text: "按文章叙事重写", parent: 0 },
    { format: "text", text: "", media: 0, parent: 0 },
  ] }] } });
  const prose = await service.generateFilmManuscript({ ...input, id: randomUUID(), chapterId: storyboard.id, target: "text", request: "文字呈现", conversation: [] });
  expect(prose.status).toBe("review");
  const result = await service.adoptManuscriptConversion({ ...input, id: prose.id, revision: prose.revision });
  expect(result.kind).toBe("text");
  expect(result.number).toBe(2);
  expect(result.source?.id).toBe(adopted.id);
  expect((await chapters.listChapters(input.storyId, 61, "storyboard"))[0].blocks.body).toBe(storyboard.blocks.body);
});

it.each(["text", "storyboard"] as const)("preserves the original after failure then adopts a new %s version", async target => {
  const input = await fixture();
  const before = await service.getBookWorkflow(input);
  const failure = new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "生成服务配置异常，暂时无法生成新版本。原稿与历史已保留。" });
  compute.mockRejectedValueOnce(failure);
  const request = { ...input, id: randomUUID(), sourceId: input.version.id, target, intent, regenerate: true, request: "生成新版本" };
  await expect(service.proposeManuscriptConversion(request)).rejects.toBe(failure);
  const failed = await service.getBookWorkflow(input);
  expect(failed.state.versions).toEqual(before.state.versions);
  expect(failed.state.conversions[0]).toMatchObject({ status: "failed", error: failure.message });
  expect(failed.drafts.text.fingerprint).toBe(before.drafts.text.fingerprint);
  expect((await service.proposeManuscriptConversion(request)).status).toBe("failed");
  expect(compute).toHaveBeenCalledTimes(1);
  if (target === "text") compute.mockResolvedValueOnce({ parsed: { chapters: [{ title: "新版原文", modules: [
    { format: "heading1", text: "第一章", parent: null },
    { format: "text", text: "用新的叙事保留原文事实", parent: 0 },
    { format: "text", text: "", parent: 0, media: 0 },
  ] }] } });
  const next = await service.proposeManuscriptConversion({ ...request, id: randomUUID() });
  expect(next.status).toBe("review");
  expect(compute).toHaveBeenLastCalledWith(expect.objectContaining({ failureMode: "throw" }));
  const adopted = await service.adoptManuscriptConversion({ ...input, id: next.id, revision: next.revision });
  expect(adopted.kind).toBe(target);
  const after = await service.getBookWorkflow(input);
  expect(after.state.versions.find(v => v.id === input.version.id)).toEqual(input.version);
  if (target === "storyboard") expect((await chapters.listChapters(input.storyId, 61, "text"))[0].blocks.body).toBe(source.blocks.body);
  expect((await chapters.listChapters(input.storyId, 61, target))[0].blocks.body).toContain("/api/images/original.png");
});

it("continues a named reading in chat, retaining both endings, original modules and chapter revisions",async()=>{
  const owner=await fixture();
  const original=await chapters.insertChapter({...owner,content:{...source,blocks:{...source.blocks,manuscriptKind:"storyboard"}}});
  const fingerprint=(await service.getBookWorkflow(owner)).drafts.storyboard.fingerprint;
  const reading={label:"结尾 A",sourceLabel:"作者",shots:[
    {title:"合影",paragraphs:[{text:"画面提示词：看照片。"},{text:"两个人。",dialogue:true}]},
    {title:"今天",paragraphs:[{text:"音效提示词：脚步。"},{text:"这里是今天。",dialogue:true}]},
  ]};
  const a=await service.importStoryboardReading({...owner,id:randomUUID(),expectedFingerprint:fingerprint,reading});
  const b=await service.importStoryboardReading({...owner,id:randomUUID(),expectedFingerprint:fingerprint,reading:{...reading,label:"结尾 B"}});
  const input={...owner,id:randomUUID(),trialBase:{id:b.id,revision:b.revision},request:"第02镜的旁白改成“我记得那一下。”",conversation:[]};
  const price=await service.quoteFilmManuscript(input);
  expect(price.estimatedCny).toBe(0);
  const first=await service.generateFilmManuscript({...input,quoteFingerprint:price.fingerprint});
  expect(first.trial?.changedShots).toEqual([2]);expect(first.chapters![0].blocks.body).toContain("我记得那一下。");
  expect(compute).not.toHaveBeenCalled();
  quote.mockReturnValue({fingerprint:"model-quote",estimatedCny:0.1});
  const next={...input,id:randomUUID(),request:"再慢一点，保留旁白原句。",trialBase:{id:first.id,revision:first.revision}};
  compute.mockResolvedValue({parsed:{changes:[{shot:2,index:4,text:"音效提示词：停半秒，再听见脚步。"}]}});
  const second=await service.generateFilmManuscript({...next,quoteFingerprint:(await service.quoteFilmManuscript(next)).fingerprint});
  expect(compute.mock.calls[0][0].context.editable.map((s:{shot:number})=>s.shot)).toEqual([2]);
  expect(second.chapters![0].blocks.body).toContain("我记得那一下。");
  expect(second.chapters![0].blocks.writingStyle?.map(r=>r.id)).toEqual(b.chapters![0].blocks.writingStyle?.map(r=>r.id));
  expect(second.chapters![0].blocks.blockIds).toEqual(b.chapters![0].blocks.blockIds);
  expect((await service.getBookWorkflow(owner)).state.conversions.filter(d=>d.status==="review").map(d=>d.id)).toEqual([a.id,b.id,first.id,second.id]);
  await expect(service.quoteFilmManuscript({...next,trialBase:{id:first.id,revision:99}})).rejects.toThrow("已更新");
  expect((await chapters.listChapters(owner.storyId,actor.userId,"storyboard"))[0]).toEqual(original);
  compute.mockResolvedValue({parsed:{changes:[{shot:1,index:1,text:"误改"}]}});
  await expect(service.generateFilmManuscript({...next,id:randomUUID(),quoteFingerprint:"model-quote"})).rejects.toThrow("指定镜头");
  compute.mockResolvedValue({parsed:{changes:[{shot:2,index:5,text:"不该改的旁白"}]}});
  await expect(service.generateFilmManuscript({...next,id:randomUUID(),quoteFingerprint:"model-quote"})).rejects.toThrow("保留的旁白");
});

it("keeps the author's visual and timing notes when a provider returns extra edits alongside the requested camera cue",async()=>{
  const {trialEditor,importedReading}=await import("./storyboardTrial");
  const chapter=importedReading(source,{label:"试读",sourceLabel:"作者",shots:[{title:"书页",paragraphs:[
    {text:"画面提示词：先看两个字。一秒为试排值，配音后可调整。"},{text:"说到这里。",dialogue:true},
  ]}]});
  const editor=trialEditor([chapter],"第01镜先看见字。保留旁白原句，试写一条简短的运镜提示词。",[]);
  const extra={shot:1,index:1,text:"画面提示词：先看两个字。"};
  const valid={shot:1,text:"运镜提示词：从整页推近这两个字。"};
  expect(editor.apply({changes:[extra,valid]}).chapters[0].blocks.body).toBe(chapter.blocks.body+"\n"+valid.text);
  expect(()=>editor.apply({changes:[extra]})).toThrow("指定栏目");
});

it("edits only the last picture and keeps its subtitle, timing, sound, dialogue and earlier shots",async()=>{
  const {trialEditor,importedReading}=await import("./storyboardTrial");
  const chapter=importedReading(source,{label:"试读",sourceLabel:"作者",shots:[
    {title:"开场",paragraphs:[{text:"画面提示词：站台。"}]},
    {title:"结尾",paragraphs:[{text:"画面提示词：雨落下来。"},{text:"屏幕文字：傍晚"},{text:"时长：三秒，有待试排。"},{text:"音效提示词：雨声。 "},{text:"那一下，我看见了。",dialogue:true}]}
  ]});
  const request="只换最后一镜的画面，旁白照旧。";
  const editor=trialEditor([chapter],request,[]);
  expect(editor.prompt.context.editable.map(s=>s.shot)).toEqual([2]);
  const picture={shot:2,index:3,text:"画面提示词：雨中的路灯。"};
  const unwanted={shot:2,index:4,text:"屏幕文字：夜晚"};
  const expected=chapter.blocks.body.replace("画面提示词：雨落下来。",picture.text);
  expect(editor.apply({changes:[unwanted,{shot:2,index:5,text:"时长：一秒。"},picture]}).chapters[0].blocks.body).toBe(expected);
  expect(()=>editor.apply({changes:[{...picture,text:picture.text+"\n字幕：不要加入"}]})).toThrow("指定栏目");
  expect(()=>editor.apply({changes:[{shot:2,index:7,text:"另一个人。"}]})).toThrow("保留的旁白");
  const author=trialEditor([chapter],"最后一个镜头的画面换成“雨中的路灯。”，旁白照旧。",[]);
  expect(author.freeQuote?.estimatedCny).toBe(0);
  expect(author.apply(author.exact).chapters[0].blocks.body).toBe(expected);
});
