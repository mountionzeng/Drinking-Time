import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  textDraftContentSchema,
  textDraftRequestSchema,
} from "../../shared/textDraftHistory";
import {
  adoptTextDraft,
  generateTextDraft,
  getTextDraftHistory,
  setTextDraftLearning,
} from "../services/textDraftHistory";

const owner = z.object({ storyId: z.number().int().positive() });
export const textDraftsRouter = router({
  read: protectedProcedure
    .input(owner)
    .query(({ input, ctx }) =>
      getTextDraftHistory({ ...input, userId: ctx.user.id })
    ),
  generate: protectedProcedure
    .input(textDraftRequestSchema)
    .mutation(({ input, ctx }) =>
      generateTextDraft({ ...input, userId: ctx.user.id })
    ),
  adopt: protectedProcedure
    .input(
      owner.extend({
        versionId: z.string().min(1).max(100),
        expectedRevision: z.number().int().nonnegative(),
        expectedPublishingRevision: z.number().int().nonnegative(),
        content: textDraftContentSchema,
        feedback: z.string().max(2000),
      })
    )
    .mutation(({ input, ctx }) =>
      adoptTextDraft({ ...input, userId: ctx.user.id })
    ),
  setLearning: protectedProcedure
    .input(
      owner.extend({
        versionId: z.string().min(1).max(100),
        enabled: z.boolean(),
        expectedRevision: z.number().int().nonnegative(),
      })
    )
    .mutation(({ input, ctx }) =>
      setTextDraftLearning({ ...input, userId: ctx.user.id })
    ),
});
