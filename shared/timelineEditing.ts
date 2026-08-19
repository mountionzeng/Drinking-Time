import {
  STORY_TIMELINE_FPS,
  timelineFramesToMs,
  timelineMsToFrames,
  timelineOffsetMsToFrames,
  type StoryTimelineAnchor,
  type StoryTimelineItem,
  type StoryTimelinePrimaryVideoEdit,
  type StoryTimelineVisualClip,
} from "./storyMaterial";
import {
  retimeSourceWindow,
  timelineSourceRate,
  type TimelineSourceResolution,
} from "./timelineSource";
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

/**
 * Move a shot's primary source window so every surviving timeline frame keeps
 * showing the same source frame after a trim.
 */
function retimePrimaryVideoEdit(input: {
  edit: StoryTimelinePrimaryVideoEdit;
  previousDurationFrames: number;
  startShiftFrames: number;
  durationFrames: number;
}): StoryTimelinePrimaryVideoEdit {
  const window = retimeSourceWindow({
    window: {
      sourceStartSec: input.edit.sourceStartSec,
      sourceEndSec: input.edit.sourceEndSec,
    },
    rate: timelineSourceRate({
      sourceStartSec: input.edit.sourceStartSec,
      sourceEndSec: input.edit.sourceEndSec,
      durationFrames: input.previousDurationFrames,
      effects: input.edit.effects,
    }),
    reverse: input.edit.effects?.reverse === true,
    startShiftFrames: input.startShiftFrames,
    durationFrames: input.durationFrames,
  });
  return {
    ...input.edit,
    sourceStartSec: window.sourceStartSec,
    sourceEndSec: window.sourceEndSec,
  };
}

/**
 * Re-place internal visual clips against the shot's new head, cutting the
 * head/tail of any clip the trim partially removed and moving its source
 * window by the same amount. Clips outside the new range are dropped.
 */
function retimeVisualClips(input: {
  clips: readonly StoryTimelineVisualClip[];
  startShiftFrames: number;
  durationFrames: number;
}): StoryTimelineVisualClip[] {
  const retimed: StoryTimelineVisualClip[] = [];
  for (const clip of input.clips) {
    const clipDurationFrames = timelineMsToFrames(clip.durationMs);
    const offsetFrame =
      timelineOffsetMsToFrames(clip.offsetMs) - input.startShiftFrames;
    const headCutFrames = Math.max(0, -offsetFrame);
    const tailCutFrames = Math.max(
      0,
      offsetFrame + clipDurationFrames - input.durationFrames
    );
    const remainingFrames = clipDurationFrames - headCutFrames - tailCutFrames;
    if (remainingFrames <= 0) continue;
    const window = retimeSourceWindow({
      window: {
        sourceStartSec: clip.sourceStartSec,
        sourceEndSec: clip.sourceEndSec,
      },
      rate: timelineSourceRate({
        sourceStartSec: clip.sourceStartSec,
        sourceEndSec: clip.sourceEndSec,
        durationFrames: clipDurationFrames,
        effects: clip.effects,
      }),
      reverse: clip.effects?.reverse === true,
      startShiftFrames: headCutFrames,
      durationFrames: remainingFrames,
    });
    retimed.push({
      ...clip,
      offsetMs: timelineFramesToMs(Math.max(0, offsetFrame)),
      durationMs: timelineFramesToMs(remainingFrames),
      sourceStartSec: window.sourceStartSec,
      sourceEndSec: window.sourceEndSec,
    });
  }
  return retimed.sort(
    (left, right) =>
      left.offsetMs - right.offsetMs || left.id.localeCompare(right.id)
  );
}

/**
 * How many extra frames the primary source can still supply beyond the current
 * window at each edge. `null` means the edge is unconstrained by what we know.
 */
function primaryHeadroomFrames(input: {
  item: StoryTimelineItem;
  durationFrames: number;
  edge: "start" | "end";
  sourceLimitSec?: number | null;
}): number | null {
  const edit = input.item.primaryVideoEdit;
  if (!edit || input.item.visualClipsReplacePrimary) return null;
  const rate = timelineSourceRate({
    sourceStartSec: edit.sourceStartSec,
    sourceEndSec: edit.sourceEndSec,
    durationFrames: input.durationFrames,
    effects: edit.effects,
  });
  const reverse = edit.effects?.reverse === true;
  // Extending the head consumes source before the in point (forward) or after
  // the out point (reverse); extending the tail mirrors that.
  const availableSec =
    input.edge === "start"
      ? reverse
        ? input.sourceLimitSec == null
          ? null
          : input.sourceLimitSec - edit.sourceEndSec
        : edit.sourceStartSec
      : reverse
        ? edit.sourceStartSec
        : input.sourceLimitSec == null
          ? null
          : input.sourceLimitSec - edit.sourceEndSec;
  if (availableSec == null) return null;
  return Math.max(0, Math.floor((availableSec * STORY_TIMELINE_FPS) / rate));
}

export type TimelineTrimInput = {
  item: StoryTimelineItem;
  edge: "start" | "end";
  requestedBoundaryFrame: number;
  /** Length of the underlying media, when the caller knows it. */
  sourceLimitSec?: number | null;
};

/**
 * Move one edge of a shot. The opposite edge, every anchor's absolute frame,
 * and every anchor's visible source frame are preserved; the shot's source
 * window and internal clips move with the edge.
 */
export function trimTimelineItem(
  input: TimelineTrimInput
): TimelineEditResult<StoryTimelineItem> {
  const row = buildTimelineLayout([input.item])[0];
  const anchors = [...(input.item.anchors ?? [])].sort(
    (left, right) => left.timelineFrame - right.timelineFrame
  );
  const previousDurationFrames = row.durationFrames;

  if (input.edge === "start") {
    const requestedStart = Math.round(input.requestedBoundaryFrame);
    const firstAnchorFrame = anchors[0]?.timelineFrame ?? null;
    const contentLimit = row.endFrame - 1;
    const maximumStart =
      firstAnchorFrame == null
        ? contentLimit
        : Math.min(firstAnchorFrame, contentLimit);
    if (requestedStart > maximumStart) {
      return {
        kind: "blocked",
        reason:
          firstAnchorFrame != null && firstAnchorFrame <= contentLimit
            ? "不能越过位置锚点"
            : "镜头至少要保留一帧",
        boundaryFrame: maximumStart,
      };
    }
    const headroomFrames = primaryHeadroomFrames({
      item: input.item,
      durationFrames: previousDurationFrames,
      edge: "start",
      sourceLimitSec: input.sourceLimitSec,
    });
    const minimumStart = Math.max(
      0,
      headroomFrames == null ? 0 : row.startFrame - headroomFrames
    );
    if (requestedStart < minimumStart) {
      return {
        kind: "blocked",
        reason: requestedStart < 0 ? "不能移到时间轴起点之前" : "没有更多可用素材",
        boundaryFrame: minimumStart,
      };
    }
    const startShiftFrames = requestedStart - row.startFrame;
    const durationFrames = row.endFrame - requestedStart;
    return {
      kind: "ok",
      item: {
        ...input.item,
        timelineStartFrame: requestedStart,
        durationFrames,
        plannedDurationMs: timelineFramesToMs(durationFrames),
        ...(input.item.primaryVideoEdit
          ? {
              primaryVideoEdit: retimePrimaryVideoEdit({
                edit: input.item.primaryVideoEdit,
                previousDurationFrames,
                startShiftFrames,
                durationFrames,
              }),
            }
          : {}),
        ...(input.item.visualClips
          ? {
              visualClips: retimeVisualClips({
                clips: input.item.visualClips,
                startShiftFrames,
                durationFrames,
              }),
            }
          : {}),
      },
    };
  }

  const requestedEnd = Math.round(input.requestedBoundaryFrame);
  const lastAnchorFrame = anchors.at(-1)?.timelineFrame ?? null;
  const minimumEnd = Math.max(
    row.startFrame + 1,
    lastAnchorFrame == null ? row.startFrame + 1 : lastAnchorFrame + 1
  );
  if (requestedEnd < minimumEnd) {
    return {
      kind: "blocked",
      reason:
        lastAnchorFrame != null && lastAnchorFrame >= row.startFrame
          ? "不能裁掉位置锚点所在画面"
          : "镜头至少要保留一帧",
      boundaryFrame: minimumEnd,
    };
  }
  const headroomFrames = primaryHeadroomFrames({
    item: input.item,
    durationFrames: previousDurationFrames,
    edge: "end",
    sourceLimitSec: input.sourceLimitSec,
  });
  const maximumEnd =
    headroomFrames == null ? null : row.endFrame + headroomFrames;
  if (maximumEnd != null && requestedEnd > maximumEnd) {
    return {
      kind: "blocked",
      reason: "没有更多可用素材",
      boundaryFrame: maximumEnd,
    };
  }
  const durationFrames = requestedEnd - row.startFrame;
  return {
    kind: "ok",
    item: {
      ...input.item,
      timelineStartFrame: row.startFrame,
      durationFrames,
      plannedDurationMs: timelineFramesToMs(durationFrames),
      ...(input.item.primaryVideoEdit
        ? {
            primaryVideoEdit: retimePrimaryVideoEdit({
              edit: input.item.primaryVideoEdit,
              previousDurationFrames,
              startShiftFrames: 0,
              durationFrames,
            }),
          }
        : {}),
      ...(input.item.visualClips
        ? {
            visualClips: retimeVisualClips({
              clips: input.item.visualClips,
              startShiftFrames: 0,
              durationFrames,
            }),
          }
        : {}),
    },
  };
}

/**
 * Cut a shot in two at an absolute frame. Each anchor lands in exactly one
 * child: the cut frame itself belongs to the right child because timeline
 * ranges are half-open.
 */
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
  const anchors = input.item.anchors ?? [];
  const leftAnchors = anchors.filter(anchor => anchor.timelineFrame < cutFrame);
  const rightAnchors = anchors.filter(anchor => anchor.timelineFrame >= cutFrame);

  const left = trimTimelineItem({
    item: {
      ...input.item,
      ...(leftAnchors.length > 0 ? { anchors: leftAnchors } : { anchors: undefined }),
    },
    edge: "end",
    requestedBoundaryFrame: cutFrame,
  });
  const right = trimTimelineItem({
    item: {
      ...input.item,
      ...(rightAnchors.length > 0 ? { anchors: rightAnchors } : { anchors: undefined }),
    },
    edge: "start",
    requestedBoundaryFrame: cutFrame,
  });
  if (left.kind === "blocked") return { kind: "blocked", reason: left.reason };
  if (right.kind === "blocked") return { kind: "blocked", reason: right.reason };
  return {
    kind: "ok",
    left: { ...left.item, stableShotId: input.leftStableShotId },
    right: { ...right.item, stableShotId: input.rightStableShotId },
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
