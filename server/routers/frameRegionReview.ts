import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { runFrameRegionReview, frameRegionReviewHistory } from "../services/frameRegionReview";
export const frameRegionReviewRouter = router({
  history: protectedProcedure.input(z.object({ storyId: z.number().int().positive() })).query(({ ctx, input }) => frameRegionReviewHistory({ ...input, userId: ctx.user.id })),
  turn: protectedProcedure.input(z.object({ storyId: z.number().int().positive(), instruction: z.string().trim().min(1).max(8000),
    stableShotId: z.string().min(1).max(240).optional(), imageId: z.number().int().positive().optional(),
    reviewId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional(), language: z.enum(["zh", "en", "fr"]).optional(),
  })).mutation(({ ctx, input }) => runFrameRegionReview({ ...input, userId: ctx.user.id })),
});
