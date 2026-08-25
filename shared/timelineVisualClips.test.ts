import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  timelineMsToFrames,
  timelineOffsetMsToFrames,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
} from "./storyMaterial";
import {
  insertTimelineVisualClip,
  splitOwnedTimelineVisualClip,
} from "./timelineVisualClips";

function item(): StoryTimelineItem {
  return {
    stableShotId: "shot-a",
    included: true,
    position: 0,
    plannedDurationMs: 2_000,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
  };
}

function clip(
  id: string,
  offsetMs: number,
  durationMs: number
): StoryTimelineVisualClip {
  return {
    id,
    takeId: id === "primary" ? 1 : 2,
    rangeId: id === "primary" ? 11 : 12,
    sourceStableShotId: "shot-a",
    videoUrl: `/videos/${id}.mp4`,
    label: id,
    sourceStartSec: 0,
    sourceEndSec: durationMs / 1_000,
    offsetMs,
    durationMs,
  };
}

describe("insertTimelineVisualClip", () => {
  it("preserves the primary video and appends the new clip", () => {
    const result = insertTimelineVisualClip({
      item: item(),
      primaryClip: clip("primary", 0, 2_000),
      clip: clip("new", 0, 1_500),
    });

    expect(result.visualClipsReplacePrimary).toBe(true);
    expect(result.plannedDurationMs).toBe(3_500);
    expect(result.visualClips).toMatchObject([
      { id: "primary", offsetMs: 0, durationMs: 2_000 },
      { id: "new", offsetMs: 2_000, durationMs: 1_500 },
    ]);
  });

  it("inserts at a clip boundary and ripple-shifts following clips", () => {
    const result = insertTimelineVisualClip({
      item: {
        ...item(),
        plannedDurationMs: 4_000,
        visualClipsReplacePrimary: true,
        visualClips: [clip("a", 0, 2_000), clip("b", 2_000, 2_000)],
      },
      clip: clip("new", 0, 1_000),
      targetOffsetMs: 2_000,
    });

    expect(result.plannedDurationMs).toBe(5_000);
    expect(result.visualClips).toMatchObject([
      { id: "a", offsetMs: 0 },
      { id: "new", offsetMs: 2_000 },
      { id: "b", offsetMs: 3_000 },
    ]);
  });

  it("snaps an insertion inside a clip to that clip's end", () => {
    const result = insertTimelineVisualClip({
      item: {
        ...item(),
        visualClipsReplacePrimary: true,
        visualClips: [clip("a", 0, 2_000)],
      },
      clip: clip("new", 0, 500),
      targetOffsetMs: 900,
    });

    expect(result.visualClips).toMatchObject([
      { id: "a", offsetMs: 0 },
      { id: "new", offsetMs: 2_000 },
    ]);
  });
});

describe("splitOwnedTimelineVisualClip", () => {
  it("splits a forward clip at an absolute frame without rippling later clips", () => {
    const original = {
      ...clip("owned", 1_000, 2_000),
      sourceStartSec: 2,
      sourceEndSec: 6,
      effects: {
        playbackRate: 2,
        reverse: false,
        volume: 1,
        muted: false,
        motionPreset: {
          kind: "heartbeat" as const,
          bpm: 80,
          scaleAmount: 0.04,
        },
      },
      transform: { ...DEFAULT_TIMELINE_TRANSFORM, zoom: 1.2 },
      visualLayer: 3,
    };
    const later = clip("later", 3_000, 1_000);
    const source: StoryTimelineItem[] = [
      {
        ...item(),
        timelineStartFrame: 90,
        visualClipsReplacePrimary: true,
        visualClips: [original, later],
      },
    ];
    const result = splitOwnedTimelineVisualClip({
      items: source,
      ownerStableShotId: "shot-a",
      clipId: "owned",
      cutFrame: 150,
      rightClipId: "right",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.items[0].visualClips).toMatchObject([
      {
        id: "owned",
        offsetMs: 1_000,
        durationMs: 1_000,
        sourceStartSec: 2,
        sourceEndSec: 4,
      },
      {
        id: "right",
        offsetMs: 2_000,
        durationMs: 1_000,
        sourceStartSec: 4,
        sourceEndSec: 6,
      },
      { id: "later", offsetMs: 3_000 },
    ]);
    const [left, right] = result.items[0].visualClips!;
    expect(left.effects).not.toBe(original.effects);
    expect(left.effects?.motionPreset).not.toBe(original.effects.motionPreset);
    expect(right.transform).not.toBe(original.transform);
    expect(left.takeId).toBe(original.takeId);
    expect(right.rangeId).toBe(original.rangeId);
  });

  it("mirrors source windows for reverse playback", () => {
    const result = splitOwnedTimelineVisualClip({
      items: [
        {
          ...item(),
          timelineStartFrame: 0,
          visualClips: [
            {
              ...clip("reverse", 0, 2_000),
              sourceStartSec: 10,
              sourceEndSec: 14,
              effects: {
                playbackRate: 2,
                reverse: true,
                volume: 1,
                muted: false,
                motionPreset: null,
              },
            },
          ],
        },
      ],
      ownerStableShotId: "shot-a",
      clipId: "reverse",
      cutFrame: 15,
      rightClipId: "reverse-right",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.items[0].visualClips).toMatchObject([
      { id: "reverse", durationMs: 500, sourceStartSec: 13, sourceEndSec: 14 },
      {
        id: "reverse-right",
        offsetMs: 500,
        durationMs: 1_500,
        sourceStartSec: 10,
        sourceEndSec: 13,
      },
    ]);
  });

  it("rejects wrong owner, occupied identity and cuts that leave zero frames", () => {
    const items = [
      {
        ...item(),
        timelineStartFrame: 30,
        visualClips: [clip("owned", 0, 1_000)],
      },
    ];
    expect(
      splitOwnedTimelineVisualClip({
        items,
        ownerStableShotId: "wrong",
        clipId: "owned",
        cutFrame: 45,
        rightClipId: "right",
      })
    ).toMatchObject({ status: "error" });
    expect(
      splitOwnedTimelineVisualClip({
        items,
        ownerStableShotId: "shot-a",
        clipId: "owned",
        cutFrame: 30,
        rightClipId: "right",
      })
    ).toMatchObject({ status: "error" });
    expect(
      splitOwnedTimelineVisualClip({
        items,
        ownerStableShotId: "shot-a",
        clipId: "owned",
        cutFrame: 45.5,
        rightClipId: "right",
      })
    ).toMatchObject({ status: "error" });
    expect(
      splitOwnedTimelineVisualClip({
        items,
        ownerStableShotId: "shot-a",
        clipId: "owned",
        cutFrame: 45,
        rightClipId: "owned",
      })
    ).toMatchObject({ status: "error" });
  });

  it("resolves an implicit owner start from the complete timeline layout", () => {
    const items: StoryTimelineItem[] = [
      {
        ...item(),
        stableShotId: "before",
        durationFrames: 45,
        plannedDurationMs: 1_500,
      },
      {
        ...item(),
        stableShotId: "implicit-owner",
        position: 1,
        durationFrames: 30,
        plannedDurationMs: 1_000,
        visualClips: [clip("owned", 0, 1_000)],
      },
    ];
    const result = splitOwnedTimelineVisualClip({
      items,
      ownerStableShotId: "implicit-owner",
      clipId: "owned",
      cutFrame: 60,
      rightClipId: "right",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const [left, right] = result.items[1].visualClips!;
    expect(left.durationMs).toBe(500);
    expect(right.offsetMs).toBe(500);
    expect(
      timelineMsToFrames(left.durationMs) + timelineMsToFrames(right.durationMs)
    ).toBe(30);
    expect(45 + timelineOffsetMsToFrames(right.offsetMs)).toBe(60);
  });
});
