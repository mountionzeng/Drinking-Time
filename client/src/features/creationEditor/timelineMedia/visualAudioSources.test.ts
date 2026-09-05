import { describe, expect, it } from "vitest";
import type { StoryTimelineOverlay } from "@shared/storyMaterial";
import type { StoryboardTimingRow } from "@/features/storyAgent/storyboardTiming";
import type { CreationEditorShot } from "../types";
import { buildBrowserVisualAudioSources } from "./visualAudioSources";

const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

describe("visualAudioSources", () => {
  it("projects primary, inner and overlay video audio without using a visual winner", () => {
    const shot = {
      stableShotId: "shot-a",
      shotNo: 1,
      shotKey: "shot-a",
      cueCode: "0101",
      selectedVideoTake: {
        id: 10,
        stableShotId: "shot-a",
        status: "available",
        videoUrl: "/api/videos/10.mp4",
        durationSec: 4,
        ranges: [],
        selectedRangeId: null,
        selectedSelectionType: null,
        isTimelineSelected: true,
      },
      videoTakes: [],
      timelineItem: {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 3_000,
        durationFrames: 90,
        timelineStartFrame: 30,
        transform,
        primaryVideoEdit: {
          takeId: 10,
          sourceStartSec: 0.5,
          sourceEndSec: 3.5,
          effects: {
            playbackRate: 1,
            reverse: false,
            volume: 0.8,
            muted: false,
          },
        },
        visualClips: [
          {
            id: "inner",
            takeId: 11,
            rangeId: 1,
            sourceStableShotId: "shot-a",
            videoUrl: "/api/videos/11.mp4",
            label: "上层",
            sourceStartSec: 1,
            sourceEndSec: 2,
            offsetMs: 1_000,
            durationMs: 1_000,
            visualLayer: 2,
          },
        ],
      },
    } as unknown as CreationEditorShot;
    const timing: StoryboardTimingRow = {
      stableShotId: "shot-a",
      shotNo: 1,
      position: 0,
      startMs: 1_000,
      endMs: 4_000,
      durationMs: 3_000,
      startFrame: 30,
      durationFrames: 90,
      stackOrder: 0,
      visualLayer: 0,
      anchorFrames: [],
    };
    const overlay: StoryTimelineOverlay = {
      id: "overlay",
      kind: "generated-video",
      takeId: 12,
      sourceStableShotId: "shot-a",
      videoUrl: "/api/videos/12.mp4",
      startFrame: 150,
      targetEndFrame: 210,
      mediaEndFrame: 210,
      endFrame: 210,
      stackOrder: 1,
      leftImageId: 1,
      rightImageId: 2,
      transform,
    };

    const sources = buildBrowserVisualAudioSources({
      shots: [shot],
      timings: [timing],
      overlays: [overlay],
    });

    expect(sources.map(source => source.id)).toEqual([
      "primary:shot-a:take-10",
      "clip:inner",
      "overlay:overlay",
    ]);
    expect(sources[0]).toMatchObject({
      timelineStartFrame: 30,
      sourceInFrame: 15,
      sourceOutFrame: 105,
      durationFrames: 90,
      gain: 0.8,
      sourceUrl: "/api/videos/10.mp4",
    });
    expect(sources[1]).toMatchObject({
      timelineStartFrame: 60,
      sourceInFrame: 30,
      sourceOutFrame: 60,
      durationFrames: 30,
      sourceUrl: "/api/videos/11.mp4",
    });
    expect(sources[2]).toMatchObject({
      timelineStartFrame: 150,
      durationFrames: 60,
      sourceUrl: "/api/videos/12.mp4",
    });
  });

  it("omits a replaced primary visual but keeps its independent inner clips", () => {
    const shot = {
      stableShotId: "shot-a",
      shotNo: 1,
      shotKey: "shot-a",
      selectedVideoTake: {
        id: 10,
        stableShotId: "shot-a",
        status: "available",
        videoUrl: "/10.mp4",
        durationSec: 3,
        ranges: [],
      },
      timelineItem: {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 3_000,
        durationFrames: 90,
        transform,
        visualClipsReplacePrimary: true,
        visualClips: [
          {
            id: "inner",
            takeId: 11,
            rangeId: 1,
            sourceStableShotId: "shot-a",
            videoUrl: "/11.mp4",
            label: "only",
            sourceStartSec: 0,
            sourceEndSec: 3,
            offsetMs: 0,
            durationMs: 3_000,
          },
        ],
      },
    } as unknown as CreationEditorShot;
    const timing = {
      stableShotId: "shot-a",
      shotNo: 1,
      position: 0,
      startMs: 0,
      endMs: 3_000,
      durationMs: 3_000,
      startFrame: 0,
      durationFrames: 90,
      stackOrder: 0,
      visualLayer: 0,
      anchorFrames: [],
    } satisfies StoryboardTimingRow;

    expect(
      buildBrowserVisualAudioSources({
        shots: [shot],
        timings: [timing],
        overlays: [],
      }).map(source => source.id)
    ).toEqual(["clip:inner"]);
  });
});
