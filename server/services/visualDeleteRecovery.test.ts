import { beforeEach, describe, expect, it } from "vitest";
import { createStory, getStoryById, getStoryTimeline, resetMemoryStateForTesting, updateStoryTimeline } from "../db";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import { deleteSelectedVisualObjects, restoreVisualRevision } from "./storyVisualObjectEditing";
import { readVideoEditHistory } from "../../shared/videoEditHistory";
import { undoVisualEditForStory } from "./visualClipEditing";
import { updateStoryBodyIfRevision } from "../repositories/stories";
import type { StoryTimelineItem } from "../../shared/storyMaterial";

const operation = (operationId: string, editorSessionEpoch = "first") => ({ operationId, editorSessionEpoch });
const objects = ["a", "b"].map(id => ({ type: "image-clip" as const, ownerStableShotId: id, clipId: `image-${id}` }));
async function fixture() {
  const story = await createStory({ userId: 1, title: "delete recovery", body: {
    shots: ["a", "b", "c"].map((id, i) => ({ stableShotId: id, shotNo: i + 1, subject: `current-${id}` })),
    messages: [{ content: "keep current chat" }], colorFeedback: "still adjusting",
  } });
  await updateStoryTimeline({ storyId: story.id, userId: 1, expectedVersion: 0,
    items: ["a", "b", "c"].map((id, i) => ({
      stableShotId: id, included: true, position: i, plannedDurationMs: 1000,
      timelineStartFrame: i * 30, durationFrames: 30, visualLayer: 0,
      imageClips: [{ id: `image-${id}`, imageId: i + 1, imageUrl: `/${id}.png`, label: id, offsetFrames: 0, timelineStartFrame: i * 30, durationFrames: 1, visualLayer: 1 }],
    })), overlays: [], visualLayerState: { count: 3, hidden: [] },
    extensions: { subtitleTracks: [{ id: "sub", text: "keep" }], audioTracks: [{ id: "music", volume: 0.7 }] },
  });
  return story.id;
}
describe("selected-layer deletion and durable recovery", () => {
  beforeEach(async () => { await resetMemoryStateForTesting(); clearVisualEditUndoForTesting(); clearVisualEditSessionsForTesting(); });
  it("deletes two V2 references atomically, preserves V1, unselected V2 and nonvisual data, and replays once", async () => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    const body = (await getStoryById(storyId, 1))!.body;
    const input = { storyId, userId: 1, objects, visualLayer: 1, operation: operation("delete") };
    const result = await deleteSelectedVisualObjects(input);
    expect(result).toMatchObject({ status: "ok" });
    const after = await getStoryTimeline(storyId, 1);
    expect(after!.version).toBe(before!.version + 1);
    expect(after!.items).toEqual((before!.items as StoryTimelineItem[]).map(item => ({ ...item, imageClips: item.stableShotId === "c" ? item.imageClips : [] })));
    expect((await getStoryById(storyId, 1))!.body).toEqual(body);
    expect((after as any).extensions).toMatchObject({ subtitleTracks: [{ id: "sub", text: "keep" }], audioTracks: [{ id: "music", volume: 0.7 }] });
    expect(await deleteSelectedVisualObjects(input)).toMatchObject({ status: "ok", timelineVersion: after!.version });
    expect((await getStoryTimeline(storyId, 1))!.version).toBe(after!.version);
    expect(await undoVisualEditForStory({ storyId, userId: 1, operation: input.operation })).toMatchObject({ status: "ok" });
    expect((await getStoryTimeline(storyId, 1))!.items).toEqual(before!.items);
  });
  it("undoes a V2 deletion after a later text autosave without overwriting that text or chat", async () => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    const input = { storyId, userId: 1, objects, visualLayer: 1, operation: operation("autosave-delete") };
    const deleted = await deleteSelectedVisualObjects(input);
    expect(deleted).toMatchObject({ status: "ok", receipt: { kind: "timeline" } });
    const body = (await getStoryById(storyId, 1))!.body as Record<string, unknown>;
    const revision = Number(body._revision) || 0;
    const editedBody = { ...body, _revision: revision + 1,
      shots: (body.shots as Record<string, unknown>[]).map(shot => ({ ...shot, subject: "new unsent-work-safe saved text" })),
      messages: [{ content: "new chat after deleting V2" }],
    };
    expect(await updateStoryBodyIfRevision({ id: storyId, userId: 1, expectedRevision: revision, body: editedBody })).toBe(true);
    expect(await undoVisualEditForStory({ storyId, userId: 1, operation: input.operation })).toMatchObject({ status: "ok" });
    expect((await getStoryTimeline(storyId, 1))!.items).toEqual(before!.items);
    expect((await getStoryById(storyId, 1))!.body).toEqual(editedBody);
  });
  it("restores V2 after refresh while retaining newer text and chat", async () => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    expect(await deleteSelectedVisualObjects({ storyId, userId: 1, objects, visualLayer: 1, operation: operation("refresh-delete") })).toMatchObject({ status: "ok" });
    const current = await getStoryTimeline(storyId, 1);
    const body = (await getStoryById(storyId, 1))!.body as Record<string, unknown>;
    const revision = Number(body._revision) || 0;
    const shots = (body.shots as Record<string, unknown>[]).map(shot => ({ ...shot, subject: "newer text" }));
    const messages = [{ content: "newer chat" }];
    expect(await updateStoryBodyIfRevision({ id: storyId, userId: 1, expectedRevision: revision, body: { ...body, shots, messages, _revision: revision + 1 } })).toBe(true);
    clearVisualEditUndoForTesting();
    clearVisualEditSessionsForTesting();
    expect(await restoreVisualRevision({ storyId, userId: 1, version: before!.version, expectedTimelineVersion: current!.version, operation: operation("refresh-restore", "new-session") })).toMatchObject({ status: "ok" });
    expect((await getStoryTimeline(storyId, 1))!.items).toEqual(before!.items);
    expect((await getStoryById(storyId, 1))!.body).toMatchObject({ shots, messages });
  });
  it.each(["missing", "wrong-layer", "duplicate", "foreign-user"])("rejects %s without partially deleting", async scenario => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    const result = await deleteSelectedVisualObjects({ storyId, userId: scenario === "foreign-user" ? 2 : 1,
      objects: scenario === "missing" ? [objects[0], { ...objects[1], clipId: "missing" }] : scenario === "duplicate" ? [objects[0], objects[0]] : objects,
      visualLayer: scenario === "wrong-layer" ? 0 : 1, operation: operation(scenario) });
    expect(result.status).toBe("error");
    expect(await getStoryTimeline(storyId, 1)).toEqual(before);
  });
  it("recovers deleted whole shots after clearing the undo journal and changing sessions", async () => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    const deleted = await deleteSelectedVisualObjects({ storyId, userId: 1, objects: [{ type: "story-shot", stableShotId: "a" }, { type: "story-shot", stableShotId: "c" }], visualLayer: 0, operation: operation("whole") });
    expect(deleted.status).toBe("ok");
    const current = await getStoryTimeline(storyId, 1);
    expect(readVideoEditHistory((current as any).extensions.videoEditHistory).some(revision => revision.version === before!.version)).toBe(true);
    clearVisualEditUndoForTesting();
    clearVisualEditSessionsForTesting();
    const input = { storyId, userId: 1, operation: operation("restore", "after-refresh"), version: before!.version, expectedTimelineVersion: current!.version };
    expect(await restoreVisualRevision(input)).toMatchObject({ status: "ok" });
    expect((await getStoryTimeline(storyId, 1))!.items).toEqual(before!.items);
    expect((await getStoryById(storyId, 1))!.body).toMatchObject({ shots: [{ stableShotId: "a" }, { stableShotId: "b" }, { stableShotId: "c" }], messages: [{ content: "keep current chat" }], colorFeedback: "still adjusting" });
    const restored = await getStoryTimeline(storyId, 1);
    expect(await restoreVisualRevision(input)).toMatchObject({ status: "ok", timelineVersion: restored!.version });
    expect(await restoreVisualRevision({ ...input, operation: operation("stale") })).toMatchObject({ status: "error" });
    expect(await restoreVisualRevision({ ...input, userId: 2, operation: operation("foreign") })).toMatchObject({ status: "error" });
    expect(await getStoryTimeline(storyId, 1)).toEqual(restored);
  });
  it("rejects deleting every whole shot without writing", async () => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    expect(await deleteSelectedVisualObjects({ storyId, userId: 1, objects: ["a", "b", "c"].map(stableShotId => ({ type: "story-shot", stableShotId })), visualLayer: 0, operation: operation("all") })).toMatchObject({ status: "error" });
    expect(await getStoryTimeline(storyId, 1)).toEqual(before);
  });
  it("deletes mixed V2 image/video selections without changing V1 placement or remaining videos", async () => {
    const storyId = await fixture();
    const before = await getStoryTimeline(storyId, 1);
    const items = before!.items as any[];
    items[0].visualClips = [1, 2].map(id => ({ id: `video-${id}`, takeId: id, rangeId: id, sourceStableShotId: "a", videoUrl: `/${id}.mp4`, label: "video", sourceStartSec: 0, sourceEndSec: 1, offsetMs: 0, durationMs: 1000, visualLayer: id }));
    await updateStoryTimeline({ storyId, userId: 1, expectedVersion: before!.version, items });
    const result = await deleteSelectedVisualObjects({ storyId, userId: 1, visualLayer: 1, objects: [objects[0], { type: "owned-video-clip", ownerStableShotId: "a", clipId: "video-1" }], operation: operation("mixed") });
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ok" });
    const after = (await getStoryTimeline(storyId, 1))!.items as any[];
    expect(after.map(item => [item.stableShotId, item.timelineStartFrame, item.durationFrames, item.visualLayer])).toEqual(items.map(item => [item.stableShotId, item.timelineStartFrame, item.durationFrames, item.visualLayer]));
    expect(after[0].imageClips).toEqual([]);
    expect(after[0].visualClips.map((clip: any) => clip.id)).toEqual(["video-2"]);
  });
});
