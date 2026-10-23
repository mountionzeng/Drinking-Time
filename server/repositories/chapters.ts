import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  chapterExports,
  chapterImports,
  chapterReturnCandidates,
  storyChapterVersions,
  storyChapters,
  type ChapterImport,
  type ChapterReturnCandidate,
  type StoryChapter,
} from "../../drizzle/schema";
import {
  CHAPTER_MAX_PER_STORY,
  CHAPTER_VERSION_KEEP,
  type StoredChapterBlocks,
} from "../../shared/chapterStore";
import type { ModuleDocument } from "../../shared/sharedLayout";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

export type ChapterContent = {
  title: string;
  blocks: StoredChapterBlocks;
  layout: ModuleDocument | null;
};

const gone = () => new TRPCError({ code: "NOT_FOUND", message: "这一章不存在" });
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "这一章在别处已有新版本，请重新加载后再改",
  });

async function persistLocal<T>(run: () => T, undo: () => void): Promise<T> {
  const result = run();
  try {
    await persistMemoryState();
  } catch (error) {
    undo();
    throw error;
  }
  return result;
}

export async function listChapters(
  storyId: number,
  userId: number
): Promise<StoryChapter[]> {
  const db = await getDb();
  if (db)
    return db
      .select()
      .from(storyChapters)
      .where(and(eq(storyChapters.storyId, storyId), eq(storyChapters.userId, userId)))
      .orderBy(asc(storyChapters.position), asc(storyChapters.id));
  return memoryState.storyChapters
    .filter(row => row.storyId === storyId && row.userId === userId)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map(row => structuredClone(row));
}

export async function getChapter(
  id: number,
  userId: number
): Promise<StoryChapter | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select()
      .from(storyChapters)
      .where(and(eq(storyChapters.id, id), eq(storyChapters.userId, userId)))
      .limit(1);
    return row ?? null;
  }
  const row = memoryState.storyChapters.find(
    item => item.id === id && item.userId === userId
  );
  return row ? structuredClone(row) : null;
}

export async function insertChapter(input: {
  storyId: number;
  userId: number;
  content: ChapterContent;
}): Promise<StoryChapter> {
  const existing = await listChapters(input.storyId, input.userId);
  if (existing.length >= CHAPTER_MAX_PER_STORY)
    throw new TRPCError({ code: "BAD_REQUEST", message: "这个故事的章节已满" });
  const position = existing.length
    ? Math.max(...existing.map(row => row.position)) + 1
    : 0;
  const db = await getDb();
  if (db) {
    const [result] = await db.insert(storyChapters).values({
      storyId: input.storyId,
      userId: input.userId,
      position,
      title: input.content.title,
      blocks: input.content.blocks,
      layout: input.content.layout,
    });
    const created = await getChapter(Number(result.insertId), input.userId);
    if (!created) throw gone();
    return created;
  }
  return withLocalAggregateMutationLock(async () => {
    const current = now();
    const row: StoryChapter = {
      id: nextMemoryId("storyChapter"),
      storyId: input.storyId,
      userId: input.userId,
      position,
      title: input.content.title,
      blocks: structuredClone(input.content.blocks),
      layout: structuredClone(input.content.layout),
      version: 1,
      createdAt: current,
      updatedAt: current,
    };
    await persistLocal(
      () => memoryState.storyChapters.push(row),
      () => {
        memoryState.storyChapters = memoryState.storyChapters.filter(item => item !== row);
      }
    );
    return structuredClone(row);
  });
}

async function keepVersion(
  tx: { insert: NonNullable<Awaited<ReturnType<typeof getDb>>>["insert"]; delete: NonNullable<Awaited<ReturnType<typeof getDb>>>["delete"] },
  chapter: StoryChapter,
  reason: string
) {
  await tx.insert(storyChapterVersions).values({
    chapterId: chapter.id,
    userId: chapter.userId,
    version: chapter.version,
    title: chapter.title,
    blocks: chapter.blocks,
    layout: chapter.layout,
    reason,
  });
  await tx
    .delete(storyChapterVersions)
    .where(
      and(
        eq(storyChapterVersions.chapterId, chapter.id),
        sql`${storyChapterVersions.version} <= ${chapter.version - CHAPTER_VERSION_KEEP}`
      )
    );
}

/**
 * Replace a chapter's content when `expectedVersion` still matches. The old
 * content is kept as a version (`reason`) so a change can be undone.
 */
export async function saveChapterContent(input: {
  id: number;
  userId: number;
  expectedVersion: number;
  content: Partial<ChapterContent>;
  reason: string;
}): Promise<StoryChapter> {
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      const [row] = await tx
        .select()
        .from(storyChapters)
        .where(and(eq(storyChapters.id, input.id), eq(storyChapters.userId, input.userId)))
        .for("update");
      if (!row) throw gone();
      if (row.version !== input.expectedVersion) throw conflict();
      await keepVersion(tx, row, input.reason);
      await tx
        .update(storyChapters)
        .set({
          title: input.content.title ?? row.title,
          blocks: input.content.blocks ?? row.blocks,
          layout: input.content.layout === undefined ? row.layout : input.content.layout,
          version: row.version + 1,
        })
        .where(eq(storyChapters.id, row.id));
      const [saved] = await tx.select().from(storyChapters).where(eq(storyChapters.id, row.id));
      return saved;
    });
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.storyChapters.find(
      item => item.id === input.id && item.userId === input.userId
    );
    if (!row) throw gone();
    if (row.version !== input.expectedVersion) throw conflict();
    const before = structuredClone(row);
    const kept = {
      id: nextMemoryId("storyChapterVersion"),
      chapterId: row.id,
      userId: row.userId,
      version: row.version,
      title: row.title,
      blocks: structuredClone(row.blocks),
      layout: structuredClone(row.layout),
      reason: input.reason,
      createdAt: now(),
    };
    const versionsBefore = memoryState.storyChapterVersions;
    await persistLocal(
      () => {
        memoryState.storyChapterVersions = [
          ...versionsBefore,
          kept,
        ].filter(
          item =>
            item.chapterId !== row.id ||
            item.version > row.version - CHAPTER_VERSION_KEEP
        );
        row.title = input.content.title ?? row.title;
        row.blocks = structuredClone(input.content.blocks ?? row.blocks);
        row.layout = structuredClone(
          input.content.layout === undefined ? row.layout : input.content.layout
        );
        row.version += 1;
        row.updatedAt = now();
      },
      () => {
        memoryState.storyChapterVersions = versionsBefore;
        Object.assign(row, before);
      }
    );
    return structuredClone(row);
  });
}

export async function listChapterVersions(chapterId: number, userId: number) {
  const db = await getDb();
  if (db)
    return db
      .select()
      .from(storyChapterVersions)
      .where(and(eq(storyChapterVersions.chapterId, chapterId), eq(storyChapterVersions.userId, userId)))
      .orderBy(desc(storyChapterVersions.version));
  return memoryState.storyChapterVersions
    .filter(row => row.chapterId === chapterId && row.userId === userId)
    .sort((a, b) => b.version - a.version)
    .map(row => structuredClone(row));
}

export async function deleteChapter(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.transaction(async tx => {
      const [row] = await tx
        .select({ id: storyChapters.id })
        .from(storyChapters)
        .where(and(eq(storyChapters.id, id), eq(storyChapters.userId, userId)));
      if (!row) throw gone();
      await tx.delete(storyChapterVersions).where(eq(storyChapterVersions.chapterId, id));
      await tx.delete(chapterReturnCandidates).where(eq(chapterReturnCandidates.chapterId, id));
      await tx.delete(storyChapters).where(eq(storyChapters.id, id));
    });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const row = memoryState.storyChapters.find(item => item.id === id && item.userId === userId);
    if (!row) throw gone();
    const snapshot = {
      chapters: memoryState.storyChapters,
      versions: memoryState.storyChapterVersions,
      candidates: memoryState.chapterReturnCandidates,
    };
    await persistLocal(
      () => {
        memoryState.storyChapters = snapshot.chapters.filter(item => item.id !== id);
        memoryState.storyChapterVersions = snapshot.versions.filter(item => item.chapterId !== id);
        memoryState.chapterReturnCandidates = snapshot.candidates.filter(item => item.chapterId !== id);
      },
      () => {
        memoryState.storyChapters = snapshot.chapters;
        memoryState.storyChapterVersions = snapshot.versions;
        memoryState.chapterReturnCandidates = snapshot.candidates;
      }
    );
  });
}

/** `order` must list every chapter id of the story exactly once. */
export async function reorderChapters(
  storyId: number,
  userId: number,
  order: number[]
): Promise<void> {
  const rows = await listChapters(storyId, userId);
  const ids = new Set(rows.map(row => row.id));
  if (order.length !== ids.size || new Set(order).size !== order.length || order.some(id => !ids.has(id)))
    throw new TRPCError({ code: "BAD_REQUEST", message: "章节顺序和现有章节不一致" });
  const db = await getDb();
  if (db) {
    await db.transaction(async tx => {
      for (const [position, id] of order.entries())
        await tx
          .update(storyChapters)
          .set({ position })
          .where(and(eq(storyChapters.id, id), eq(storyChapters.userId, userId)));
    });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const before = new Map(memoryState.storyChapters.map(row => [row.id, row.position]));
    await persistLocal(
      () => {
        for (const row of memoryState.storyChapters)
          if (row.storyId === storyId && row.userId === userId)
            row.position = order.indexOf(row.id);
      },
      () => {
        for (const row of memoryState.storyChapters) row.position = before.get(row.id) ?? row.position;
      }
    );
  });
}

export async function recordChapterExport(input: {
  packageId: string;
  chapterId: number;
  storyId: number;
  userId: number;
}): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.insert(chapterExports).values(input).onDuplicateKeyUpdate({ set: { chapterId: input.chapterId } });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    if (memoryState.chapterExports.some(row => row.packageId === input.packageId)) return;
    const row = { ...input, createdAt: now() };
    await persistLocal(
      () => memoryState.chapterExports.push(row),
      () => {
        memoryState.chapterExports = memoryState.chapterExports.filter(item => item !== row);
      }
    );
  });
}

/** The user's own export a returned package descends from, if any. */
export async function findOwnExport(packageId: string, userId: number) {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select()
      .from(chapterExports)
      .where(and(eq(chapterExports.packageId, packageId), eq(chapterExports.userId, userId)))
      .limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterExports.find(
    item => item.packageId === packageId && item.userId === userId
  );
  return row ? structuredClone(row) : null;
}

export async function findImportReceipt(
  userId: number,
  requestId: string
): Promise<ChapterImport | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select()
      .from(chapterImports)
      .where(and(eq(chapterImports.userId, userId), eq(chapterImports.requestId, requestId)))
      .limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterImports.find(
    item => item.userId === userId && item.requestId === requestId
  );
  return row ? structuredClone(row) : null;
}

export async function insertImportReceipt(
  receipt: Omit<ChapterImport, "createdAt">
): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.insert(chapterImports).values(receipt);
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const row = { ...receipt, createdAt: now() };
    await persistLocal(
      () => memoryState.chapterImports.push(row),
      () => {
        memoryState.chapterImports = memoryState.chapterImports.filter(item => item !== row);
      }
    );
  });
}

export async function insertReturnCandidate(input: {
  chapterId: number;
  storyId: number;
  userId: number;
  packageId: string;
  senderName: string;
  content: ChapterContent;
}): Promise<{ candidate: ChapterReturnCandidate; created: boolean }> {
  const db = await getDb();
  const values = {
    chapterId: input.chapterId,
    storyId: input.storyId,
    userId: input.userId,
    packageId: input.packageId,
    senderName: input.senderName,
    title: input.content.title,
    blocks: input.content.blocks,
    layout: input.content.layout,
  };
  if (db) {
    const [prior] = await db
      .select()
      .from(chapterReturnCandidates)
      .where(and(eq(chapterReturnCandidates.userId, input.userId), eq(chapterReturnCandidates.packageId, input.packageId)));
    if (prior) return { candidate: prior, created: false };
    const [result] = await db.insert(chapterReturnCandidates).values(values);
    const [row] = await db
      .select()
      .from(chapterReturnCandidates)
      .where(eq(chapterReturnCandidates.id, Number(result.insertId)));
    return { candidate: row, created: true };
  }
  return withLocalAggregateMutationLock(async () => {
    const prior = memoryState.chapterReturnCandidates.find(
      row => row.userId === input.userId && row.packageId === input.packageId
    );
    if (prior) return { candidate: structuredClone(prior), created: false };
    const row: ChapterReturnCandidate = {
      ...values,
      blocks: structuredClone(values.blocks),
      layout: structuredClone(values.layout),
      id: nextMemoryId("chapterReturnCandidate"),
      status: "pending",
      createdAt: now(),
    };
    await persistLocal(
      () => memoryState.chapterReturnCandidates.push(row),
      () => {
        memoryState.chapterReturnCandidates = memoryState.chapterReturnCandidates.filter(item => item !== row);
      }
    );
    return { candidate: structuredClone(row), created: true };
  });
}

export async function listReturnCandidates(
  chapterId: number,
  userId: number
): Promise<ChapterReturnCandidate[]> {
  const db = await getDb();
  if (db)
    return db
      .select()
      .from(chapterReturnCandidates)
      .where(and(eq(chapterReturnCandidates.chapterId, chapterId), eq(chapterReturnCandidates.userId, userId)))
      .orderBy(desc(chapterReturnCandidates.id));
  return memoryState.chapterReturnCandidates
    .filter(row => row.chapterId === chapterId && row.userId === userId)
    .sort((a, b) => b.id - a.id)
    .map(row => structuredClone(row));
}

export async function getReturnCandidate(id: number, userId: number) {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select()
      .from(chapterReturnCandidates)
      .where(and(eq(chapterReturnCandidates.id, id), eq(chapterReturnCandidates.userId, userId)));
    return row ?? null;
  }
  const row = memoryState.chapterReturnCandidates.find(
    item => item.id === id && item.userId === userId
  );
  return row ? structuredClone(row) : null;
}

export async function setCandidateStatus(
  id: number,
  userId: number,
  status: "adopted" | "dismissed"
): Promise<void> {
  const db = await getDb();
  if (db) {
    await db
      .update(chapterReturnCandidates)
      .set({ status })
      .where(and(eq(chapterReturnCandidates.id, id), eq(chapterReturnCandidates.userId, userId)));
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const row = memoryState.chapterReturnCandidates.find(
      item => item.id === id && item.userId === userId
    );
    if (!row) return;
    const before = row.status;
    await persistLocal(
      () => {
        row.status = status;
      },
      () => {
        row.status = before;
      }
    );
  });
}
