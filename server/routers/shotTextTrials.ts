import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  attachTrial,
  openTrial,
  readPicturePage,
  trialList,
  trialManuscript,
  trialQuote,
  writeTrial,
} from "../services/shotTextTrials";
const owner = z.object({ storyId: z.number().int().positive() });
const scope = owner.extend({ shotId: z.string().min(1).max(200) });
const draft = scope.extend({ id: z.string().uuid() });
export const shotTextTrialsRouter = router({
  sourcePage: protectedProcedure
    .input(owner.extend({ page: z.string().min(1).max(24), title: z.string().min(1).max(100).optional() }))
    .query(({ ctx, input }) => readPicturePage({ ...input, userId: ctx.user.id })),
  manuscript: protectedProcedure
    .input(owner)
    .query(({ ctx, input }) =>
      trialManuscript({ ...input, userId: ctx.user.id })
    ),
  list: protectedProcedure
    .input(scope)
    .query(({ ctx, input }) => trialList({ ...input, userId: ctx.user.id })),
  attach: protectedProcedure
    .input(
      draft.extend({
        source: z.string().trim().min(1).max(180),
        text: z.string().min(1).max(60000),
        kind: z.enum(["reference", "source"]),
      })
    )
    .mutation(({ ctx, input }) =>
      attachTrial({ ...input, userId: ctx.user.id })
    ),
  open: protectedProcedure
    .input(
      owner.extend({
        shotNo: z.number().int().nonnegative().optional(),
        shotId: scope.shape.shotId.optional(),
        opening: z.boolean().optional(),
        retry: z.boolean().optional(),
        failedId: z.string().uuid().optional(),
        revise: z.boolean().optional(),
        request: z.string().min(1).max(20000),
        id: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) => openTrial({ ...input, userId: ctx.user.id })),
  quote: protectedProcedure
    .input(draft)
    .query(({ ctx, input }) => trialQuote({ ...input, userId: ctx.user.id })),
  write: protectedProcedure
    .input(
      draft.extend({
        key: z.string().length(64),
        estimatedCny: z.number().finite().nonnegative(),
        accepted: z.literal(true),
      })
    )
    .mutation(({ ctx, input }) =>
      writeTrial({ ...input, userId: ctx.user.id })
    ),
});
