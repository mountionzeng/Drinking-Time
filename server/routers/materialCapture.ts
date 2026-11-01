import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { captureIdSchema, captureInputSchema } from "../../shared/materialCapture";
import { listCaptures, readCapture, revokeCaptureTokens } from "../repositories/materialCaptures";
import { createCaptureToken, receiveCapture, toCaptureReceipt } from "../services/materialCapture";
import { processCapture, saveCaptureWithoutAI } from "../services/materialCaptureProcessing";

const scope = z.object({expectedUserId:z.number().int().positive()});
const identity = scope.extend({ id: captureIdSchema });
const scoped = protectedProcedure.input(scope).use(({ctx,input,next}) => {
  if(ctx.user.id !== input.expectedUserId) throw new TRPCError({code:"CONFLICT",message:"账号已切换，请重新打开素材"});
  return next({ctx});
});
export const materialCaptureRouter = router({
  receive: scoped.input(captureInputSchema).mutation(({ctx,input}) => receiveCapture(ctx.user.id,input)),
  get: scoped.input(identity).query(async ({ctx,input}) => toCaptureReceipt(await readCapture(ctx.user.id,input.id))),
  list: scoped.input(scope.extend({beforeId:captureIdSchema.optional()})).query(async ({ctx,input}) => (await listCaptures(ctx.user.id,input.beforeId)).map(toCaptureReceipt)),
  process: scoped.input(identity).mutation(({ctx,input}) => processCapture(ctx.user.id,input.id)),
  saveOriginal: scoped.input(identity).mutation(({ctx,input}) => saveCaptureWithoutAI(ctx.user.id,input.id)),
  createShareToken: scoped.mutation(({ctx}) => createCaptureToken(ctx.user.id)),
  revokeShareTokens: scoped.mutation(({ctx}) => revokeCaptureTokens(ctx.user.id)),
});
