import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
} from "./storyMaterial";
import { insertTimelineVisualClip } from "./timelineVisualClips";

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
