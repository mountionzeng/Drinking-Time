import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { generatedImages, stories } from "../../drizzle/schema";
import { ensureMemoryLoaded, getDb, memoryState } from "./runtime";

/** 账号只读图库：包含历史候选，按 ID 游标分页，不限制故事数量。 */
export async function listAccountImages(
  userId: number,
  before?: number,
  limit = 24
) {
  const db = await getDb();
  const fields = {
    id: generatedImages.id,
    storyId: generatedImages.storyId,
    storyTitle: stories.title,
    imageUrl: generatedImages.imageUrl,
    createdAt: generatedImages.createdAt,
  };
  let rows: Array<{
    id: number;
    storyId: number | null;
    storyTitle: string | null;
    imageUrl: string;
    createdAt: Date;
  }>;
  if (db) {
    rows = await db
      .select(fields)
      .from(generatedImages)
      .leftJoin(stories, eq(generatedImages.storyId, stories.id))
      .where(
        and(
          or(
            and(
              eq(stories.userId, userId),
              or(
                eq(generatedImages.userId, userId),
                isNull(generatedImages.userId)
              )
            ),
            and(
              isNull(generatedImages.storyId),
              eq(generatedImages.userId, userId)
            )
          ),
          before === undefined ? undefined : lt(generatedImages.id, before)
        )
      )
      .orderBy(desc(generatedImages.id))
      .limit(limit + 1);
  } else {
    await ensureMemoryLoaded();
    const ownedStories = new Map(
      memoryState.stories
        .filter(story => story.userId === userId)
        .map(story => [story.id, story.title])
    );
    rows = memoryState.generatedImages
      .filter(
        image =>
          (before === undefined || image.id < before) &&
          (image.storyId == null
            ? image.userId === userId
            : ownedStories.has(image.storyId) &&
              (image.userId === userId || image.userId == null))
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, limit + 1)
      .map(image => ({
        id: image.id,
        storyId: image.storyId,
        storyTitle:
          image.storyId == null ? null : ownedStories.get(image.storyId)!,
        imageUrl: image.imageUrl,
        createdAt: image.createdAt,
      }));
  }
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}
