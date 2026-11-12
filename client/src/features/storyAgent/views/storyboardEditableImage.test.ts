
import {expect,it} from "vitest";
import {storyboardEditableImage,storyboardShotFrameImages} from "./storyboardReviewModel";
import type {CreationEditorShot} from "@/features/creationEditor/types";
it("edits unadopted video reference frames without displaying or assigning them as primary frames",()=>{
 const shot={shotNo:3,stableShotId:"s3",imageVersions:[{id:20,shotIdentity:"s3",shotNo:3,imageUrl:"/20",referenceOnly:true}]} as CreationEditorShot;
 expect(storyboardShotFrameImages(shot)).toHaveLength(0);expect(storyboardEditableImage(shot,20)?.id).toBe(20);
 expect(shot.imageId).toBeUndefined();expect(storyboardEditableImage({...shot,stableShotId:"other"},20)).toBeUndefined();
 expect(storyboardEditableImage({...shot,imageVersions:[{...shot.imageVersions![0],status:"rejected"}]},20)).toBeUndefined();
});