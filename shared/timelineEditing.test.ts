import { describe, expect, it } from "vitest";
import type {
  StoryTimelineItem,
  StoryTimelineVisualClip,
  TimelineVideoEffects,
} from "./storyMaterial";
import { buildTimelineLayout } from "./timelineLayout";
import { resolveTimelineItemSource } from "./timelineSource";
import {
  addTimelineAnchor,
  removeTimelineAnchor,
  splitTimelineItem,
  trimTimelineItem,
} from "./timelineEditing";

const base: StoryTimelineItem = {
  stableShotId: "shot",
  included: true,
  position: 0,
  plannedDurationMs: 2000,
  durationFrames: 60,
  timelineStartFrame: 0,
  transform: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 },
};

const source = {
  kind: "source" as const,
  sourceType: "image" as const,
  sourceId: "image-1",
  localFrame: 10,
  sourceTimeSec: null,
  effects: null,
  transform: null,
};

const forwardEffects: TimelineVideoEffects = {
  playbackRate: 1,
  reverse: false,
  volume: 1,
  muted: false,
};
const reverseEffects: TimelineVideoEffects = { ...forwardEffects, reverse: true };

function forwardPrimaryItem(
  effects: TimelineVideoEffects = forwardEffects
): StoryTimelineItem {
  return {
    ...base,
    primaryVideoEdit: {
      takeId: 7,
      sourceStartSec: 1,
      sourceEndSec: 1 + 60 / 30 * effects.playbackRate,
      effects,
    },
  };
}

function clipItem(effects: TimelineVideoEffects): StoryTimelineItem {
  const clip: StoryTimelineVisualClip = {
    id: "clip",
    takeId: 3,
    rangeId: 1,
    sourceStableShotId: "shot",
    videoUrl: "/clip.mp4",
    label: "clip",
    sourceStartSec: 4,
    sourceEndSec: 4 + 60 / 30 * effects.playbackRate,
    offsetMs: 0,
    durationMs: 2000,
    effects,
  };
  return { ...base, visualClips: [clip], visualClipsReplacePrimary: true };
}

/** The visible source second at an absolute timeline frame. */
function sourceTimeAt(item: StoryTimelineItem, frame: number): number | null {
  const row = buildTimelineLayout([item])[0];
  const resolved = resolveTimelineItemSource({
    item,
    localFrame: frame - row.startFrame,
    durationFrames: row.durationFrames,
  });
  return resolved.kind === "source" ? resolved.sourceTimeSec : null;
}

describe("timelineEditing", () => {
  it("adds an anchor on a visible frame and makes duplicate creation idempotent", () => {
    const anchor = { id: "a", timelineFrame: 10, sourceType: "image" as const, sourceId: "image-1", sourceTimeSec: null };
    const added = addTimelineAnchor({ item: base, anchor, resolved: source });
    expect(added.kind).toBe("ok");
    if (added.kind !== "ok") return;
    expect(added.item.anchors).toEqual([anchor]);
    expect(addTimelineAnchor({ item: added.item, anchor, resolved: source })).toMatchObject({ kind: "blocked" });
  });

  it("rejects anchors in a gap", () => {
    expect(addTimelineAnchor({ item: base, anchor: { id: "a", timelineFrame: 10, sourceType: "image", sourceId: "image-1", sourceTimeSec: null }, resolved: { kind: "gap", localFrame: 10 } })).toEqual({ kind: "blocked", reason: "当前时间没有可标记的画面" });
  });

  it("does not trim across the first or last anchor", () => {
    const item = { ...base, anchors: [
      { id: "a", timelineFrame: 20, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
      { id: "b", timelineFrame: 40, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
    ] };
    expect(trimTimelineItem({ item, startFrame: 0, edge: "start", requestedBoundaryFrame: 21 })).toMatchObject({ kind: "blocked", boundaryFrame: 20 });
    expect(trimTimelineItem({ item, startFrame: 0, edge: "end", requestedBoundaryFrame: 40 })).toMatchObject({ kind: "blocked", boundaryFrame: 41 });
    const trimmed = trimTimelineItem({ item, startFrame: 0, edge: "start", requestedBoundaryFrame: 10 });
    expect(trimmed.kind).toBe("ok");
    if (trimmed.kind === "ok") expect(trimmed.item.anchors).toEqual(item.anchors);
  });

  it("partitions anchors exactly once at a safe split", () => {
    const item = { ...base, anchors: [
      { id: "left", timelineFrame: 10, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
      { id: "right", timelineFrame: 40, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
    ] };
    const split = splitTimelineItem({ item, startFrame: 0, cutFrame: 30, leftStableShotId: "left-shot", rightStableShotId: "right-shot" });
    expect(split.kind).toBe("ok");
    if (split.kind === "ok") {
      expect(split.left.anchors?.map(anchor => anchor.id)).toEqual(["left"]);
      expect(split.right.anchors?.map(anchor => anchor.id)).toEqual(["right"]);
      expect(split.right.timelineStartFrame).toBe(30);
    }
    // A cut that lands exactly on an anchor is legal: timeline ranges are
    // half-open, so the anchored frame belongs to the right child alone.
    const atAnchor = splitTimelineItem({ item, startFrame: 0, cutFrame: 40, leftStableShotId: "l", rightStableShotId: "r" });
    expect(atAnchor.kind).toBe("ok");
    if (atAnchor.kind === "ok") {
      expect(atAnchor.left.anchors?.map(anchor => anchor.id)).toEqual(["left"]);
      expect(atAnchor.right.anchors?.map(anchor => anchor.id)).toEqual(["right"]);
      expect(atAnchor.right.timelineStartFrame).toBe(40);
    }
    expect(splitTimelineItem({ item, startFrame: 0, cutFrame: 0, leftStableShotId: "l", rightStableShotId: "r" })).toMatchObject({ kind: "blocked" });
    expect(splitTimelineItem({ item, startFrame: 0, cutFrame: 60, leftStableShotId: "l", rightStableShotId: "r" })).toMatchObject({ kind: "blocked" });
  });

  it("keeps the combined occupied interval and source mapping across a split", () => {
    const item = forwardPrimaryItem();
    const split = splitTimelineItem({ item, startFrame: 0, cutFrame: 30, leftStableShotId: "l", rightStableShotId: "r" });
    expect(split.kind).toBe("ok");
    if (split.kind !== "ok") return;
    const rows = buildTimelineLayout([split.left, split.right]);
    expect(rows[0].startFrame).toBe(0);
    expect(rows.at(-1)!.endFrame).toBe(60);
    // Every original frame still shows the same source frame from its child.
    for (const frame of [0, 15, 29, 30, 45, 59]) {
      const child = frame < 30 ? split.left : split.right;
      expect(sourceTimeAt(child, frame)).toBeCloseTo(sourceTimeAt(item, frame)!, 5);
    }
  });

  it("removes only the requested anchor and unlocks after the final removal", () => {
    const item = { ...base, anchors: [
      { id: "a", timelineFrame: 10, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
      { id: "b", timelineFrame: 20, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
    ] };
    const one = removeTimelineAnchor(item, "a");
    expect(one.kind).toBe("ok");
    if (one.kind !== "ok") return;
    expect(one.item.anchors).toHaveLength(1);
    const last = removeTimelineAnchor(one.item, "b");
    expect(last.kind).toBe("ok");
    if (last.kind === "ok") expect(last.item.anchors).toBeUndefined();
  });
});

describe("anchor-safe trim keeps the anchored picture", () => {
  const cases = [
    { name: "forward primary", item: () => forwardPrimaryItem(forwardEffects) },
    { name: "reverse primary", item: () => forwardPrimaryItem(reverseEffects) },
    {
      name: "forward primary at 2x",
      item: () => forwardPrimaryItem({ ...forwardEffects, playbackRate: 2 }),
    },
    {
      name: "reverse primary at 2x",
      item: () => forwardPrimaryItem({ ...reverseEffects, playbackRate: 2 }),
    },
    { name: "forward visual clip", item: () => clipItem(forwardEffects) },
    { name: "reverse visual clip", item: () => clipItem(reverseEffects) },
    {
      name: "forward visual clip at 0.5x",
      item: () => clipItem({ ...forwardEffects, playbackRate: 0.5 }),
    },
    {
      name: "reverse visual clip at 0.5x",
      item: () => clipItem({ ...reverseEffects, playbackRate: 0.5 }),
    },
  ];

  for (const testCase of cases) {
    for (const edge of ["start", "end"] as const) {
      it(`${testCase.name}: a ${edge} trim preserves every anchored source frame`, () => {
        const anchorFrames = [20, 40];
        const withAnchors = {
          ...testCase.item(),
          anchors: anchorFrames.map(timelineFrame => ({
            id: `a${timelineFrame}`,
            timelineFrame,
            sourceType: "primary-video" as const,
            sourceId: "take-7",
            sourceTimeSec: null,
          })),
        };
        const before = anchorFrames.map(frame => sourceTimeAt(withAnchors, frame));
        expect(before.every(value => value != null)).toBe(true);

        const trimmed = trimTimelineItem({
          item: withAnchors,
          startFrame: 0,
          edge,
          requestedBoundaryFrame: edge === "start" ? 12 : 48,
        });
        expect(trimmed.kind).toBe("ok");
        if (trimmed.kind !== "ok") return;

        const row = buildTimelineLayout([trimmed.item])[0];
        expect(row.startFrame).toBe(edge === "start" ? 12 : 0);
        expect(row.endFrame).toBe(edge === "start" ? 60 : 48);
        for (const [index, frame] of anchorFrames.entries()) {
          expect(sourceTimeAt(trimmed.item, frame)).toBeCloseTo(before[index]!, 5);
        }
      });

      it(`${testCase.name}: extending the ${edge} edge preserves every anchored source frame`, () => {
        const item = {
          ...testCase.item(),
          // Leave room on both sides so an extension is representable.
          timelineStartFrame: 30,
          anchors: [
            {
              id: "a",
              timelineFrame: 60,
              sourceType: "primary-video" as const,
              sourceId: "take-7",
              sourceTimeSec: null,
            },
          ],
        };
        const before = sourceTimeAt(item, 60);
        const trimmed = trimTimelineItem({
          item,
          startFrame: 30,
          edge,
          requestedBoundaryFrame: edge === "start" ? 24 : 96,
          sourceLimitSec: 1000,
        });
        expect(trimmed.kind).toBe("ok");
        if (trimmed.kind !== "ok") return;
        expect(sourceTimeAt(trimmed.item, 60)).toBeCloseTo(before!, 5);
      });
    }
  }

  it("moves a partially covered visual clip with the shot head", () => {
    const item = {
      ...clipItem(forwardEffects),
      visualClips: [
        {
          ...clipItem(forwardEffects).visualClips![0],
          offsetMs: 0,
          durationMs: 1000,
        },
      ],
    };
    const trimmed = trimTimelineItem({ item, startFrame: 0, edge: "start", requestedBoundaryFrame: 15 });
    expect(trimmed.kind).toBe("ok");
    if (trimmed.kind !== "ok") return;
    const clip = trimmed.item.visualClips![0];
    // Head-cutting 15 frames of a 30-frame clip halves it and advances its in point.
    expect(clip.offsetMs).toBe(0);
    expect(clip.durationMs).toBe(500);
    expect(clip.sourceStartSec).toBeCloseTo(4.5, 5);
    expect(clip.sourceEndSec).toBeCloseTo(5, 5);
  });

  it("drops a visual clip the trim removed entirely", () => {
    const item = {
      ...clipItem(forwardEffects),
      visualClips: [
        {
          ...clipItem(forwardEffects).visualClips![0],
          offsetMs: 0,
          durationMs: 500,
        },
      ],
    };
    const trimmed = trimTimelineItem({ item, startFrame: 0, edge: "start", requestedBoundaryFrame: 20 });
    expect(trimmed.kind).toBe("ok");
    if (trimmed.kind === "ok") expect(trimmed.item.visualClips).toEqual([]);
  });

  it("refuses to extend past the available source", () => {
    const item = forwardPrimaryItem();
    // The source in point is at 1 s, so the head can only extend 30 frames.
    expect(
      trimTimelineItem({ item, startFrame: 0, edge: "start", requestedBoundaryFrame: -40 })
    ).toMatchObject({ kind: "blocked", boundaryFrame: 0 });

    const shifted = { ...item, timelineStartFrame: 90 };
    expect(
      trimTimelineItem({ item: shifted, startFrame: 90, edge: "start", requestedBoundaryFrame: 40 })
    ).toMatchObject({ kind: "blocked", reason: "没有更多可用素材", boundaryFrame: 60 });
    expect(
      trimTimelineItem({
        item,
        startFrame: 0,
        edge: "end",
        requestedBoundaryFrame: 200,
        sourceLimitSec: 4,
      })
    ).toMatchObject({ kind: "blocked", reason: "没有更多可用素材", boundaryFrame: 90 });
  });

  it("keeps at least one frame of content", () => {
    const item = forwardPrimaryItem();
    expect(
      trimTimelineItem({ item, startFrame: 0, edge: "start", requestedBoundaryFrame: 60 })
    ).toMatchObject({ kind: "blocked", reason: "镜头至少要保留一帧", boundaryFrame: 59 });
    expect(
      trimTimelineItem({ item, startFrame: 0, edge: "end", requestedBoundaryFrame: 0 })
    ).toMatchObject({ kind: "blocked", reason: "镜头至少要保留一帧", boundaryFrame: 1 });
  });
});
