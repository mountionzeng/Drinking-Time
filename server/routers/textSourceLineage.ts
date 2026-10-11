import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getTextSourceImpact,
  setCurrentTextSource,
} from "../repositories/textSourceLineage";
export const creationOwnerSchema = z.object({
  storyId: z.number().int().positive(),
});
export const textSourceLineageRouter = router({
  impact: protectedProcedure
    .input(creationOwnerSchema)
    .query(({ input, ctx }) =>
      getTextSourceImpact({ ...input, userId: ctx.user.id })
    ),
  setCurrent: protectedProcedure
    .input(
      creationOwnerSchema.extend({
        draftId: z.string().min(1).max(100),
        expectedRevision: z.number().int().nonnegative(),
        operationToken: z.string().min(8).max(100),
      })
    )
    .mutation(({ input, ctx }) =>
      setCurrentTextSource({ ...input, userId: ctx.user.id })
    ),
});
