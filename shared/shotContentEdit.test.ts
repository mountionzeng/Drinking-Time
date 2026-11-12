import { expect, it } from "vitest";
import { parseShotContentEdits, parseContentTargetReply, proposeContentTargets } from "./shotContentEdit";
it("applies global preservation constraints before or after every content edit", () => {
  for (const text of ["其他不要变，森林树种更多，最后云层更厚", "森林树种更多，最后云层更厚，其他不要变"]) {
    const edits = parseShotContentEdits(text)!;
    expect(edits).toHaveLength(2);
    expect(edits.every(e => e.instruction.includes("其他不要变"))).toBe(true);
    expect(edits[0].instruction).not.toContain("更厚");
  }
});
it("does not intercept free grading, adoption or explicit image commands", () => {
  for (const text of ["森林视频压暗", "第3镜采用视频 Take 16", "图片 #2046 森林要更多", "把森林拆成两段"]) expect(parseShotContentEdits(text)).toBeNull();
});
it("keeps the requested change when preservation is joined with but", () => {
  expect(parseShotContentEdits("森林更多树种但颜色不变")).toMatchObject([
    { instruction: "森林更多树种；但颜色不变", subjects: ["forest"] },
  ]);
});
it("supports target corrections and cancellation without generation", () => {
  expect(parseContentTargetReply("森林用图片 #2046")).toMatchObject({kind:"reassign",subject:"forest",imageId:2046});
  expect(parseContentTargetReply("取消")).toMatchObject({kind:"cancel"});
  expect(parseContentTargetReply("confirm")).toMatchObject({kind:"confirm"});
});
it("returns alternatives with low confidence if image features are unavailable", () => {
  const result = proposeContentTargets({clauses:parseShotContentEdits("森林树种更多")!,brief:"",images:[1,2].map(imageId=>({imageId,imageUrl:`/${imageId}`,role:"other" as const,timeSec:null,signature:null}))});
  expect(result).toHaveLength(1); expect(result[0].confidence).toBe("low");
});

it("recognizes one explicitly named shot image without confusing adoption or grading",async()=>{
 const {parseExplicitShotImageEdit}=await import("./shotContentEdit");
 expect(parseExplicitShotImageEdit("修改第03镜图片 #2046，只让色彩更细腻，明暗不变")).toEqual({shotNo:3,imageId:2046});
 for(const text of ["第3镜图片 #2046 替换原图","第3镜图片 #2046 设为首帧","第3镜图片 #2046 只调亮度","修改第3镜图片 #2046 和图片 #2047"])expect(parseExplicitShotImageEdit(text)).toBeNull();
});
