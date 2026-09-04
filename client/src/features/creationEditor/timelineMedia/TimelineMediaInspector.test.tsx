import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyAudioState } from "@shared/timelineAudioModel";
import { emptySubtitleState } from "@shared/timelineSubtitleModel";
import { TimelineMediaInspector } from "./TimelineMediaInspector";

vi.stubGlobal("React", React);

const subtitleCallbacks = {
  onSplit: vi.fn(),
  onMerge: vi.fn(),
  onDelete: vi.fn(),
};

describe("TimelineMediaInspector", () => {
  it("shows only audio fields for a music clip", () => {
    const audioState = emptyAudioState();
    audioState.tracks
      .find(track => track.kind === "music")!
      .clips.push({
        id: "music-1",
        assetId: 41,
        timelineStartFrame: 30,
        sourceInFrame: 0,
        sourceOutFrame: 90,
        durationFrames: 90,
        gain: 0.8,
        muted: false,
        fadeInFrames: 5,
        fadeOutFrames: 10,
      });
    const html = renderToStaticMarkup(
      <TimelineMediaInspector
        subtitleState={emptySubtitleState()}
        selectedCue={null}
        audioState={audioState}
        selectedAudioClipId="music-1"
        playheadFrame={45}
        pending={false}
        {...subtitleCallbacks}
        onSetAudioGain={vi.fn()}
        onSetAudioMuted={vi.fn()}
        onSetAudioFade={vi.fn()}
        onReclassifyAudio={vi.fn()}
        onDeleteAudio={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="timeline-media-inspector-audio"');
    expect(html).toContain("音乐 · 素材 #41");
    expect(html).toContain('data-testid="timeline-media-inspector-audio-gain"');
    expect(html).toContain(
      'data-testid="timeline-media-inspector-audio-fade-in"'
    );
    expect(html).not.toContain("在播放头拆分");
    expect(html).not.toContain("重新生成旁白");
  });

  it("makes narration staleness visible without implying automatic generation", () => {
    const audioState = emptyAudioState();
    audioState.tracks
      .find(track => track.kind === "narration")!
      .clips.push({
        id: "voice-1",
        assetId: 42,
        timelineStartFrame: 0,
        sourceInFrame: 0,
        sourceOutFrame: 60,
        durationFrames: 60,
        gain: 1,
        muted: false,
        fadeInFrames: 0,
        fadeOutFrames: 0,
        speechBindingId: "binding-1",
        textStale: true,
      });
    const html = renderToStaticMarkup(
      <TimelineMediaInspector
        subtitleState={emptySubtitleState()}
        selectedCue={null}
        audioState={audioState}
        selectedAudioClipId="voice-1"
        playheadFrame={0}
        pending={false}
        {...subtitleCallbacks}
      />
    );
    expect(html).toContain("字幕文字已变化");
    expect(html).toContain("重新生成不会自动发生");
  });
});
