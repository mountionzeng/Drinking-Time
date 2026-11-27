import { expect, it } from "vitest";
import { matchesSavedPictureSource } from "./savedPictureSource";
import {readBookShotChapter} from "@shared/bookShotDocument";

const style = [
  { id: "shot", parentId: null, format: "shot" as const, collapsed: false },
  { id: "picture", parentId: "shot", format: "text" as const, collapsed: false },
  { id: "other", parentId: "shot", format: "text" as const, collapsed: false },
];
const picture = "画面：米白色的书页。";
const base = {body: ["书页", picture, "音乐：风声"].join("\n"), writingStyle: style};
const selection = { id: "picture", text: picture, prompt: "米白色的书页。", selectionId: "picture" };

it("requires the source shot's saved setting to match even when the destination text did not change",()=>{
  const raw = "画面：同一条步道。";
  const doc={body:["步道","画面：清晨的公园步道。","树荫",raw].join("\n"), writingStyle:[
    {id:"first",parentId:null,format:"shot" as const,collapsed:false},
    {id:"scene",parentId:"first",format:"text" as const,collapsed:false},
    {id:"next",parentId:null,format:"shot" as const,collapsed:false},
    {id:"picture",parentId:"next",format:"text" as const,collapsed:false},
  ]};
  const sceneLink=readBookShotChapter({id:2,blocks:doc},undefined,9).shots[1].link;
  const selected={id:"picture",text:raw,selectionId:"picture",prompt:"同一条步道。",shotOwner:"next",precedingShots:9,sceneLink};
  expect(sceneLink?.sourceNumber).toBe(10);
  expect(matchesSavedPictureSource(selected,doc,doc)).toBe(true);
  expect(matchesSavedPictureSource(selected,doc,{...doc,body:doc.body.replace("清晨","黄昏")})).toBe(false);
});

it("can render identical picture directions while a different module has unsaved edits", () => {
  const local = {...base, body: base.body.replace("风声", "留白")};
  expect(matchesSavedPictureSource(selection, local, base)).toBe(true);
  expect(matchesSavedPictureSource({ id: "picture", text: picture }, local, base)).toBe(true);
});
it("requires the saved text, stable module, shot and full image prompt to match", () => {
  expect(matchesSavedPictureSource(selection, base, {...base, body: base.body.replace("米白色","黑色")})).toBe(false);
  expect(matchesSavedPictureSource(selection, base, {...base, writingStyle: style.map(s => ({...s,id:s.id+"2"}))})).toBe(false);
  expect(matchesSavedPictureSource(selection, base, {...base, writingStyle: style.map(s=>({...s,parentId:null}))})).toBe(false);
  expect(matchesSavedPictureSource({...selection, prompt:"另一个要求"}, base, base)).toBe(false);
  expect(matchesSavedPictureSource({id:"absent",text:picture},base,base)).toBe(false);
});
