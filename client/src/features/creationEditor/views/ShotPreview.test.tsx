/**
 * Preview 的字幕来源合同。
 *
 * 这个仓库的 vitest 跑在 node 环境（没有 jsdom / testing-library），所以这里锁的是
 * ShotPreview 实际消费的那个纯函数 `previewSubtitleLines` —— 它决定 rail 上出现
 * 什么、以及是不是只读候选。组件本身只是把它 map 成 <p>。
 */
import { describe, expect, it } from "vitest";
import { previewSubtitleLines } from "../previewPlaybackModel";
import {
  SUBTITLE_TRACK_ID,
  emptySubtitleState,
  type SubtitleCue,
  type TimelineSubtitleState,
} from "@shared/timelineSubtitleModel";

function cue(overrides: Partial<SubtitleCue>): SubtitleCue {
  return {
    id: "cue",
    startFrame: 0,
    durationFrames: 30,
    text: "文字",
    provenance: { kind: "manual" },
    sourceTextRevision: 0,
    textEdited: false,
    timingEdited: false,
    textRevision: 1,
    ...overrides,
  };
}

function state(cues: SubtitleCue[]): TimelineSubtitleState {
  return { tracks: [{ id: SUBTITLE_TRACK_ID, cues }] };
}

describe("previewSubtitleLines", () => {
  it("shows the formal cue at its head frame and hides it at its end frame", () => {
    const subtitleState = state([
      cue({ id: "a", startFrame: 30, durationFrames: 30, text: "正式字幕" }),
    ]);
    // 头帧 = 30 → 1000ms
    expect(
      previewSubtitleLines({
        subtitleState,
        playheadMs: 1_000,
        legacyManifest: null,
      })
    ).toEqual([{ id: "a", text: "正式字幕", source: "timeline" }]);
    // endFrame = 60 → 2000ms，同一 tick 退出
    expect(
      previewSubtitleLines({
        subtitleState,
        playheadMs: 2_000,
        legacyManifest: null,
      })
    ).toEqual([]);
    expect(
      previewSubtitleLines({
        subtitleState,
        playheadMs: 900,
        legacyManifest: null,
      })
    ).toEqual([]);
  });

  it("shows every overlapping cue together in stable order", () => {
    const subtitleState = state([
      cue({ id: "b", startFrame: 0, durationFrames: 90, text: "长" }),
      cue({ id: "a", startFrame: 0, durationFrames: 45, text: "短" }),
    ]);
    expect(
      previewSubtitleLines({
        subtitleState,
        playheadMs: 300,
        legacyManifest: null,
      }).map(line => line.id)
    ).toEqual(["a", "b"]);
  });

  it("ignores the legacy candidate entirely once a formal track exists", () => {
    const subtitleState = state([
      cue({ id: "a", startFrame: 0, durationFrames: 300, text: "人工改过的" }),
    ]);
    expect(
      previewSubtitleLines({
        subtitleState,
        playheadMs: 500,
        legacyManifest: null,
        fallbackDialogue: "镜头里的旧对白",
      })
    ).toEqual([{ id: "a", text: "人工改过的", source: "timeline" }]);
  });

  it("falls back to a clearly-labelled read-only candidate when there is no formal track", () => {
    expect(
      previewSubtitleLines({
        subtitleState: emptySubtitleState(),
        playheadMs: 500,
        legacyManifest: null,
        fallbackDialogue: "镜头里的旧对白",
      })
    ).toEqual([
      { id: "candidate", text: "镜头里的旧对白", source: "candidate" },
    ]);
    expect(
      previewSubtitleLines({
        subtitleState: null,
        playheadMs: 500,
        legacyManifest: null,
        fallbackDialogue: "镜头里的旧对白",
      })
    ).toEqual([
      { id: "candidate", text: "镜头里的旧对白", source: "candidate" },
    ]);
  });

  it("shows nothing when there is neither a track nor any candidate text", () => {
    expect(
      previewSubtitleLines({
        subtitleState: emptySubtitleState(),
        playheadMs: 0,
        legacyManifest: null,
      })
    ).toEqual([]);
  });
});
