import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { ownedCreationStory } from "../repositories/textSourceLineage";
import { normalizeStoryArtDirection } from "../../shared/artDirection";
import { writeArtSystem } from "../services/artSystemChat";
import { planArtPreviews, readArtPreviews, chooseArtPreview } from "../services/artPreview";
export const artSystemsRouter = router({
  previewPlan: protectedProcedure.input(z.object({ storyId: z.number().int().positive(), instruction: z.string().trim().min(1).max(8000), operationToken: z.string().uuid(), imageId: z.number().int().positive().optional() }).strict())
    .mutation(({ input, ctx }) => planArtPreviews({ ...input, userId: ctx.user.id, editorName: ctx.user.name || String(ctx.user.id) })),
  previewRead: protectedProcedure.input(z.object({ storyId: z.number().int().positive() }))
    .query(({ input, ctx }) => readArtPreviews(input.storyId, ctx.user.id)),
  previewChoose: protectedProcedure.input(z.object({ storyId: z.number().int().positive(), shotNo: z.number().int().positive(), ordinal: z.number().int().min(1).max(4), version: z.number().int().positive().optional() }).strict())
    .mutation(({ input, ctx }) => chooseArtPreview({ ...input, userId: ctx.user.id })),
  read: protectedProcedure.input(z.object({ storyId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const { body } = await ownedCreationStory({ ...input, userId: ctx.user.id });
    return normalizeStoryArtDirection(body.artDirection);
  }),
  write: protectedProcedure.input(z.object({
    storyId: z.number().int().positive(), operationToken: z.string().uuid(), instruction: z.string().trim().min(1).max(8000),
    action: z.enum(["draft", "confirm", "copy"]), referenceImageIds: z.array(z.number().int().positive()).max(12).default([]),
    expectedVersion: z.number().int().nonnegative(),
    recipeVersion: z.number().int().positive().optional(),
    imageId: z.number().int().positive().optional(), sourceStoryId: z.number().int().positive().optional(),
  }).strict()).mutation(({ input, ctx }) => writeArtSystem({ ...input, userId: ctx.user.id, editorName: ctx.user.name || String(ctx.user.id) })),
});
