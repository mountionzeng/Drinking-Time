import { latestStoryImageUrls } from "./accountImages";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, asc, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  accountMemorySpaces,
  stories,
  users,
  artworkShares,
  storyContextShares,
  storyContextShareImports,
  type Story,
} from "../../drizzle/schema";
import {
  emptyMemorySpace,
  memorySpaceStateSchema,
  type MemorySpaceState,
  type MemorySpaceOperation,
  type MemorySpace,
} from "../../shared/memorySpace";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import { listUserStories, getStoryById, getStoryByIdIncludingTrash } from "./stories";
import { readTrashedStories } from "./storyTrashState";
import { projectMemoryStory } from "../services/memorySpaceProjection";

const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "回忆已在其他窗口更新，已保留你的输入，请刷新后再试。",
  });
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

type Link = {
  accountId: number;
  storyId: number;
  role: "accepted" | "invitedMe" | "contributed";
  name?: string;
};
async function sourceData(owner: number) {
  const db = await getDb();
  const trashed = await readTrashedStories(owner);
  const rows: Story[] = [];
  const links: Link[] = [];
  if (!db) {
    rows.push(...memoryState.stories.filter(row => row.userId === owner && !Object.hasOwn(trashed, String(row.id))));
    for (const share of [
      ...memoryState.storyContextShares,
      ...memoryState.artworkShares,
    ]) {
      if (
        !memoryState.stories.some(
          s => s.id === share.storyId && s.userId === share.userId
        )
      )
        continue;
      for (const receipt of memoryState.storyContextShareImports.filter(
        r => r.tokenHash === share.tokenHash
      )) {
        if (share.userId === owner && receipt.userId !== owner)
          links.push({
            accountId: receipt.userId,
            storyId: share.storyId,
            role: "accepted",
          });
        if (
          receipt.userId === owner &&
          share.userId !== owner &&
          rows.some(r => r.id === receipt.storyId)
        )
          links.push({
            accountId: share.userId,
            storyId: receipt.storyId,
            role: "invitedMe",
          });
      }
    }
  } else {
    let after = 0;
    while (true) {
      const page = await db
        .select()
        .from(stories)
        .where(and(eq(stories.userId, owner), gt(stories.id, after)))
        .orderBy(asc(stories.id))
        .limit(100);
      rows.push(...page.filter(row => !Object.hasOwn(trashed, String(row.id))));
      if (page.length < 100) break;
      after = page[page.length - 1].id;
    }
    for (const table of [storyContextShares, artworkShares]) {
      const receipts = await db
        .select({
          author: table.userId,
          sourceId: table.storyId,
          recipient: storyContextShareImports.userId,
          copyId: storyContextShareImports.storyId,
        })
        .from(table)
        .innerJoin(
          storyContextShareImports,
          eq(table.tokenHash, storyContextShareImports.tokenHash)
        )
        .innerJoin(
          stories,
          and(eq(stories.id, table.storyId), eq(stories.userId, table.userId))
        )
        .where(
          or(
            eq(table.userId, owner),
            eq(storyContextShareImports.userId, owner)
          )
        );
      for (const row of receipts) {
        if (row.author === owner && row.recipient !== owner)
          links.push({
            accountId: row.recipient,
            storyId: row.sourceId,
            role: "accepted",
          });
        if (
          row.recipient === owner &&
          row.author !== owner &&
          rows.some(s => s.id === row.copyId)
        )
          links.push({
            accountId: row.author,
            storyId: row.copyId,
            role: "invitedMe",
          });
      }
    }
  }
  rows.sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id
  );
  const visibleStoryIds = new Set(rows.map(row => row.id));
  for (let index = links.length - 1; index >= 0; index--) {
    if (!visibleStoryIds.has(links[index].storyId)) links.splice(index, 1);
  }
  const projected = rows.map(row => ({ row, ...projectMemoryStory(row) }));
  for (const book of projected)
    for (const person of book.accounts)
      if (person.accountId !== owner)
        links.push({ ...person, storyId: book.row.id, role: "contributed" });
  const accountIds = [...new Set(links.map(link => link.accountId))];
  const names = new Map<number, string>();
  if (accountIds.length) {
    const people = db
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, accountIds))
      : memoryState.users.filter(u => accountIds.includes(u.id));
    people.forEach(p => names.set(p.id, p.name?.trim() || "朋友"));
  }
  const [storyList, latestImages] = await Promise.all([
    listUserStories(owner),
    latestStoryImageUrls(owner),
  ]);
  const covers = new Map(
    storyList.map(s => [
      s.id,
      s.coverImageUrl ?? latestImages.get(s.id) ?? null,
    ])
  );
  return { projected, links, names, covers };
}

/** All writers, including first-open initialization, serialize on one account row. */
async function editSpace<T>(
  owner: number,
  action: (state: MemorySpaceState, revision: number) => T | Promise<T>,
  bumpRevision = true
) {
  const db = await getDb();
  const apply = async (raw: MemorySpaceState, revision: number) => {
    // MySQL normalizes JSON object key order. Compare canonical parsed shapes,
    // otherwise every read would incorrectly advance the revision.
    const original = memorySpaceStateSchema.parse(raw);
    const state = structuredClone(original);
    const result = await action(state, revision);
    memorySpaceStateSchema.parse(state);
    if (Buffer.byteLength(JSON.stringify(state)) > 2_000_000)
      bad("回忆整理空间已满，请减少人物备注或书架层。");
    return {
      state,
      result,
      changed: JSON.stringify(state) !== JSON.stringify(original),
    };
  };
  if (db)
    return db.transaction(async tx => {
      await tx
        .insert(accountMemorySpaces)
        .values({ userId: owner, state: emptyMemorySpace() })
        .onDuplicateKeyUpdate({ set: { userId: owner } });
      const [row] = await tx
        .select()
        .from(accountMemorySpaces)
        .where(eq(accountMemorySpaces.userId, owner))
        .for("update");
      const next = await apply(row.state, row.revision);
      if (next.changed)
        await tx
          .update(accountMemorySpaces)
          .set({
            state: next.state,
            revision: row.revision + Number(bumpRevision),
          })
          .where(
            and(
              eq(accountMemorySpaces.userId, owner),
              eq(accountMemorySpaces.revision, row.revision)
            )
          );
      return {
        result: next.result,
        revision: row.revision + Number(next.changed && bumpRevision),
      };
    });
  return withLocalAggregateMutationLock(async () => {
    const prior = memoryState.accountMemorySpaces.find(s => s.userId === owner);
    const next = await apply(
      prior?.state ?? emptyMemorySpace(),
      prior?.revision ?? 0
    );
    const revision =
      (prior?.revision ?? 0) + Number(next.changed && bumpRevision);
    if (!prior || next.changed) {
      const row = {
        userId: owner,
        state: next.state,
        revision,
        createdAt: prior?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      memoryState.accountMemorySpaces = [
        ...memoryState.accountMemorySpaces.filter(s => s.userId !== owner),
        row,
      ];
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.accountMemorySpaces =
          memoryState.accountMemorySpaces.filter(s => s.userId !== owner);
        if (prior) memoryState.accountMemorySpaces.push(prior);
        throw error;
      }
    }
    return { result: next.result, revision };
  });
}

export function applyMemoryOperation(
  state: MemorySpaceState,
  op: MemorySpaceOperation,
  ownedStories: Set<number>
) {
  const shelf =
    "id" in op ? state.shelves.find(s => s.id === op.id) : undefined;
  switch (op.kind) {
    case "setBookView":
      if (!ownedStories.has(op.storyId)) bad("故事不存在或不可访问");
      if (op.view === null) delete state.bookViews[op.storyId];
      else state.bookViews[op.storyId] = op.view;
      break;
    case "setShelfView":
      state.shelfView = op.view;
      break;
    case "removePerson": {
      const person = state.people.find(p => p.id === op.id);
      if (person?.accountId)
        bad("有协作记录的人物不能移除，可以编辑称呼与备注。");
      state.people = state.people.filter(p => p.id !== op.id);
      state.relationships = state.relationships.filter(
        r => r.from !== op.id && r.to !== op.id
      );
      break;
    }
    case "addShelf":
      if (state.shelves.some(s => s.id === op.id && s.name === op.name)) return;
      if (state.shelves.some(s => s.id === op.id))
        bad("书架层已存在，请刷新。");
      state.shelves.push({ id: op.id, name: op.name, storyIds: [] });
      break;
    case "renameShelf":
      if (!shelf) bad("书架层不存在");
      shelf!.name = op.name;
      break;
    case "removeShelf":
      for (const storyId of shelf?.storyIds ?? []) {
        const view = op.views?.[String(storyId)];
        if (view) state.bookViews[storyId] = view;
      }
      state.shelves = state.shelves.filter(s => s.id !== op.id);
      break;
    case "moveShelf": {
      const from = state.shelves.findIndex(s => s.id === op.id),
        to = from + (op.direction === "up" ? -1 : 1);
      if (from < 0) bad("书架层不存在");
      if (to >= 0 && to < state.shelves.length)
        [state.shelves[from], state.shelves[to]] = [
          state.shelves[to],
          state.shelves[from],
        ];
      break;
    }
    case "dragBook": {
      if (!ownedStories.has(op.storyId)) bad("故事不存在或不可访问");
      if (op.beforeStoryId === op.storyId) return;
      let targetId = op.target;
      if (op.target === "new" || op.target === "default") {
        if (state.shelves.some(s => s.id === op.newShelfId))
          bad("书架层已存在，请刷新。");
        const assigned = new Set(state.shelves.flatMap(s => s.storyIds));
        const storyIds =
          op.target === "default"
            ? [...ownedStories].filter(id => !assigned.has(id))
            : [];
        if (op.beforeStoryId !== null && !storyIds.includes(op.beforeStoryId))
          bad("目标位置已改变，请刷新。");
        state.shelves.push({
          id: op.newShelfId,
          name:
            op.target === "default"
              ? "我的故事"
              : `书架 ${state.shelves.length + 1}`,
          storyIds,
        });
        targetId = op.newShelfId;
      }
      applyMemoryOperation(
        state,
        {
          kind: "moveBook",
          storyId: op.storyId,
          shelfId: targetId,
          beforeStoryId: op.beforeStoryId,
        },
        ownedStories
      );
      if (op.view) state.bookViews[op.storyId] = op.view;
      break;
    }
    case "moveBook": {
      if (!ownedStories.has(op.storyId)) bad("故事不存在或不可访问");
      const target = state.shelves.find(s => s.id === op.shelfId);
      if (op.shelfId && !target) bad("书架层不存在");
      if (op.beforeStoryId === op.storyId) return;
      if (
        op.beforeStoryId !== null &&
        !target?.storyIds.includes(op.beforeStoryId)
      )
        bad("目标位置已改变，请刷新。");
      for (const s of state.shelves)
        s.storyIds = s.storyIds.filter(id => id !== op.storyId);
      if (target)
        target.storyIds.splice(
          op.beforeStoryId === null
            ? target.storyIds.length
            : target.storyIds.indexOf(op.beforeStoryId),
          0,
          op.storyId
        );
      if (op.view) state.bookViews[op.storyId] = op.view;
      break;
    }
    case "savePerson": {
      const person = state.people.find(p => p.id === op.id);
      if (person) {
        person.name = op.name;
        person.note = op.note;
      } else state.people.push({ id: op.id, name: op.name, note: op.note });
      break;
    }
    case "saveRelation": {
      const endpoints = new Set(["self", ...state.people.map(p => p.id)]);
      if (!endpoints.has(op.from) || !endpoints.has(op.to) || op.from === op.to)
        bad("请选择两个不同的人物");
      state.relationships = state.relationships.filter(r => r.id !== op.id);
      state.relationships.push({
        id: op.id,
        from: op.from,
        to: op.to,
        label: op.label,
      });
      break;
    }
    case "removeRelation":
      state.relationships = state.relationships.filter(r => r.id !== op.id);
      break;
  }
}

export async function listMemorySpace(owner: number): Promise<MemorySpace> {
  const data = await sourceData(owner);
  const { result, revision } = await editSpace(owner, state => {
    if (!state.initialized) {
      state.initialized = true;
      for (const book of data.projected)
        state.seenStories[book.row.id] = book.reading.fingerprint;
    }
    for (const link of data.links)
      if (!state.people.some(p => p.accountId === link.accountId))
        state.people.push({
          id: randomUUID(),
          accountId: link.accountId,
          name: data.names.get(link.accountId) ?? link.name ?? "朋友",
          note: "",
        });
    const ids = new Set(data.projected.map(b => b.row.id));
    return {
      shelfView: state.shelfView,
      // Filter the response, not persistent ordering, against this query's snapshot.
      // A delayed list must not erase a book moved by a newer concurrent request.
      shelves: state.shelves.map(shelf => ({
        ...shelf,
        storyIds: shelf.storyIds.filter(id => ids.has(id)),
      })),
      books: data.projected.map(book => ({
        id: book.row.id,
        view: state.bookViews[book.row.id],
        title: book.reading.title,
        coverUrl: data.covers.get(book.row.id) ?? null,
        hasText: book.reading.versions.length > 0,
        updatedAt: book.updatedAt,
        fingerprint: book.reading.fingerprint,
        unread: state.seenStories[book.row.id] !== book.reading.fingerprint,
        isNew: !state.seenStories[book.row.id],
        pending: book.pending,
        wordCount: book.wordCount,
        wordCountLabel: book.wordCountLabel,
        activeEditingMs: state.activity[book.row.id]?.totalMs ?? null,
        editors: book.editors,
      })),
      people: state.people.map(p => ({
        id: p.id,
        name: p.name,
        note: p.note,
        connected: p.accountId !== undefined,
        stories: data.links
          .filter(l => l.accountId === p.accountId)
          .filter(
            (l, i, all) =>
              all.findIndex(
                x => x.storyId === l.storyId && x.role === l.role
              ) === i
          )
          .map(l => ({
            id: l.storyId,
            title:
              data.projected.find(b => b.row.id === l.storyId)?.reading.title ??
              "故事",
            role: l.role,
          })),
      })),
      relationships: state.relationships,
    };
  });
  return { ...result, revision };
}

export async function changeMemorySpace(
  owner: number,
  revision: number,
  op: MemorySpaceOperation
) {
  const ids = new Set(
    (await listUserStories(owner))
      .sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id
      )
      .map(s => s.id)
  );
  await editSpace(owner, (state, current) => {
    if (revision !== current) throw conflict();
    applyMemoryOperation(state, op, ids);
  });
  return { saved: true as const };
}

/** Trash only changes the account's visibility state; story contents and shelf positions stay intact. */
export async function trashMemoryStory(owner: number, storyId: number) {
  if (!(await getStoryByIdIncludingTrash(storyId, owner)))
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  await editSpace(owner, state => {
    state.trashedStories[String(storyId)] ??= Date.now();
  });
  return { saved: true as const };
}

export async function restoreMemoryStory(owner: number, storyId: number) {
  if (!(await getStoryByIdIncludingTrash(storyId, owner)))
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  await editSpace(owner, state => {
    if (!Object.hasOwn(state.trashedStories, String(storyId)))
      throw new TRPCError({ code: "NOT_FOUND", message: "回收站中没有这本故事" });
    delete state.trashedStories[String(storyId)];
  });
  return { saved: true as const };
}

export async function listTrashedMemoryStories(owner: number) {
  const trash = await readTrashedStories(owner);
  const items = await Promise.all(Object.entries(trash).map(async ([id, trashedAt]) => {
    const story = await getStoryByIdIncludingTrash(Number(id), owner);
    return story ? { id: story.id, title: story.title, trashedAt } : null;
  }));
  return items.filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.trashedAt - a.trashedAt);
}
export async function readMemoryBook(owner: number, storyId: number) {
  const story = await getStoryById(storyId, owner);
  if (!story)
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  return projectMemoryStory(story).reading;
}
export async function markMemoryBookSeen(
  owner: number,
  storyId: number,
  fingerprint: string
) {
  const { result } = await editSpace(owner, async state => {
    // Re-read after acquiring the account lock so a delayed acknowledgement
    // cannot overwrite another device's acknowledgement of a newer version.
    if (Object.hasOwn(state.trashedStories, String(storyId)))
      throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
    const story = await getStoryByIdIncludingTrash(storyId, owner);
    if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
    const current = projectMemoryStory(story).reading;
    if (current.fingerprint !== fingerprint) return { saved: false };
    state.seenStories[storyId] = fingerprint;
    return { saved: true };
  });
  return result;
}

/** Read only the current user's own recorded activity; never project session identifiers. */
export async function readMemoryActivity(owner: number, storyId: number) {
  const db = await getDb();
  const row = db
    ? (
        await db
          .select()
          .from(accountMemorySpaces)
          .where(eq(accountMemorySpaces.userId, owner))
      )[0]
    : memoryState.accountMemorySpaces.find(s => s.userId === owner);
  return row
    ? (memorySpaceStateSchema.parse(row.state).activity[storyId]?.totalMs ??
        null)
    : null;
}

/** Cumulative heartbeats are replay safe, wall-clock capped, and cannot double-count tabs. */
export async function recordMemoryActivity(
  owner: number,
  input: { storyId: number; sessionId: string; elapsedMs: number }
) {
  if (!(await getStoryById(input.storyId, owner)))
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  const { result } = await editSpace(
    owner,
    state => {
      const now = Date.now();
      const record = state.activity[input.storyId] ?? {
        totalMs: 0,
        lastCreditedAt: now,
        sessions: [],
      };
      record.sessions = record.sessions.filter(s => now - s.at <= 90_000);
      const session = record.sessions.find(s => s.id === input.sessionId);
      if (session && input.elapsedMs > session.elapsedMs) {
        const delta = Math.max(
          0,
          Math.min(
            input.elapsedMs - session.elapsedMs,
            now - session.at,
            now - record.lastCreditedAt,
            30_000
          )
        );
        record.totalMs += delta;
        record.lastCreditedAt = now;
        session.elapsedMs = input.elapsedMs;
        session.at = now;
      } else if (!session) {
        record.sessions = record.sessions.slice(-7);
        record.sessions.push({
          id: input.sessionId,
          elapsedMs: input.elapsedMs,
          at: now,
        });
      }
      state.activity[input.storyId] = record;
      return { recordedMs: record.totalMs };
    },
    false
  );
  return result;
}
