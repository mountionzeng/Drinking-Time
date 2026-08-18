import { describe, expect, it } from "vitest";
import type { StoryTimelineItem } from "./storyMaterial";
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
    expect(trimTimelineItem({ item, edge: "start", requestedBoundaryFrame: 21 })).toMatchObject({ kind: "blocked", boundaryFrame: 20 });
    expect(trimTimelineItem({ item, edge: "end", requestedBoundaryFrame: 40 })).toMatchObject({ kind: "blocked", boundaryFrame: 41 });
    const trimmed = trimTimelineItem({ item, edge: "start", requestedBoundaryFrame: 10 });
    expect(trimmed.kind).toBe("ok");
    if (trimmed.kind === "ok") expect(trimmed.item.anchors).toEqual(item.anchors);
  });

  it("partitions anchors exactly once at a safe split", () => {
    const item = { ...base, anchors: [
      { id: "left", timelineFrame: 10, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
      { id: "right", timelineFrame: 40, sourceType: "image" as const, sourceId: "i", sourceTimeSec: null },
    ] };
    const split = splitTimelineItem({ item, cutFrame: 30, leftStableShotId: "left-shot", rightStableShotId: "right-shot" });
    expect(split.kind).toBe("ok");
    if (split.kind === "ok") {
      expect(split.left.anchors?.map(anchor => anchor.id)).toEqual(["left"]);
      expect(split.right.anchors?.map(anchor => anchor.id)).toEqual(["right"]);
      expect(split.right.timelineStartFrame).toBe(30);
    }
    expect(splitTimelineItem({ item, cutFrame: 40, leftStableShotId: "l", rightStableShotId: "r" })).toMatchObject({ kind: "blocked" });
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
