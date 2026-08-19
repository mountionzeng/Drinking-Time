import { describe, expect, it } from "vitest";
import {
  resolveTimelineSource,
  retimeSourceWindow,
  timelineSourceCandidateForVisualClip,
  timelineSourceRate,
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

  it("consumes an explicit playback rate backwards from the source out point", () => {
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
    // Half a timeline second at 1x consumes half a source second, taken from
    // the out point because the source plays backwards.
    if (result.kind === "source") expect(result.sourceTimeSec).toBeCloseTo(2.5, 5);
  });

  it("infers the rate from the source window when no effects are stored", () => {
    const forward = resolveTimelineSource({
      item,
      localFrame: 15,
      primary: {
        sourceType: "primary-video",
        sourceId: "inferred",
        offsetFrame: 0,
        durationFrames: 30,
        sourceStartSec: 0,
        sourceEndSec: 3,
      },
    });
    expect(forward.kind).toBe("source");
    if (forward.kind === "source") expect(forward.sourceTimeSec).toBeCloseTo(1.5, 5);

    const reverse = resolveTimelineSource({
      item,
      localFrame: 15,
      primary: {
        sourceType: "primary-video",
        sourceId: "inferred-reverse",
        offsetFrame: 0,
        durationFrames: 30,
        sourceStartSec: 0,
        sourceEndSec: 3,
        effects: { playbackRate: 3, reverse: true, volume: 1, muted: false },
      },
    });
    if (reverse.kind === "source") expect(reverse.sourceTimeSec).toBeCloseTo(1.5, 5);
  });

  it("reports the rate used for source mapping", () => {
    expect(
      timelineSourceRate({ sourceStartSec: 0, sourceEndSec: 3, durationFrames: 30 })
    ).toBeCloseTo(3, 5);
    expect(
      timelineSourceRate({
        sourceStartSec: 0,
        sourceEndSec: 3,
        durationFrames: 30,
        effects: { playbackRate: 2, reverse: false, volume: 1, muted: false },
      })
    ).toBeCloseTo(2, 5);
    expect(
      timelineSourceRate({ sourceStartSec: null, sourceEndSec: null, durationFrames: 30 })
    ).toBe(1);
  });

  it("retimes a source window so trimmed frames keep their source time", () => {
    const forward = retimeSourceWindow({
      window: { sourceStartSec: 1, sourceEndSec: 3 },
      rate: 2,
      reverse: false,
      startShiftFrames: 15,
      durationFrames: 15,
    });
    // Cutting 15 frames (0.5 s) at 2x consumes 1 s of source from the head.
    expect(forward.sourceStartSec).toBeCloseTo(2, 5);
    expect(forward.sourceEndSec).toBeCloseTo(3, 5);

    const reverse = retimeSourceWindow({
      window: { sourceStartSec: 1, sourceEndSec: 3 },
      rate: 2,
      reverse: true,
      startShiftFrames: 15,
      durationFrames: 15,
    });
    expect(reverse.sourceEndSec).toBeCloseTo(2, 5);
    expect(reverse.sourceStartSec).toBeCloseTo(1, 5);
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

  it("keeps an offsetMs of 0 at frame 0 while duration still clamps to one frame", () => {
    const candidate = timelineSourceCandidateForVisualClip({
      id: "clip",
      takeId: 1,
      rangeId: 1,
      sourceStableShotId: "shot",
      videoUrl: "/video",
      label: "clip",
      sourceStartSec: 0,
      sourceEndSec: 0.02,
      offsetMs: 0,
      durationMs: 0,
    });
    expect(candidate.offsetFrame).toBe(0);
    expect(candidate.durationFrames).toBe(1);
  });

  it("resolves the first frame of a head-aligned replacement clip", () => {
    const clip = timelineSourceCandidateForVisualClip({
      id: "head",
      takeId: 1,
      rangeId: 1,
      sourceStableShotId: "shot",
      videoUrl: "/video",
      label: "head",
      sourceStartSec: 2,
      sourceEndSec: 3,
      offsetMs: 0,
      durationMs: 1000,
    });
    const result = resolveTimelineSource({
      item,
      localFrame: 0,
      visualClips: [clip],
      visualClipsReplacePrimary: true,
    });
    expect(result).toMatchObject({ kind: "source", sourceId: "head" });
    if (result.kind === "source") expect(result.sourceTimeSec).toBeCloseTo(2, 5);
  });
});
