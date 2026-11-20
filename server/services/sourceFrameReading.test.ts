import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { readFramePixels, renderSourceDirection, frameReadingSummary } from "./sourceFrameReading";
import { renderViaGate } from "./renderGate";
const raster = async (split:boolean) => {
  const data=Buffer.alloc(40*40*3,80);
  if (split) data.fill(200,10*40*3);
  return sharp(data,{raw:{width:40,height:40,channels:3}}).png().toBuffer();
};
it("distinguishes an actual broad join from a flat image, with location and independent quadrant tones",async()=>{
 const flat=await readFramePixels(await raster(false)),split=await readFramePixels(await raster(true));
 expect(flat.boundaries).toEqual([]);expect(flat.tones).toEqual([80,80,80,80]);
 expect(split.boundaries[0]).toEqual({axis:"row",position:25,coverage:100});
 expect(split.tones).toEqual([140,140,200,200]);expect(frameReadingSummary(split)).toContain("25%");
});
it("reads all inputs before render, keeps roles, and blocks any unreadable reference before the provider",async()=>{
 const flat="data:image/png;base64,"+(await raster(false)).toString("base64"),split="data:image/png;base64,"+(await raster(true)).toString("base64");
 const provider=vi.fn(async(prompt:string)=>prompt);
 const facts=await renderSourceDirection([flat,split]);
 expect(facts).toContain("ref2 40x40");expect(facts).toContain("y=25%");
 const seen=await renderViaGate({prompt:"原图纸感和按钮清晰",preservePrompt:true,referenceImages:[flat,split]},provider);
 expect(seen).toContain(facts);expect(seen).toContain("原图纸感");
 await expect(renderViaGate({prompt:"test",referenceImages:[flat,"data:image/png;base64,AAAA"]},provider)).rejects.toThrow("未提交生成");
 expect(provider).toHaveBeenCalledTimes(1);
});
