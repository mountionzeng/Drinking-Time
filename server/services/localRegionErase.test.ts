import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createStory, getStoryById, updateStory } from "../repositories/stories";
import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { resetMemoryStateForTesting } from "../repositories/runtime";
import { createChatImageEditPlan, keyframeBoardImageIds } from "../../shared/chatImageEditPlan";
import { inlineImageToken } from "../../shared/inlineChatImages";
import { quoteRenderProfile } from "../../shared/renderProfiles";
import { submitRender } from "./render/submitRender";
import { eraseKeyframeRegions } from "./eraseKeyframeRegions";
import { ownedPictureBytes } from "./chatPictureRegion";
import { storeImageBytes } from "./imageGen";

vi.mock("./chatPictureRegion", async original => ({ ...await original<typeof import("./chatPictureRegion")>(), ownedPictureBytes: vi.fn() }));
vi.mock("./imageGen", async original => ({ ...await original<typeof import("./imageGen")>(), storeImageBytes: vi.fn() }));
const rect = { left: .25, top: .25, right: .75, bottom: .75 };
const background = [192, 213, 130, 220];
async function source() {
  const bytes = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    bytes.set(x >= 10 && x < 22 && y >= 11 && y < 20 ? [5, 2, 7, 255] : background, (y * 32 + x) * 4);
  }
  return sharp(bytes, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer();
}
beforeEach(() => { resetMemoryStateForTesting(); vi.resetAllMocks(); });
it("clears the selected ink, keeps alpha, size and every outside pixel at zero cost", async () => {
  expect(quoteRenderProfile("image.local-erase")?.computeUnits).toBe(0);
  const result = await submitRender("image.local-erase", { bytes: await source(), region: rect });
  if (result.status !== "ok") throw Error(result.message);
  const {data,info} = await sharp(result.png).raw().toBuffer({resolveWithObject:true});
  expect(info).toMatchObject({ width:32, height:32, channels:4 });
  for (let i=0; i<data.length; i++) expect(data[i]).toBe(background[i%4]);
  expect((await submitRender("image.local-erase",{bytes:await source(), region:{left:0,right:1,top:0,bottom:1}})).status).toBe("error");
});
it("resumes partial saves, publishes one ordered board and rejects other regions, owners or stale cards", async () => {
  const story = await createStory({userId:8, title:"test", body:{}});
  const originals = [];
  for (const name of ["a","b","c"]) originals.push(await createGeneratedImage({storyId:story.id,userId:8,imageUrl:"/"+name,isCurrent:false}));
  const ids = originals.map(image=>image.id);
  const selectionQuote = {storyId:story.id,stableShotId:"s05"};
  const board = {id:"saved-photos:original",who:"s",selectionQuote,text:"关键帧初稿 "+ids.map(inlineImageToken).join(" ")};
  const plan = createChatImageEditPlan(originals.map(image=>({imageId:image.id,imageUrl:image.imageUrl,label:"图"})),"擦掉标题");
  plan.keyframeBoardId=board.id;plan.regionScanSourceId=ids[0];
  plan.images.forEach((image,index)=>{image.role=index===1?"omit":"target";if(index!==1)image.region=rect;});
  const card = {id:"region-scan:test",who:"s",selectionQuote,imageEditPlan:plan};
  const body={shots:[{stableShotId:"s05",shotNo:5}],messages:[board,card],draft:"keep"};
  await updateStory(story.id,8,{body});
  const input={storyId:story.id,userId:8,planId:card.id,targets:[{imageId:ids[0],region:rect},{imageId:ids[2],region:rect}]};
  await expect(eraseKeyframeRegions({...input,userId:9})).rejects.toThrow("无权");
  await expect(eraseKeyframeRegions({...input,targets:[{imageId:ids[1],region:rect}]})).rejects.toThrow("选区");
  await updateStory(story.id,8,{body:{...body,messages:[board,card,{...board,id:"saved-photos:new"}]}});
  await expect(eraseKeyframeRegions(input)).rejects.toThrow("最新");
  await updateStory(story.id,8,{body});
  vi.mocked(ownedPictureBytes).mockResolvedValue(await source());
  vi.mocked(storeImageBytes).mockResolvedValueOnce({status:"ok",imageUrl:"/first"}).mockRejectedValueOnce(Error("保存中断")).mockResolvedValue({status:"ok",imageUrl:"/second"});
  await expect(eraseKeyframeRegions(input)).rejects.toThrow("保存中断");
  const receipt=await eraseKeyframeRegions(input);
  expect(await eraseKeyframeRegions(input)).toEqual(receipt);
  expect(storeImageBytes).toHaveBeenCalledTimes(3);
  const images=await getStoryGeneratedImages(story.id,8);
  const outputIds=keyframeBoardImageIds(receipt.id,receipt.text);
  expect(outputIds).toEqual([images.find(i=>i.parentImageId===ids[0])!.id,ids[1],images.find(i=>i.parentImageId===ids[2])!.id]);
  expect(images.filter(i=>i.parentImageId)).toHaveLength(2);
  expect(images.filter(i=>i.parentImageId).every(i=>!i.isCurrent && i.shotIdentity==="s05")).toBe(true);
  expect((await getStoryById(story.id,8))?.body).toMatchObject({draft:"keep",messages:[board,card,{id:receipt.id}]});
});
