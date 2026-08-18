import {
  STORY_TIMELINE_FPS,
  timelineFramesToMs,
  type StoryTimelineItem,
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
  if (left.stackOrder !== right.stackOrder) {
    return left.stackOrder - right.stackOrder;
  }
  return right.item.position - left.item.position;
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

export function selectDirectionalGroup(
  rows: readonly TimelineLayoutRow[],
  sourceItemId: string,
  direction: "left" | "right"
): TimelineGroupSelectionResult {
  const ordered = [...rows].sort((left, right) => left.item.position - right.item.position);
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

export function moveTimelineGroup(
  items: readonly StoryTimelineItem[],
  selection: TimelineGroupSelection,
  requestedDeltaFrames: number
): StoryTimelineItem[] {
  const selected = new Set(selection.itemIds);
  const rows = buildTimelineLayout(items);
  const selectedRows = rows.filter(row => selected.has(row.item.stableShotId));
  if (selectedRows.length === 0) return items.map(item => ({ ...item }));
  const deltaFrames = Math.round(requestedDeltaFrames);
  const minimumStart = Math.min(...selectedRows.map(row => row.startFrame));
  const clampedDelta = Math.max(-minimumStart, deltaFrames);
  const maximumStackOrder = Math.max(-1, ...rows.map(row => row.stackOrder));
  const priorityBase = maximumStackOrder + 1;
  const selectedByPosition = [...selectedRows].sort(
    (left, right) => left.item.position - right.item.position
  );
  const priorityById = new Map(
    selectedByPosition.map((row, index) => [row.item.stableShotId, priorityBase + index])
  );
  return items.map(item => {
    if (!selected.has(item.stableShotId)) return { ...item };
    const row = selectedRows.find(candidate => candidate.item.stableShotId === item.stableShotId)!;
    const startFrame = row.startFrame + clampedDelta;
    return {
      ...item,
      timelineStartFrame: startFrame,
      durationFrames: row.durationFrames,
      plannedDurationMs: timelineFramesToMs(row.durationFrames),
      stackOrder: priorityById.get(item.stableShotId),
    };
  });
}

export function timelineFrameToMs(frame: number): number {
  return timelineFramesToMs(frame);
}
