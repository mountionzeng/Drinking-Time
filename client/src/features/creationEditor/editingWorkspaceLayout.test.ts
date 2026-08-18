import { describe, expect, it } from "vitest";

import {
  fitProjectCanvas,
  resolveTimelineVideoSource,
  shouldHandleEditingShortcut,
  shouldForwardPreviewPause,
  storyboardAudioClipsFromManifest,
  timelineVideoPlaybackRate,
  timelineVideoShouldHoldLastFrame,
  timelineVideoSourceForSelectedShot,
  timelineAudioTargetSeconds,
  timelineAudioVolume,
  timelineSubtitleText,
  timelineVoiceLaneLabel,
} from "./views/EditingNleWorkspace";
import type { CreationEditorShot } from "./types";
import type { ChatCutTimelineManifest } from "./chatCutTimeline";

describe("editing workspace project canvas", () => {
  it("fits a square project inside the preview stage without changing aspect", () => {
    expect(
      fitProjectCanvas({
        stageWidth: 282,
        stageHeight: 220,
        projectWidth: 1080,
        projectHeight: 1080,
        inset: 12,
      })
    ).toEqual({ width: 208, height: 208 });
  });

  it("fits landscape projects by width or height as space changes", () => {
    expect(
      fitProjectCanvas({
        stageWidth: 400,
        stageHeight: 240,
        projectWidth: 1920,
        projectHeight: 1080,
        inset: 12,
      })
    ).toEqual({ width: 388, height: 218 });

    expect(
      fitProjectCanvas({
        stageWidth: 240,
        stageHeight: 400,
        projectWidth: 1920,
        projectHeight: 1080,
        inset: 12,
      })
    ).toEqual({ width: 228, height: 128 });
  });

  it("falls back to a square and never returns negative dimensions", () => {
    expect(
      fitProjectCanvas({
        stageWidth: 8,
        stageHeight: 8,
        projectWidth: 0,
        projectHeight: Number.NaN,
        inset: 12,
      })
    ).toEqual({ width: 0, height: 0 });
  });

  it("maps the global playhead to imported audio source time", () => {
    const clip = {
      startMs: 1_000,
      endMs: 4_000,
      sourceInMs: 500,
      sourceOutMs: 3_500,
    };
    expect(timelineAudioTargetSeconds(clip, 999)).toBeNull();
    expect(timelineAudioTargetSeconds(clip, 2_250)).toBe(1.75);
    expect(timelineAudioTargetSeconds(clip, 4_000)).toBeNull();
    expect(timelineAudioVolume("BGM-黑暗现代古典.mp3")).toBe(0.18);
    expect(timelineAudioVolume("VO-0101.mp3")).toBe(1);
  });

  it("only lets a direct preview control pause the master timeline", () => {
    const directPause = {
      timelinePlaying: true,
      ignoreNextPause: false,
      mediaIsCurrent: true,
      mediaConnected: true,
      mediaEnded: false,
      lastInteractionAtMs: 1_000,
      nowMs: 1_400,
    };

    expect(shouldForwardPreviewPause(directPause)).toBe(true);
    expect(
      shouldForwardPreviewPause({
        ...directPause,
        lastInteractionAtMs: null,
      })
    ).toBe(false);
    expect(
      shouldForwardPreviewPause({ ...directPause, mediaIsCurrent: false })
    ).toBe(false);
    expect(
      shouldForwardPreviewPause({ ...directPause, mediaConnected: false })
    ).toBe(false);
    expect(
      shouldForwardPreviewPause({ ...directPause, mediaEnded: true })
    ).toBe(false);
    expect(
      shouldForwardPreviewPause({ ...directPause, ignoreNextPause: true })
    ).toBe(false);
    expect(shouldForwardPreviewPause({ ...directPause, nowMs: 3_000 })).toBe(
      false
    );
  });

  it("lets hover shortcuts escape stale button focus without stealing typing", () => {
    const base = {
      key: " ",
      zoneActive: true,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      targetKind: "button" as const,
    };

    expect(shouldHandleEditingShortcut(base)).toBe(true);
    expect(
      shouldHandleEditingShortcut({ ...base, targetKind: "text" })
    ).toBe(false);
    expect(shouldHandleEditingShortcut({ ...base, zoneActive: false })).toBe(
      false
    );
    expect(
      shouldHandleEditingShortcut({ ...base, defaultPrevented: true })
    ).toBe(false);
  });

  it("matches video playback speed to the stretched timeline duration", () => {
    const source = {
      sourceStartSec: 0,
      sourceEndSec: 2.2,
      durationMs: 3_133,
    };

    expect(timelineVideoPlaybackRate(source)).toBeCloseTo(2.2 / 3.133, 5);
    expect(
      timelineVideoPlaybackRate({
        sourceStartSec: 1,
        sourceEndSec: 3,
        durationMs: 2_000,
      })
    ).toBe(1);
  });

  it("holds the last source frame instead of restarting a stretched clip", () => {
    expect(
      timelineVideoShouldHoldLastFrame({
        targetTimeSec: 2.2,
        sourceStartSec: 0,
        sourceEndSec: 2.2,
      })
    ).toBe(true);
    expect(
      timelineVideoShouldHoldLastFrame({
        targetTimeSec: 2.1,
        sourceStartSec: 0,
        sourceEndSec: 2.2,
      })
    ).toBe(false);
  });

  it("uses the active selected take even when it is the primary clip", () => {
    const source = {
      shotNo: 9,
      existingClipId: null,
    } as never;
    expect(timelineVideoSourceForSelectedShot(source, 9)).toBe(source);
    expect(timelineVideoSourceForSelectedShot(source, 10)).toBeNull();
  });

  it("shows the script cue that is actually speaking at the playhead", () => {
    const manifest: ChatCutTimelineManifest = {
      projectName: "SheSelf",
      sequenceName: "main",
      fps: 30,
      width: 1080,
      height: 1080,
      durationMs: 5_000,
      primaryVideoTrackIndex: 1,
      playbackAudioTrackIndexes: [3],
      videoTracks: [],
      audioTracks: [
        {
          index: 1,
          clips: [
            {
              id: "voice-0101",
              name: "VO-0101.mp3",
              mediaKind: "audio",
              audioUrl: "https://media.example/VO-0101.mp3",
              startMs: 1_000,
              endMs: 3_000,
              sourceInMs: 0,
              sourceOutMs: 2_000,
            },
          ],
        },
        {
          index: 3,
          clips: [
            {
              id: "voice-fr-0104",
              name: "FR 0104 - Arabella.mp3",
              mediaKind: "audio",
              audioUrl: "https://media.example/FR-0104.mp3",
              startMs: 1_000,
              endMs: 3_000,
              sourceInMs: 0,
              sourceOutMs: 2_000,
            },
          ],
        },
      ],
      scriptCues: [
        {
          code: "0101",
          text: "我害怕所有的事情。",
          startMs: 1_000,
          endMs: 3_000,
        },
        {
          code: "0104",
          text: "我的一切都需要改造。",
          startMs: 1_000,
          endMs: 3_000,
        },
      ],
    };

    expect(timelineSubtitleText(manifest, 999, "错误的镜头台词")).toBeNull();
    expect(timelineSubtitleText(manifest, 1_500, "错误的镜头台词")).toBe(
      "我的一切都需要改造。"
    );
    expect(timelineVoiceLaneLabel(manifest)).toBe("A3 法语旁白");
    expect(storyboardAudioClipsFromManifest(manifest, 1184)).toEqual([
      expect.objectContaining({
        id: "voice-fr-0104",
        kind: "voice",
        audioUrl: "/api/story-audio/1184/voice-fr-0104",
        startMs: 1_000,
        endMs: 3_000,
      }),
    ]);
    expect(timelineSubtitleText(null, 1_500, "临时镜头台词")).toBe(
      "临时镜头台词"
    );
  });

  it("maps the playhead into a persisted split clip source frame", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-a",
      cueCode: "0101",
      subject: "女主",
      action: "转身",
      dialogue: "台词",
      shotType: "中景",
      beat: "",
      cameraAngle: "",
      cameraMove: "",
      location: "",
      timeLight: "",
      mood: "",
      sound: "",
      styleRef: "",
      note: "",
      emotion: "",
      sourceCardContent: "",
      durationMs: 4_000,
      timelineItem: {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 4_000,
        transform: {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
        visualClipsReplacePrimary: true,
        visualClips: [
          {
            id: "split-right",
            takeId: 22,
            rangeId: 8,
            sourceStableShotId: "shot-a",
            videoUrl: "/api/videos/22",
            label: "0101 · 后段",
            sourceStartSec: 3,
            sourceEndSec: 5,
            offsetMs: 2_000,
            durationMs: 2_000,
          },
        ],
      },
    } as CreationEditorShot;

    expect(resolveTimelineVideoSource([shot], ["shot-a"], 3_000)).toMatchObject(
      {
        stableShotId: "shot-a",
        takeId: 22,
        existingClipId: "split-right",
        sourceStartSec: 3,
        sourceEndSec: 5,
        sourceTimeSec: 4,
      }
    );
  });
});
