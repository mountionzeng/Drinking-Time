import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  chapterExports,
  chapterImports,
  chapterReturnCandidates,
  storyChapterVersions,
  storyChapters,
  stories,
  users,
  type ChapterImport,
  type ChapterReturnCandidate,
  type StoryChapter,
} from "../../drizzle/schema";
import {
  CHAPTER_MAX_PER_STORY,
  CHAPTER_VERSION_KEEP,
  type StoredChapterBlocks,
} from "../../shared/chapterStore";
import type { StoredChapterLayout } from "../../shared/chapterStore";
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
  layout: StoredChapterLayout | null;
};

const gone = () =>
  new TRPCError({ code: "NOT_FOUND", message: "这一章不存在" });
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
      .where(
        and(
          eq(storyChapters.storyId, storyId),
          eq(storyChapters.userId, userId)
        )
      )
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
        memoryState.storyChapters = memoryState.storyChapters.filter(
          item => item !== row
        );
      }
    );
    return structuredClone(row);
  });
}

async function keepVersion(
  tx: {
    insert: NonNullable<Awaited<ReturnType<typeof getDb>>>["insert"];
    delete: NonNullable<Awaited<ReturnType<typeof getDb>>>["delete"];
    select: NonNullable<Awaited<ReturnType<typeof getDb>>>["select"];
  },
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
  const stale = await tx
    .select({ id: storyChapterVersions.id })
    .from(storyChapterVersions)
    .where(eq(storyChapterVersions.chapterId, chapter.id))
    .orderBy(desc(storyChapterVersions.version));
  for (const row of stale.slice(CHAPTER_VERSION_KEEP))
    await tx
      .delete(storyChapterVersions)
      .where(eq(storyChapterVersions.id, row.id));
}

/** Layout-only autosaves are not kept as history; adopting or restoring keeps what it replaced. */
const KEEPS_HISTORY = (reason: string) => reason !== "autosave";

/**
 * Replace a chapter's content when `expectedVersion` still matches. Anything
 * other than an autosave keeps the old content as a version so it can be undone.
 */
export async function saveChapterContent(input: {
  id: number;
  userId: number;
  expectedVersion: number;
  content: Partial<ChapterContent>;
  reason: string;
  candidateId?: number;
}): Promise<StoryChapter> {
  const nextBlocks = (row: StoryChapter) => input.content.blocks ?? row.blocks;
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      const [row] = await tx
        .select()
        .from(storyChapters)
        .where(
          and(
            eq(storyChapters.id, input.id),
            eq(storyChapters.userId, input.userId)
          )
        )
        .for("update");
      if (!row) throw gone();
      if (row.version !== input.expectedVersion) throw conflict();
      if (input.candidateId) {
        const [candidate] = await tx
          .select()
          .from(chapterReturnCandidates)
          .where(
            and(
              eq(chapterReturnCandidates.id, input.candidateId),
              eq(chapterReturnCandidates.chapterId, row.id),
              eq(chapterReturnCandidates.userId, input.userId)
            )
          )
          .for("update");
        if (!candidate || candidate.status !== "pending") throw conflict();
        await tx
          .update(chapterReturnCandidates)
          .set({ status: "adopted" })
          .where(eq(chapterReturnCandidates.id, candidate.id));
      }
      if (KEEPS_HISTORY(input.reason)) await keepVersion(tx, row, input.reason);
      await tx
        .update(storyChapters)
        .set({
          title: input.content.title ?? row.title,
          blocks: nextBlocks(row),
          layout:
            input.content.layout === undefined
              ? row.layout
              : input.content.layout,
          version: row.version + 1,
        })
        .where(eq(storyChapters.id, row.id));
      const [saved] = await tx
        .select()
        .from(storyChapters)
        .where(eq(storyChapters.id, row.id));
      return saved;
    });
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.storyChapters.find(
      item => item.id === input.id && item.userId === input.userId
    );
    if (!row) throw gone();
    if (row.version !== input.expectedVersion) throw conflict();
    const candidate = input.candidateId
      ? memoryState.chapterReturnCandidates.find(
          item =>
            item.id === input.candidateId &&
            item.chapterId === row.id &&
            item.userId === input.userId
        )
      : undefined;
    if (input.candidateId && (!candidate || candidate.status !== "pending"))
      throw conflict();
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
    const blocks = structuredClone(nextBlocks(row));
    await persistLocal(
      () => {
        if (candidate) candidate.status = "adopted";
        if (KEEPS_HISTORY(input.reason)) {
          const mine = [...versionsBefore, kept]
            .filter(item => item.chapterId === row.id)
            .sort((x, y) => y.version - x.version)
            .slice(0, CHAPTER_VERSION_KEEP);
          memoryState.storyChapterVersions = [
            ...versionsBefore.filter(item => item.chapterId !== row.id),
            ...mine,
          ];
        }
        row.title = input.content.title ?? row.title;
        row.blocks = blocks;
        row.layout = structuredClone(
          input.content.layout === undefined ? row.layout : input.content.layout
        );
        row.version += 1;
        row.updatedAt = now();
      },
      () => {
        memoryState.storyChapterVersions = versionsBefore;
        if (candidate) candidate.status = "pending";
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
      .where(
        and(
          eq(storyChapterVersions.chapterId, chapterId),
          eq(storyChapterVersions.userId, userId)
        )
      )
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
      await tx
        .delete(storyChapterVersions)
        .where(eq(storyChapterVersions.chapterId, id));
      await tx
        .delete(chapterReturnCandidates)
        .where(eq(chapterReturnCandidates.chapterId, id));
      await tx.delete(storyChapters).where(eq(storyChapters.id, id));
    });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const row = memoryState.storyChapters.find(
      item => item.id === id && item.userId === userId
    );
    if (!row) throw gone();
    const snapshot = {
      chapters: memoryState.storyChapters,
      versions: memoryState.storyChapterVersions,
      candidates: memoryState.chapterReturnCandidates,
    };
    await persistLocal(
      () => {
        memoryState.storyChapters = snapshot.chapters.filter(
          item => item.id !== id
        );
        memoryState.storyChapterVersions = snapshot.versions.filter(
          item => item.chapterId !== id
        );
        memoryState.chapterReturnCandidates = snapshot.candidates.filter(
          item => item.chapterId !== id
        );
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
  if (
    order.length !== ids.size ||
    new Set(order).size !== order.length ||
    order.some(id => !ids.has(id))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "章节顺序和现有章节不一致",
    });
  const db = await getDb();
  if (db) {
    await db.transaction(async tx => {
      for (const [position, id] of order.entries())
        await tx
          .update(storyChapters)
          .set({ position })
          .where(
            and(eq(storyChapters.id, id), eq(storyChapters.userId, userId))
          );
    });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const before = new Map(
      memoryState.storyChapters.map(row => [row.id, row.position])
    );
    await persistLocal(
      () => {
        for (const row of memoryState.storyChapters)
          if (row.storyId === storyId && row.userId === userId)
            row.position = order.indexOf(row.id);
      },
      () => {
        for (const row of memoryState.storyChapters)
          row.position = before.get(row.id) ?? row.position;
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
    await db
      .insert(chapterExports)
      .values(input)
      .onDuplicateKeyUpdate({ set: { chapterId: input.chapterId } });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    if (
      memoryState.chapterExports.some(row => row.packageId === input.packageId)
    )
      return;
    const row = { ...input, createdAt: now() };
    await persistLocal(
      () => memoryState.chapterExports.push(row),
      () => {
        memoryState.chapterExports = memoryState.chapterExports.filter(
          item => item !== row
        );
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
      .where(
        and(
          eq(chapterExports.packageId, packageId),
          eq(chapterExports.userId, userId)
        )
      )
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
      .where(
        and(
          eq(chapterImports.userId, userId),
          eq(chapterImports.requestId, requestId)
        )
      )
      .limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterImports.find(
    item => item.userId === userId && item.requestId === requestId
  );
  return row ? structuredClone(row) : null;
}

/** Content and its receipt commit together, including multi-chapter imports. */
export async function commitChapterImport(input: {
  userId: number;
  requestId: string;
  requestHash: string;
  storyId?: number;
  targetChapterId?: number;
  title: string;
  packageId: string;
  senderName: string;
  contents: ChapterContent[];
}) {
  const repeated = (prior: ChapterImport) => {
    if (prior.requestHash !== input.requestHash)
      throw new TRPCError({
        code: "CONFLICT",
        message: "这次导入已完成，请重新选择文件",
      });
    return {
      outcome: prior.outcome,
      storyId: prior.storyId,
      chapterId: prior.chapterId,
      repeated: true,
    };
  };
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      // All imports for one account serialize here, so retries cannot create extra stories.
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");
      const [prior] = await tx
        .select()
        .from(chapterImports)
        .where(
          and(
            eq(chapterImports.userId, input.userId),
            eq(chapterImports.requestId, input.requestId)
          )
        );
      if (prior) return repeated(prior);
      let storyId = input.storyId;
      let chapterId: number;
      const outcome = input.targetChapterId
        ? "candidate"
        : storyId
          ? "append"
          : "keep";
      if (input.targetChapterId) {
        const [target] = await tx
          .select()
          .from(storyChapters)
          .where(
            and(
              eq(storyChapters.id, input.targetChapterId),
              eq(storyChapters.userId, input.userId)
            )
          )
          .for("update");
        if (!target) throw gone();
        storyId = target.storyId;
        chapterId = target.id;
        await tx
          .insert(chapterReturnCandidates)
          .values({
            chapterId,
            storyId,
            userId: input.userId,
            packageId: input.packageId,
            senderName: input.senderName,
            ...input.contents[0],
          })
          .onDuplicateKeyUpdate({ set: { packageId: input.packageId } });
      } else {
        if (!storyId) {
          const [created] = await tx
            .insert(stories)
            .values({ userId: input.userId, title: input.title, body: {} });
          storyId = Number(created.insertId);
        } else {
          const [owned] = await tx
            .select({ id: stories.id })
            .from(stories)
            .where(
              and(eq(stories.id, storyId), eq(stories.userId, input.userId))
            )
            .for("update");
          if (!owned) throw gone();
        }
        const existing = await tx
          .select({ position: storyChapters.position })
          .from(storyChapters)
          .where(eq(storyChapters.storyId, storyId));
        if (existing.length + input.contents.length > CHAPTER_MAX_PER_STORY)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "这个故事的章节已满",
          });
        const position = existing.length
          ? Math.max(...existing.map(row => row.position)) + 1
          : 0;
        chapterId = 0;
        for (const [offset, content] of input.contents.entries()) {
          const [created] = await tx.insert(storyChapters).values({
            storyId,
            userId: input.userId,
            position: position + offset,
            ...content,
          });
          chapterId ||= Number(created.insertId);
        }
      }
      await tx.insert(chapterImports).values({
        userId: input.userId,
        requestId: input.requestId,
        requestHash: input.requestHash,
        storyId,
        chapterId,
        outcome,
      });
      return { storyId, chapterId, outcome, repeated: false };
    });
  return withLocalAggregateMutationLock(async () => {
    const prior = memoryState.chapterImports.find(
      row => row.userId === input.userId && row.requestId === input.requestId
    );
    if (prior) return repeated(prior);
    const before = {
      stories: memoryState.stories,
      chapters: memoryState.storyChapters,
      candidates: memoryState.chapterReturnCandidates,
      receipts: memoryState.chapterImports,
    };
    const current = now();
    let storyId = input.storyId;
    let chapterId: number;
    const outcome = input.targetChapterId
      ? "candidate"
      : storyId
        ? "append"
        : "keep";
    const target = input.targetChapterId
      ? memoryState.storyChapters.find(
          row => row.id === input.targetChapterId && row.userId === input.userId
        )
      : undefined;
    if (input.targetChapterId && !target) throw gone();
    if (
      storyId &&
      !memoryState.stories.some(
        row => row.id === storyId && row.userId === input.userId
      )
    )
      throw gone();
    const existing = memoryState.storyChapters.filter(
      row => row.storyId === storyId
    );
    if (
      !target &&
      existing.length + input.contents.length > CHAPTER_MAX_PER_STORY
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "这个故事的章节已满",
      });
    return persistLocal(
      () => {
        if (target) {
          storyId = target.storyId;
          chapterId = target.id;
          if (
            !memoryState.chapterReturnCandidates.some(
              row =>
                row.userId === input.userId && row.packageId === input.packageId
            )
          )
            memoryState.chapterReturnCandidates = [
              ...before.candidates,
              {
                id: nextMemoryId("chapterReturnCandidate"),
                chapterId,
                storyId,
                userId: input.userId,
                packageId: input.packageId,
                senderName: input.senderName,
                ...structuredClone(input.contents[0]),
                status: "pending",
                createdAt: current,
              },
            ];
        } else {
          if (!storyId) {
            storyId = nextMemoryId("story");
            memoryState.stories = [
              ...before.stories,
              {
                id: storyId,
                userId: input.userId,
                title: input.title,
                body: {},
                projectId: null,
                logline: null,
                theme: null,
                arc: null,
                summary: null,
                createdAt: current,
                updatedAt: current,
              },
            ];
          }
          const position = existing.length
            ? Math.max(...existing.map(row => row.position)) + 1
            : 0;
          const created = input.contents.map((content, offset) => ({
            id: nextMemoryId("storyChapter"),
            storyId: storyId!,
            userId: input.userId,
            position: position + offset,
            ...structuredClone(content),
            version: 1,
            createdAt: current,
            updatedAt: current,
          }));
          chapterId = created[0].id;
          memoryState.storyChapters = [...before.chapters, ...created];
        }
        memoryState.chapterImports = [
          ...before.receipts,
          {
            userId: input.userId,
            requestId: input.requestId,
            requestHash: input.requestHash,
            storyId: storyId!,
            chapterId,
            outcome,
            createdAt: current,
          },
        ];
        return { storyId: storyId!, chapterId, outcome, repeated: false };
      },
      () => {
        memoryState.stories = before.stories;
        memoryState.storyChapters = before.chapters;
        memoryState.chapterReturnCandidates = before.candidates;
        memoryState.chapterImports = before.receipts;
      }
    );
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
      .where(
        and(
          eq(chapterReturnCandidates.chapterId, chapterId),
          eq(chapterReturnCandidates.userId, userId)
        )
      )
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
      .where(
        and(
          eq(chapterReturnCandidates.id, id),
          eq(chapterReturnCandidates.userId, userId)
        )
      );
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
    const [result] = await db
      .update(chapterReturnCandidates)
      .set({ status })
      .where(
        and(
          eq(chapterReturnCandidates.id, id),
          eq(chapterReturnCandidates.userId, userId),
          eq(chapterReturnCandidates.status, "pending")
        )
      );
    if (!result.affectedRows) throw conflict();
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const row = memoryState.chapterReturnCandidates.find(
      item => item.id === id && item.userId === userId
    );
    if (!row || row.status !== "pending") throw conflict();
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
