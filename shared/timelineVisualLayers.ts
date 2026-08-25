import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "./storyMaterial";
import {
  hiddenVisualLayerSet,
  normalizeVisualLayer,
} from "./timelineVisualPriority";

/**
 * 一次图层操作的完整结果。图片（imageClips）、视频镜头（item.visualLayer）、
 * 旧视频片段（visualClips）和遗留 overlay 必须在同一次写入里一起重编号，
 * 少改一种素材就会出现「有的跟着换层、有的留在原地」。
 */
export type TimelineVisualLayerChange = {
  items: StoryTimelineItem[];
  overlays: StoryTimelineOverlay[];
  /** 要落库的显式层数与隐藏集合。 */
  state: StoryTimelineVisualLayerState;
};

export type TimelineVisualLayerAction =
  | { kind: "insert"; at: number }
  | { kind: "move"; from: number; to: number }
  | { kind: "remove"; layer: number }
  | { kind: "toggle-hidden"; layer: number };

/** 渲染用的图层视图：`count` 已经含上那一层派生的空白投放层。 */
export type ResolvedTimelineVisualLayerState = {
  /** 实际要画出来的层数（显式层 + 最高的空白投放层）。 */
  count: number;
  /** 落库的显式层数。 */
  explicitCount: number;
  hidden: number[];
};

const MINIMUM_VISUAL_LAYER_COUNT = 2;

function layerOf(value: number | undefined): number {
  return normalizeVisualLayer(value);
}

export function highestUsedVisualLayer(
  items: readonly StoryTimelineItem[],
  overlays: readonly StoryTimelineOverlay[] = []
): number {
  return Math.max(
    0,
    ...items.flatMap(item => [
      layerOf(item.visualLayer),
      ...(item.imageClips ?? []).map(clip => layerOf(clip.visualLayer)),
      ...(item.visualClips ?? []).map(clip => layerOf(clip.visualLayer)),
    ]),
    ...overlays.map(overlay =>
      overlay.visualLayer == null ? 1 : layerOf(overlay.visualLayer)
    )
  );
}

/** 落库形态：只清洗显式层数与隐藏集合，不掺派生的空白层。 */
export function normalizePersistedVisualLayerState(
  state: StoryTimelineVisualLayerState | null | undefined
): StoryTimelineVisualLayerState {
  const count = Math.max(1, Math.round(state?.count ?? 0));
  return {
    count,
    hidden: Array.from(new Set((state?.hidden ?? []).map(layerOf))).sort(
      (left, right) => left - right
    ),
  };
}

/**
 * 渲染形态：显式层数之上再保证一层空白投放层。
 *
 * 这一层是**算出来**的，不回写数据库：素材拖上去时层数自然长高，拖回来时
 * 自然缩回；只有「插入图层」这种明确动作才会让 explicitCount 永久变化。
 */
export function resolveTimelineVisualLayerState(
  state: StoryTimelineVisualLayerState | null | undefined,
  items: readonly StoryTimelineItem[],
  overlays: readonly StoryTimelineOverlay[] = []
): ResolvedTimelineVisualLayerState {
  const persisted = normalizePersistedVisualLayerState(state);
  const count = Math.max(
    MINIMUM_VISUAL_LAYER_COUNT,
    persisted.count,
    highestUsedVisualLayer(items, overlays) + 2
  );
  return {
    count,
    explicitCount: persisted.count,
    hidden: persisted.hidden.filter(layer => layer < count),
  };
}

/**
 * 旧名字保留给只关心「画几层 / 哪几层隐藏」的调用点。
 * 注意它返回的 `count` 是渲染层数，**不能**直接落库。
 */
export function normalizeTimelineVisualLayerState(
  state: StoryTimelineVisualLayerState | null | undefined,
  items: readonly StoryTimelineItem[],
  overlays: readonly StoryTimelineOverlay[] = []
): ResolvedTimelineVisualLayerState {
  return resolveTimelineVisualLayerState(state, items, overlays);
}

function remapItems(
  items: readonly StoryTimelineItem[],
  remap: (layer: number) => number
): StoryTimelineItem[] {
  return items.map(item => ({
    ...item,
    visualLayer: remap(layerOf(item.visualLayer)),
    ...(item.imageClips === undefined
      ? {}
      : {
          imageClips: item.imageClips.map(clip => ({
            ...clip,
            visualLayer: remap(layerOf(clip.visualLayer)),
          })),
        }),
    ...(item.visualClips === undefined
      ? {}
      : {
          visualClips: item.visualClips.map(clip => ({
            ...clip,
            visualLayer: remap(layerOf(clip.visualLayer)),
          })),
        }),
  }));
}

function remapOverlays(
  overlays: readonly StoryTimelineOverlay[],
  remap: (layer: number) => number
): StoryTimelineOverlay[] {
  return overlays.map(overlay => ({
    ...overlay,
    visualLayer: remap(overlay.visualLayer == null ? 1 : layerOf(overlay.visualLayer)),
  }));
}

type LayerInput = {
  items: readonly StoryTimelineItem[];
  overlays?: readonly StoryTimelineOverlay[];
  state?: StoryTimelineVisualLayerState | null;
};

function applyRemap(
  input: LayerInput,
  remap: (layer: number) => number,
  hidden: readonly number[],
  explicitCount: number
): TimelineVisualLayerChange {
  const items = remapItems(input.items, remap);
  const overlays = remapOverlays(input.overlays ?? [], remap);
  return {
    items,
    overlays,
    state: normalizePersistedVisualLayerState({
      count: explicitCount,
      hidden: [...hidden],
    }),
  };
}

export function insertTimelineVisualLayer(
  input: LayerInput & { at: number }
): TimelineVisualLayerChange {
  const current = resolveTimelineVisualLayerState(
    input.state,
    input.items,
    input.overlays
  );
  const at = Math.max(0, Math.min(current.count, Math.round(input.at)));
  const remap = (layer: number) => (layer >= at ? layer + 1 : layer);
  // 插入是明确动作：把当前渲染层数固化下来再 +1，按钮点一次就一定多一层。
  return applyRemap(
    input,
    remap,
    current.hidden.map(remap),
    current.count + 1
  );
}

export function moveTimelineVisualLayer(
  input: LayerInput & { from: number; to: number }
): TimelineVisualLayerChange {
  const current = resolveTimelineVisualLayerState(
    input.state,
    input.items,
    input.overlays
  );
  const from = Math.max(0, Math.min(current.count - 1, Math.round(input.from)));
  const to = Math.max(0, Math.min(current.count - 1, Math.round(input.to)));
  if (from === to) {
    return {
      items: input.items.map(item => ({ ...item })),
      overlays: (input.overlays ?? []).map(overlay => ({ ...overlay })),
      state: normalizePersistedVisualLayerState({
        count: current.explicitCount,
        hidden: current.hidden,
      }),
    };
  }
  const remap = (layer: number) => {
    if (layer === from) return to;
    if (from < to && layer > from && layer <= to) return layer - 1;
    if (from > to && layer >= to && layer < from) return layer + 1;
    return layer;
  };
  // 整层排序不改变显式层数：派生的空白顶层照旧由素材位置算出来。
  return applyRemap(input, remap, current.hidden.map(remap), current.explicitCount);
}

export function removeTimelineVisualLayer(
  input: LayerInput & { layer: number }
): TimelineVisualLayerChange {
  const current = resolveTimelineVisualLayerState(
    input.state,
    input.items,
    input.overlays
  );
  const layer = Math.max(0, Math.min(current.count - 1, Math.round(input.layer)));
  const mergeTarget = layer === 0 ? 0 : layer - 1;
  const remap = (candidate: number) => {
    if (candidate === layer) return mergeTarget;
    return candidate > layer ? candidate - 1 : candidate;
  };
  return applyRemap(
    input,
    remap,
    current.hidden.filter(candidate => candidate !== layer).map(remap),
    Math.max(1, current.count - 1)
  );
}

/**
 * 这一层删得掉吗。
 *
 * 最高那层空白投放层是派生出来的：删它会算出同样的渲染层数，按钮点下去
 * 「提示成功、界面没变」。与其猜边界，不如把操作跑一遍看层数会不会真的少一层。
 */
export function canRemoveTimelineVisualLayer(
  input: LayerInput & { layer: number }
): boolean {
  const current = resolveTimelineVisualLayerState(
    input.state,
    input.items,
    input.overlays
  );
  const removed = removeTimelineVisualLayer(input);
  const next = resolveTimelineVisualLayerState(
    removed.state,
    removed.items,
    removed.overlays
  );
  return next.count < current.count;
}

export function toggleTimelineVisualLayerHidden(
  input: LayerInput & { layer: number }
): StoryTimelineVisualLayerState {
  const current = resolveTimelineVisualLayerState(
    input.state,
    input.items,
    input.overlays
  );
  const layer = Math.max(0, Math.min(current.count - 1, Math.round(input.layer)));
  const hidden = new Set(current.hidden);
  if (hidden.has(layer)) hidden.delete(layer);
  else hidden.add(layer);
  return normalizePersistedVisualLayerState({
    count: current.explicitCount,
    hidden: Array.from(hidden),
  });
}

export function countTimelineVisualLayerClips(
  items: readonly StoryTimelineItem[],
  layer: number,
  overlays: readonly StoryTimelineOverlay[] = []
): number {
  const target = layerOf(layer);
  return (
    items.reduce(
      (count, item) =>
        count +
        (layerOf(item.visualLayer) === target ? 1 : 0) +
        (item.imageClips ?? []).filter(clip => layerOf(clip.visualLayer) === target)
          .length +
        (item.visualClips ?? []).filter(clip => layerOf(clip.visualLayer) === target)
          .length,
      0
    ) +
    overlays.filter(
      overlay =>
        (overlay.visualLayer == null ? 1 : layerOf(overlay.visualLayer)) === target
    ).length
  );
}

/** 隐藏层集合，解析可见素材前统一过一遍。 */
export function hiddenTimelineVisualLayers(
  state: StoryTimelineVisualLayerState | null | undefined
): ReadonlySet<number> {
  return hiddenVisualLayerSet(state?.hidden);
}

export type ExtractedFrameTargetLayerPlan =
  | {
      status: "ok";
      targetLayer: number;
      insertedLayer: boolean;
      change: TimelineVisualLayerChange;
    }
  | { status: "error"; error: "operation-layer-unavailable" };

/**
 * Find the visible layer immediately above the layer the user operated on.
 *
 * A hidden adjacent layer is never silently unhidden. Instead, insert a new
 * visible layer at that index and move every existing layer (including the
 * hidden index) together. The returned change is ready to be combined with
 * image placement in one CAS write and therefore must not be persisted on its
 * own.
 */
export function planExtractedFrameTargetLayer(
  input: LayerInput & { operationLayer: number }
): ExtractedFrameTargetLayerPlan {
  const current = resolveTimelineVisualLayerState(
    input.state,
    input.items,
    input.overlays
  );
  if (
    !Number.isInteger(input.operationLayer) ||
    input.operationLayer < 0 ||
    input.operationLayer >= current.count
  ) {
    return { status: "error", error: "operation-layer-unavailable" };
  }

  const targetLayer = input.operationLayer + 1;
  const mustInsert =
    targetLayer >= current.count || current.hidden.includes(targetLayer);
  if (mustInsert) {
    return {
      status: "ok",
      targetLayer,
      insertedLayer: true,
      change: insertTimelineVisualLayer({ ...input, at: targetLayer }),
    };
  }

  return {
    status: "ok",
    targetLayer,
    insertedLayer: false,
    change: {
      items: input.items.map(item => ({ ...item })),
      overlays: (input.overlays ?? []).map(overlay => ({ ...overlay })),
      state: normalizePersistedVisualLayerState(input.state),
    },
  };
}

export function applyTimelineVisualLayerAction(
  input: LayerInput & { action: TimelineVisualLayerAction }
): TimelineVisualLayerChange {
  switch (input.action.kind) {
    case "insert":
      return insertTimelineVisualLayer({ ...input, at: input.action.at });
    case "move":
      return moveTimelineVisualLayer({
        ...input,
        from: input.action.from,
        to: input.action.to,
      });
    case "remove":
      return removeTimelineVisualLayer({ ...input, layer: input.action.layer });
    case "toggle-hidden":
      return {
        items: input.items.map(item => ({ ...item })),
        overlays: (input.overlays ?? []).map(overlay => ({ ...overlay })),
        state: toggleTimelineVisualLayerHidden({
          ...input,
          layer: input.action.layer,
        }),
      };
  }
}
