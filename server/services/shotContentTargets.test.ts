import { beforeEach, expect, it } from "vitest";
import sharp from "sharp";
import { createStory } from "../repositories/stories";
import { createGeneratedImage } from "../repositories/images";
import { resetMemoryStateForTesting } from "../repositories/runtime";
import { imageSignature, proposeShotContentEdit, shotFrameRoles } from "./shotContentTargets";
beforeEach(()=>resetMemoryStateForTesting());
it("reads only the owned story's selected shot and retains protected words",async()=>{
 const story=await createStory({userId:1,title:"test",body:{shots:[{stableShotId:"s3",shotNo:3},{stableShotId:"s4",shotNo:4}]}});
 const forest=await createGeneratedImage({storyId:story.id,userId:1,shotIdentity:"s3",imageUrl:"/forest",prompt:"源 7s",isCurrent:false});
 await createGeneratedImage({storyId:story.id,userId:1,shotIdentity:"s4",imageUrl:"/other",isCurrent:false});
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:"#228833"}}).png().toBuffer();
 const p=await proposeShotContentEdit({storyId:story.id,userId:1,stableShotId:"s3",text:"森林更多树种，其他不变",readBytes:async()=>bytes});
 expect(p).toMatchObject({proposals:[{imageId:forest.id,instruction:expect.stringContaining("其他不变")}]});
 if(!("error" in p))expect(p.images).toHaveLength(1);
 expect(await proposeShotContentEdit({storyId:story.id,userId:2,stableShotId:"s3",text:"森林更多树种"})).toHaveProperty("error");
});
it("computes local features and tolerates legacy frame settings",async()=>{
 const bytes=await sharp({create:{width:5,height:5,channels:3,background:"#22aa33"}}).png().toBuffer();
 expect((await imageSignature(bytes)).green).toBeGreaterThan(.9);
 expect(shotFrameRoles('{"firstFrameImageId":3,"lastFrameImageId":5,"referenceFrameImageIds":[4]}')).toEqual({firstImageId:3,lastImageId:5,referenceImageIds:[4]});
 expect(shotFrameRoles("broken")).toMatchObject({firstImageId:null});
});

it("resolves explicit image IDs without reading heuristics and rejects another shot or owner",async()=>{
 const story=await createStory({userId:1,title:"exact",body:{shots:[{stableShotId:"s3",shotNo:3},{stableShotId:"s4",shotNo:4}]}});
 const image=await createGeneratedImage({storyId:story.id,userId:1,shotIdentity:"s3",parentImageId:1,imageUrl:"/exact",isCurrent:false});
 const text=`修改第03镜图片 #${image.id}，只让色彩更细腻，明暗不变`;
 const p=await proposeShotContentEdit({storyId:story.id,userId:1,stableShotId:"s3",text,readBytes:async()=>{throw new Error("must not read");}});
 expect(p).toMatchObject({images:[{imageId:image.id,signature:null}],proposals:[{imageId:image.id,instruction:text,confidence:"high"}]});
 expect(await proposeShotContentEdit({storyId:story.id,userId:1,stableShotId:"s4",text})).toHaveProperty("error");
 expect(await proposeShotContentEdit({storyId:story.id,userId:2,stableShotId:"s3",text})).toHaveProperty("error");
});
