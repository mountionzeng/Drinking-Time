import { readFile, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  };
});
import {
  applyStoryTimelineOverlayAtomic,
  createStory,
  createVideoTake,
  getStoryById,
  getStoryTimeline,
  insertTransitionShotAtomic,
  resetMemoryStateForTesting,
  restoreSplitStoryShotAtomic,
  updateStoryAndTimelineAtomic,
  updateStoryBodyIfRevision,
  updateStoryTimeline,
} from "./db";

const passthroughWriteFile = vi.mocked(writeFile).getMockImplementation()!;

function blockNextPersistenceWrite() {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
    markStarted();
    await gate;
    return passthroughWriteFile(...args);
  });
  return { started, release };
}

function failNextPersistenceWriteAfterGate() {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  vi.mocked(writeFile).mockImplementationOnce(async () => {
    markStarted();
    await gate;
    throw new Error("gated persistence failure");
  });
  return { started, release };
}

describe("story timeline overlay persistence", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    vi.mocked(writeFile).mockClear();
  });

  it("round-trips overlays and preserves them when an ordinary timeline edit saves items", async () => {
    const story = await createStory({
      userId: 1,
      title: "overlay",
      body: { shots: [{ shotNo: 1, stableShotId: "shot-a" }] },
    });
    const overlays = [
      {
        id: "overlay-a",
        kind: "generated-video",
        takeId: 9,
        sourceStableShotId: "shot-a",
        videoUrl: "/video.mp4",
        startFrame: 0,
        targetEndFrame: 90,
        mediaEndFrame: 80,
        endFrame: 90,
        stackOrder: 1,
        leftImageId: 1,
        rightImageId: 2,
        transform: {},
      },
    ];
    const created = await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-a", included: true, position: 0 }],
      overlays,
      visualLayerState: { count: 4, hidden: [2] },
    });
    expect(created).toMatchObject({
      version: 1,
      overlays,
      visualLayerState: { count: 4, hidden: [2] },
    });

    const updated = await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 1,
      items: [
        { stableShotId: "shot-a", included: true, position: 0, stackOrder: 2 },
      ],
    });
    expect(updated).toMatchObject({
      version: 2,
      overlays,
      visualLayerState: { count: 4, hidden: [2] },
    });
    expect(await getStoryTimeline(story.id, 1)).toMatchObject({
      overlays,
      visualLayerState: { count: 4, hidden: [2] },
    });
  });

  it("atomically marks the paid take applied while appending one idempotent overlay", async () => {
    const story = await createStory({
      userId: 1,
      title: "atomic overlay",
      body: { shots: [{ shotNo: 1, stableShotId: "shot-a" }] },
    });
    const timeline = await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [{ stableShotId: "shot-a", included: true, position: 0 }],
      visualLayerState: { count: 3, hidden: [1] },
    });
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "transition-shot-a",
      sourceImageId: 1,
      status: "available",
      provider: "302",
      model: "viduq2-turbo",
      prompt: "overlay",
      durationSec: 3,
      aspectRatio: "1:1",
      videoUrl: "/api/videos/take.mp4",
      extractionCapability: "available",
      parameterSnapshot: { appliedToTimeline: false },
    });
    const overlay = {
      id: "overlay-atomic",
      kind: "generated-video" as const,
      takeId: take.id,
      sourceStableShotId: "shot-a",
      videoUrl: take.videoUrl!,
      startFrame: 30,
      targetEndFrame: 132,
      mediaEndFrame: 120,
      endFrame: 132,
      stackOrder: 5,
      leftImageId: 1,
      rightImageId: 2,
      transform: {
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1,
        zoom: 1,
        panX: 0,
        panY: 0,
      },
    };
    const applied = await applyStoryTimelineOverlayAtomic({
      storyId: story.id,
      userId: 1,
      takeId: take.id,
      stableShotId: "transition-shot-a",
      expectedStoryRevision: 0,
      expectedVersion: timeline.version,
      nextStoryBody: {
        revision: 1,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "transition-shot-a" },
        ],
      },
      nextTimelineItems: [
        { stableShotId: "shot-a", included: true, position: 0 },
        { stableShotId: "transition-shot-a", included: true, position: 1 },
      ],
      overlay,
    });
    const repeated = await applyStoryTimelineOverlayAtomic({
      storyId: story.id,
      userId: 1,
      takeId: take.id,
      stableShotId: "transition-shot-a",
      expectedStoryRevision: 0,
      expectedVersion: timeline.version,
      nextStoryBody: {
        revision: 1,
        shots: [
          { shotNo: 1, stableShotId: "shot-a" },
          { shotNo: 2, stableShotId: "transition-shot-a" },
        ],
      },
      nextTimelineItems: [
        { stableShotId: "shot-a", included: true, position: 0 },
        { stableShotId: "transition-shot-a", included: true, position: 1 },
      ],
      overlay,
    });
    expect(applied.applied).toBe(true);
    expect(repeated.applied).toBe(false);
    expect(applied.take.parameterSnapshot).toMatchObject({
      appliedToTimeline: true,
      overlayId: overlay.id,
    });
    expect(applied.timeline.overlays as unknown[]).toHaveLength(1);
    // 采用生成视频不得顺手抹掉图层数量与显隐：以前这条写入不带 visualLayerState，
    // encode 就把整个字段丢了，刷新后图层管理全部回到默认。
    expect(applied.timeline).toMatchObject({
      visualLayerState: { count: 3, hidden: [1] },
    });
    expect(await getStoryTimeline(story.id, 1)).toMatchObject({
      visualLayerState: { count: 3, hidden: [1] },
    });
    expect(applied.timeline.items as unknown[]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stableShotId: "transition-shot-a" }),
      ])
    );
    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: {
        shots: expect.arrayContaining([
          expect.objectContaining({ stableShotId: "transition-shot-a" }),
        ]),
      },
    });
  });

  it.each([
    { shotExists: false, timelineItemExists: false, overlayExists: true },
    { shotExists: false, timelineItemExists: true, overlayExists: false },
    { shotExists: false, timelineItemExists: true, overlayExists: true },
    { shotExists: true, timelineItemExists: false, overlayExists: false },
    { shotExists: true, timelineItemExists: false, overlayExists: true },
    { shotExists: true, timelineItemExists: true, overlayExists: false },
  ])(
    "repairs a partial adoption state: shot=$shotExists item=$timelineItemExists overlay=$overlayExists",
    async ({ shotExists, timelineItemExists, overlayExists }) => {
      const stableShotId = "transition-shot-repair";
      const story = await createStory({
        userId: 1,
        title: "repair overlay",
        body: {
          revision: 0,
          shots: [
            { shotNo: 1, stableShotId: "shot-a" },
            ...(shotExists ? [{ shotNo: 2, stableShotId }] : []),
          ],
        },
      });
      const overlay = {
        id: "overlay-repair",
        kind: "generated-video" as const,
        takeId: 1,
        sourceStableShotId: stableShotId,
        videoUrl: "/api/videos/repair.mp4",
        startFrame: 30,
        targetEndFrame: 132,
        mediaEndFrame: 120,
        endFrame: 132,
        stackOrder: 5,
        leftImageId: 1,
        rightImageId: 2,
        transform: {},
      };
      const timeline = await updateStoryTimeline({
        storyId: story.id,
        userId: 1,
        expectedVersion: 0,
        items: [
          { stableShotId: "shot-a", included: true, position: 0 },
          ...(timelineItemExists
            ? [{ stableShotId, included: true, position: 1 }]
            : []),
        ],
        ...(overlayExists ? { overlays: [overlay] } : {}),
      });
      const take = await createVideoTake({
        storyId: story.id,
        userId: 1,
        stableShotId,
        sourceImageId: 1,
        status: "available",
        provider: "302",
        model: "viduq2-turbo",
        prompt: "repair",
        durationSec: 3,
        aspectRatio: "1:1",
        videoUrl: overlay.videoUrl,
        extractionCapability: "available",
        parameterSnapshot: { appliedToTimeline: false },
      });
      overlay.takeId = take.id;

      const repaired = await applyStoryTimelineOverlayAtomic({
        storyId: story.id,
        userId: 1,
        takeId: take.id,
        stableShotId,
        expectedStoryRevision: 0,
        expectedVersion: timeline.version,
        nextStoryBody: {
          revision: 1,
          shots: [
            { shotNo: 1, stableShotId: "shot-a" },
            { shotNo: 2, stableShotId },
          ],
        },
        nextTimelineItems: [
          { stableShotId: "shot-a", included: true, position: 0 },
          { stableShotId, included: true, position: 1 },
        ],
        overlay,
      });

      expect(repaired.applied).toBe(true);
      expect(repaired.story.body).toMatchObject({
        shots: expect.arrayContaining([
          expect.objectContaining({ stableShotId }),
        ]),
      });
      expect(repaired.timeline.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ stableShotId })])
      );
      expect(repaired.timeline.overlays).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: overlay.id })])
      );
      expect(repaired.take.parameterSnapshot).toMatchObject({
        appliedToTimeline: true,
        overlayId: overlay.id,
      });
    }
  );
});

describe("Story and Timeline aggregate CAS", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    vi.mocked(writeFile).mockClear();
  });

  async function seedAggregate(userId = 1, title = "aggregate") {
    const story = await createStory({
      userId,
      title,
      body: { _revision: 1, shots: [], marker: "before" },
    });
    const timeline = await updateStoryTimeline({
      storyId: story.id,
      userId,
      expectedVersion: 0,
      items: [{ stableShotId: `${title}-shot`, position: 0 }],
      overlays: [{ id: `${title}-overlay` }],
      visualLayerState: { count: 3, hidden: [2] },
    });
    return { storyId: story.id, timeline };
  }

  it("publishes both complete documents and increments both versions exactly once", async () => {
    const { storyId } = await seedAggregate();

    const result = await updateStoryAndTimelineAtomic({
      storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: { _revision: 2, shots: [], marker: "after" },
      nextTimeline: {
        items: [{ stableShotId: "replacement", position: 0 }],
        overlays: [],
      },
    });

    expect(result.story.body).toMatchObject({ _revision: 2, marker: "after" });
    expect(result.timeline).toMatchObject({
      version: 2,
      items: [{ stableShotId: "replacement", position: 0 }],
      overlays: [],
    });
    expect(result.timeline).not.toHaveProperty("visualLayerState");
    expect(await getStoryTimeline(storyId, 1)).toMatchObject({ overlays: [] });
  });

  it.each([
    { expectedStoryRevision: 0, expectedTimelineVersion: 1 },
    { expectedStoryRevision: 1, expectedTimelineVersion: 0 },
  ])(
    "rejects either CAS conflict with zero writes",
    async ({ expectedStoryRevision, expectedTimelineVersion }) => {
      const { storyId } = await seedAggregate();

      await expect(
        updateStoryAndTimelineAtomic({
          storyId,
          userId: 1,
          expectedStoryRevision,
          expectedTimelineVersion,
          nextStoryBody: {
            _revision: expectedStoryRevision + 1,
            shots: [],
            marker: "must-not-land",
          },
          nextTimeline: { items: [], overlays: [] },
        })
      ).rejects.toThrow(/更新/);

      expect(await getStoryById(storyId, 1)).toMatchObject({
        body: { _revision: 1, marker: "before" },
      });
      expect(await getStoryTimeline(storyId, 1)).toMatchObject({
        version: 1,
        overlays: [{ id: "aggregate-overlay" }],
        visualLayerState: { count: 3, hidden: [2] },
      });
    }
  );

  it("leaves memory and disk unchanged when local persistence fails", async () => {
    const { storyId } = await seedAggregate();
    const persistPath = process.env.LOCAL_PERSIST_PATH!;
    const beforeDisk = await readFile(persistPath, "utf8");
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));

    await expect(
      updateStoryAndTimelineAtomic({
        storyId,
        userId: 1,
        expectedStoryRevision: 1,
        expectedTimelineVersion: 1,
        nextStoryBody: { _revision: 2, shots: [], marker: "must-not-land" },
        nextTimeline: { items: [], overlays: [] },
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    expect(await getStoryById(storyId, 1)).toMatchObject({
      body: { _revision: 1, marker: "before" },
    });
    expect(await getStoryTimeline(storyId, 1)).toMatchObject({
      version: 1,
      overlays: [{ id: "aggregate-overlay" }],
    });
    expect(await readFile(persistPath, "utf8")).toBe(beforeDisk);
  });

  it("does not mutate another Story aggregate", async () => {
    const first = await seedAggregate(1, "first");
    const second = await seedAggregate(1, "second");

    await updateStoryAndTimelineAtomic({
      storyId: first.storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: { _revision: 2, shots: [], marker: "first-after" },
      nextTimeline: { items: [], overlays: [] },
    });

    expect(await getStoryById(second.storyId, 1)).toMatchObject({
      body: { _revision: 1, marker: "before" },
    });
    expect(await getStoryTimeline(second.storyId, 1)).toMatchObject({
      version: 1,
      overlays: [{ id: "second-overlay" }],
      visualLayerState: { count: 3, hidden: [2] },
    });
  });

  it("serializes aggregate CAS against the ordinary Story body CAS", async () => {
    const { storyId } = await seedAggregate();
    const diskGate = blockNextPersistenceWrite();
    const aggregate = updateStoryAndTimelineAtomic({
      storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: { _revision: 2, shots: [], marker: "aggregate-wins" },
      nextTimeline: { items: [], overlays: [] },
    });
    await diskGate.started;

    const bodyOnly = updateStoryBodyIfRevision({
      id: storyId,
      userId: 1,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], marker: "body-must-lose" },
    });
    diskGate.release();

    await expect(aggregate).resolves.toMatchObject({
      story: { body: { _revision: 2, marker: "aggregate-wins" } },
      timeline: { version: 2 },
    });
    await expect(bodyOnly).resolves.toBe(false);
    expect(await getStoryById(storyId, 1)).toMatchObject({
      body: { _revision: 2, marker: "aggregate-wins" },
    });
  });

  it("queues isolated snapshots without overwriting another Story's successful write", async () => {
    const aggregateStory = await seedAggregate(1, "aggregate-queued");
    const otherStory = await seedAggregate(1, "other-queued");
    const diskGate = blockNextPersistenceWrite();
    const otherWrite = updateStoryBodyIfRevision({
      id: otherStory.storyId,
      userId: 1,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], marker: "other-after" },
    });
    await diskGate.started;

    const aggregateWrite = updateStoryAndTimelineAtomic({
      storyId: aggregateStory.storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: {
        _revision: 2,
        shots: [],
        marker: "aggregate-after",
      },
      nextTimeline: { items: [], overlays: [] },
    });
    diskGate.release();
    await expect(otherWrite).resolves.toBe(true);
    await expect(aggregateWrite).resolves.toMatchObject({
      story: { body: { marker: "aggregate-after" } },
      timeline: { version: 2 },
    });

    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
    ) as {
      stories: Array<{ id: number; body: { marker: string } }>;
      storyTimelines: Array<{ storyId: number; version: number }>;
    };
    expect(
      disk.stories.find(row => row.id === otherStory.storyId)?.body
    ).toMatchObject({ marker: "other-after" });
    expect(
      disk.stories.find(row => row.id === aggregateStory.storyId)?.body
    ).toMatchObject({ marker: "aggregate-after" });
    expect(
      disk.storyTimelines.find(row => row.storyId === aggregateStory.storyId)
        ?.version
    ).toBe(2);
  });

  it("never captures another Story's tentative body after that write rolls back", async () => {
    const aggregateStory = await seedAggregate(1, "aggregate-after-failure");
    const failingStory = await seedAggregate(1, "failing-body");
    const diskGate = failNextPersistenceWriteAfterGate();
    const failingWrite = updateStoryBodyIfRevision({
      id: failingStory.storyId,
      userId: 1,
      expectedRevision: 1,
      body: { _revision: 2, shots: [], marker: "failed-tentative" },
    });
    await diskGate.started;

    const aggregateWrite = updateStoryAndTimelineAtomic({
      storyId: aggregateStory.storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: {
        _revision: 2,
        shots: [],
        marker: "aggregate-after",
      },
      nextTimeline: { items: [], overlays: [] },
    });
    diskGate.release();

    await expect(failingWrite).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    await expect(aggregateWrite).resolves.toMatchObject({
      story: { body: { marker: "aggregate-after" } },
      timeline: { version: 2 },
    });
    expect(await getStoryById(failingStory.storyId, 1)).toMatchObject({
      body: { _revision: 1, marker: "before" },
    });

    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
    ) as { stories: Array<{ id: number; body: { marker: string } }> };
    expect(
      disk.stories.find(row => row.id === failingStory.storyId)?.body
    ).toMatchObject({ marker: "before" });
    expect(
      disk.stories.find(row => row.id === aggregateStory.storyId)?.body
    ).toMatchObject({ marker: "aggregate-after" });
  });

  it("keeps insert Story, Timeline, disk, and next timeline id unchanged when persistence fails", async () => {
    const story = await createStory({
      userId: 1,
      title: "failed transition insert",
      body: {
        _revision: 1,
        shots: [{ stableShotId: "left" }],
      },
    });
    const beforeDisk = await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8");
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("insert disk full"));
    const command = {
      storyId: story.id,
      userId: 1,
      stableShotId: "inserted",
      expectedStoryRevision: 1,
      expectedTimelineVersion: 0,
      nextStoryBody: {
        _revision: 2,
        shots: [{ stableShotId: "left" }, { stableShotId: "inserted" }],
      },
      nextTimelineItems: [
        { stableShotId: "left", position: 0 },
        { stableShotId: "inserted", position: 1 },
      ],
    };

    await expect(insertTransitionShotAtomic(command)).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: { _revision: 1, shots: [{ stableShotId: "left" }] },
    });
    expect(await getStoryTimeline(story.id, 1)).toBeNull();
    expect(await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")).toBe(
      beforeDisk
    );

    const retried = await insertTransitionShotAtomic(command);
    expect(retried.timeline.id).toBe(1);
  });

  it("keeps split restore memory and disk unchanged when persistence fails", async () => {
    const story = await createStory({
      userId: 1,
      title: "failed split restore",
      body: {
        _revision: 2,
        shots: [{ stableShotId: "left" }, { stableShotId: "split-right" }],
      },
    });
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [
        { stableShotId: "left", position: 0 },
        { stableShotId: "split-right", position: 1 },
      ],
      overlays: [{ id: "must-survive" }],
    });
    const beforeDisk = await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8");
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("restore disk full"));

    await expect(
      restoreSplitStoryShotAtomic({
        storyId: story.id,
        userId: 1,
        splitStableShotId: "split-right",
        expectedStoryRevision: 2,
        expectedTimelineVersion: 1,
        nextStoryBody: {
          _revision: 3,
          shots: [{ stableShotId: "left" }],
        },
        nextTimelineItems: [{ stableShotId: "left", position: 0 }],
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: { _revision: 2, shots: [{}, { stableShotId: "split-right" }] },
    });
    expect(await getStoryTimeline(story.id, 1)).toMatchObject({
      version: 1,
      items: expect.arrayContaining([
        expect.objectContaining({ stableShotId: "split-right" }),
      ]),
      overlays: [{ id: "must-survive" }],
    });
    expect(await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")).toBe(
      beforeDisk
    );
  });

  it("does not carry a failed legacy aggregate into another Story's successful snapshot", async () => {
    const failing = await createStory({
      userId: 1,
      title: "legacy aggregate fails",
      body: { _revision: 1, shots: [{ stableShotId: "left" }] },
    });
    const succeeding = await seedAggregate(1, "after-legacy-failure");
    const diskGate = failNextPersistenceWriteAfterGate();
    const legacyWrite = insertTransitionShotAtomic({
      storyId: failing.id,
      userId: 1,
      stableShotId: "must-not-land",
      expectedStoryRevision: 1,
      expectedTimelineVersion: 0,
      nextStoryBody: {
        _revision: 2,
        shots: [{ stableShotId: "left" }, { stableShotId: "must-not-land" }],
      },
      nextTimelineItems: [{ stableShotId: "must-not-land", position: 0 }],
    });
    await diskGate.started;
    const succeedingWrite = updateStoryAndTimelineAtomic({
      storyId: succeeding.storyId,
      userId: 1,
      expectedStoryRevision: 1,
      expectedTimelineVersion: 1,
      nextStoryBody: {
        _revision: 2,
        shots: [],
        marker: "successful-after-legacy-failure",
      },
      nextTimeline: { items: [], overlays: [] },
    });
    diskGate.release();

    await expect(legacyWrite).rejects.toMatchObject({
      name: "LocalPersistenceWriteError",
    });
    await expect(succeedingWrite).resolves.toMatchObject({
      story: { body: { marker: "successful-after-legacy-failure" } },
    });
    expect(await getStoryById(failing.id, 1)).toMatchObject({
      body: { _revision: 1, shots: [{ stableShotId: "left" }] },
    });
    expect(await getStoryTimeline(failing.id, 1)).toBeNull();

    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
    ) as {
      stories: Array<{
        id: number;
        body: { marker?: string; _revision: number };
      }>;
      storyTimelines: Array<{ storyId: number }>;
    };
    expect(disk.stories.find(row => row.id === failing.id)?.body).toMatchObject(
      {
        _revision: 1,
      }
    );
    expect(disk.storyTimelines.some(row => row.storyId === failing.id)).toBe(
      false
    );
    expect(
      disk.stories.find(row => row.id === succeeding.storyId)?.body
    ).toMatchObject({ marker: "successful-after-legacy-failure" });
  });
});
