import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-story-cas-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const fs = await import("node:fs/promises");
let db = await import("./db");

describe("Story body revision compare-and-swap", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows exactly one independent writer to win the same expected revision", async () => {
    const { id } = await db.createStory({
      userId: 9,
      title: "CAS",
      body: { _revision: 1, shots: [], marker: "base" },
    });

    const [left, right] = await Promise.all([
      db.updateStoryBodyIfRevision({
        id,
        userId: 9,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "left" },
      }),
      db.updateStoryBodyIfRevision({
        id,
        userId: 9,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "right" },
      }),
    ]);

    expect([left, right].filter(Boolean)).toHaveLength(1);
    const story = await db.getStoryById(id, 9);
    expect((story?.body as Record<string, unknown>)._revision).toBe(2);
    expect((story?.body as Record<string, unknown>).marker).toBe(
      left ? "left" : "right"
    );
  });

  it("is owner-scoped and persists the winning body across module restart", async () => {
    const { id } = await db.createStory({
      userId: 11,
      title: "Persisted CAS",
      body: { _revision: 0, shots: [] },
    });
    expect(
      await db.updateStoryBodyIfRevision({
        id,
        userId: 12,
        expectedRevision: 0,
        body: { _revision: 1, shots: [], forbidden: true },
      })
    ).toBe(false);
    expect(
      await db.updateStoryBodyIfRevision({
        id,
        userId: 11,
        expectedRevision: 0,
        body: { _revision: 1, shots: [], receipt: "committed" },
      })
    ).toBe(true);

    vi.resetModules();
    db = await import("./db");
    const reloaded = await db.getStoryById(id, 11);
    expect(reloaded?.body).toMatchObject({
      _revision: 1,
      receipt: "committed",
    });
  });

  it("restores body and companion data fields to their pre-write snapshot when the disk flush fails", async () => {
    const { id } = await db.createStory({
      userId: 9,
      title: "Original Title",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));

    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 9,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "should-not-land" },
        data: { title: "Renamed During Failed Write" },
      })
    ).rejects.toThrow();

    const story = await db.getStoryById(id, 9);
    // Both the body (CAS target) and the companion `data` columns passed in
    // the same call (e.g. title) must roll back together — a failed write
    // must look like it never happened, not like it half-landed.
    expect(story?.title).toBe("Original Title");
    expect((story?.body as Record<string, unknown>).marker).toBe("base");
    expect((story?.body as Record<string, unknown>)._revision).toBe(1);

    // And the CAS is genuinely still at revision 1 — a subsequent write using
    // the original expectedRevision must succeed, proving nothing was
    // consumed by the failed attempt.
    vi.mocked(fs.writeFile).mockClear();
    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 9,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "retry-succeeds" },
      })
    ).resolves.toBe(true);
  });

  it("does not let a failed writer's rollback erase a second writer's already-committed change to the same row", async () => {
    // Writer A (rev 1 -> 2) fails on disk. Writer B legitimately builds on
    // A's optimistic in-memory revision (rev 2 -> 3) and its own disk write
    // succeeds. A's failure-path rollback must not use a blanket
    // Object.assign that wipes out B's field just because it shares the row
    // object — only fields still holding exactly what A wrote may roll back.
    const { id } = await db.createStory({
      userId: 9,
      title: "Race",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));

    const writerA = db.updateStoryBodyIfRevision({
      id,
      userId: 9,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], marker: "A-failed" },
    });
    const writerB = db.updateStoryBodyIfRevision({
      id,
      userId: 9,
      expectedRevision: 2,
      body: { _revision: 3, shots: [], marker: "B-succeeded" },
    });

    await expect(writerA).rejects.toThrow();
    await expect(writerB).resolves.toBe(true);

    const story = await db.getStoryById(id, 9);
    expect((story?.body as Record<string, unknown>).marker).toBe(
      "B-succeeded"
    );
    expect((story?.body as Record<string, unknown>)._revision).toBe(3);
  });

  it("does not let a failed body-CAS rollback erase a concurrent title-only write to the same row", async () => {
    // Same hazard as above, but across two different writer functions that
    // only intersect by sharing the same in-memory row object: a failed
    // updateStoryBodyIfRevision must not touch `title`, which it never wrote.
    const { id } = await db.createStory({
      userId: 9,
      title: "未命名",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));

    const bodyWrite = db.updateStoryBodyIfRevision({
      id,
      userId: 9,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], marker: "A-failed" },
    });
    const titleWrite = db.updateStoryTitleIfUntitled(
      id,
      9,
      "Real Title From User"
    );

    await expect(bodyWrite).rejects.toThrow();
    await expect(titleWrite).resolves.toBe(true);

    const story = await db.getStoryById(id, 9);
    expect(story?.title).toBe("Real Title From User");
  });
});
