import type {
  StoryTimelineAnchor,
  StoryTimelineItem,
  TimelineTransform,
  TimelineVideoEffects,
} from "@shared/storyMaterial";
import {
  addTimelineAnchor,
  removeTimelineAnchor,
  trimTimelineItem,
} from "@shared/timelineEditing";
import {
  moveTimelineGroup,
  resolveTimelineFrame,
  selectDirectionalGroup,
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
  timelineFrame: number;
}): CreationTimelineFrameResolution {
  const frame = Math.max(0, Math.round(input.timelineFrame));
  const resolved = resolveTimelineFrame(input.rows, frame);
  if (resolved.kind === "gap") return { kind: "gap", timelineFrame: frame };
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
  const moved = moveTimelineGroup(input.items, selection, input.deltaFrames);
  if (moved.kind !== "ok") return { kind: "blocked", reason: moved.reason };
  if (moved.appliedDeltaFrames === 0) {
    return { kind: "blocked", reason: "已经到达时间轴起点" };
  }
  return { kind: "ok", items: moved.items };
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
    items: input.items.map(item =>
      item.stableShotId === input.stableShotId ? result.item : item
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
    items: input.items.map(item =>
      item.stableShotId === input.stableShotId ? result.item : item
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
