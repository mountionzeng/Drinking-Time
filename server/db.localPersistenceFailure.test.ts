import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the real fs/promises mkdir/writeFile/rename so individual tests can
// force a single call to fail (disk full, permission denied, rename across
// devices, …) while every other call keeps using the real filesystem —
// including the module's own setup/teardown below.
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-local-persist-fail-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const fs = await import("node:fs/promises");
const db = await import("./db");

describe("local persistence write-failure semantics", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  afterEach(() => {
    vi.mocked(fs.mkdir).mockClear();
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("propagates a writeFile failure to the caller instead of silently succeeding", async () => {
    const { id } = await db.createStory({
      userId: 1,
      title: "Disk failure",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.writeFile).mockRejectedValueOnce(
      Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      })
    );

    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 1,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "should-not-land" },
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    const story = await db.getStoryById(id, 1);
    expect((story?.body as Record<string, unknown>).marker).toBe("base");
    expect((story?.body as Record<string, unknown>)._revision).toBe(1);
  });

  it("propagates a rename failure to the caller and leaves the row unchanged", async () => {
    const { id } = await db.createStory({
      userId: 1,
      title: "Rename failure",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.rename).mockRejectedValueOnce(
      Object.assign(new Error("EXDEV: cross-device link not permitted"), {
        code: "EXDEV",
      })
    );

    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 1,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "should-not-land" },
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    const story = await db.getStoryById(id, 1);
    expect((story?.body as Record<string, unknown>).marker).toBe("base");
  });

  it("does not permanently jam the write queue after one failure", async () => {
    const { id } = await db.createStory({
      userId: 1,
      title: "Recovers after failure",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("transient"));

    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 1,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "failed-write" },
      })
    ).rejects.toThrow();

    // The next write uses the real (non-mocked-to-fail) filesystem call and
    // must succeed — a prior queued failure must not wedge later writers.
    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 1,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "recovered" },
      })
    ).resolves.toBe(true);

    const story = await db.getStoryById(id, 1);
    expect((story?.body as Record<string, unknown>).marker).toBe("recovered");
  });

  it("propagates the same failure for a non-Story local writer (upsertUser)", async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk error"));

    await expect(
      db.upsertUser({ openId: "user-local-persist-fail-test" })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });
  });

  it("propagates a mkdir failure to the caller", async () => {
    const { id } = await db.createStory({
      userId: 1,
      title: "mkdir failure",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.mkdir).mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      })
    );

    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 1,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "should-not-land" },
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });
  });

  it("cleans up the orphaned tmp file when rename fails", async () => {
    const { id } = await db.createStory({
      userId: 1,
      title: "orphan cleanup",
      body: { _revision: 1, shots: [], marker: "base" },
    });
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("EXDEV"));

    await expect(
      db.updateStoryBodyIfRevision({
        id,
        userId: 1,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], marker: "should-not-land" },
      })
    ).rejects.toThrow();

    const filesLeftBehind = (await readdir(tempDir)).filter(name =>
      name.includes(".tmp")
    );
    expect(filesLeftBehind).toEqual([]);
  });

  it("documents the scoped rollback boundary: a non-CAS writer's failed mutation stays applied in memory and can be silently persisted by a later unrelated write", async () => {
    // This is the known, intentionally-scoped gap recorded in
    // docs/features/feature-ledger.json's story-ownership card: only
    // updateStoryBodyIfRevision gets copy-on-write rollback. Every other
    // local writer (upsertUser here) now correctly throws on disk failure,
    // but its in-memory mutation is not undone — and because
    // persistMemoryStateToDisk always serializes the full ambient
    // memoryState, a later unrelated successful write silently carries the
    // "failed" mutation to disk too. This test locks in that this is the
    // CURRENT behavior so a future change either fixes it deliberately or
    // updates this test, rather than drifting unnoticed.
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk error"));
    await expect(
      db.upsertUser({ openId: "ghost-user", name: "Should not silently land" })
    ).rejects.toThrow();

    const ghostUser = await db.getUserByOpenId("ghost-user");
    expect(ghostUser).not.toBeNull(); // mutation is still applied in memory

    // An unrelated, later write succeeds (real fs call, no mock override) and
    // flushes the full ambient memoryState — including the "failed" user.
    await db.upsertUser({ openId: "unrelated-user-triggers-flush" });

    vi.resetModules();
    const reloadedDb = await import("./db");
    const reloadedGhost = await reloadedDb.getUserByOpenId("ghost-user");
    expect(reloadedGhost).not.toBeNull(); // silently landed on disk anyway
  });
});
