import { describe, expect, it } from "vitest";
import {
  resolveTimelineSource,
  timelineSourceCandidateForVisualClip,
} from "./timelineSource";
import type { StoryTimelineItem } from "./storyMaterial";

const item = { stableShotId: "shot", included: true, position: 0, plannedDurationMs: 1000, transform: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 } } satisfies StoryTimelineItem;

describe("timelineSource", () => {
  it("selects the latest containing visual clip over primary", () => {
    const result = resolveTimelineSource({
      item,
      localFrame: 20,
      primary: { sourceType: "primary-video", sourceId: "primary", offsetFrame: 0, durationFrames: 60, sourceStartSec: 0, sourceEndSec: 2 },
      visualClips: [
        { sourceType: "visual-clip", sourceId: "early", offsetFrame: 10, durationFrames: 30, sourceStartSec: 3, sourceEndSec: 4 },
        { sourceType: "visual-clip", sourceId: "late", offsetFrame: 15, durationFrames: 30, sourceStartSec: 5, sourceEndSec: 6 },
      ],
    });
    expect(result).toMatchObject({ kind: "source", sourceType: "visual-clip", sourceId: "late" });
  });

  it("returns a gap when replacement clips do not cover the local frame", () => {
    expect(resolveTimelineSource({
      item,
      localFrame: 40,
      primary: { sourceType: "primary-video", sourceId: "primary", offsetFrame: 0, durationFrames: 60, sourceStartSec: 0, sourceEndSec: 2 },
      visualClips: [{ sourceType: "visual-clip", sourceId: "clip", offsetFrame: 0, durationFrames: 30, sourceStartSec: 0, sourceEndSec: 1 }],
      visualClipsReplacePrimary: true,
    })).toEqual({ kind: "gap", localFrame: 40 });
  });

  it("keeps reverse source time moving from end to start", () => {
    const result = resolveTimelineSource({
      item,
      localFrame: 15,
      primary: {
        sourceType: "primary-video",
        sourceId: "reverse",
        offsetFrame: 0,
        durationFrames: 30,
        sourceStartSec: 0,
        sourceEndSec: 3,
        effects: { playbackRate: 1, reverse: true, volume: 1, muted: false },
      },
    });
    expect(result.kind).toBe("source");
    if (result.kind === "source") expect(result.sourceTimeSec).toBeCloseTo(1.5, 5);
  });

  it("converts persisted visual clips to canonical frame candidates", () => {
    const candidate = timelineSourceCandidateForVisualClip({
      id: "clip",
      takeId: 1,
      rangeId: 1,
      sourceStableShotId: "shot",
      videoUrl: "/video",
      label: "clip",
      sourceStartSec: 0,
      sourceEndSec: 1,
      offsetMs: 500,
      durationMs: 1000,
    });
    expect(candidate).toMatchObject({ offsetFrame: 15, durationFrames: 30 });
  });
});
