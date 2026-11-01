import { getStoryImageAssets } from "../services/imageAssets";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { publishingArticleLayoutSchema } from "../../shared/publishingArticleVideo";
import { videoShotEditSchema } from "../../shared/bookVideoCreation";
import {
  listBookVideoRecords,
  proposeBookVideo,
  generateBookVideo,
  editBookVideo,
  adoptBookVideo,
} from "../services/bookVideoCreation";
const owner = z.object({ storyId: z.number().int().positive() });
const record = owner.extend({ id: z.string().min(8).max(100) });
export const bookVideoRouter = router({
  list: protectedProcedure.input(owner).query(async ({ ctx, input }) => {
    const records = await listBookVideoRecords({
      ...input,
      userId: ctx.user.id,
    });
    const assets = await getStoryImageAssets(input.storyId, ctx.user.id);
    return {
      records,
      images: Object.fromEntries(
        assets
          .filter(a => a.availability !== "missing")
          .map(a => [a.id, a.imageUrl])
      ) as Record<number, string>,
    };
  }),
  propose: protectedProcedure
    .input(
      record.extend({
        parentId: z.string().min(8).max(100).optional(),
        versionId: z.string().min(1).max(64),
        request: z.string().trim().min(1).max(4000),
        layout: publishingArticleLayoutSchema,
      })
    )
    .mutation(({ ctx, input }) =>
      proposeBookVideo({ ...input, userId: ctx.user.id })
    ),
  generate: protectedProcedure
    .input(record)
    .mutation(({ ctx, input }) =>
      generateBookVideo({ ...input, userId: ctx.user.id })
    ),
  edit: protectedProcedure
    .input(
      record.extend({
        revision: z.number().int().positive(),
        shots: z.array(videoShotEditSchema).min(1).max(100),
      })
    )
    .mutation(({ ctx, input }) =>
      editBookVideo({ ...input, userId: ctx.user.id })
    ),
  adopt: protectedProcedure
    .input(record)
    .mutation(({ ctx, input }) =>
      adoptBookVideo({ ...input, userId: ctx.user.id })
    ),
});
