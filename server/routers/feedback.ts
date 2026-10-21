import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { feedbackCategory, feedbackInput } from "../../shared/feedback";
import {
  createFeedback,
  listFeedback,
  reviewFeedback,
} from "../repositories/feedback";

export const feedbackRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          category: feedbackCategory.optional(),
          offset: z.number().int().min(0).max(10000).default(0),
        })
        .strict()
    )
    .query(async ({ ctx, input }) => ({
      ...(await listFeedback(input, ctx.user.id)),
      canReview: ctx.user.role === "admin",
    })),
  submit: protectedProcedure
    .input(feedbackInput)
    .mutation(({ ctx, input }) => createFeedback(ctx.user.id, input)),
  review: adminProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          action: z.enum(["adopt", "review", "close"]),
          reply: z.string().trim().max(2000),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => reviewFeedback(input, ctx.user.id)),
});
