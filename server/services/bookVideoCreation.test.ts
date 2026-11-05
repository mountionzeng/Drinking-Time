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
async function reviewAndAdopt(input: Parameters<typeof service.adoptBookVideo>[0]) {
  const r=(await service.listBookVideoRecords(input)).find(r=>r.id===input.id)!;
  return service.adoptBookVideo({...input,reviewedRevision:r.revision});
}
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

it("replaces the active table with seven book acts, preserves V1, and carries only 2/0/3/0/0/0/0 references", async () => {
  const input = await fixture();
  await service.proposeBookVideo(input);
  await service.generateBookVideo(input);
  const previous = await reviewAndAdopt(input);
  const images: Array<Awaited<ReturnType<typeof db.createGeneratedImage>>> = [];
  for (let i = 1; i <= 5; i++) images.push(await db.createGeneratedImage({storyId: input.storyId, userId: 31, projectId: null, shotNo: i === 3 ? "SH02" : null, shotIdentity: i === 3 ? "old-version-shot-2" : null, imageUrl: `/api/images/book-act-${i}.png`, imageKey: null, prompt: `参考${i}`, generationType: "initial", isCurrent: i === 3}));
  const {insertChapter} = await import("../repositories/chapters");
  const body = Array.from({length: 7}, (_, i) => [`**第 ${i + 1} 幕**`, `第${i + 1}幕正文`, ...(i === 0 ? images.slice(0,2) : i === 2 ? images.slice(2) : []).map(image => `![图片](${image.imageUrl})`)].join("\n")).join("\n");
  await insertChapter({storyId: input.storyId, userId:31, content:{title:"按幕的书",layout:null,blocks:{body,blockIds:[],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
  const next = {...input, id:crypto.randomUUID(), parentId:input.id, request:"每幕一个镜头，图片仅作本幕参考"};
  await service.proposeBookVideo(next);
  const ready = await service.generateBookVideo(next);
  expect(ready.preview?.shots.map(s => s.referenceImageIds?.length)).toEqual([2,0,3,0,0,0,0]);
  const result = await reviewAndAdopt(next);
  expect(result.shots).toHaveLength(7);
  expect(result.shots.map(s => (s.publishingVideo as any).referenceImageIds.length)).toEqual([2,0,3,0,0,0,0]);
  const history = await service.listBookVideoRecords(input);
  expect(history[0].storyboardSnapshot?.shots).toEqual(previous.shots);
  expect(history.map(r => r.videoVersion)).toEqual([1,2]);
  const {getStoryMaterialState} = await import("./storyMaterials");
  const material = await getStoryMaterialState(input.storyId,31);
  expect(material?.shots.map(s => s.imageGenerationReferences?.length)).toEqual([2,0,3,0,0,0,0]);
  expect(material?.shots.every(s => !s.currentImage)).toBe(true);
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
  await expect(service.adoptBookVideo(input)).rejects.toThrow('请先查看当前方案');
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
      speaker: "爷爷",
    })),
  });
  expect(edited.edits).toHaveLength(1);
  await expect(service.adoptBookVideo({...input,reviewedRevision:ready.revision})).rejects.toThrow('请先查看当前方案');
  await expect(
    service.editBookVideo({
      ...input,
      revision: ready.revision,
      shots: ready.preview!.shots,
    })
  ).rejects.toThrow("方案已变化");
  const adopted = await reviewAndAdopt(input);
  expect(adopted.shots[0]).toMatchObject({
    dialogue: "这把伞，还能陪我们很久。",
    speaker: "爷爷",
  });
  expect((await service.listBookVideoRecords(input))[0]).toMatchObject({status:"adopted",videoVersion:1});
  await reviewAndAdopt(input);
  expect((await service.listBookVideoRecords(input))[0]).toMatchObject({videoVersion:1});
  const withCaptions = await db.getStoryTimeline(input.storyId, input.userId) as any;
  expect(withCaptions.extensions.subtitleTracks.tracks[0].cues).toEqual(expect.arrayContaining([expect.objectContaining({ text: "这把伞，还能陪我们很久。" })]));
  const next = await service.proposeBookVideo({
    ...input,
    id: crypto.randomUUID(),
    parentId: input.id,
    request: "换成更轻快的表达",
  });
  expect(next.parentId).toBe(input.id);
  expect(await service.listBookVideoRecords(input)).toHaveLength(2);
  await service.generateBookVideo({...input,id:next.id});
  expect(JSON.parse(mocks.generate.mock.calls.at(-1)![0].creativeIntent).userRequests).toEqual([input.request, "换成更轻快的表达"]);
  await reviewAndAdopt({...input,id:next.id});
  const retained=await service.listBookVideoRecords(input);
  expect(retained[0]).toMatchObject({status:"adopted",videoVersion:1});
  expect(retained[1]).toMatchObject({status:"adopted",videoVersion:2});
  expect(retained[0].preview!.shots[0].voiceText).toBe("这把伞，还能陪我们很久。");
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
 const adopted=await reviewAndAdopt(input);
 expect(adopted.shots.length).toBeGreaterThan(0);
 const other=await service.proposeBookVideo({...input,id:crypto.randomUUID(),parentId:input.id,request:"想改成安静的版本"});
 await saveChapterContent({reason:"test update",id:chapter.id,userId:31,expectedVersion:chapter.version,content:{title:chapter.title,layout:null,blocks:{...chapter.blocks,body:"书稿又更新了。"}}});
 await expect(service.generateBookVideo({...input,id:other.id})).rejects.toThrow("书稿已更新");
});

it("纯书稿故事从未生成发布稿时，以章节正文进入视频制作，不再要求非空文字稿", async()=>{
 const base=await fixture();
 const story=await db.getStoryById(base.storyId,31);
 const body=story!.body as {publishing:{drafts:unknown;versions:{drafts:unknown}[]}};
 const publishing={...body.publishing,drafts:{},versions:body.publishing.versions.map(v=>({...v,drafts:{}}))};
 const pure=await db.createStory({userId:31,title:"纯书稿",body:{_revision:1,shots:[],publishing}});
 const input={...base,storyId:pure.id,id:crypto.randomUUID()};
 const {insertChapter}=await import("../repositories/chapters");
 await insertChapter({storyId:pure.id,userId:31,content:{title:"第一章",layout:null,blocks:{body:"只在书稿里写过的段落。",blockIds:[],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 const proposed=await service.proposeBookVideo(input);
 expect(proposed.bookSource).toBe(true);
 expect(proposed.layout.body).toBe("只在书稿里写过的段落。");
 const ready=await service.generateBookVideo(input);
 expect(ready.preview?.source?.bookContentHash).toBe(proposed.sourceHash);
 const generated=mocks.generate.mock.calls.at(-1)![0] as {articleRows:{text?:string}[]};
 expect(JSON.stringify(generated.articleRows)).toContain("只在书稿里写过的段落");
});

it('keeps the free description across a duration/mood follow-up and blocks premature generation', async () => {
  const input = { ...await fixture(), request: '我想拍一段修旧伞的生活，让家里人看。' };
  mocks.compute.mockResolvedValueOnce({parsed: {...brief, duration: '待确认', tone: '待确认', question: '大约20秒、温暖安静的氛围，你觉得合适吗？'}});
  await service.proposeBookVideo(input);
  await expect(service.generateBookVideo(input)).rejects.toThrow('先回答追问');
  expect(mocks.generate).not.toHaveBeenCalled();
  const next = await service.proposeBookVideo({...input, id: crypto.randomUUID(), parentId: input.id, request: '用30秒，氛围温暖安静。'});
  expect(mocks.compute.mock.calls[1][0].context).toMatchObject({previousRequest: input.request, request: '用30秒，氛围温暖安静。'});
  expect(next.parentId).toBe(input.id);
  expect((await service.listBookVideoRecords(input))).toHaveLength(2);
});

it('an explicit confirmation accepts displayed suggestions without another chat round',async()=>{
  const input=await fixture();
  mocks.compute.mockResolvedValue({parsed:{...brief,question:'是否采用建议的时长和氛围？'},modelLabel:'test'});
  await service.proposeBookVideo(input);
  await expect(service.generateBookVideo(input)).rejects.toThrow('请先回答追问');
  const ready=await service.generateBookVideo({...input,confirmBrief:true});
  expect(ready.briefConfirmedAt).toBeGreaterThan(0);
  expect(ready.brief!.question).toBe('是否采用建议的时长和氛围？');
  expect(ready.preview).toBeTruthy();
  await reviewAndAdopt(input);
  expect((await service.listBookVideoRecords(input))[0]).toMatchObject({status:'adopted',videoVersion:1});
});

async function musicBook(input: Awaited<ReturnType<typeof fixture>>) {
  const asset = await db.createStoryAudioAssetRow({storyId: input.storyId, userId: input.userId, storageKey: "b".repeat(32), displayName: "纸船钢琴", sourceKind: "local-upload", mediaKind: "music", status: "ready", durationFrames: 900, durationSeconds: 30});
  const {insertChapter} = await import("../repositories/chapters");
  const {bookAudioText} = await import("../../shared/bookAudioBlock");
  await insertChapter({storyId: input.storyId, userId: input.userId, content: {title: "原书", layout: null, blocks: {body: "阿宁修好了旧伞。\n" + bookAudioText(input.storyId, asset.id, asset.displayName), blockIds: [], containsAiText: false, settings: null, coverKey: null, bodyTextureKey: null, images: {}, illustrations: []}}});
  return asset;
}
it("reuses book music on confirmation, preserves source and visual projection, and never duplicates on retry", async () => {
  const input = await fixture();
  const asset = await musicBook(input);
  const proposed = await service.proposeBookVideo(input);
  expect(proposed.layout.body).toBe("阿宁修好了旧伞。");
  expect(proposed.musicAssets).toEqual([{assetId: asset.id, title: "纸船钢琴", durationFrames: 900}]);
  expect(mocks.compute.mock.calls.at(-1)![0].context.existingMusic).toEqual(proposed.musicAssets);
  expect(await db.getStoryTimeline(input.storyId, input.userId)).toBeNull();
  await service.generateBookVideo(input);
  expect(JSON.parse(mocks.generate.mock.calls.at(-1)![0].creativeIntent).existingMusic).toEqual(proposed.musicAssets);
  await reviewAndAdopt(input);
  const timeline = await db.getStoryTimeline(input.storyId, input.userId) as any;
  expect(timeline.items.length).toBeGreaterThan(0);
  const music = timeline.extensions.audioTracks.tracks.find((t: any) => t.kind === "music");
  expect(music.clips).toHaveLength(1);
  expect(music.clips[0]).toMatchObject({assetId: asset.id, durationFrames: 210, timelineStartFrame: 0, sourceInFrame: 0, sourceOutFrame: 210});
  await reviewAndAdopt(input);
  expect(await db.getStoryTimeline(input.storyId, input.userId)).toEqual(timeline);
  expect((await db.getStoryAudioAssetRow({assetId: asset.id, storyId: input.storyId, userId: input.userId}))?.status).toBe("ready");
});
it("honors a confirmed no-original-music request", async () => {
  const input = await fixture();
  await musicBook(input);
  mocks.compute.mockResolvedValueOnce({parsed: {...brief, useBookMusic: false, music: "不要配乐"}});
  await service.proposeBookVideo(input);
  await service.generateBookVideo(input);
  await reviewAndAdopt(input);
  const timeline = await db.getStoryTimeline(input.storyId, input.userId) as any;
  expect(timeline.extensions.audioTracks).toBeUndefined();
  expect(timeline.extensions.subtitleTracks.tracks[0].cues.length).toBeGreaterThan(0);
});
it("an unavailable music asset leaves the adopted table recoverable; retry completes without duplicate shots", async () => {
  const input = await fixture();
  const asset = await musicBook(input);
  await service.proposeBookVideo(input);
  await service.generateBookVideo(input);
  await db.updateStoryAudioAssetRow(asset.id, input.userId, {status: "failed"});
  await expect(reviewAndAdopt(input)).rejects.toThrow("配乐尚未完成");
  expect((await service.listBookVideoRecords(input))[0].status).toBe("ready");
  const shots = (await db.getStoryById(input.storyId, input.userId))!.body as any;
  await db.updateStoryAudioAssetRow(asset.id, input.userId, {status: "ready"});
  await reviewAndAdopt(input);
  expect(((await db.getStoryById(input.storyId, input.userId))!.body as any).shots).toEqual(shots.shots);
  expect((await service.listBookVideoRecords(input))[0].status).toBe("adopted");
});
