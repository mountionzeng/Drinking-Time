import { describe, expect, it } from "vitest";
import {
  normalizeSubtitleState,
  editSubtitleText,
  moveSubtitleCue,
  trimSubtitleCueEnd,
  splitSubtitleCue,
  mergeSubtitleCue,
  deleteSubtitleCue,
  buildSubtitleRenderPlan,
  subtitleStateEndFrame,
  initializeSubtitleCues,
} from "./timelineSubtitleModel";
import { bindSpeech, moveBoundSpeech } from "./timelineSpeechBinding";
import { emptyAudioState } from "./timelineAudioModel";
const state = () =>
  normalizeSubtitleState({
    tracks: [
      {
        id: "en",
        name: "English",
        placement: { left: 0.05, top: 0.8, width: 0.9, fontSize: 0.03 },
        cues: [
          {
            id: "e",
            text: "Hello world",
            startFrame: 0,
            durationFrames: 30,
            textRevision: 1,
          },
        ],
      },
      {
        id: "zh",
        name: "中文",
        placement: { left: 0.05, top: 0.86, width: 0.9, fontSize: 0.03 },
        cues: [
          {
            id: "z",
            text: "你好世界",
            startFrame: 0,
            durationFrames: 60,
            textRevision: 1,
          },
        ],
      },
    ],
  });
describe("independent subtitle languages", () => {
  it("preserves identity, placement, order and both end times", () => {
    const original = state();
    expect(normalizeSubtitleState(original)).toEqual(original);
    expect(subtitleStateEndFrame(original)).toBe(60);
    expect(
      buildSubtitleRenderPlan(original).cues.map(c => [
        c.trackId,
        c.placement?.top,
      ])
    ).toEqual([
      ["en", 0.8],
      ["zh", 0.86],
    ]);
    expect(initializeSubtitleCues(original, { candidates: [] })).toMatchObject({
      changed: false,
    });
  });
  it.each([
    () =>
      editSubtitleText(state(), {
        cueId: "z",
        text: "您好世界",
        expectedTextRevision: 1,
      }),
    () => moveSubtitleCue(state(), { cueId: "z", toStartFrame: 10 }),
    () => trimSubtitleCueEnd(state(), { cueId: "z", toEndFrame: 50 }),
    () => deleteSubtitleCue(state(), { cueId: "z" }),
    () =>
      splitSubtitleCue(state(), {
        cueId: "z",
        splitFrame: 30,
        caretIndex: 2,
        expectedTextRevision: 1,
        newCueId: "z2",
      }),
  ])("changes only the selected language", run => {
    const result = run();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.state.tracks).toHaveLength(2);
    expect(result.state.tracks[0]).toEqual(state().tracks[0]);
    expect(result.state.tracks[1].placement).toEqual(
      state().tracks[1].placement
    );
  });
  it("does not merge across languages or reuse another cue identity", () => {
    expect(
      mergeSubtitleCue(state(), { cueId: "z", direction: "previous" }).status
    ).toBe("error");
    expect(
      splitSubtitleCue(state(), {
        cueId: "z",
        splitFrame: 30,
        caretIndex: 2,
        expectedTextRevision: 1,
        newCueId: "e",
      }).status
    ).toBe("error");
  });
  it("moves a second-language speech binding without dropping English", () => {
    const audio = emptyAudioState();
    audio.tracks
      .find(t => t.kind === "narration")!
      .clips.push({
        id: "a",
        assetId: 1,
        timelineStartFrame: 0,
        durationFrames: 60,
        sourceInFrame: 0,
        sourceOutFrame: 60,
        gain: 1,
        muted: false,
        fadeInFrames: 0,
        fadeOutFrames: 0,
      });
    const bound = bindSpeech(state(), audio, {
      subtitleCueId: "z",
      narrationClipId: "a",
      bindingId: "b",
    });
    expect(bound.status).toBe("ok");
    if (bound.status !== "ok") return;
    const moved = moveBoundSpeech(bound.subtitleState, bound.audioState, {
      bindingId: "b",
      deltaFrames: 5,
    });
    expect(moved.status).toBe("ok");
    if (moved.status !== "ok") return;
    expect(moved.subtitleState.tracks[0]).toEqual(state().tracks[0]);
    expect(moved.subtitleState.tracks[1].cues[0].startFrame).toBe(5);
  });
});

it("reflows imported SRT line breaks without changing source or manual text", () => {
  const original = state();
  const cue = original.tracks[0].cues[0];
  cue.text = "reaching out\nto the world.";
  cue.provenance = { kind: "chatcut-cue", cueCode: "srt-10" };
  expect(buildSubtitleRenderPlan(original).cues[0].text).toBe(
    "reaching out to the world."
  );
  expect(cue.text).toContain("\n");
  cue.textEdited = true;
  expect(buildSubtitleRenderPlan(original).cues[0].text).toContain("\n");
});
