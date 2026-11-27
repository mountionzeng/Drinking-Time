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
it("syncs the linked setting with the manuscript's numbering and the destination shot's own framing",()=>{
  const twoShots={id:3,blocks:{body:"早班车\n画面：砖墙旁的候车厅。\n末班车\n画面：沿用第2镜的场景。前景只有一只手。\n视频：缓慢推近。",writingStyle:
    [["a",null],["a-p","a"],["b",null],["b-p","b"],["b-v","b"]].map(([id,parent])=>({
      id:id!,parentId:parent,format:parent ? "text" as const : "shot" as const,collapsed:false,
    }))}};
  const trial={...book("工作稿"),id:4,blocks:{...book("工作稿").blocks,shotTextOrigin:{shotNo:10}}};
  const target={...linked,publishingVideo:{draftShotId:"book-shot-3-b",sourceModuleIds:["3:b"]}};
  const update=linkedShotChanges({shots:[target]},[book("窗外"),trial,twoShots],new Map(),4,1)!;
  const result=update.body.shots[0];
  expect(result.promptDraft).toContain("砖墙旁的候车厅");
  expect(result.promptDraft).toContain("前景只有一只手");
  expect(result.promptDraft).not.toContain("缓慢推近");
  expect(result).toMatchObject({publishingVideo:{referenceImageIds:[]}});
});
