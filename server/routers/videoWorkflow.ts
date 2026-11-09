import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { creationIntentSchema } from "../../shared/bookWorkflow";
import {
  getVideoWorkflow,
  saveVideoWorkVersion,
  exportVideoWorkVersion,
} from "../services/videoWorkflow";
const owner = z.object({ storyId: z.number().int().positive() });
const record = owner.extend({ id: z.string().uuid() });
export const videoWorkflowRouter = router({
  get: protectedProcedure
    .input(owner)
    .query(({ ctx, input }) =>
      getVideoWorkflow({ ...input, userId: ctx.user.id })
    ),
  save: protectedProcedure
    .input(
      record.extend({
        intent: creationIntentSchema,
        summary: z.string().trim().min(1).max(1000),
      })
    )
    .mutation(({ ctx, input }) =>
      saveVideoWorkVersion({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
  export: protectedProcedure
    .input(
      record.extend({
        exportId: z.string().uuid(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
      })
    )
    .mutation(({ ctx, input }) =>
      exportVideoWorkVersion({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
});
