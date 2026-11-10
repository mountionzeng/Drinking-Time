import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  storyChapters,
  storyChapterVersions,
  type StoryChapter,
} from "../../drizzle/schema";
import {
  CHAPTER_VERSION_KEEP,
  type StoredChapterBlocks,
} from "../../shared/chapterStore";
import {
  getDb,
  memoryState,
  withLocalAggregateMutationLock,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

/** One manuscript operation, including history. Never leave half of a book reorganized. */
export async function saveBookStoryboard(input: {
  storyId: number;
  userId: number;
  expected: Array<{ id: number; version: number }>;
  updates: Array<{ id: number; blocks: StoredChapterBlocks }>;
}) {
  const assertCurrent = (rows: StoryChapter[]) => {
    if (
      rows.length !== input.expected.length ||
      rows.some(
        (row, i) =>
          row.id !== input.expected[i].id ||
          row.version !== input.expected[i].version
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "整理期间书稿已有新版本，原稿未修改，请保存后重新整理。",
      });
    if (input.updates.some(update => !rows.some(row => row.id === update.id)))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "整理结果包含未知章节",
      });
  };
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const rows = await tx
        .select()
        .from(storyChapters)
        .where(
          and(
            eq(storyChapters.storyId, input.storyId),
            eq(storyChapters.userId, input.userId)
          )
        )
        .orderBy(asc(storyChapters.position), asc(storyChapters.id))
        .for("update");
      assertCurrent(rows);
      for (const update of input.updates) {
        const row = rows.find(row => row.id === update.id)!;
        await tx.insert(storyChapterVersions).values({
          chapterId: row.id,
          userId: row.userId,
          version: row.version,
          title: row.title,
          blocks: row.blocks,
          layout: row.layout,
          reason: "storyboard-preparation",
        });
        const versions = await tx
          .select({ id: storyChapterVersions.id })
          .from(storyChapterVersions)
          .where(eq(storyChapterVersions.chapterId, row.id))
          .orderBy(desc(storyChapterVersions.version));
        for (const old of versions.slice(CHAPTER_VERSION_KEEP))
          await tx
            .delete(storyChapterVersions)
            .where(eq(storyChapterVersions.id, old.id));
        await tx
          .update(storyChapters)
          .set({ blocks: update.blocks, version: row.version + 1 })
          .where(eq(storyChapters.id, row.id));
      }
      return input.updates.map(update => ({
        id: update.id,
        version: rows.find(row => row.id === update.id)!.version + 1,
      }));
    });
  return withLocalAggregateMutationLock(async () => {
    const rows = memoryState.storyChapters
      .filter(
        row => row.storyId === input.storyId && row.userId === input.userId
      )
      .sort((a, b) => a.position - b.position || a.id - b.id);
    assertCurrent(rows);
    const before = rows.map(row => structuredClone(row)),
      history = memoryState.storyChapterVersions;
    try {
      for (const update of input.updates) {
        const row = rows.find(row => row.id === update.id)!;
        const kept = {
          id: nextMemoryId("storyChapterVersion"),
          chapterId: row.id,
          userId: row.userId,
          version: row.version,
          title: row.title,
          blocks: structuredClone(row.blocks),
          layout: structuredClone(row.layout),
          reason: "storyboard-preparation",
          createdAt: now(),
        };
        memoryState.storyChapterVersions = [
          ...memoryState.storyChapterVersions.filter(
            v => v.chapterId !== row.id
          ),
          ...[
            ...memoryState.storyChapterVersions.filter(
              v => v.chapterId === row.id
            ),
            kept,
          ]
            .sort((a, b) => b.version - a.version)
            .slice(0, CHAPTER_VERSION_KEEP),
        ];
        row.blocks = structuredClone(update.blocks);
        row.version++;
        row.updatedAt = now();
      }
      await persistMemoryState();
    } catch (error) {
      rows.forEach((row, i) => Object.assign(row, before[i]));
      memoryState.storyChapterVersions = history;
      throw error;
    }
    return input.updates.map(update => ({
      id: update.id,
      version: rows.find(row => row.id === update.id)!.version,
    }));
  });
}
