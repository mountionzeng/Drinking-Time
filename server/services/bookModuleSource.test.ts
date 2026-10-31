import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  story: vi.fn(),
  chapter: vi.fn(),
  assets: vi.fn(),
  image: vi.fn(),
  vision: vi.fn(),
}));
vi.mock("../persistence/storyVisualPersistence", () => ({
  loadOwnedStory: m.story,
}));
vi.mock("../repositories/chapters", () => ({ getChapter: m.chapter }));
vi.mock("./imageAssets", () => ({
  getStoryImageAssets: m.assets,
  materializeImageInput: m.image,
}));
vi.mock("./visionChannel", () => ({ invokeVisionJson: m.vision }));
import {
  resolveBookModuleSource,
  describeBookModule,
} from "./bookModuleSource";
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
