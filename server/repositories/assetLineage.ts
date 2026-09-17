/** Persistence operations for assetLineage. Local and MySQL behavior share this boundary. */
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { promptCompilationHeads } from "../../drizzle/schema";
import { ensureLocalPromptLineageLoaded, memoryState } from "./runtime";

type PromptAssetModality = "image" | "video";

export async function resolvePromptCompilationIdForAsset(
  db: ReturnType<typeof drizzle> | null,
  input: {
    explicitPromptCompilationId?: number | null;
    storyId?: number | null;
    userId?: number | null;
    stableShotId?: string | null;
    modality: PromptAssetModality;
  }
): Promise<number | null> {
  if (input.explicitPromptCompilationId != null) {
    return input.explicitPromptCompilationId;
  }
  if (
    input.storyId == null ||
    input.userId == null ||
    input.stableShotId == null ||
    input.stableShotId.trim() === ""
  ) {
    return null;
  }
  if (!db) {
    await ensureLocalPromptLineageLoaded();
    return (
      memoryState.promptLineage.compilationHeads.find(
        head =>
          head.storyId === input.storyId &&
          head.userId === input.userId &&
          head.stableShotId === input.stableShotId &&
          head.modality === input.modality
      )?.currentCompilationId ?? null
    );
  }
  const [head] = await db
    .select({
      currentCompilationId: promptCompilationHeads.currentCompilationId,
    })
    .from(promptCompilationHeads)
    .where(
      and(
        eq(promptCompilationHeads.storyId, input.storyId),
        eq(promptCompilationHeads.userId, input.userId),
        eq(promptCompilationHeads.stableShotId, input.stableShotId),
        eq(promptCompilationHeads.modality, input.modality)
      )
    )
    .limit(1);
  return head?.currentCompilationId ?? null;
}
