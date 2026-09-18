import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {cardSelectionSchema} from '../../shared/storyShareCard';
import {requestShiguangShareCard} from '../services/shiguangStoryAuthorityClient';

import { protectedProcedure, router } from "../_core/trpc";
import { getShiguangStoryAccess, listShiguangStoryAccess, type BoundShiguangStory } from "../services/shiguangStoryAccess";
import { readShiguangAuthoritativeMedia, readShiguangAuthoritativeStory, writeShiguangAuthoritativeStory, type AuthoritativeStoryDocument,
  type ShiguangStoryMediaInput,type ShiguangStoryMediaResult,type ShiguangStoryWriteInput,type ShiguangStoryWriteResult } from "../services/shiguangStoryAuthorityClient";

type Dependencies={list:(userId:number)=>Promise<BoundShiguangStory[]>;get:(userId:number,accessId:number)=>Promise<BoundShiguangStory|undefined>;
  read:(binding:BoundShiguangStory)=>Promise<AuthoritativeStoryDocument>;write:(binding:BoundShiguangStory,input:ShiguangStoryWriteInput)=>Promise<ShiguangStoryWriteResult>;
  media?:(binding:BoundShiguangStory,input:ShiguangStoryMediaInput)=>Promise<ShiguangStoryMediaResult>;
  card?:typeof requestShiguangShareCard};
const blockId=z.string().regex(/^block-[a-f0-9]{64}$/),text=z.string().max(20000);
const edit=z.discriminatedUnion("action",[
  z.object({action:z.literal("edit"),blockId,text}).strict(),
  z.object({action:z.literal("merge"),blockIds:z.array(blockId).min(2).max(64),text}).strict().refine(value=>new Set(value.blockIds).size===value.blockIds.length),
  z.object({action:z.literal("appendOwn"),chapterId:z.string().regex(/^chapter-[a-z0-9-]{1,60}$/),text}).strict(),
]);
export function createShiguangStoryAccessRouter(deps:Dependencies){return router({
  card:protectedProcedure.input(z.discriminatedUnion('operation',[
    z.object({accessId:z.number().int().positive(),operation:z.literal('source')}).strict(),
    cardSelectionSchema.extend({accessId:z.number().int().positive(),operation:z.literal('preview')}).strict(),
    cardSelectionSchema.extend({accessId:z.number().int().positive(),operation:z.literal('export'),descriptorId:z.string().regex(/^card-[a-f0-9]{64}$/)}).strict(),
  ])).mutation(async({ctx,input})=>{
    const binding=await deps.get(ctx.user.id,input.accessId);
    if(!binding)throw new TRPCError({code:'NOT_FOUND',message:'故事不可用'});
    const {accessId:_,...selection}=input;
    try{if(!deps.card)throw new Error('story_authority_unavailable');return await deps.card(binding,selection);}
    catch(error){const code=error instanceof Error?error.message:'';
      throw new TRPCError({code:code==='story_version_conflict'?'CONFLICT':code==='story_access_revoked'?'FORBIDDEN':'SERVICE_UNAVAILABLE',
        message:code==='story_version_conflict'?'故事已更新，请重新选择':code==='story_access_revoked'?'这段内容暂不可公开发布':'暂时无法生成故事卡，请稍后重试'});}
  }),
  list:protectedProcedure.query(async({ctx})=>(await deps.list(ctx.user.id)).map(binding=>({id:binding.id,title:binding.title,status:binding.status}))),
  read:protectedProcedure.input(z.object({accessId:z.number().int().positive()}).strict()).query(async({ctx,input})=>{
    const binding=await deps.get(ctx.user.id,input.accessId);if(!binding)throw new TRPCError({code:"NOT_FOUND",message:"故事不可用"});
    try{return await deps.read(binding);}catch(error){const code=String((error as Error)?.message||"");
      if(code==="story_access_revoked")throw new TRPCError({code:"NOT_FOUND",message:"故事不可用"});
      throw new TRPCError({code:"SERVICE_UNAVAILABLE",message:"暂时无法读取故事，请稍后重试"});}
  }),
  media:protectedProcedure.input(z.object({accessId:z.number().int().positive(),revisionId:z.string().regex(/^revision-[a-zA-Z0-9-]{1,119}$/),
    chapterId:z.string().regex(/^chapter-[a-z0-9-]{1,60}$/),photoId:z.string().regex(/^photo-[a-z0-9-]{1,120}$/)}).strict()).query(async({ctx,input})=>{
    const binding=await deps.get(ctx.user.id,input.accessId);if(!binding)throw new TRPCError({code:"NOT_FOUND",message:"照片不可用"});
    const {accessId:_,...mediaInput}=input;try{if(!deps.media)throw new Error("story_authority_unavailable");return await deps.media(binding,mediaInput);}
    catch(error){const code=String((error as Error)?.message||"");if(code==="story_access_revoked"||code==="story_version_conflict")
      throw new TRPCError({code:"NOT_FOUND",message:"照片不可用"});throw new TRPCError({code:"SERVICE_UNAVAILABLE",message:"暂时无法读取照片，请稍后重试"});}
  }),
  write:protectedProcedure.input(z.object({accessId:z.number().int().positive(),revisionId:z.string().regex(/^revision-[a-zA-Z0-9-]{1,119}$/),
    expectedVersion:z.number().int().positive().max(2147483647),requestId:z.string().regex(/^[a-zA-Z0-9-]{8,100}$/),edits:z.array(edit).min(1).max(128)}).strict()
    .refine(value=>value.edits.reduce((length,item)=>length+item.text.length,0)<=20000,{message:"修改文字过长"})).mutation(async({ctx,input})=>{
    const binding=await deps.get(ctx.user.id,input.accessId);if(!binding)throw new TRPCError({code:"NOT_FOUND",message:"故事不可用"});
    const {accessId:_,...writeInput}=input;
    try{return await deps.write(binding,writeInput);}catch(error){const code=String((error as Error)?.message||"");
      if(code==="story_access_revoked")throw new TRPCError({code:"NOT_FOUND",message:"故事不可用"});
      if(code==="story_version_conflict")throw new TRPCError({code:"CONFLICT",message:"故事已有更新，你的修改仍保留在电脑上，请刷新核对后再保存"});
      throw new TRPCError({code:"SERVICE_UNAVAILABLE",message:"暂时无法保存故事，请稍后重试"});}
  }),
});}
export const shiguangStoryAccessRouter=createShiguangStoryAccessRouter({list:listShiguangStoryAccess,get:getShiguangStoryAccess,read:readShiguangAuthoritativeStory,
  write:writeShiguangAuthoritativeStory,media:readShiguangAuthoritativeMedia,card:requestShiguangShareCard});
