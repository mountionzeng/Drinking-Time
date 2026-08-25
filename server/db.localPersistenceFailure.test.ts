import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

  it("does not publish a newly-created timeline when its durable write fails", async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk error"));

    await expect(
      db.updateStoryTimeline({
        storyId: 101,
        userId: 1,
        expectedVersion: 0,
        items: [{ stableShotId: "shot-create-failed" }],
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    expect(await db.getStoryTimeline(101, 1)).toBeNull();

    await expect(
      db.updateStoryTimeline({
        storyId: 101,
        userId: 1,
        expectedVersion: 0,
        items: [{ stableShotId: "shot-create-retry" }],
      })
    ).resolves.toMatchObject({
      version: 1,
      items: [{ stableShotId: "shot-create-retry" }],
    });
  });

  it.each(["mkdir", "writeFile", "rename"] as const)(
    "rolls back timeline create when %s fails",
    async method => {
      if (method === "mkdir")
        vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error("mkdir failed"));
      else if (method === "writeFile")
        vi.mocked(fs.writeFile).mockRejectedValueOnce(
          new Error("write failed")
        );
      else
        vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename failed"));
      await expect(
        db.updateStoryTimeline({
          storyId: 201,
          userId: 1,
          expectedVersion: 0,
          items: [{ stableShotId: "never" }],
        })
      ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });
      expect(await db.getStoryTimeline(201, 1)).toBeNull();
    }
  );

  it.each(["mkdir", "writeFile", "rename"] as const)(
    "rolls back timeline update when %s fails",
    async method => {
      await db.updateStoryTimeline({
        storyId: 202,
        userId: 1,
        expectedVersion: 0,
        items: [{ stableShotId: "before" }],
      });
      if (method === "mkdir")
        vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error("mkdir failed"));
      else if (method === "writeFile")
        vi.mocked(fs.writeFile).mockRejectedValueOnce(
          new Error("write failed")
        );
      else
        vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename failed"));
      await expect(
        db.updateStoryTimeline({
          storyId: 202,
          userId: 1,
          expectedVersion: 1,
          items: [{ stableShotId: "never" }],
        })
      ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });
      await expect(db.getStoryTimeline(202, 1)).resolves.toMatchObject({
        version: 1,
        items: [{ stableShotId: "before" }],
      });
    }
  );

  it("restores an existing timeline when its durable update fails", async () => {
    await db.updateStoryTimeline({
      storyId: 102,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-before" }],
    });
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename failed"));

    await expect(
      db.updateStoryTimeline({
        storyId: 102,
        userId: 1,
        expectedVersion: 1,
        items: [{ stableShotId: "shot-should-not-land" }],
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    expect(await db.getStoryTimeline(102, 1)).toMatchObject({
      version: 1,
      items: [{ stableShotId: "shot-before" }],
    });

    await expect(
      db.updateStoryTimeline({
        storyId: 102,
        userId: 1,
        expectedVersion: 1,
        items: [{ stableShotId: "shot-update-retry" }],
      })
    ).resolves.toMatchObject({
      version: 2,
      items: [{ stableShotId: "shot-update-retry" }],
    });
  });

  it("rolls back a failed timeline write before the next same-story CAS begins", async () => {
    await db.updateStoryTimeline({
      storyId: 103,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-v1" }],
    });

    let signalWriteStarted!: () => void;
    let rejectWrite!: (error: Error) => void;
    const writeStarted = new Promise<void>(resolve => {
      signalWriteStarted = resolve;
    });
    vi.mocked(fs.writeFile).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
          signalWriteStarted();
        })
    );

    const first = db.updateStoryTimeline({
      storyId: 103,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "shot-v2-write-fails" }],
    });
    await writeStarted;
    const second = db.updateStoryTimeline({
      storyId: 103,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "shot-v3-succeeds" }],
    });
    rejectWrite(new Error("first write failed"));

    await expect(first).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    await expect(second).resolves.toMatchObject({
      version: 2,
      items: [{ stableShotId: "shot-v3-succeeds" }],
    });
    expect(await db.getStoryTimeline(103, 1)).toMatchObject({
      version: 2,
      items: [{ stableShotId: "shot-v3-succeeds" }],
    });
  });

  it("does not expose a tentative timeline through a getter while persistence is pending", async () => {
    await db.updateStoryTimeline({
      storyId: 104,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "before" }],
    });
    let started!: () => void;
    let fail!: (error: Error) => void;
    const writeStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.mocked(fs.writeFile).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
          started();
        })
    );
    const update = db.updateStoryTimeline({
      storyId: 104,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "tentative" }],
    });
    await writeStarted;
    let getterSettled = false;
    const getter = db.getStoryTimeline(104, 1).then(value => {
      getterSettled = true;
      return value;
    });
    await Promise.resolve();
    expect(getterSettled).toBe(false);
    fail(new Error("disk failed"));
    await expect(update).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    await expect(getter).resolves.toMatchObject({
      version: 1,
      items: [{ stableShotId: "before" }],
    });
  });

  it("cleans a failed Story before a queued different-Story batch serializes", async () => {
    await db.updateStoryTimeline({
      storyId: 105,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "a-before" }],
    });
    await db.updateStoryTimeline({
      storyId: 106,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "b-before" }],
    });
    let started!: () => void;
    let fail!: (error: Error) => void;
    const writeStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.mocked(fs.writeFile).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
          started();
        })
    );
    const a = db.updateStoryTimeline({
      storyId: 105,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "a-failed" }],
    });
    await writeStarted;
    const b = db.updateStoryTimeline({
      storyId: 106,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "b-success" }],
    });
    fail(new Error("disk failed"));
    await expect(a).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    await expect(b).resolves.toMatchObject({
      version: 2,
      items: [{ stableShotId: "b-success" }],
    });
    expect(await db.getStoryTimeline(105, 1)).toMatchObject({
      version: 1,
      items: [{ stableShotId: "a-before" }],
    });
  });

  it("snapshots a batch before mkdir so a queued mutation cannot hitchhike into its successful disk write", async () => {
    await db.updateStoryTimeline({
      storyId: 107,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "a-before" }],
    });
    await db.updateStoryTimeline({
      storyId: 108,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "b-before" }],
    });
    let releaseMkdir!: () => void;
    const mkdirPending = new Promise<string | undefined>(resolve => {
      releaseMkdir = () => resolve(undefined);
    });
    const defaultWriteFile = vi.mocked(fs.writeFile).getMockImplementation();
    vi.mocked(fs.mkdir).mockImplementationOnce(() => mkdirPending);
    if (!defaultWriteFile)
      throw new Error("writeFile mock missing default implementation");
    vi.mocked(fs.writeFile)
      .mockImplementationOnce(defaultWriteFile)
      .mockRejectedValueOnce(new Error("B write failed"));
    const a = db.updateStoryTimeline({
      storyId: 107,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "a-success" }],
    });
    await vi.waitFor(() => expect(fs.mkdir).toHaveBeenCalled());
    const b = db.updateStoryTimeline({
      storyId: 108,
      userId: 1,
      expectedVersion: 1,
      items: [{ stableShotId: "b-must-not-land" }],
    });
    releaseMkdir();
    await expect(a).resolves.toMatchObject({ version: 2 });
    await expect(b).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf-8")
    ) as {
      storyTimelines: Array<{
        storyId: number;
        version: number;
        items: unknown;
      }>;
    };
    expect(disk.storyTimelines.find(row => row.storyId === 107)).toMatchObject({
      version: 2,
    });
    expect(disk.storyTimelines.find(row => row.storyId === 108)).toMatchObject({
      version: 1,
      items: [{ stableShotId: "b-before" }],
    });
  });

  it("documents the scoped rollback boundary: a non-CAS writer's failed mutation stays applied in memory and can be silently persisted by a later unrelated write", async () => {
    // This is the known, intentionally-scoped gap recorded in
    // docs/features/feature-ledger.json's story-ownership card: only
    // updateStoryBodyIfRevision and updateStoryTimeline get copy-on-write
    // rollback. Other local writers (upsertUser here) correctly throw on disk failure,
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
