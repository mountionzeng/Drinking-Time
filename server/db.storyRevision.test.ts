import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-story-cas-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

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
});
