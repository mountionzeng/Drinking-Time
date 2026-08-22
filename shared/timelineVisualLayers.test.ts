import { describe, expect, it } from "vitest";

import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "./storyMaterial";
import {
  applyTimelineVisualLayerAction,
  canRemoveTimelineVisualLayer,
  countTimelineVisualLayerClips,
  highestUsedVisualLayer,
  insertTimelineVisualLayer,
  moveTimelineVisualLayer,
  normalizePersistedVisualLayerState,
  removeTimelineVisualLayer,
  resolveTimelineVisualLayerState,
  toggleTimelineVisualLayerHidden,
} from "./timelineVisualLayers";

const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

function item(
  stableShotId: string,
  position: number,
  visualLayer: number,
  extra: Partial<StoryTimelineItem> = {}
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position,
    plannedDurationMs: 1000,
    visualLayer,
    transform,
    ...extra,
  };
}

function imageClip(id: string, visualLayer: number) {
  return {
    id,
    imageId: 1,
    imageUrl: "/1.png",
    label: "still",
    offsetFrames: 0,
    durationFrames: 1,
    visualLayer,
  };
}

function visualClip(id: string, visualLayer: number) {
  return {
    id,
    takeId: 7,
    rangeId: 1,
    sourceStableShotId: "bottom",
    videoUrl: "/7.mp4",
    label: "legacy",
    sourceStartSec: 0,
    sourceEndSec: 1,
    offsetMs: 0,
    durationMs: 1000,
    visualLayer,
  };
}

function overlay(id: string, visualLayer?: number): StoryTimelineOverlay {
  return {
    id,
    kind: "generated-video",
    takeId: 9,
    sourceStableShotId: "legacy-shot",
    videoUrl: "/9.mp4",
    startFrame: 0,
    targetEndFrame: 30,
    mediaEndFrame: 30,
    endFrame: 30,
    stackOrder: 0,
    ...(visualLayer === undefined ? {} : { visualLayer }),
    leftImageId: 1,
    rightImageId: 2,
    transform,
  };
}

/** 底层视频 + 上层视频 + 更上层的一帧图片 + 旧视频片段：四种素材各一份。 */
const items: StoryTimelineItem[] = [
  item("bottom", 0, 0, {
    imageClips: [imageClip("still", 2)],
    visualClips: [visualClip("legacy-clip", 1)],
  }),
  item("upper", 1, 1),
];

describe("视觉图层状态语义", () => {
  it("显式层数之上永远算出一层空白投放层", () => {
    const resolved = resolveTimelineVisualLayerState(undefined, items);
    expect(highestUsedVisualLayer(items)).toBe(2);
    expect(resolved.count).toBe(4);
    expect(resolved.explicitCount).toBe(1);
    expect(resolved.hidden).toEqual([]);
  });

  it("空白顶层是派生的：素材拖上顶层再拖回来，层数必须缩回去", () => {
    const state: StoryTimelineVisualLayerState = { count: 1, hidden: [] };
    const before = resolveTimelineVisualLayerState(state, items);
    const liftedUp = items.map(entry =>
      entry.stableShotId === "upper" ? { ...entry, visualLayer: 3 } : entry
    );
    expect(resolveTimelineVisualLayerState(state, liftedUp).count).toBe(5);
    // 拖回原层：不留下任何多出来的空层。
    expect(resolveTimelineVisualLayerState(state, items).count).toBe(before.count);
  });

  it("落库形态不含派生层，只记显式层数和隐藏集合", () => {
    expect(
      normalizePersistedVisualLayerState({ count: 3, hidden: [2, 2, 1] })
    ).toEqual({ count: 3, hidden: [1, 2] });
  });

  it("遗留 overlay 参与层数计算，默认占兼容层 1", () => {
    expect(highestUsedVisualLayer([item("solo", 0, 0)], [overlay("o1")])).toBe(1);
    expect(
      highestUsedVisualLayer([item("solo", 0, 0)], [overlay("o1", 3)])
    ).toBe(3);
  });
});

describe("图层操作原子重映射四种素材", () => {
  it("插入图层同时抬高镜头、图片、旧片段和遗留 overlay", () => {
    const result = insertTimelineVisualLayer({
      items,
      overlays: [overlay("o1")],
      state: { count: 4, hidden: [2] },
      at: 1,
    });
    expect(result.items.map(entry => entry.visualLayer)).toEqual([0, 2]);
    expect(result.items[0].imageClips?.[0].visualLayer).toBe(3);
    expect(result.items[0].visualClips?.[0].visualLayer).toBe(2);
    expect(result.overlays[0].visualLayer).toBe(2);
    expect(result.state.hidden).toEqual([3]);
  });

  it("插入一次一定多一层，不会被派生层吃掉", () => {
    const state: StoryTimelineVisualLayerState = { count: 1, hidden: [] };
    const before = resolveTimelineVisualLayerState(state, items).count;
    const result = insertTimelineVisualLayer({ items, state, at: 3 });
    expect(
      resolveTimelineVisualLayerState(result.state, result.items).count
    ).toBe(before + 1);
  });

  it("整层排序保持其余层的相对顺序，并带上全部素材", () => {
    const result = moveTimelineVisualLayer({
      items,
      overlays: [overlay("o1")],
      state: { count: 4, hidden: [1] },
      from: 0,
      to: 2,
    });
    expect(result.items.map(entry => entry.visualLayer)).toEqual([2, 0]);
    expect(result.items[0].imageClips?.[0].visualLayer).toBe(1);
    expect(result.items[0].visualClips?.[0].visualLayer).toBe(0);
    expect(result.overlays[0].visualLayer).toBe(0);
    expect(result.state.hidden).toEqual([0]);
  });

  it("整层排序可以往返，回到原始层级", () => {
    const state: StoryTimelineVisualLayerState = { count: 4, hidden: [] };
    const up = moveTimelineVisualLayer({ items, state, from: 1, to: 3 });
    const back = moveTimelineVisualLayer({
      items: up.items,
      state: up.state,
      from: 3,
      to: 1,
    });
    expect(back.items.map(entry => entry.visualLayer)).toEqual(
      items.map(entry => entry.visualLayer)
    );
    expect(back.items[0].imageClips?.[0].visualLayer).toBe(2);
  });

  it("删除非空层保留素材，合并到相邻层", () => {
    const before = countTimelineVisualLayerClips(items, 1);
    const result = removeTimelineVisualLayer({
      items,
      overlays: [overlay("o1")],
      state: { count: 4, hidden: [] },
      layer: 1,
    });
    expect(before).toBe(2); // upper 镜头 + 旧片段
    expect(result.items.map(entry => entry.visualLayer)).toEqual([0, 0]);
    expect(result.items[0].imageClips?.[0].visualLayer).toBe(1);
    expect(result.items[0].visualClips?.[0].visualLayer).toBe(0);
    expect(result.overlays[0].visualLayer).toBe(0);
    // 素材一个都不能少。
    expect(
      countTimelineVisualLayerClips(result.items, 0, result.overlays)
    ).toBe(4);
  });

  it("最高那层空白投放层删不掉，按钮必须显示为禁用而不是假装成功", () => {
    const state: StoryTimelineVisualLayerState = { count: 1, hidden: [] };
    const resolved = resolveTimelineVisualLayerState(state, items);
    const topLayer = resolved.count - 1;
    expect(countTimelineVisualLayerClips(items, topLayer)).toBe(0);
    expect(canRemoveTimelineVisualLayer({ items, state, layer: topLayer })).toBe(
      false
    );
    const attempted = removeTimelineVisualLayer({ items, state, layer: topLayer });
    expect(
      resolveTimelineVisualLayerState(attempted.state, attempted.items).count
    ).toBe(resolved.count);
  });

  it("显式建出来的空层删得掉", () => {
    const state: StoryTimelineVisualLayerState = { count: 6, hidden: [] };
    expect(canRemoveTimelineVisualLayer({ items, state, layer: 4 })).toBe(true);
    const result = removeTimelineVisualLayer({ items, state, layer: 4 });
    expect(
      resolveTimelineVisualLayerState(result.state, result.items).count
    ).toBe(5);
  });
});

describe("显隐", () => {
  it("切换显隐只改隐藏集合，素材层级原样不动", () => {
    const shown = toggleTimelineVisualLayerHidden({
      items,
      state: { count: 4, hidden: [1] },
      layer: 1,
    });
    expect(shown.hidden).toEqual([]);
    const hiddenAgain = toggleTimelineVisualLayerHidden({
      items,
      state: shown,
      layer: 1,
    });
    expect(hiddenAgain.hidden).toEqual([1]);
    const change = applyTimelineVisualLayerAction({
      items,
      state: { count: 4, hidden: [] },
      action: { kind: "toggle-hidden", layer: 2 },
    });
    expect(change.items.map(entry => entry.visualLayer)).toEqual([0, 1]);
    expect(change.items[0].imageClips?.[0].visualLayer).toBe(2);
    expect(change.state.hidden).toEqual([2]);
  });

  it("隐藏集合跟着图层重排一起搬家", () => {
    const change = applyTimelineVisualLayerAction({
      items,
      state: { count: 4, hidden: [2] },
      action: { kind: "move", from: 2, to: 0 },
    });
    expect(change.state.hidden).toEqual([0]);
    expect(change.items[0].imageClips?.[0].visualLayer).toBe(0);
  });
});
