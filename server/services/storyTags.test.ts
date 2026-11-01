import { beforeEach, describe, expect, it } from "vitest";
import { createStory,getStoryById,listUserStories } from "../repositories/stories";
import { resetMemoryStateForTesting } from "../db";
import { getStoryTags,setStoryTags } from "./storyTags";
import { prepareStoryBody,mergeStaleStoryBody } from "./storySync";
import { matchesStorySearch } from "../../shared/storyTags";
process.env.DATABASE_URL="";
beforeEach(()=>resetMemoryStateForTesting());
describe("user story classification tags",()=>{
 it("persists tags, exposes searchable list metadata, and preserves source materials",async()=>{
  const row=await createStory({userId:71,title:"纸船",body:{messages:[{role:"user",content:"原话"}],materialCapture:{id:"source"}}});
  await setStoryTags(71,row.id,["旅行","家人"],[]);
  expect(await getStoryTags(71,row.id)).toEqual({tags:["旅行","家人"]});
  const saved=await getStoryById(row.id,71);
  expect(saved!.body).toMatchObject({messages:[{content:"原话"}],materialCapture:{id:"source"}});
  const list=await listUserStories(71);
  expect(matchesStorySearch(list[0],"#旅行")).toBe(true);
  expect(matchesStorySearch(list[0],"不存在")).toBe(false);
  expect(prepareStoryBody({storyTags:[]},99,saved!.body).storyTags).toEqual(["旅行","家人"]);
  expect(mergeStaleStoryBody(saved!.body,{storyTags:[]},99).storyTags).toEqual(["旅行","家人"]);
  await setStoryTags(71,row.id,[],["旅行","家人"]);
  expect(await getStoryTags(71,row.id)).toEqual({tags:[]});
 });
 it("rejects another owner and a stale tag edit",async()=>{
  const row=await createStory({userId:71,title:"纸船",body:{}});
  await expect(setStoryTags(72,row.id,["别人"],[])).rejects.toMatchObject({code:"NOT_FOUND"});
  await setStoryTags(71,row.id,["工作"],[]);
  await expect(setStoryTags(71,row.id,["旅行"],[])).rejects.toMatchObject({code:"CONFLICT"});
  expect(await getStoryTags(71,row.id)).toEqual({tags:["工作"]});
 });
});
