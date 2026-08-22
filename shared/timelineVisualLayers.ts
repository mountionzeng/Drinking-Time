import type {
  StoryTimelineItem,
  StoryTimelineVisualLayerState,
} from "./storyMaterial";

export type TimelineVisualLayerChange = {
  items: StoryTimelineItem[];
  state: StoryTimelineVisualLayerState;
};

export type TimelineVisualLayerAction =
  | { kind: "insert"; at: number }
  | { kind: "move"; from: number; to: number }
  | { kind: "remove"; layer: number }
  | { kind: "toggle-hidden"; layer: number };

function layerOf(value: number | undefined): number {
  return Math.max(0, Math.round(value ?? 0));
}

export function highestUsedVisualLayer(
  items: readonly StoryTimelineItem[]
): number {
  return Math.max(
    0,
    ...items.flatMap(item => [
      layerOf(item.visualLayer),
      ...(item.imageClips ?? []).map(clip => layerOf(clip.visualLayer)),
      ...(item.visualClips ?? []).map(clip => layerOf(clip.visualLayer)),
    ])
  );
}

export function normalizeTimelineVisualLayerState(
  state: StoryTimelineVisualLayerState | null | undefined,
  items: readonly StoryTimelineItem[]
): StoryTimelineVisualLayerState {
  // Keep one empty drop target above the highest occupied layer.
  const count = Math.max(
    2,
    Math.round(state?.count ?? 0),
    highestUsedVisualLayer(items) + 2
  );
  return {
    count,
    hidden: Array.from(
      new Set(
        (state?.hidden ?? [])
          .map(layerOf)
          .filter(layer => layer < count)
      )
    ).sort((left, right) => left - right),
  };
}

function remapItems(
  items: readonly StoryTimelineItem[],
  remap: (layer: number) => number
): StoryTimelineItem[] {
  return items.map(item => ({
    ...item,
    visualLayer: remap(layerOf(item.visualLayer)),
    imageClips: item.imageClips?.map(clip => ({
      ...clip,
      visualLayer: remap(layerOf(clip.visualLayer)),
    })),
    visualClips: item.visualClips?.map(clip => ({
      ...clip,
      visualLayer: remap(layerOf(clip.visualLayer)),
    })),
  }));
}

export function insertTimelineVisualLayer(input: {
  items: readonly StoryTimelineItem[];
  state?: StoryTimelineVisualLayerState | null;
  at: number;
}): TimelineVisualLayerChange {
  const current = normalizeTimelineVisualLayerState(input.state, input.items);
  const at = Math.max(0, Math.min(current.count, Math.round(input.at)));
  const remap = (layer: number) => (layer >= at ? layer + 1 : layer);
  const items = remapItems(input.items, remap);
  return {
    items,
    state: {
      count: current.count + 1,
      hidden: current.hidden.map(remap),
    },
  };
}

export function moveTimelineVisualLayer(input: {
  items: readonly StoryTimelineItem[];
  state?: StoryTimelineVisualLayerState | null;
  from: number;
  to: number;
}): TimelineVisualLayerChange {
  const current = normalizeTimelineVisualLayerState(input.state, input.items);
  const from = Math.max(0, Math.min(current.count - 1, Math.round(input.from)));
  const to = Math.max(0, Math.min(current.count - 1, Math.round(input.to)));
  if (from === to) return { items: [...input.items], state: current };
  const remap = (layer: number) => {
    if (layer === from) return to;
    if (from < to && layer > from && layer <= to) return layer - 1;
    if (from > to && layer >= to && layer < from) return layer + 1;
    return layer;
  };
  return {
    items: remapItems(input.items, remap),
    state: { count: current.count, hidden: current.hidden.map(remap).sort((a, b) => a - b) },
  };
}

export function removeTimelineVisualLayer(input: {
  items: readonly StoryTimelineItem[];
  state?: StoryTimelineVisualLayerState | null;
  layer: number;
}): TimelineVisualLayerChange {
  const current = normalizeTimelineVisualLayerState(input.state, input.items);
  const layer = Math.max(0, Math.min(current.count - 1, Math.round(input.layer)));
  const mergeTarget = layer === 0 ? 0 : layer - 1;
  const remap = (candidate: number) => {
    if (candidate === layer) return mergeTarget;
    return candidate > layer ? candidate - 1 : candidate;
  };
  const items = remapItems(input.items, remap);
  return {
    items,
    state: normalizeTimelineVisualLayerState(
      {
        count: Math.max(1, current.count - 1),
        hidden: current.hidden
          .filter(candidate => candidate !== layer)
          .map(remap),
      },
      items
    ),
  };
}

export function toggleTimelineVisualLayerHidden(input: {
  items: readonly StoryTimelineItem[];
  state?: StoryTimelineVisualLayerState | null;
  layer: number;
}): StoryTimelineVisualLayerState {
  const current = normalizeTimelineVisualLayerState(input.state, input.items);
  const layer = Math.max(0, Math.min(current.count - 1, Math.round(input.layer)));
  const hidden = new Set(current.hidden);
  if (hidden.has(layer)) hidden.delete(layer);
  else hidden.add(layer);
  return { ...current, hidden: Array.from(hidden).sort((a, b) => a - b) };
}

export function countTimelineVisualLayerClips(
  items: readonly StoryTimelineItem[],
  layer: number
): number {
  const target = layerOf(layer);
  return items.reduce(
    (count, item) =>
      count +
      (layerOf(item.visualLayer) === target ? 1 : 0) +
      (item.imageClips ?? []).filter(clip => layerOf(clip.visualLayer) === target).length +
      (item.visualClips ?? []).filter(clip => layerOf(clip.visualLayer) === target).length,
    0
  );
}

export function applyTimelineVisualLayerAction(input: {
  items: readonly StoryTimelineItem[];
  state?: StoryTimelineVisualLayerState | null;
  action: TimelineVisualLayerAction;
}): TimelineVisualLayerChange {
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
        items: [...input.items],
        state: toggleTimelineVisualLayerHidden({
          ...input,
          layer: input.action.layer,
        }),
      };
  }
}
