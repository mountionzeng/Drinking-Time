import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";
import {
  amendVisualAssetFixedFacts,
  deleteVisualAsset,
  deleteVisualAssetVersion,
  forkVisualAssetVersion,
  confirmVisualAssetBinding,
  confirmVisualAssetBindings,
  createVisualAssetDraft,
  createVisualAssetVersion,
  getStoryVisualAssets,
  lockVisualAssetVersion,
  recordVisualAssetViewReview,
  resolveVisualAssetVersionConflicts,
  VisualAssetImageOwnershipError,
  VisualAssetNotFoundError,
  VisualAssetNotLockableError,
  VisualAssetValidationError,
} from "../services/visualAssetPersistence";
import {
  StoryBodyOwnershipError,
  StoryBodyRevisionConflictError,
} from "../services/storyBodyPersistence";
import { getStoryRevision } from "../services/storySync";
import {
  analyzeVisualAssetVersion,
  generateVisualAssetCanonicalBoard,
  quoteVisualAssetCanonicalBoard,
  quoteVisualAssetView,
  regenerateVisualAssetView,
} from "../services/visualAssetCreation";
import { proposeVisualAssetAssociations } from "../services/visualAssetAssociations";

const mutationEnvelope = z
  .object({
    storyId: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
    operationToken: z.string().trim().min(1).max(160),
  })
  .strict();

const versionRefSchema = z
  .object({
    assetId: z.string().trim().min(1).max(160),
    versionId: z.string().trim().min(1).max(160),
  })
  .strict();

const selectionSchema = z
  .object({
    character: versionRefSchema.optional(),
    scene: versionRefSchema.optional(),
    style: versionRefSchema.optional(),
  })
  .strict()
  .refine(value => Boolean(value.character || value.scene || value.style), {
    message: "至少选择一项视觉资产",
  });

const canonicalBoardQuoteSchema = z
  .object({
    quoteId: z.string().length(64),
    storyId: z.number().int().positive(),
    assetId: z.string().trim().min(1).max(160),
    versionId: z.string().trim().min(1).max(160),
    inputHash: z.string().length(64),
    currency: z.literal("CNY"),
    estimatedCny: z.number().nonnegative(),
    candidateCount: z.number().int().positive().max(8),
    expiresAt: z.number().int().positive(),
  })
  .strict();

function routeError(error: unknown): never {
  if (error instanceof StoryBodyOwnershipError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  }
  if (error instanceof StoryBodyRevisionConflictError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "故事已在别处更新，请刷新后重试",
      cause: error,
    });
  }
  if (
    error instanceof VisualAssetValidationError ||
    error instanceof VisualAssetImageOwnershipError ||
    error instanceof VisualAssetNotFoundError ||
    error instanceof VisualAssetNotLockableError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

function publicMutationResult(
  result: Awaited<ReturnType<typeof createVisualAssetDraft>>
) {
  return {
    storyId: result.story.id,
    revision: getStoryRevision(result.story.body),
    aggregate: result.aggregate,
    replayed: result.replayed,
    resultId: result.resultId ?? null,
  };
}

export const visualAssetsRouter = router({
  read: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }).strict())
    .query(async ({ ctx, input }) => {
      try {
        const result = await getStoryVisualAssets({
          storyId: input.storyId,
          userId: ctx.user.id,
        });
        return {
          storyId: result.story.id,
          revision: getStoryRevision(result.story.body),
          aggregate: result.aggregate,
        };
      } catch (error) {
        return routeError(error);
      }
    }),

  createDraft: protectedProcedure
    .input(
      mutationEnvelope.extend({
        kind: z.enum(["character", "scene", "style"]),
        name: z.string().trim().min(1).max(240),
        referenceImageIds: z.array(z.number().int().positive()).min(1).max(12),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await createVisualAssetDraft({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  createVersion: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        referenceImageIds: z.array(z.number().int().positive()).min(1).max(12),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await createVisualAssetVersion({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  lockVersion: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        versionId: z.string().trim().min(1).max(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await lockVisualAssetVersion({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  confirmBinding: protectedProcedure
    .input(
      mutationEnvelope.extend({
        stableShotId: z.string().trim().min(1).max(96),
        selections: selectionSchema,
        sourceProposalId: z.string().trim().min(1).max(160).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await confirmVisualAssetBinding({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  analyzeVersion: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        versionId: z.string().trim().min(1).max(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await analyzeVisualAssetVersion({ ...input, userId: ctx.user.id });
      } catch (error) {
        return routeError(error);
      }
    }),

  resolveConflicts: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        versionId: z.string().trim().min(1).max(160),
        resolutions: z
          .array(
            z
              .object({
                field: z.string().trim().min(1).max(160),
                resolution: z.string().trim().min(1).max(6000),
              })
              .strict()
          )
          .min(1)
          .max(32),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await resolveVisualAssetVersionConflicts({
            ...input,
            userId: ctx.user.id,
          })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  reviewViews: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        versionId: z.string().trim().min(1).max(160),
        reviews: z
          .array(
            z
              .object({
                role: z.string().trim().min(1).max(64),
                status: z.enum(["pending", "pass", "fail", "unknown"]),
                failureReason: z.string().trim().min(1).max(600).optional(),
              })
              .strict()
          )
          .min(1)
          .max(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await recordVisualAssetViewReview({
            ...input,
            reviews: input.reviews as Parameters<
              typeof recordVisualAssetViewReview
            >[0]["reviews"],
            userId: ctx.user.id,
          })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  quoteCanonicalBoard: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          assetId: z.string().trim().min(1).max(160),
          versionId: z.string().trim().min(1).max(160),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await quoteVisualAssetCanonicalBoard({
          ...input,
          userId: ctx.user.id,
        });
      } catch (error) {
        return routeError(error);
      }
    }),

  generateCanonicalBoard: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          assetId: z.string().trim().min(1).max(160),
          versionId: z.string().trim().min(1).max(160),
          operationToken: z.string().trim().min(1).max(160),
          confirmation: canonicalBoardQuoteSchema.optional(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateVisualAssetCanonicalBoard({
          ...input,
          userId: ctx.user.id,
        });
      } catch (error) {
        return routeError(error);
      }
    }),

  deleteVersion: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        versionId: z.string().trim().min(1).max(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await deleteVisualAssetVersion({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  deleteAsset: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await deleteVisualAsset({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  forkVersion: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        sourceVersionId: z.string().trim().min(1).max(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await forkVisualAssetVersion({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  amendFixedFacts: protectedProcedure
    .input(
      mutationEnvelope.extend({
        assetId: z.string().trim().min(1).max(160),
        versionId: z.string().trim().min(1).max(160),
        amendments: z
          .array(
            z
              .object({
                field: z.string().trim().min(1).max(64),
                value: z.string().trim().min(1).max(6000),
              })
              .strict()
          )
          .min(1)
          .max(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await amendVisualAssetFixedFacts({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),

  quoteView: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          assetId: z.string().trim().min(1).max(160),
          versionId: z.string().trim().min(1).max(160),
          role: z.string().trim().min(1).max(64),
          instruction: z.string().trim().min(1).max(2000).optional(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await quoteVisualAssetView({
          ...input,
          role: input.role as Parameters<typeof quoteVisualAssetView>[0]["role"],
          userId: ctx.user.id,
        });
      } catch (error) {
        return routeError(error);
      }
    }),

  regenerateView: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          assetId: z.string().trim().min(1).max(160),
          versionId: z.string().trim().min(1).max(160),
          role: z.string().trim().min(1).max(64),
          operationToken: z.string().trim().min(1).max(160),
          confirmation: canonicalBoardQuoteSchema.optional(),
          instruction: z.string().trim().min(1).max(2000).optional(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await regenerateVisualAssetView({
          ...input,
          role: input.role as Parameters<typeof regenerateVisualAssetView>[0]["role"],
          userId: ctx.user.id,
        });
      } catch (error) {
        return routeError(error);
      }
    }),

  proposeBindings: protectedProcedure
    .input(mutationEnvelope)
    .mutation(async ({ ctx, input }) => {
      try {
        return await proposeVisualAssetAssociations({
          ...input,
          userId: ctx.user.id,
        });
      } catch (error) {
        return routeError(error);
      }
    }),

  confirmBindings: protectedProcedure
    .input(
      mutationEnvelope.extend({
        bindings: z
          .array(
            z
              .object({
                stableShotId: z.string().trim().min(1).max(96),
                selections: selectionSchema,
                sourceProposalId: z.string().trim().min(1).max(160).optional(),
              })
              .strict()
          )
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return publicMutationResult(
          await confirmVisualAssetBindings({ ...input, userId: ctx.user.id })
        );
      } catch (error) {
        return routeError(error);
      }
    }),
});
