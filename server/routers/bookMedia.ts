import { translateBookModule } from "../services/bookModuleTranslation";
import { generateBookImageComposition, readBookImageComposition, refreshBookImageComposition, listBookImageCompositions } from '../services/bookImageComposition';
import { writingModuleTexts } from "../../shared/bookWritingStyle";
import { quoteStoryNarration } from "../services/storyNarration";
import { insertMemoryCard } from "../repositories/memoryCards";
import { randomUUID } from "node:crypto";
import { resolveBookModuleSource, describeBookModule } from "../services/bookModuleSource";
import { shotVideoPriceProfile } from "../../shared/shotDirector";
import { createHash } from "node:crypto";
import { getStoryVideoTakes } from "../repositories/videos";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { bookMediaTargetIsCurrent } from "../services/bookMediaTarget";
import { getStoryImageAssets } from "../services/imageAssets";
import { getChapter } from "../repositories/chapters";
import { readBookImage } from "../../shared/bookImageBlock";
import { estimateShotVideoCost } from "../../shared/shotDirector";
import { getShotVideoProviderStatus } from "../services/videoGen";
import { startShotVideoJob } from "../services/videoJobs";

const target = z.object({
  storyId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  moduleId: z.string().min(1).max(100),
});
const videoIdentity = (chapterId: number, moduleId: string) =>
  `book:${chapterId}:${createHash("sha256").update(moduleId).digest("hex").slice(0, 32)}`;
const compositionTarget = z.object({ storyId: z.number().int().positive(), chapterId: z.number().int().positive(), moduleIds: z.array(z.string().min(1).max(100)).min(1).max(200) });
export const bookMediaRouter = router({
  compositionHistory: protectedProcedure.input(z.object({storyId:z.number().int().positive()})).query(({ctx,input})=>listBookImageCompositions({...input,userId:ctx.user.id})),
  composition: protectedProcedure.input(compositionTarget).query(({ ctx, input }) => readBookImageComposition({ ...input, userId: ctx.user.id })),
  refreshComposition: protectedProcedure.input(compositionTarget).mutation(({ ctx, input }) => refreshBookImageComposition({ ...input, userId: ctx.user.id })),
  generateComposition: protectedProcedure.input(compositionTarget.extend({
    sources: z.array(z.object({ id: z.string().min(1).max(100), text: z.string().max(30000) })).min(1).max(200),
    instruction: z.string().trim().max(4000), previousTaskId: z.string().uuid().nullable(),
    estimatedCny: z.number().positive(), accepted: z.literal(true),
  })).mutation(({ ctx, input }) => generateBookImageComposition({ ...input, userId: ctx.user.id })),
  translate: protectedProcedure.input(target.extend({ targetLanguage: z.enum(["en", "zh"]), expectedText: z.string().min(1).max(200000) })).mutation(async ({ctx,input}) => {
    const result = await translateBookModule({...input,userId:ctx.user.id});
    const card = await insertMemoryCard(ctx.user.id,{id:randomUUID(),title:input.targetLanguage === "en" ? "英文译文" : "中文译文",content:result.text,kind:"thought",origin:"assistant",sourceStoryId:input.storyId});
    return {...result,cardId:card.id};
  }),
  quoteNarration: protectedProcedure.input(target.extend({moduleIds:z.array(z.string().min(1).max(100)).min(2).max(50).optional()})).mutation(({ctx,input})=>quoteStoryNarration({storyId:input.storyId,userId:ctx.user.id,subtitleCueId:videoIdentity(input.chapterId,input.moduleId),bookTarget:{chapterId:input.chapterId,moduleId:input.moduleId,...(input.moduleIds ? {moduleIds:input.moduleIds} : {})}})),
  describe: protectedProcedure.input(target.extend({moduleIds:z.array(z.string().min(1).max(100)).min(2).max(50).optional()})).mutation(async ({ctx,input}) => {
    const source = await resolveBookModuleSource({...input,userId:ctx.user.id});
    const text = await describeBookModule(source);
    const card = await insertMemoryCard(ctx.user.id,{id:randomUUID(),title:"图片生成的文字",content:text,kind:"thought",origin:"assistant",sourceStoryId:input.storyId});
    return {text, fingerprint:source.fingerprint,cardId:card.id};
  }),
  resolve: protectedProcedure.input(target).query(async ({ ctx, input }) => {
    const chapter = await getChapter(input.chapterId, ctx.user.id);
    if (!chapter || chapter.storyId !== input.storyId)
      throw new TRPCError({ code: "NOT_FOUND" });
    const index =
      chapter.blocks.writingStyle?.findIndex(
        block => block.id === input.moduleId
      ) ?? -1;
    const media =
      index < 0
        ? null
        : readBookImage(writingModuleTexts(chapter.blocks.body,chapter.blocks.writingStyle)[index] ?? "");
    const assets = await getStoryImageAssets(input.storyId, ctx.user.id);
    const asset =
      media &&
      assets.find(
        item => item.imageUrl === media.url && item.availability !== "missing"
      );
    if (!asset) return { image: null, videoCost: null };
    const motion = getShotVideoProviderStatus().motion;
    return {
      image: { id: asset.id, url: asset.imageUrl },
      videoCost: estimateShotVideoCost({ durationSec: 5, motion, priceProfile: shotVideoPriceProfile(getShotVideoProviderStatus().submitPath) }).estimatedCny,
    };
  }),
  latestVideo: protectedProcedure
    .input(target.extend({ imageId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!(await bookMediaTargetIsCurrent({ ...input, userId: ctx.user.id })))
        return null;
      return (
        (await getStoryVideoTakes(input.storyId, ctx.user.id)).find(
          take =>
            take.stableShotId ===
              videoIdentity(input.chapterId, input.moduleId) &&
            take.sourceImageId === input.imageId
        ) ?? null
      );
    }),
  video: protectedProcedure
    .input(
      target.extend({
        imageId: z.number().int().positive(),
        prompt: z.string().trim().min(1).max(2000),
        operationToken: z.string().min(8).max(128),
        estimatedCny: z.number().nonnegative(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await bookMediaTargetIsCurrent({ ...input, userId: ctx.user.id })))
        throw new TRPCError({
          code: "CONFLICT",
          message: "这张图片已变化，请重新点选",
        });
      const motion = getShotVideoProviderStatus().motion;
      const cost = estimateShotVideoCost({
        durationSec: 5,
        motion,
        priceProfile: shotVideoPriceProfile(getShotVideoProviderStatus().submitPath),
      }).estimatedCny;
      if (Math.abs(cost - input.estimatedCny) > 0.001)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "视频费用已变化，请重新确认",
        });
      return startShotVideoJob(
        {
          storyId: input.storyId,
          shotNo: 1,
          stableShotId: videoIdentity(input.chapterId, input.moduleId),
          bookTarget: { chapterId: input.chapterId, moduleId: input.moduleId },
          imageId: input.imageId,
          prompt: input.prompt,
          durationSec: 5,
          motion,
          directorPromptApproved: true,
          rerenderRequestId: input.operationToken,
        },
        ctx.user.id
      );
    }),
});
