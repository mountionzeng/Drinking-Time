import { beforeEach, describe, expect, it } from "vitest";
import { createStory, createStoryAudioAssetRow, getStoryTimeline, resetMemoryStateForTesting, updateStoryTimeline } from "../db";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting, activateVisualEditSession } from "./visualEditSessionRegistry";
import { insertAudioClipForStory, undoLatestTimelineMediaEditForStory } from "./timelineAudioEditing";
import { editTimelineSoundFromChat } from "./timelineSoundChat";
import { getVideoMediaVersions } from "./videoMediaVersions";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
let counter = 0;
const op = () => ({ editorSessionEpoch: "sound-chat", operationId: `sound-${++counter}` });
beforeEach(() => { resetMemoryStateForTesting(); clearVisualEditUndoForTesting(); clearVisualEditSessionsForTesting(); counter = 0; });
async function seed() {
  const story = await createStory({ userId: 1, title: "sound chat", body: { _revision: 1, shots: [] } });
  const scope = { storyId: story.id, userId: 1 };
  await updateStoryTimeline({ ...scope, expectedVersion: 0, items: [], overlays: [{ id: "keep" }] });
  const asset = await createStoryAudioAssetRow({ ...scope, storageKey: "a".repeat(32), checksum: "b".repeat(64), displayName: "music", sourceKind: "local-upload", status: "ready", durationFrames: 300, durationSeconds: 10, sampleRate: 48000, channels: 2 });
  await insertAudioClipForStory({ ...scope, operation: op(), kind: "music", assetId: asset.id, timelineStartFrame: 0, gain: .25 });
  return scope;
}
const music = async (scope: { storyId: number; userId: number }) => normalizeAudioState((await getStoryTimeline(scope.storyId, scope.userId))?.extensions?.audioTracks).tracks.find(t => t.kind === "music")!;
describe("sound chat writer", () => {
  it("saves a real child version with intent and supports replay and undo", async () => {
    const scope = await seed(); const operation = op();
    const before = await getStoryTimeline(scope.storyId, 1);
    const result = await editTimelineSoundFromChat({ ...scope, operation, instruction: "音乐小一点，音乐淡出2秒" });
    expect(result).toMatchObject({ status: "ok", changed: true });
    expect((await music(scope)).clips[0]).toMatchObject({ gain: .2, fadeOutFrames: 60 });
    expect((await getStoryTimeline(scope.storyId, 1))?.overlays).toEqual(before?.overlays);
    const history = await getVideoMediaVersions(scope);
    expect(history.entries.at(-1)).toMatchObject({ intent: "音乐小一点，音乐淡出2秒", authorUserId: 1 });
    await editTimelineSoundFromChat({ ...scope, operation, instruction: "音乐小一点，音乐淡出2秒" });
    expect((await music(scope)).clips[0].gain).toBe(.2);
    expect((await getVideoMediaVersions(scope)).entries.length).toBe(history.entries.length);
    if (result.status !== "ok" || !result.receipt) throw Error("receipt missing");
    await undoLatestTimelineMediaEditForStory({ ...scope, operation: result.receipt });
    expect((await music(scope)).clips[0]).toMatchObject({ gain: .25, fadeOutFrames: 0 });
  });
  it("rejects foreign stories and missing tracks without partial writes", async () => {
    const scope = await seed();
    await expect(editTimelineSoundFromChat({ ...scope, userId: 2, operation: op(), instruction: "音乐小一点" })).resolves.toMatchObject({ status: "error" });
    await expect(editTimelineSoundFromChat({ ...scope, operation: op(), instruction: "音乐小一点，旁白大一点" })).resolves.toMatchObject({ status: "error" });
    expect((await music(scope)).clips[0].gain).toBe(.25);
  });
  it("rejects retired sessions and unsupported compound edits", async () => {
    const scope = await seed();
    activateVisualEditSession({ ...scope, editorClientId: "client", editorSessionEpoch: "sound-chat", activationSequence: 1 });
    activateVisualEditSession({ ...scope, editorClientId: "client", editorSessionEpoch: "new-tab", activationSequence: 2 });
    await expect(editTimelineSoundFromChat({ ...scope, operation: op(), instruction: "音乐小一点" })).resolves.toMatchObject({ status: "error" });
    await expect(editTimelineSoundFromChat({ ...scope, operation: { editorSessionEpoch: "new-tab", operationId: "new" }, instruction: "音乐小一点，旁白慢一点" })).resolves.toMatchObject({ status: "error" });
    expect((await music(scope)).clips[0].gain).toBe(.25);
  });
});
