import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  creationIntentSchema,
  manuscriptKindSchema,
} from "../../shared/bookWorkflow";
import {
  getBookWorkflow,
  saveManuscriptVersion,
  restoreManuscriptVersion,
  proposeManuscriptConversion,
  editConversionDraft,
  adoptManuscriptConversion,
  generateFilmManuscript,
} from "../services/bookWorkflow";
const owner = z.object({ storyId: z.number().int().positive() });
const record = owner.extend({ id: z.string().uuid() });
export const bookWorkflowRouter = router({
  generateFilm: protectedProcedure.input(record.extend({
    target: z.enum(["text", "storyboard"]).default("storyboard"),
    chapterId: z.number().int().positive().optional(), request: z.string().trim().max(4000),
    conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) })).max(500).refine(messages => messages.reduce((sum, message) => sum + message.content.length, 0) <= 100000, "聊天内容过长，请先缩小范围"),
  })).mutation(({ctx,input}) => generateFilmManuscript({ ...input, userId: ctx.user.id, actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" } })),
  get: protectedProcedure
    .input(owner)
    .query(({ ctx, input }) =>
      getBookWorkflow({ ...input, userId: ctx.user.id })
    ),
  save: protectedProcedure
    .input(
      record.extend({
        kind: manuscriptKindSchema,
        intent: creationIntentSchema,
        summary: z.string().trim().min(1).max(1000),
        expectedFingerprint: z.string().length(64),
      })
    )
    .mutation(({ ctx, input }) =>
      saveManuscriptVersion({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
  restore: protectedProcedure
    .input(
      record.extend({
        versionId: z.string().uuid(),
        expectedFingerprint: z.string().length(64),
      })
    )
    .mutation(({ ctx, input }) =>
      restoreManuscriptVersion({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
  convert: protectedProcedure
    .input(
      record.extend({
        sourceId: z.string().uuid(),
        target: manuscriptKindSchema,
        intent: creationIntentSchema,
        request: z.string().trim().max(4000),
      })
    )
    .mutation(({ ctx, input }) =>
      proposeManuscriptConversion({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
  edit: protectedProcedure
    .input(
      record.extend({
        revision: z.number().int().positive(),
        texts: z.array(z.array(z.string().max(12000)).max(1000)).max(100),
      })
    )
    .mutation(({ ctx, input }) =>
      editConversionDraft({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
  adopt: protectedProcedure
    .input(record.extend({ revision: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      adoptManuscriptConversion({
        ...input,
        userId: ctx.user.id,
        actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" },
      })
    ),
});
