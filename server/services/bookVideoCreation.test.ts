import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import { buildPublishingArticleVideoPreview } from "../../shared/publishingArticleVideo";
import { prepareStoryBody } from "./storySync";
const mocks = vi.hoisted(() => ({ compute: vi.fn(), generate: vi.fn() }));
vi.mock("./publishingVideoStoryboard", async importOriginal => ({
  ...(await importOriginal<typeof import("./publishingVideoStoryboard")>()),
  runPublishingVideoStoryboardTextCompute: mocks.compute,
  generatePublishingVideoStoryboardPreview: mocks.generate,
}));
const dir = await mkdtemp(path.join(os.tmpdir(), "book-video-flow-"));
const previous = process.env.LOCAL_PERSIST_PATH;
const previousDb = process.env.DATABASE_URL;
process.env.LOCAL_PERSIST_PATH = path.join(dir, "db.json");
process.env.DATABASE_URL = "";
const db = await import("../db");
const service = await import("./bookVideoCreation");
afterAll(async () => {
  if (previous === undefined) delete process.env.LOCAL_PERSIST_PATH;
  else process.env.LOCAL_PERSIST_PATH = previous;
  if (previousDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDb;
  await rm(dir, { recursive: true, force: true });
});
const brief = {
  purpose: "给家人纪念",
  audience: "家人",
  tone: "温暖克制",
  duration: "建议20秒",
  narration: "精简台词",
  music: "轻钢琴与雨声",
  reuse: "沿用插图",
  changes: "由原文整理成短片",
  question: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.compute.mockResolvedValue({ parsed: brief, modelLabel: "test" });
  mocks.generate.mockImplementation(async input => ({
    preview: buildPublishingArticleVideoPreview({
      rows: input.articleRows,
      requirements: new Map(
        input.articleRows.map((r: { id: string }) => [
          r.id,
          {
            subject: "伞",
            action: "修伞",
            imageRequirement: "保留水彩",
            videoRequirement: "固定机位",
            soundRequirement: "雨声",
            voiceText: "让旧物继续陪伴我们。",
            durationSec: 7,
          },
        ])
      ),
      now: Date.now(),
    }),
    modelLabel: "test",
  }));
});
async function fixture() {
  let p = upsertPublishingPlatformDraft(emptyPublishingDraftState(100), {
    platform: "xiaohongshu",
    content: { title: "虚构", body: "阿宁修好了旧伞。", tags: [] },
    activate: true,
    now: 101,
  });
  p = {
    ...p,
    versions: p.versions?.map(v => ({
      ...v,
      drafts: structuredClone(p.drafts),
      activePlatform: p.activePlatform,
      selectedPlatforms: [...p.selectedPlatforms],
      versionRevision: p.revision,
    })),
  };
  const story = await db.createStory({
    userId: 31,
    title: "虚构视频方案",
    body: { _revision: 1, shots: [], publishing: p },
  });
  return {
    storyId: story.id,
    userId: 31,
    versionId: p.activeVersionId!,
    id: crypto.randomUUID(),
    request: "给家人看，纪念爷爷修伞的生活，让他们温暖。",
    layout: { body: "阿宁修好了旧伞。", illustrations: [] },
  };
}
it("stores intent before generation, reuses an identical proposal and isolates owners", async () => {
  const input = await fixture();
  const r = await service.proposeBookVideo(input);
  expect(r.status).toBe("proposed");
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(await service.proposeBookVideo(input)).toEqual(r);
  expect(mocks.compute).toHaveBeenCalledTimes(1);
  await expect(
    service.listBookVideoRecords({ ...input, userId: 99 })
  ).rejects.toThrow("故事不存在");
  await expect(
    service.proposeBookVideo({ ...input, request: "别的内容" })
  ).rejects.toThrow("本次请求已变化");
});
it("refuses stale book input and unanswered intent", async () => {
  const input = await fixture();
  await expect(
    service.proposeBookVideo({
      ...input,
      layout: { ...input.layout, body: "未保存的新文" },
    })
  ).rejects.toThrow("请先保存");
  mocks.compute.mockResolvedValue({
    parsed: { ...brief, question: "希望给谁看？" },
  });
  await service.proposeBookVideo(input);
  await expect(service.generateBookVideo(input)).rejects.toThrow("先回答追问");
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("persists rewritten narration, edits with revision checks, adopts and keeps the old plan", async () => {
  const input = await fixture();
  await service.proposeBookVideo(input);
  const ready = await service.generateBookVideo(input);
  expect(ready.preview?.shots[0].voiceText).toBe("让旧物继续陪伴我们。");
  expect((await db.getStoryById(input.storyId, 31))?.body).toMatchObject({
    shots: [],
  });
  await service.generateBookVideo(input);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  const edited = await service.editBookVideo({
    ...input,
    revision: ready.revision,
    shots: ready.preview!.shots.map(s => ({
      ...s,
      voiceText: "这把伞，还能陪我们很久。",
    })),
  });
  expect(edited.edits).toHaveLength(1);
  await expect(
    service.editBookVideo({
      ...input,
      revision: ready.revision,
      shots: ready.preview!.shots,
    })
  ).rejects.toThrow("方案已变化");
  const adopted = await service.adoptBookVideo(input);
  expect(adopted.shots[0]).toMatchObject({
    dialogue: "这把伞，还能陪我们很久。",
  });
  expect((await service.listBookVideoRecords(input))[0].status).toBe("adopted");
  const next = await service.proposeBookVideo({
    ...input,
    id: crypto.randomUUID(),
    parentId: input.id,
    request: "换成更轻快的表达",
  });
  expect(next.parentId).toBe(input.id);
  expect(await service.listBookVideoRecords(input)).toHaveLength(2);
});
it("generic stale saves cannot overwrite or fabricate video records", () => {
  expect(
    prepareStoryBody({ bookVideoRecords: [{ id: "old" }] }, 4, {
      bookVideoRecords: [{ id: "new" }],
    })
  ).toMatchObject({ bookVideoRecords: [{ id: "new" }] });
  expect(
    prepareStoryBody({ bookVideoRecords: [{ id: "fake" }] }, 1)
  ).not.toHaveProperty("bookVideoRecords");
});
it("keeps a failed intent record rather than silently claiming a successful plan", async () => {
  const input = await fixture();
  mocks.compute.mockResolvedValue({ parsed: null });
  await expect(service.proposeBookVideo(input)).rejects.toThrow();
  expect((await service.listBookVideoRecords(input))[0].status).toBe("failed");
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("uses the current saved book and inserted image instead of stale publishing text", async()=>{
 const input=await fixture();
 const {insertChapter,saveChapterContent}=await import("../repositories/chapters");
 const image=await db.createGeneratedImage({storyId:input.storyId,userId:31,projectId:null,shotNo:"1",imageUrl:"/api/images/book-source.png",imageKey:null,prompt:"雨中的伞",generationType:"initial",isCurrent:false});
 const chapter=await insertChapter({storyId:input.storyId,userId:31,content:{title:"当前书稿",layout:null,blocks:{body:"书里刚修改的句子。\n![图片](/api/images/book-source.png)",blockIds:[],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 const proposed=await service.proposeBookVideo(input);
 expect(proposed.bookSource).toBe(true);
 expect(proposed.layout.body).toBe("书里刚修改的句子。");
 expect(proposed.layout.illustrations[0].assetId).toBe(image.id);
 const ready=await service.generateBookVideo(input);
 expect(ready.preview?.source?.bookContentHash).toBe(proposed.sourceHash);
 expect(ready.preview?.shots.some(s=>s.referenceImageId===image.id)).toBe(true);
 const adopted=await service.adoptBookVideo(input);
 expect(adopted.shots.length).toBeGreaterThan(0);
 const other=await service.proposeBookVideo({...input,id:crypto.randomUUID(),parentId:input.id,request:"想改成安静的版本"});
 await saveChapterContent({reason:"test update",id:chapter.id,userId:31,expectedVersion:chapter.version,content:{title:chapter.title,layout:null,blocks:{...chapter.blocks,body:"书稿又更新了。"}}});
 await expect(service.generateBookVideo({...input,id:other.id})).rejects.toThrow("书稿已更新");
});
