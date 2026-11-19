import { z } from "zod";
import { getStoryById } from "../repositories/stories";
import { activityReport, reportVideoFeedbackActivity } from "../services/videoFeedbackActivity";
import { storedFeedbackActivity } from "../../shared/videoFeedbackActivity";
import { protectedProcedure, router } from "../_core/trpc";
import { warehouseVideoSequenceInput, warehouseCueOpeningInput } from "../../shared/warehouseVideoSequence";
import { quoteCueOpening, submitCueOpening } from "../services/warehouseCueOpening";
import { refreshVideoTakeStatus } from "../services/videoJobs";
import { cleanVideoOpening } from "../services/cleanVideoOpening";
import { placeFirstReviewTake } from "../services/placeFirstReviewTake";
import { replacePrimaryTake } from "../repositories/replacePrimaryTake";
import { withVisualEditServiceLock } from "../services/visualClipEditing";
import {
  quoteWarehouseVideoSequence,
  submitWarehouseVideoSequence,
  findWarehouseVideoSequence,
} from "../services/warehouseVideoSequence";

export const warehouseVideoSequenceRouter = router({
  reportFeedbackActivity: protectedProcedure.input(activityReport)
    .mutation(({ctx,input}) => reportVideoFeedbackActivity(ctx.user.id, input)),
  feedbackActivity: protectedProcedure
    .input(z.object({storyId:z.number().int().positive(), id:z.string().startsWith("video-feedback-activity:").max(160)}))
    .query(async ({ctx,input}) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      return storedFeedbackActivity(story?.body, input.id);
    }),
  quoteOpening: protectedProcedure.input(warehouseCueOpeningInput)
    .mutation(({ctx,input})=>quoteCueOpening(input,ctx.user.id)),
  submitOpening: protectedProcedure.input(warehouseCueOpeningInput.extend({
    requestId:z.string().uuid(), fingerprint:z.string().length(64),
    costConfirmation:z.object({accepted:z.literal(true),estimatedCny:z.number().nonnegative()}),
  })).mutation(({ctx,input})=>submitCueOpening({...input,confirmedCny:input.costConfirmation.estimatedCny},ctx.user.id)),
  replacePrimary: protectedProcedure.input(z.object({
    storyId:z.number().int().positive(), stableShotId:z.string().min(1).max(128),
    takeId:z.number().int().positive(), expectedTakeId:z.number().int().positive().nullable(), expectedVersion:z.number().int().nonnegative(),
  })).mutation(async ({ctx,input}) => {
    await withVisualEditServiceLock(input.storyId, ctx.user.id, () =>
      input.expectedTakeId === null
        ? placeFirstReviewTake({ ...input, userId: ctx.user.id })
        : replacePrimaryTake({ ...input, expectedTakeId: input.expectedTakeId, userId: ctx.user.id })
    );
    return {takeId:input.takeId};
  }),
  cleanOpening: protectedProcedure
    .input(warehouseVideoSequenceInput.pick({storyId:true,stableShotId:true}))
    .mutation(({ctx,input})=>cleanVideoOpening({...input,userId:ctx.user.id})),
  status: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        requestId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const take = await findWarehouseVideoSequence(input.storyId,input.requestId,ctx.user.id);
      if (take && ["submitted","processing"].includes(take.status) && (take.parameterSnapshot as {kind?:string})?.kind === "chat-cue-opening") {
        const result = await refreshVideoTakeStatus(take.id,ctx.user.id);
        if (result.status === "ok") return {take:result.take};
      }
      return {take};
    }),
  quote: protectedProcedure
    .input(warehouseVideoSequenceInput)
    .mutation(({ ctx, input }) =>
      quoteWarehouseVideoSequence(input, ctx.user.id),
    ),
  submit: protectedProcedure
    .input(
      warehouseVideoSequenceInput.extend({
        requestId: z.string().uuid(),
        fingerprint: z.string().length(64),
        costConfirmation: z.object({
          accepted: z.literal(true),
          estimatedCny: z.number().nonnegative(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const take = await submitWarehouseVideoSequence(
        { ...input, confirmedCny: input.costConfirmation.estimatedCny },
        ctx.user.id,
      );
      return {
        status: "ok" as const,
        take,
        takeId: take.id,
        videoStatus: take.status,
        videoUrl: take.videoUrl,
      };
    }),
});
