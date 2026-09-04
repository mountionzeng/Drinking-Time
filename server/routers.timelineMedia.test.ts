import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import {
  createStory,
  createStoryAudioAssetRow,
  getStoryTimeline,
  listStoryAudioAssetRows,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "./db";
import { appRouter } from "./routers";
import { clearVisualEditUndoForTesting } from "./services/visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./services/visualEditSessionRegistry";

const savedDatabaseUrl = ENV.databaseUrl;

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `timeline-media-${userId}`,
      email: `timeline-media-${userId}@example.com`,
      name: `Timeline Media ${userId}`,
      loginMethod: "test",
      role: "user",
      sessionVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

async function seedStory(userId: number): Promise<number> {
  const story = await createStory({
    userId,
    title: "subtitle router",
    body: { _revision: 1, shots: [{ stableShotId: "shot-a", shotNo: 1 }] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId,
    expectedVersion: 0,
    items: [{ stableShotId: "shot-a", included: true, position: 0 }],
  });
  return story.id;
}

async function cues(storyId: number, userId: number) {
  const row = (await getStoryTimeline(storyId, userId)) as {
    extensions?: {
      subtitleTracks?: {
        tracks: {
          cues: Array<{ id: string; text: string; textRevision: number }>;
        }[];
      };
    };
  } | null;
  return row?.extensions?.subtitleTracks?.tracks?.[0]?.cues ?? [];
}

function silentWavBase64(): string {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const dataSize = sampleCount * 2;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes.toString("base64");
}

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
});

describe("timelineMedia router", () => {
  it("initializes and edits a subtitle cue through narrow input, without expectedVersion", async () => {
    const caller = appRouter.createCaller(context(701));
    const storyId = await seedStory(701);

    const init = await caller.timelineMedia.initializeSubtitles({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "第一句",
          provenance: { kind: "shot-dialogue", stableShotId: "shot-a" },
          sourceTextRevision: 1,
        },
      ],
    });
    expect(init).toMatchObject({ status: "ok", changed: true });

    const [cue] = await cues(storyId, 701);
    const edit = await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-edit" },
      cueId: cue.id,
      text: "改过的第一句",
      expectedTextRevision: cue.textRevision,
    });
    expect(edit).toMatchObject({ status: "ok", changed: true });
    expect((await cues(storyId, 701))[0].text).toBe("改过的第一句");
  });

  it("rejects a cross-Story cue id", async () => {
    const owner = appRouter.createCaller(context(702));
    const intruder = appRouter.createCaller(context(703));
    const ownerStory = await seedStory(702);
    const intruderStory = await seedStory(703);

    await owner.timelineMedia.initializeSubtitles({
      storyId: ownerStory,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "秘密",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    const [ownerCue] = await cues(ownerStory, 702);

    const stolen = await intruder.timelineMedia.editSubtitleText({
      storyId: intruderStory,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-steal" },
      cueId: ownerCue.id,
      text: "改别人的",
      expectedTextRevision: ownerCue.textRevision,
    });
    expect(stolen).toMatchObject({ status: "error" });
    expect(await cues(ownerStory, 702)).toMatchObject([{ text: "秘密" }]);
  });

  it("undoes the newest media edit", async () => {
    const caller = appRouter.createCaller(context(704));
    const storyId = await seedStory(704);
    await caller.timelineMedia.initializeSubtitles({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "第一句",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    const [cue] = await cues(storyId, 704);
    await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-edit" },
      cueId: cue.id,
      text: "编辑后",
      expectedTextRevision: cue.textRevision,
    });

    const undo = await caller.timelineMedia.undoLatestMediaEdit({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-undo" },
    });
    expect(undo).toMatchObject({ status: "ok", changed: true });
    expect((await cues(storyId, 704))[0].text).toBe("第一句");
  });

  it("replays a repeated operation id without a second write", async () => {
    const caller = appRouter.createCaller(context(705));
    const storyId = await seedStory(705);
    await caller.timelineMedia.initializeSubtitles({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "第一句",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    const [cue] = await cues(storyId, 705);
    const op = { editorSessionEpoch: "tab-a", operationId: "op-edit-once" };
    const first = await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: op,
      cueId: cue.id,
      text: "只写一次",
      expectedTextRevision: cue.textRevision,
    });
    const replay = await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: op,
      cueId: cue.id,
      text: "只写一次",
      expectedTextRevision: cue.textRevision,
    });
    expect(first).toMatchObject({ status: "ok", changed: true });
    expect(replay).toMatchObject({
      status: "ok",
      timelineVersion: (first as { timelineVersion: number }).timelineVersion,
    });
  });
  it("inserts + moves an audio clip through narrow input, and rejects a full-array field at the type level", async () => {
    const caller = appRouter.createCaller(context(710));
    const storyId = await seedStory(710);
    const asset = await createStoryAudioAssetRow({
      storyId,
      userId: 710,
      storageKey: "a".repeat(32),
      displayName: "bg.mp3",
      sourceKind: "local-upload",
      status: "ready",
      durationFrames: 300,
    });

    const inserted = await caller.timelineMedia.insertAudioClip({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-ins" },
      kind: "music",
      assetId: asset.id,
      timelineStartFrame: 30,
    });
    expect(inserted).toMatchObject({ status: "ok", changed: true });

    const row = (await getStoryTimeline(storyId, 710)) as {
      extensions?: {
        audioTracks?: {
          tracks: { kind: string; clips: Array<{ id: string }> }[];
        };
      };
    } | null;
    const clipId = row!.extensions!.audioTracks!.tracks.find(
      t => t.kind === "music"
    )!.clips[0].id;

    const moved = await caller.timelineMedia.moveAudioClip({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-mv" },
      clipId,
      toStartFrame: 90,
    });
    expect(moved).toMatchObject({ status: "ok", changed: true });
  });

  it("rejects inserting a clip that points at another Story's asset", async () => {
    const a = appRouter.createCaller(context(711));
    const b = appRouter.createCaller(context(712));
    const storyA = await seedStory(711);
    const storyB = await seedStory(712);
    const assetInA = await createStoryAudioAssetRow({
      storyId: storyA,
      userId: 711,
      storageKey: "b".repeat(32),
      displayName: "a.mp3",
      sourceKind: "local-upload",
      status: "ready",
      durationFrames: 100,
    });
    void a;
    const stolen = await b.timelineMedia.insertAudioClip({
      storyId: storyB,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-steal" },
      kind: "music",
      assetId: assetInA.id,
      timelineStartFrame: 0,
    });
    expect(stolen).toMatchObject({ status: "error" });
  });

  it("imports local bytes into the selected media kind without accepting a path or cross-Story scope", async () => {
    const audioDir = await mkdtemp(
      path.join(os.tmpdir(), "timeline-router-audio-")
    );
    const previousAudioDir = process.env.LOCAL_AUDIO_DIR;
    process.env.LOCAL_AUDIO_DIR = audioDir;
    try {
      const owner = appRouter.createCaller(context(713));
      const intruder = appRouter.createCaller(context(714));
      const storyId = await seedStory(713);
      const imported = await owner.timelineMedia.importLocalAudio({
        storyId,
        operation: { editorSessionEpoch: "tab-a", operationId: "op-upload" },
        fileName: "forest.wav",
        mimeType: "audio/wav",
        fileBase64: silentWavBase64(),
        mediaKind: "ambience",
      });
      expect(imported).toMatchObject({ status: "ok", reused: false });
      expect(
        await listStoryAudioAssetRows({ storyId, userId: 713 })
      ).toMatchObject([
        {
          id: (imported as { assetId: number }).assetId,
          mediaKind: "ambience",
          status: "ready",
        },
      ]);

      const forged = await intruder.timelineMedia.importLocalAudio({
        storyId,
        operation: { editorSessionEpoch: "tab-b", operationId: "op-forged" },
        fileName: "forged.wav",
        fileBase64: silentWavBase64(),
        mediaKind: "music",
      });
      expect(forged).toMatchObject({
        status: "error",
        failureCode: "story-not-found",
      });
      expect(await listStoryAudioAssetRows({ storyId, userId: 714 })).toEqual(
        []
      );
    } finally {
      if (previousAudioDir === undefined) delete process.env.LOCAL_AUDIO_DIR;
      else process.env.LOCAL_AUDIO_DIR = previousAudioDir;
      await rm(audioDir, { recursive: true, force: true });
    }
  });
});

afterAll(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});
