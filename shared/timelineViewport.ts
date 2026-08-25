/**
 * 时间线视口：时间↔像素的唯一映射。
 *
 * 这是本项目"加一个最基本的剪辑功能却非常艰难"的根因所在。此前两个编辑
 * 界面用的是两套坐标系：
 *
 * - 底部时间线：`left: 160px`，每秒固定像素数，内容比视口宽时横向滚动。
 * - 上方 Storyboard：`left: 38.921%`，整份故事永远被压成容器宽度。
 *
 * 百分比坐标里不存在"每秒多少像素"这个量，于是三件最基本的事都无法定义：
 *
 * 1. 时间标尺——刻度间距会随窗口宽度变化，"00:46:00" 钉不住；
 * 2. 左栏悬浮——内容永远正好等于视口宽，不横向滚，没有可悬浮的对象；
 * 3. 缩放——缩放就是改每秒像素数，而 100% 永远是 100%。
 *
 * 所以这些功能不是难做，是在那个坐标系里没有定义。本模块把"每秒多少像素"
 * 变成一个显式的量，两个界面共用同一份，剪辑器该有的东西才谈得上。
 */

/** 结构时间统一 30fps 整数帧，毫秒只是显示投影。 */
export const TIMELINE_FPS = 30;

/** 缩放边界沿用底部时间线既有的取值，避免手感突变。 */
export const MIN_TIMELINE_SCALE = 8;
export const MAX_TIMELINE_SCALE = 42;
export const DEFAULT_TIMELINE_SCALE = 16;

/** 再短的故事也留出这么宽，否则空时间线会塌成一条线。 */
const MIN_TIMELINE_WIDTH_PX = 720;

export type TimelineViewport = {
  /** 每秒多少像素。这就是"缩放"的那个量。 */
  scale: number;
  /** 内容总宽度（像素）。比容器宽时横向滚动，左栏才有东西可悬浮。 */
  contentWidth: number;
  /** 整条片长（毫秒）。 */
  totalMs: number;
};

export function clampTimelineScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_TIMELINE_SCALE;
  return Math.min(MAX_TIMELINE_SCALE, Math.max(MIN_TIMELINE_SCALE, scale));
}

export function createTimelineViewport(input: {
  totalMs: number;
  scale: number;
}): TimelineViewport {
  const scale = clampTimelineScale(input.scale);
  const totalMs = Math.max(0, input.totalMs);
  return {
    scale,
    totalMs,
    contentWidth: Math.max(
      MIN_TIMELINE_WIDTH_PX,
      Math.ceil((totalMs / 1000) * scale)
    ),
  };
}

export function msToPx(viewport: TimelineViewport, ms: number): number {
  return (Math.max(0, ms) / 1000) * viewport.scale;
}

export function pxToMs(viewport: TimelineViewport, px: number): number {
  if (viewport.scale <= 0) return 0;
  return Math.max(0, (px / viewport.scale) * 1000);
}

/** 位移量保留正负号；与 pxToMs 的绝对位置语义分开。 */
export function pxDeltaToMs(
  viewport: TimelineViewport,
  deltaPx: number
): number {
  if (viewport.scale <= 0) return 0;
  return (deltaPx / viewport.scale) * 1000;
}

export function frameToPx(viewport: TimelineViewport, frame: number): number {
  return msToPx(viewport, (Math.max(0, frame) / TIMELINE_FPS) * 1000);
}

/** 帧位移量→有符号像素增量。 */
export function frameDeltaToPx(
  viewport: TimelineViewport,
  deltaFrame: number
): number {
  return (deltaFrame / TIMELINE_FPS) * viewport.scale;
}

export function pxToFrame(viewport: TimelineViewport, px: number): number {
  return Math.round((pxToMs(viewport, px) / 1000) * TIMELINE_FPS);
}

/** 拖动像素增量→有符号帧增量。 */
export function pxDeltaToFrame(
  viewport: TimelineViewport,
  deltaPx: number
): number {
  return Math.round((pxDeltaToMs(viewport, deltaPx) / 1000) * TIMELINE_FPS);
}

/** 一帧有多宽——用来判断"这个 clip 窄到点不中了吗"。 */
export function framePx(viewport: TimelineViewport): number {
  return viewport.scale / TIMELINE_FPS;
}

/**
 * 刻度间隔：放大时标得密，缩小时标得疏，避免刻度文字叠在一起。
 * 阈值取自底部时间线原有行为（scale ≥ 24 用 5 秒），再向两端补两档。
 */
export function tickStepSec(viewport: TimelineViewport): number {
  if (viewport.scale >= 36) return 2;
  if (viewport.scale >= 24) return 5;
  if (viewport.scale >= 12) return 10;
  return 30;
}

export function tickSeconds(viewport: TimelineViewport): number[] {
  const step = tickStepSec(viewport);
  const last = Math.ceil(viewport.totalMs / 1000 / step);
  return Array.from({ length: last + 1 }, (_, index) => index * step);
}

/** `hh:mm:ss` —— 标尺上要能一眼读出"我在第几分钟"。 */
export function formatTimelineTimecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}
