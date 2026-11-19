import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { runFrameRegionReview, frameRegionReviewHistory } from "../services/frameRegionReview";
import { chatFrameReferenceSchema } from "../../shared/chatFrameReference";
import { generateCloudShape } from "../services/cloudShapeEdit";
export const frameRegionReviewRouter = router({
  generateCloud: protectedProcedure.input(z.object({storyId:z.number().int().positive(),reviewId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),
    stableShotId:z.string().min(1).max(240),requestId:z.string().uuid(),recoverOnly:z.boolean().optional(),confirmation:z.object({accepted:z.literal(true),fingerprint:z.string().length(64),estimatedCny:z.number().nonnegative()})
  })).mutation(({ctx,input})=>generateCloudShape({...input,userId:ctx.user.id})),
  history: protectedProcedure.input(z.object({ storyId: z.number().int().positive() })).query(({ ctx, input }) => frameRegionReviewHistory({ ...input, userId: ctx.user.id })),
  turn: protectedProcedure.input(z.object({ storyId: z.number().int().positive(), instruction: z.string().trim().min(1).max(8000),
    stableShotId: z.string().min(1).max(240).optional(), imageId: z.number().int().positive().optional(),
    sourceFrame: chatFrameReferenceSchema.optional(),
    inspectOnly: z.boolean().optional(),
    reviewId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional(), language: z.enum(["zh", "en", "fr"]).optional(),
  })).mutation(({ ctx, input }) => runFrameRegionReview({ ...input, userId: ctx.user.id })),
});
