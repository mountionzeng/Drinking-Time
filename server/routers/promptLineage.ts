import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getStoryById } from "../db";
import { nanoid } from "nanoid";
import { migrateStoryPromptLineage } from "../services/promptLineageMigration";
import {
  confirmPromptCandidateForStory,
  createPromptCandidateForStory,
  getStoryPromptProjection,
  previewPromptCandidateForStory,
  rejectPromptCandidateForStory,
  restorePromptRevisionForStory,
} from "../services/promptLineage";
import {
  appendStoryConversationTurn,
  listStoryConversation,
} from "../services/storyConversation";
import {
  bindStoryArtPromptLibraryVersion,
  listArtPromptLibraries,
} from "../services/artPromptLibrary";
import type { SelectionContext } from "../../shared/selectionContext";
import {
  ensureStoryPromptLineage,
  selectionContextSchema,
  storyPromptLineageBody,
  throwPromptLineageError,
} from "./_storyShared";

export const promptLineageRouter = router({
  getStoryProjection: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
      }
      await migrateStoryPromptLineage({
        storyId: input.storyId,
        userId: ctx.user.id,
        body: storyPromptLineageBody(story),
      });
      const refreshedProjection = await getStoryPromptProjection({
        storyId: input.storyId,
        userId: ctx.user.id,
      });
      return refreshedProjection
        ? { mode: "lineage" as const, projection: refreshedProjection }
        : {
            mode: "legacy" as const,
            projection: null,
            legacyBody: story.body,
          };
    }),

  createCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        nodeId: z.number().int().positive(),
        targetStableShotId: z.string().trim().min(1).nullable().optional(),
        content: z.string().trim().min(1),
        weight: z.number().min(0).max(1).optional(),
        reason: z.string().trim().nullable().optional(),
        authorType: z.enum(["user", "agent"]).default("user"),
        expectedVersion: z.number().int().nonnegative(),
        operationKey: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ensureStoryPromptLineage(input.storyId, ctx.user.id);
        const result = await createPromptCandidateForStory({
          ...input,
          userId: ctx.user.id,
          operationKey: input.operationKey ?? nanoid(),
        });
        return {
          ...result,
          projection: await getStoryPromptProjection({
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
        };
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),

  previewCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        candidateRevisionId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
      }
      try {
        return await previewPromptCandidateForStory({
          ...input,
          userId: ctx.user.id,
        });
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),

  confirmCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        candidateRevisionId: z.number().int().positive(),
        expectedVersion: z.number().int().nonnegative(),
        operationKey: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await confirmPromptCandidateForStory({
          ...input,
          userId: ctx.user.id,
          operationKey: input.operationKey ?? nanoid(),
        });
        return {
          ...result,
          projection: await getStoryPromptProjection({
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
        };
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),

  rejectCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        candidateRevisionId: z.number().int().positive(),
        expectedVersion: z.number().int().nonnegative(),
        operationKey: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await rejectPromptCandidateForStory({
          ...input,
          userId: ctx.user.id,
          operationKey: input.operationKey ?? nanoid(),
        });
        return {
          ...result,
          projection: await getStoryPromptProjection({
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
        };
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),

  restoreRevision: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        revisionId: z.number().int().positive(),
        expectedVersion: z.number().int().nonnegative(),
        operationKey: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await restorePromptRevisionForStory({
          ...input,
          userId: ctx.user.id,
          operationKey: input.operationKey ?? nanoid(),
        });
        return {
          ...result,
          projection: await getStoryPromptProjection({
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
        };
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),

  listRevisionHistory: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        nodeId: z.number().int().positive(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const projection = await getStoryPromptProjection({
        storyId: input.storyId,
        userId: ctx.user.id,
      });
      if (!projection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "故事提示词尚未迁移",
        });
      }
      if (!projection.nodes.some(node => node.id === input.nodeId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "提示词节点不存在",
        });
      }
      const items = projection.revisions
        .filter(
          revision =>
            revision.nodeId === input.nodeId &&
            (input.cursor == null || revision.id < input.cursor)
        )
        .sort((left, right) => right.id - left.id)
        .slice(0, input.limit);
      return {
        items,
        nextCursor:
          items.length === input.limit
            ? (items[items.length - 1]?.id ?? null)
            : null,
      };
    }),
});

export const artPromptLibraryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) =>
    listArtPromptLibraries({ userId: ctx.user.id })
  ),

  bindToStory: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        libraryVersionId: z.number().int().positive(),
        expectedVersion: z.number().int().nonnegative(),
        operationKey: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ensureStoryPromptLineage(input.storyId, ctx.user.id);
        return await bindStoryArtPromptLibraryVersion({
          storyId: input.storyId,
          userId: ctx.user.id,
          libraryVersionId: input.libraryVersionId,
          expectedVersion: input.expectedVersion,
          operationKey: input.operationKey ?? nanoid(),
        });
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),
});

export const storyConversationRouter = router({
  list: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
      }
      if (
        !(await getStoryPromptProjection({
          storyId: input.storyId,
          userId: ctx.user.id,
        }))
      ) {
        await ensureStoryPromptLineage(input.storyId, ctx.user.id);
      }
      return listStoryConversation({
        storyId: input.storyId,
        userId: ctx.user.id,
      });
    }),

  appendTurn: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        userMessage: z.object({
          clientMessageId: z.string().trim().min(1),
          content: z.string().trim().min(1),
          selection: selectionContextSchema.nullable().optional(),
        }),
        assistantMessage: z.object({
          clientMessageId: z.string().trim().min(1),
          content: z.string().trim().min(1),
          candidateRevisionId: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
      }
      if (
        !(await getStoryPromptProjection({
          storyId: input.storyId,
          userId: ctx.user.id,
        }))
      ) {
        await ensureStoryPromptLineage(input.storyId, ctx.user.id);
      }
      try {
        return await appendStoryConversationTurn({
          ...input,
          userId: ctx.user.id,
          userMessage: {
            ...input.userMessage,
            selection:
              (input.userMessage.selection as SelectionContext | null) ?? null,
          },
        });
      } catch (error) {
        throwPromptLineageError(error);
      }
    }),
});
