import { describe, expect, it } from "vitest";
import type { StoryTimelineItem } from "./storyMaterial";
import {
  buildTimelineLayout,
  moveTimelineGroup,
  resolveTimelineFrame,
  selectDirectionalGroup,
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
    expect(moved.map(entry => entry.timelineStartFrame)).toEqual([10, 40, 60]);
    expect(moved[0].stackOrder).toBe(3);
    expect(moved[1].stackOrder).toBe(4);
  });
});
