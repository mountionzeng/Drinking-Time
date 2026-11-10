import { beforeEach, expect, it, vi } from "vitest";
import { bookAudioText } from "../../shared/bookAudioBlock";
import { blockBody, writingStyleOf, moveWritingBlock, type WritingBlock } from '../../client/src/features/publishingAlbum/chapterBlockTree';
import { publishingArticleVideoRows, buildPublishingArticleVideoPreview, publishingArticleLayoutSchema } from '../../shared/publishingArticleVideo';
const mocks = vi.hoisted(() => ({
  chapters: vi.fn(),
  images: vi.fn(),
  audio: vi.fn(),
}));
vi.mock("../repositories/chapters", () => ({ listChapters: mocks.chapters }));
vi.mock("./imageAssets", () => ({ getStoryImageAssets: mocks.images }));
vi.mock("./storyAudioAssets", () => ({
  listOwnedStoryAudioAssets: mocks.audio,
}));
import { readBookVideoSource } from "./bookVideoSource";
const scope = { storyId: 4, userId: 7 };
const module = (id:string,text:string,format:WritingBlock['format']='text',parentId:string|null=null):WritingBlock => ({id,text,format,parentId,collapsed:false});
it('maps explicit shots before legacy act titles; retains multiple images and exact dialogue across scene moves',async()=>{
 const rows=[module('s1','第 1 幕 · 我的场','scene'),module('a','静默近景','shot','s1'),module('desc','只显示，不朗读','text','a'),
  module('s2','第二场','scene'),module('b','自写镜头名','shot','s2'),
  module('i1','![图片](/api/images/1.png)','text','b'),module('i2','![图片](/api/images/2.png)','text','b'),
  {...module('d','小雨：你好\n小风：再见','text','b'),videoRole:'dialogue' as const},module('music',bookAudioText(4,9,'雨声'),'text','b'),
  module('c','同场另一个镜头','shot','s2'),module('repeat','![图片](/api/images/1.png)','text','c')];
 const save=(blocks:WritingBlock[])=>mocks.chapters.mockResolvedValue([{...chapter(blockBody(blocks)),blocks:{body:blockBody(blocks),blockIds:[],writingStyle:writingStyleOf(blocks)}}]);
 mocks.images.mockResolvedValue([1,2].map(id=>({id,imageUrl:`/api/images/${id}.png`,availability:'available',status:'selected'})));
 mocks.audio.mockResolvedValue([{id:9,status:'ready',durationFrames:300,mediaKind:'music'}]);
 save(rows);const source=(await readBookVideoSource(scope))!;
 expect(source.layout.bookScenes?.map(s=>[s.id,s.referenceImageIds,s.dialogueText])).toEqual([
  ['book-shot-1-a',[],''],['book-shot-1-b',[1,2],'小雨：你好\n小风：再见'],['book-shot-1-c',[1],'']]);
 const videoRows=publishingArticleVideoRows(publishingArticleLayoutSchema.parse(source.layout));
 expect(videoRows.every(row=>row.sourceKind==='shot')).toBe(true);
 const preview=buildPublishingArticleVideoPreview({rows:videoRows,requirements:new Map(),now:1});
 expect(preview.shots.map(s=>s.voiceText)).toEqual(['','小雨：你好\n小风：再见','']);
 expect(preview.shots).toHaveLength(3);
 expect(source.musicAssets.map(a=>a.assetId)).toEqual([9]);
 const moved=moveWritingBlock(rows,'b','s1','inside');save(moved);
 const after=(await readBookVideoSource(scope))!;
 expect(after.sourceHash).not.toBe(source.sourceHash);
 expect(after.layout.bookScenes?.[1]).toMatchObject({id:'book-shot-1-b',referenceImageIds:[1,2],dialogueText:'小雨：你好\n小风：再见'});
 expect(after.layout.bookScenes?.[1].text).toContain('第 1 幕 · 我的场');
 expect(after.layout.bookScenes?.[1].text).not.toContain('第二场');
 save(moved.map(row=>({...row,collapsed:true})));
 expect((await readBookVideoSource(scope))?.sourceHash).toBe(after.sourceHash);
});
it('rejects incomplete explicit ownership before planning instead of silently guessing or dropping media',async()=>{
 for(const rows of [[module('s','场','scene')], [module('s','场','scene'),module('a','镜','shot','s'),module('i','![图片](/api/images/1.png)')],
  [module('s','场','scene'),module('a','镜','shot','s'),module('b','错误嵌套','shot','a')]]) {
  mocks.chapters.mockResolvedValue([{...chapter(blockBody(rows)),blocks:{body:blockBody(rows),blockIds:[],writingStyle:writingStyleOf(rows)}}]);
  await expect(readBookVideoSource(scope)).rejects.toThrow(/镜头/);
 }
});
it('supports untitled and image-only shots with stable IDs and generated display labels',async()=>{
 const rows=[module('s','','scene'),module('a','','shot','s')];
 mocks.chapters.mockResolvedValue([{...chapter(blockBody(rows)),blocks:{body:blockBody(rows),blockIds:[],writingStyle:writingStyleOf(rows)}}]);
 const source=(await readBookVideoSource(scope))!;
 expect(publishingArticleLayoutSchema.parse(source.layout).bookScenes?.[0]).toMatchObject({id:'book-shot-1-a',text:'一场一镜',dialogueText:''});
});
it('does not silently omit old layout-only pictures when adopting explicit shot modules',async()=>{
 const rows=[module('s','场','scene'),module('a','镜','shot','s')];
 mocks.chapters.mockResolvedValue([{...chapter(blockBody(rows),{pages:[{modules:[{kind:'image',imageUrl:'/api/images/legacy.png'}]}]}),
  blocks:{body:blockBody(rows),blockIds:[],writingStyle:writingStyleOf(rows)}}]);
 await expect(readBookVideoSource(scope)).rejects.toThrow('旧排版');
});
it('keeps a standalone shot independent of unrelated scene context',async()=>{
 const rows=[module('s','只属于这个场景','scene'),module('a','场内镜头','shot','s'),module('b','独立镜头','shot')];
 mocks.chapters.mockResolvedValue([{...chapter(blockBody(rows)),blocks:{body:blockBody(rows),blockIds:[],writingStyle:writingStyleOf(rows)}}]);
 expect((await readBookVideoSource(scope))?.layout.bookScenes?.[1].text).toBe('独立镜头');
});
it('carries explicit multiline dialogue without changing source text and binds role changes to source hash',async()=>{
 const body='  第 1 幕\n推近镜头\n小雨：你好\n再见\n第 2 幕\n关门';
 const row=(id:string,lineCount=1,dialogue=false)=>({id,lineCount,format:'text',parentId:null,collapsed:false,...(dialogue?{videoRole:'dialogue'}:{})});
 const data={...chapter(body),blocks:{body,blockIds:[],writingStyle:[row('a'),row('b'),row('c',2,true),row('d'),row('e')]}};
 mocks.chapters.mockResolvedValue([data]);const source=await readBookVideoSource(scope);
 expect(source?.layout.body).toBe(body.trim());
 expect(source?.layout.bookScenes?.map(s=>s.dialogueText)).toEqual(['小雨：你好\n再见','']);
 expect(source?.layout.dialogueRanges?.map(r=>source.layout.body.slice(r.start,r.end))).toEqual(['小雨：你好','再见']);
 data.blocks.writingStyle[2]=row('c',2);mocks.chapters.mockResolvedValue([data]);
 const unmarked=await readBookVideoSource(scope);expect(unmarked?.sourceHash).not.toBe(source?.sourceHash);
 expect(unmarked?.layout.dialogueRanges).toBeUndefined();
});
it('does not treat an empty tagged module as an instruction to silence the manuscript',async()=>{
 mocks.chapters.mockResolvedValue([{...chapter('正文\n'),blocks:{body:'正文\n',blockIds:[],writingStyle:[{id:'a',format:'text',parentId:null,collapsed:false},{id:'b',format:'text',parentId:null,collapsed:false,videoRole:'dialogue'}]}}]);
 expect((await readBookVideoSource(scope))?.layout.dialogueRanges).toBeUndefined();
});

it("groups five inserted pictures by act, including consecutive pictures and blank lines", async () => {
  mocks.images.mockResolvedValue(Array.from({length: 6}, (_, i) => ({id: i + 1, imageUrl: `/api/images/${i + 1}.png`, availability: "available", status: "selected"})));
  mocks.chapters.mockResolvedValue([chapter([
    "**第 1 幕 · 开场**", "![图片](/api/images/1.png)", "![图片](/api/images/2.png)", "", "开场正文",
    "**第 2 幕 · 对话**", "第二幕正文",
    "**第 3 幕 · 故事**", "第三幕正文", "![图片](/api/images/3.png)", "![图片](/api/images/4.png)", "![图片](/api/images/5.png)", "镜头动作",
    "**第 4 幕**", "结尾",
  ].join("\n"))]);
  const source = await readBookVideoSource(scope);
  expect(source?.layout.bookScenes?.map(scene => scene.referenceImageIds)).toEqual([[1, 2], [], [3, 4, 5], []]);
  expect(source?.layout.bookScenes?.[2].text).toContain("镜头动作");
  expect(source?.layout.bookScenes?.[0].text).not.toContain("第 2 幕");
  expect(source?.layout.illustrations).toHaveLength(5);
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.images.mockResolvedValue([]);
  mocks.audio.mockResolvedValue([]);
});
it('keeps a trailing image module with its preceding act in source provenance', async () => {
  const rows = [module('a','第1幕'),module('prose','旅行者推开木门'),module('image','![图片](/api/images/1.png)'),module('b','第2幕'),module('next','他走进雨中')];
  mocks.images.mockResolvedValue([{id:1,imageUrl:'/api/images/1.png'}]);
  mocks.chapters.mockResolvedValue([{...chapter(blockBody(rows)),blocks:{body:blockBody(rows),blockIds:[],writingStyle:writingStyleOf(rows)}}]);
  const source = (await readBookVideoSource(scope))!;
  expect(source.layout.bookScenes?.map(scene=>scene.sourceModuleIds)).toEqual([['1:a','1:prose','1:image'],['1:b','1:next']]);
  expect(source.layout.bookScenes?.map(scene=>scene.referenceImageIds)).toEqual([[1],[]]);
});
function chapter(body: string, layout: unknown = null) {
  return {
    id: 1,
    title: "原书",
    position: 0,
    blocks: { body, blockIds: ["a", "b"] },
    layout,
  };
}
it("only reuses inserted ready music from the same story, strips narration and invalid refs from prose", async () => {
  mocks.chapters.mockResolvedValue([
    chapter(
      [
        "修伞的故事。",
        bookAudioText(4, 1, "钢琴"),
        bookAudioText(4, 1, "钢琴"),
        bookAudioText(8, 2, "别人的"),
        bookAudioText(4, 3, "未就绪"),
        bookAudioText(4, 4, "有声书", "narration"),
        bookAudioText(4, 4, "伪装音乐"),
      ].join("\n")
    ),
  ]);
  mocks.audio.mockResolvedValue([
    { id: 1, status: "ready", durationFrames: 600, mediaKind: "music" },
    { id: 3, status: "pending", durationFrames: 600 },
    { id: 4, status: "ready", durationFrames: 600, mediaKind: "narration" },
    { id: 5, status: "ready", durationFrames: 600, mediaKind: "music" },
  ]);
  const source = await readBookVideoSource(scope);
  expect(mocks.audio).toHaveBeenCalledWith(scope);
  expect(source?.layout.body).toBe("修伞的故事。");
  expect(source?.musicAssets).toEqual([
    { assetId: 1, title: "钢琴", durationFrames: 600 },
  ]);
  expect(source?.missingMusic).toBe(3);
});
it("reuses selected inline and legacy layout images once, without unused candidates or rejected images", async () => {
  const layout = {
    pages: [
      {
        modules: [
          { kind: "text", bind: "a" },
          { kind: "image", imageUrl: "/api/images/old.png" },
          { kind: "image", imageUrl: "/api/images/inline.png" },
        ],
      },
    ],
  };
  mocks.chapters.mockResolvedValue([
    chapter(
      "第一段。\n![图片](/api/images/inline.png)\n第二段。\n![图片](/api/images/rejected.png)\n![图片](/api/images/missing.png)",
      layout
    ),
  ]);
  mocks.images.mockResolvedValue([
    {
      id: 1,
      imageUrl: "/api/images/inline.png",
      availability: "available",
      status: "selected",
    },
    {
      id: 2,
      imageUrl: "/api/images/old.png",
      availability: "available",
      status: "pending",
    },
    {
      id: 3,
      imageUrl: "/api/images/rejected.png",
      availability: "available",
      status: "rejected",
    },
    {
      id: 4,
      imageUrl: "/api/images/missing.png",
      availability: "missing",
      status: "selected",
    },
    {
      id: 5,
      imageUrl: "/api/images/unused.png",
      availability: "available",
      status: "selected",
    },
  ]);
  const source = await readBookVideoSource(scope);
  expect(source?.layout.body).toBe("第一段。\n第二段。");
  expect(source?.layout.illustrations.map(i => i.assetId)).toEqual([1, 2]);
  expect(source?.missingImages).toBe(2);
  mocks.chapters.mockResolvedValue([chapter("第一段。", layout)]);
  const before = await readBookVideoSource(scope);
  layout.pages[0].modules[1].imageUrl = "/api/images/inline.png";
  expect((await readBookVideoSource(scope))?.sourceHash).not.toBe(
    before?.sourceHash
  );
});
