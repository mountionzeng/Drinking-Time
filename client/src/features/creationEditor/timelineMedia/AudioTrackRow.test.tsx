import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTimelineViewport } from "@shared/timelineViewport";
import {
  emptyAudioState,
  type AudioClip,
  type AudioTrack,
} from "@shared/timelineAudioModel";
import {
  AudioTrackRow,
  AudioTrackSection,
  audioAssetUrl,
  audioClipDragGhost,
  audioClipPlacement,
} from "./AudioTrackRow";
import { cancelTimelinePointerDrag } from "./timelinePointerDrag";

vi.stubGlobal("React", React);

const viewport = createTimelineViewport({ totalMs: 10_000, scale: 24 });
const clip: AudioClip = {
  id: "music-1",
  assetId: 41,
  timelineStartFrame: 30,
  sourceInFrame: 10,
  sourceOutFrame: 100,
  durationFrames: 90,
  gain: 1,
  muted: false,
  fadeInFrames: 0,
  fadeOutFrames: 0,
};
const track: AudioTrack = {
  kind: "music",
  muted: false,
  defaultGain: 1,
  clips: [clip],
};

describe("AudioTrackRow", () => {
  it("uses the owned same-origin asset route and the shared frame viewport", () => {
    expect(audioAssetUrl(12, 41)).toBe("/api/story-audio-asset/12/41");
    expect(audioClipPlacement(clip, viewport)).toEqual({
      leftPx: 24,
      widthPx: 72,
    });
  });

  it("keeps click jitter authoritative and previews no-speed trims", () => {
    expect(
      audioClipDragGhost(clip, {
        kind: "move",
        deltaFrames: 12,
        passedThreshold: false,
      })
    ).toBe(clip);
    expect(
      audioClipDragGhost(clip, {
        kind: "move",
        deltaFrames: 12,
        passedThreshold: true,
      })
    ).toMatchObject({
      timelineStartFrame: 42,
      sourceInFrame: 10,
      sourceOutFrame: 100,
      durationFrames: 90,
    });
    expect(
      audioClipDragGhost(clip, {
        kind: "trim-start",
        deltaFrames: 20,
        passedThreshold: true,
      })
    ).toMatchObject({
      timelineStartFrame: 50,
      sourceInFrame: 30,
      sourceOutFrame: 100,
      durationFrames: 70,
    });
    expect(
      audioClipDragGhost(clip, {
        kind: "trim-end",
        deltaFrames: -200,
        passedThreshold: true,
      })
    ).toMatchObject({
      timelineStartFrame: 30,
      sourceInFrame: 10,
      sourceOutFrame: 11,
      durationFrames: 1,
    });
  });

  it("treats pointer cancellation as rollback instead of a move command", () => {
    const drag = { pointerId: 11, clipId: "music-1" };
    expect(cancelTimelinePointerDrag(drag, 11)).toBeNull();
    expect(cancelTimelinePointerDrag(drag, 12)).toBe(drag);
  });

  it("renders an accessible selected clip with independent trim handles", () => {
    const html = renderToStaticMarkup(
      <AudioTrackRow
        storyId={12}
        track={track}
        viewport={viewport}
        playheadMs={1_000}
        selectedClipId="music-1"
        pending={false}
        error={null}
        onSelectClip={vi.fn()}
        onMove={vi.fn()}
        onTrim={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="storyboard-audio-track-music"');
    expect(html).toContain('data-testid="storyboard-audio-clip-music-1"');
    expect(html).toContain('aria-label="音乐入点"');
    expect(html).toContain('aria-label="音乐出点"');
    expect(html).toContain('data-selected="true"');
  });

  it("folds five empty tracks into one Add Sound row", () => {
    const html = renderToStaticMarkup(
      <AudioTrackSection
        storyId={12}
        audioState={emptyAudioState()}
        viewport={viewport}
        playheadMs={0}
        selectedClipId={null}
        pending={false}
        error={null}
        onSelectClip={vi.fn()}
        onMove={vi.fn()}
        onTrim={vi.fn()}
        onDelete={vi.fn()}
        onRequestAdd={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="storyboard-audio-empty-row"');
    expect(html).toContain("添加声音");
    expect(html).not.toContain('data-testid="storyboard-audio-track-music"');
  });
});
