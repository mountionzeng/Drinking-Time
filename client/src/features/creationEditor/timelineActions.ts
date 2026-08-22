import type {
  StoryTimelineAnchor,
  StoryTimelineItem,
  StoryTimelineOverlay,
  TimelineTransform,
  TimelineVideoEffects,
} from "@shared/storyMaterial";
import { timelineImageClipStartFrame } from "@shared/storyMaterial";
import {
  addTimelineAnchor,
  removeTimelineAnchor,
  trimTimelineItem,
} from "@shared/timelineEditing";
import {
  buildTimelineLayout,
  moveTimelineGroup,
  resolveTimelineDocumentFrame,
  resolveTimelineFrame,
  selectDirectionalGroup,
  selectSingleShot,
  type TimelineLayoutRow,
} from "@shared/timelineLayout";
import {
  resolveTimelineItemSource,
  timelineSourceCandidateForImage,
} from "@shared/timelineSource";

/** What the timeline shows at one absolute frame, gaps included. */
export type CreationTimelineFrameResolution =
  | { kind: "gap"; timelineFrame: number }
  | {
      kind: "source";
      timelineFrame: number;
      stableShotId: string;
      startFrame: number;
      durationFrames: number;
      localFrame: number;
      sourceType: StoryTimelineAnchor["sourceType"];
      sourceId: string;
      sourceTimeSec: number | null;
      rate: number;
      sourceWindow: { startSec: number; endSec: number } | null;
      effects: TimelineVideoEffects | null;
      transform: TimelineTransform | null;
    };

export type TimelinePlan =
  | { kind: "ok"; items: StoryTimelineItem[]; anchorId?: string }
  | { kind: "blocked"; reason: string; boundaryFrame?: number };

export type TimelineMagneticJoin = {
  leftStableShotId: string;
  rightStableShotId: string;
  boundaryFrame: number;
};

/** Exact, user-enabled joins in visual timeline order. These are the seams that roll. */
export function timelineMagneticJoins(
  rows: readonly TimelineLayoutRow[]
): TimelineMagneticJoin[] {
  const boundaries = Array.from(
    new Set(
      rows
        .filter(row => row.item.included && row.endFrame > 0)
        .map(row => row.endFrame)
    )
  ).sort((left, right) => left - right);
  return boundaries.flatMap(boundaryFrame => {
    const before = resolveTimelineFrame(rows, boundaryFrame - 1);
    const after = resolveTimelineFrame(rows, boundaryFrame);
    if (
      before.kind !== "shot" ||
      after.kind !== "shot" ||
      before.row.item.stableShotId === after.row.item.stableShotId ||
      before.row.endFrame !== boundaryFrame ||
      after.row.startFrame !== boundaryFrame ||
      after.row.item.detachedFromPreviousShotId ===
        before.row.item.stableShotId
    ) {
      return [];
    }
    return [{
      leftStableShotId: before.row.item.stableShotId,
      rightStableShotId: after.row.item.stableShotId,
      boundaryFrame,
    }];
  });
}

function clearStaleMagneticDetachments(
  items: readonly StoryTimelineItem[]
): StoryTimelineItem[] {
  const rowsById = new Map(
    buildTimelineLayout(items).map(row => [row.item.stableShotId, row] as const)
  );
  return items.map(item => {
    const leftId = item.detachedFromPreviousShotId;
    const left = leftId ? rowsById.get(leftId) : null;
    const right = rowsById.get(item.stableShotId);
    if (!leftId || (left && right && left.endFrame === right.startFrame)) {
      return item;
    }
    const { detachedFromPreviousShotId: _removed, ...rest } = item;
    return rest;
  });
}

export function snappedTimelineSingleMove(input: {
  rows: readonly TimelineLayoutRow[];
  stableShotId: string;
  deltaFrames: number;
  snapThresholdFrames: number;
}): { deltaFrames: number; join: TimelineMagneticJoin | null } {
  const current = input.rows.find(
    row => row.item.stableShotId === input.stableShotId
  );
  const roundedDelta = Math.round(input.deltaFrames);
  const threshold = Math.max(0, Math.round(input.snapThresholdFrames));
  if (!current || threshold === 0) {
    return { deltaFrames: roundedDelta, join: null };
  }
  const movedStart = current.startFrame + roundedDelta;
  const movedEnd = current.endFrame + roundedDelta;
  const movedStackOrder = Math.max(-1, ...input.rows.map(row => row.stackOrder)) + 1;
  const formsVisibleJoin = (
    deltaFrames: number,
    join: TimelineMagneticJoin
  ) => {
    const candidateRows = input.rows.map(row =>
      row.item.stableShotId === current.item.stableShotId
        ? {
            ...row,
            startFrame: current.startFrame + deltaFrames,
            endFrame: current.endFrame + deltaFrames,
            stackOrder: movedStackOrder,
            item: {
              ...row.item,
              timelineStartFrame: current.startFrame + deltaFrames,
              stackOrder: movedStackOrder,
            },
          }
        : row
    );
    return timelineMagneticJoins(candidateRows).some(
      candidate =>
        candidate.leftStableShotId === join.leftStableShotId &&
        candidate.rightStableShotId === join.rightStableShotId &&
        candidate.boundaryFrame === join.boundaryFrame
    );
  };
  const candidates = input.rows
    .filter(row => row.item.included && row.item.stableShotId !== input.stableShotId)
    .flatMap(row => {
      const joins: Array<{
        distance: number;
        deltaFrames: number;
        join: TimelineMagneticJoin;
      }> = [];
      const startDistance = Math.abs(movedStart - row.endFrame);
      if (
        startDistance <= threshold &&
        current.item.detachedFromPreviousShotId !== row.item.stableShotId
      ) {
        const candidate = {
          distance: startDistance,
          deltaFrames: row.endFrame - current.startFrame,
          join: {
            leftStableShotId: row.item.stableShotId,
            rightStableShotId: current.item.stableShotId,
            boundaryFrame: row.endFrame,
          },
        };
        if (formsVisibleJoin(candidate.deltaFrames, candidate.join)) {
          joins.push(candidate);
        }
      }
      const endDistance = Math.abs(movedEnd - row.startFrame);
      if (
        endDistance <= threshold &&
        row.item.detachedFromPreviousShotId !== current.item.stableShotId
      ) {
        const candidate = {
          distance: endDistance,
          deltaFrames: row.startFrame - current.endFrame,
          join: {
            leftStableShotId: current.item.stableShotId,
            rightStableShotId: row.item.stableShotId,
            boundaryFrame: row.startFrame,
          },
        };
        if (formsVisibleJoin(candidate.deltaFrames, candidate.join)) {
          joins.push(candidate);
        }
      }
      return joins;
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.join.boundaryFrame - right.join.boundaryFrame ||
        left.join.leftStableShotId.localeCompare(right.join.leftStableShotId)
    );
  return candidates[0] ?? { deltaFrames: roundedDelta, join: null };
}

/** The subset of a shot's material state the resolver needs. */
export type TimelineResolverShot = {
  currentImageId?: number | string | null;
  currentVideoDurationSec?: number | null;
};

/**
 * Resolve the visible source at an absolute frame. Anchor creation must go
 * through here rather than trusting a caller-supplied source identity, so a
 * gap can never be marked and an anchor always records the picture it locks.
 */
export function resolveTimelineFrameSource(input: {
  rows: readonly TimelineLayoutRow[];
  shotsById: ReadonlyMap<string, TimelineResolverShot>;
  overlays?: readonly StoryTimelineOverlay[];
  hiddenVisualLayers?: readonly number[];
  timelineFrame: number;
}): CreationTimelineFrameResolution {
  const frame = Math.max(0, Math.round(input.timelineFrame));
  const resolved = input.overlays
    ? resolveTimelineDocumentFrame({
        items: input.rows.map(row => row.item),
        overlays: input.overlays,
        hiddenVisualLayers: input.hiddenVisualLayers,
        frame,
      })
    : resolveTimelineFrame(input.rows, frame);
  if (resolved.kind === "gap") return { kind: "gap", timelineFrame: frame };
  if (resolved.kind === "overlay") {
    const overlay = resolved.overlay;
    return {
      kind: "source",
      timelineFrame: frame,
      stableShotId: overlay.sourceStableShotId,
      startFrame: overlay.startFrame,
      durationFrames: overlay.mediaEndFrame - overlay.startFrame,
      localFrame: resolved.localFrame,
      sourceType: "visual-clip",
      sourceId: `overlay-${overlay.id}`,
      sourceTimeSec: resolved.localFrame / 30,
      rate: 1,
      sourceWindow: {
        startSec: 0,
        endSec: (overlay.mediaEndFrame - overlay.startFrame) / 30,
      },
      effects: overlay.effects ?? null,
      transform: overlay.transform,
    };
  }
  const { row, localFrame } = resolved;
  const imageId = input.shotsById.get(row.item.stableShotId)?.currentImageId;
  const source = resolveTimelineItemSource({
    item: row.item,
    localFrame,
    durationFrames: row.durationFrames,
    fallback:
      imageId == null
        ? null
        : timelineSourceCandidateForImage({
            imageId,
            durationFrames: row.durationFrames,
          }),
  });
  if (source.kind === "gap") return { kind: "gap", timelineFrame: frame };
  return {
    kind: "source",
    timelineFrame: frame,
    stableShotId: row.item.stableShotId,
    startFrame: row.startFrame,
    durationFrames: row.durationFrames,
    localFrame,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceTimeSec: source.sourceTimeSec,
    rate: source.rate,
    sourceWindow: source.sourceWindow,
    effects: source.effects,
    transform: source.transform,
  };
}

export type TimelineGroupPreview =
  | { kind: "ok"; stableShotIds: string[]; boundaryStableShotId: string | null }
  | { kind: "blocked"; reason: string };

/** 拖之前先问：这次会带上哪些镜头、被哪一镜的锚点挡住。不写任何数据。 */
export function previewTimelineGroup(input: {
  rows: readonly TimelineLayoutRow[];
  sourceShotId: string;
  direction: "left" | "right";
}): TimelineGroupPreview {
  const selection = selectDirectionalGroup(
    input.rows,
    input.sourceShotId,
    input.direction
  );
  if (selection.kind !== "ok") {
    return { kind: "blocked", reason: selection.reason };
  }
  return {
    kind: "ok",
    stableShotIds: selection.itemIds,
    boundaryStableShotId: selection.boundaryItemId,
  };
}

function withIndependentTimelineImageStarts(
  items: readonly StoryTimelineItem[],
  rows: readonly TimelineLayoutRow[]
): StoryTimelineItem[] {
  const startByShotId = new Map(
    rows.map(row => [row.item.stableShotId, row.startFrame] as const)
  );
  return items.map(item => {
    if (!item.imageClips?.length) return item;
    const ownerStartFrame = startByShotId.get(item.stableShotId) ?? 0;
    return {
      ...item,
      imageClips: item.imageClips.map(clip => ({
        ...clip,
        timelineStartFrame: timelineImageClipStartFrame(clip, ownerStartFrame),
      })),
    };
  });
}

export function planTimelineGroupMove(input: {
  items: readonly StoryTimelineItem[];
  rows: readonly TimelineLayoutRow[];
  sourceShotId: string;
  direction: "left" | "right";
  deltaFrames: number;
}): TimelinePlan {
  const selection = selectDirectionalGroup(
    input.rows,
    input.sourceShotId,
    input.direction
  );
  if (selection.kind !== "ok") {
    return { kind: "blocked", reason: selection.reason };
  }
  if (Math.round(input.deltaFrames) === 0) {
    return { kind: "blocked", reason: "没有移动距离" };
  }
  const moved = moveTimelineGroup(
    withIndependentTimelineImageStarts(input.items, input.rows),
    selection,
    input.deltaFrames
  );
  if (moved.kind !== "ok") return { kind: "blocked", reason: moved.reason };
  if (moved.appliedDeltaFrames === 0) {
    return { kind: "blocked", reason: "已经到达时间轴起点" };
  }
  return { kind: "ok", items: clearStaleMagneticDetachments(moved.items) };
}

/**
 * 拖镜头本体：只移动这一镜，邻居原地不动。批量移动是六点抓手的单独手势
 * （见 planTimelineGroupMove），两者共用同一个 moveTimelineGroup 提交路径，
 * 差别只在「选中了谁」。
 */
export function planTimelineSingleMove(input: {
  items: readonly StoryTimelineItem[];
  rows: readonly TimelineLayoutRow[];
  stableShotId: string;
  deltaFrames: number;
  snapThresholdFrames?: number;
}): TimelinePlan {
  const selection = selectSingleShot(input.rows, input.stableShotId);
  if (selection.kind !== "ok") {
    return { kind: "blocked", reason: selection.reason };
  }
  const snapped = snappedTimelineSingleMove({
    rows: input.rows,
    stableShotId: input.stableShotId,
    deltaFrames: input.deltaFrames,
    snapThresholdFrames: input.snapThresholdFrames ?? 0,
  });
  if (snapped.deltaFrames === 0) {
    return { kind: "blocked", reason: "没有移动距离" };
  }
  const moved = moveTimelineGroup(
    withIndependentTimelineImageStarts(input.items, input.rows),
    selection,
    snapped.deltaFrames
  );
  if (moved.kind !== "ok") return { kind: "blocked", reason: moved.reason };
  if (moved.appliedDeltaFrames === 0) {
    return { kind: "blocked", reason: "已经到达时间轴起点" };
  }
  return { kind: "ok", items: clearStaleMagneticDetachments(moved.items) };
}

/** One rolling-edit gesture updates both sides of a magnetic seam atomically. */
export function planTimelineRollingTrim(input: {
  items: readonly StoryTimelineItem[];
  rows: readonly TimelineLayoutRow[];
  leftStableShotId: string;
  rightStableShotId: string;
  requestedBoundaryFrame: number;
  leftSourceLimitSec?: number | null;
  rightSourceLimitSec?: number | null;
}): TimelinePlan {
  const join = timelineMagneticJoins(input.rows).find(
    candidate =>
      candidate.leftStableShotId === input.leftStableShotId &&
      candidate.rightStableShotId === input.rightStableShotId
  );
  if (!join) return { kind: "blocked", reason: "这两个镜头没有吸附" };
  const left = input.items.find(
    item => item.stableShotId === input.leftStableShotId
  );
  const right = input.items.find(
    item => item.stableShotId === input.rightStableShotId
  );
  if (!left || !right) return { kind: "blocked", reason: "镜头不在时间轴中" };
  const leftTrim = trimTimelineItem({
    item: left,
    edge: "end",
    requestedBoundaryFrame: input.requestedBoundaryFrame,
    sourceLimitSec: input.leftSourceLimitSec,
  });
  if (leftTrim.kind !== "ok") {
    return {
      kind: "blocked",
      reason: leftTrim.reason,
      boundaryFrame: leftTrim.boundaryFrame,
    };
  }
  const rightTrim = trimTimelineItem({
    item: right,
    edge: "start",
    requestedBoundaryFrame: input.requestedBoundaryFrame,
    sourceLimitSec: input.rightSourceLimitSec,
  });
  if (rightTrim.kind !== "ok") {
    return {
      kind: "blocked",
      reason: rightTrim.reason,
      boundaryFrame: rightTrim.boundaryFrame,
    };
  }
  return {
    kind: "ok",
    items: input.items.map(item =>
      item.stableShotId === left.stableShotId
        ? leftTrim.item
        : item.stableShotId === right.stableShotId
          ? rightTrim.item
          : item
    ),
  };
}

export function planTimelineMagnetDetach(input: {
  items: readonly StoryTimelineItem[];
  rows: readonly TimelineLayoutRow[];
  leftStableShotId: string;
  rightStableShotId: string;
}): TimelinePlan {
  const join = timelineMagneticJoins(input.rows).find(
    candidate =>
      candidate.leftStableShotId === input.leftStableShotId &&
      candidate.rightStableShotId === input.rightStableShotId
  );
  if (!join) return { kind: "blocked", reason: "这两个镜头没有吸附" };
  return {
    kind: "ok",
    items: input.items.map(item =>
      item.stableShotId === input.rightStableShotId
        ? { ...item, detachedFromPreviousShotId: input.leftStableShotId }
        : item
    ),
  };
}

/**
 * One anchor per (shot, frame) is exactly the uniqueness rule, so a deterministic
 * id makes a repeated `M` at the same frame a no-op instead of a second anchor.
 */
export function timelineAnchorId(stableShotId: string, frame: number): string {
  return `anchor-${stableShotId}-${frame}`;
}

export function planTimelineAnchorAdd(input: {
  items: readonly StoryTimelineItem[];
  resolution: CreationTimelineFrameResolution;
}): TimelinePlan {
  const { resolution } = input;
  if (resolution.kind !== "source") {
    return { kind: "blocked", reason: "当前时间没有可标记的画面" };
  }
  const current = input.items.find(
    item => item.stableShotId === resolution.stableShotId
  );
  if (!current) return { kind: "blocked", reason: "镜头不在时间轴中" };
  const anchor: StoryTimelineAnchor = {
    id: timelineAnchorId(resolution.stableShotId, resolution.timelineFrame),
    timelineFrame: resolution.timelineFrame,
    sourceType: resolution.sourceType,
    sourceId: resolution.sourceId,
    sourceTimeSec: resolution.sourceTimeSec,
  };
  const result = addTimelineAnchor({
    item: current,
    anchor,
    resolved: {
      kind: "source",
      sourceType: resolution.sourceType,
      sourceId: resolution.sourceId,
      localFrame: resolution.localFrame,
      sourceTimeSec: resolution.sourceTimeSec,
      rate: resolution.rate,
      sourceWindow: resolution.sourceWindow,
      effects: resolution.effects,
      transform: resolution.transform,
    },
  });
  if (result.kind !== "ok") return { kind: "blocked", reason: result.reason };
  return {
    kind: "ok",
    anchorId: anchor.id,
    items: input.items.map(item =>
      item.stableShotId === resolution.stableShotId ? result.item : item
    ),
  };
}

export function planTimelineAnchorRemove(input: {
  items: readonly StoryTimelineItem[];
  stableShotId: string;
  anchorId: string;
}): TimelinePlan {
  const current = input.items.find(
    item => item.stableShotId === input.stableShotId
  );
  if (!current) return { kind: "blocked", reason: "镜头不在时间轴中" };
  const result = removeTimelineAnchor(current, input.anchorId);
  if (result.kind !== "ok") return { kind: "blocked", reason: result.reason };
  return {
    kind: "ok",
    items: clearStaleMagneticDetachments(
      input.items.map(item =>
        item.stableShotId === input.stableShotId ? result.item : item
      )
    ),
  };
}

export function planTimelineTrim(input: {
  items: readonly StoryTimelineItem[];
  stableShotId: string;
  edge: "start" | "end";
  requestedBoundaryFrame: number;
  sourceLimitSec?: number | null;
}): TimelinePlan {
  const current = input.items.find(
    item => item.stableShotId === input.stableShotId
  );
  if (!current) return { kind: "blocked", reason: "镜头不在时间轴中" };
  const result = trimTimelineItem({
    item: current,
    edge: input.edge,
    requestedBoundaryFrame: input.requestedBoundaryFrame,
    sourceLimitSec: input.sourceLimitSec,
  });
  if (result.kind !== "ok") {
    return {
      kind: "blocked",
      reason: result.reason,
      boundaryFrame: result.boundaryFrame,
    };
  }
  return {
    kind: "ok",
    items: clearStaleMagneticDetachments(
      input.items.map(item =>
        item.stableShotId === input.stableShotId ? result.item : item
      )
    ),
  };
}

export type TimelineWriteOutcome = { applied: boolean; reason?: string };

/**
 * Serializes timeline writes by *ignoring* overlapping ones. A duplicate
 * pointer release, a repeated `M`, or a second gesture during a pending save
 * must not compute from placement that is already stale.
 */
export function createTimelineWriteLock(onPendingChange?: (pending: boolean) => void) {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    async run<T extends TimelineWriteOutcome>(
      task: () => Promise<T>,
      blocked: T
    ): Promise<T> {
      if (pending) return blocked;
      pending = true;
      onPendingChange?.(true);
      try {
        return await task();
      } finally {
        pending = false;
        onPendingChange?.(false);
      }
    },
  };
}
