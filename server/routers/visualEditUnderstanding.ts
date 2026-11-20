import { eraseKeyframesInput, eraseKeyframeRegions } from "../services/eraseKeyframeRegions";
import { scanKeyframeRegions } from "../services/keyframeRegionScan";
import { pictureRegionSchema } from "../../shared/chatPictureRegion";
import { inspectChatPictureRegion } from "../services/chatPictureRegion";
import { inspectSourceFrame, frameReadingSummary } from "../services/sourceFrameReading";
import { getStoryGeneratedImages } from "../repositories/images";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { quoteVisualEdit, inspectVisualEdit, manageVisualPreference, visualEditHistory } from "../services/visualEditUnderstanding";
const owner = z.object({ storyId: z.number().int().positive(), stableShotId: z.string().min(1).max(96).optional() });
export const visualEditUnderstandingRouter = router({
  eraseKeyframes: protectedProcedure.input(eraseKeyframesInput)
    .mutation(({ctx,input}) => eraseKeyframeRegions({...input, userId: ctx.user.id})),
  scanKeyframes: protectedProcedure.input(z.object({
    storyId:z.number().int().positive(),shotId:z.string().min(1).max(96),boardId:z.string().startsWith("saved-photos:").max(500),
    imageId:z.number().int().positive(),region:pictureRegionSchema,
  })).query(({ctx,input})=>scanKeyframeRegions({...input,userId:ctx.user.id})),
  pictureRegion: protectedProcedure.input(z.object({
    storyId:z.number().int().positive(), imageId:z.number().int().positive(), region:pictureRegionSchema,
  })).query(({ctx,input}) => inspectChatPictureRegion({...input,userId:ctx.user.id})),
  sourceFrames: protectedProcedure.input(owner.extend({ imageIds:z.array(z.number().int().positive()).min(1).max(15) }))
    .query(async ({ ctx,input })=>{
      const images=await getStoryGeneratedImages(input.storyId,ctx.user.id);
      const rows=[];
      for (const imageId of new Set(input.imageIds)) {
        const image=images.find(i=>i.id===imageId && i.userId===ctx.user.id && i.storyId===input.storyId);
        if (!image) throw new TRPCError({code:"NOT_FOUND",message:"原图 #"+imageId+" 已不可用"});
        const reading=await inspectSourceFrame(image.imageUrl,ctx.user.id);
        rows.push({imageId,summary:frameReadingSummary(reading)});
      }
      return rows;
    }),
  quote: protectedProcedure.input(owner.extend({ imageId: z.number().int().positive(), instruction: z.string().min(1).max(4000), language: z.enum(["zh", "en", "fr"]).optional() }))
    .query(({ ctx, input }) => quoteVisualEdit({ ...input, userId: ctx.user.id })),
  inspect: protectedProcedure.input(owner.extend({ costConfirmation: z.object({ accepted: z.literal(true), estimatedCny: z.number().nonnegative(), fingerprint: z.string() }), imageId: z.number().int().positive(), instruction: z.string().min(1).max(4000), language: z.enum(["zh", "en", "fr"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      const current = await quoteVisualEdit({ ...input, userId: ctx.user.id });
      if (current.fingerprint !== input.costConfirmation.fingerprint || current.estimatedCny > input.costConfirmation.estimatedCny + 0.000001)
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "读图要求或费用已变化，请重新确认报价 / Reading quote changed" });
      return inspectVisualEdit({ ...input, userId: ctx.user.id });
    }),
  preferences: protectedProcedure.input(owner.extend({ action: z.enum(["save", "list", "forget"]), scope: z.enum(["user", "story", "shot"]), text: z.string().min(1).max(2000).optional() }))
    .mutation(({ ctx, input }) => manageVisualPreference({ ...input, userId: ctx.user.id })),
  history: protectedProcedure.input(owner.extend({ imageId: z.number().int().positive().optional() }))
    .query(({ ctx, input }) => visualEditHistory({ ...input, userId: ctx.user.id })),
});
