import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import {
  deleteSubtitleCueForStory,
  editSubtitleTextForStory,
  initializeSubtitlesForStory,
  mergeSubtitleCueForStory,
  moveSubtitleCueForStory,
  splitSubtitleCueForStory,
  trimSubtitleCueForStory,
  undoLatestTimelineMediaEditForStory,
} from "./timelineSubtitleEditing";

const USER_ID = 1;
const EPOCH = "tab-a";

let opCounter = 0;
const nextOp = () => ({ editorSessionEpoch: EPOCH, operationId: `op-${++opCounter}` });

async function seedStory(): Promise<number> {
  const story = await createStory({
    userId: USER_ID,
    title: "subtitle",
    body: { _revision: 1, shots: [{ stableShotId: "shot-a", shotNo: 1 }] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: [{ stableShotId: "shot-a", included: true, position: 0 }],
    visualLayerState: { count: 1, hidden: [] },
  });
  return story.id;
}

async function subtitleCues(storyId: number) {
  const row = (await getStoryTimeline(storyId, USER_ID)) as {
    extensions?: { subtitleTracks?: { tracks: { cues: unknown[] }[] } };
  } | null;
  return row?.extensions?.subtitleTracks?.tracks?.[0]?.cues ?? [];
}

async function timelineVersion(storyId: number) {
  const row = await getStoryTimeline(storyId, USER_ID);
  return (row as { version: number }).version;
}

async function initOneCue(storyId: number) {
  const result = await initializeSubtitlesForStory({
    storyId,
    userId: USER_ID,
    operation: nextOp(),
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
  expect(result.status).toBe("ok");
  const cues = (await subtitleCues(storyId)) as Array<{ id: string; textRevision: number }>;
  return cues[0];
}

beforeEach(() => {
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
  opCounter = 0;
});

describe("timelineSubtitleEditing narrow commands", () => {
  it("initializes cues, bumps the timeline version once, and preserves visual items", async () => {
    const storyId = await seedStory();
    const beforeVersion = await timelineVersion(storyId);
    const cue = await initOneCue(storyId);

    expect(cue).toMatchObject({ text: "第一句", startFrame: 0, durationFrames: 60 });
    expect(await timelineVersion(storyId)).toBe(beforeVersion + 1);
    const row = await getStoryTimeline(storyId, USER_ID);
    expect((row as { items: Array<{ stableShotId: string }> }).items).toEqual([
      expect.objectContaining({ stableShotId: "shot-a" }),
    ]);
    expect(row).toMatchObject({ visualLayerState: { count: 1, hidden: [] } });
  });

  it("initialize is a no-op once a cue exists (changed:false, no version bump)", async () => {
    const storyId = await seedStory();
    await initOneCue(storyId);
    const version = await timelineVersion(storyId);

    const again = await initializeSubtitlesForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      candidates: [
        {
          startFrame: 0,
          durationFrames: 30,
          text: "别的",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    expect(again).toMatchObject({ status: "ok", changed: false, timelineVersion: version });
    expect(await subtitleCues(storyId)).toHaveLength(1);
  });

  it("edit / move / trim / split / merge / delete each bump the version exactly once", async () => {
    const storyId = await seedStory();
    const cue = await initOneCue(storyId);
    let version = await timelineVersion(storyId);

    const edited = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      text: "改过的第一句",
      expectedTextRevision: cue.textRevision,
    });
    expect(edited).toMatchObject({ status: "ok", changed: true, timelineVersion: version + 1 });
    version += 1;

    const moved = await moveSubtitleCueForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      toStartFrame: 15,
    });
    expect(moved).toMatchObject({ status: "ok", timelineVersion: version + 1 });
    version += 1;

    const trimmed = await trimSubtitleCueForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      edge: "end",
      toFrame: 60,
    });
    expect(trimmed).toMatchObject({ status: "ok", timelineVersion: version + 1 });
    version += 1;

    const currentCue = (await subtitleCues(storyId)) as Array<{
      id: string;
      textRevision: number;
    }>;
    const split = await splitSubtitleCueForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: currentCue[0].id,
      splitFrame: 30,
      caretIndex: 3,
      expectedTextRevision: currentCue[0].textRevision,
    });
    expect(split).toMatchObject({ status: "ok", timelineVersion: version + 1 });
    version += 1;
    expect(await subtitleCues(storyId)).toHaveLength(2);

    const pair = (await subtitleCues(storyId)) as Array<{ id: string }>;
    const merged = await mergeSubtitleCueForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: pair[1].id,
      direction: "previous",
    });
    expect(merged).toMatchObject({ status: "ok", timelineVersion: version + 1 });
    version += 1;
    expect(await subtitleCues(storyId)).toHaveLength(1);

    const remaining = (await subtitleCues(storyId)) as Array<{ id: string }>;
    const deleted = await deleteSubtitleCueForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: remaining[0].id,
    });
    expect(deleted).toMatchObject({ status: "ok", timelineVersion: version + 1 });
    expect(await subtitleCues(storyId)).toHaveLength(0);
  });

  it("replays the same operation id + payload without another write, and rejects a reused id with a different payload", async () => {
    const storyId = await seedStory();
    const cue = await initOneCue(storyId);
    const operation = nextOp();

    const first = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation,
      cueId: cue.id,
      text: "新文本",
      expectedTextRevision: cue.textRevision,
    });
    expect(first).toMatchObject({ status: "ok", changed: true });
    const version = await timelineVersion(storyId);

    const replay = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation,
      cueId: cue.id,
      text: "新文本",
      expectedTextRevision: cue.textRevision,
    });
    expect(replay).toMatchObject({ status: "ok", changed: true, timelineVersion: version });

    const reused = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation,
      cueId: cue.id,
      text: "另一段文本",
      expectedTextRevision: cue.textRevision,
    });
    expect(reused).toMatchObject({ status: "error", errorKind: "invalid" });
  });

  it("a no-op edit returns changed:false and does not bump the version or add an undo", async () => {
    const storyId = await seedStory();
    const cue = await initOneCue(storyId);
    const version = await timelineVersion(storyId);

    const noop = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      text: "第一句",
      expectedTextRevision: cue.textRevision,
    });
    expect(noop).toMatchObject({ status: "ok", changed: false, timelineVersion: version });

    const undo = await undoLatestTimelineMediaEditForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
    });
    // Only the initialize command is on the media undo stack.
    expect(undo.status).toBe("ok");
    expect(await subtitleCues(storyId)).toHaveLength(0);
  });

  it("undo restores the previous subtitle state and leaves visual items untouched", async () => {
    const storyId = await seedStory();
    const cue = await initOneCue(storyId);
    await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      text: "编辑后的文字",
      expectedTextRevision: cue.textRevision,
    });
    const beforeUndoItems = (
      (await getStoryTimeline(storyId, USER_ID)) as { items: unknown[] }
    ).items;

    const undo = await undoLatestTimelineMediaEditForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
    });
    expect(undo.status).toBe("ok");
    const cues = (await subtitleCues(storyId)) as Array<{ text: string }>;
    expect(cues[0].text).toBe("第一句");
    expect(
      ((await getStoryTimeline(storyId, USER_ID)) as { items: unknown[] }).items
    ).toEqual(beforeUndoItems);
  });

  it("rejects a stale text revision on edit", async () => {
    const storyId = await seedStory();
    const cue = await initOneCue(storyId);
    const stale = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: cue.id,
      text: "x",
      expectedTextRevision: cue.textRevision + 99,
    });
    expect(stale).toMatchObject({ status: "error", errorKind: "invalid" });
  });

  it("fails clearly when the Story has no timeline", async () => {
    const story = await createStory({
      userId: USER_ID,
      title: "no timeline",
      body: { _revision: 1, shots: [] },
    });
    const result = await initializeSubtitlesForStory({
      storyId: story.id,
      userId: USER_ID,
      operation: nextOp(),
      candidates: [
        {
          startFrame: 0,
          durationFrames: 30,
          text: "x",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    expect(result).toMatchObject({ status: "error", errorKind: "invalid" });
  });
});
