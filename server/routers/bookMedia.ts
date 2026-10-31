import { quoteStoryNarration } from "../services/storyNarration";
import { insertMemoryCard } from "../repositories/memoryCards";
import { randomUUID, createHash } from "node:crypto";
import { resolveBookModuleSource, describeBookModule } from "../services/bookModuleSource";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
const target=z.object({storyId:z.number().int().positive(),chapterId:z.number().int().positive(),moduleId:z.string().min(1).max(100)});
const videoIdentity=(chapterId:number,moduleId:string)=>`book:${chapterId}:${createHash("sha256").update(moduleId).digest("hex").slice(0,32)}`;
export const bookMediaRouter=router({
  quoteNarration: protectedProcedure.input(target).mutation(({ctx,input})=>quoteStoryNarration({storyId:input.storyId,userId:ctx.user.id,subtitleCueId:videoIdentity(input.chapterId,input.moduleId),bookTarget:{chapterId:input.chapterId,moduleId:input.moduleId}})),
  describe: protectedProcedure.input(target).mutation(async ({ctx,input}) => {
    const source = await resolveBookModuleSource({...input,userId:ctx.user.id});
    const text = await describeBookModule(source);
    const card = await insertMemoryCard(ctx.user.id,{id:randomUUID(),title:"图片生成的文字",content:text,kind:"thought",origin:"assistant",sourceStoryId:input.storyId});
    return {text, fingerprint:source.fingerprint,cardId:card.id};
  }),
});
