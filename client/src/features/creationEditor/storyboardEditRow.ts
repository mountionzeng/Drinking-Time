import type { StoryTimelineVisualClip } from "@shared/storyMaterial";
import type { SelectionSourceType } from "@shared/selectionContext";
import {
  msToPx,
  pxDeltaToFrame,
  pxDeltaToMs,
  pxToMs,
  type TimelineViewport,
} from "@shared/timelineViewport";

import {
  clampStoryboardDurationMs,
  formatStoryboardTimestamp,
  storyboardTimingBoundariesMs,
  storyboardTimingWinnerAt,
  type StoryboardTimingRow,
} from "@/features/storyAgent/storyboardTiming";

/** 短于这个长度的拖拽当成「点一下定位」，而不是「选一段」。 */
const STORYBOARD_EDIT_MIN_SELECTION_MS = 80;

/** 走带和微调时长的最小步长，按 30fps 算一帧。 */
export const STORYBOARD_EDIT_FRAME_MS = 1000 / 30;
const STORYBOARD_MAGNET_THRESHOLD_PX = 8;

export type StoryboardVisualClipNudge = {
  clipId: string;
  startVisualLayer: number;
  deltaVisualLayers: number;
  startFrame: number;
  deltaFrames: number;
  move: (input: {
    clipId: string;
    visualLayer: number;
    toStartFrame: number;
  }) => Promise<void>;
};

/** 聚焦拖动目标，但不能让浏览器替用户滚动时间线。 */
export function focusStoryboardClipForDrag(
  element: Pick<HTMLElement, "focus">
): void {
  element.focus({ preventScroll: true });
}

/** 把手指/鼠标的轻微抖动留给点击；达到 4px 才进入真正的剪辑拖动。 */
export function isStoryboardClipPointerDrag(
  start: { clientX: number; clientY: number },
  release: { clientX: number; clientY: number }
): boolean {
  return (
    Math.hypot(release.clientX - start.clientX, release.clientY - start.clientY) >=
    4
  );
}

/** Only the pointer that started a drag may continue or finish it. */
export function isStoryboardPointerOwner(
  activePointerId: number,
  eventPointerId: number
): boolean {
  return activePointerId === eventPointerId;
}

/**
 * 时间视口必须包住所有会画在时间线上的内容，不能只看最后一个视频镜头。
 * overlay 和独立音轨完全可能延伸到片尾之后。
 */
export function storyboardTimelineContentTotalMs(
  shotTotalMs: number,
  timeline?: {
    totalMs?: number;
    audioTotalMs?: number;
    audioClips?: readonly { endMs: number }[];
    overlays?: readonly { endFrame: number }[];
  }
): number {
  return Math.max(
    0,
    shotTotalMs,
    timeline?.totalMs ?? 0,
    timeline?.audioTotalMs ?? 0,
    ...(timeline?.audioClips ?? []).map(clip => clip.endMs),
    ...(timeline?.overlays ?? []).map(overlay => (overlay.endFrame * 1000) / 30)
  );
}

/**
 * 合并连续的方向键微调，并且串行化真正的写入。
 *
 * 以前键盘事件在 mutation pending 时直接 return，所以用户按了四次可能只落
 * 三次。这里记的是「用户最终想去的帧」：同一段连按只提交一次；如果
 * 上一次已经在写，新输入留在队列里，等它完成后再提交，不丢掉。
 */
export function createStoryboardVisualClipNudgeQueue(input?: {
  delayMs?: number;
  onError?: (error: unknown) => void;
}) {
  type PendingNudge = Pick<StoryboardVisualClipNudge, "clipId" | "move"> & {
    visualLayer: number;
    toStartFrame: number;
  };

  const delayMs = Math.max(0, input?.delayMs ?? 120);
  const pending = new Map<string, PendingNudge>();
  const latestTarget = new Map<
    string,
    { visualLayer: number; toStartFrame: number }
  >();
  let inFlight: PendingNudge | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = async (): Promise<void> => {
    clearTimer();
    if (disposed || inFlight) return;
    const nextEntry = pending.entries().next().value as
      | [string, PendingNudge]
      | undefined;
    if (!nextEntry) return;
    const [clipId, next] = nextEntry;
    pending.delete(clipId);
    inFlight = next;
    try {
      await next.move({
        clipId: next.clipId,
        visualLayer: next.visualLayer,
        toStartFrame: next.toStartFrame,
      });
    } catch (error) {
      // A server rejection is terminal when nothing newer was accepted. If the
      // user nudged this clip while the write was in flight, preserve that
      // explicit newer intent and let the serialized queue flush it.
      if (!pending.has(clipId)) latestTarget.delete(clipId);
      input?.onError?.(error);
    } finally {
      inFlight = null;
      if (!pending.has(clipId)) latestTarget.delete(clipId);
      if (!disposed && pending.size > 0) void flush();
    }
  };

  const schedule = () => {
    // Keep the deadline established by the oldest queued clip. Resetting one
    // global timer on every enqueue lets activity on another clip postpone it
    // forever. Inputs still merge until this fixed batching window expires.
    if (timer != null) return;
    timer = setTimeout(() => void flush(), delayMs);
  };

  return {
    enqueue(nudge: StoryboardVisualClipNudge) {
      if (disposed) return;
      const previous = latestTarget.get(nudge.clipId);
      const toStartFrame = Math.max(
        0,
        Math.round(
          (previous?.toStartFrame ?? nudge.startFrame) + nudge.deltaFrames
        )
      );
      const visualLayer = Math.max(
        0,
        (previous?.visualLayer ?? nudge.startVisualLayer) +
          nudge.deltaVisualLayers
      );
      const next = {
        clipId: nudge.clipId,
        visualLayer,
        toStartFrame,
        move: nudge.move,
      };
      latestTarget.set(nudge.clipId, {
        visualLayer,
        toStartFrame,
      });
      pending.set(nudge.clipId, next);
      schedule();
    },
    flush,
    dispose() {
      disposed = true;
      clearTimer();
      pending.clear();
      latestTarget.clear();
    },
  };
}

/** Keep the magnetic feel stable on screen even when the timeline zoom changes. */
export function storyboardMagnetThresholdFrames(input: {
  viewport: TimelineViewport;
  thresholdPx?: number;
}): number {
  if (!(input.viewport.totalMs > 0)) return 0;
  return Math.max(
    1,
    Math.abs(
      pxDeltaToFrame(
        input.viewport,
        input.thresholdPx ?? STORYBOARD_MAGNET_THRESHOLD_PX
      )
    )
  );
}

/** Compute from the current pointer coordinate so release never commits stale React state. */
export function storyboardRollingBoundaryFrame(input: {
  baseBoundaryFrame: number;
  leftStartFrame: number;
  rightEndFrame: number;
  startClientX: number;
  currentClientX: number;
  viewport: TimelineViewport;
}): number {
  if (!(input.viewport.totalMs > 0)) {
    return input.baseBoundaryFrame;
  }
  const deltaFrames = pxDeltaToFrame(
    input.viewport,
    input.currentClientX - input.startClientX
  );
  return Math.max(
    input.leftStartFrame + 1,
    Math.min(input.rightEndFrame - 1, input.baseBoundaryFrame + deltaFrames)
  );
}

export type StoryboardEditSegment = {
  id: string;
  kind: "primary" | "clip";
  leftPct: number;
  widthPct: number;
  label: string;
  clip: StoryTimelineVisualClip | null;
};

/** 剪辑条 filmstrip 所需的最小视频来源；不把整份 Take 数据塞进展示组件。 */
export type StoryboardEditFrameSource = {
  takeId: number;
  rangeId?: number | null;
  sourceStartSec: number;
  sourceEndSec: number;
  reverse?: boolean;
};

/**
 * 为一个视频段均匀抽取缩略帧。每秒一格、最多六格，配合图片 lazy-load，
 * 既能看见段内动作变化，也不会让一条长故事版同时启动几百次抽帧。
 */
export function storyboardEditFilmstripFrameUrls(input: {
  source: StoryboardEditFrameSource | null | undefined;
  durationMs: number;
  maxFrames?: number;
}): string[] {
  const source = input.source;
  if (!source || !Number.isInteger(source.takeId) || source.takeId <= 0) {
    return [];
  }
  const sourceStartSec = Math.max(0, source.sourceStartSec);
  const sourceEndSec = Math.max(sourceStartSec, source.sourceEndSec);
  if (!(sourceEndSec > sourceStartSec)) return [];
  const frameCount = Math.min(
    Math.max(1, Math.round(input.maxFrames ?? 6)),
    Math.max(1, Math.ceil(Math.max(1, input.durationMs) / 1_000))
  );
  const rangeQuery =
    source.rangeId != null &&
    Number.isInteger(source.rangeId) &&
    source.rangeId > 0
      ? `&rangeId=${source.rangeId}`
      : "";
  return Array.from({ length: frameCount }, (_, index) => {
    const progress = (index + 0.5) / frameCount;
    const directedProgress = source.reverse ? 1 - progress : progress;
    const atSec =
      sourceStartSec + (sourceEndSec - sourceStartSec) * directedProgress;
    return `/api/video-frames/${source.takeId}?atSec=${atSec.toFixed(3)}${rangeQuery}`;
  });
}

export type StoryboardEditRange = {
  startMs: number;
  endMs: number;
};

/** 剪辑条上的一个镜头块：位置和宽度都是时间视口里的绝对像素。 */
export type StoryboardEditBlock = {
  timing: StoryboardTimingRow;
  leftPx: number;
  widthPx: number;
};

/**
 * 把真实 PCM 振幅压成少量波形柱。每段先取峰值，再按整段最大峰值归一化，
 * 这样能看清停顿、重音和渐强，而不会因为录音整体偏小只剩一条细线。
 */
export function storyboardAudioPeaks(
  samples: Float32Array,
  requestedBarCount: number
): number[] {
  const barCount = Math.max(1, Math.round(requestedBarCount));
  if (samples.length === 0) return Array.from({ length: barCount }, () => 0);
  const peaks = Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor((index / barCount) * samples.length);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) / barCount) * samples.length)
    );
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, Math.abs(samples[sampleIndex] ?? 0));
    }
    return peak;
  });
  const maxPeak = Math.max(...peaks);
  if (!(maxPeak > 0)) return peaks;
  return peaks.map(peak => Number((peak / maxPeak).toFixed(4)));
}

/** 把鼠标横坐标换算成整条时间线上的绝对毫秒。 */
export function storyboardEditTrackMs(input: {
  clientX: number;
  trackLeft: number;
  viewport: TimelineViewport;
}): number {
  if (!(input.viewport.totalMs > 0)) return 0;
  return Math.min(
    input.viewport.totalMs,
    Math.round(pxToMs(input.viewport, input.clientX - input.trackLeft))
  );
}

/**
 * 剪辑条不跟镜头列对齐，它按视口的每秒像素数铺在一整行：
 * 长镜头就宽，短镜头就窄，和上面固定列宽的镜头信息靠编号与选中状态关联。
 */
export function storyboardEditBlocks(
  timings: readonly StoryboardTimingRow[],
  viewport: TimelineViewport
): StoryboardEditBlock[] {
  if (!(viewport.totalMs > 0)) return [];
  return timings.map(timing => ({
    timing,
    leftPx: msToPx(viewport, timing.startMs),
    widthPx: msToPx(viewport, timing.durationMs),
  }));
}

/**
 * 拖边缘拿到的新时长，换算成另一头锚定不动时对应的绝对帧边界。
 * edge="start" 时右端（尾）不动，只有左端（首）在移动；edge="end" 反过来。
 * 帧数字的意义就在这里：旧的按毫秒改时长会被 durationFrames 优先级盖掉，
 * 所以裁剪必须落到帧边界上才真的生效，而不是松手就被弹回原状。
 */
export function storyboardTrimmedBoundaryFrame(input: {
  startFrame: number;
  durationFrames: number;
  edge: "start" | "end";
  newDurationMs: number;
}): number {
  const newDurationFrames = Math.max(
    1,
    Math.round((input.newDurationMs * 30) / 1000)
  );
  return input.edge === "start"
    ? input.startFrame + input.durationFrames - newDurationFrames
    : input.startFrame + newDurationFrames;
}

/** 拖任一边缘改时长：左边缘的拖动方向与右边缘相反。 */
export function storyboardTrimmedDurationMs(input: {
  baseDurationMs: number;
  viewport: TimelineViewport;
  deltaPx: number;
  edge?: "start" | "end";
  maxDurationMs?: number;
}): number {
  if (!(input.viewport.totalMs > 0)) {
    return clampStoryboardDurationMs(input.baseDurationMs);
  }
  const deltaMs = pxDeltaToMs(input.viewport, input.deltaPx);
  const durationMs = clampStoryboardDurationMs(
    input.baseDurationMs + (input.edge === "start" ? -deltaMs : deltaMs)
  );
  return input.maxDurationMs == null
    ? durationMs
    : Math.min(durationMs, input.maxDurationMs);
}

/**
 * 一个镜头块内部画成哪些段：主画面铺满，视频片段按 offset 叠在上面。
 * 片段完全替代主画面时（visualClipsReplacePrimary）就不画主画面段。
 */
export function storyboardEditSegments(input: {
  durationMs: number;
  label: string;
  visualClips?: readonly StoryTimelineVisualClip[] | null;
  visualClipsReplacePrimary?: boolean;
}): StoryboardEditSegment[] {
  const durationMs = Math.max(1, input.durationMs);
  const clips = [...(input.visualClips ?? [])].sort(
    (left, right) => left.offsetMs - right.offsetMs
  );
  const clipSegments = clips.flatMap<StoryboardEditSegment>(clip => {
    const leftPct = Math.min(
      100,
      Math.max(0, (clip.offsetMs / durationMs) * 100)
    );
    const widthPct = Math.min(
      100 - leftPct,
      Math.max(0, (clip.durationMs / durationMs) * 100)
    );
    if (widthPct <= 0) return [];
    return [
      {
        id: clip.id,
        kind: "clip",
        leftPct,
        widthPct,
        label: clip.label,
        clip,
      },
    ];
  });
  if (input.visualClipsReplacePrimary && clipSegments.length > 0) {
    return clipSegments;
  }
  return [
    {
      id: "primary",
      kind: "primary",
      leftPct: 0,
      widthPct: 100,
      label: input.label,
      clip: null,
    },
    ...clipSegments,
  ];
}

/** 拖出来的区间；太短就返回 null，让调用方按「点一下」处理。 */
export function storyboardEditSelectionRange(
  anchorMs: number,
  focusMs: number
): StoryboardEditRange | null {
  const startMs = Math.min(anchorMs, focusMs);
  const endMs = Math.max(anchorMs, focusMs);
  return endMs - startMs < STORYBOARD_EDIT_MIN_SELECTION_MS
    ? null
    : { startMs, endMs };
}

/** 选区在整条时间线上的位置，用来画高亮；空区间返回 null。 */
export function storyboardEditRangePx(
  range: StoryboardEditRange,
  viewport: TimelineViewport
): { leftPx: number; widthPx: number } | null {
  if (!(viewport.totalMs > 0)) return null;
  const startMs = Math.max(0, Math.min(range.startMs, viewport.totalMs));
  const endMs = Math.max(startMs, Math.min(range.endMs, viewport.totalMs));
  if (endMs <= startMs) return null;
  return {
    leftPx: msToPx(viewport, startMs),
    widthPx: msToPx(viewport, endMs - startMs),
  };
}

/** 播放头在整条时间线上的位置。 */
export function storyboardEditPlayheadPx(
  playheadMs: number,
  viewport: TimelineViewport
): number | null {
  if (
    !(viewport.totalMs > 0) ||
    playheadMs < 0 ||
    playheadMs > viewport.totalMs
  )
    return null;
  return msToPx(viewport, playheadMs);
}

/** 键盘微调时长：在故事版允许的范围内加减，取整到毫秒。 */
export function storyboardEditNudgedDurationMs(
  baseDurationMs: number,
  deltaMs: number
): number {
  return Math.round(clampStoryboardDurationMs(baseDurationMs + deltaMs));
}

/** 走带：在 [0, totalMs] 里挪播放头。 */
export function storyboardEditSeekMs(
  playheadMs: number,
  deltaMs: number,
  totalMs: number
): number {
  return Math.max(0, Math.min(totalMs, Math.round(playheadMs + deltaMs)));
}

/**
 * 跳到上一个／下一个剪辑点（镜头的开头）。主流剪辑软件的上下方向键就是这个，
 * 比一帧一帧挪快得多。往回跳时容差 1 帧，免得刚跳过去就被自己挡住。
 */
export function storyboardEditEdgeMs(
  timings: readonly StoryboardTimingRow[],
  playheadMs: number,
  direction: "prev" | "next"
): number | null {
  // 每一镜的头和尾都是切点。移动之后靠前的镜头可能结束得最晚，
  // 所以不能只拿「最后一镜的结尾」当收尾边界。
  const edges = storyboardTimingBoundariesMs(timings);
  if (direction === "next") {
    return edges.find(edge => edge > playheadMs + 1) ?? null;
  }
  return (
    [...edges]
      .reverse()
      .find(edge => edge < playheadMs - STORYBOARD_EDIT_FRAME_MS) ?? null
  );
}

/** 左边／右边紧挨着的那一镜，用来做「前移一位 / 后移一位」。 */
export function storyboardEditNeighborShotId(
  timings: readonly StoryboardTimingRow[],
  stableShotId: string,
  direction: "prev" | "next"
): string | null {
  const index = timings.findIndex(
    timing => timing.stableShotId === stableShotId
  );
  if (index < 0) return null;
  return (
    timings[direction === "prev" ? index - 1 : index + 1]?.stableShotId ?? null
  );
}

/** 落在这个时间点上的镜头。 */
export function storyboardEditTimingAt(
  timings: readonly StoryboardTimingRow[],
  timeMs: number
): StoryboardTimingRow | null {
  const winner = storyboardTimingWinnerAt(timings, timeMs);
  if (winner) return winner;
  // 正好停在整条的收尾上时仍然算作最后结束的那一镜；其余空档一律 null。
  const endingHere = timings.filter(timing => timing.endMs === timeMs);
  if (endingHere.length === 0) return null;
  return [...endingHere].sort(
    (left, right) => right.stackOrder - left.stackOrder
  )[0];
}

/**
 * 选中一段之后交给对话框的说明文字。选区可以横跨几个镜头，所以这里分两种写法：
 * 落在一个镜头里就写镜头内部的相对时间，跨镜头就把跨到的镜头都点名，
 * 免得纳音以为「2.77–6.93 秒」全都发生在只有 3 秒长的那一镜里。
 */
export function storyboardEditSelectionSummary(input: {
  shotLabels: readonly string[];
  range: StoryboardEditRange;
  timing: { startMs: number; durationMs: number };
}): { selectedText: string; fullText: string } {
  const firstLabel = input.shotLabels[0] ?? "镜头";
  const lastLabel = input.shotLabels.at(-1) ?? firstLabel;
  const filmTime = `${formatStoryboardTimestamp(input.range.startMs)}–${formatStoryboardTimestamp(input.range.endMs)}`;
  const lengthSec = (input.range.endMs - input.range.startMs) / 1000;
  const localStartMs = Math.max(0, input.range.startMs - input.timing.startMs);

  if (input.shotLabels.length > 1) {
    return {
      selectedText: `${firstLabel}–${lastLabel} · ${filmTime}`,
      fullText: `从 ${firstLabel} 的 ${(localStartMs / 1000).toFixed(
        2
      )} 秒起，一直到 ${lastLabel}，跨 ${input.shotLabels.length} 个镜头（${input.shotLabels.join(
        "、"
      )}；成片 ${filmTime}，共 ${lengthSec.toFixed(2)} 秒）`,
    };
  }

  const localEndMs = Math.min(
    input.timing.durationMs,
    Math.max(localStartMs, input.range.endMs - input.timing.startMs)
  );
  return {
    selectedText: `${firstLabel} · ${filmTime}`,
    fullText: `${firstLabel} 的 ${(localStartMs / 1000).toFixed(2)}–${(
      localEndMs / 1000
    ).toFixed(2)} 秒（成片 ${filmTime}，共 ${lengthSec.toFixed(2)} 秒）`,
  };
}

/**
 * 六点把手要挪多远才算「开始拖」。低于这个距离一律当成误触，
 * 免得想右键或想选中的时候整组镜头跟着抖一下。
 */
const STORYBOARD_GROUP_DRAG_THRESHOLD_PX = 4;

/** 抓手默认服从当前单镜选择；整组移动必须由 Shift 明确触发。 */
export function storyboardGripDragMode(input: {
  shiftKey: boolean;
  singleMoveEnabled: boolean;
  groupMoveEnabled: boolean;
}): "single" | "group" | null {
  if (input.shiftKey && input.groupMoveEnabled) return "group";
  if (input.singleMoveEnabled) return "single";
  if (input.groupMoveEnabled) return "group";
  return null;
}

/**
 * 方向在越过阈值的那一刻锁死：往左拖就带上左边一串，往右拖就带上右边一串。
 * 锁定之后即使指针又划回起点另一侧，组员也不再换人。
 */
export function storyboardGroupDragDirection(
  deltaPx: number
): "left" | "right" | null {
  if (Math.abs(deltaPx) < STORYBOARD_GROUP_DRAG_THRESHOLD_PX) return null;
  return deltaPx < 0 ? "left" : "right";
}

/** 一次拖动只量化一次：像素 → 整数帧。 */
export function storyboardGroupDragDeltaFrames(input: {
  deltaPx: number;
  viewport: TimelineViewport;
}): number {
  if (!(input.viewport.totalMs > 0)) return 0;
  return pxDeltaToFrame(input.viewport, input.deltaPx);
}

/**
 * 把视觉剪辑拖动投影成“镜头信息列”的瞬态时间，只用于界面预览。
 * 图片有自己的绝对位置，不对应一整列镜头信息，因此永远不产生表格预览。
 */
export type StoryboardShotTimingPreview = {
  stableShotId: string;
  startFrame: number;
  endFrame: number;
};

export function storyboardVisualClipShotTimingPreview(
  input:
    | { kind: "image" }
    | {
        kind: "shot";
        stableShotId: string;
        startFrame: number;
        durationFrames: number;
        deltaFrames: number;
      }
): StoryboardShotTimingPreview | null {
  if (input.kind !== "shot") return null;
  const startFrame = Math.max(
    0,
    Math.round(input.startFrame + input.deltaFrames)
  );
  const durationFrames = Math.max(1, Math.round(input.durationFrames));
  return {
    stableShotId: input.stableShotId,
    startFrame,
    endFrame: startFrame + durationFrames,
  };
}

/**
 * 一次 pointermove 之后这次拖动应该处于什么状态：还没越过阈值就是 null，
 * 否则给出方向和已经量化好的整数帧位移。
 *
 * 关键点是「锁定方向的那一次也要把位移算出来」——快速甩动或触摸板轻扫可能
 * 只产生一个 pointermove，如果那一次只锁方向不算位移，松手时位移永远是 0，
 * 整个拖动就白做了。
 */
export function storyboardGroupDragStep(input: {
  lockedDirection: "left" | "right" | null;
  deltaPx: number;
  viewport: TimelineViewport;
}): { direction: "left" | "right"; deltaFrames: number } | null {
  const direction =
    input.lockedDirection ?? storyboardGroupDragDirection(input.deltaPx);
  if (!direction) return null;
  return {
    direction,
    deltaFrames: storyboardGroupDragDeltaFrames({
      deltaPx: input.deltaPx,
      viewport: input.viewport,
    }),
  };
}

/** 拖动过程中念给用户听的一句话：方向、带上了谁、挪多远、被谁挡住。 */
export function storyboardGroupDragSummary(input: {
  direction: "left" | "right";
  shotLabels: readonly string[];
  deltaFrames: number;
  boundaryLabel: string | null;
}): string {
  const deltaSec = (input.deltaFrames / 30).toFixed(2);
  const sign = input.deltaFrames > 0 ? "+" : "";
  const extent =
    input.shotLabels.length > 1
      ? `${input.shotLabels[0]}–${input.shotLabels.at(-1)}（${input.shotLabels.length} 镜）`
      : (input.shotLabels[0] ?? "这一镜");
  const boundary = input.boundaryLabel
    ? ` · 到 ${input.boundaryLabel} 为止，它有位置锚点`
    : "";
  return `${input.direction === "left" ? "向左" : "向右"}整体移动 ${extent} · ${sign}${deltaSec}s${boundary}`;
}

/** 右键菜单里能做的事。 */
export type StoryboardEditAction =
  | "addAnchor"
  | "removeAnchor"
  | "detachMagnet"
  | "split"
  | "extract"
  | "selectShot"
  | "trimMinusFrame"
  | "trimPlusFrame"
  | "trimMinusHalfSec"
  | "trimPlusHalfSec"
  | "moveLeft"
  | "moveRight"
  | "insertAfter"
  | "delete";

export type StoryboardEditMenuItem = {
  action: StoryboardEditAction;
  label: string;
  /** 展示用的快捷键，和 storyboardEditShortcut 的映射保持一致。 */
  shortcut: string;
  /** 不为 null 就是灰的，文案直接告诉用户为什么点不了。 */
  disabledReason: string | null;
  danger: boolean;
  groupStart: boolean;
};

/**
 * 右键点在某一镜上时能做什么。灰掉的项也留在菜单里并写明原因——
 * 之前「按了小剪刀没反应」就是因为那一镜还没有视频，报错被别的横幅盖住了。
 */
export function storyboardEditMenuItems(input: {
  shotLabel: string;
  /** 右键点下去的那个时间点上有没有可切的视频。 */
  canSplitHere: boolean;
  /** 图片和视频都能抽取成相邻上层的一帧图片。 */
  canExtractHere?: boolean;
  isFirst: boolean;
  isLast: boolean;
  shotCount: number;
  canInsert: boolean;
  canDelete: boolean;
  /** 位置锚点相关；不传就当这套能力还没接上，菜单里不出现。 */
  anchors?: {
    /** 播放头这一刻是不是空档；空档不能打标。 */
    inGap: boolean;
    /** 播放头这一帧已经有锚点了。 */
    alreadyAnchored: boolean;
    /** 有没有一个可删的锚点（焦点上的或播放头这一帧的）。 */
    removableAnchorLabel: string | null;
  };
  /** The context click landed on an enabled magnetic seam. */
  canDetachMagnet?: boolean;
}): StoryboardEditMenuItem[] {
  const noVideo = input.canSplitHere
    ? null
    : "这一处还没有视频，先给这一镜生成或采用视频";
  const noVisual = (input.canExtractHere ?? input.canSplitHere)
    ? null
    : "这一处还没有可提取的图片或视频";
  const items: StoryboardEditMenuItem[] = [];
  if (input.anchors) {
    items.push({
      action: "addAnchor",
      label: "在播放头钉一个位置锚点",
      shortcut: "M",
      disabledReason: input.anchors.inGap
        ? "这一刻是空档，没有可标记的画面"
        : input.anchors.alreadyAnchored
          ? "这一帧已经有位置锚点"
          : null,
      danger: false,
      groupStart: false,
    });
    items.push({
      action: "removeAnchor",
      label: input.anchors.removableAnchorLabel
        ? `取消位置锚点 ${input.anchors.removableAnchorLabel}`
        : "取消位置锚点",
      shortcut: "⌫",
      disabledReason: input.anchors.removableAnchorLabel
        ? null
        : "这一帧没有位置锚点",
      danger: false,
      groupStart: false,
    });
  }
  if (input.canDetachMagnet) {
    items.push({
      action: "detachMagnet",
      label: "取消这两个镜头的吸附",
      shortcut: "",
      disabledReason: null,
      danger: false,
      groupStart: items.length > 0,
    });
  }
  items.push(
    {
      action: "split",
      label: "在这里切一刀",
      shortcut: "S",
      disabledReason: noVideo,
      danger: false,
      groupStart: false,
    },
    {
      action: "extract",
      label: "抽帧（存成画面）",
      shortcut: "F",
      disabledReason: noVisual,
      danger: false,
      groupStart: false,
    },
    {
      action: "selectShot",
      label: `选中 ${input.shotLabel} 交给聊聊`,
      shortcut: "X",
      disabledReason: null,
      danger: false,
      groupStart: false,
    },
    {
      action: "moveLeft",
      label: "往前挪一位",
      shortcut: "⌥←",
      disabledReason: input.isFirst ? "已经是第一镜" : null,
      danger: false,
      groupStart: true,
    },
    {
      action: "moveRight",
      label: "往后挪一位",
      shortcut: "⌥→",
      disabledReason: input.isLast ? "已经是最后一镜" : null,
      danger: false,
      groupStart: false,
    }
  );
  if (input.canInsert) {
    items.push({
      action: "insertAfter",
      label: "在后面加一镜",
      shortcut: "⏎",
      disabledReason: null,
      danger: false,
      groupStart: true,
    });
  }
  if (input.canDelete) {
    items.push({
      action: "delete",
      label: `删掉 ${input.shotLabel}`,
      shortcut: "⌫",
      disabledReason: input.shotCount <= 1 ? "至少保留一个镜头" : null,
      danger: true,
      groupStart: !input.canInsert,
    });
  }
  return items;
}

/**
 * 会改动故事结构的两个动作。它们要求焦点还在剪辑行里，
 * 免得你在别处按了退格（想「返回」）就弹出删镜头的确认框。
 */
const STRUCTURAL_ACTIONS = new Set<StoryboardEditAction>([
  "insertAfter",
  "delete",
]);

export function storyboardEditNeedsRowFocus(action: StoryboardEditAction) {
  return STRUCTURAL_ACTIONS.has(action);
}

/**
 * 这次按键该不该被剪辑行接走。剪辑台里点过任何一个按钮之后焦点就不在时间条上了，
 * 所以快捷键挂在 window 上，用这个函数把不该抢的场合排掉：
 * 正在输入、别人已经处理过、或者空格键正落在某个按钮上（那是在按那个按钮）。
 */
export function storyboardEditShouldHandleKey(input: {
  key: string;
  defaultPrevented: boolean;
  isEditableTarget: boolean;
  isButtonTarget: boolean;
  rowVisible: boolean;
  /** 焦点是否落在时间尺的位置锚点标记上。 */
  isAnchorTarget?: boolean;
  /** 焦点是否落在可用方向键直接移动的图片/视频剪辑上。 */
  isVisualClipMoveTarget?: boolean;
}): boolean {
  if (!input.rowVisible) return false;
  if (input.defaultPrevented) return false;
  if (input.isEditableTarget) return false;
  // 焦点在锚点标记上时，删除键属于那个锚点，绝不能落到「删掉整个镜头」上。
  // 这条监听挂在捕获阶段，早于锚点自己的 onKeyDown，所以必须在这里让路。
  if (input.isAnchorTarget) return false;
  // 方向键在片段上是「移动片段」，不能先被 window 捕获监听拿去移动播放头。
  if (input.isVisualClipMoveTarget) return false;
  // 空格在按钮上就是「按下这个按钮」，别抢。
  if (input.isButtonTarget && (input.key === " " || input.key === "Enter")) {
    return false;
  }
  return true;
}

/**
 * 剪辑台只跟随普通镜头/素材选中；时间轴片段本身已经是聊聊要操作的对象，
 * 不能再把它降级成入点所在镜头的选中卡。
 */
export function storyboardEditShouldFollowSelectionToShot(
  sourceType: SelectionSourceType | null | undefined
): boolean {
  return sourceType !== "timeline-range";
}

/** 键盘敲下去要干的事。 */
export type StoryboardEditShortcut =
  | { kind: "togglePlay" }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "seekBy"; deltaMs: number }
  | { kind: "seekTo"; position: "start" | "end" }
  | { kind: "seekEdge"; direction: "prev" | "next" }
  | { kind: "markIn" }
  | { kind: "markOut" }
  | { kind: "addAnchor" }
  | { kind: "clearSelection" }
  | { kind: "action"; action: StoryboardEditAction };

/**
 * 快捷键照搬主流剪辑软件：空格走带、JKL、左右一帧、上下跳切点、
 * I/O 打入出点、S 切割、⌫ 删除。按键路由层负责避让聊天框等文字输入。
 */
export function storyboardEditShortcut(event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): StoryboardEditShortcut | null {
  const modified = event.metaKey || event.ctrlKey;
  // ⌘Z 之类的留给全局撤销，这里一律不拦。
  if (modified && event.key.toLowerCase() !== "k") return null;
  if (modified && event.key.toLowerCase() === "k") {
    return { kind: "action", action: "split" };
  }

  if (event.altKey) {
    if (event.key === "ArrowLeft")
      return { kind: "action", action: "moveLeft" };
    if (event.key === "ArrowRight")
      return { kind: "action", action: "moveRight" };
    return null;
  }

  switch (event.key) {
    case " ":
      return { kind: "togglePlay" };
    case "ArrowLeft":
      return {
        kind: "seekBy",
        deltaMs: event.shiftKey ? -1000 : -STORYBOARD_EDIT_FRAME_MS,
      };
    case "ArrowRight":
      return {
        kind: "seekBy",
        deltaMs: event.shiftKey ? 1000 : STORYBOARD_EDIT_FRAME_MS,
      };
    case "ArrowUp":
      return { kind: "seekEdge", direction: "prev" };
    case "ArrowDown":
      return { kind: "seekEdge", direction: "next" };
    case "Home":
      return { kind: "seekTo", position: "start" };
    case "End":
      return { kind: "seekTo", position: "end" };
    case "Escape":
      return { kind: "clearSelection" };
    case "Backspace":
    case "Delete":
      return { kind: "action", action: "delete" };
    case "Enter":
      return { kind: "action", action: "insertAfter" };
    default:
      break;
  }

  switch (event.key.toLowerCase()) {
    case "j":
      return { kind: "seekBy", deltaMs: -1000 };
    case "k":
      return { kind: "pause" };
    case "l":
      return { kind: "play" };
    case "i":
      return { kind: "markIn" };
    case "o":
      return { kind: "markOut" };
    case "m":
      return { kind: "addAnchor" };
    case "x":
      return { kind: "action", action: "selectShot" };
    case "s":
      return { kind: "action", action: "split" };
    case "f":
      return { kind: "action", action: "extract" };
    default:
      return null;
  }
}

/** 入点／出点凑成一个选区；只打了一半就还不成区间。 */
export function storyboardEditMarkedRange(
  inMs: number | null,
  outMs: number | null
): StoryboardEditRange | null {
  if (inMs == null || outMs == null) return null;
  return storyboardEditSelectionRange(inMs, outMs);
}

/** 从图片 prompt 里恢复它被抽取时的绝对时间，供独立抽帧轨持久显示。 */
export { extractedFrameTimeMs as storyboardExtractedFrameTimeMs } from "../../../../shared/extractedFrameTransition";

/**
 * 视觉层是覆盖关系，不是把镜头从主故事线上搬走。
 *
 * 主层始终保留完整镜头顺序；额外层只返回被指派到该层的覆盖副本。
 * 这样把一个镜头放到上层时，下面的镜头不会消失或重新编号。
 */
export function storyboardVisualLayerShotIds(input: {
  stableShotIds: readonly string[];
  assignments: Readonly<Record<string, string>>;
  layerId: string;
  mainLayerId: string;
}): string[] {
  if (input.layerId === input.mainLayerId) return [...input.stableShotIds];
  return input.stableShotIds.filter(
    stableShotId => input.assignments[stableShotId] === input.layerId
  );
}
