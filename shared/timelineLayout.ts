import {
  STORY_TIMELINE_FPS,
  timelineFramesToMs,
  timelineImageClipStartFrame,
  type StoryTimelineImageClip,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
} from "./storyMaterial";
import {
  compareVisualPriority,
  hiddenVisualLayerSet,
  normalizeVisualLayer,
  pickVisualWinner,
  type VisualPriority,
} from "./timelineVisualPriority";

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

/** 镜头行的统一优先级；预览、剪辑行、导出共用同一份。 */
export function timelineRowVisualPriority(row: TimelineLayoutRow): VisualPriority {
  return {
    anchored: isAnchored(row),
    visualLayer: normalizeVisualLayer(row.item.visualLayer),
    stackOrder: row.stackOrder,
    position: row.item.position,
    tieId: row.item.stableShotId,
  };
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
  const winner = pickVisualWinner(candidates, timelineRowVisualPriority);
  if (!winner) return { kind: "gap", frame: lookupFrame };
  return {
    kind: "shot",
    row: winner,
    localFrame: lookupFrame - winner.startFrame,
  };
}

/**
 * 遗留 overlay 的兼容图层。历史数据没有这个字段，按当初写死的上层 1 解释；
 * 图层插入、删除和排序会把它一起重编号，所以迁移前的 overlay 也不会停在错层。
 */
export const LEGACY_OVERLAY_VISUAL_LAYER = 1;

export function overlayVisualLayer(
  overlay: Pick<StoryTimelineOverlay, "visualLayer">
): number {
  return overlay.visualLayer == null
    ? LEGACY_OVERLAY_VISUAL_LAYER
    : normalizeVisualLayer(overlay.visualLayer);
}

function overlayVisualPriority(overlay: StoryTimelineOverlay): VisualPriority {
  return {
    anchored: false,
    visualLayer: overlayVisualLayer(overlay),
    stackOrder: overlay.stackOrder,
    // 遗留 overlay 一直是「压在同层镜头之上的显式覆盖」，同层同 stackOrder 时保留这个语义。
    position: -1,
    tieId: overlay.id,
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
  const hidden = hiddenVisualLayerSet(input.hiddenVisualLayers);
  // 先按全部素材排版，再丢掉隐藏层的行：隐藏一层不能改变其它层的隐式起点。
  const allRows = buildTimelineLayout(input.items);
  const rows = allRows.filter(
    row => !hidden.has(normalizeVisualLayer(row.item.visualLayer))
  );
  const anchored = rows.filter(
    row =>
      (row.item.anchors?.length ?? 0) > 0 &&
      row.item.included !== false &&
      lookupFrame >= row.startFrame &&
      lookupFrame < row.endFrame
  );
  const anchoredWinner = pickVisualWinner(anchored, timelineRowVisualPriority);
  if (anchoredWinner) {
    return {
      kind: "shot",
      row: anchoredWinner,
      localFrame: lookupFrame - anchoredWinner.startFrame,
    };
  }
  const migratedOverlayShots = new Set(
    rows
      .filter(row => normalizeVisualLayer(row.item.visualLayer) > 0)
      .map(row => row.item.stableShotId)
  );
  const overlay = pickVisualWinner(
    (input.overlays ?? []).filter(
      candidate =>
        !migratedOverlayShots.has(candidate.sourceStableShotId) &&
        !hidden.has(overlayVisualLayer(candidate)) &&
        lookupFrame >= candidate.startFrame &&
        lookupFrame < candidate.endFrame
    ),
    overlayVisualPriority
  );
  const itemResolution = resolveTimelineFrame(rows, lookupFrame);
  if (
    overlay &&
    (itemResolution.kind === "gap" ||
      compareVisualPriority(
        overlayVisualPriority(overlay),
        timelineRowVisualPriority(itemResolution.row)
      ) > 0)
  ) {
    if (lookupFrame >= overlay.mediaEndFrame) {
      return { kind: "gap", frame: lookupFrame };
    }
    return {
      kind: "overlay",
      overlay,
      localFrame: lookupFrame - overlay.startFrame,
    };
  }
  return itemResolution;
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

export type TimelineImageClipPlacement = {
  clip: StoryTimelineImageClip;
  stableShotId: string;
  startFrame: number;
};

function imageClipVisualPriority(
  placement: TimelineImageClipPlacement
): VisualPriority {
  return {
    anchored: false,
    visualLayer: normalizeVisualLayer(placement.clip.visualLayer),
    // 同层里后放的一帧图片压在先放的上面。
    stackOrder: placement.startFrame,
    position: 0,
    tieId: placement.clip.id,
  };
}

/**
 * 这一帧上胜出的一帧图片剪辑。
 *
 * 图片以前只有预览这一条解析路径，锚点、导出和能力判断都看不见它，于是「界面上
 * 明明是图片，锚点却锁住了下面的视频」。解析规则和镜头、overlay 共用同一个比较器。
 */
export function resolveTimelineImageClipAt(input: {
  items: readonly StoryTimelineItem[];
  hiddenVisualLayers?: readonly number[];
  frame: number;
}): TimelineImageClipPlacement | null {
  const frame = Math.max(0, Math.round(input.frame));
  const hidden = hiddenVisualLayerSet(input.hiddenVisualLayers);
  const placements = buildTimelineLayout(input.items).flatMap(row =>
    (row.item.imageClips ?? []).map(clip => ({
      clip,
      stableShotId: row.item.stableShotId,
      startFrame: timelineImageClipStartFrame(clip, row.startFrame),
    }))
  );
  return pickVisualWinner(
    placements.filter(
      placement =>
        !hidden.has(normalizeVisualLayer(placement.clip.visualLayer)) &&
        frame >= placement.startFrame &&
        frame < placement.startFrame + placement.clip.durationFrames
    ),
    imageClipVisualPriority
  );
}

/**
 * 同一时刻图片和视频谁在上面。相等时图片赢：一帧图片是用户显式放上去的剪辑。
 */
export function timelineImageBeatsVisualSource(
  image: TimelineImageClipPlacement | null,
  videoLayer: number | null
): boolean {
  if (!image) return false;
  if (videoLayer == null) return true;
  return (
    normalizeVisualLayer(image.clip.visualLayer) >=
    normalizeVisualLayer(videoLayer)
  );
}
