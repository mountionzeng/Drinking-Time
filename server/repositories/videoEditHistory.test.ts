import { beforeEach, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
import { writeFile } from "node:fs/promises";
import {
  createStory,
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryAndTimelineAtomic,
  updateStoryTimeline,
} from "../db";
import { readVideoEditHistory } from "../../shared/videoEditHistory";
import {
  moveShotSingleForStory,
  undoVisualEditForStory,
} from "../services/visualClipEditing";

beforeEach(() => {
  resetMemoryStateForTesting();
  vi.mocked(writeFile).mockClear();
});
async function seed() {
  const story = await createStory({
    userId: 1,
    title: "isolated revision fixture",
    body: { _revision: 1, shots: [{ stableShotId: "a", dialogue: "原台词" }] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: 1,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "a",
        included: true,
        position: 0,
        timelineStartFrame: 0,
        durationFrames: 90,
        imageId: 7,
      },
    ],
    extensions: { audioTracks: { keep: true } },
  });
  return story.id;
}
const items = [
  { stableShotId: "a", position: 0, timelineStartFrame: 90, imageId: 7 },
];
it("commits one editing revision with a move; stale CAS cannot duplicate it", async () => {
  const storyId = await seed();
  const input = {
    storyId,
    userId: 1,
    expectedVersion: 1,
    items,
    recordVideoRevision: true,
  };
  const changed = await updateStoryTimeline(input);
  expect(
    readVideoEditHistory(changed.extensions?.videoEditHistory).map(
      entry => entry.version
    )
  ).toEqual([1, 2]);
  await expect(updateStoryTimeline(input)).rejects.toThrow("版本");
  expect(await getStoryTimeline(storyId, 1)).toEqual(changed);
  expect(changed.extensions?.audioTracks).toEqual({ keep: true });
});
it("failed durable timeline save rolls back both contents and revision", async () => {
  const storyId = await seed();
  const before = await getStoryTimeline(storyId, 1);
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
  await expect(
    updateStoryTimeline({
      storyId,
      userId: 1,
      expectedVersion: 1,
      items,
      recordVideoRevision: true,
    })
  ).rejects.toThrow("disk full");
  expect(await getStoryTimeline(storyId, 1)).toEqual(before);
});
it("does not advance the timeline or snapshot on an identical legacy save", async () => {
  const storyId = await seed();
  const before = (await getStoryTimeline(storyId, 1))!;
  const result = await updateStoryTimeline({
    storyId,
    userId: 1,
    expectedVersion: before.version,
    items: before.items,
    recordVideoRevision: true,
  });
  expect(result).toEqual(before);
  expect(result.extensions?.videoEditHistory).toBeUndefined();
});
it("split/delete aggregate snapshots retain old shot identities and publish atomically", async () => {
  const storyId = await seed();
  const input = {
    storyId,
    userId: 1,
    expectedStoryRevision: 1,
    expectedTimelineVersion: 1,
    recordVideoRevision: true,
    nextStoryBody: {
      _revision: 2,
      shots: [{ stableShotId: "b", dialogue: "新镜头" }],
    },
    nextTimeline: { items: [{ stableShotId: "b", position: 0 }] },
  };
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
  await expect(updateStoryAndTimelineAtomic(input)).rejects.toThrow(
    "disk full"
  );
  expect((await getStoryById(storyId, 1))?.body).toMatchObject({
    _revision: 1,
  });
  expect((await getStoryTimeline(storyId, 1))?.version).toBe(1);
  const result = await updateStoryAndTimelineAtomic(input);
  const history = readVideoEditHistory(
    result.timeline.extensions?.videoEditHistory
  );
  expect(history[0].shots[0].stableShotId).toBe("a");
  expect(history[1].shots[0].stableShotId).toBe("b");
  expect(history[1].timeline.extensions?.audioTracks).toEqual({ keep: true });
});
it("does not let a different owner create a revision", async () => {
  const storyId = await seed();
  await expect(
    updateStoryTimeline({
      storyId,
      userId: 2,
      expectedVersion: 0,
      items,
      recordVideoRevision: true,
    })
  ).rejects.toThrow("无权");
  expect(await getStoryTimeline(storyId, 2)).toBeNull();
});
it("records a real editing command and undo, but not a rejected zero movement", async () => {
  const storyId = await seed();
  const command = {
    storyId,
    userId: 1,
    stableShotId: "a",
    deltaFrames: 90,
    snapThresholdFrames: 0,
  };
  expect(await moveShotSingleForStory(command)).toMatchObject({
    status: "ok",
    changed: true,
  });
  const changed = await getStoryTimeline(storyId, 1);
  expect(
    readVideoEditHistory(changed?.extensions?.videoEditHistory)
  ).toHaveLength(2);
  expect(
    await moveShotSingleForStory({ ...command, deltaFrames: 0 })
  ).toMatchObject({ status: "error" });
  expect(await getStoryTimeline(storyId, 1)).toEqual(changed);
  expect(await undoVisualEditForStory({ storyId, userId: 1 })).toMatchObject({
    status: "ok",
  });
  const undone = await getStoryTimeline(storyId, 1);
  expect(
    readVideoEditHistory(undone?.extensions?.videoEditHistory).map(
      entry => entry.version
    )
  ).toEqual([1, 2, 3]);
});
