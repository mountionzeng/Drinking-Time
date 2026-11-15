import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { warehouseVideoSequenceInput } from "../../shared/warehouseVideoSequence";
import {
  quoteWarehouseVideoSequence,
  submitWarehouseVideoSequence,
  findWarehouseVideoSequence,
} from "../services/warehouseVideoSequence";

export const warehouseVideoSequenceRouter = router({
  status: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        requestId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => ({
      take: await findWarehouseVideoSequence(
        input.storyId,
        input.requestId,
        ctx.user.id,
      ),
    })),
  quote: protectedProcedure
    .input(warehouseVideoSequenceInput)
    .mutation(({ ctx, input }) =>
      quoteWarehouseVideoSequence(input, ctx.user.id),
    ),
  submit: protectedProcedure
    .input(
      warehouseVideoSequenceInput.extend({
        requestId: z.string().uuid(),
        fingerprint: z.string().length(64),
        costConfirmation: z.object({
          accepted: z.literal(true),
          estimatedCny: z.number().nonnegative(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const take = await submitWarehouseVideoSequence(
        { ...input, confirmedCny: input.costConfirmation.estimatedCny },
        ctx.user.id,
      );
      return {
        status: "ok" as const,
        take,
        takeId: take.id,
        videoStatus: take.status,
        videoUrl: take.videoUrl,
      };
    }),
});
