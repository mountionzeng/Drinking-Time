import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as legacy from "../db";
import { createProject } from "./projects";
import { createStory, getStoryById } from "./stories";
import { deleteStory } from "./storyLifecycle";
import { updateStoryTimeline } from "./timelines";
import {
  getStoryTimeline,
  getStoryById as loadSoundStory,
} from "../persistence/storySoundPersistence";

describe("repository and legacy callers share one local runtime", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    legacy.resetMemoryStateForTesting();
  });

  it("shares ownership, ids, Timeline and deletion across entry points", async () => {
    const project = await createProject({
      userId: 17,
      name: "isolated repository test",
    });
    const first = await legacy.createStory({
      userId: 17,
      projectId: project.id,
      title: "first",
      body: {},
    });
    const second = await createStory({
      userId: 17,
      projectId: project.id,
      title: "second",
      body: {},
    });
    expect(second.id).toBe(first.id + 1);
    expect(await loadSoundStory(first.id, 17)).toMatchObject({
      title: "first",
    });
    expect(await legacy.getStoryById(second.id, 17)).toMatchObject({
      title: "second",
    });
    expect(await getStoryById(first.id, 18)).toBeNull();

    await updateStoryTimeline({
      storyId: first.id,
      userId: 17,
      expectedVersion: 0,
      items: [],
    });
    expect(await getStoryTimeline(first.id, 17)).toMatchObject({
      version: 1,
      items: [],
    });
    await expect(
      legacy.updateStoryTimeline({
        storyId: first.id,
        userId: 17,
        expectedVersion: 0,
        items: [],
      })
    ).rejects.toThrow();

    await deleteStory(first.id, 17);
    expect(await legacy.getStoryById(first.id, 17)).toBeNull();
    expect(await getStoryTimeline(first.id, 17)).toBeNull();
    expect(await getStoryById(second.id, 17)).not.toBeNull();
  });

  it("does not leak internal state or duplicate the exported functions", () => {
    expect(legacy.createStory).toBe(createStory);
    expect(legacy.updateStoryTimeline).toBe(updateStoryTimeline);
    expect(legacy.getStoryById).toBe(loadSoundStory);
    expect(legacy).not.toHaveProperty("memoryState");
    expect(legacy).not.toHaveProperty("transientState");
  });
});
