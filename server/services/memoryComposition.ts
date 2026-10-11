import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { memoryCardSelectionSchema } from "../../shared/memoryWarehouse";
import { PUBLISHING_PLATFORM_IDS } from "../../shared/publishingDraft";
import { syncStoryChatMemories } from "./chatMemoryWarehouse";
import { generateTextDraft } from "./textDraftHistory";
import { ownedCreationStory } from "../repositories/textSourceLineage";

export const memoryCompositionSchema = z.object({
  storyId: z.number().int().positive(),
  operationToken: z.string().min(8).max(100),
  expectedRevision: z.number().int().nonnegative(),
  platform: z.enum(PUBLISHING_PLATFORM_IDS),
  instruction: z.string().max(8000),
  memoryCardIds: memoryCardSelectionSchema,
});
/** Same bounded generation claim for the warehouse and chat; never adopts. */
export async function composeMemoryDraft(
  input: z.infer<typeof memoryCompositionSchema> & { userId: number }
) {
  await ownedCreationStory(input);
  try {
    await syncStoryChatMemories(input);
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "memory_pending：聊天已保存，记忆仍在收录，请稍后重试",
    });
  }
  return generateTextDraft({
    ...input,
    parentId: null,
    basis: null,
    messages: [],
    source: "unknown",
  });
}
