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
const mocks = vi.hoisted(() => ({ compute: vi.fn(), generate: vi.fn(), prepareAudio: vi.fn() }));
vi.mock("./bookVideoAudio", () => ({ prepareBookVideoAudio: mocks.prepareAudio }));
vi.mock("./publishingVideoStoryboard", async importOriginal => ({
  ...(await importOriginal<typeof import("./publishingVideoStoryboard")>()),
  runPublishingVideoStoryboardTextCompute: mocks.compute,
  generatePublishingVideoStoryboardPreview: mocks.generate,
}));
const dir = await mkdtemp(path.join(os.tmpdir(), "book-video-flow-"));
const previous = process.env.LOCAL_PERSIST_PATH;
const previousDb = process.env.DATABASE_URL;
const previousChapters = process.env.CHAPTER_PACKAGE_ENABLED;
process.env.CHAPTER_PACKAGE_ENABLED = "false"; // Legacy video cases; the versioned path is exercised below.
process.env.LOCAL_PERSIST_PATH = path.join(dir, "db.json");
process.env.DATABASE_URL = "";
const db = await import("../db");
const service = await import("./bookVideoCreation");
async function reviewAndAdopt(input: Parameters<typeof service.adoptBookVideo>[0]) {
  const r=(await service.listBookVideoRecords(input)).find(r=>r.id===input.id)!;
  return service.adoptBookVideo({...input,reviewedRevision:r.revision});
}
afterAll(async () => {
  if (previousChapters === undefined) delete process.env.CHAPTER_PACKAGE_ENABLED; else process.env.CHAPTER_PACKAGE_ENABLED = previousChapters;
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
  mocks.prepareAudio.mockReset().mockResolvedValue(undefined);
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
  const result = await reviewAndAdopt({ ...next, actor: { userId: 31, name: "测试作者" } });
  expect(result.shots).toHaveLength(7);
  expect(result.shots.map(s => (s.publishingVideo as any).referenceImageIds.length)).toEqual([2,0,3,0,0,0,0]);
  const history = await service.listBookVideoRecords(input);
  expect(history[0].storyboardSnapshot?.shots).toEqual(previous.shots);
  expect(history.map(r => r.videoVersion)).toEqual([1,2]);
  const { getVideoWorkflow } = await import("./videoWorkflow");
  const savedVideo = (await getVideoWorkflow(input)).state.versions;
  expect(savedVideo).toHaveLength(1);
  expect(savedVideo[0].shots).toEqual(previous.shots);
  expect(savedVideo[0].material.timeline.items.length).toBeGreaterThan(0);
  await reviewAndAdopt({ ...next, actor: { userId: 31, name: "测试作者" } });
  expect((await getVideoWorkflow(input)).state.versions).toHaveLength(1);
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

it.each([false,true])('inherits rendered frames and chosen endpoints when legacy acts become scene/shot modules, new publishing version=%s',async(newPublishingVersion)=>{
 const input=await fixture();
 const {insertChapter,saveChapterContent}=await import('../repositories/chapters');
 const {applyStoryboardPlan}=await import('./bookStoryboardPreparation');
 const original=await insertChapter({storyId:input.storyId,userId:31,content:{title:'旧伞',layout:null,blocks:{body:'第1幕\n阿宁撑开那把修好的旧伞。\n第2幕\n旅人撑着这把旧伞慢慢走远。',blockIds:['a','b','c','d'],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 await service.proposeBookVideo(input);await service.generateBookVideo(input);const first=await reviewAndAdopt(input);
 const stable=first.shots[0].stableShotId as string;
 const image=await db.createGeneratedImage({storyId:input.storyId,userId:31,projectId:null,shotNo:'SH01',shotIdentity:stable,imageUrl:'/api/images/inherited.png',imageKey:null,prompt:'原画面',generationType:'initial',isCurrent:true});
 const story=await db.getStoryById(input.storyId,31);const body=story!.body as any;
 const changed={...body,_revision:body._revision+1,shots:body.shots.map((shot:any,index:number)=>index===0?{...shot,generationParams:JSON.stringify({storyboardFrameRoles:{firstImageId:image.id,lastImageId:image.id,referenceImageIds:[]},referenceFrameImageIds:[],durationSec:8})}:shot)};
 expect(await db.updateStoryBodyIfRevision({id:input.storyId,userId:31,expectedRevision:body._revision,body:changed})).toBe(true);
 const blocks=applyStoryboardPlan(original.id,original.blocks,{scenes:[{title:'雨中',shots:[{title:'开伞',units:[0,1]}]},{title:'街边',shots:[{title:'离开',units:[2,3]}]}]});
 await saveChapterContent({id:original.id,userId:31,expectedVersion:original.version,content:{blocks},reason:'storyboard-test'});
 let versionId=input.versionId;
 if(newPublishingVersion) {
  versionId='v-next';
  const current=(await db.getStoryById(input.storyId,31))!.body as any;
  const oldVersion=current.publishing.versions.find((v:any)=>v.versionId===input.versionId);
  const publishing={...current.publishing,activeVersionId:versionId,versions:[...current.publishing.versions,{...oldVersion,versionId,videoStoryboard:undefined}]};
  expect(await db.updateStoryBodyIfRevision({id:input.storyId,userId:31,expectedRevision:current._revision,body:{...current,_revision:current._revision+1,publishing}})).toBe(true);
 }
 const next={...input,versionId,id:crypto.randomUUID(),parentId:input.id,request:'沿用旧画面，以分镜稿制作'};
 await service.proposeBookVideo(next);await service.generateBookVideo(next);const adopted=await reviewAndAdopt(next);
 expect(adopted.shots.map(s=>s.stableShotId)).toEqual(first.shots.map(s=>s.stableShotId));
 expect(JSON.parse(adopted.shots[0].generationParams as string).storyboardFrameRoles).toMatchObject({firstImageId:image.id,lastImageId:image.id});
 const {getStoryMaterialState}=await import('./storyMaterials');
 expect((await getStoryMaterialState(input.storyId,31))?.shots[0].imageVersions.some(i=>i.id===image.id)).toBe(true);
 expect((await service.listBookVideoRecords(input))[0].storyboardSnapshot?.shots[0].generationParams).toBe(changed.shots[0].generationParams);
});

it("connects chat and manuscript conversion to reviewable render inputs and an adopted video version", async () => {
  process.env.CHAPTER_PACKAGE_ENABLED = "true";
  try {
    const input = await fixture();
    const { insertChapter } = await import("../repositories/chapters");
    const workflow = await import("./bookWorkflow");
    const chapter = await insertChapter({ storyId: input.storyId, userId: input.userId, content: { title: "原书", layout: null, blocks: { body: "爷爷修好了旧伞。", blockIds: [], manuscriptKind: "text", containsAiText: false, settings: null, coverKey: null, bodyTextureKey: null, images: {}, illustrations: [] } } });
    const conversation = [{ role: "user" as const, content: "给家人看，发朋友圈，温暖克制，七秒。" }];
    mocks.compute.mockResolvedValueOnce({ parsed: { chapters: [{ title: "影片分镜", modules: [
      { format: "scene", text: "修伞", parent: null }, { format: "shot", text: "桌边近景", parent: 0 },
      { format: "text", text: "爷爷修好了旧伞。", parent: 1, dialogue: true },
    ] }] } });
    const owner = { storyId: input.storyId, userId: input.userId, actor: { userId: input.userId, name: "测试作者" } };
    const film = await workflow.generateFilmManuscript({ ...owner, id: crypto.randomUUID(), chapterId: chapter.id, request: "做成影片", conversation });
    expect(film.status).toBe("review");
    const manuscript = await workflow.adoptManuscriptConversion({ ...owner, id: film.id, revision: film.revision });
    await service.proposeBookVideo(input);
    expect(mocks.compute.mock.calls.at(-1)?.[0].context.conversation).toEqual(conversation);
    const ready = await service.generateBookVideo({ ...input, confirmBrief: true });
    expect(ready.preview?.shots[0]).toMatchObject({ subject: "伞", action: "修伞", imageRequirement: "保留水彩", videoRequirement: "固定机位", soundRequirement: "雨声", voiceText: "爷爷修好了旧伞。" });
    const adopted = await reviewAndAdopt({ ...input, actor: owner.actor });
    expect(adopted.shots[0]).toMatchObject({ dialogue: "爷爷修好了旧伞。" });
    const record = (await service.listBookVideoRecords(input))[0];
    expect(record).toMatchObject({ status: "adopted", videoVersion: 1 });
    expect(JSON.stringify(record)).toContain(manuscript.id);
  } finally { process.env.CHAPTER_PACKAGE_ENABLED = "false"; }
});

it('imports the current storyboard directly without AI, preserves its source and reuses a retry', async () => {
  const input = await fixture();
  const { insertChapter, listChapters } = await import('../repositories/chapters');
  const { blockBody, writingStyleOf, newWritingBlock } = await import('../../client/src/features/publishingAlbum/chapterBlockTree');
  const { getBookWorkflow } = await import('./bookWorkflow');
  const image = await db.createGeneratedImage({storyId:input.storyId,userId:31,projectId:null,shotNo:null,imageUrl:'/api/images/direct.png',imageKey:null,prompt:'原图',generationType:'initial',isCurrent:false});
  const audio = await db.createStoryAudioAssetRow({storyId:input.storyId,userId:31,storageKey:'c'.repeat(32),displayName:'整书台词',sourceKind:'local-upload',mediaKind:'narration',status:'ready',durationFrames:390,durationSeconds:13});
  const music = await db.createStoryAudioAssetRow({storyId:input.storyId,userId:31,storageKey:'d'.repeat(32),displayName:'整书配乐',sourceKind:'local-upload',mediaKind:'music',status:'ready',durationFrames:300,durationSeconds:10});
  const { bookAudioText } = await import('../../shared/bookAudioBlock');
  const blocks = [
    newWritingBlock(bookAudioText(input.storyId,audio.id,'整书台词','narration')),
    newWritingBlock(bookAudioText(input.storyId,music.id,'整书配乐','music')),
    {...newWritingBlock('雨中'),id:'scene',format:'scene' as const},
    {...newWritingBlock('开伞','scene'),id:'shot',format:'shot' as const},
    {...newWritingBlock('分镜草案 · 0–13秒（13秒）\n开场画面：伞的近景。\n画面运动：慢慢拉远。\n结束画面：完整雨街。\n声音建议：雨声。','shot'),id:'description'},
    {...newWritingBlock('这把伞，还能陪我们很久。','shot'),id:'dialogue',videoRole:'dialogue' as const},
    newWritingBlock(`![图片](${image.imageUrl})`,'shot'),
  ];
  const chapter = await insertChapter({storyId:input.storyId,userId:31,content:{title:'现有分镜',layout:null,blocks:{body:blockBody(blocks),writingStyle:writingStyleOf(blocks),manuscriptKind:'storyboard',blockIds:[],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
  const before = await listChapters(input.storyId,31,'all');
  const request = {...input,chapterId:chapter.id,expectedFingerprint:(await getBookWorkflow(input)).drafts.storyboard.fingerprint,actor:{userId:31,name:'测试作者'}};
  await expect(service.importBookStoryboard({...request,userId:99})).rejects.toThrow('故事不存在');
  await expect(service.importBookStoryboard({...request,expectedFingerprint:'outdated'})).rejects.toThrow('分镜');
  const result = await service.importBookStoryboard(request);
  expect(result.shots).toHaveLength(1);
  expect(result.shots[0]).toMatchObject({dialogue:'这把伞，还能陪我们很久。',durationMs:13000,action:'画面运动：慢慢拉远。'});
  expect(result.shots[0].scriptText).toContain('结束画面：完整雨街。');
  expect(result.shots[0].sound).toContain('声音建议：雨声。');
  expect(result.shots[0].sound).toContain(`整书声音（待对齐）：${bookAudioText(input.storyId,audio.id,'整书台词','narration')}`);
  expect(result.shots[0].publishingVideo).toMatchObject({referenceImageIds:[image.id]});
  expect(mocks.compute).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(await listChapters(input.storyId,31,'all')).toEqual(before);
  const history = await service.listBookVideoRecords(input);
  expect(history[0]).toMatchObject({status:'adopted',videoVersion:1,manuscriptSource:{kind:'storyboard',number:1},author:request.actor});
  expect((await service.importBookStoryboard(request)).shots).toEqual(result.shots);
  expect(await service.listBookVideoRecords(input)).toHaveLength(1);
  const current = (await db.getStoryById(input.storyId,31))!.body as any;
  const oldTimeline = (await db.getStoryTimeline(input.storyId,31))!;
  const oldSubtitle = {tracks:[{id:'subtitles',cues:[{id:'old-cue',text:'旧版字幕',startFrame:0,durationFrames:180,textRevision:1,sourceTextRevision:1,provenance:{kind:'manual'}}]}]};
  await db.updateStoryTimeline({storyId:input.storyId,userId:31,expectedVersion:oldTimeline.version,items:(oldTimeline.items as any[]).map(item=>({...item,durationFrames:180,plannedDurationMs:6000,timelineStartFrame:60})),extensions:{subtitleTracks:oldSubtitle}});
  await db.createGeneratedImage({storyId:input.storyId,userId:31,projectId:null,shotNo:'SH01',shotIdentity:current.shots[0].stableShotId,imageUrl:'/api/images/old-video.png',imageKey:null,prompt:'旧视频图片',generationType:'initial',isCurrent:true});
  expect(await db.updateStoryBodyIfRevision({id:input.storyId,userId:31,expectedRevision:current._revision,body:{...current,_revision:current._revision+1,shots:current.shots.map((shot:any)=>({...shot,dialogue:'视频里另改过的旧台词',durationMs:6000}))}})).toBe(true);
  const derivedMusic = await db.createStoryAudioAssetRow({storyId:input.storyId,userId:31,storageKey:'e'.repeat(32),displayName:'全片配乐',sourceKind:'tts',mediaKind:'music',status:'ready',durationFrames:390,durationSeconds:13});
  const replacement = {...request,id:crypto.randomUUID()};
  const beforeFailure = await db.getStoryTimeline(input.storyId,31);
  mocks.prepareAudio.mockRejectedValueOnce(new Error('语音边界不确定'));
  await expect(service.importBookStoryboard(replacement)).rejects.toThrow('语音边界不确定');
  expect(await db.getStoryTimeline(input.storyId,31)).toEqual(beforeFailure);
  const sourceRow = (await service.listBookVideoRecords(input)).at(-1)!.layout.bookScenes![0];
  mocks.prepareAudio.mockResolvedValueOnce({version:1,durationFrames:390,shots:[{draftShotId:sourceRow.id,durationFrames:390}],
    narration:{assetId:audio.id,sourceAssetId:audio.id,speed:0.9,lines:[{draftShotId:sourceRow.id,text:'这把伞，还能陪我们很久。',startFrame:45,durationFrames:270}]},
    music:[{assetId:derivedMusic.id,sourceAssetId:music.id}]});
  const next = await service.importBookStoryboard(replacement);
  expect(next.shots[0]).toMatchObject({dialogue:'这把伞，还能陪我们很久。',durationMs:13000});
  const retained = await service.listBookVideoRecords(input);
  expect(retained[0].storyboardSnapshot?.shots[0]).toMatchObject({dialogue:'视频里另改过的旧台词',durationMs:6000});
  expect(retained[1].videoVersion).toBe(2);
  const { getStoryMaterialState } = await import('./storyMaterials');
  const material = (await getStoryMaterialState(input.storyId,31))!;
  expect(material.timeline.items[0]).toMatchObject({durationFrames:390,timelineStartFrame:0,plannedDurationMs:13000});
  expect(JSON.stringify(material.timeline.extensions?.subtitleTracks)).toContain('这把伞，还能陪我们很久。');
  expect(JSON.stringify(material.timeline.extensions?.subtitleTracks)).not.toContain('旧版字幕');
  expect((material.timeline.extensions?.subtitleTracks as any).tracks[0].cues).toEqual([expect.objectContaining({text:'这把伞，还能陪我们很久。',startFrame:45,durationFrames:270})]);
  expect((material.timeline.extensions?.audioTracks as any).tracks.find((track:any)=>track.kind==='music').clips).toEqual([expect.objectContaining({assetId:derivedMusic.id,durationFrames:390,timelineStartFrame:0})]);
  expect((material.timeline.extensions?.audioTracks as any).tracks.find((track:any)=>track.kind==='narration').clips).toEqual([expect.objectContaining({assetId:audio.id,durationFrames:390,timelineStartFrame:0})]);
  const afterImport = await db.getStoryTimeline(input.storyId,31);
  await service.importBookStoryboard(replacement);
  expect(await db.getStoryTimeline(input.storyId,31)).toEqual(afterImport);
  expect(material.shots[0].currentImage).toBeNull();
  expect(material.shots[0].imageGenerationReferences?.map(image=>image.id)).toEqual([image.id]);
  const saved = (await db.getStoryById(input.storyId,31))!.body as any;
  const archived = saved.videoWorkflow.versions.at(-1);
  expect(archived.material.timeline.items[0]).toMatchObject({durationFrames:180,timelineStartFrame:60});
  expect(archived.material.timeline.extensions.subtitleTracks).toEqual(oldSubtitle);
  expect(await listChapters(input.storyId,31,'all')).toEqual(before);
  mocks.prepareAudio.mockResolvedValueOnce({version:1,durationFrames:390,shots:[{draftShotId:sourceRow.id,durationFrames:390}],
    narration:{assetId:audio.id,sourceAssetId:audio.id,speed:0.9,lines:[{draftShotId:sourceRow.id,text:'旧的另一句台词',startFrame:45,durationFrames:270}]},music:[]});
  const beforeStaleVoice = await db.getStoryTimeline(input.storyId,31);
  await expect(service.importBookStoryboard({...request,id:crypto.randomUUID()})).rejects.toThrow('声音节奏与当前分镜不一致');
  expect(await db.getStoryTimeline(input.storyId,31)).toEqual(beforeStaleVoice);
});
