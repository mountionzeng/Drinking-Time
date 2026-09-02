import {
  timelineAudioTargetSeconds,
  timelineAudioVolume,
} from "./TimelineAudioPlayback";
import { describe, expect, it } from "vitest";

import {
  buildTimelineLanes,
  canEditCurrentVideoFrame,
  duplicatedTimelineImageClipId,
  extractedFrameTargetVisualLayer,
  fitProjectCanvas,
  previewMediaLayerPlan,
  resolveTimelineImageClip,
  resolveTimelineVideoSource,
  selectedShotPlayheadSyncTarget,
  timelineImageWinsVisualOverlap,
  shouldHandleEditingShortcut,
  shouldForwardPreviewPause,
  storyboardAudioClipsFromManifest,
  timelineVideoPlaybackRate,
  timelineVideoShouldHoldLastFrame,
  timelineLaneDomain,
  timelineClipPointerPlacement,
  timelineClipInteractionWidth,
  timelineClipKeyboardPlacement,
  timelinePointerDragExceededThreshold,
  timelineSubtitleText,
  timelineVoiceLaneLabel,
} from "./views/EditingNleWorkspace";
import type { CreationEditorShot } from "./types";
import type { ChatCutTimelineManifest } from "./chatCutTimeline";
import { playableVideoUrl } from "./previewPlaybackModel";

describe("editing workspace project canvas", () => {
  it("layers a one-frame image over video without replacing the video node", () => {
    expect(
      previewMediaLayerPlan({
        timelineImageUrl: "/api/images/frame.png",
        timelineVideoUrl: "/api/videos/take.mp4",
        posterUrl: "/api/images/poster.png",
      })
    ).toEqual({
      videoUrl: "/api/videos/take.mp4",
      overlayImageUrl: "/api/images/frame.png",
      standaloneImageUrl: null,
      posterUrl: "/api/images/poster.png",
    });
  });

  it("only enables current-frame editing for a paused video", () => {
    expect(
      canEditCurrentVideoFrame({
        hasVideo: true,
        timelinePlaying: false,
        extracting: false,
      })
    ).toBe(true);
    expect(
      canEditCurrentVideoFrame({
        hasVideo: true,
        timelinePlaying: true,
        extracting: false,
      })
    ).toBe(false);
    expect(
      canEditCurrentVideoFrame({
        hasVideo: false,
        timelinePlaying: false,
        extracting: false,
      })
    ).toBe(false);
    expect(
      canEditCurrentVideoFrame({
        hasVideo: true,
        timelinePlaying: false,
        extracting: true,
      })
    ).toBe(false);
  });

  it("seeks an explicitly selected shot without feeding playhead-driven selection back into the clock", () => {
    expect(
      selectedShotPlayheadSyncTarget({
        selectedShotNo: 7,
        selectionFromPlayheadShotNo: null,
        timing: { startMs: 23_000 },
      })
    ).toBe(23_000);
    expect(
      selectedShotPlayheadSyncTarget({
        selectedShotNo: 7,
        selectionFromPlayheadShotNo: 7,
        timing: { startMs: 23_000 },
      })
    ).toBeNull();
    expect(
      selectedShotPlayheadSyncTarget({
        selectedShotNo: null,
        selectionFromPlayheadShotNo: null,
        timing: null,
      })
    ).toBeNull();
  });

  it("ignores click jitter until a real pointer drag crosses four pixels", () => {
    expect(
      timelinePointerDragExceededThreshold({
        startClientX: 100,
        startClientY: 100,
        clientX: 102,
        clientY: 102,
      })
    ).toBe(false);
    expect(
      timelinePointerDragExceededThreshold({
        startClientX: 100,
        startClientY: 100,
        clientX: 103,
        clientY: 104,
      })
    ).toBe(true);
  });

  it("maps arrow keys to frame and visual-layer movement for every clip kind", () => {
    expect(
      timelineClipKeyboardPlacement({
        key: "ArrowLeft",
        shiftKey: false,
        visualLayer: 2,
      })
    ).toEqual({ deltaFrames: -1, visualLayer: 2 });
    expect(
      timelineClipKeyboardPlacement({
        key: "ArrowRight",
        shiftKey: true,
        visualLayer: 2,
      })
    ).toEqual({ deltaFrames: 15, visualLayer: 2 });
    expect(
      timelineClipKeyboardPlacement({
        key: "ArrowUp",
        shiftKey: false,
        visualLayer: 2,
      })
    ).toEqual({ deltaFrames: 0, visualLayer: 3 });
    expect(
      timelineClipKeyboardPlacement({
        key: "ArrowDown",
        shiftKey: false,
        visualLayer: 0,
      })
    ).toEqual({ deltaFrames: 0, visualLayer: 0 });
  });
  it("maps one pointer release to both a time delta and a target visual layer", () => {
    expect(
      timelineClipPointerPlacement({
        startClientX: 180,
        releaseClientX: 260,
        pixelsPerSecond: 20,
        targetVisualLayer: 4,
      })
    ).toEqual({ deltaFrames: 120, visualLayer: 4 });
  });

  it("keeps a one-frame image easy to grab without inflating its stored duration", () => {
    expect(
      timelineClipInteractionWidth({
        renderedWidth: 4,
        moveKind: "image",
      })
    ).toBe(28);
    expect(
      timelineClipInteractionWidth({
        renderedWidth: 44,
        moveKind: "image",
      })
    ).toBe(44);
    expect(
      timelineClipInteractionWidth({
        renderedWidth: 4,
        moveKind: "video",
      })
    ).toBe(4);
  });

  it("normalizes pointer placement at the timeline and layer boundaries", () => {
    expect(
      timelineClipPointerPlacement({
        startClientX: 240,
        releaseClientX: 40,
        pixelsPerSecond: 0,
        targetVisualLayer: -3,
      })
    ).toEqual({ deltaFrames: 0, visualLayer: 0 });
  });

  it("extracts from any layer into the immediately adjacent upper layer", () => {
    expect(extractedFrameTargetVisualLayer({ visualLayer: 0 })).toBe(1);
    expect(extractedFrameTargetVisualLayer({ visualLayer: 1 })).toBe(2);
    expect(extractedFrameTargetVisualLayer({ visualLayer: 8 })).toBe(9);
  });

  it("uses the highest visible image or video as the extraction source", () => {
    const image = { clip: { visualLayer: 2 } };
    expect(timelineImageWinsVisualOverlap(image, { visualLayer: 1 })).toBe(
      true
    );
    expect(timelineImageWinsVisualOverlap(image, { visualLayer: 2 })).toBe(
      true
    );
    expect(timelineImageWinsVisualOverlap(image, { visualLayer: 3 })).toBe(
      false
    );
    expect(timelineImageWinsVisualOverlap(null, { visualLayer: 3 })).toBe(
      false
    );
  });

  it("creates independent ids when the same image is extracted again", () => {
    expect(
      duplicatedTimelineImageClipId({
        imageId: 99,
        timelineFrame: 75,
        visualLayer: 2,
        nonce: "second-copy",
      })
    ).toBe("image-clip-99-75-2-second-copy");
  });

  it("resolves an extracted still as an exact one-frame movable image clip", () => {
    const resolved = resolveTimelineImageClip(
      [
        {
          stableShotId: "shot-1",
          included: true,
          position: 0,
          plannedDurationMs: 3_000,
          durationFrames: 90,
          timelineStartFrame: 60,
          transform: {
            cropX: 0,
            cropY: 0,
            cropWidth: 1,
            cropHeight: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
          },
          imageClips: [
            {
              id: "image-clip-99",
              imageId: 99,
              imageUrl: "/frame.webp",
              label: "抽帧",
              offsetFrames: 15,
              durationFrames: 1,
              visualLayer: 1,
            },
          ],
        },
      ],
      75
    );
    expect(resolved).toMatchObject({
      startFrame: 75,
      clip: { id: "image-clip-99", durationFrames: 1, visualLayer: 1 },
    });
    expect(
      resolveTimelineImageClip(
        resolved
          ? [
              {
                stableShotId: "shot-1",
                included: true,
                position: 0,
                plannedDurationMs: 3_000,
                durationFrames: 90,
                timelineStartFrame: 60,
                transform: {
                  cropX: 0,
                  cropY: 0,
                  cropWidth: 1,
                  cropHeight: 1,
                  zoom: 1,
                  panX: 0,
                  panY: 0,
                },
                imageClips: [resolved.clip],
              },
            ]
          : [],
        76
      )
    ).toBeNull();
  });

  it("keeps subtitle and audio lanes outside visual shot selection", () => {
    expect(timelineLaneDomain("captions")).toBe("audio");
    expect(timelineLaneDomain("voice")).toBe("audio");
    expect(timelineLaneDomain("music")).toBe("audio");
    expect(timelineLaneDomain("source-audio")).toBe("audio");
    expect(timelineLaneDomain("primary-video")).toBe("visual");
    expect(timelineLaneDomain("video-2")).toBe("visual");
  });

  it("builds ordinary shots, extracted images and appended videos into their real visual layers", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-1",
      durationMs: 2_000,
      imageId: 7,
      imageUrl: "/shot.webp",
      timelineItem: {
        stableShotId: "shot-1",
        position: 0,
        included: true,
        plannedDurationMs: 2_000,
        durationFrames: 60,
        timelineStartFrame: 30,
        visualLayer: 2,
        imageClips: [
          {
            id: "image-clip-8",
            imageId: 8,
            imageUrl: "/frame.webp",
            label: "抽帧",
            offsetFrames: 0,
            timelineStartFrame: 45,
            durationFrames: 1,
            visualLayer: 3,
          },
        ],
        visualClips: [
          {
            id: "video-clip-9",
            takeId: 9,
            rangeId: 91,
            sourceStableShotId: "shot-1",
            videoUrl: "/take.mp4",
            label: "附加视频",
            sourceStartSec: 0,
            sourceEndSec: 1,
            offsetMs: 500,
            durationMs: 1_000,
            visualLayer: 4,
          },
        ],
      },
    } as CreationEditorShot;

    const lanes = buildTimelineLanes([shot], ["shot-1"], null);
    const visual = lanes.filter(lane => lane.domain === "visual");
    expect(visual.map(lane => lane.visualLayer)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(
      visual.flatMap(lane =>
        lane.clips.map(clip => [
          clip.id,
          clip.moveTarget?.kind,
          lane.visualLayer,
        ])
      )
    ).toEqual(
      expect.arrayContaining([
        ["shot-1", "shot", 2],
        ["image-clip-8", "image", 3],
        ["video-clip-9", "video", 4],
      ])
    );
  });

  it("keeps captions and voice at absolute times when visual shots move, with voice last", () => {
    const manifest = {
      projectName: "fixed-audio",
      sequenceName: "main",
      fps: 30,
      width: 1080,
      height: 1080,
      durationMs: 8_000,
      primaryVideoTrackIndex: 1,
      playbackAudioTrackIndexes: [2],
      videoTracks: [],
      audioTracks: [
        {
          index: 2,
          clips: [
            {
              id: "music-1",
              name: "BGM.mp3",
              mediaKind: "audio",
              audioUrl: "https://media.example/BGM.mp3",
              startMs: 0,
              endMs: 8_000,
              sourceInMs: 0,
              sourceOutMs: 8_000,
            },
            {
              id: "voice-1",
              name: "VO-0101.mp3",
              mediaKind: "audio",
              audioUrl: "https://media.example/VO-0101.mp3",
              startMs: 1_000,
              endMs: 3_000,
              sourceInMs: 0,
              sourceOutMs: 2_000,
            },
            {
              id: "source-audio-1",
              name: "现场原声.wav",
              mediaKind: "audio",
              audioUrl: "https://media.example/source.wav",
              startMs: 1_500,
              endMs: 3_500,
              sourceInMs: 0,
              sourceOutMs: 2_000,
            },
          ],
        },
      ],
      scriptCues: [
        { code: "0101", text: "固定字幕", startMs: 1_000, endMs: 3_000 },
      ],
    } satisfies ChatCutTimelineManifest;
    const visualShot = (timelineStartFrame: number) =>
      ({
        shotNo: 1,
        shotKey: "SH01",
        stableShotId: "shot-1",
        durationMs: 2_000,
        timelineItem: {
          stableShotId: "shot-1",
          position: 0,
          included: true,
          plannedDurationMs: 2_000,
          durationFrames: 60,
          timelineStartFrame,
        },
      }) as CreationEditorShot;

    const before = buildTimelineLanes([visualShot(0)], ["shot-1"], manifest);
    const after = buildTimelineLanes([visualShot(90)], ["shot-1"], manifest);
    const audioSnapshot = (lanes: typeof before) =>
      lanes
        .filter(lane => lane.domain === "audio")
        .map(lane => ({
          id: lane.id,
          clips: lane.clips.map(clip => ({
            id: clip.id,
            startMs: clip.startMs,
            endMs: clip.endMs,
          })),
        }));

    expect(audioSnapshot(after)).toEqual(audioSnapshot(before));
    expect(after.map(lane => lane.id)).toEqual([
      "captions",
      "visual-1",
      "primary-video",
      "music",
      "source-audio",
      "voice",
    ]);
  });

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
    expect(shouldHandleEditingShortcut({ ...base, targetKind: "text" })).toBe(
      false
    );
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

  it("keeps a backing video source alive while a one-frame image wins Preview", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-a",
      cueCode: "0101",
      subject: "女主",
      action: "停留",
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
        durationFrames: 120,
        timelineStartFrame: 0,
        visualLayer: 0,
        imageClips: [
          {
            id: "extracted-frame",
            imageId: 71,
            imageUrl: "/api/images/frame-71.png",
            label: "抽帧 1000ms",
            timelineStartFrame: 30,
            durationFrames: 1,
            visualLayer: 1,
          },
        ],
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
            id: "backing-video",
            takeId: 22,
            rangeId: 8,
            sourceStableShotId: "shot-a",
            videoUrl: "/api/videos/22",
            label: "0101 · 视频",
            sourceStartSec: 0,
            sourceEndSec: 4,
            offsetMs: 0,
            durationMs: 4_000,
          },
        ],
      },
    } as CreationEditorShot;

    expect(resolveTimelineVideoSource([shot], ["shot-a"], 1_000)).toBeNull();
    expect(
      resolveTimelineVideoSource([shot], ["shot-a"], 1_000, [], [], {
        ignoreImageClips: true,
      })
    ).toMatchObject({
      takeId: 22,
      videoUrl: "/api/videos/22",
      sourceTimeSec: 1,
    });
  });

  it("does not offer frame extraction for an unadopted playable video candidate", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-a",
      cueCode: "0101",
      durationMs: 4_000,
      selectedVideoTake: null,
      videoTakes: [
        {
          id: 22,
          stableShotId: "shot-a",
          status: "available",
          videoUrl: "/api/videos/unadopted.mp4",
          durationSec: 4,
        },
      ],
      timelineItem: {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 4_000,
        durationFrames: 120,
        timelineStartFrame: 0,
        visualLayer: 0,
        transform: {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
        visualClips: [],
        imageClips: [],
        visualClipsReplacePrimary: false,
      },
    } as unknown as CreationEditorShot;

    expect(playableVideoUrl(shot)).toBeNull();
    expect(resolveTimelineVideoSource([shot], ["shot-a"], 1_000)).toBeNull();
  });

  it("keeps the original take owner when a structural split child uses primary video", () => {
    const shot = {
      shotNo: 2,
      shotKey: "SH02",
      stableShotId: "split-right",
      cueCode: "0101",
      durationMs: 1_000,
      timelineItem: {
        stableShotId: "split-right",
        included: true,
        position: 1,
        plannedDurationMs: 1_000,
        timelineStartFrame: 30,
        durationFrames: 30,
        transform: {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
        primaryVideoEdit: {
          takeId: 22,
          sourceStartSec: 1,
          sourceEndSec: 2,
          effects: { playbackRate: 1, reverse: false, volume: 1, muted: false },
        },
      },
      videoTakes: [
        {
          id: 22,
          stableShotId: "shot-source",
          status: "available",
          videoUrl: "/api/videos/22",
          durationSec: 3,
        },
      ],
    } as CreationEditorShot;

    expect(
      resolveTimelineVideoSource([shot], ["split-right"], 1_500)
    ).toMatchObject({
      stableShotId: "split-right",
      takeStableShotId: "shot-source",
      takeId: 22,
    });
  });

  it("plays the complete extracted-frame overlay and leaves its uncovered tail blank", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-a",
      cueCode: "0101",
      durationMs: 5_000,
      timelineItem: {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 5_000,
        timelineStartFrame: 0,
        durationFrames: 150,
        transform: {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
      },
    } as CreationEditorShot;
    const overlay = {
      id: "overlay-1",
      kind: "generated-video" as const,
      takeId: 99,
      sourceStableShotId: "shot-a",
      videoUrl: "/api/videos/99",
      startFrame: 30,
      targetEndFrame: 150,
      mediaEndFrame: 120,
      endFrame: 150,
      stackOrder: 1,
      leftImageId: 1649,
      rightImageId: 1650,
      transform: shot.timelineItem!.transform!,
    };

    expect(
      resolveTimelineVideoSource([shot], ["shot-a"], 1_500, [overlay])
    ).toMatchObject({
      overlayId: "overlay-1",
      takeId: 99,
      sourceStartSec: 0,
      sourceEndSec: 3,
      sourceTimeSec: 0.5,
    });
    expect(
      resolveTimelineVideoSource([shot], ["shot-a"], 4_500, [overlay])
    ).toBeNull();
  });
});
