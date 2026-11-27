import { z } from "zod";
import { findStoryPictures, storyPageReadings } from "../services/storyPictureRecall";
import { latestBookPicture } from "../services/bookPictureVersions";
import { markAccountImageOpened } from "../repositories/memorySpace";
import { protectedProcedure, router } from "../_core/trpc";
import { memorySpaceOperationSchema } from "../../shared/memorySpace";
import {
  recordMemoryActivity,
  listMemorySpace,
  changeMemorySpace,
  readMemoryBook,
  markMemoryBookSeen,
  trashMemoryStory,
  restoreMemoryStory,
  listTrashedMemoryStories,
} from "../repositories/memorySpace";
const storyInput = z.object({ storyId: z.number().int().positive() });
export const memorySpaceRouter = router({
  bookPageReadings: protectedProcedure.input(storyInput.extend({urls:z.array(z.string().min(1).max(2048)).max(100)})).query(({ctx,input})=>
    storyPageReadings(ctx.user.id,input.storyId,input.urls)),
  latestBookPicture: protectedProcedure.input(storyInput.extend({imageId:z.number().int().positive()})).query(({ctx,input})=>
    latestBookPicture(ctx.user.id,input.storyId,input.imageId)),
  imageOpened: protectedProcedure.input(z.object({imageId:z.number().int().positive()})).mutation(({ctx,input}) =>
    markAccountImageOpened(ctx.user.id, input.imageId)),
  findPictures: protectedProcedure.input(storyInput.extend({ accountId:z.number().int().positive().optional(),query:z.string().trim().min(1).max(1000) })).query(({ctx,input}) =>
    input.accountId!==undefined && input.accountId!==ctx.user.id ? [] : findStoryPictures(ctx.user.id, input.storyId, input.query)),
  trashList: protectedProcedure.query(({ ctx }) => listTrashedMemoryStories(ctx.user.id)),
  trash: protectedProcedure.input(storyInput).mutation(({ ctx, input }) => trashMemoryStory(ctx.user.id, input.storyId)),
  restore: protectedProcedure.input(storyInput).mutation(({ ctx, input }) => restoreMemoryStory(ctx.user.id, input.storyId)),
  activity: protectedProcedure
    .input(
      storyInput.extend({
        sessionId: z.string().uuid(),
        elapsedMs: z.number().int().min(0).max(86_400_000),
      })
    )
    .mutation(({ ctx, input }) => recordMemoryActivity(ctx.user.id, input)),
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
