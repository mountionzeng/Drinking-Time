import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  story: vi.fn(),
  chapter: vi.fn(),
  chapters: vi.fn(),
  assets: vi.fn(),
  image: vi.fn(),
  vision: vi.fn(),
}));
vi.mock("../persistence/storyVisualPersistence", () => ({
  loadOwnedStory: m.story,
}));
vi.mock("../repositories/chapters", () => ({ getChapter: m.chapter, listChapters: m.chapters }));
vi.mock("./imageAssets", () => ({
  getStoryImageAssets: m.assets,
  materializeImageInput: m.image,
}));
vi.mock("./visionChannel", () => ({ invokeVisionJson: m.vision }));
import {
  resolveBookModuleSource,
  describeBookModule,
} from "./bookModuleSource";
import { bookAudioText } from "../../shared/bookAudioBlock";
const target = { storyId: 1, userId: 2, chapterId: 3, moduleId: "selected" };
beforeEach(() => {
  vi.resetAllMocks();
  m.story.mockResolvedValue({ id: 1 });
  m.chapter.mockResolvedValue({
    storyId: 1,
    blocks: {
      body: "无关的文字\n雨中的旧车站",
      writingStyle: [{ id: "other" }, { id: "selected" }],
    },
  });
});
it("reads only the selected saved module and passes ownership to repositories", async () => {
  const source = await resolveBookModuleSource(target);
  expect(await describeBookModule(source)).toBe("雨中的旧车站");
  expect(m.chapter).toHaveBeenCalledWith(3, 2);
  expect(m.vision).not.toHaveBeenCalled();
});
it("rejects foreign stories and missing modules before any AI call", async () => {
  m.story.mockResolvedValue(null);
  await expect(resolveBookModuleSource(target)).rejects.toThrow();
  expect(m.chapter).not.toHaveBeenCalled();
  m.story.mockResolvedValue({ id: 1 });
  m.chapter.mockResolvedValue({ storyId: 8 });
  await expect(resolveBookModuleSource(target)).rejects.toThrow();
  expect(m.vision).not.toHaveBeenCalled();
});
it("uses the owned image bytes for understanding, never its URL as prose", async () => {
  m.chapter.mockResolvedValue({
    storyId: 1,
    blocks: {
      body: "![图片](/api/images/test.png)",
      writingStyle: [{ id: "selected" }],
    },
  });
  m.assets.mockResolvedValue([
    { imageUrl: "/api/images/test.png", availability: "ready" },
  ]);
  m.image.mockResolvedValue("data:image/png;base64,test");
  m.vision.mockResolvedValue({ text: "夜晚\n一盏灯" });
  const source = await resolveBookModuleSource(target);
  expect(await describeBookModule(source)).toBe("夜晚 一盏灯");
  expect(m.vision.mock.calls[0][0].imageUrls).toEqual([
    "data:image/png;base64,test",
  ]);
  m.assets.mockResolvedValue([]);
  await expect(resolveBookModuleSource(target)).rejects.toThrow("图片不可用");
});

it("reads the full merged module and correctly locates the following module",async()=>{
 const style=(id:string,lineCount=1)=>({id,lineCount,format:'text',parentId:null,collapsed:false});
 m.chapter.mockResolvedValue({storyId:1,blocks:{body:'第一段\n\n第二段\n尾段',writingStyle:[style('selected',3),style('last')]}});
 expect((await resolveBookModuleSource(target)).source).toBe('第一段\n\n第二段');
 expect((await resolveBookModuleSource({...target,moduleId:'last'})).source).toBe('尾段');
});

it('resolves every selected module in manuscript order and fingerprints all of them', async()=>{
 const group={...target,moduleIds:['selected','other']};
 const first=await resolveBookModuleSource(group);
 expect(first.parts?.map(p=>p.id)).toEqual(['other','selected']);
 expect(await describeBookModule(first)).toBe('无关的文字\n\n雨中的旧车站');
 m.chapter.mockResolvedValue({storyId:1,blocks:{body:'无关的文字\n改了第二段',writingStyle:[{id:'other'},{id:'selected'}]}});
 expect((await resolveBookModuleSource(group)).fingerprint).not.toBe(first.fingerprint);
 await expect(resolveBookModuleSource({...group,moduleIds:['selected','missing']})).rejects.toThrow('原模块已变化');
 await expect(resolveBookModuleSource({...group,moduleIds:['selected','selected']})).rejects.toThrow('不同模块');
 expect(m.vision).not.toHaveBeenCalled();
});

it('combines mixed sources in a single vision request and checks every image ownership', async()=>{
 m.chapter.mockResolvedValue({storyId:1,blocks:{body:'![图片](/api/images/a.png)\n保留手绘质感\n![图片](/api/images/b.png)\n无关内容',writingStyle:['a','b','c','d'].map(id=>({id}))}});
 m.assets.mockResolvedValue(['/api/images/a.png','/api/images/b.png'].map(imageUrl=>({imageUrl,availability:'ready'})));
 m.image.mockImplementation(async(url:string)=>`bytes:${url}`);m.vision.mockResolvedValue({text:'整合的描述'});
 const group={...target,moduleId:'a',moduleIds:['c','a','b']};
 expect(await describeBookModule(await resolveBookModuleSource(group))).toBe('整合的描述');
 expect(m.vision).toHaveBeenCalledTimes(1);
 expect(m.vision.mock.calls[0][0]).toMatchObject({imageUrls:['bytes:/api/images/a.png','bytes:/api/images/b.png'],userText:expect.stringContaining('[图片 1]\n\n保留手绘质感\n\n[图片 2]')});
 expect(m.vision.mock.calls[0][0].userText).not.toContain('无关内容');
 m.assets.mockResolvedValue([{imageUrl:'/api/images/a.png',availability:'ready'}]);
 await expect(resolveBookModuleSource(group)).rejects.toThrow('图片不可用');
});

it('rejects audio and oversized groups before invoking models',async()=>{
 m.chapter.mockResolvedValue({storyId:1,blocks:{body:`文字\n${bookAudioText(1,2,'音乐')}`,writingStyle:[{id:'a'},{id:'b'}]}});
 await expect(resolveBookModuleSource({...target,moduleId:'a',moduleIds:['a','b']})).rejects.toThrow('音乐模块');
 m.chapter.mockResolvedValue({storyId:1,blocks:{body:`${'字'.repeat(30001)}\n结尾`,writingStyle:[{id:'a'},{id:'b'}]}});
 await expect(resolveBookModuleSource({...target,moduleId:'a',moduleIds:['a','b']})).rejects.toThrow('30000');
 expect(m.vision).not.toHaveBeenCalled();
});

it("whole-book sound reads every chapter in the chosen manuscript and invalidates on later-chapter edits", async () => {
  const rows = [{ id: 3, storyId: 1, blocks: { body: "首章", manuscriptKind: "text" } }, { id: 4, storyId: 1, blocks: { body: "末章", manuscriptKind: "text" } }, { id: 5, storyId: 1, blocks: { body: "其他版本", manuscriptKind: "storyboard" } }];
  m.chapters.mockResolvedValue(rows);
  const request = { ...target, moduleId: "whole-book", wholeBook: { kind: "text" as const, dialogueOnly: false } };
  const result = await resolveBookModuleSource(request);
  expect(result.source).toBe("首章\n\n末章");
  rows[1].blocks.body = "已改末章";
  expect((await resolveBookModuleSource(request)).fingerprint).not.toBe(result.fingerprint);
  await expect(resolveBookModuleSource({ ...request, wholeBook: { ...request.wholeBook, kind: "storyboard" } })).rejects.toThrow("类型已变化");
  expect(m.vision).not.toHaveBeenCalled();
});
