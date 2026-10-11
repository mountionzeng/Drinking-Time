import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { memoryCardInputSchema } from "../../shared/memoryWarehouse";
import {
  archiveMemoryCard,
  insertMemoryCard,
  listMemoryCards,
} from "../repositories/memoryCards";
import { getStoryById } from "../repositories/stories";
import { syncChatMemoryPage } from "../services/chatMemoryWarehouse";
import { composeMemoryDraft, memoryCompositionSchema } from "../services/memoryComposition";

export const memoryWarehouseRouter = router({
  compose: protectedProcedure.input(memoryCompositionSchema).mutation(({ input, ctx }) => composeMemoryDraft({ ...input, userId: ctx.user.id })),
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
