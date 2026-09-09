import { useMemo, useState } from "react";
import {
  formatTimelineTimecode,
  msToPx,
  tickSeconds,
  type TimelineViewport,
} from "@shared/timelineViewport";

/**
 * 分镜表的时间标尺与缩放控件。
 *
 * 单独成文件不是为了让 StoryboardReviewBoard 的行数好看，而是因为这两样
 * 东西只依赖一个时间视口——它们和分镜表其余部分（镜头、素材、生成流程）
 * 没有任何共享状态，堆在一起只会让那个文件更难改。
 */

/**
 * 分镜表的时间视口。
 *
 * 横轴一直是时间正比的（列宽 = 本镜时长 / 总时长 × 总宽），但总宽此前由
 * 「镜头数 × 固定列宽」定，跟时间无关——于是「每秒多少像素」这个量不存在，
 * 缩放和标尺都无从谈起。把总宽交给时间视口之后，横轴才真正是时间轴。
 */
export function storyboardZoomViewport(totalMs: number, availableWidth: number, zoom: number): TimelineViewport {
  const duration = Math.max(1000 / 30, totalMs);
  const width = Math.max(1, availableWidth);
  const fitScale = width * 1000 / duration;
  // At maximum zoom even one frame has room for a full information column.
  const maxScale = Math.max(fitScale, 248 * 30);
  const scale = fitScale * Math.pow(maxScale / fitScale, Math.max(0, Math.min(100, zoom)) / 100);
  return { totalMs: Math.max(0, totalMs), scale, contentWidth: duration * scale / 1000 };
}

export function useStoryboardTimelineViewport(totalMs: number, availableWidth = 720) {
  const [scale, setScale] = useState(0);
  const viewport = useMemo(
    () => storyboardZoomViewport(totalMs, availableWidth, scale),
    [scale, totalMs, availableWidth]
  );
  return { viewport, scale, setScale };
}

const PANEL_BORDER =
  "color-mix(in srgb, var(--panel-border) 72%, transparent)";

/** 表格上方的工具条：总时长 + 缩放。 */
export function StoryboardTimelineZoomBar({
  viewport,
  scale,
  onScaleChange,
  simplified = false,
  onSimplifiedChange,
}: {
  viewport: TimelineViewport;
  scale: number;
  onScaleChange: (next: number) => void;
  simplified?: boolean;
  onSimplifiedChange?: (next: boolean) => void;
}) {
  const step = (delta: number) =>
    onScaleChange(
      Math.min(100, Math.max(0, scale + delta))
    );
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b px-2 py-1">
      <span className="mr-auto font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTimelineTimecode(viewport.totalMs)}
      </span>
      <button
        type="button"
        onClick={() => step(-4)}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
        aria-label="缩小分镜表"
      >
        −
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={scale}
        onChange={event => onScaleChange(Number(event.currentTarget.value))}
        className="w-24 accent-[var(--primary)]"
        aria-label="分镜表缩放"
        aria-valuetext={scale === 0 ? "整片适应窗口" : scale === 100 ? "一帧完整信息" : `${scale}%`}
      />
      <button
        type="button"
        onClick={() => step(4)}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
        aria-label="放大分镜表"
      >
        +
      </button>
      {onSimplifiedChange && (
        <button type="button" aria-pressed={simplified}
          onClick={() => onSimplifiedChange(!simplified)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground">
          简化显示
        </button>
      )}
    </div>
  );
}

/**
 * 标尺行：左边一格 sticky 标签，右边跨全部镜头列的刻度带。
 * 刻度位置来自时间视口，所以缩放之后仍然钉在正确的秒数上。
 */
export function StoryboardTimelineRulerRow({
  viewport,
  columnSpan,
}: {
  viewport: TimelineViewport;
  columnSpan: number;
}) {
  return (
    <>
      <div
        role="rowheader"
        className="sticky left-0 z-30 flex items-center border-b border-r px-2 text-[9px] font-semibold text-muted-foreground"
        style={{
          borderColor: PANEL_BORDER,
          background: "var(--panel-header)",
        }}
      >
        时间
      </div>
      <div
        role="cell"
        aria-label="时间标尺"
        className="relative h-5 overflow-hidden border-b"
        style={{
          gridColumn: `span ${Math.max(1, columnSpan)}`,
          borderColor: PANEL_BORDER,
        }}
      >
        {tickSeconds(viewport).map(second => {
          const left = msToPx(viewport, second * 1000);
          if (left > viewport.contentWidth) return null;
          return (
            <span
              key={second}
              className="pointer-events-none absolute bottom-0 top-0 border-l border-border/70 pl-1 font-mono text-[9px] tabular-nums text-muted-foreground"
              style={{ left }}
            >
              {formatTimelineTimecode(second * 1000)}
            </span>
          );
        })}
      </div>
    </>
  );
}
