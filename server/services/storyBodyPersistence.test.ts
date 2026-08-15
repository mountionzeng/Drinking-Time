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
const publishingPersistence = await import("./publishingPersistence");

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

  it("lets a title rename and a publishing V2 draft edit on the same Story both persist without either clobbering the other", async () => {
    // Plan's U3 "Integration" test scenario: two tabs, one editing the
    // title, one editing a publishing platform draft, concurrently. title
    // lives in a dedicated DB column (server/db.ts:updateStoryTitle) and
    // publishing lives inside the CAS-protected body
    // (writePublishingDraftState -> persistPreparedStoryBody). These two
    // writers touch disjoint columns, so neither's CAS/lack-of-CAS should
    // cause the other's change to be lost.
    const { id } = await db.createStory({
      userId: 30,
      title: "未命名",
      body: { _revision: 0, shots: [] },
    });

    await Promise.all([
      db.updateStoryTitle(id, 30, "Renamed While Publishing"),
      publishingPersistence.writePublishingDraftState({
        storyId: id,
        userId: 30,
        operation: {
          type: "initialize",
          activePlatform: "xiaohongshu",
          selectedPlatforms: ["xiaohongshu"],
          core: {
            facts: ["事实"],
            thesis: "判断",
            emotion: "克制",
            voiceTraits: ["直接"],
            visualConcept: "一个居中的人物",
          },
          content: { title: "", body: "V2 平台稿", tags: [] },
          basePublishingRevision: 0,
        },
      }),
    ]);

    const story = await db.getStoryById(id, 30);
    expect(story?.title).toBe("Renamed While Publishing");
    const publishing = await publishingPersistence.getPublishingDraftState(
      id,
      30
    );
    expect(publishing.publishing.drafts.xiaohongshu?.content.body).toBe(
      "V2 平台稿"
    );
  });

  it("propagates a local persistence write failure unchanged, not as a revision conflict", async () => {
    const { id } = await db.createStory({
      userId: 23,
      title: "disk failure",
      body: { _revision: 1, shots: [], value: "base" },
    });
    vi.spyOn(db, "updateStoryBodyIfRevision").mockRejectedValueOnce(
      new db.LocalPersistenceWriteError("/tmp/fake-path.json", new Error("ENOSPC"))
    );

    await expect(
      persistence.persistPreparedStoryBody({
        storyId: id,
        userId: 23,
        expectedRevision: 1,
        body: { _revision: 2, shots: [], value: "should-not-land" },
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });
  });
});
