import { readFile, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

import {
  applyGeneratedVisualShotAtomic,
  createStory,
  createVideoTake,
  getStoryById,
  getStoryTimeline,
  getVideoTakeById,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "./db";

const passthroughWriteFile = vi.mocked(writeFile).getMockImplementation()!;

async function seedGeneratedVisualShotAggregate() {
  const story = await createStory({
    userId: 1,
    title: "ordinary generated visual shot",
    body: { _revision: 0, shots: [{ shotNo: 1, stableShotId: "shot-a" }] },
  });
  const legacyOverlay = {
    id: "legacy-overlay",
    kind: "generated-video" as const,
    takeId: 999,
    sourceStableShotId: "legacy-shot",
    videoUrl: "/api/videos/legacy.mp4",
    startFrame: 0,
    targetEndFrame: 30,
    mediaEndFrame: 30,
    endFrame: 30,
    stackOrder: 2,
    visualLayer: 1,
    leftImageId: 7,
    rightImageId: 8,
    transform: {},
  };
  const timeline = await updateStoryTimeline({
    storyId: story.id,
    userId: 1,
    expectedVersion: 0,
    items: [{ stableShotId: "shot-a", included: true, position: 0, visualLayer: 0 }],
    overlays: [legacyOverlay],
    visualLayerState: { count: 3, hidden: [1] },
  });
  const take = await createVideoTake({
    storyId: story.id,
    userId: 1,
    stableShotId: "generated-shot",
    sourceImageId: 10,
    status: "available",
    provider: "302",
    model: "viduq2-turbo",
    prompt: "ordinary generated shot",
    durationSec: 3,
    aspectRatio: "1:1",
    videoUrl: "/api/videos/generated.mp4",
    extractionCapability: "available",
    parameterSnapshot: { appliedToTimeline: false },
  });
  return { story, timeline, take, legacyOverlay };
}

function applyInput(seed: Awaited<ReturnType<typeof seedGeneratedVisualShotAggregate>>) {
  return {
    storyId: seed.story.id,
    userId: 1,
    takeId: seed.take.id,
    stableShotId: "generated-shot",
    expectedStoryRevision: 0,
    expectedVersion: seed.timeline.version,
    nextStoryBody: {
      _revision: 1,
      shots: [
        { shotNo: 1, stableShotId: "shot-a" },
        { shotNo: 2, stableShotId: "generated-shot" },
      ],
    },
    nextTimelineItems: [
      { stableShotId: "shot-a", included: true, position: 0, visualLayer: 0 },
      { stableShotId: "generated-shot", included: true, position: 1, visualLayer: 2 },
    ],
    // Simulate the layer planner inserting a visible layer below the hidden
    // one: existing compatibility overlays and hidden indices move together.
    nextTimelineOverlays: [{ ...seed.legacyOverlay, visualLayer: 2 }],
    nextVisualLayerState: { count: 4, hidden: [2] },
  };
}

describe("applyGeneratedVisualShotAtomic", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    vi.mocked(writeFile).mockReset();
    vi.mocked(writeFile).mockImplementation(passthroughWriteFile);
  });

  it("publishes Story, Timeline and Take together without adding an overlay", async () => {
    const seed = await seedGeneratedVisualShotAggregate();
    const applied = await applyGeneratedVisualShotAtomic(applyInput(seed));

    expect(applied.applied).toBe(true);
    expect(applied.story.body).toMatchObject({
      _revision: 1,
      shots: expect.arrayContaining([
        expect.objectContaining({ stableShotId: "generated-shot" }),
      ]),
    });
    expect(applied.timeline).toMatchObject({
      version: 2,
      overlays: [{ id: "legacy-overlay", visualLayer: 2 }],
      visualLayerState: { count: 4, hidden: [2] },
    });
    expect(applied.timeline.overlays as unknown[]).toHaveLength(1);
    expect(applied.take.parameterSnapshot).toMatchObject({
      appliedToTimeline: true,
    });
    expect(applied.take.parameterSnapshot).not.toHaveProperty("overlayId");
  });

  it("is idempotent after the ordinary shot, item and marker all exist", async () => {
    const seed = await seedGeneratedVisualShotAggregate();
    const input = applyInput(seed);
    const first = await applyGeneratedVisualShotAtomic(input);
    const repeated = await applyGeneratedVisualShotAtomic(input);

    expect(first.applied).toBe(true);
    expect(repeated.applied).toBe(false);
    expect((repeated.timeline.items as Array<{ stableShotId: string }>).filter(
      item => item.stableShotId === "generated-shot"
    )).toHaveLength(1);
    expect(repeated.timeline.overlays as unknown[]).toHaveLength(1);
    expect(repeated.timeline.version).toBe(first.timeline.version);
  });

  it("publishes none of Story, Timeline or Take when durable persistence fails", async () => {
    const seed = await seedGeneratedVisualShotAggregate();
    const persistPath = process.env.LOCAL_PERSIST_PATH!;
    const beforeDisk = await readFile(persistPath, "utf8");
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("generated shot disk full"));

    await expect(
      applyGeneratedVisualShotAtomic(applyInput(seed))
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });

    expect(await getStoryById(seed.story.id, 1)).toMatchObject({
      body: { _revision: 0, shots: [{ stableShotId: "shot-a" }] },
    });
    expect(await getStoryTimeline(seed.story.id, 1)).toMatchObject({
      version: 1,
      overlays: [{ id: "legacy-overlay", visualLayer: 1 }],
      visualLayerState: { count: 3, hidden: [1] },
    });
    expect(await getVideoTakeById(seed.take.id, 1)).toMatchObject({
      parameterSnapshot: { appliedToTimeline: false },
    });
    expect(await readFile(persistPath, "utf8")).toBe(beforeDisk);
  });
});
