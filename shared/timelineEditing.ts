import {
  timelineFramesToMs,
  type StoryTimelineAnchor,
  type StoryTimelineItem,
} from "./storyMaterial";
import type { TimelineSourceResolution } from "./timelineSource";
import {
  buildTimelineLayout,
  durationFramesForItem,
  type TimelineLayoutRow,
} from "./timelineLayout";

export type TimelineEditResult<T> =
  | { kind: "ok"; item: T }
  | { kind: "blocked"; reason: string; boundaryFrame?: number };

export function addTimelineAnchor(input: {
  item: StoryTimelineItem;
  anchor: StoryTimelineAnchor;
  resolved: TimelineSourceResolution;
}): TimelineEditResult<StoryTimelineItem> {
  if (input.resolved.kind === "gap") {
    return { kind: "blocked", reason: "当前时间没有可标记的画面" };
  }
  if (input.item.anchors?.some(anchor => anchor.timelineFrame === input.anchor.timelineFrame)) {
    return { kind: "blocked", reason: "这一帧已经有位置锚点" };
  }
  return {
    kind: "ok",
    item: {
      ...input.item,
      anchors: [...(input.item.anchors ?? []), input.anchor].sort(
        (left, right) => left.timelineFrame - right.timelineFrame || left.id.localeCompare(right.id)
      ),
    },
  };
}

export function removeTimelineAnchor(
  item: StoryTimelineItem,
  anchorId: string
): TimelineEditResult<StoryTimelineItem> {
  const anchors = (item.anchors ?? []).filter(anchor => anchor.id !== anchorId);
  if (anchors.length === (item.anchors ?? []).length) {
    return { kind: "blocked", reason: "找不到这个位置锚点" };
  }
  return {
    kind: "ok",
    item: {
      ...item,
      ...(anchors.length > 0 ? { anchors } : { anchors: undefined }),
    },
  };
}

export function trimTimelineItem(input: {
  item: StoryTimelineItem;
  edge: "start" | "end";
  requestedBoundaryFrame: number;
}): TimelineEditResult<StoryTimelineItem> {
  const row = buildTimelineLayout([input.item])[0];
  const anchors = [...(input.item.anchors ?? [])].sort(
    (left, right) => left.timelineFrame - right.timelineFrame
  );
  const oldEndFrame = row.endFrame;
  if (input.edge === "start") {
    const requestedStart = Math.max(0, Math.round(input.requestedBoundaryFrame));
    const firstAnchor = anchors[0];
    const maximumStart = firstAnchor
      ? firstAnchor.timelineFrame
      : oldEndFrame - 1;
    if (requestedStart > maximumStart) {
      return {
        kind: "blocked",
        reason: "不能越过位置锚点",
        boundaryFrame: maximumStart,
      };
    }
    const durationFrames = oldEndFrame - requestedStart;
    return {
      kind: "ok",
      item: {
        ...input.item,
        timelineStartFrame: requestedStart,
        durationFrames,
        plannedDurationMs: timelineFramesToMs(durationFrames),
      },
    };
  }

  const requestedEnd = Math.max(row.startFrame + 1, Math.round(input.requestedBoundaryFrame));
  const lastAnchor = anchors.at(-1);
  const minimumEnd = lastAnchor ? lastAnchor.timelineFrame + 1 : row.startFrame + 1;
  if (requestedEnd < minimumEnd) {
    return {
      kind: "blocked",
      reason: "不能裁掉位置锚点所在画面",
      boundaryFrame: minimumEnd,
    };
  }
  const durationFrames = requestedEnd - row.startFrame;
  return {
    kind: "ok",
    item: {
      ...input.item,
      durationFrames,
      plannedDurationMs: timelineFramesToMs(durationFrames),
    },
  };
}

export function splitTimelineItem(input: {
  item: StoryTimelineItem;
  cutFrame: number;
  leftStableShotId: string;
  rightStableShotId: string;
}):
  | { kind: "ok"; left: StoryTimelineItem; right: StoryTimelineItem }
  | { kind: "blocked"; reason: string } {
  const row = buildTimelineLayout([input.item])[0];
  const cutFrame = Math.round(input.cutFrame);
  if (cutFrame <= row.startFrame || cutFrame >= row.endFrame) {
    return { kind: "blocked", reason: "切点必须位于镜头内部" };
  }
  const crossingAnchor = (input.item.anchors ?? []).some(
    anchor => anchor.timelineFrame === cutFrame
  );
  if (crossingAnchor) {
    return { kind: "blocked", reason: "切点不能落在位置锚点帧上" };
  }
  const anchors = input.item.anchors ?? [];
  const leftDuration = cutFrame - row.startFrame;
  const rightDuration = row.endFrame - cutFrame;
  const base = { ...input.item, anchors: undefined };
  const leftAnchors = anchors.filter(anchor => anchor.timelineFrame < cutFrame);
  const rightAnchors = anchors.filter(anchor => anchor.timelineFrame >= cutFrame);
  return {
    kind: "ok",
    left: {
      ...base,
      stableShotId: input.leftStableShotId,
      durationFrames: leftDuration,
      plannedDurationMs: timelineFramesToMs(leftDuration),
      ...(leftAnchors.length > 0 ? { anchors: leftAnchors } : {}),
    },
    right: {
      ...base,
      stableShotId: input.rightStableShotId,
      timelineStartFrame: cutFrame,
      durationFrames: rightDuration,
      plannedDurationMs: timelineFramesToMs(rightDuration),
      ...(rightAnchors.length > 0 ? { anchors: rightAnchors } : {}),
    },
  };
}

export function timelineItemHasAnchor(item: StoryTimelineItem): boolean {
  return (item.anchors?.length ?? 0) > 0;
}

export function timelineItemDurationFrames(item: StoryTimelineItem): number {
  return durationFramesForItem(item);
}

export function timelineAnchorFrames(row: TimelineLayoutRow): number[] {
  return (row.item.anchors ?? []).map(anchor => anchor.timelineFrame);
}
