import { normalizeShotIdentity } from "@shared/shotIdentity";
import {
  timelineFramesToMs,
  type StoryTimelineItem,
} from "@shared/storyMaterial";
import {
  buildTimelineLayout,
  resolveTimelineFrame,
  timelineTotalMs,
  type TimelineLayoutRow,
} from "@shared/timelineLayout";
import {
  hiddenVisualLayerSet,
  normalizeVisualLayer,
  pickVisualWinner,
} from "@shared/timelineVisualPriority";

export const MIN_STORYBOARD_DURATION_MS = 100;
export const MAX_STORYBOARD_DURATION_MS = 12_000;
export const DEFAULT_STORYBOARD_DURATION_MS = 2_400;

export type StoryboardTimingShot = {
  stableShotId?: string | null;
  shotIdentity?: string | null;
  shotKey?: string | null;
  shotNo: number;
  durationMs?: number | null;
};

export type StoryboardTimingRow = {
  stableShotId: string;
  shotNo: number;
  position: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** 结构上的真身：整数帧。毫秒只是显示投影。 */
  startFrame: number;
  durationFrames: number;
  /** 越大越新移动过；重叠时用来决定谁在上面。 */
  stackOrder: number;
  /** 持久视觉层。重叠时先比层，再比 stackOrder——和导出用的是同一条规则。 */
  visualLayer: number;
  /** 这一镜身上的位置锚点（绝对帧）。有锚点就永远压过别人。 */
  anchorFrames: number[];
};

export function storyboardTimingShotId(
  shot: StoryboardTimingShot,
  index = 0
): string {
  return (
    normalizeShotIdentity(shot.stableShotId) ??
    normalizeShotIdentity(shot.shotIdentity) ??
    normalizeShotIdentity(shot.shotKey) ??
    `legacy-sh${String(shot.shotNo).padStart(2, "0")}-${index + 1}`
  );
}

export function clampStoryboardDurationMs(durationMs: number): number {
  return Math.min(
    MAX_STORYBOARD_DURATION_MS,
    Math.max(MIN_STORYBOARD_DURATION_MS, Math.round(durationMs))
  );
}

export function storyboardDurationMsFromSeconds(
  seconds: number
): number | null {
  if (!Number.isFinite(seconds)) return null;
  const durationMs = Math.round(seconds * 1000);
  if (
    durationMs < MIN_STORYBOARD_DURATION_MS ||
    durationMs > MAX_STORYBOARD_DURATION_MS
  ) {
    return null;
  }
  return durationMs;
}

export function storyboardDurationMsFromEndSeconds(
  startMs: number,
  endSeconds: number
): number | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endSeconds)) return null;
  return storyboardDurationMsFromSeconds(endSeconds - startMs / 1000);
}

function rowFromLayout(
  row: TimelineLayoutRow,
  shotNo: number,
  position: number
): StoryboardTimingRow {
  const startMs = timelineFramesToMs(row.startFrame);
  const endMs = timelineFramesToMs(row.endFrame);
  return {
    stableShotId: row.item.stableShotId,
    shotNo,
    position,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    startFrame: row.startFrame,
    durationFrames: row.durationFrames,
    stackOrder: row.stackOrder,
    visualLayer: normalizeVisualLayer(row.item.visualLayer),
    anchorFrames: (row.item.anchors ?? []).map(anchor => anchor.timelineFrame),
  };
}

/**
 * 剪辑行、看板、预览共用的一行行绝对时间。
 *
 * 有 `timelineItems` 就以时间线里的整数帧为准——那是唯一能表达 gap 和 overlap
 * 的真身；没有（旧调用点、还没加载出来）才退回按时长依次累加的老算法。
 */
export function buildStoryboardTimingRows(
  shots: readonly StoryboardTimingShot[],
  timelineShotIds: readonly string[],
  timelineItems?: readonly StoryTimelineItem[] | null
): StoryboardTimingRow[] {
  const shotsById = new Map(
    shots.map((shot, index) => [storyboardTimingShotId(shot, index), shot])
  );

  if (timelineItems && timelineItems.length > 0) {
    const included = new Set(timelineShotIds.map(id => normalizeShotIdentity(id)));
    const rows = buildTimelineLayout(
      timelineItems.filter(
        item => item.included !== false && included.has(item.stableShotId)
      )
    );
    return rows.flatMap((row, position) => {
      const shot = shotsById.get(row.item.stableShotId);
      if (!shot) return [];
      return [rowFromLayout(row, shot.shotNo, position)];
    });
  }

  let cursorMs = 0;
  let cursorFrame = 0;
  return timelineShotIds.flatMap((rawId, position) => {
    const stableShotId = normalizeShotIdentity(rawId);
    const shot = stableShotId ? shotsById.get(stableShotId) : undefined;
    if (!stableShotId || !shot) return [];
    const durationMs = clampStoryboardDurationMs(
      typeof shot.durationMs === "number" && Number.isFinite(shot.durationMs)
        ? shot.durationMs
        : DEFAULT_STORYBOARD_DURATION_MS
    );
    const durationFrames = Math.max(1, Math.round((durationMs * 30) / 1000));
    const startMs = cursorMs;
    const startFrame = cursorFrame;
    cursorMs += durationMs;
    cursorFrame += durationFrames;
    return [
      {
        stableShotId,
        shotNo: shot.shotNo,
        position,
        startMs,
        endMs: cursorMs,
        durationMs,
        startFrame,
        durationFrames,
        stackOrder: position,
        visualLayer: 0,
        anchorFrames: [],
      },
    ];
  });
}

/**
 * 整条片长 = 最大结束时间，不是最后一镜的结尾。移动之后靠前的镜头完全可能
 * 结束得最晚。
 */
export function storyboardTimingTotalMs(
  rows: readonly StoryboardTimingRow[]
): number {
  return rows.reduce((maximum, row) => Math.max(maximum, row.endMs), 0);
}

/**
 * 某个时刻真正播的是哪一镜：锚定的优先，然后按视觉层从上往下，同层再看谁最近
 * 移动过，最后按稳定顺序。空档返回 null——不能残留上一镜。
 *
 * 排序规则来自 `@shared/timelineVisualPriority`，和导出、剪辑行是同一份。以前这里
 * 少比一项 visualLayer：移动过的底层视频 stackOrder 最高，于是预览让底层盖住上层，
 * 而导出仍按图层出片，同一份数据两个答案。
 */
export function storyboardTimingWinnerAt(
  rows: readonly StoryboardTimingRow[],
  timeMs: number,
  hiddenVisualLayers: readonly number[] = []
): StoryboardTimingRow | null {
  const hidden = hiddenVisualLayerSet(hiddenVisualLayers);
  const candidates = rows.filter(
    row =>
      timeMs >= row.startMs &&
      timeMs < row.endMs &&
      !hidden.has(normalizeVisualLayer(row.visualLayer))
  );
  // 老调用点会传只填了一部分字段的行，这里对缺失字段保持宽容：
  // 判赢家不该因为少一个 anchorFrames 就整条崩掉。
  return pickVisualWinner(candidates, row => ({
    anchored: (row.anchorFrames?.length ?? 0) > 0,
    visualLayer: normalizeVisualLayer(row.visualLayer),
    stackOrder: row.stackOrder ?? 0,
    position: row.position,
    tieId: row.stableShotId,
  }));
}

/** 所有结构边界（每一镜的头和尾），排好序去重，用来做切点导航。 */
export function storyboardTimingBoundariesMs(
  rows: readonly StoryboardTimingRow[]
): number[] {
  return Array.from(
    new Set(rows.flatMap(row => [row.startMs, row.endMs]))
  ).sort((left, right) => left - right);
}

export { resolveTimelineFrame, timelineTotalMs };

export function formatStoryboardTimestamp(durationMs: number): string {
  const safeMs = Math.max(0, Math.round(durationMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const milliseconds = safeMs % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

export function formatStoryboardSecondsInput(durationMs: number): string {
  return (durationMs / 1000)
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}
