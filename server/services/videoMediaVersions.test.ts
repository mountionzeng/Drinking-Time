import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  createStoryAudioAssetRow,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
  updateStoryAudioAssetRow,
} from "../db";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import {
  insertAudioClipForStory,
  setAudioClipGainForStory,
  undoLatestTimelineMediaEditForStory,
} from "./timelineAudioEditing";
import {
  initializeSubtitlesForStory,
  editSubtitleTextForStory,
} from "./timelineSubtitleEditing";
import {
  getVideoMediaVersions,
  restoreVideoMediaVersion,
} from "./videoMediaVersions";
import { discardReadyStoryAudioAsset } from "./storyAudioAssets";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";

let count = 0;
const op = () => ({
  editorSessionEpoch: "media-versions",
  operationId: `version-${++count}`,
});
beforeEach(() => {
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
  count = 0;
});
async function seed() {
  const story = await createStory({
    userId: 1,
    title: "versions",
    body: {
      _revision: 1,
      shots: [],
      bookVideoRecords: [
        {
          id: "film",
          versionId: "source",
          preview: { previewId: "preview" },
          status: "adopted",
          videoVersion: 2,
          confirmedAt: 1000,
        },
      ],
      publishing: {
        activeVideoStoryboardGroupId: "publishing-group-source-preview",
      },
    },
  });
  const scope = { storyId: story.id, userId: 1 };
  await updateStoryTimeline({
    ...scope,
    expectedVersion: 0,
    items: [],
    overlays: [{ id: "overlay" }],
    visualLayerState: { count: 1, hidden: [] },
  });
  const asset = await createStoryAudioAssetRow({
    ...scope,
    storageKey: "b".repeat(32),
    displayName: "music",
    sourceKind: "local-upload",
    status: "ready",
    durationFrames: 300,
    durationSeconds: 10,
    sampleRate: 44100,
    channels: 2,
    checksum: "c".repeat(64),
  });
  await insertAudioClipForStory({
    ...scope,
    operation: op(),
    kind: "music",
    assetId: asset.id,
    timelineStartFrame: 0,
  });
  await initializeSubtitlesForStory({
    ...scope,
    operation: op(),
    candidates: [
      {
        text: "原字幕",
        startFrame: 0,
        durationFrames: 60,
        provenance: { kind: "manual" },
        sourceTextRevision: 0,
      },
    ],
  });
  return { scope, asset };
}
async function timeline(scope: { storyId: number; userId: number }) {
  return (await getStoryTimeline(scope.storyId, scope.userId))!;
}

describe("media version commands", () => {
  it("leaves current media and history untouched when historical audio is unavailable", async () => {
    const { scope, asset } = await seed();
    const original = await getVideoMediaVersions(scope);
    const clip = normalizeAudioState((await timeline(scope)).extensions?.audioTracks).tracks.find(t => t.kind === "music")!.clips[0];
    await setAudioClipGainForStory({ ...scope, operation: op(), clipId: clip.id, gain: 0.4 });
    const latest = await getVideoMediaVersions(scope), before = await timeline(scope);
    await updateStoryAudioAssetRow(asset.id, scope.userId, { status: "failed" });
    const result = await restoreVideoMediaVersion({ ...scope, operation: op(), kind: "music", versionId: original.current.music!, expectedCurrentId: latest.current.music! });
    expect(result).toMatchObject({ status: "error" });
    expect(await timeline(scope)).toEqual(before);
  });
  it("restores music only, retains all versions/assets, and supports replay and undo", async () => {
    const { scope, asset } = await seed();
    const original = await timeline(scope);
    const clip = normalizeAudioState(
      original.extensions?.audioTracks
    ).tracks.find(t => t.kind === "music")!.clips[0];
    const first = await getVideoMediaVersions(scope);
    expect(first.entries.find(e => e.kind === "music")?.label).toBe("V02.1");
    await setAudioClipGainForStory({
      ...scope,
      operation: op(),
      clipId: clip.id,
      gain: 0.4,
    });
    const second = await getVideoMediaVersions(scope);
    expect(
      second.entries.filter(e => e.kind === "music").map(e => e.label)
    ).toEqual(["V02.1", "V02.2"]);
    const command = {
      ...scope,
      operation: op(),
      kind: "music" as const,
      versionId: first.current.music!,
      expectedCurrentId: second.current.music!,
    };
    const restored = await restoreVideoMediaVersion(command);
    expect(restored).toMatchObject({ status: "ok", changed: true });
    const after = await timeline(scope);
    const restoredClip = normalizeAudioState(
      after.extensions?.audioTracks
    ).tracks.find(t => t.kind === "music")!.clips[0];
    expect(restoredClip).toMatchObject({ assetId: asset.id, gain: 1 });
    expect(restoredClip.id).not.toBe(clip.id);
    expect(after.extensions?.subtitleTracks).toEqual(
      original.extensions?.subtitleTracks
    );
    expect(after.items).toEqual(original.items);
    expect(after.overlays).toEqual(original.overlays);
    expect(after.visualLayerState).toEqual(original.visualLayerState);
    await restoreVideoMediaVersion(command);
    expect((await timeline(scope)).version).toBe(after.version);
    expect((await getVideoMediaVersions(scope)).entries).toHaveLength(
      second.entries.length
    );
    expect(
      await discardReadyStoryAudioAsset({
        scope,
        assetId: asset.id,
        reason: "test",
      })
    ).toBe(false);
    const undo = await undoLatestTimelineMediaEditForStory({
      ...scope,
      operation: op(),
    });
    expect(undo).toMatchObject({ status: "ok", changed: true });
    expect(
      normalizeAudioState(
        (await timeline(scope)).extensions?.audioTracks
      ).tracks.find(t => t.kind === "music")!.clips[0].gain
    ).toBe(0.4);
  });

  it("restores captions with fresh identities; rejects stale menus and foreign owners", async () => {
    const { scope } = await seed();
    const before = await timeline(scope),
      first = await getVideoMediaVersions(scope);
    const cue = normalizeSubtitleState(before.extensions?.subtitleTracks)
      .tracks[0].cues[0];
    await editSubtitleTextForStory({
      ...scope,
      operation: op(),
      cueId: cue.id,
      text: "新字幕",
      expectedTextRevision: cue.textRevision,
    });
    const second = await getVideoMediaVersions(scope);
    expect(
      await restoreVideoMediaVersion({
        ...scope,
        operation: op(),
        kind: "subtitles",
        versionId: first.current.subtitles!,
        expectedCurrentId: first.current.subtitles!,
      })
    ).toMatchObject({ status: "error" });
    expect(
      await restoreVideoMediaVersion({
        ...scope,
        operation: op(),
        kind: "subtitles",
        versionId: first.current.subtitles!,
        expectedCurrentId: second.current.subtitles!,
      })
    ).toMatchObject({ status: "ok", changed: true });
    const after = await timeline(scope);
    const restored = normalizeSubtitleState(after.extensions?.subtitleTracks)
      .tracks[0].cues[0];
    expect(restored.text).toBe("原字幕");
    expect(restored.id).not.toBe(cue.id);
    expect(after.extensions?.audioTracks).toEqual(
      before.extensions?.audioTracks
    );
    expect(
      await editSubtitleTextForStory({
        ...scope,
        operation: op(),
        cueId: cue.id,
        text: "迟到",
        expectedTextRevision: cue.textRevision,
      })
    ).toMatchObject({ status: "error" });
    await expect(
      getVideoMediaVersions({ ...scope, userId: 2 })
    ).rejects.toThrow();
  });
});
