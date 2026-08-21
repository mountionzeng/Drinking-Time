import { describe, expect, it } from "vitest";
import {
  withTimelineDurationMs,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
} from "./storyMaterial";
import {
  buildTimelineLayout,
  moveTimelineGroup,
  resolveTimelineDocumentFrame,
  resolveTimelineFrame,
  selectDirectionalGroup,
  selectSingleShot,
  timelineTotalFrames,
} from "./timelineLayout";

function item(
  id: string,
  position: number,
  start: number,
  duration = 30,
  extra: Partial<StoryTimelineItem> = {}
): StoryTimelineItem {
  return {
    stableShotId: id,
    included: true,
    position,
    plannedDurationMs: Math.round((duration * 1000) / 30),
    durationFrames: duration,
    timelineStartFrame: start,
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

describe("timelineLayout", () => {
  it("resolves a higher persistent visual layer above overlapping main clips", () => {
    const resolved = resolveTimelineDocumentFrame({
      items: [
        item("lower", 0, 0, 90),
        item("upper", 1, 0, 90, { visualLayer: 1 }),
      ],
      frame: 30,
    });
    expect(resolved.kind).toBe("shot");
    if (resolved.kind === "shot") {
      expect(resolved.row.item.stableShotId).toBe("upper");
    }
  });

  it("keeps explicit gaps and reports maximum end", () => {
    const rows = buildTimelineLayout([
      item("a", 0, 0, 30),
      item("b", 1, 45, 15),
    ]);
    expect(timelineTotalFrames(rows)).toBe(60);
    expect(resolveTimelineFrame(rows, 35)).toEqual({ kind: "gap", frame: 35 });
  });

  it("chooses anchored shots before recently moved shots in overlap", () => {
    const rows = buildTimelineLayout([
      item("recent", 0, 0, 60, { stackOrder: 100 }),
      item("anchored", 1, 15, 30, {
        stackOrder: 1,
        anchors: [
          {
            id: "a1",
            timelineFrame: 20,
            sourceType: "image",
            sourceId: "image-1",
            sourceTimeSec: null,
          },
        ],
      }),
    ]);
    const resolved = resolveTimelineFrame(rows, 25);
    expect(resolved.kind).toBe("shot");
    if (resolved.kind === "shot") expect(resolved.row.item.stableShotId).toBe("anchored");
  });

  it("truncates a directional group at the nearest anchor", () => {
    const rows = buildTimelineLayout([
      item("a", 0, 0),
      item("b", 1, 30),
      item("locked", 2, 60, 30, { anchors: [{ id: "x", timelineFrame: 65, sourceType: "image", sourceId: "i", sourceTimeSec: null }] }),
      item("d", 3, 90),
    ]);
    expect(selectDirectionalGroup(rows, "d", "left")).toMatchObject({
      kind: "ok",
      itemIds: ["d"],
      boundaryItemId: "locked",
    });
    expect(selectDirectionalGroup(rows, "b", "right")).toMatchObject({
      kind: "ok",
      itemIds: ["b"],
      boundaryItemId: "locked",
    });
  });

  it("never groups clips from another visual layer", () => {
    const rows = buildTimelineLayout([
      item("main-a", 0, 0, 30, { visualLayer: 0 }),
      item("upper-video", 1, 0, 30, { visualLayer: 2 }),
      item("main-b", 2, 30, 30, { visualLayer: 0 }),
    ]);
    expect(selectDirectionalGroup(rows, "main-a", "right")).toMatchObject({
      kind: "ok",
      itemIds: ["main-a", "main-b"],
    });
    expect(selectDirectionalGroup(rows, "upper-video", "left")).toMatchObject({
      kind: "ok",
      itemIds: ["upper-video"],
    });
  });

  it("blocks a drag started on an anchored shot", () => {
    const rows = buildTimelineLayout([
      item("a", 0, 0),
      item("locked", 1, 30, 30, { anchors: [{ id: "x", timelineFrame: 35, sourceType: "image", sourceId: "i", sourceTimeSec: null }] }),
    ]);
    expect(selectDirectionalGroup(rows, "locked", "left")).toEqual({
      kind: "blocked",
      reason: "这一镜已有位置锚点，不能整体移动",
    });
  });

  it("moves a selected group by one frame delta and assigns a new priority band", () => {
    const items = [item("a", 0, 0), item("b", 1, 30), item("c", 2, 60)];
    const selection = selectDirectionalGroup(buildTimelineLayout(items), "b", "left");
    expect(selection.kind).toBe("ok");
    if (selection.kind !== "ok") return;
    const moved = moveTimelineGroup(items, selection, 10);
    expect(moved.kind).toBe("ok");
    if (moved.kind !== "ok") return;
    expect(moved.items.map(entry => entry.timelineStartFrame)).toEqual([10, 40, 60]);
    expect(moved.items[0].stackOrder).toBe(3);
    expect(moved.items[1].stackOrder).toBe(4);
    expect(moved.appliedDeltaFrames).toBe(10);
    expect(moved.clampedAtZero).toBe(false);
  });

  it("clamps a group at frame zero and reports the clamp once", () => {
    const items = [item("a", 0, 0), item("b", 1, 30)];
    const selection = selectDirectionalGroup(buildTimelineLayout(items), "b", "left");
    expect(selection.kind).toBe("ok");
    if (selection.kind !== "ok") return;
    const moved = moveTimelineGroup(items, selection, -50);
    expect(moved.kind).toBe("ok");
    if (moved.kind !== "ok") return;
    // The whole group shifts by the same clamped delta, so spacing survives.
    expect(moved.items.map(entry => entry.timelineStartFrame)).toEqual([0, 30]);
    expect(moved.appliedDeltaFrames).toBe(0);
    expect(moved.clampedAtZero).toBe(true);
  });

  it("refuses a move that would exhaust the overlap priority range", () => {
    const items = [
      item("a", 0, 0, 30, { stackOrder: Number.MAX_SAFE_INTEGER - 1 }),
      item("b", 1, 30),
    ];
    const selection = selectDirectionalGroup(buildTimelineLayout(items), "b", "left");
    expect(selection.kind).toBe("ok");
    if (selection.kind !== "ok") return;
    expect(moveTimelineGroup(items, selection, 5)).toEqual({
      kind: "blocked",
      reason: "叠放优先级已达上限，请先整理这条时间轴",
    });
  });

  it("breaks a full tie on stable shot id so every surface agrees", () => {
    const rows = buildTimelineLayout([
      { ...item("zulu", 0, 0, 30), position: 0, stackOrder: 5 },
      { ...item("alpha", 0, 0, 30), position: 0, stackOrder: 5 },
    ]);
    const resolved = resolveTimelineFrame(rows, 10);
    expect(resolved.kind).toBe("shot");
    if (resolved.kind === "shot") {
      expect(resolved.row.item.stableShotId).toBe("alpha");
    }
  });

  it("ignores a duration change that only updated the millisecond projection", () => {
    // 回归：durationFrames 是权威字段，只改 plannedDurationMs 会被陈旧的
    // durationFrames 盖掉，用户看到的就是「一松手又弹回去了」。
    const stale = { ...item("a", 0, 0, 60), plannedDurationMs: 500 };
    expect(buildTimelineLayout([stale])[0].durationFrames).toBe(60);

    const fixed = withTimelineDurationMs(stale, 500);
    expect(fixed.durationFrames).toBe(15);
    expect(buildTimelineLayout([fixed])[0].durationFrames).toBe(15);
  });

  it("keeps frames and milliseconds consistent in both directions", () => {
    const shortened = withTimelineDurationMs(item("a", 0, 0, 60), 1000);
    expect(shortened).toMatchObject({ plannedDurationMs: 1000, durationFrames: 30 });

    const lengthened = withTimelineDurationMs(shortened, 4000);
    expect(lengthened).toMatchObject({ plannedDurationMs: 4000, durationFrames: 120 });

    // 时长有下限，不会被压成 0 帧。
    expect(withTimelineDurationMs(shortened, 0)).toMatchObject({
      plannedDurationMs: 100,
      durationFrames: 3,
    });
  });

  it("selects only the shot itself, ignoring neighbors in either direction", () => {
    const items = [item("a", 0, 0), item("b", 1, 30), item("c", 2, 60)];
    const rows = buildTimelineLayout(items);
    const selection = selectSingleShot(rows, "b");
    expect(selection).toEqual({
      kind: "ok",
      direction: "right",
      itemIds: ["b"],
      boundaryItemId: null,
    });
    const moved = moveTimelineGroup(items, selection as any, 10);
    expect(moved.kind).toBe("ok");
    if (moved.kind !== "ok") return;
    // 只有 b 动了；a、c 原地不动。
    expect(moved.items.map(entry => entry.timelineStartFrame)).toEqual([0, 40, 60]);
  });

  it("blocks a single-shot drag on an anchored shot with a clear reason", () => {
    const items = [
      item("a", 0, 0, 30, {
        anchors: [{ id: "x", timelineFrame: 5, sourceType: "image", sourceId: "i", sourceTimeSec: null }],
      }),
    ];
    const rows = buildTimelineLayout(items);
    expect(selectSingleShot(rows, "a")).toEqual({
      kind: "blocked",
      reason: "这一镜已有位置锚点，不能移动",
    });
  });

  it("reports a missing shot rather than silently selecting nothing", () => {
    const rows = buildTimelineLayout([item("a", 0, 0)]);
    expect(selectSingleShot(rows, "ghost")).toEqual({
      kind: "blocked",
      reason: "镜头不在时间轴中",
    });
  });
});

describe("persisted timeline overlays", () => {
  const overlay: StoryTimelineOverlay = {
    id: "overlay-a",
    kind: "generated-video",
    takeId: 9,
    sourceStableShotId: "a",
    videoUrl: "/video.mp4",
    startFrame: 15,
    targetEndFrame: 120,
    mediaEndFrame: 105,
    endFrame: 120,
    stackOrder: 99,
    leftImageId: 1,
    rightImageId: 2,
    transform: {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
  };

  it("shows complete overlay media and masks its uncovered tail as a gap", () => {
    const items = [item("a", 0, 0, 150)];
    expect(resolveTimelineDocumentFrame({ items, overlays: [overlay], frame: 90 })).toMatchObject({
      kind: "overlay",
      localFrame: 75,
    });
    expect(resolveTimelineDocumentFrame({ items, overlays: [overlay], frame: 110 })).toEqual({
      kind: "gap",
      frame: 110,
    });
  });

  it("keeps an anchored story shot above an overlapping overlay", () => {
    const items = [
      item("locked", 0, 0, 150, {
        anchors: [
          {
            id: "anchor",
            timelineFrame: 20,
            sourceType: "image",
            sourceId: "image-1",
            sourceTimeSec: null,
          },
        ],
      }),
    ];
    expect(resolveTimelineDocumentFrame({ items, overlays: [overlay], frame: 30 })).toMatchObject({
      kind: "shot",
      row: { item: { stableShotId: "locked" } },
    });
  });

  it("allows actual media to extend past the target frame", () => {
    const overrun = { ...overlay, targetEndFrame: 100, mediaEndFrame: 108, endFrame: 108 };
    expect(resolveTimelineDocumentFrame({ items: [], overlays: [overrun], frame: 105 })).toMatchObject({
      kind: "overlay",
    });
  });
});
