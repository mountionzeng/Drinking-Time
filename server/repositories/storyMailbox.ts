import { randomUUID, createHmac } from "node:crypto";
import {
  and,
  eq,
  or,
  inArray,
  asc,
  desc,
  lt,
  isNull,
  count,
  sql as sqlExpr,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  storyMailboxContacts as contacts,
  storyMailboxThreads as threads,
  storyMailboxEntries as entries,
  users,
  type StoryMailboxEntry,
  type StoryMailboxThread,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import { listMemorySpaceContacts } from "./memorySpace";
import { ENV } from "../_core/env";
import {
  type MailboxContact,
  type MailboxEntry,
} from "../../shared/storyMailbox";
import {
  describeMailboxChanges,
  type MailboxPackage,
} from "./storyMailboxPackage";

export type { MailboxSql } from "./storyMailboxPackage";
import type { MailboxSql } from "./storyMailboxPackage";
export const mailboxGone = () =>
  new TRPCError({ code: "NOT_FOUND", message: "这份来稿不存在或不可访问" });
export function mailboxContactId(owner: number, peer: number) {
  if (ENV.cookieSecret.length < 32)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "邮箱身份映射未配置",
    });
  return createHmac("sha256", ENV.cookieSecret)
    .update(`story-mailbox:v1:${owner}:${peer}`)
    .digest("base64url");
}
export async function mailboxThreads(
  owner: number
): Promise<StoryMailboxThread[]> {
  const db = await getDb();
  return db
    ? db
        .select()
        .from(threads)
        .where(or(eq(threads.senderId, owner), eq(threads.recipientId, owner)))
        .orderBy(desc(threads.createdAt))
        .limit(200)
    : structuredClone(
        memoryState.storyMailboxThreads
          .filter(t => t.senderId === owner || t.recipientId === owner)
          .slice(-200)
          .reverse()
      );
}
const entryColumns = {
  id: entries.id,
  threadId: entries.threadId,
  senderId: entries.senderId,
  recipientId: entries.recipientId,
  kind: entries.kind,
  authorName: entries.authorName,
  note: entries.note,
  sourceStoryId: entries.sourceStoryId,
  receivedStoryId: entries.receivedStoryId,
  fingerprint: entries.fingerprint,
  title: entries.title,
  inventory: entries.inventory,
  changes: entries.changes,
  createdAt: entries.createdAt,
  readAt: entries.readAt,
};
export async function mailboxEntries(
  owner: number,
  peer: number,
  cursor?: { at: string; id: string }
) {
  const db = await getDb();
  const order = (
    a: { createdAt: Date; id: string },
    b: { createdAt: Date; id: string }
  ) =>
    b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
  const rows = db
    ? await db
        .select(entryColumns)
        .from(entries)
        .where(
          and(
            or(
              and(eq(entries.senderId, owner), eq(entries.recipientId, peer)),
              and(eq(entries.senderId, peer), eq(entries.recipientId, owner))
            ),
            cursor
              ? or(
                  lt(entries.createdAt, new Date(cursor.at)),
                  and(
                    eq(entries.createdAt, new Date(cursor.at)),
                    lt(entries.id, cursor.id)
                  )
                )
              : undefined
          )
        )
        .orderBy(desc(entries.createdAt), desc(entries.id))
        .limit(31)
    : structuredClone(
        memoryState.storyMailboxEntries
          .filter(
            e =>
              (e.senderId === owner && e.recipientId === peer) ||
              (e.senderId === peer && e.recipientId === owner)
          )
          .sort(order)
          .filter(
            e =>
              !cursor ||
              order(e, { createdAt: new Date(cursor.at), id: cursor.id }) > 0
          )
          .slice(0, 31)
          .map(({ snapshot: _, ...rest }) => rest)
      );
  const visible = rows.slice(0, 30),
    last = visible.at(-1);
  return {
    entries: visible.map(e => mailboxEntryView(e, owner)),
    nextCursor:
      rows.length > 30 && last
        ? { at: last.createdAt.toISOString(), id: last.id }
        : null,
  };
}
export async function mailboxEntry(
  owner: number,
  id: string
): Promise<StoryMailboxEntry> {
  const db = await getDb();
  const [row] = db
    ? await db
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.id, id),
            or(eq(entries.senderId, owner), eq(entries.recipientId, owner))
          )
        )
    : memoryState.storyMailboxEntries.filter(
        e => e.id === id && (e.senderId === owner || e.recipientId === owner)
      );
  if (!row) throw mailboxGone();
  return structuredClone(row);
}
export async function mailboxContacts(owner: number) {
  const db = await getDb();
  const [known, linked, settings, mail] = await Promise.all([
    listMemorySpaceContacts(owner),
    mailboxThreads(owner),
    db
      ? db
          .select()
          .from(contacts)
          .where(or(eq(contacts.ownerId, owner), eq(contacts.peerId, owner)))
      : Promise.resolve(
          memoryState.storyMailboxContacts.filter(
            c => c.ownerId === owner || c.peerId === owner
          )
        ),
    db
      ? db
          .select({ senderId: entries.senderId })
          .from(entries)
          .where(and(eq(entries.recipientId, owner), isNull(entries.readAt)))
      : Promise.resolve(
          memoryState.storyMailboxEntries
            .filter(e => e.recipientId === owner && !e.readAt)
            .map(e => ({ senderId: e.senderId }))
        ),
  ]);
  const ids = [
    ...new Set([
      ...known.map(c => c.userId),
      ...linked.map(t => (t.senderId === owner ? t.recipientId : t.senderId)),
      ...settings.map(c => (c.ownerId === owner ? c.peerId : c.ownerId)),
    ]),
  ];
  const names = ids.length
    ? db
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ids))
      : memoryState.users.filter(u => ids.includes(u.id))
    : [];
  return ids.map(peerId => ({
    peerId,
    public: {
      id: mailboxContactId(owner, peerId),
      name:
        names.find(n => n.id === peerId)?.name?.trim() ||
        known.find(c => c.userId === peerId)?.displayName ||
        "朋友",
      removed: settings.some(
        c =>
          (c.peerId === peerId || c.ownerId === peerId) && Boolean(c.removedAt)
      ),
      unread: mail.filter(m => m.senderId === peerId).length,
    } satisfies MailboxContact,
  }));
}
export async function resolveMailboxContact(owner: number, id: string) {
  const person = (await mailboxContacts(owner)).find(c => c.public.id === id);
  if (!person) throw mailboxGone();
  return person;
}
/** Pair locks order every send, refresh, receive and removal against each other. */
export async function withMailboxPair<T>(
  a: number,
  b: number,
  work: (sql: MailboxSql | null) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (a === b) throw mailboxGone();
  if (db)
    return db.transaction(
      async tx => {
        const found = await tx
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, [a, b]))
          .orderBy(asc(users.id))
          .for("update");
        if (found.length !== 2) throw mailboxGone();
        return work(tx);
      },
      { isolationLevel: "repeatable read" }
    );
  return withLocalAggregateMutationLock(async () => {
    // Only mailbox collections participate in this lock. Other repositories may
    // save unrelated works while attachments are copied; never roll those back.
    const keys = [
      "storyMailboxContacts",
      "storyMailboxThreads",
      "storyMailboxEntries",
    ] as const;
    const before = Object.fromEntries(
      keys.map(key => [key, structuredClone(memoryState[key])])
    );
    try {
      const result = await work(null);
      await persistMemoryState();
      return result;
    } catch (error) {
      Object.assign(memoryState, before);
      throw error;
    }
  });
}
export async function requireMailboxPair(
  sql: MailboxSql | null,
  a: number,
  b: number
) {
  const pair = sql
    ? await sql
        .select()
        .from(contacts)
        .where(
          or(
            and(eq(contacts.ownerId, a), eq(contacts.peerId, b)),
            and(eq(contacts.ownerId, b), eq(contacts.peerId, a))
          )
        )
    : memoryState.storyMailboxContacts.filter(
        c =>
          (c.ownerId === a && c.peerId === b) ||
          (c.ownerId === b && c.peerId === a)
      );
  if (pair.some(c => c.removedAt))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "联系已停止，旧来稿和作品保留，不能再发送或接收更新",
    });
}
export async function removeMailboxContact(owner: number, peer: number) {
  return withMailboxPair(owner, peer, async sql => {
    const row = {
      id: randomUUID(),
      ownerId: owner,
      peerId: peer,
      removedAt: new Date(),
    };
    if (sql)
      await sql
        .insert(contacts)
        .values(row)
        .onDuplicateKeyUpdate({ set: { removedAt: row.removedAt } });
    else {
      const old = memoryState.storyMailboxContacts.find(
        c => c.ownerId === owner && c.peerId === peer
      );
      if (old) old.removedAt = row.removedAt;
      else memoryState.storyMailboxContacts.push(row);
    }
  });
}
async function assertCapacity(
  sql: MailboxSql | null,
  threadId: string,
  bytes: number
) {
  const [size] = sql
    ? await sql
        .select({
          n: count(),
          bytes: sqlExpr<number>`coalesce(sum(octet_length(${entries.snapshot})), 0)`,
        })
        .from(entries)
        .where(eq(entries.threadId, threadId))
    : [
        {
          n: memoryState.storyMailboxEntries.filter(
            e => e.threadId === threadId
          ).length,
          bytes: memoryState.storyMailboxEntries
            .filter(e => e.threadId === threadId)
            .reduce(
              (sum, e) => sum + Buffer.byteLength(JSON.stringify(e.snapshot)),
              0
            ),
        },
      ];
  if (size.n >= 500 || Number(size.bytes) + bytes > 128 * 1024 * 1024)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "这段故事往来的版本记录已达容量，旧记录全部保留",
    });
}
export async function appendMailboxSnapshot(
  sql: MailboxSql | null,
  thread: StoryMailboxThread,
  input: {
    id?: string;
    kind?: "sent" | "updated" | "received";
    senderId: number;
    authorName: string;
    storyId: number;
    note: string;
    package: MailboxPackage;
  }
) {
  const recipientId =
    thread.senderId === input.senderId ? thread.recipientId : thread.senderId;
  await requireMailboxPair(sql, input.senderId, recipientId);
  const prior = sql
    ? await sql
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.threadId, thread.id),
            eq(entries.senderId, input.senderId)
          )
        )
        .orderBy(desc(entries.createdAt), desc(entries.id))
        .limit(1)
    : memoryState.storyMailboxEntries
        .filter(e => e.threadId === thread.id && e.senderId === input.senderId)
        .slice(-1);
  if (prior[0]?.fingerprint === input.package.fingerprint && !input.note)
    return prior[0];
  await assertCapacity(
    sql,
    thread.id,
    Buffer.byteLength(JSON.stringify(input.package))
  );
  const changed =
    input.kind === "received"
      ? []
      : describeMailboxChanges(prior[0]?.snapshot, input.package);
  if (prior[0] && !changed.length && input.kind !== "received")
    changed.push({ kind: "editing" });
  const [lastEvent] = sql
    ? await sql
        .select({ createdAt: entries.createdAt })
        .from(entries)
        .where(eq(entries.threadId, thread.id))
        .orderBy(desc(entries.createdAt))
        .limit(1)
    : memoryState.storyMailboxEntries
        .filter(e => e.threadId === thread.id)
        .slice(-1);
  const createdAt = new Date(
    Math.max(Date.now(), (lastEvent?.createdAt.getTime() ?? 0) + 1)
  );
  const row: StoryMailboxEntry = {
    id: input.id ?? randomUUID(),
    threadId: thread.id,
    senderId: input.senderId,
    recipientId,
    kind: input.kind ?? (prior[0] ? "updated" : "sent"),
    authorName: input.authorName.slice(0, 100),
    note: input.note,
    sourceStoryId: input.storyId,
    receivedStoryId: null,
    fingerprint: input.package.fingerprint,
    title: input.package.title,
    inventory: input.package.inventory,
    snapshot: input.package,
    changes: changed,
    createdAt,
    readAt: null,
  };
  if (sql) await sql.insert(entries).values(row);
  else memoryState.storyMailboxEntries.push(structuredClone(row));
  return row;
}
export function mailboxEntryView(
  row: Omit<StoryMailboxEntry, "snapshot">,
  owner: number
): MailboxEntry {
  return {
    id: row.id,
    threadId: row.threadId,
    kind: row.kind,
    unread: row.recipientId === owner && !row.readAt,
    authorName: row.authorName,
    mine: row.senderId === owner,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    note: row.note,
    inventory: row.inventory,
    changes: row.changes,
    ownStoryId: row.senderId === owner ? row.sourceStoryId : null,
    receivedStoryId: row.recipientId === owner ? row.receivedStoryId : null,
  };
}
export async function markMailboxRead(
  owner: number,
  peer: number,
  seenIds: string[]
) {
  if (!seenIds.length) return;
  return withMailboxPair(owner, peer, async db => {
    const at = new Date();
    if (db)
      await db
        .update(entries)
        .set({ readAt: at })
        .where(
          and(
            eq(entries.senderId, peer),
            eq(entries.recipientId, owner),
            inArray(entries.id, seenIds)
          )
        );
    else
      memoryState.storyMailboxEntries
        .filter(
          e =>
            e.senderId === peer &&
            e.recipientId === owner &&
            seenIds.includes(e.id)
        )
        .forEach(e => {
          e.readAt = at;
        });
  });
}
