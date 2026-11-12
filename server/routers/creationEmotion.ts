import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  analyzeCreationEmotion,
  emotionIntentSchema,
  emotionScopeSchema,
  resolveCreationEmotion,
} from "../../shared/creationEmotion";
import {
  getCreationEmotion,
  getCreationEmotionUsage,
  saveCreationEmotion,
} from "../services/creationEmotion";
const owner = z.object({ storyId: z.number().int().positive() });
export const creationEmotionRouter = router({
  usage: protectedProcedure
    .input(owner)
    .query(({ ctx, input }) =>
      getCreationEmotionUsage({ ...input, userId: ctx.user.id })
    ),
  get: protectedProcedure
    .input(owner)
    .query(({ ctx, input }) =>
      getCreationEmotion({ ...input, userId: ctx.user.id })
    ),
  preview: protectedProcedure
    .input(owner.extend({ intent: emotionIntentSchema }))
    .mutation(async ({ ctx, input }) => {
      await getCreationEmotion({ ...input, userId: ctx.user.id });
      return {
        intent: input.intent,
        reading: analyzeCreationEmotion(input.intent.raw),
      };
    }),
  save: protectedProcedure
    .input(
      owner.extend({
        expectedRevision: z.number().int().nonnegative(),
        scope: emotionScopeSchema,
        intent: emotionIntentSchema.nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const state = await saveCreationEmotion({
        ...input,
        userId: ctx.user.id,
      });
      return {
        state,
        snapshot: resolveCreationEmotion(state),
        existingContent: "preserved" as const,
      };
    }),
});
