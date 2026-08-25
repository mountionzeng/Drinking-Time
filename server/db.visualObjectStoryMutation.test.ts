import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "dt-visual-story-atomic-")
);
const persistPath = path.join(tempDir, "local-persist.json");
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = persistPath;

const fs = await import("node:fs/promises");
const db = await import("./db");

type PersistedState = {
  stories: Array<{ id: number; body: unknown }>;
  storyTimelines: Array<{ storyId: number; version: number; items: unknown }>;
};

const completeTimeline = (suffix: string) => ({
  items: [
    {
      stableShotId: `shot-${suffix}`,
      included: true,
      position: 0,
      visualClips: [
        { id: `clip-${suffix}`, startFrame: 0, durationFrames: 30 },
      ],
    },
  ],
  overlays: [
    {
      id: `overlay-${suffix}`,
      kind: "generated-video",
      startFrame: 4,
      durationFrames: 12,
    },
  ],
  visualLayerState: {
    layers: [{ id: `layer-${suffix}`, hidden: false, locked: false }],
    selectedLayerId: `layer-${suffix}`,
  },
});

async function readPersistedState(): Promise<PersistedState> {
  return JSON.parse(await readFile(persistPath, "utf-8")) as PersistedState;
}

async function seedAggregate() {
  const story = await db.createStory({
    userId: 1,
    title: "aggregate mutation",
    body: {
      _revision: 1,
      shots: [{ stableShotId: "shot-before" }],
      marker: "before",
    },
  });
  await db.updateStoryTimeline({
    storyId: story.id,
    userId: 1,
    expectedVersion: 0,
    ...completeTimeline("before"),
  });
  return story.id;
}

describe("updateStoryAndTimelineAtomic local persistence", () => {
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
    if (previousLocalPersistPath === undefined)
      delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("publishes and persists Story plus the complete Timeline as one fact", async () => {
    const storyId = await seedAggregate();
    const nextTimeline = completeTimeline("after");

    const result = await db.updateStoryAndTimelineAtomic({
      storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: {
        _revision: 2,
        shots: [{ stableShotId: "shot-after" }],
        marker: "after",
      },
      nextTimeline,
    });

    expect(result.story.body).toMatchObject({ _revision: 2, marker: "after" });
    expect(result.timeline).toMatchObject({ version: 2, ...nextTimeline });
    expect(await db.getStoryById(storyId, 1)).toMatchObject({
      body: { _revision: 2, marker: "after" },
    });
    expect(await db.getStoryTimeline(storyId, 1)).toMatchObject({
      version: 2,
      ...nextTimeline,
    });

    const disk = await readPersistedState();
    expect(disk.stories.find(row => row.id === storyId)?.body).toMatchObject({
      _revision: 2,
      marker: "after",
    });
    expect(
      disk.storyTimelines.find(row => row.storyId === storyId)
    ).toMatchObject({
      version: 2,
      items: nextTimeline,
    });
  });

  it("leaves both memory and disk at before when persistence fails", async () => {
    const storyId = await seedAggregate();
    const beforeDisk = await readPersistedState();
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename failed"));

    await expect(
      db.updateStoryAndTimelineAtomic({
        storyId,
        userId: 1,
        expectedStoryRevision: 1,
        expectedTimelineVersion: 1,
        nextStoryBody: { _revision: 2, shots: [], marker: "must-not-land" },
        nextTimeline: completeTimeline("must-not-land"),
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    expect(await db.getStoryById(storyId, 1)).toMatchObject({
      body: { _revision: 1, marker: "before" },
    });
    expect(await db.getStoryTimeline(storyId, 1)).toMatchObject({
      version: 1,
      ...completeTimeline("before"),
    });
    expect(await readPersistedState()).toEqual(beforeDisk);
  });

  it.each([
    ["Story", 0, 1],
    ["Timeline", 1, 0],
  ] as const)(
    "rejects a stale %s CAS loser with zero memory, disk, or write side effects",
    async (_label, storyRevisionDelta, timelineVersionDelta) => {
      const storyId = await seedAggregate();
      const beforeDisk = await readFile(persistPath, "utf-8");
      const writesBefore = vi.mocked(fs.writeFile).mock.calls.length;

      await expect(
        db.updateStoryAndTimelineAtomic({
          storyId,
          userId: 1,
          expectedStoryRevision: 1 - storyRevisionDelta,
          expectedTimelineVersion: 1 - timelineVersionDelta,
          nextStoryBody: {
            _revision: 2 - storyRevisionDelta,
            shots: [],
            marker: "cas-loser",
          },
          nextTimeline: completeTimeline("cas-loser"),
        })
      ).rejects.toThrow();

      expect(vi.mocked(fs.writeFile).mock.calls.length).toBe(writesBefore);
      expect(await readFile(persistPath, "utf-8")).toBe(beforeDisk);
      expect(await db.getStoryById(storyId, 1)).toMatchObject({
        body: { _revision: 1, marker: "before" },
      });
      expect(await db.getStoryTimeline(storyId, 1)).toMatchObject({
        version: 1,
        ...completeTimeline("before"),
      });
    }
  );

  it("allows a recovery write and preserves the entire replacement document", async () => {
    const storyId = await seedAggregate();
    vi.mocked(fs.writeFile).mockRejectedValueOnce(
      new Error("transient disk error")
    );

    await expect(
      db.updateStoryAndTimelineAtomic({
        storyId,
        userId: 1,
        expectedStoryRevision: 1,
        expectedTimelineVersion: 1,
        nextStoryBody: { _revision: 2, shots: [], marker: "failed" },
        nextTimeline: completeTimeline("failed"),
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    const recoveredTimeline = completeTimeline("recovered");
    await expect(
      db.updateStoryAndTimelineAtomic({
        storyId,
        userId: 1,
        expectedStoryRevision: 1,
        expectedTimelineVersion: 1,
        nextStoryBody: {
          _revision: 2,
          shots: [{ stableShotId: "shot-recovered" }],
          marker: "recovered",
        },
        nextTimeline: recoveredTimeline,
      })
    ).resolves.toMatchObject({
      story: { body: { _revision: 2, marker: "recovered" } },
      timeline: { version: 2, ...recoveredTimeline },
    });

    const disk = await readPersistedState();
    expect(
      disk.storyTimelines.find(row => row.storyId === storyId)
    ).toMatchObject({
      version: 2,
      items: recoveredTimeline,
    });
  });

  it("serializes concurrent same-Story writers so exactly one CAS contender wins", async () => {
    const storyId = await seedAggregate();
    let releaseFirstWrite!: () => void;
    let signalFirstWrite!: () => void;
    const firstWriteStarted = new Promise<void>(resolve => {
      signalFirstWrite = resolve;
    });
    const realWrite = vi.mocked(fs.writeFile).getMockImplementation();
    if (!realWrite)
      throw new Error("writeFile mock has no real implementation");
    vi.mocked(fs.writeFile).mockImplementationOnce(async (...args) => {
      signalFirstWrite();
      await new Promise<void>(resolve => {
        releaseFirstWrite = resolve;
      });
      return realWrite(...args);
    });

    const first = db.updateStoryAndTimelineAtomic({
      storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: { _revision: 2, shots: [], marker: "winner-a" },
      nextTimeline: completeTimeline("winner-a"),
    });
    await firstWriteStarted;
    const second = db.updateStoryAndTimelineAtomic({
      storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: { _revision: 2, shots: [], marker: "winner-b" },
      nextTimeline: completeTimeline("winner-b"),
    });
    releaseFirstWrite();

    const settled = await Promise.allSettled([first, second]);
    expect(
      settled.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(settled.filter(result => result.status === "rejected")).toHaveLength(
      1
    );
    await expect(first).resolves.toMatchObject({
      story: { body: { marker: "winner-a" } },
      timeline: { version: 2 },
    });
    await expect(second).rejects.toThrow("故事已经更新");
    expect(await db.getStoryById(storyId, 1)).toMatchObject({
      body: { _revision: 2, marker: "winner-a" },
    });
    expect(await db.getStoryTimeline(storyId, 1)).toMatchObject({
      version: 2,
      ...completeTimeline("winner-a"),
    });
  });
});
