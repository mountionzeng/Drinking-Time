import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseDialogueVisualSync } from "../../shared/dialogueVisualSync";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
} from "../../shared/storyMaterial";
import type {
  StoryMaterialState,
  StoryTimelineItem,
} from "../../shared/storyMaterial";
import { resolveTimelineItemSource } from "../../shared/timelineSource";
import {
  alignedWindow,
  voiceOnset,
  syncVisualToDialogue,
} from "./dialogueVisualSync";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  audio: vi.fn(),
  run: vi.fn(),
}));
vi.mock("node:child_process", async (imp) => ({
  ...(await imp<typeof import("node:child_process")>()),
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: mocks.run,
  }),
}));
vi.mock("../persistence/storyVisualPersistence", () => ({
  loadOwnedStoryVisualAggregate: mocks.get,
  saveStoryVisualTimelineCas: mocks.save,
  visualDocumentFromTimeline: (v: unknown) => v,
}));
vi.mock("./storyAudioAssets", () => ({
  loadOwnedStoryAudioAsset: mocks.audio,
}));
const request =
  "我希望第一镜的小茶杯出现的快一点，随着第一句台词出现，他就出现";
const item: StoryTimelineItem = {
  stableShotId: "a",
  position: 0,
  included: true,
  plannedDurationMs: 6000,
  durationFrames: 180,
  timelineStartFrame: 0,
  transform: DEFAULT_TIMELINE_TRANSFORM,
  primaryVideoEdit: {
    takeId: 21,
    sourceStartSec: 0,
    sourceEndSec: 6,
    effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS, muted: true },
  },
};
function fixture(row = item) {
  const cue = { id: "first", text: "Hello", startFrame: 2, durationFrames: 45 };
  const voice = {
    id: "v",
    assetId: 2,
    timelineStartFrame: 0,
    sourceInFrame: 3,
    sourceOutFrame: 183,
    durationFrames: 180,
    gain: 1,
  };
  const timeline = {
    items: [row],
    version: 7,
    extensions: {
      subtitleTracks: {
        tracks: [
          { id: "en", cues: [cue] },
          { id: "zh", cues: [{ ...cue, id: "zh", text: "你好" }] },
        ],
      },
      audioTracks: { tracks: [{ kind: "narration", clips: [voice] }] },
    },
  };
  mocks.get.mockResolvedValue({ timeline });
  return {
    timeline,
    shots: [
      {
        stableShotId: "a",
        shotNo: 1,
        currentVideo: { id: 21, durationSec: 6, videoKey: "test.mp4" },
      },
    ],
  } as unknown as StoryMaterialState;
}
function pcm() {
  const wave = Buffer.alloc(24 * 800);
  for (let i = 4 * 800; i < wave.length; i += 2) wave.writeInt16LE(4000, i);
  return wave;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.audio.mockResolvedValue({
    storageKey: "a".repeat(32),
    status: "ready",
  });
  mocks.run.mockResolvedValue({ stdout: pcm() });
});
describe("chat — align a picture event to a spoken line", () => {
  it("recognizes the user's actual sentence; separates previews, reverse requests and unrelated edits", () => {
    expect(parseDialogueVisualSync(request)).toMatchObject({
      shotNo: 1,
      line: 1,
      cup: true,
      preview: false,
    });
    expect(parseDialogueVisualSync("先试算：" + request)?.preview).toBe(true);
    expect(parseDialogueVisualSync("把旁白跟小茶杯出现对齐")?.ambiguous).toBe(
      true,
    );
    expect(parseDialogueVisualSync("把第一句台词改得快一点")).toBeNull();
    expect(
      parseDialogueVisualSync("第三镜的图片 #17 随第二句台词出现"),
    ).toMatchObject({ shotNo: 3, imageId: 17, line: 2 });
    for (const reference of ["03镜", "镜头03", "SH03"]) {
      expect(
        parseDialogueVisualSync(reference + "的小茶杯随第一句台词出现")?.shotNo,
      ).toBe(3);
    }
    expect(
      parseDialogueVisualSync("03镜和04镜的小茶杯随第一句台词出现")?.ambiguous,
    ).toBe(true);
  });
  it("measures the audible start after the timeline gain and fade are applied", () => {
    const input = {
      id: "v",
      kind: "narration",
      source: { kind: "asset", assetId: 1 },
      timelineStartFrame: 0,
      sourceInFrame: 0,
      sourceOutFrame: 180,
      durationFrames: 180,
      baseGain: 1,
      muted: false,
      fadeInFrames: 100,
      fadeOutFrames: 0,
      playbackRate: 1,
      reverse: false,
    } as const;
    expect(voiceOnset(pcm(), 0, 0, 2, input)).toBe(7);
    expect(
      voiceOnset(pcm(), 0, 0, 2, { ...input, baseGain: 0.001 }),
    ).toBeNull();
  });
  it("uses audible frames and refuses silence or a clip that is already speaking at the search boundary", () => {
    expect(voiceOnset(pcm(), 0, 0, 2)).toBe(4);
    expect(voiceOnset(Buffer.alloc(6400), 0, 0, 2)).toBeNull();
    expect(voiceOnset(Buffer.alloc(6400, 80), 25, 0, 28)).toBeNull();
  });
  it("maps the source event and original end into the unchanged shot slot", () => {
    const applied = alignedWindow(118 / 30, 4, 180, 6)!;
    expect(
      applied.sourceStartSec + (applied.playbackRate * 4) / 30,
    ).toBeCloseTo(118 / 30);
    expect(applied.sourceStartSec + applied.playbackRate * 6).toBeCloseTo(6);
    expect(alignedWindow(0.1, 100, 180, 6)).toBeNull();
  });
  it("leaves preview read-only; a real command writes only the shot and can be replayed", async () => {
    const state = fixture(),
      scope = { storyId: 2, userId: 1 },
      cmd = { ...parseDialogueVisualSync(request)!, eventSec: 118 / 30 };
    expect(
      await syncVisualToDialogue(scope, state, { ...cmd, preview: true }),
    ).toMatchObject({
      appliedCount: 0,
      reply: expect.stringContaining("0.13 秒"),
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await syncVisualToDialogue(scope, state, cmd)).toMatchObject({
      appliedCount: 1,
      undoSnapshot: [item],
    });
    const saved = mocks.save.mock.calls[0][0];
    expect(saved.expectedVersion).toBe(7);
    const changed = saved.document.items[0];
    expect(changed.durationFrames).toBe(180);
    expect(
      resolveTimelineItemSource({
        item: changed,
        localFrame: 4,
        durationFrames: 180,
      }),
    ).toMatchObject({ sourceTimeSec: expect.closeTo(118 / 30, 6) });
    expect(
      await syncVisualToDialogue(scope, fixture(changed), cmd),
    ).toMatchObject({
      appliedCount: 0,
      reply: expect.stringContaining("已经"),
    });
  });
  it("moves an independent image, preserving its duration, layer, source and the host video", async () => {
    const image = {
      id: "cup",
      imageId: 30,
      imageUrl: "/cup.png",
      label: "小茶杯",
      offsetFrames: 30,
      durationFrames: 25,
      visualLayer: 1,
    };
    const state = fixture({ ...item, imageClips: [image] });
    expect(
      await syncVisualToDialogue(
        { storyId: 2, userId: 1 },
        state,
        parseDialogueVisualSync(request)!,
      ),
    ).toMatchObject({ appliedCount: 1 });
    expect(mocks.save.mock.calls[0][0].document.items[0]).toEqual({
      ...item,
      imageClips: [{ ...image, timelineStartFrame: 4, offsetFrames: 4 }],
    });
  });
  it("refuses an intervening version change", async () => {
    const state = fixture();
    mocks.get.mockResolvedValue({
      timeline: { ...state.timeline, version: 8 },
    });
    expect(
      await syncVisualToDialogue(
        { storyId: 2, userId: 1 },
        state,
        parseDialogueVisualSync(request)!,
      ),
    ).toMatchObject({
      appliedCount: 0,
      reply: expect.stringContaining("版本"),
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("respects mascot colour and gives an explicit image number priority", async () => {
    const green = {
      id: "green",
      imageId: 12,
      imageUrl: "/g.png",
      label: "绿色的小茶杯",
      offsetFrames: 60,
      durationFrames: 12,
      visualLayer: 1,
    };
    const red = {
      ...green,
      id: "red",
      imageId: 13,
      label: "红色小茶杯",
      offsetFrames: 30,
    };
    const state = fixture({ ...item, imageClips: [green, red] });
    const cmd = parseDialogueVisualSync("第一镜的红色小茶杯随第一句台词出现")!;
    await syncVisualToDialogue({ storyId: 2, userId: 1 }, state, cmd);
    expect(mocks.save.mock.calls[0][0].document.items[0].imageClips).toEqual([
      green,
      { ...red, offsetFrames: 4, timelineStartFrame: 4 },
    ]);
    await syncVisualToDialogue({ storyId: 2, userId: 1 }, state, {
      ...cmd,
      imageId: 12,
    });
    expect(mocks.save.mock.calls[1][0].document.items[0].imageClips).toEqual([
      { ...green, offsetFrames: 4, timelineStartFrame: 4 },
      red,
    ]);
  });
});
