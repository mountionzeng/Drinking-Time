import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryTimelineItem,
} from "../../shared/storyMaterial";
import { resolveTimelineFrameExtraction } from "./timelineFrameExtraction";

function item(
  stableShotId: string,
  input: Partial<StoryTimelineItem> = {}
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position: 0,
    plannedDurationMs: 2_000,
    timelineStartFrame: 0,
    durationFrames: 60,
    visualLayer: 0,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    ...input,
  };
}

describe("resolveTimelineFrameExtraction", () => {
  it("reuses the exact winning image asset", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 12,
      document: {
        items: [
          item("shot-a", {
            imageClips: [
              {
                id: "image-clip-a",
                imageId: 77,
                imageUrl: "/images/77.png",
                label: "抽帧",
                offsetFrames: 12,
                timelineStartFrame: 12,
                durationFrames: 1,
                visualLayer: 2,
              },
            ],
          }),
        ],
      },
    });

    expect(result).toEqual({
      status: "ok",
      descriptor: {
        kind: "image",
        timelineFrame: 12,
        visualLayer: 2,
        winnerIdentity: "image-clip:image-clip-a",
        clipId: "image-clip-a",
        ownerStableShotId: "shot-a",
        imageId: 77,
        imageUrl: "/images/77.png",
      },
    });
  });

  it("keeps an anchored shot authoritative over a higher ordinary image", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 12,
      document: {
        items: [
          item("anchored", {
            anchors: [
              {
                id: "anchor-a",
                timelineFrame: 12,
                sourceType: "primary-video",
                sourceId: "take:11",
                sourceTimeSec: 0.4,
              },
            ],
            primaryVideoEdit: {
              takeId: 11,
              sourceStartSec: 0,
              sourceEndSec: 2,
              effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
            },
          }),
          item("image-owner", {
            position: 1,
            visualLayer: 1,
            imageClips: [
              {
                id: "higher-image",
                imageId: 88,
                imageUrl: "/images/88.png",
                label: "高层图",
                offsetFrames: 12,
                timelineStartFrame: 12,
                durationFrames: 1,
                visualLayer: 3,
              },
            ],
          }),
        ],
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      descriptor: {
        kind: "video",
        takeId: 11,
        ownerStableShotId: "anchored",
        winnerIdentity: "story-shot:anchored:primary",
        atSec: 0.4,
      },
    });
  });

  it("maps an owned clip frame into its edited source range", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 45,
      document: {
        items: [
          item("shot-a", {
            visualClips: [
              {
                id: "owned-a",
                takeId: 22,
                rangeId: 5,
                sourceStableShotId: "source-a",
                videoUrl: "/video.mp4",
                label: "内部片段",
                sourceStartSec: 2,
                sourceEndSec: 4,
                offsetMs: 1_000,
                durationMs: 1_000,
                visualLayer: 0,
                effects: {
                  ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
                  playbackRate: 2,
                },
              },
            ],
          }),
        ],
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      descriptor: {
        kind: "video",
        takeId: 22,
        rangeId: 5,
        sourceStableShotId: "source-a",
        ownerStableShotId: "shot-a",
        sourceClipId: "owned-a",
        winnerIdentity: "owned-video-clip:shot-a:owned-a",
        atSec: 3,
      },
    });
  });

  it("uses the selected current Take when the timeline has no explicit primary edit", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 30,
      document: { items: [item("shot-a")] },
      currentVideosByShot: new Map([
        [
          "shot-a",
          {
            takeId: 33,
            durationSec: 4,
            rangeId: 9,
            sourceStartSec: 1,
            sourceEndSec: 3,
          },
        ],
      ]),
    });

    expect(result).toMatchObject({
      status: "ok",
      descriptor: {
        kind: "video",
        takeId: 33,
        rangeId: 9,
        atSec: 2,
      },
    });
  });

  it("returns explicit failures for gaps, hidden winners, and undecodable rows", () => {
    expect(
      resolveTimelineFrameExtraction({
        timelineFrame: 90,
        document: { items: [item("shot-a")] },
      })
    ).toEqual({ status: "error", error: "gap" });

    expect(
      resolveTimelineFrameExtraction({
        timelineFrame: 12,
        hiddenVisualLayers: [0],
        document: {
          items: [
            item("shot-a", {
              primaryVideoEdit: {
                takeId: 11,
                sourceStartSec: 0,
                sourceEndSec: 2,
                effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
              },
            }),
          ],
        },
      })
    ).toEqual({ status: "error", error: "gap" });

    expect(
      resolveTimelineFrameExtraction({
        timelineFrame: 12,
        document: { items: [item("shot-a")] },
      })
    ).toEqual({ status: "error", error: "media-unavailable" });
  });
});
