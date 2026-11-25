import { and, count, desc, eq, or, sql as sqlExpr } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  stories,
  storyMailboxEntries as entries,
  storyMailboxThreads as threads,
  type StoryMailboxEntry,
  type StoryMailboxThread,
} from "../../drizzle/schema";
import type { MailboxMemoryVersion } from "../../shared/storyMailbox";
import { withStoryMemory } from "../../shared/storyMemoryDocument";
import { getDb, memoryState, nextMemoryId } from "./runtime";
import {
  appendMailboxSnapshot,
  mailboxEntry,
  mailboxGone,
  requireMailboxPair,
  resolveMailboxContact,
  withMailboxPair,
  type MailboxSql,
} from "./storyMailbox";
import { mailboxDigest, type MailboxPackage } from "./storyMailboxPackage";
import { getStoryById } from "./stories";

const staleVersion = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "共享笔记已有更新，请打开最新一版再编辑。",
  });

const readThread = async (sql: MailboxSql | null, id: string) =>
  sql
    ? (await sql.select().from(threads).where(eq(threads.id, id)).limit(1))[0]
    : memoryState.storyMailboxThreads.find(row => row.id === id);

const readLatest = async (
  sql: MailboxSql | null,
  thread: StoryMailboxThread
) =>
  sql
    ? (
        await sql
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.threadId, thread.id),
              eq(entries.senderId, thread.senderId)
            )
          )
          .orderBy(desc(entries.createdAt), desc(entries.id))
          .limit(1)
      )[0]
    : memoryState.storyMailboxEntries.findLast(
        row => row.threadId === thread.id && row.senderId === thread.senderId
      );

function packageMemory(
  title: string,
  markdown: string,
  prior?: MailboxMemoryVersion
): MailboxPackage {
  const before = new Set(
    (prior?.markdown ?? "").split("\n").filter(line => line.trim())
  );
  const after = new Set(markdown.split("\n").filter(line => line.trim()));
  const memory = {
    version: (prior?.version ?? 0) + 1,
    markdown,
    added: [...after].filter(line => !before.has(line)),
    removed: [...before].filter(line => !after.has(line)),
  };
  return {
    schemaVersion: 1,
    title,
    memory,
    body: {},
    chapters: [],
    chapterVersions: [],
    images: [],
    imageDecisions: [],
    videos: [],
    ranges: [],
    selections: [],
    audio: [],
    timeline: null,
    videoFiles: {},
    inventory: {
      chapters: 0,
      chapterVersions: 0,
      images: 0,
      videos: 0,
      audio: 0,
      timelineItems: 0,
      bookVersions: 0,
      videoVersions: 0,
      exports: 0,
    },
    fingerprint: mailboxDigest({ markdown, version: memory.version }),
  };
}

export async function publishMailboxMemory(
  userId: number,
  authorName: string,
  input: { contactId: string; storyId: number; markdown: string } & (
    | { requestId: string; threadId?: never }
    | { threadId: string; expectedVersion: number; requestId?: never }
  )
) {
  const { peerId } = await resolveMailboxContact(userId, input.contactId);
  const story = await getStoryById(input.storyId, userId);
  if (!story) throw mailboxGone();
  const id = input.threadId ?? input.requestId;
  const markdown = input.markdown.replace(/\r\n?/g, "\n").trim();
  const requestHash = mailboxDigest({
    peerId,
    userId,
    storyId: input.storyId,
    markdown,
    kind: "memory",
  });
  return withMailboxPair(userId, peerId, async sql => {
    await requireMailboxPair(sql, userId, peerId);
    const existing = await readThread(sql, id);
    if (
      existing &&
      (existing.senderId !== userId ||
        existing.recipientId !== peerId ||
        existing.sourceStoryId !== story.id)
    )
      throw mailboxGone();
    const latest = existing && (await readLatest(sql, existing));
    const previous = latest?.snapshot.memory;
    if ("expectedVersion" in input) {
      if (!existing || !previous || !latest) throw mailboxGone();
      if (previous.markdown === markdown)
        return { threadId: id, version: previous.version };
      if (previous.version !== input.expectedVersion) throw staleVersion();
    } else if (existing) {
      if (!previous || existing.requestHash !== requestHash)
        throw staleVersion();
      return { threadId: id, version: 1 };
    } else {
      for (const owner of [userId, peerId]) {
        const belongs = (row: StoryMailboxThread) =>
          row.senderId === owner || row.recipientId === owner;
        const total = sql
          ? (
              await sql
                .select({ n: count() })
                .from(threads)
                .where(
                  or(
                    eq(threads.senderId, owner),
                    eq(threads.recipientId, owner)
                  )
                )
            )[0].n
          : memoryState.storyMailboxThreads.filter(belongs).length;
        if (total >= 200)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "故事往来已达容量。",
          });
      }
    }
    const pkg = packageMemory(story.title, markdown, previous);
    const thread = existing ?? {
      id,
      senderId: userId,
      recipientId: peerId,
      sourceStoryId: story.id,
      copyStoryId: null,
      sourceFingerprint: pkg.fingerprint,
      copyFingerprint: null,
      requestHash,
      createdAt: new Date(),
    };
    if (!existing) {
      if (sql) await sql.insert(threads).values(thread);
      else memoryState.storyMailboxThreads.push(thread);
    }
    await appendMailboxSnapshot(sql, thread, {
      senderId: userId,
      authorName,
      storyId: story.id,
      note: "",
      package: pkg,
    });
    return { threadId: id, version: pkg.memory!.version };
  });
}

export async function readMailboxMemory(userId: number, entryId: string) {
  const entry = await mailboxEntry(userId, entryId);
  const memory = entry.snapshot.memory;
  if (!memory) throw mailboxGone();
  const db = await getDb();
  const thread = await readThread(db, entry.threadId);
  if (!thread) throw mailboxGone();
  const latest = await readLatest(db, thread);
  return {
    ...memory,
    isLatest: latest?.id === entry.id,
    recipientStoryId: thread.recipientId === userId ? thread.copyStoryId : null,
  };
}

/** Receipt points to one recipient-owned story. New receipts never publish from that story. */
export async function adoptMailboxMemory(
  userId: number,
  initial: StoryMailboxEntry,
  targetStoryId?: number
) {
  if (initial.recipientId !== userId) throw mailboxGone();
  let createdLocalStoryId: number | undefined;
  try {
    return await withMailboxPair(userId, initial.senderId, async sql => {
      const thread = await readThread(sql, initial.threadId);
      if (!thread || thread.recipientId !== userId) throw mailboxGone();
      const entry = sql
        ? (
            await sql
              .select()
              .from(entries)
              .where(eq(entries.id, initial.id))
              .limit(1)
          )[0]
        : memoryState.storyMailboxEntries.find(row => row.id === initial.id);
      if (!entry?.snapshot.memory || entry.recipientId !== userId)
        throw mailboxGone();
      if (
        targetStoryId &&
        thread.copyStoryId &&
        targetStoryId !== thread.copyStoryId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "这份共享笔记已经链接到你的另一篇故事。",
        });
      if (entry.receivedStoryId)
        return { storyId: entry.receivedStoryId, repeated: true };
      await requireMailboxPair(sql, userId, initial.senderId);
      let storyId = thread.copyStoryId ?? targetStoryId;
      if (storyId && !(await getStoryById(storyId, userId)))
        throw mailboxGone();
      if (!storyId) {
        const data = {
          userId,
          title: entry.title,
          body: withStoryMemory({
            _revision: 1,
            cards: [],
            characters: [],
            shots: [],
          }),
        };
        if (sql) storyId = (await sql.insert(stories).values(data))[0].insertId;
        else {
          storyId = createdLocalStoryId = nextMemoryId("story");
          const at = new Date();
          memoryState.stories.push({
            ...data,
            id: storyId,
            projectId: null,
            logline: null,
            summary: null,
            arc: null,
            theme: null,
            updatedAt: at,
            createdAt: at,
          });
        }
      }
      if (sql) {
        await sql
          .update(threads)
          .set({ copyStoryId: storyId })
          .where(eq(threads.id, thread.id));
        await sql
          .update(entries)
          .set({ receivedStoryId: storyId, readAt: new Date() })
          .where(eq(entries.id, entry.id));
      } else {
        thread.copyStoryId = storyId;
        entry.receivedStoryId = storyId;
        entry.readAt = new Date();
      }
      return { storyId, repeated: false };
    });
  } catch (error) {
    if (createdLocalStoryId !== undefined)
      memoryState.stories = memoryState.stories.filter(
        story => story.id !== createdLocalStoryId
      );
    throw error;
  }
}

export async function adoptedMailboxMemories(storyId: number, userId: number) {
  const db = await getDb();
  const rows = db
    ? await db
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.recipientId, userId),
            eq(entries.receivedStoryId, storyId),
            sqlExpr`JSON_CONTAINS_PATH(${entries.snapshot}, 'one', '$.memory')`
          )
        )
    : memoryState.storyMailboxEntries.filter(
        row => row.recipientId === userId && row.receivedStoryId === storyId
      );
  const latest = new Map<
    string,
    { authorName: string; version: number; markdown: string }
  >();
  for (const row of rows) {
    const memory = row.snapshot.memory;
    if (memory && (latest.get(row.threadId)?.version ?? 0) < memory.version) {
      latest.set(row.threadId, {
        authorName: row.authorName,
        version: memory.version,
        markdown: memory.markdown,
      });
    }
  }
  return [...latest.values()];
}
