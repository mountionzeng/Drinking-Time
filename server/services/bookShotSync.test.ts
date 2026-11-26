import { expect, it } from "vitest";
import { linkedShotChanges } from "./bookShotSync";
const book = (picture:string, url="/api/a") => ({id:2,blocks:{body:["窗边","画面提示词："+picture,"运镜提示词：慢推","旁白｜第2秒开口","早安","音效提示词：风声","![图片]("+url+")"].join("\n"),
  writingStyle:["head","p","m","v","d","s","i"].map((id,i)=>({id,parentId:i?"head":null,format:i?"text" as const:"shot" as const,collapsed:false,...(id==="d"?{videoRole:"dialogue" as const}:{})}))}});
const linked = {stableShotId:"clip",shotNo:1,promptDraft:"旧图",publishingVideo:{draftShotId:"book-shot-2-head",sourceModuleIds:["2:head"],referenceImageIds:[8]}};
it("updates the exact linked shot, keeps old field versions and reconciles later book edits per field",()=>{
 const first=linkedShotChanges({shots:[linked,{shotNo:2}]},[book("窗")],new Map([["/api/a",9]]),4,1)!;
 expect(first.body.shots[0]).toMatchObject({dialogue:"早安",videoPrompt:"运镜提示词：慢推",sound:expect.stringContaining("风声"),publishingVideo:{referenceImageIds:[9]}});
 expect(first.body.shots[1]).toEqual({shotNo:2});
 expect(first.body.storyboardFieldVersions.tracks.promptDraft.history[0].values.clip).toBe("旧图");
 first.body.shots[0].videoPrompt="剪辑师改过";
 expect(linkedShotChanges(first.body,[book("窗")],new Map([["/api/a",9]]),4,1)).toBeUndefined();
 const next=linkedShotChanges(first.body,[book("窗外","/api/b")],new Map([["/api/b",10]]),4,1)!;
 expect(next.body.shots[0]).toMatchObject({videoPrompt:"剪辑师改过",promptDraft:"窗外",publishingVideo:{referenceImageIds:[10]}});
});
