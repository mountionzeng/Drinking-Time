import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memorySpaceRouter } from "./routers/memorySpace";
import type { TrpcContext } from "./_core/context";
import * as runtime from "./repositories/runtime";
import { seedStoryForTesting } from "./repositories/testing";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../shared/publishingDraft";
import { projectMemoryStory } from "./services/memorySpaceProjection";
import { booksOnShelf } from "../shared/memorySpace";
import { readFile } from "node:fs/promises";
const caller = (id: number | null) =>
  memorySpaceRouter.createCaller({
    user: id ? { id, name: "我" } : null,
  } as TrpcContext);
const a = caller(10),
  b = caller(20);
function seed(id = 1, owner = 10) {
  seedStoryForTesting({ id, userId: owner, title: `故事${id}` });
  const story = runtime.memoryState.stories.find(s => s.id === id)!;
  story.body = {
    publishing: upsertPublishingPlatformDraft(emptyPublishingDraftState(100), {
      platform: "xiaohongshu",
      content: { title: story.title, body: "原来的正文", tags: [] },
      now: 100,
    }),
  };
  return story;
}
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
});
afterEach(() => vi.restoreAllMocks());
describe("账号回忆书架", () => {
  it("persists all three arrangements per account without marking story content unread", async () => {
    seed();
    for (const view of ["horizontal", "vertical", "album"] as const) {
      const prior = await a.list();
      await a.change({
        revision: prior.revision,
        operation: { kind: "setShelfView", view },
      });
      const next = await caller(10).list();
      expect(next.shelfView).toBe(view);
      expect(next.books[0].unread).toBe(false);
      expect((await b.list()).shelfView).toBe("vertical");
    }
  });
  it("keeps per-book bindings independent of the default and rejects someone else's book", async () => {
    seed();
    seed(2, 20);
    let space = await a.list();
    await a.change({
      revision: space.revision,
      operation: { kind: "setBookView", storyId: 1, view: "album" },
    });
    space = await a.list();
    expect(space.books[0].view).toBe("album");
    await a.change({
      revision: space.revision,
      operation: { kind: "setShelfView", view: "horizontal" },
    });
    space = await a.list();
    expect(space.books[0]).toMatchObject({ view: "album", unread: false });
    await expect(
      a.change({
        revision: space.revision,
        operation: { kind: "setBookView", storyId: 2, view: "album" },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await a.change({
      revision: space.revision,
      operation: { kind: "setBookView", storyId: 1, view: null },
    });
    expect((await a.list()).books[0].view).toBeUndefined();
  });
  it("caps activity, deduplicates retries and tabs, isolates ownership, and keeps shelf revision stable", async () => {
    seed();
    const baseline = await a.list();
    expect(baseline.books[0].activeEditingMs).toBeNull();
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const sessionId = randomUUID(),
      secondId = randomUUID();
    const tick = (elapsedMs: number, id = sessionId) =>
      a.activity({ storyId: 1, sessionId: id, elapsedMs });
    await expect(
      b.activity({ storyId: 1, sessionId, elapsedMs: 0 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await tick(0)).toEqual({ recordedMs: 0 });
    await tick(0, secondId);
    now += 15_000;
    expect(await tick(15_000)).toEqual({ recordedMs: 15_000 });
    expect(await tick(15_000)).toEqual({ recordedMs: 15_000 });
    expect(await tick(15_000, secondId)).toEqual({ recordedMs: 15_000 });
    now += 10_000;
    expect(await tick(500_000)).toEqual({ recordedMs: 25_000 });
    const result = await a.list();
    expect(result.revision).toBe(baseline.revision);
    expect(result.books[0]).toMatchObject({
      activeEditingMs: 25_000,
      unread: false,
      wordCount: 5,
    });
    expect(JSON.stringify(result)).not.toContain(sessionId);
    now += 100_000;
    expect(await tick(600_000)).toEqual({ recordedMs: 25_000 });
  });

  it("requires login and refuses other owners' stories", async () => {
    seed();
    seed(2, 20);
    await expect(caller(null).list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect((await a.list()).books.map(x => x.id)).toEqual([1]);
    await expect(b.book({ storyId: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      b.seen({ storyId: 1, fingerprint: "a".repeat(64) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("includes more than 40 stories, initializes reading baseline, and discovers new stories", async () => {
    for (let i = 1; i <= 45; i++) seed(i);
    const space = await a.list();
    expect(space.books).toHaveLength(45);
    expect(space.books.every(b => !b.unread)).toBe(true);
    seed(46);
    expect((await a.list()).books.find(b => b.id === 46)).toMatchObject({
      unread: true,
      isNew: true,
    });
  });
  it("orders books across shelves and removing a shelf preserves all stories", async () => {
    seed();
    seed(2);
    const id = randomUUID(),
      second = randomUUID();
    let s = await a.list();
    const change = async (
      operation: Parameters<typeof a.change>[0]["operation"]
    ) => {
      await a.change({ revision: s.revision, operation });
      s = await a.list();
    };
    await change({ kind: "addShelf", id, name: "家人" });
    await change({ kind: "addShelf", id: second, name: "朋友" });
    await change({ kind: "moveShelf", id: second, direction: "up" });
    expect(s.shelves.map(s => s.id)).toEqual([second, id]);
    await change({
      kind: "moveBook",
      storyId: 1,
      shelfId: id,
      beforeStoryId: null,
    });
    await change({
      kind: "moveBook",
      storyId: 2,
      shelfId: id,
      beforeStoryId: 1,
    });
    expect(booksOnShelf(s, id).map(b => b.id)).toEqual([2, 1]);
    await change({
      kind: "moveBook",
      storyId: 2,
      shelfId: second,
      beforeStoryId: null,
    });
    expect(s.shelves.flatMap(s => s.storyIds).sort()).toEqual([1, 2]);
    await change({ kind: "removeShelf", id });
    expect(booksOnShelf(s, null).map(b => b.id)).toEqual([1]);
    expect(s.books).toHaveLength(2);
    expect(runtime.memoryState.stories).toHaveLength(2);
  });
  it("rejects stale concurrent edits instead of overwriting and rejects forged ownership", async () => {
    seed();
    seed(2, 20);
    const s = await a.list();
    const results = await Promise.allSettled(
      ["甲", "乙"].map(name =>
        a.change({
          revision: s.revision,
          operation: { kind: "addShelf", id: randomUUID(), name },
        })
      )
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await a.list()).shelves).toHaveLength(1);
    await expect(
      a.change({
        revision: (await a.list()).revision,
        operation: {
          kind: "moveBook",
          storyId: 2,
          shelfId: null,
          beforeStoryId: null,
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("does not mark conversation or shelf changes as content updates, and stale seen cannot clear new text", async () => {
    const story = seed();
    await a.list();
    const first = await a.book({ storyId: 1 });
    (story.body as any).messages = [{ role: "user", content: "又聊了一句" }];
    story.updatedAt = new Date();
    expect((await a.list()).books[0].unread).toBe(false);
    (story.body as any).publishing.drafts.xiaohongshu.content.body = "新的正文";
    // The canonical published versions may be present; this seed uses the legacy surface.
    const next = await a.book({ storyId: 1 });
    expect(next.fingerprint).not.toBe(first.fingerprint);
    expect(
      await a.seen({ storyId: 1, fingerprint: first.fingerprint })
    ).toEqual({ saved: false });
    expect((await a.list()).books[0].unread).toBe(true);
    await a.seen({ storyId: 1, fingerprint: next.fingerprint });
    expect((await caller(10).list()).books[0].unread).toBe(false);
  });
  it.each(["story", "artwork"])(
    "projects %s acceptance without leaking identities or private stories",
    async kind => {
      seed();
      seed(2, 20);
      seed(3, 20);
      const share = {
        tokenHash: "secret-token",
        userId: 10,
        storyId: 1,
        createdAt: new Date(),
        revokedAt: null,
        snapshot: {},
      };
      if (kind === "story")
        runtime.memoryState.storyContextShares.push(share as any);
      else
        runtime.memoryState.artworkShares.push({
          ...share,
          fingerprint: "secret-fingerprint",
        } as any);
      runtime.memoryState.storyContextShareImports.push({
        tokenHash: "secret-token",
        userId: 20,
        storyId: 2,
      });
      const s = await a.list(),
        recipient = await b.list();
      expect(s.people[0].stories).toEqual([
        { id: 1, title: "故事1", role: "accepted" },
      ]);
      expect(recipient.people[0].stories).toEqual([
        { id: 2, title: "故事2", role: "invitedMe" },
      ]);
      expect(JSON.stringify(s)).not.toMatch(
        /accountId|userId|token|requestHash|secret/
      );
      expect(s.books.map(b => b.id)).not.toContain(3);
    }
  );
  it("keeps same-name people separate, edits private relationships and rejects unknown endpoints", async () => {
    let s = await a.list();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await a.change({
        revision: s.revision,
        operation: { kind: "savePerson", id, name: "小林", note: "已邀请" },
      });
      s = await a.list();
    }
    expect(s.people).toHaveLength(2);
    const id = randomUUID();
    await a.change({
      revision: s.revision,
      operation: {
        kind: "saveRelation",
        id,
        from: ids[0],
        to: ids[1],
        label: "姐妹",
      },
    });
    s = await a.list();
    expect(s.relationships[0].label).toBe("姐妹");
    expect((await b.list()).people).toEqual([]);
    await expect(
      a.change({
        revision: s.revision,
        operation: {
          kind: "saveRelation",
          id: randomUUID(),
          from: ids[0],
          to: randomUUID(),
          label: "朋友",
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await a.change({
      revision: s.revision,
      operation: { kind: "removeRelation", id },
    });
    expect((await a.list()).relationships).toEqual([]);
  });
  it("persists the namespace using the existing local snapshot", async () => {
    const s = await a.list();
    const id = randomUUID();
    await a.change({
      revision: s.revision,
      operation: { kind: "addShelf", id, name: "持久保存" },
    });
    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
    );
    expect(
      disk.accountMemorySpaces.find((r: any) => r.userId === 10).state
        .shelves[0]
    ).toMatchObject({ id, name: "持久保存" });
  });
  it("projects contributions as candidates and never adopts on read", async () => {
    const story = seed();
    const { textDraftVersionSchema } = await import(
      "../shared/textDraftHistory"
    );
    const version = textDraftVersionSchema.parse({
      id: "shared-version",
      sequence: 1,
      requestHash: "secret",
      status: "ready",
      createdAt: 200,
      request: {
        storyId: 1,
        operationToken: "operation",
        expectedRevision: 0,
        platform: "xiaohongshu",
        parentId: null,
        basis: null,
        messages: [],
        instruction: "",
        source: "reference",
      },
      conversationSnapshot: [],
      conversationDelta: [],
      promptVersion: "1",
      libraryVersion: "1",
      systemPrompt: "secret",
      modelMessage: "",
      contribution: { userId: 20, authorName: "小林", activeEditingMs: 90_000 },
      generated: { title: "朋友稿", body: "朋友的正文", tags: [] },
    });
    (story.body as any).textDraftHistory = {
      schemaVersion: 1,
      revision: 1,
      versions: [version],
    };
    const s = await a.list();
    const reading = await a.book({ storyId: 1 });
    expect(s.books[0].pending).toBe(1);
    expect(s.books[0].editors).toEqual([
      { name: "小林", wordCount: 5, activeEditingMs: 90_000 },
    ]);
    expect(JSON.stringify(s.books)).not.toMatch(/userId|requestHash|sessionId/);
    expect(s.people[0].name).toBe("小林");
    expect(reading.participants[0]).toMatchObject({
      name: "小林",
      at: 200,
      status: "待作者确认",
    });
    expect(reading.versions[0].body).toBe("原来的正文");
    expect(JSON.stringify(reading)).not.toMatch(
      /userId|requestHash|systemPrompt|secret/
    );
    expect(
      (story.body as any).textDraftHistory.versions[0].adoption
    ).toBeUndefined();
  });
  it("removes only manually recorded people and their relationships", async () => {
    const id = randomUUID();
    let s = await a.list();
    await a.change({
      revision: s.revision,
      operation: { kind: "savePerson", id, name: "临时人物", note: "" },
    });
    s = await a.list();
    await a.change({
      revision: s.revision,
      operation: {
        kind: "saveRelation",
        id: randomUUID(),
        from: "self",
        to: id,
        label: "朋友",
      },
    });
    s = await a.list();
    await a.change({
      revision: s.revision,
      operation: { kind: "removePerson", id },
    });
    s = await a.list();
    expect(s.people).toEqual([]);
    expect(s.relationships).toEqual([]);
  });
  it("rolls back failed local writes instead of reporting an unsaved layer as saved", async () => {
    const s = await a.list();
    const persist = vi
      .spyOn(runtime, "persistMemoryState")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(
        a.change({
          revision: s.revision,
          operation: { kind: "addShelf", id: randomUUID(), name: "不应保存" },
        })
      ).rejects.toThrow();
      expect((await a.list()).shelves).toEqual([]);
    } finally {
      persist.mockRestore();
    }
  });
  it("uses stable legacy timestamps and removes deleted books from shelf references", async () => {
    const story = seed();
    expect(projectMemoryStory(story).reading.fingerprint).toBe(
      projectMemoryStory(story).reading.fingerprint
    );
    let s = await a.list();
    const id = randomUUID();
    await a.change({
      revision: s.revision,
      operation: { kind: "addShelf", id, name: "收藏" },
    });
    s = await a.list();
    await a.change({
      revision: s.revision,
      operation: {
        kind: "moveBook",
        storyId: 1,
        shelfId: id,
        beforeStoryId: null,
      },
    });
    runtime.memoryState.stories = [];
    s = await a.list();
    expect(s.shelves[0].storyIds).toEqual([]);
    expect(s.books).toEqual([]);
  });
});
