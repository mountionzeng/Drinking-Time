import { z } from "zod";
import { analyzeShotScene, confirmShotScene, quoteSceneReading, sceneReadingBasis } from "../services/shotSceneReading";
import { sampleShotIdsSchema } from "../../shared/artPreview";
import { protectedProcedure, router } from "../_core/trpc";
import { ownedCreationStory } from "../repositories/textSourceLineage";
import { normalizeStoryArtDirection } from "../../shared/artDirection";
import { writeArtSystem } from "../services/artSystemChat";
import { planArtPreviews, readArtPreviews, chooseArtPreview, readPreviewArtBasis, retryPreviewPlan } from "../services/artPreview";
const sceneScope = z.object({ storyId: z.number().int().positive(), stableShotId: z.string().min(1).max(128) });
const sceneRequest = sceneScope.extend({ imageId: z.number().int().positive().optional(), adjustment: z.string().trim().max(800).optional() });
export const artSystemsRouter = router({
  sceneBasis: protectedProcedure.input(sceneScope).query(({ ctx, input }) => sceneReadingBasis({ ...input, userId: ctx.user.id })),
  sceneQuote: protectedProcedure.input(sceneRequest).query(({ ctx, input }) => quoteSceneReading({ ...input, userId: ctx.user.id })),
  sceneAnalyze: protectedProcedure.input(sceneRequest.extend({ accepted: z.literal(true), key: z.string().length(64), estimatedCny: z.number().finite().nonnegative() }))
    .mutation(({ ctx, input }) => analyzeShotScene({ ...input, userId: ctx.user.id })),
  sceneConfirm: protectedProcedure.input(sceneScope.extend({ basisKey: z.string().length(64), text: z.string().trim().max(2600) }))
    .mutation(({ ctx, input }) => confirmShotScene({ ...input, userId: ctx.user.id })),
  previewRetryPlan: protectedProcedure.input(z.object({ storyId: z.number().int().positive(), failedId: z.string().uuid(), basisKey: z.string().min(1).max(128), coverCopyImageId: z.number().int().positive().optional() }).strict())
    .mutation(({ input, ctx }) => retryPreviewPlan({ ...input, userId: ctx.user.id, editorName: ctx.user.name || String(ctx.user.id) })),
  previewArtBasis: protectedProcedure.input(z.object({ storyId: z.number().int().positive() }))
    .query(({ input, ctx }) => readPreviewArtBasis(input.storyId, ctx.user.id)),
  previewPlan: protectedProcedure.input(z.object({ storyId: z.number().int().positive(), instruction: z.string().trim().min(1).max(8000), operationToken: z.string().uuid(), sampleShotId: z.string().min(1).max(128).optional(), sampleShotIds: sampleShotIdsSchema.optional(), imageId: z.number().int().positive().optional(), adjustment: z.string().trim().min(1).max(600).optional(), coverCopyImageId: z.number().int().positive().optional() }).strict())
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
    action: z.enum(["draft", "confirm", "copy", "style-reference", "clear-style-reference"]), referenceImageIds: z.array(z.number().int().positive()).max(12).default([]),
    expectedVersion: z.number().int().nonnegative(),
    recipeVersion: z.number().int().positive().optional(),
    imageId: z.number().int().positive().optional(), sourceStoryId: z.number().int().positive().optional(),
  }).strict()).mutation(({ input, ctx }) => writeArtSystem({ ...input, userId: ctx.user.id, editorName: ctx.user.name || String(ctx.user.id) })),
});
