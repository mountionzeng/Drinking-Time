import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { memoryCardInputSchema } from "../../shared/memoryWarehouse";
import {
  archiveMemoryCard,
  insertMemoryCard,
  listMemoryCards,
  listStoryMemoryCards,
  reviseMemoryCard,
} from "../repositories/memoryCards";
import { getStoryById } from "../repositories/stories";
import {
  syncChatMemoryPage,
  syncStoryChatMemories,
} from "../services/chatMemoryWarehouse";
import { getTextDraftHistory } from "../services/textDraftHistory";
import {
  composeMemoryDraft,
  memoryCompositionSchema,
} from "../services/memoryComposition";

export const memoryWarehouseRouter = router({
  syncStory: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await getStoryById(input.storyId, ctx.user.id)))
        throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
      await syncStoryChatMemories({ ...input, userId: ctx.user.id });
      return { synced: true };
    }),
  forStory: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        offset: z.number().int().nonnegative().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const history = await getTextDraftHistory({
        ...input,
        userId: ctx.user.id,
      });
      const ids = [
        ...new Set(
          history.versions.flatMap(
            version => version.memoryCards?.map(card => card.id) ?? []
          )
        ),
      ];
      const rows = await listStoryMemoryCards(
        ctx.user.id,
        input.storyId,
        ids,
        input.offset
      );
      return {
        cards: rows.slice(0, 50),
        nextOffset: rows.length > 50 ? input.offset + 50 : null,
      };
    }),
  revise: protectedProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          revisionId: z.string().uuid(),
          storyId: z.number().int().positive(),
          expectedTitle: z.string().max(120),
          expectedContent: z.string().max(12000),
          title: memoryCardInputSchema.shape.title,
          content: memoryCardInputSchema.shape.content,
        })
        .refine(input => input.id !== input.revisionId, "修订必须保留原始记忆")
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await getStoryById(input.storyId, ctx.user.id)))
        throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
      return reviseMemoryCard(ctx.user.id, input);
    }),
  compose: protectedProcedure
    .input(memoryCompositionSchema)
    .mutation(({ input, ctx }) =>
      composeMemoryDraft({ ...input, userId: ctx.user.id })
    ),
  sync: protectedProcedure
    .input(z.object({ afterId: z.number().int().nonnegative().default(0) }))
    .mutation(({ ctx, input }) =>
      syncChatMemoryPage(ctx.user.id, input.afterId)
    ),
  list: protectedProcedure
    .input(
      z.object({
        offset: z.number().int().min(0).default(0),
        archived: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await listMemoryCards(
        ctx.user.id,
        input.offset,
        51,
        input.archived
      );
      return {
        cards: rows.slice(0, 50),
        nextOffset: rows.length > 50 ? input.offset + 50 : null,
      };
    }),
  save: protectedProcedure
    .input(memoryCardInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (
        input.sourceStoryId &&
        !(await getStoryById(input.sourceStoryId, ctx.user.id))
      )
        throw new TRPCError({ code: "NOT_FOUND", message: "来源故事不存在" });
      return insertMemoryCard(ctx.user.id, input);
    }),
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid(), archived: z.boolean() }))
    .mutation(({ ctx, input }) =>
      archiveMemoryCard(ctx.user.id, input.id, input.archived)
    ),
});
