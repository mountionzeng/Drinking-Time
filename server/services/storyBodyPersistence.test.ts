import { mkdtemp, rm } from "node:fs/promises";
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

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-story-body-service-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("../db");
const persistence = await import("./storyBodyPersistence");

describe("story body persistence boundary", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("returns the coherent winning Story and exposes the latest loser projection", async () => {
    const { id } = await db.createStory({
      userId: 21,
      title: "boundary",
      body: { _revision: 1, shots: [], value: "base" },
    });

    const saved = await persistence.persistPreparedStoryBody({
      storyId: id,
      userId: 21,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], value: "winner" },
    });
    expect(saved.body).toMatchObject({ _revision: 2, value: "winner" });

    await expect(
      persistence.persistPreparedStoryBody({
        storyId: id,
        userId: 21,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], value: "loser" },
      })
    ).rejects.toMatchObject({
      name: "StoryBodyRevisionConflictError",
      expectedRevision: 1,
      latestStory: expect.objectContaining({
        body: expect.objectContaining({ value: "winner" }),
      }),
    });
  });

  it("returns its own winning snapshot even if another writer commits before a read-back", async () => {
    const { id } = await db.createStory({
      userId: 22,
      title: "race",
      body: { _revision: 1, shots: [], value: "base" },
    });
    const originalCas = db.updateStoryBodyIfRevision;
    vi.spyOn(db, "updateStoryBodyIfRevision").mockImplementation(
      async input => {
        const won = await originalCas(input);
        if (won) {
          await db.updateStory(id, 22, {
            body: { _revision: 3, shots: [], value: "competitor" },
          });
        }
        return won;
      }
    );

    const saved = await persistence.persistPreparedStoryBody({
      storyId: id,
      userId: 22,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], value: "winner" },
    });

    expect(saved.body).toMatchObject({ _revision: 2, value: "winner" });
    expect((await db.getStoryById(id, 22))?.body).toMatchObject({
      _revision: 3,
      value: "competitor",
    });
  });
});
