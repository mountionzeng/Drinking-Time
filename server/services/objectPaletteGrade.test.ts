import { expect, it } from "vitest";
import sharp from "sharp";
import { gradeObjectPalette } from "./objectPaletteGrade";
const assignment = { targetEnglish:"tree crowns", referenceObjectEnglish:"tree canopies", colors:[{hex:"#a3dca6",sharePercent:100}],
  regions:[{contour:[[200,200],[500,200],[800,200],[800,500],[800,800],[500,800],[200,800],[200,500]],anchor:[500,500]}],
  protectedSamples:[[50,50],[950,50],[950,950]] };
async function fixture() {
  const data=Buffer.alloc(80*80*4);
  for(let y=0;y<80;y++) for(let x=0;x<80;x++) {
    const p=(y*80+x)*4, tree=x>=16&&x<64&&y>=16&&y<64;
    const color=tree?[60+y,140+y,215]:[240,190,130];
    color.forEach((v,c)=>data[p+c]=v);data[p+3]=200;
  }
  return sharp(data,{raw:{width:80,height:80,channels:4}}).png().toBuffer();
}
it("changes the named region visibly, preserves L, alpha, dimensions and every mask-exterior pixel exactly",async()=>{
  const bytes=await fixture(),result=await gradeObjectPalette(bytes,[assignment]);
  expect(result.stats).toMatchObject({width:80,height:80,outsideChangedPixels:0,regions:1});
  expect(result.stats.meanChromaChange).toBeGreaterThan(10);
  expect(result.stats.maxLDrift).toBeLessThan(1);
  const original=await sharp(bytes).raw().toBuffer(),output=await sharp(result.png).raw().toBuffer();
  const mask=await sharp(result.maskPng).greyscale().raw().toBuffer();
  for(let i=0;i<mask.length;i++) {
    expect(output[i*4+3]).toBe(original[i*4+3]);
    if(mask[i]===0) expect(output.subarray(i*4,i*4+4)).toEqual(original.subarray(i*4,i*4+4));
  }
  const center=(40*80+40)*4;expect(output[center+1]).toBeGreaterThan(output[center+2]);
});
it.each([
  [],
  [{...assignment,regions:[]}],
  [{...assignment,regions:[{...assignment.regions[0],anchor:[0,0]}]}],
  [{...assignment,regions:[{...assignment.regions[0],contour:[[200,200],[200,200],[200,200],[200,200],[200,200],[200,200]]}]}],
  [{...assignment,protectedSamples:[[1100,0],[0,0],[0,0]]}],
].map(assignments=>({assignments})))("rejects unusable masks without producing an image",async ({assignments})=>{
  await expect(gradeObjectPalette(await fixture(),assignments)).rejects.toThrow();
});
it("does not claim success when a valid region already has the requested color",async()=>{
  const data=await sharp(await fixture()).raw().toBuffer();
  for(let y=16;y<64;y++)for(let x=16;x<64;x++) [163,220,166].forEach((v,c)=>data[(y*80+x)*4+c]=v);
  const bytes=await sharp(data,{raw:{width:80,height:80,channels:4}}).png().toBuffer();
  await expect(gradeObjectPalette(bytes,[assignment])).rejects.toThrow(/Color change is too small/);
});
it("supports other requested colors, rather than hardcoding green trees",async()=>{
  const r=await gradeObjectPalette(await fixture(),[{...assignment,colors:[{hex:"#ed9eae",sharePercent:100}]}]);
  const data=await sharp(r.png).raw().toBuffer(),p=(40*80+40)*4;
  expect(data[p]).toBeGreaterThan(data[p+1]);
});
