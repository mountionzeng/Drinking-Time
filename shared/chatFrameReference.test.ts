import { describe, expect, it } from "vitest";
import { explicitReferenceShotNumber, isFrameReferenceChat, referenceFrameOffsets, chatFrameReferenceSchema } from "./chatFrameReference";

describe("free video reference chat", () => {
  it.each(["第03镜先抽帧，再按美术体系改云和音乐", "从第3镜抽出三张参考帧", "capture reference frames from shot 3"])("recognizes inspection before paid production: %s", text => expect(isFrameReferenceChat(text)).toBe(true));
  it.each(["不要抽帧，修改音乐", "生成两张图片", "把图片设为参考帧", "don't extract frames"])("does not capture unrelated requests: %s", text => expect(isFrameReferenceChat(text)).toBe(false));
  it("resolves numeric and Chinese shot names, rejecting multiple targets", () => {
    expect(explicitReferenceShotNumber("我想重新渲染03镜头，先抽帧")).toBe(3);
    expect(explicitReferenceShotNumber("第十二镜抽帧")).toBe(12);
    expect(() => explicitReferenceShotNumber("第1镜和第2镜抽帧")).toThrow();
  });
  it("bounds and deduplicates samples and never samples the end-exclusive frame", () => {
    expect(referenceFrameOffsets("先抽帧", 435)).toEqual([65,217,369]);
    expect(referenceFrameOffsets("抽帧", 1)).toEqual([0]);
    expect(referenceFrameOffsets("抽第2秒、第2秒、第4秒", 150)).toEqual([60,120]);
    expect(() => referenceFrameOffsets("第5秒抽帧", 150)).toThrow();
  });
  it("does not restore arbitrary URLs or invalid identities as images", () => {
    expect(chatFrameReferenceSchema.safeParse({imageUrl: "javascript:alert(1)"}).success).toBe(false);
  });
});
import { framePaletteReferenceRequest,selectedObjectPaletteReference } from "./chatFrameReference";

it("keeps clicked candidate and explicitly named object palette reference distinct",()=>{
  expect(selectedObjectPaletteReference("按物体分析，参考图片 #55 的配色，只改树冠，其他不变",62)).toBe(55);
  for(const text of ["参考图片 #55 的配色修改图片 #62","按物体参考图片 #62 的配色","按物体参考图片 #55 的配色修改图片 #99","按物体怎么参考图片 #55 的配色？","按物体，不要参考图片 #55 的配色"])
    expect(selectedObjectPaletteReference(text,62)).toBeNull();
});

it("binds palette references to the pinned frame without copying image content", () => {
  expect(framePaletteReferenceRequest("保留这一帧的森林，只参考这张图的颜色，其他保持原样", 57, 55))
    .toBe("保留图片 #57的森林，只参考图片 #55的颜色，其他保持原样");
  expect(framePaletteReferenceRequest("只参考@图片的配色，其他保持原样", 57, 55))
    .toContain("修改图片 #57");
  expect(framePaletteReferenceRequest("按图片 #55 的颜色改这一帧", 57, 55)).toContain("改图片 #57");
});
it("does not silently discard extra edits or reference a different named image", () => {
  for (const text of ["参考这张图的颜色，再加一棵树", "参考这张图的材质", "不要参考这张图的颜色", "怎么参考这张图的颜色？", "按图片 #44 的颜色改这一帧", "按这张图的颜色改图片 #44"]) {
    expect(framePaletteReferenceRequest(text, 57, 55)).toBeNull();
  }
  expect(framePaletteReferenceRequest("参考这张图的颜色", 55, 55)).toBeNull();
});
