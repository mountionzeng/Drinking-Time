import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  createStoryAudioAssetRow,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import {
  bindSpeechForStory,
  deleteAudioClipForStory,
  insertAudioClipForStory,
  moveAudioClipForStory,
  moveBoundSpeechForStory,
  reclassifyAudioClipForStory,
  setAudioClipGainForStory,
  trimAudioClipForStory,
  undoLatestTimelineMediaEditForStory,
  unbindSpeechForStory,
} from "./timelineAudioEditing";
import {
  editSubtitleTextForStory,
  initializeSubtitlesForStory,
} from "./timelineSubtitleEditing";

const USER_ID = 1;
const EPOCH = "tab-a";
let opCounter = 0;
const nextOp = () => ({
  editorSessionEpoch: EPOCH,
  operationId: `op-${++opCounter}`,
});

async function seedStory(): Promise<number> {
  const story = await createStory({
    userId: USER_ID,
    title: "audio-edit",
    body: { _revision: 1, shots: [] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: [],
    visualLayerState: { count: 1, hidden: [] },
  });
  return story.id;
}

async function seedReadyAsset(
  storyId: number,
  durationFrames = 300
): Promise<number> {
  const asset = await createStoryAudioAssetRow({
    storyId,
    userId: USER_ID,
    storageKey: "a".repeat(32),
    displayName: "music.mp3",
    sourceKind: "local-upload",
    status: "ready",
    durationFrames,
    durationSeconds: durationFrames / 30,
    sampleRate: 44100,
    channels: 2,
    checksum: "c".repeat(64),
  });
  return asset.id;
}

async function audioState(storyId: number) {
  const row = (await getStoryTimeline(storyId, USER_ID)) as {
    extensions?: { audioTracks?: { tracks: { kind: string; clips: unknown[] }[] } };
  } | null;
  return row?.extensions?.audioTracks ?? null;
}
async function subtitleCues(storyId: number) {
  const row = (await getStoryTimeline(storyId, USER_ID)) as {
    extensions?: { subtitleTracks?: { tracks: { cues: Array<{ id: string; textRevision: number; speechBindingId?: string }> }[] } };
  } | null;
  return row?.extensions?.subtitleTracks?.tracks?.[0]?.cues ?? [];
}
async function narrationClips(storyId: number) {
  const state = await audioState(storyId);
  return (
    (state?.tracks.find(t => t.kind === "narration")?.clips as Array<{
      id: string;
      timelineStartFrame: number;
      textStale?: boolean;
      speechBindingId?: string;
    }>) ?? []
  );
}
async function version(storyId: number) {
  const row = await getStoryTimeline(storyId, USER_ID);
  return (row as { version: number }).version;
}

beforeEach(() => {
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
  opCounter = 0;
});

describe("timelineAudioEditing", () => {
  it("insert requires a ready, owned asset and defaults the source range to the asset length", async () => {
    const storyId = await seedStory();
    const assetId = await seedReadyAsset(storyId, 300);

    const denied = await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "music",
      assetId: 999999,
      timelineStartFrame: 0,
    });
    expect(denied).toMatchObject({ status: "error", errorKind: "invalid" });

    const inserted = await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "music",
      assetId,
      timelineStartFrame: 30,
    });
    expect(inserted).toMatchObject({ status: "ok", changed: true });
    const state = await audioState(storyId);
    const clip = state!.tracks.find(t => t.kind === "music")!.clips[0] as {
      sourceInFrame: number;
      sourceOutFrame: number;
      durationFrames: number;
      timelineStartFrame: number;
    };
    expect(clip).toMatchObject({
      sourceInFrame: 0,
      sourceOutFrame: 300,
      durationFrames: 300,
      timelineStartFrame: 30,
    });
  });

  it("move / trim / gain / reclassify / delete each bump the version once; no-op returns changed:false", async () => {
    const storyId = await seedStory();
    const assetId = await seedReadyAsset(storyId);
    await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "music",
      assetId,
      timelineStartFrame: 0,
    });
    let v = await version(storyId);
    const clipId = ((await audioState(storyId))!.tracks.find(
      t => t.kind === "music"
    )!.clips[0] as { id: string }).id;

    for (const run of [
      () =>
        moveAudioClipForStory({
          storyId,
          userId: USER_ID,
          operation: nextOp(),
          clipId,
          toStartFrame: 45,
        }),
      () =>
        trimAudioClipForStory({
          storyId,
          userId: USER_ID,
          operation: nextOp(),
          clipId,
          edge: "end",
          deltaFrames: -30,
        }),
      () =>
        setAudioClipGainForStory({
          storyId,
          userId: USER_ID,
          operation: nextOp(),
          clipId,
          gain: 0.18,
        }),
      () =>
        reclassifyAudioClipForStory({
          storyId,
          userId: USER_ID,
          operation: nextOp(),
          clipId,
          toKind: "ambience",
        }),
    ]) {
      const result = await run();
      expect(result).toMatchObject({ status: "ok", changed: true, timelineVersion: v + 1 });
      v += 1;
    }

    const noop = await moveAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      clipId,
      toStartFrame: 45,
    });
    expect(noop).toMatchObject({ status: "ok", changed: false, timelineVersion: v });

    const deleted = await deleteAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      clipId,
    });
    expect(deleted).toMatchObject({ status: "ok", timelineVersion: v + 1 });
  });

  it("no-speed invariant: trim-left syncs sourceIn and shifts start; the source range is never stretched by a move", async () => {
    const storyId = await seedStory();
    const assetId = await seedReadyAsset(storyId, 300);
    await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "music",
      assetId,
      timelineStartFrame: 60,
    });
    const clipId = ((await audioState(storyId))!.tracks.find(
      t => t.kind === "music"
    )!.clips[0] as { id: string }).id;
    await trimAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      clipId,
      edge: "start",
      deltaFrames: 40,
    });
    await moveAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      clipId,
      toStartFrame: 200,
    });
    const clip = (await audioState(storyId))!.tracks.find(
      t => t.kind === "music"
    )!.clips[0] as {
      sourceInFrame: number;
      sourceOutFrame: number;
      durationFrames: number;
      timelineStartFrame: number;
    };
    expect(clip).toMatchObject({
      sourceInFrame: 40,
      sourceOutFrame: 300,
      durationFrames: 260,
      timelineStartFrame: 200,
    });

    const beforeRejectedTrim = await version(storyId);
    const beyondAsset = await trimAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      clipId,
      edge: "end",
      deltaFrames: 1,
    });
    expect(beyondAsset).toMatchObject({ status: "error", errorKind: "invalid" });
    expect(await version(storyId)).toBe(beforeRejectedTrim);
    expect(
      (await audioState(storyId))!.tracks.find(t => t.kind === "music")!.clips[0]
    ).toMatchObject({ sourceOutFrame: 300, durationFrames: 260 });
  });

  it("binding: bind then move-bound shifts both cue and narration by the same delta; a partner out of bounds fails whole", async () => {
    const storyId = await seedStory();
    const assetId = await seedReadyAsset(storyId, 90);
    await initializeSubtitlesForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      candidates: [
        {
          startFrame: 60,
          durationFrames: 45,
          text: "第一句",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "narration",
      assetId,
      timelineStartFrame: 60,
    });
    const cueId = (await subtitleCues(storyId))[0].id;
    const narrId = (await narrationClips(storyId))[0].id;

    const bound = await bindSpeechForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      subtitleCueId: cueId,
      narrationClipId: narrId,
    });
    expect(bound).toMatchObject({ status: "ok", changed: true });
    const bindingId = (await subtitleCues(storyId))[0].speechBindingId!;
    expect((await narrationClips(storyId))[0].speechBindingId).toBe(bindingId);

    const moved = await moveBoundSpeechForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      bindingId,
      deltaFrames: 30,
    });
    expect(moved).toMatchObject({ status: "ok", changed: true });
    expect((await subtitleCues(storyId))[0]).toMatchObject({ startFrame: 90 });
    expect((await narrationClips(storyId))[0].timelineStartFrame).toBe(90);

    const outOfBounds = await moveBoundSpeechForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      bindingId,
      deltaFrames: -999,
    });
    expect(outOfBounds).toMatchObject({ status: "error" });
    // Nothing moved.
    expect((await subtitleCues(storyId))[0]).toMatchObject({ startFrame: 90 });

    const unbound = await unbindSpeechForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      bindingId,
    });
    expect(unbound).toMatchObject({ status: "ok", changed: true });
    expect((await subtitleCues(storyId))[0].speechBindingId).toBeUndefined();
    expect((await narrationClips(storyId))[0].speechBindingId).toBeUndefined();
  });

  it("editing a bound cue's text marks the narration text-stale in the same CAS — zero provider calls", async () => {
    const storyId = await seedStory();
    const assetId = await seedReadyAsset(storyId, 90);
    await initializeSubtitlesForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      candidates: [
        {
          startFrame: 0,
          durationFrames: 45,
          text: "旧文字",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "narration",
      assetId,
      timelineStartFrame: 0,
    });
    const cue = (await subtitleCues(storyId))[0];
    const narrId = (await narrationClips(storyId))[0].id;
    await bindSpeechForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      subtitleCueId: cue.id,
      narrationClipId: narrId,
    });

    expect((await narrationClips(storyId))[0].textStale).toBeFalsy();
    const edited = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      text: "改过的文字",
      expectedTextRevision: cue.textRevision,
    });
    expect(edited).toMatchObject({ status: "ok", changed: true });
    expect((await narrationClips(storyId))[0].textStale).toBe(true);
    // The narration clip itself is untouched otherwise (not deleted, not moved).
    expect((await narrationClips(storyId))[0]).toMatchObject({
      id: narrId,
      timelineStartFrame: 0,
    });
  });

  it("a media undo of an audio command restores both slices from the pre-command snapshot", async () => {
    const storyId = await seedStory();
    const assetId = await seedReadyAsset(storyId);
    await insertAudioClipForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      kind: "music",
      assetId,
      timelineStartFrame: 0,
    });
    expect(
      (await audioState(storyId))!.tracks.find(t => t.kind === "music")!.clips
    ).toHaveLength(1);

    const undo = await undoLatestTimelineMediaEditForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
    });
    expect(undo).toMatchObject({ status: "ok", changed: true });
    const after = await audioState(storyId);
    expect(after?.tracks.find(t => t.kind === "music")?.clips ?? []).toHaveLength(0);
  });

  it("does not read a cross-Story or non-ready asset", async () => {
    const storyA = await seedStory();
    const storyB = await createStory({
      userId: USER_ID,
      title: "b",
      body: { _revision: 1, shots: [] },
    });
    await updateStoryTimeline({
      storyId: storyB.id,
      userId: USER_ID,
      expectedVersion: 0,
      items: [],
    });
    const assetInA = await seedReadyAsset(storyA);
    const pendingInB = await createStoryAudioAssetRow({
      storyId: storyB.id,
      userId: USER_ID,
      storageKey: "b".repeat(32),
      displayName: "pending",
      sourceKind: "local-upload",
      status: "pending",
    });

    expect(
      await insertAudioClipForStory({
        storyId: storyB.id,
        userId: USER_ID,
        operation: nextOp(),
        kind: "music",
        assetId: assetInA,
        timelineStartFrame: 0,
      })
    ).toMatchObject({ status: "error" });
    expect(
      await insertAudioClipForStory({
        storyId: storyB.id,
        userId: USER_ID,
        operation: nextOp(),
        kind: "music",
        assetId: pendingInB.id,
        timelineStartFrame: 0,
      })
    ).toMatchObject({ status: "error" });
  });
});
