import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { studioUiContextSchema } from "../../shared/studioAssistant";
import {
  planStudioAssistant,
  confirmStudioAssistant,
} from "../services/studioAssistant";
export const studioAssistantRouter = router({
  chat: protectedProcedure
    .input(
      z.object({
        message: z.string().trim().min(1).max(12000),
        ui: studioUiContextSchema,
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(3000),
            })
          )
          .max(8)
          .default([]),
      })
    )
    .mutation(({ ctx, input }) =>
      planStudioAssistant({ userId: ctx.user.id, ...input })
    ),
  confirm: protectedProcedure
    .input(
      z.object({
        token: z.string().max(750000),
        message: z.string().max(100),
        ui: studioUiContextSchema,
      })
    )
    .mutation(({ ctx, input }) => confirmStudioAssistant(ctx.user.id, input)),
});
