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
  initializeGeneratedSubtitlesForStory,
  mergeSubtitleCueForStory,
  moveSubtitleCueForStory,
  splitSubtitleCueForStory,
  trimSubtitleCueForStory,
  undoLatestTimelineMediaEditForStory,
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

async function seedStoryWithoutTimeline(): Promise<number> {
  const story = await createStory({
    userId: USER_ID,
    title: "legacy subtitle",
    body: {
      _revision: 7,
      shots: [
        {
          stableShotId: "legacy-shot-a",
          shotNo: 1,
          durationMs: 2_000,
        },
        {
          stableShotId: "legacy-shot-b",
          shotNo: 2,
          durationMs: 3_000,
        },
      ],
    },
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
  const cues = (await subtitleCues(storyId)) as Array<{
    id: string;
    textRevision: number;
  }>;
  return cues[0];
}

beforeEach(() => {
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
  opCounter = 0;
});

describe("timelineSubtitleEditing narrow commands", () => {
  async function generatedStory() {
    return createStory({
      userId: USER_ID,
      title: "生成中的分镜",
      body: {
        _revision: 2,
        shots: [
          {
            stableShotId: "a",
            shotNo: 1,
            dialogue: "第一句字幕",
            durationMs: 2000,
          },
          {
            stableShotId: "b",
            shotNo: 2,
            dialogue: "第二句字幕",
            durationMs: 3000,
          },
          { stableShotId: "c", shotNo: 3, dialogue: "", durationMs: 1000 },
        ],
      },
    });
  }

  it("initializes timed captions before any video is ready and deduplicates concurrent confirmations", async () => {
    const story = await generatedStory();
    const input = {
      storyId: story.id,
      userId: USER_ID,
      generationId: "preview-1",
    };
    const results = await Promise.all([
      initializeGeneratedSubtitlesForStory(input),
      initializeGeneratedSubtitlesForStory(input),
    ]);
    expect(results.every(result => result.status === "ok")).toBe(true);
    // Replayed receipts retain changed=true; the durable document must advance only once.
    expect(await timelineVersion(story.id)).toBe(1);
    expect(await subtitleCues(story.id)).toMatchObject([
      {
        text: "第一句字幕",
        startFrame: 0,
        durationFrames: 60,
        provenance: { kind: "shot-dialogue", stableShotId: "a" },
      },
      { text: "第二句字幕", startFrame: 60, durationFrames: 90 },
    ]);
    const timeline = await getStoryTimeline(story.id, USER_ID);
    expect(timeline!.items as unknown[]).toHaveLength(3);
    clearVisualEditUndoForTesting();
    await initializeGeneratedSubtitlesForStory(input);
    expect(await getStoryTimeline(story.id, USER_ID)).toEqual(timeline);
  });

  it("preserves edited and deliberately emptied captions across new generations", async () => {
    const story = await generatedStory();
    const input = { storyId: story.id, userId: USER_ID, generationId: "first" };
    await initializeGeneratedSubtitlesForStory(input);
    const first = (await subtitleCues(story.id))[0] as {
      id: string;
      textRevision: number;
    };
    await editSubtitleTextForStory({
      storyId: story.id,
      userId: USER_ID,
      operation: nextOp(),
      cueId: first.id,
      text: "人工改稿",
      expectedTextRevision: first.textRevision,
    });
    const edited = await getStoryTimeline(story.id, USER_ID);
    await initializeGeneratedSubtitlesForStory({
      ...input,
      generationId: "second",
    });
    expect(await getStoryTimeline(story.id, USER_ID)).toEqual(edited);
    for (const cue of await subtitleCues(story.id)) {
      await deleteSubtitleCueForStory({
        storyId: story.id,
        userId: USER_ID,
        operation: nextOp(),
        cueId: (cue as { id: string }).id,
      });
    }
    await initializeGeneratedSubtitlesForStory({
      ...input,
      generationId: "third",
    });
    expect(await subtitleCues(story.id)).toEqual([]);
  });

  it("uses absolute timeline positions and excludes omitted shots without moving visual items", async () => {
    const story = await generatedStory();
    await updateStoryTimeline({
      storyId: story.id,
      userId: USER_ID,
      expectedVersion: 0,
      items: [
        { stableShotId: "a", included: false, position: 0, durationFrames: 60 },
        {
          stableShotId: "b",
          included: true,
          position: 1,
          timelineStartFrame: 90,
          durationFrames: 120,
        },
        {
          stableShotId: "c",
          included: true,
          position: 2,
          timelineStartFrame: 210,
          durationFrames: 30,
        },
      ],
    });
    const before = await getStoryTimeline(story.id, USER_ID);
    await initializeGeneratedSubtitlesForStory({
      storyId: story.id,
      userId: USER_ID,
      generationId: "gap",
    });
    expect(await subtitleCues(story.id)).toMatchObject([
      { text: "第二句字幕", startFrame: 90, durationFrames: 120 },
    ]);
    expect((await getStoryTimeline(story.id, USER_ID))?.items).toEqual(
      before?.items
    );
  });

  it("does not create captions for a different owner", async () => {
    const story = await generatedStory();
    expect(
      await initializeGeneratedSubtitlesForStory({
        storyId: story.id,
        userId: 999,
        generationId: "other",
      })
    ).toMatchObject({ status: "error" });
    expect(await getStoryTimeline(story.id, USER_ID)).toBeNull();
  });

  it("does not replay an automatic caption initialization after undo", async () => {
    const story = await generatedStory();
    const input = { storyId: story.id, userId: USER_ID, generationId: "undo" };
    const initialized = await initializeGeneratedSubtitlesForStory(input);
    if (initialized.status !== "ok" || !initialized.receipt)
      throw new Error("字幕未初始化");
    expect(
      await undoLatestTimelineMediaEditForStory({
        storyId: story.id,
        userId: USER_ID,
        operation: initialized.receipt,
      })
    ).toMatchObject({ status: "ok" });
    const undone = await getStoryTimeline(story.id, USER_ID);
    expect(await initializeGeneratedSubtitlesForStory(input)).toMatchObject({
      status: "ok",
      changed: false,
    });
    expect(await getStoryTimeline(story.id, USER_ID)).toEqual(undone);
    clearVisualEditUndoForTesting();
    await initializeGeneratedSubtitlesForStory(input);
    expect(await getStoryTimeline(story.id, USER_ID)).toEqual(undone);
  });

  it("keeps legacy imported captions authoritative", async () => {
    const story = await createStory({
      userId: USER_ID,
      title: "旧字幕",
      body: {
        _revision: 1,
        shots: [
          {
            stableShotId: "a",
            shotNo: 1,
            durationMs: 2000,
            dialogue: "不能替换旧字幕",
          },
        ],
        chatCutImport: {
          sourceFormat: "xmeml",
          fps: 25,
          scriptCues: [{ code: "0101", text: "导入字幕" }],
          audioTracks: [
            {
              index: 1,
              clips: [
                {
                  id: "voice",
                  name: "VO-0101.wav",
                  startFrame: 0,
                  endFrame: 50,
                },
              ],
            },
          ],
        },
      },
    });
    expect(
      await initializeGeneratedSubtitlesForStory({
        storyId: story.id,
        userId: USER_ID,
        generationId: "legacy",
      })
    ).toMatchObject({ status: "ok", changed: false });
    expect(await getStoryTimeline(story.id, USER_ID)).toBeNull();
  });

  it("atomically creates a missing Timeline from Story shots when subtitles are first initialized", async () => {
    const storyId = await seedStoryWithoutTimeline();
    const operation = nextOp();
    expect(await getStoryTimeline(storyId, USER_ID)).toBeNull();

    const input = {
      storyId,
      userId: USER_ID,
      operation,
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "旧故事第一句",
          provenance: {
            kind: "shot-dialogue" as const,
            stableShotId: "legacy-shot-a",
          },
          sourceTextRevision: 7,
        },
      ],
    };
    await expect(initializeSubtitlesForStory(input)).resolves.toMatchObject({
      status: "ok",
      changed: true,
      timelineVersion: 1,
    });

    const timeline = await getStoryTimeline(storyId, USER_ID);
    expect(timeline).toMatchObject({
      version: 1,
      items: [
        {
          stableShotId: "legacy-shot-a",
          timelineStartFrame: 0,
          durationFrames: 60,
        },
        {
          stableShotId: "legacy-shot-b",
          timelineStartFrame: 60,
          durationFrames: 90,
        },
      ],
      overlays: [],
    });
    expect(await subtitleCues(storyId)).toEqual([
      expect.objectContaining({ text: "旧故事第一句" }),
    ]);

    // The durable operation ledger makes a replay safe even after the
    // process-local undo journal has been cleared.
    clearVisualEditUndoForTesting();
    await expect(initializeSubtitlesForStory(input)).resolves.toMatchObject({
      status: "ok",
      changed: false,
      timelineVersion: 1,
    });
    expect(await timelineVersion(storyId)).toBe(1);
  });

  it("does not create a missing Timeline for non-initialize subtitle commands", async () => {
    const storyId = await seedStoryWithoutTimeline();
    await expect(
      moveSubtitleCueForStory({
        storyId,
        userId: USER_ID,
        operation: nextOp(),
        cueId: "missing-cue",
        toStartFrame: 10,
      })
    ).resolves.toMatchObject({ status: "error", errorKind: "invalid" });
    expect(await getStoryTimeline(storyId, USER_ID)).toBeNull();
  });

  it("initializes cues, bumps the timeline version once, and preserves visual items", async () => {
    const storyId = await seedStory();
    const beforeVersion = await timelineVersion(storyId);
    const cue = await initOneCue(storyId);

    expect(cue).toMatchObject({
      text: "第一句",
      startFrame: 0,
      durationFrames: 60,
    });
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
    expect(again).toMatchObject({
      status: "ok",
      changed: false,
      timelineVersion: version,
    });
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
    expect(edited).toMatchObject({
      status: "ok",
      changed: true,
      timelineVersion: version + 1,
    });
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
    expect(trimmed).toMatchObject({
      status: "ok",
      timelineVersion: version + 1,
    });
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
    expect(merged).toMatchObject({
      status: "ok",
      timelineVersion: version + 1,
    });
    version += 1;
    expect(await subtitleCues(storyId)).toHaveLength(1);

    const remaining = (await subtitleCues(storyId)) as Array<{ id: string }>;
    const deleted = await deleteSubtitleCueForStory({
      storyId,
      userId: USER_ID,
      operation: nextOp(),
      cueId: remaining[0].id,
    });
    expect(deleted).toMatchObject({
      status: "ok",
      timelineVersion: version + 1,
    });
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
    // Simulate a server restart: the in-memory undo/replay journal is gone,
    // while the Timeline envelope remains durable.
    clearVisualEditUndoForTesting();

    const replay = await editSubtitleTextForStory({
      storyId,
      userId: USER_ID,
      operation,
      cueId: cue.id,
      text: "新文本",
      expectedTextRevision: cue.textRevision,
    });
    expect(replay).toMatchObject({
      status: "ok",
      changed: false,
      timelineVersion: version,
    });

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

  it("reports an undo-evicted operation replay as an unchanged success with no receipt", async () => {
    const storyId = await seedStory();
    const cue = await initOneCue(storyId);
    const firstOperation = nextOp();
    const firstInput = {
      storyId,
      userId: USER_ID,
      operation: firstOperation,
      cueId: cue.id,
      toStartFrame: 1,
    };
    await expect(moveSubtitleCueForStory(firstInput)).resolves.toMatchObject({
      status: "ok",
      changed: true,
    });
    for (let startFrame = 2; startFrame <= 42; startFrame += 1) {
      await moveSubtitleCueForStory({
        storyId,
        userId: USER_ID,
        operation: nextOp(),
        cueId: cue.id,
        toStartFrame: startFrame,
      });
    }
    const version = await timelineVersion(storyId);

    const replay = await moveSubtitleCueForStory(firstInput);
    expect(replay).toEqual({
      status: "ok",
      timelineVersion: version,
      changed: false,
    });
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
    expect(noop).toMatchObject({
      status: "ok",
      changed: false,
      timelineVersion: version,
    });

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

  it("fails clearly when the Story is missing or unauthorized", async () => {
    const result = await initializeSubtitlesForStory({
      storyId: 999_999,
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
