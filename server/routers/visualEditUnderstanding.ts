import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { quoteVisualEdit, inspectVisualEdit, manageVisualPreference, visualEditHistory } from "../services/visualEditUnderstanding";
const owner = z.object({ storyId: z.number().int().positive(), stableShotId: z.string().min(1).max(96).optional() });
export const visualEditUnderstandingRouter = router({
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
