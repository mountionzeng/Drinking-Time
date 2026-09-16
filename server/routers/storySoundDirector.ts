import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  answerStorySoundInterview,
  buildStorySoundPlanVersion,
  confirmStorySoundDraftText,
  editStorySoundPlanRow,
  goBackStorySoundInterview,
  resumeStorySoundInterview,
  setStorySoundPlanRowSelection,
  startOrResumeStorySoundInterview,
} from "../services/storySoundDirector";
import {
  listStorySoundPlanVersions,
  restoreStorySoundPlanVersionToWorkspace,
} from "../services/storySoundPlanStore";
import { StorySoundLimitError } from "../services/storySoundLimits";

const storyId = z.number().int().positive();
const expectedRevision = z.number().int().min(0);

function directorError(error: unknown): never {
  if (error instanceof StorySoundLimitError) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: error.message,
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : "声音方案操作失败";
  if (/不存在|不属于/.test(message)) {
    throw new TRPCError({ code: "NOT_FOUND", message });
  }
  if (/另一处更新|冲突/.test(message)) {
    throw new TRPCError({ code: "CONFLICT", message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message, cause: error });
}

const owned = <T>(operation: () => Promise<T>) =>
  operation().catch(error => directorError(error));

export const storySoundDirectorRouter = router({
  start: protectedProcedure
    .input(z.object({ storyId }))
    .mutation(({ ctx, input }) =>
      owned(() =>
        startOrResumeStorySoundInterview({
          storyId: input.storyId,
          userId: ctx.user.id,
        })
      )
    ),

  resume: protectedProcedure
    .input(z.object({ storyId }))
    .query(({ ctx, input }) =>
      owned(() =>
        resumeStorySoundInterview({
          storyId: input.storyId,
          userId: ctx.user.id,
        })
      )
    ),

  answer: protectedProcedure
    .input(
      z.object({
        storyId,
        expectedRevision,
        stepId: z.string().min(1).max(160),
        optionId: z.string().min(1).max(160).optional(),
        freeText: z.string().max(2_000).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      owned(() =>
        answerStorySoundInterview({
          ...input,
          userId: ctx.user.id,
        })
      )
    ),

  goBack: protectedProcedure
    .input(z.object({ storyId, expectedRevision }))
    .mutation(({ ctx, input }) =>
      owned(() => goBackStorySoundInterview({ ...input, userId: ctx.user.id }))
    ),

  editRow: protectedProcedure
    .input(
      z.object({
        storyId,
        expectedRevision,
        rowId: z.string().min(1).max(200),
        text: z.string().max(4_000).optional(),
        description: z.string().max(4_000).optional(),
        characterId: z.string().max(160).nullable().optional(),
        startFrame: z.number().int().min(0).optional(),
        durationFrames: z.number().int().min(1).optional(),
        performance: z
          .object({
            emotion: z.string().max(200).optional(),
            speed: z.number().min(0.5).max(2).optional(),
            intensity: z.number().min(0).max(1).optional(),
            style: z.string().max(500).optional(),
          })
          .optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      owned(() => editStorySoundPlanRow({ ...input, userId: ctx.user.id }))
    ),

  setRowSelected: protectedProcedure
    .input(
      z.object({
        storyId,
        expectedRevision,
        rowId: z.string().min(1).max(200),
        selected: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      owned(() =>
        setStorySoundPlanRowSelection({ ...input, userId: ctx.user.id })
      )
    ),

  confirmDraftText: protectedProcedure
    .input(
      z.object({
        storyId,
        expectedRevision,
        rowId: z.string().min(1).max(200),
        confirmedText: z.string().min(1).max(4_000),
      })
    )
    .mutation(({ ctx, input }) =>
      owned(() => confirmStorySoundDraftText({ ...input, userId: ctx.user.id }))
    ),

  saveVersion: protectedProcedure
    .input(z.object({ storyId, expectedRevision }))
    .mutation(({ ctx, input }) =>
      owned(() => buildStorySoundPlanVersion({ ...input, userId: ctx.user.id }))
    ),

  versions: protectedProcedure
    .input(z.object({ storyId }))
    .query(({ ctx, input }) =>
      owned(() =>
        listStorySoundPlanVersions({
          storyId: input.storyId,
          userId: ctx.user.id,
        })
      )
    ),

  restoreVersion: protectedProcedure
    .input(
      z.object({
        storyId,
        expectedRevision,
        versionId: z.string().min(1).max(200),
      })
    )
    .mutation(({ ctx, input }) =>
      owned(() =>
        restoreStorySoundPlanVersionToWorkspace({
          ...input,
          userId: ctx.user.id,
        })
      )
    ),
});
