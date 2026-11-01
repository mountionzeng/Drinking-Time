import { TRPCError } from "@trpc/server";
import { getStoryById } from "../repositories/stories";
import { readStoryTags, storyTagsSchema } from "../../shared/storyTags";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import { persistPreparedStoryBody, StoryBodyRevisionConflictError } from "./storyBodyPersistence";
export async function getStoryTags(userId:number, storyId:number) {
  const row = await getStoryById(storyId,userId);
  if (!row) throw new TRPCError({code:"NOT_FOUND",message:"故事不存在或无权访问"});
  return {tags:readStoryTags(row.body)};
}
export async function setStoryTags(userId:number, storyId:number, tags:string[], expectedTags:string[]) {
  const next = storyTagsSchema.parse(tags);
  for(let attempt=0;attempt<3;attempt++) {
    const row = await getStoryById(storyId,userId);
    if (!row) throw new TRPCError({code:"NOT_FOUND",message:"故事不存在或无权访问"});
    if(JSON.stringify(readStoryTags(row.body)) !== JSON.stringify(expectedTags)) throw new TRPCError({code:"CONFLICT",message:"标签已在其他页面修改，请刷新标签后再试"});
    const revision = getStoryRevision(row.body);
    const body = prepareStoryBody(row.body,revision+1,row.body);
    body.storyTags = next;
    try { await persistPreparedStoryBody({userId,storyId,expectedRevision:revision,body}); return {tags:next}; }
    catch(e) { if (!(e instanceof StoryBodyRevisionConflictError)) throw e; }
  }
  throw new TRPCError({code:"CONFLICT",message:"故事正在保存，请稍后再试"});
}
