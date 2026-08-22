import { describe, expect, it, vi } from "vitest";
import type { StoryTimelineItem } from "@shared/storyMaterial";
import { buildTimelineLayout } from "@shared/timelineLayout";
import {
  createTimelineWriteLock,
  planTimelineAnchorAdd,
  planTimelineAnchorRemove,
  planTimelineGroupMove,
  planTimelineMagnetDetach,
  planTimelineRollingTrim,
  planTimelineSingleMove,
  planTimelineTrim,
  resolveTimelineFrameSource,
  timelineAnchorId,
  timelineMagneticJoins,
  snappedTimelineSingleMove,
  type TimelineResolverShot,
} from "./timelineActions";

function item(
  id: string,
  position: number,
  startFrame: number,
  durationFrames = 30,
  extra: Partial<StoryTimelineItem> = {}
): StoryTimelineItem {
  return {
    stableShotId: id,
    included: true,
    position,
    plannedDurationMs: Math.round((durationFrames * 1000) / 30),
    durationFrames,
    timelineStartFrame: startFrame,
    stackOrder: position,
    transform: {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
    ...extra,
  };
}

const anchorOn = (frame: number) => ({
  id: `a${frame}`,
  timelineFrame: frame,
  sourceType: "image" as const,
  sourceId: "image-1",
  sourceTimeSec: null,
});

function shotsWithImages(...ids: string[]): Map<string, TimelineResolverShot> {
  return new Map(
    ids.map(id => [id, { currentImageId: 1 } as TimelineResolverShot])
  );
}

describe("resolveTimelineFrameSource", () => {
  it("reports a gap between shots instead of the neighbouring picture", () => {
    const items = [item("a", 0, 0), item("b", 1, 60)];
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(items),
      shotsById: shotsWithImages("a", "b"),
      timelineFrame: 45,
    });
    expect(resolution).toEqual({ kind: "gap", timelineFrame: 45 });
  });

  it("returns a gap when the winning shot has no material at all", () => {
    const items = [item("a", 0, 0)];
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(items),
      shotsById: new Map(),
      timelineFrame: 10,
    });
    expect(resolution.kind).toBe("gap");
  });

  it("resolves the anchored shot over a more recently moved overlap", () => {
    const items = [
      item("anchored", 0, 0, 60, { anchors: [anchorOn(10)], stackOrder: 0 }),
      item("recent", 1, 0, 60, { stackOrder: 99 }),
    ];
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(items),
      shotsById: shotsWithImages("anchored", "recent"),
      timelineFrame: 30,
    });
    expect(resolution).toMatchObject({
      kind: "source",
      stableShotId: "anchored",
    });
  });

  it("resolves the most recently moved shot when nothing is anchored", () => {
    const items = [
      item("old", 0, 0, 60, { stackOrder: 0 }),
      item("recent", 1, 0, 60, { stackOrder: 99 }),
    ];
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(items),
      shotsById: shotsWithImages("old", "recent"),
      timelineFrame: 30,
    });
    expect(resolution).toMatchObject({
      kind: "source",
      stableShotId: "recent",
    });
  });

  it("resolves persisted overlay media and its uncovered tail through the same preview path", () => {
    const items = [item("a", 0, 0, 150)];
    const overlay = {
      id: "overlay-a",
      kind: "generated-video" as const,
      takeId: 9,
      sourceStableShotId: "a",
      videoUrl: "/overlay.mp4",
      startFrame: 30,
      targetEndFrame: 150,
      mediaEndFrame: 120,
      endFrame: 150,
      stackOrder: 9,
      leftImageId: 1,
      rightImageId: 2,
      transform: item("x", 0, 0).transform,
    };
    expect(
      resolveTimelineFrameSource({
        rows: buildTimelineLayout(items),
        shotsById: shotsWithImages("a"),
        overlays: [overlay],
        timelineFrame: 60,
      })
    ).toMatchObject({
      kind: "source",
      sourceId: "overlay-overlay-a",
      sourceTimeSec: 1,
    });
    expect(
      resolveTimelineFrameSource({
        rows: buildTimelineLayout(items),
        shotsById: shotsWithImages("a"),
        overlays: [overlay],
        timelineFrame: 135,
      })
    ).toEqual({ kind: "gap", timelineFrame: 135 });
  });
});

describe("planTimelineGroupMove", () => {
  it("moves the source shot and its left run while leaving the rest untouched", () => {
    const items = [
      item("a", 0, 30),
      item("b", 1, 60),
      item("c", 2, 90),
      item("d", 3, 120),
    ];
    const plan = planTimelineGroupMove({
      items,
      rows: buildTimelineLayout(items),
      sourceShotId: "c",
      direction: "left",
      deltaFrames: -10,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    // a/b/c share the delta and keep their spacing; d never joins the group.
    expect(plan.items.map(entry => entry.timelineStartFrame)).toEqual([
      20, 50, 80, 120,
    ]);
    expect(plan.items.map(entry => entry.durationFrames)).toEqual([
      30, 30, 30, 30,
    ]);
  });

  it("stops a left group at the nearest anchored shot", () => {
    const items = [
      item("a", 0, 0),
      item("locked", 1, 30, 30, { anchors: [anchorOn(35)] }),
      item("c", 2, 60),
      item("d", 3, 90),
    ];
    const plan = planTimelineGroupMove({
      items,
      rows: buildTimelineLayout(items),
      sourceShotId: "d",
      direction: "left",
      deltaFrames: 12,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items.map(entry => entry.timelineStartFrame)).toEqual([
      0, 30, 72, 102,
    ]);
  });

  it("blocks a group drag started from an anchored shot without proxying a neighbour", () => {
    const items = [
      item("a", 0, 0),
      item("locked", 1, 30, 30, { anchors: [anchorOn(35)] }),
    ];
    expect(
      planTimelineGroupMove({
        items,
        rows: buildTimelineLayout(items),
        sourceShotId: "locked",
        direction: "left",
        deltaFrames: -10,
      })
    ).toEqual({ kind: "blocked", reason: "这一镜已有位置锚点，不能整体移动" });
  });

  it("treats a zero delta as no edit", () => {
    const items = [item("a", 0, 0)];
    expect(
      planTimelineGroupMove({
        items,
        rows: buildTimelineLayout(items),
        sourceShotId: "a",
        direction: "right",
        deltaFrames: 0.4,
      })
    ).toMatchObject({ kind: "blocked" });
  });
});

describe("planTimelineSingleMove", () => {
  it("moves only the dragged shot; contiguous neighbors stay put", () => {
    const items = [item("a", 0, 0), item("b", 1, 30), item("c", 2, 60)];
    const plan = planTimelineSingleMove({
      items,
      rows: buildTimelineLayout(items),
      stableShotId: "b",
      deltaFrames: 10,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items.map(entry => entry.timelineStartFrame)).toEqual([
      0, 40, 60,
    ]);
  });

  it("keeps an upper image clip at its absolute frame when its owning video moves", () => {
    const items = [
      item("bottom", 0, 30, 60, {
        visualLayer: 0,
        imageClips: [
          {
            id: "still-1",
            imageId: 1,
            imageUrl: "/still.webp",
            label: "独立图片",
            offsetFrames: 15,
            durationFrames: 1,
            visualLayer: 2,
          },
        ],
      }),
    ];
    const plan = planTimelineSingleMove({
      items,
      rows: buildTimelineLayout(items),
      stableShotId: "bottom",
      deltaFrames: 10,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[0].timelineStartFrame).toBe(40);
    expect(plan.items[0].imageClips?.[0].timelineStartFrame).toBe(45);
  });

  it("does not proxy to a neighbor when the dragged shot is anchored", () => {
    const items = [
      item("a", 0, 0, 30, { anchors: [anchorOn(5)] }),
      item("b", 1, 30),
    ];
    expect(
      planTimelineSingleMove({
        items,
        rows: buildTimelineLayout(items),
        stableShotId: "a",
        deltaFrames: 10,
      })
    ).toEqual({ kind: "blocked", reason: "这一镜已有位置锚点，不能移动" });
  });

  it("clamps at the timeline start instead of going negative", () => {
    const items = [item("a", 0, 30)];
    const plan = planTimelineSingleMove({
      items,
      rows: buildTimelineLayout(items),
      stableShotId: "a",
      deltaFrames: -100,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[0].timelineStartFrame).toBe(0);
  });

  it("snaps a moved shot to a neighbour inside the magnetic threshold", () => {
    const items = [item("a", 0, 0), item("b", 1, 34)];
    const rows = buildTimelineLayout(items);
    expect(
      snappedTimelineSingleMove({
        rows,
        stableShotId: "b",
        deltaFrames: -2,
        snapThresholdFrames: 3,
      })
    ).toMatchObject({
      deltaFrames: -4,
      join: {
        leftStableShotId: "a",
        rightStableShotId: "b",
        boundaryFrame: 30,
      },
    });
    const plan = planTimelineSingleMove({
      items,
      rows,
      stableShotId: "b",
      deltaFrames: -2,
      snapThresholdFrames: 3,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[1].timelineStartFrame).toBe(30);
  });

  it("snaps a moved shot's end to the following visible start", () => {
    const items = [item("a", 0, 0), item("b", 1, 34)];
    const rows = buildTimelineLayout(items);
    expect(
      snappedTimelineSingleMove({
        rows,
        stableShotId: "a",
        deltaFrames: 2,
        snapThresholdFrames: 3,
      })
    ).toMatchObject({
      deltaFrames: 4,
      join: {
        leftStableShotId: "a",
        rightStableShotId: "b",
        boundaryFrame: 34,
      },
    });
  });

  it("does not snap across a different visible shot covering the candidate seam", () => {
    const items = [
      item("a", 0, 0),
      item("cover", 1, 25, 15, { stackOrder: 10 }),
      item("b", 2, 44),
    ];
    expect(
      snappedTimelineSingleMove({
        rows: buildTimelineLayout(items),
        stableShotId: "b",
        deltaFrames: -12,
        snapThresholdFrames: 3,
      })
    ).toEqual({ deltaFrames: -12, join: null });
  });

  it("does not reattach a pair the user explicitly detached", () => {
    const items = [
      item("a", 0, 0),
      item("b", 1, 34, 30, { detachedFromPreviousShotId: "a" }),
    ];
    const rows = buildTimelineLayout(items);
    expect(
      snappedTimelineSingleMove({
        rows,
        stableShotId: "b",
        deltaFrames: -2,
        snapThresholdFrames: 3,
      })
    ).toEqual({ deltaFrames: -2, join: null });
    const plan = planTimelineSingleMove({
      items,
      rows,
      stableShotId: "b",
      deltaFrames: -2,
      snapThresholdFrames: 3,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[1].timelineStartFrame).toBe(32);
    expect(plan.items[1].detachedFromPreviousShotId).toBeUndefined();
  });
});

describe("magnetic timeline joins", () => {
  it("recognizes only exact, enabled seams", () => {
    const items = [
      item("a", 0, 0),
      item("b", 1, 30),
      item("c", 2, 60, 30, { detachedFromPreviousShotId: "b" }),
    ];
    expect(timelineMagneticJoins(buildTimelineLayout(items))).toEqual([
      { leftStableShotId: "a", rightStableShotId: "b", boundaryFrame: 30 },
    ]);
  });

  it("uses visual placement rather than story position after a shot moves across another", () => {
    const items = [item("story-first", 0, 30), item("story-second", 1, 0)];
    expect(timelineMagneticJoins(buildTimelineLayout(items))).toEqual([
      {
        leftStableShotId: "story-second",
        rightStableShotId: "story-first",
        boundaryFrame: 30,
      },
    ]);
  });

  it("finds the visible seam even when a shorter overlapping shot started between it", () => {
    const items = [
      item("left", 0, 0, 100),
      item("middle", 1, 50, 10, { stackOrder: 10 }),
      item("right", 2, 100, 30),
    ];
    expect(timelineMagneticJoins(buildTimelineLayout(items))).toContainEqual({
      leftStableShotId: "left",
      rightStableShotId: "right",
      boundaryFrame: 100,
    });
  });

  it("rolls both sides of a seam in one plan while keeping the total end fixed", () => {
    const items = [item("a", 0, 0), item("b", 1, 30)];
    const plan = planTimelineRollingTrim({
      items,
      rows: buildTimelineLayout(items),
      leftStableShotId: "a",
      rightStableShotId: "b",
      requestedBoundaryFrame: 36,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(
      plan.items.map(entry => ({
      start: entry.timelineStartFrame,
      duration: entry.durationFrames,
      }))
    ).toEqual([
      { start: 0, duration: 36 },
      { start: 36, duration: 24 },
    ]);
  });

  it("keeps a rolling edit atomic when either side hits an anchor", () => {
    const items = [
      item("a", 0, 0, 30, { anchors: [anchorOn(28)] }),
      item("b", 1, 30),
    ];
    expect(
      planTimelineRollingTrim({
        items,
        rows: buildTimelineLayout(items),
        leftStableShotId: "a",
        rightStableShotId: "b",
        requestedBoundaryFrame: 27,
      })
    ).toEqual({
      kind: "blocked",
      reason: "不能裁掉位置锚点所在画面",
      boundaryFrame: 29,
    });
  });

  it("keeps a rolling edit atomic when the right shot has no source headroom", () => {
    const items = [
      item("a", 0, 0),
      item("b", 1, 30, 30, {
        primaryVideoEdit: {
          takeId: 8,
          sourceStartSec: 0,
          sourceEndSec: 1,
        },
      }),
    ];
    expect(
      planTimelineRollingTrim({
        items,
        rows: buildTimelineLayout(items),
        leftStableShotId: "a",
        rightStableShotId: "b",
        requestedBoundaryFrame: 25,
        rightSourceLimitSec: 1,
      })
    ).toEqual({
      kind: "blocked",
      reason: "没有更多可用素材",
      boundaryFrame: 30,
    });
    expect(items.map(entry => entry.timelineStartFrame)).toEqual([0, 30]);
  });

  it("persists a named opt-out on the right shot", () => {
    const items = [item("a", 0, 0), item("b", 1, 30)];
    const plan = planTimelineMagnetDetach({
      items,
      rows: buildTimelineLayout(items),
      leftStableShotId: "a",
      rightStableShotId: "b",
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[1].detachedFromPreviousShotId).toBe("a");
    expect(timelineMagneticJoins(buildTimelineLayout(plan.items))).toEqual([]);
  });

  it("clears a detachment after an ordinary trim physically separates the pair", () => {
    const items = [
      item("a", 0, 0),
      item("b", 1, 30, 30, { detachedFromPreviousShotId: "a" }),
    ];
    const plan = planTimelineTrim({
      items,
      stableShotId: "a",
      edge: "end",
      requestedBoundaryFrame: 25,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[1].detachedFromPreviousShotId).toBeUndefined();
  });
});

describe("planTimelineAnchorAdd", () => {
  const items = [item("a", 0, 0, 60)];
  const rows = buildTimelineLayout(items);
  const resolution = (frame: number) =>
    resolveTimelineFrameSource({
      rows,
      shotsById: shotsWithImages("a"),
      timelineFrame: frame,
    });

  it("records the resolved source rather than a caller-supplied identity", () => {
    const plan = planTimelineAnchorAdd({ items, resolution: resolution(20) });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.anchorId).toBe(timelineAnchorId("a", 20));
    expect(plan.items[0].anchors).toEqual([
      {
        id: timelineAnchorId("a", 20),
        timelineFrame: 20,
        sourceType: "image",
        sourceId: "image-1",
        sourceTimeSec: null,
      },
    ]);
  });

  it("refuses to mark a gap", () => {
    const gapItems = [item("a", 0, 0, 30), item("b", 1, 90, 30)];
    expect(
      planTimelineAnchorAdd({
        items: gapItems,
        resolution: resolveTimelineFrameSource({
          rows: buildTimelineLayout(gapItems),
          shotsById: shotsWithImages("a", "b"),
          timelineFrame: 60,
        }),
      })
    ).toEqual({ kind: "blocked", reason: "当前时间没有可标记的画面" });
  });

  it("is idempotent at the same frame", () => {
    const first = planTimelineAnchorAdd({ items, resolution: resolution(20) });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(
      planTimelineAnchorAdd({ items: first.items, resolution: resolution(20) })
    ).toMatchObject({ kind: "blocked" });
  });

  it("supports several independent anchors on one shot", () => {
    const first = planTimelineAnchorAdd({ items, resolution: resolution(10) });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    const second = planTimelineAnchorAdd({
      items: first.items,
      resolution: resolution(40),
    });
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.items[0].anchors).toHaveLength(2);
  });
});

describe("planTimelineAnchorRemove", () => {
  it("keeps the shot locked until the final anchor is removed", () => {
    const items = [
      item("a", 0, 0, 60, { anchors: [anchorOn(10), anchorOn(40)] }),
    ];
    const first = planTimelineAnchorRemove({
      items,
      stableShotId: "a",
      anchorId: "a10",
    });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.items[0].anchors).toHaveLength(1);
    expect(
      planTimelineGroupMove({
        items: first.items,
        rows: buildTimelineLayout(first.items),
        sourceShotId: "a",
        direction: "right",
        deltaFrames: 5,
      })
    ).toMatchObject({ kind: "blocked" });

    const last = planTimelineAnchorRemove({
      items: first.items,
      stableShotId: "a",
      anchorId: "a40",
    });
    expect(last.kind).toBe("ok");
    if (last.kind !== "ok") return;
    expect(last.items[0].anchors).toBeUndefined();
    expect(
      planTimelineGroupMove({
        items: last.items,
        rows: buildTimelineLayout(last.items),
        sourceShotId: "a",
        direction: "right",
        deltaFrames: 5,
      })
    ).toMatchObject({ kind: "ok" });
  });

  it("reports a missing anchor rather than saving an unchanged timeline", () => {
    const items = [item("a", 0, 0, 60, { anchors: [anchorOn(10)] })];
    expect(
      planTimelineAnchorRemove({ items, stableShotId: "a", anchorId: "nope" })
    ).toMatchObject({ kind: "blocked" });
  });
});

describe("planTimelineTrim", () => {
  it("surfaces the limiting anchor boundary", () => {
    const items = [item("a", 0, 0, 60, { anchors: [anchorOn(20)] })];
    expect(
      planTimelineTrim({
        items,
        stableShotId: "a",
        edge: "start",
        requestedBoundaryFrame: 30,
      })
    ).toEqual({
      kind: "blocked",
      reason: "不能越过位置锚点",
      boundaryFrame: 20,
    });
  });

  it("commits a trim that stops just at the anchor", () => {
    const items = [item("a", 0, 0, 60, { anchors: [anchorOn(20)] })];
    const plan = planTimelineTrim({
      items,
      stableShotId: "a",
      edge: "start",
      requestedBoundaryFrame: 20,
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.items[0].timelineStartFrame).toBe(20);
    expect(plan.items[0].durationFrames).toBe(40);
    expect(plan.items[0].anchors).toHaveLength(1);
  });
});

describe("createTimelineWriteLock", () => {
  it("ignores a second write while the first is still in flight", async () => {
    const pending: boolean[] = [];
    const lock = createTimelineWriteLock(value => pending.push(value));
    const save = vi.fn(async () => ({ applied: true }));
    let release = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const first = lock.run(
      async () => {
      await gate;
      return save();
      },
      { applied: false, reason: "busy" }
    );
    const second = await lock.run(save, { applied: false, reason: "busy" });

    expect(second).toEqual({ applied: false, reason: "busy" });
    expect(save).not.toHaveBeenCalled();
    release();
    expect(await first).toEqual({ applied: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(pending).toEqual([true, false]);
  });

  it("releases the lock when a write throws", async () => {
    const lock = createTimelineWriteLock();
    await expect(
      lock.run(
        async () => {
        throw new Error("save failed");
        },
        { applied: false }
      )
    ).rejects.toThrow("save failed");
    expect(lock.pending).toBe(false);
    expect(
      await lock.run(async () => ({ applied: true }), { applied: false })
    ).toEqual({
      applied: true,
    });
  });
});
