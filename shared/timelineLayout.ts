import {
  STORY_TIMELINE_FPS,
  timelineFramesToMs,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
} from "./storyMaterial";

export type TimelineLayoutRow = {
  item: StoryTimelineItem;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  stackOrder: number;
};

export type TimelineResolution =
  | { kind: "gap"; frame: number }
  | {
      kind: "shot";
      row: TimelineLayoutRow;
      localFrame: number;
    };

export type TimelineDocumentResolution =
  | TimelineResolution
  | {
      kind: "overlay";
      overlay: StoryTimelineOverlay;
      localFrame: number;
    };

export type TimelineGroupSelection = {
  kind: "ok";
  direction: "left" | "right";
  itemIds: string[];
  boundaryItemId: string | null;
};

export type TimelineGroupSelectionResult =
  | TimelineGroupSelection
  | { kind: "blocked"; reason: string };

export function durationFramesForItem(item: StoryTimelineItem): number {
  return Math.max(
    1,
    Number.isInteger(item.durationFrames) && item.durationFrames! > 0
      ? item.durationFrames!
      : Math.round((Math.max(100, item.plannedDurationMs) * STORY_TIMELINE_FPS) / 1000)
  );
}

export function startFrameForItem(item: StoryTimelineItem, fallback: number): number {
  return Number.isInteger(item.timelineStartFrame) && item.timelineStartFrame! >= 0
    ? item.timelineStartFrame!
    : fallback;
}

export function buildTimelineLayout(
  items: readonly StoryTimelineItem[]
): TimelineLayoutRow[] {
  let cursorFrame = 0;
  let nextStackOrder = 0;
  return [...items]
    .sort((left, right) => left.position - right.position)
    .map(item => {
      const startFrame = startFrameForItem(item, cursorFrame);
      const durationFrames = durationFramesForItem(item);
      const stackOrder =
        Number.isInteger(item.stackOrder) && item.stackOrder! >= 0
          ? item.stackOrder!
          : nextStackOrder;
      const row = {
        item,
        startFrame,
        durationFrames,
        endFrame: startFrame + durationFrames,
        stackOrder,
      } satisfies TimelineLayoutRow;
      cursorFrame = Math.max(cursorFrame, row.endFrame);
      nextStackOrder = Math.max(nextStackOrder, stackOrder + 1);
      return row;
    });
}

export function timelineTotalFrames(rows: readonly TimelineLayoutRow[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, row.endFrame), 0);
}

export function timelineTotalMs(rows: readonly TimelineLayoutRow[]): number {
  return timelineFramesToMs(timelineTotalFrames(rows));
}

export function timelineBoundaries(rows: readonly TimelineLayoutRow[]): number[] {
  return Array.from(new Set(rows.flatMap(row => [row.startFrame, row.endFrame]))).sort(
    (left, right) => left - right
  );
}

function isAnchored(row: TimelineLayoutRow): boolean {
  return (row.item.anchors?.length ?? 0) > 0;
}

function compareRows(left: TimelineLayoutRow, right: TimelineLayoutRow): number {
  const leftAnchored = isAnchored(left);
  const rightAnchored = isAnchored(right);
  if (leftAnchored !== rightAnchored) return leftAnchored ? 1 : -1;
  const leftLayer = Math.max(0, Math.round(left.item.visualLayer ?? 0));
  const rightLayer = Math.max(0, Math.round(right.item.visualLayer ?? 0));
  if (leftLayer !== rightLayer) return leftLayer - rightLayer;
  if (left.stackOrder !== right.stackOrder) {
    return left.stackOrder - right.stackOrder;
  }
  if (left.item.position !== right.item.position) {
    return right.item.position - left.item.position;
  }
  // Final tie-break so client preview and server export can never disagree.
  return right.item.stableShotId.localeCompare(left.item.stableShotId);
}

export function resolveTimelineFrame(
  rows: readonly TimelineLayoutRow[],
  frame: number
): TimelineResolution {
  const lookupFrame = Math.max(0, Math.floor(frame));
  const candidates = rows.filter(
    row =>
      row.item.included !== false &&
      lookupFrame >= row.startFrame &&
      lookupFrame < row.endFrame
  );
  if (candidates.length === 0) return { kind: "gap", frame: lookupFrame };
  const winner = [...candidates].sort((left, right) => compareRows(right, left))[0];
  return {
    kind: "shot",
    row: winner,
    localFrame: lookupFrame - winner.startFrame,
  };
}

/** Resolve persisted overlays and story shots through one deterministic path. */
export function resolveTimelineDocumentFrame(input: {
  items: readonly StoryTimelineItem[];
  overlays?: readonly StoryTimelineOverlay[];
  hiddenVisualLayers?: readonly number[];
  frame: number;
}): TimelineDocumentResolution {
  const lookupFrame = Math.max(0, Math.floor(input.frame));
  const hidden = new Set(
    (input.hiddenVisualLayers ?? []).map(layer => Math.max(0, Math.round(layer)))
  );
  const visibleItems = input.items.filter(
    item => !hidden.has(Math.max(0, Math.round(item.visualLayer ?? 0)))
  );
  const rows = buildTimelineLayout(visibleItems);
  const anchored = rows.filter(
    row =>
      (row.item.anchors?.length ?? 0) > 0 &&
      lookupFrame >= row.startFrame &&
      lookupFrame < row.endFrame
  );
  if (anchored.length > 0) {
    const winner = [...anchored].sort((left, right) => compareRows(right, left))[0];
    return {
      kind: "shot",
      row: winner,
      localFrame: lookupFrame - winner.startFrame,
    };
  }
  const overlay = [...(input.overlays ?? [])]
    .filter(
      candidate =>
        !visibleItems.some(
          item =>
            item.stableShotId === candidate.sourceStableShotId &&
            (item.visualLayer ?? 0) > 0
        ) &&
        !hidden.has(1) &&
        lookupFrame >= candidate.startFrame && lookupFrame < candidate.endFrame
    )
    .sort(
      (left, right) =>
        right.stackOrder - left.stackOrder || right.id.localeCompare(left.id)
    )[0];
  if (overlay) {
    if (lookupFrame >= overlay.mediaEndFrame) {
      return { kind: "gap", frame: lookupFrame };
    }
    return {
      kind: "overlay",
      overlay,
      localFrame: lookupFrame - overlay.startFrame,
    };
  }
  return resolveTimelineFrame(rows, lookupFrame);
}

export function selectDirectionalGroup(
  rows: readonly TimelineLayoutRow[],
  sourceItemId: string,
  direction: "left" | "right"
): TimelineGroupSelectionResult {
  const source = rows.find(row => row.item.stableShotId === sourceItemId);
  if (!source) return { kind: "blocked", reason: "镜头不在时间轴中" };
  const sourceLayer = source.item.visualLayer ?? 0;
  const ordered = [...rows]
    .filter(row => (row.item.visualLayer ?? 0) === sourceLayer)
    .sort((left, right) => left.item.position - right.item.position);
  const sourceIndex = ordered.findIndex(row => row.item.stableShotId === sourceItemId);
  if (sourceIndex < 0) return { kind: "blocked", reason: "镜头不在时间轴中" };
  if (isAnchored(ordered[sourceIndex])) {
    return { kind: "blocked", reason: "这一镜已有位置锚点，不能整体移动" };
  }

  const itemIds = [sourceItemId];
  let boundaryItemId: string | null = null;
  if (direction === "left") {
    for (let index = sourceIndex - 1; index >= 0; index -= 1) {
      if (isAnchored(ordered[index])) {
        boundaryItemId = ordered[index].item.stableShotId;
        break;
      }
      itemIds.unshift(ordered[index].item.stableShotId);
    }
  } else {
    for (let index = sourceIndex + 1; index < ordered.length; index += 1) {
      if (isAnchored(ordered[index])) {
        boundaryItemId = ordered[index].item.stableShotId;
        break;
      }
      itemIds.push(ordered[index].item.stableShotId);
    }
  }
  return { kind: "ok", direction, itemIds, boundaryItemId };
}

/**
 * Overlap priority is allocated in ever-increasing bands. Refuse the move
 * rather than silently rewriting every item's priority once the band would
 * leave the safe-integer range.
 */
const MAXIMUM_STACK_ORDER = Number.MAX_SAFE_INTEGER - 1024;

export type TimelineMoveResult =
  | {
      kind: "ok";
      items: StoryTimelineItem[];
      appliedDeltaFrames: number;
      clampedAtZero: boolean;
    }
  | { kind: "blocked"; reason: string };

/**
 * 只选中这一镜自己：拖镜头本体默认只移动它，不牵动同方向连续的邻居。
 * 批量移动仍然可以通过 selectDirectionalGroup（六点抓手）触发。
 */
export function selectSingleShot(
  rows: readonly TimelineLayoutRow[],
  sourceItemId: string
): TimelineGroupSelectionResult {
  const row = rows.find(candidate => candidate.item.stableShotId === sourceItemId);
  if (!row) return { kind: "blocked", reason: "镜头不在时间轴中" };
  if (isAnchored(row)) {
    return { kind: "blocked", reason: "这一镜已有位置锚点，不能移动" };
  }
  // direction 只影响 moveTimelineGroup 的调用签名，单镜移动本身不分方向。
  return { kind: "ok", direction: "right", itemIds: [sourceItemId], boundaryItemId: null };
}

export function moveTimelineGroup(
  items: readonly StoryTimelineItem[],
  selection: TimelineGroupSelection,
  requestedDeltaFrames: number
): TimelineMoveResult {
  const selected = new Set(selection.itemIds);
  const rows = buildTimelineLayout(items);
  const selectedRows = rows.filter(row => selected.has(row.item.stableShotId));
  if (selectedRows.length === 0) {
    return { kind: "blocked", reason: "没有可移动的镜头" };
  }
  const deltaFrames = Math.round(requestedDeltaFrames);
  const minimumStart = Math.min(...selectedRows.map(row => row.startFrame));
  // `|| 0` normalizes the -0 `Math.max` yields when the group already sits at
  // frame zero, so callers comparing against 0 behave predictably.
  const clampedDelta = Math.max(-minimumStart, deltaFrames) || 0;
  const maximumStackOrder = Math.max(-1, ...rows.map(row => row.stackOrder));
  const priorityBase = maximumStackOrder + 1;
  if (priorityBase + selectedRows.length - 1 > MAXIMUM_STACK_ORDER) {
    return {
      kind: "blocked",
      reason: "叠放优先级已达上限，请先整理这条时间轴",
    };
  }
  const selectedByPosition = [...selectedRows].sort(
    (left, right) => left.item.position - right.item.position
  );
  const priorityById = new Map(
    selectedByPosition.map((row, index) => [row.item.stableShotId, priorityBase + index])
  );
  return {
    kind: "ok",
    appliedDeltaFrames: clampedDelta,
    clampedAtZero: clampedDelta !== deltaFrames,
    items: items.map(item => {
      if (!selected.has(item.stableShotId)) return { ...item };
      const row = selectedRows.find(
        candidate => candidate.item.stableShotId === item.stableShotId
      )!;
      const startFrame = row.startFrame + clampedDelta;
      return {
        ...item,
        timelineStartFrame: startFrame,
        durationFrames: row.durationFrames,
        plannedDurationMs: timelineFramesToMs(row.durationFrames),
        stackOrder: priorityById.get(item.stableShotId),
      };
    }),
  };
}

export function timelineFrameToMs(frame: number): number {
  return timelineFramesToMs(frame);
}
