import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { memorySpaceOperationSchema } from "../../shared/memorySpace";
import {
  listMemorySpace,
  changeMemorySpace,
  readMemoryBook,
  markMemoryBookSeen,
} from "../repositories/memorySpace";
const storyInput = z.object({ storyId: z.number().int().positive() });
export const memorySpaceRouter = router({
  list: protectedProcedure.query(({ ctx }) => listMemorySpace(ctx.user.id)),
  change: protectedProcedure
    .input(
      z.object({
        revision: z.number().int().nonnegative(),
        operation: memorySpaceOperationSchema,
      })
    )
    .mutation(({ ctx, input }) =>
      changeMemorySpace(ctx.user.id, input.revision, input.operation)
    ),
  book: protectedProcedure
    .input(storyInput)
    .query(({ ctx, input }) => readMemoryBook(ctx.user.id, input.storyId)),
  seen: protectedProcedure
    .input(
      storyInput.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    )
    .mutation(({ ctx, input }) =>
      markMemoryBookSeen(ctx.user.id, input.storyId, input.fingerprint)
    ),
});
