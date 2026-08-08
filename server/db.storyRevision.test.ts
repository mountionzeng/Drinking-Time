import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string | null = null;

describe("Story body revision compare-and-swap", () => {
  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-story-cas-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
  });

  afterEach(async () => {
    delete process.env.LOCAL_PERSIST_PATH;
    delete process.env.DATABASE_URL;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("allows exactly one independent writer to win the same expected revision", async () => {
    const db = await import("./db");
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
    let db = await import("./db");
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
