import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { memoryCards, stories, type MemoryCard } from "../../drizzle/schema";
import type { MemoryCardInput } from "../../shared/memoryWarehouse";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

/** Keyset pagination stays stable while chatting changes story updatedAt. */
export async function listMemorySourceStoryIds(
  userId: number,
  afterId: number
) {
  const db = await getDb();
  if (db)
    return db
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.userId, userId), gt(stories.id, afterId)))
      .orderBy(asc(stories.id))
      .limit(21);
  return memoryState.stories
    .filter(row => row.userId === userId && row.id > afterId)
    .sort((a, b) => a.id - b.id)
    .slice(0, 21)
    .map(row => ({ id: row.id }));
}

/** Append-only mirror. Duplicate source snapshots never restore archived memories. */
export async function insertChatMemoryCards(rows: MemoryCard[]) {
  if (!rows.length) return;
  const db = await getDb();
  if (db) {
    for (let start = 0; start < rows.length; start += 50) {
      await db
        .insert(memoryCards)
        .values(rows.slice(start, start + 50))
        .onDuplicateKeyUpdate({ set: { id: sql`${memoryCards.id}` } });
    }
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const existing = new Set(memoryState.memoryCards.map(row => row.id));
    const added = rows.filter(row => {
      if (existing.has(row.id)) return false;
      existing.add(row.id);
      return true;
    });
    if (!added.length) return;
    memoryState.memoryCards.push(...added);
    try {
      await persistMemoryState();
    } catch (error) {
      const failed = new Set(added);
      memoryState.memoryCards = memoryState.memoryCards.filter(
        row => !failed.has(row)
      );
      throw error;
    }
  });
}

export async function listMemoryCards(
  userId: number,
  offset: number,
  limit: number,
  archived: boolean
) {
  const db = await getDb();
  if (db)
    return db
      .select()
      .from(memoryCards)
      .where(
        and(eq(memoryCards.userId, userId), eq(memoryCards.archived, archived))
      )
      .orderBy(desc(memoryCards.createdAt), desc(memoryCards.id))
      .limit(limit)
      .offset(offset);
  return structuredClone(
    memoryState.memoryCards
      .filter(row => row.userId === userId && row.archived === archived)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id)
      )
      .slice(offset, offset + limit)
  );
}

export async function readMemoryCards(userId: number, ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  if (db)
    return db
      .select()
      .from(memoryCards)
      .where(and(eq(memoryCards.userId, userId), inArray(memoryCards.id, ids)));
  return structuredClone(
    memoryState.memoryCards.filter(
      row => row.userId === userId && ids.includes(row.id)
    )
  );
}

export async function listStoryMemoryCards(
  userId: number,
  storyId: number,
  linkedIds: string[],
  offset: number
) {
  const db = await getDb();
  if (db)
    return db
      .select()
      .from(memoryCards)
      .where(
        and(
          eq(memoryCards.userId, userId),
          eq(memoryCards.archived, false),
          linkedIds.length
            ? or(
                eq(memoryCards.sourceStoryId, storyId),
                inArray(memoryCards.id, linkedIds)
              )
            : eq(memoryCards.sourceStoryId, storyId)
        )
      )
      .orderBy(desc(memoryCards.createdAt), desc(memoryCards.id))
      .limit(51)
      .offset(offset);
  const linked = new Set(linkedIds);
  return structuredClone(
    memoryState.memoryCards
      .filter(
        card =>
          card.userId === userId &&
          !card.archived &&
          (card.sourceStoryId === storyId || linked.has(card.id))
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id)
      )
      .slice(offset, offset + 51)
  );
}

/** Keep the original as an archived source. New content is explicitly a user's revision. */
export async function reviseMemoryCard(
  userId: number,
  input: {
    id: string;
    revisionId: string;
    storyId: number;
    expectedTitle: string;
    expectedContent: string;
    title: string;
    content: string;
  }
) {
  const hex = createHash("sha256")
    .update(`${userId}:${input.id}:${input.revisionId}`)
    .digest("hex");
  const revisionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const revise = (
    source: MemoryCard | undefined,
    existing: MemoryCard | undefined
  ) => {
    if (!source || source.userId !== userId)
      throw new TRPCError({ code: "NOT_FOUND", message: "记忆不存在" });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.title !== input.title ||
        existing.content !== input.content ||
        existing.sourceStoryId !== input.storyId ||
        existing.origin !== "note" ||
        existing.kind !== source.kind
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "保存标识已使用，请重新打开编辑",
        });
      return existing;
    }
    if (
      source.archived ||
      source.title !== input.expectedTitle ||
      source.content !== input.expectedContent
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "这段记忆已更新或归档，你的修改仍保留，请重新读取",
      });
    return {
      ...source,
      id: revisionId,
      title: input.title,
      content: input.content,
      sourceStoryId: input.storyId,
      origin: "note" as const,
      archived: false,
      createdAt: new Date(),
    };
  };
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const [source] = await tx
        .select()
        .from(memoryCards)
        .where(
          and(eq(memoryCards.id, input.id), eq(memoryCards.userId, userId))
        )
        .for("update");
      const [existing] = await tx
        .select()
        .from(memoryCards)
        .where(eq(memoryCards.id, revisionId));
      const row = revise(source, existing);
      if (!existing) {
        await tx.insert(memoryCards).values(row);
        await tx
          .update(memoryCards)
          .set({ archived: true })
          .where(
            and(eq(memoryCards.id, input.id), eq(memoryCards.userId, userId))
          );
      }
      return row;
    });
  return withLocalAggregateMutationLock(async () => {
    const source = memoryState.memoryCards.find(
      card => card.id === input.id && card.userId === userId
    );
    const existing = memoryState.memoryCards.find(
      card => card.id === revisionId
    );
    const row = revise(source, existing);
    if (existing) return structuredClone(row);
    source!.archived = true;
    memoryState.memoryCards.push(row);
    try {
      await persistMemoryState();
    } catch (error) {
      source!.archived = false;
      memoryState.memoryCards = memoryState.memoryCards.filter(
        card => card !== row
      );
      throw error;
    }
    return structuredClone(row);
  });
}

/** Two matches suffice to require clarification; never choose the first title. */
export async function findMemoryCardMatches(userId: number, reference: string) {
  const db = await getDb();
  if (db) {
    const owned = and(
      eq(memoryCards.userId, userId),
      eq(memoryCards.archived, false)
    );
    const exact = await db
      .select()
      .from(memoryCards)
      .where(
        and(
          owned,
          or(eq(memoryCards.id, reference), eq(memoryCards.title, reference))
        )
      )
      .limit(2);
    if (exact.length) return exact;
    return db
      .select()
      .from(memoryCards)
      .where(
        and(
          owned,
          sql`(LOCATE(${reference}, ${memoryCards.title}) > 0 OR LOCATE(${reference}, ${memoryCards.content}) > 0)`
        )
      )
      .limit(2);
  }
  const owned = memoryState.memoryCards.filter(
    c => c.userId === userId && !c.archived
  );
  const exact = owned.filter(c => c.id === reference || c.title === reference);
  return structuredClone(
    (exact.length
      ? exact
      : owned.filter(
          c => c.title.includes(reference) || c.content.includes(reference)
        )
    ).slice(0, 2)
  );
}

/** Client UUID is an idempotency key. A collision never updates a previous card. */
export async function insertMemoryCard(userId: number, input: MemoryCardInput) {
  const row: MemoryCard = {
    ...input,
    userId,
    createdAt: new Date(),
    archived: false,
  };
  const check = (existing: MemoryCard | undefined) => {
    if (
      !existing ||
      existing.userId !== userId ||
      (Object.keys(input) as (keyof MemoryCardInput)[]).some(
        key => existing[key] !== input[key]
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "保存标识已使用，请重新打开保存窗口",
      });
    return structuredClone(existing);
  };
  const db = await getDb();
  if (db) {
    await db
      .insert(memoryCards)
      .values(row)
      .onDuplicateKeyUpdate({ set: { id: row.id } });
    return check((await readMemoryCards(userId, [input.id]))[0]);
  }
  return withLocalAggregateMutationLock(async () => {
    const existing = memoryState.memoryCards.find(card => card.id === input.id);
    if (existing) return check(existing);
    memoryState.memoryCards.push(row);
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.memoryCards = memoryState.memoryCards.filter(
        card => card !== row
      );
      throw error;
    }
    return structuredClone(row);
  });
}

export async function archiveMemoryCard(
  userId: number,
  id: string,
  archived: boolean
) {
  const db = await getDb();
  if (db) {
    if (!(await readMemoryCards(userId, [id])).length)
      throw new TRPCError({ code: "NOT_FOUND", message: "记忆卡片不存在" });
    await db
      .update(memoryCards)
      .set({ archived })
      .where(and(eq(memoryCards.id, id), eq(memoryCards.userId, userId)));
    return;
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.memoryCards.find(
      card => card.id === id && card.userId === userId
    );
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "记忆卡片不存在" });
    const before = row.archived;
    row.archived = archived;
    try {
      await persistMemoryState();
    } catch (error) {
      row.archived = before;
      throw error;
    }
  });
}
