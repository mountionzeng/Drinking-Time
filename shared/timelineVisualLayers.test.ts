import { describe, expect, it } from "vitest";

import type { StoryTimelineItem } from "./storyMaterial";
import {
  insertTimelineVisualLayer,
  moveTimelineVisualLayer,
  normalizeTimelineVisualLayerState,
  removeTimelineVisualLayer,
  toggleTimelineVisualLayerHidden,
} from "./timelineVisualLayers";

const transform = { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 };
const items: StoryTimelineItem[] = [
  {
    stableShotId: "bottom",
    included: true,
    position: 0,
    plannedDurationMs: 1000,
    visualLayer: 0,
    transform,
    imageClips: [{ id: "still", imageId: 1, imageUrl: "/1.png", label: "still", offsetFrames: 0, durationFrames: 1, visualLayer: 2 }],
  },
  {
    stableShotId: "upper",
    included: true,
    position: 1,
    plannedDurationMs: 1000,
    visualLayer: 1,
    transform,
  },
];

describe("timeline visual layer management", () => {
  it("keeps a blank layer above the highest occupied layer", () => {
    expect(normalizeTimelineVisualLayerState(undefined, items)).toEqual({ count: 4, hidden: [] });
  });

  it("inserts a layer and atomically shifts every visual clip kind", () => {
    const result = insertTimelineVisualLayer({ items, state: { count: 4, hidden: [2] }, at: 1 });
    expect(result.items.map(item => item.visualLayer)).toEqual([0, 2]);
    expect(result.items[0].imageClips?.[0].visualLayer).toBe(3);
    expect(result.state).toEqual({ count: 5, hidden: [3] });
  });

  it("moves a whole layer while preserving relative order of the others", () => {
    const result = moveTimelineVisualLayer({ items, state: { count: 4, hidden: [1] }, from: 0, to: 2 });
    expect(result.items.map(item => item.visualLayer)).toEqual([2, 0]);
    expect(result.items[0].imageClips?.[0].visualLayer).toBe(1);
    expect(result.state.hidden).toEqual([0]);
  });

  it("deletes without destroying clips by merging the layer downward", () => {
    const result = removeTimelineVisualLayer({ items, state: { count: 4, hidden: [] }, layer: 1 });
    expect(result.items.map(item => item.visualLayer)).toEqual([0, 0]);
    expect(result.items[0].imageClips?.[0].visualLayer).toBe(1);
    expect(result.state.count).toBe(3);
  });

  it("persists a layer visibility toggle", () => {
    expect(toggleTimelineVisualLayerHidden({ items, state: { count: 4, hidden: [1] }, layer: 1 }).hidden).toEqual([]);
  });
});
