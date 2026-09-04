import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmp: string;
const prevAudioDir = process.env.LOCAL_AUDIO_DIR;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dt-audio-assets-"));
  process.env.LOCAL_AUDIO_DIR = path.join(tmp, "audio");
});
afterAll(async () => {
  if (prevAudioDir === undefined) delete process.env.LOCAL_AUDIO_DIR;
  else process.env.LOCAL_AUDIO_DIR = prevAudioDir;
  await rm(tmp, { recursive: true, force: true });
});

const db = () => import("../db");
const svc = () => import("./storyAudioAssets");

async function seedStory(userId = 1): Promise<number> {
  const { createStory } = await db();
  const story = await createStory({
    userId,
    title: "assets",
    body: { _revision: 1, shots: [] },
  });
  return story.id;
}

beforeEach(async () => {
  const { resetMemoryStateForTesting } = await db();
  resetMemoryStateForTesting();
});

describe("storyAudioAssets service", () => {
  it("gates Timeline reads on `ready` status", async () => {
    const storyId = await seedStory();
    const { createPendingStoryAudioAsset, loadReadyStoryAudioAsset, markStoryAudioAssetReady } =
      await svc();
    const pending = await createPendingStoryAudioAsset({
      scope: { storyId, userId: 1 },
      storageKey: "cccccccccccccccccccccccccccccccc",
      displayName: "clip",
      sourceKind: "chatcut",
      sourceKey: "clip-1",
    });
    expect(
      await loadReadyStoryAudioAsset({
        scope: { storyId, userId: 1 },
        assetId: pending.id,
      })
    ).toBeNull();

    await markStoryAudioAssetReady({
      scope: { storyId, userId: 1 },
      assetId: pending.id,
      checksum: "d".repeat(64),
      probe: {
        durationSeconds: 2,
        durationFrames: 60,
        sampleRate: 44100,
        channels: 2,
        codecName: "mp3",
        formatName: "mp3",
      },
    });
    const ready = await loadReadyStoryAudioAsset({
      scope: { storyId, userId: 1 },
      assetId: pending.id,
    });
    expect(ready).toMatchObject({ status: "ready", durationFrames: 60 });
  });

  it("reuses a ready asset within a Story by (sourceKind, sourceKey) but never across Stories", async () => {
    const storyA = await seedStory(1);
    const storyB = await seedStory(1);
    const {
      createPendingStoryAudioAsset,
      markStoryAudioAssetReady,
      findReusableReadyStoryAudioAsset,
    } = await svc();
    const asset = await createPendingStoryAudioAsset({
      scope: { storyId: storyA, userId: 1 },
      storageKey: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0",
      displayName: "voice",
      sourceKind: "tts",
      sourceKey: "tts-op-123",
    });
    await markStoryAudioAssetReady({
      scope: { storyId: storyA, userId: 1 },
      assetId: asset.id,
      checksum: "f".repeat(64),
      probe: {
        durationSeconds: 1,
        durationFrames: 30,
        sampleRate: 24000,
        channels: 1,
        codecName: "aac",
        formatName: "mp4",
      },
    });

    expect(
      await findReusableReadyStoryAudioAsset({
        scope: { storyId: storyA, userId: 1 },
        sourceKind: "tts",
        sourceKey: "tts-op-123",
      })
    ).toMatchObject({ id: asset.id });
    expect(
      await findReusableReadyStoryAudioAsset({
        scope: { storyId: storyB, userId: 1 },
        sourceKind: "tts",
        sourceKey: "tts-op-123",
      })
    ).toBeNull();
  });

  it("markStoryAudioAssetFailed refuses a cross-user id", async () => {
    const storyId = await seedStory(1);
    const { createPendingStoryAudioAsset, markStoryAudioAssetFailed, loadOwnedStoryAudioAsset } =
      await svc();
    const asset = await createPendingStoryAudioAsset({
      scope: { storyId, userId: 1 },
      storageKey: "11111111111111111111111111111111",
      displayName: "x",
      sourceKind: "local-upload",
    });
    expect(
      await markStoryAudioAssetFailed({
        scope: { storyId, userId: 2 },
        assetId: asset.id,
        reason: "nope",
      })
    ).toBeNull();
    expect(
      (await loadOwnedStoryAudioAsset({ scope: { storyId, userId: 1 }, assetId: asset.id }))
        ?.status
    ).toBe("pending");
  });
});
