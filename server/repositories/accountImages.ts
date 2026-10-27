import { and, desc, eq, isNull, lt, or, max, notInArray } from "drizzle-orm";
import { generatedImages, stories } from "../../drizzle/schema";
import { ensureMemoryLoaded, getDb, memoryState } from "./runtime";
import { readTrashedStories } from "./storyTrashState";

/** 账号只读图库：包含历史候选，按 ID 游标分页，不限制故事数量。 */
export async function listAccountImages(
  userId: number,
  before?: number,
  limit = 24
) {
  const trashed = await readTrashedStories(userId);
  const trashedIds = Object.keys(trashed).map(Number);
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
              trashedIds.length ? notInArray(stories.id, trashedIds) : undefined,
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
        .filter(story => story.userId === userId && !Object.hasOwn(trashed, String(story.id)))
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

/** Latest rendered image per owned story, only used when no selected cover exists. */
export async function latestStoryImageUrls(
  userId: number
): Promise<Map<number, string>> {
  const trashed = await readTrashedStories(userId);
  const trashedIds = Object.keys(trashed).map(Number);
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const owned = new Set(
      memoryState.stories.filter(s => s.userId === userId && !Object.hasOwn(trashed, String(s.id))).map(s => s.id)
    );
    const result = new Map<number, string>();
    for (const image of [...memoryState.generatedImages].sort(
      (a, b) => b.id - a.id
    )) {
      if (
        image.storyId != null &&
        owned.has(image.storyId) &&
        (image.userId == null || image.userId === userId) &&
        image.imageUrl &&
        !result.has(image.storyId)
      )
        result.set(image.storyId, image.imageUrl);
    }
    return result;
  }
  const latest = db
    .select({ id: max(generatedImages.id).as("latestId") })
    .from(generatedImages)
    .innerJoin(stories, eq(stories.id, generatedImages.storyId))
    .where(
      and(
        eq(stories.userId, userId),
        trashedIds.length ? notInArray(stories.id, trashedIds) : undefined,
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId))
      )
    )
    .groupBy(generatedImages.storyId)
    .as("latestStoryImages");
  const rows = await db
    .select({ storyId: generatedImages.storyId, url: generatedImages.imageUrl })
    .from(generatedImages)
    .innerJoin(latest, eq(generatedImages.id, latest.id));
  return new Map(
    rows.filter(row => row.storyId != null).map(row => [row.storyId!, row.url])
  );
}
