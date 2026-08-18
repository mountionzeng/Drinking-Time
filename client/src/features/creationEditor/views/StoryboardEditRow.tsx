import {
  GripVertical,
  Loader2,
  Pause,
  Play,
  SkipBack,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { StoryTimelineItem } from "@shared/storyMaterial";
import {
  formatStoryboardTimestamp,
  type StoryboardTimingRow,
} from "@/features/storyAgent/storyboardTiming";

import {
  STORYBOARD_EDIT_FRAME_MS,
  storyboardEditBlocks,
  storyboardEditEdgeMs,
  storyboardEditMenuItems,
  storyboardEditNeighborShotId,
  storyboardEditNudgedDurationMs,
  storyboardEditPlayheadPct,
  storyboardEditRangePct,
  storyboardEditSeekMs,
  storyboardEditSegments,
  storyboardEditSelectionRange,
  storyboardEditNeedsRowFocus,
  storyboardEditShortcut,
  storyboardEditShouldHandleKey,
  storyboardEditTimingAt,
  storyboardEditTrackMs,
  storyboardTrimmedDurationMs,
  type StoryboardEditAction,
  type StoryboardEditRange,
} from "../storyboardEditRow";
import {
  StoryboardAudioTrack,
  type StoryboardAudioClip,
} from "./StoryboardAudioWaveform";

/**
 * 故事版看板里的「剪辑」行：不跟镜头列对齐，自己按时间等比铺成一整条，
 * 靠镜头编号和选中状态跟上面的镜头列关联。
 * 左键拖选一段交给聊聊、拖右边缘改时长、拖左边把手换顺序；
 * 右键出剪辑菜单，键盘走主流剪辑软件那一套快捷键。
 */
export type StoryboardBoardTimeline = {
  playheadMs: number;
  isPlaying: boolean;
  totalMs: number;
  audioClips: StoryboardAudioClip[];
  /** 全片绝对毫秒 */
  onSeek: (ms: number) => void;
  onTogglePlay: (playing: boolean) => void;
  onSelectRange: (
    range:
      | (StoryboardEditRange & { stableShotId: string; shotNo: number })
      | null
  ) => void;
  selectedRange: StoryboardEditRange | null;
  /** 这个时间点上有没有可切/可提帧的视频；没有的话菜单里直接灰掉并写明原因。 */
  canSplitAt: (ms: number) => boolean;
  onTrimShotDuration: (input: {
    shotNo: number;
    stableShotId: string;
    durationMs: number;
  }) => Promise<void> | void;
  onSplitAt: (ms: number) => Promise<void>;
  onExtractFrameAt: (ms: number) => Promise<void>;
  onReorderShot: (input: {
    sourceStableShotId: string;
    targetStableShotId: string;
  }) => Promise<void> | void;
};

/** 镜头本身的增删由故事版看板提供，不走时间线那套接口。 */
export type StoryboardEditShotActions = {
  onInsertShotAfter?: (input: {
    shotNo: number;
    stableShotId: string;
  }) => Promise<void> | void;
  onDeleteShot?: (input: {
    shotNo: number;
    stableShotId: string;
  }) => Promise<void> | void;
};

export type StoryboardEditShot = {
  timing: StoryboardTimingRow;
  shotLabel: string;
  shotNo: number;
  stableShotId: string;
  timelineItem: StoryTimelineItem | null;
  posterUrl: string | null;
};

const SHOT_DRAG_MIME = "application/x-storyboard-shot";

export function StoryboardEditTransport({
  timeline,
}: {
  timeline: StoryboardBoardTimeline;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label="故事版走带控制"
      data-testid="storyboard-edit-transport"
    >
      <button
        type="button"
        onClick={() => timeline.onSeek(0)}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="回到开头"
        title="回到开头"
      >
        <SkipBack className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => timeline.onTogglePlay(!timeline.isPlaying)}
        className="flex h-6 w-6 items-center justify-center rounded-sm border border-rose-500/45 bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20"
        aria-label={timeline.isPlaying ? "暂停" : "播放"}
        title={timeline.isPlaying ? "暂停" : "播放"}
      >
        {timeline.isPlaying ? (
          <Pause className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3 fill-current" />
        )}
      </button>
      <span className="font-mono text-[9px] tabular-nums text-rose-600">
        {formatStoryboardTimestamp(timeline.playheadMs)}
      </span>
    </span>
  );
}

/** 行首保持纯标签；切割和提帧仍保留在右键菜单与 S / F 快捷键里。 */
function StoryboardEditRowHeader() {
  return (
    <div
      role="rowheader"
      className="sticky left-0 z-20 flex items-center border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
    >
      <span>剪辑</span>
    </div>
  );
}

function StoryboardAudioRowHeader() {
  return (
    <div
      role="rowheader"
      className="sticky left-0 z-20 flex flex-col justify-center border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
    >
      <span>音轨</span>
      <span className="mt-0.5 text-[7px] font-normal text-muted-foreground/70">
        强弱 · 停顿
      </span>
    </div>
  );
}

type MenuState = {
  shot: StoryboardEditShot;
  atMs: number;
  clientX: number;
  clientY: number;
};

/** 右键菜单。用 fixed 定位，免得被横向滚动的故事版矩阵裁掉。 */
function StoryboardEditContextMenu({
  menu,
  shotCount,
  canSplitHere,
  canInsert,
  canDelete,
  pendingAction,
  onPick,
  onClose,
}: {
  menu: MenuState;
  shotCount: number;
  canSplitHere: boolean;
  canInsert: boolean;
  canDelete: boolean;
  pendingAction: StoryboardEditAction | null;
  onPick: (action: StoryboardEditAction) => void;
  onClose: () => void;
}) {
  const items = storyboardEditMenuItems({
    shotLabel: menu.shot.shotLabel,
    canSplitHere,
    isFirst: menu.shot.timing.position === 0,
    isLast: menu.shot.timing.position === shotCount - 1,
    shotCount,
    canInsert,
    canDelete,
  });

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return (
    <div
      role="menu"
      aria-label={`${menu.shot.shotLabel} 剪辑菜单`}
      data-testid="storyboard-edit-menu"
      className="fixed z-[100] min-w-[190px] rounded-md border border-border bg-[var(--background)] py-1 shadow-lg"
      style={{
        left: Math.min(menu.clientX, window.innerWidth - 210),
        top: Math.min(menu.clientY, window.innerHeight - 320),
      }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      <div className="border-b border-border/60 px-3 pb-1 text-[9px] text-muted-foreground">
        {menu.shot.shotLabel} · {formatStoryboardTimestamp(menu.atMs)}
      </div>
      {items.map(item => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          disabled={item.disabledReason != null || pendingAction != null}
          title={item.disabledReason ?? undefined}
          onClick={() => onPick(item.action)}
          data-testid={`storyboard-edit-menu-${item.action}`}
          className={`flex w-full items-center justify-between gap-6 px-3 py-1 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
            item.groupStart ? "mt-1 border-t border-border/60 pt-1.5" : ""
          } ${
            item.danger
              ? "text-rose-600 enabled:hover:bg-rose-500/10"
              : "text-foreground enabled:hover:bg-muted"
          }`}
        >
          <span className="flex items-center gap-1.5">
            {pendingAction === item.action ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : null}
            {item.label}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {item.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
}

function StoryboardEditTrack({
  timeline,
  shots,
  selectedShotNo,
  onSelectShot,
  onOpenMenu,
  trackRef,
  markInMs,
  pendingLabel,
}: {
  timeline: StoryboardBoardTimeline;
  shots: readonly StoryboardEditShot[];
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number) => void;
  onOpenMenu: (menu: MenuState) => void;
  trackRef: React.MutableRefObject<HTMLDivElement | null>;
  markInMs: number | null;
  pendingLabel: string | null;
}) {
  const dragAnchorMsRef = useRef<number | null>(null);
  const trimStartRef = useRef<{
    clientX: number;
    trackWidthPx: number;
    baseDurationMs: number;
    maxDurationMs?: number;
    edge: "start" | "end";
    shotNo: number;
    stableShotId: string;
  } | null>(null);
  const [draftRange, setDraftRange] = useState<StoryboardEditRange | null>(
    null
  );
  const [draftTrim, setDraftTrim] = useState<{
    stableShotId: string;
    durationMs: number;
    edge: "start" | "end";
  } | null>(null);
  const [dropTargetShotId, setDropTargetShotId] = useState<string | null>(null);

  const timings = shots.map(shot => shot.timing);
  const totalMs = timeline.totalMs;

  const trackMsFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return storyboardEditTrackMs({
        clientX,
        rectLeft: rect.left,
        rectWidth: rect.width,
        totalMs,
      });
    },
    [totalMs, trackRef]
  );

  const blocks = storyboardEditBlocks(timings, totalMs);
  const activeRange = draftRange ?? timeline.selectedRange;
  const highlight = activeRange
    ? storyboardEditRangePct(activeRange, totalMs)
    : null;
  const playheadPct = storyboardEditPlayheadPct(timeline.playheadMs, totalMs);
  const markInPct =
    markInMs == null ? null : storyboardEditPlayheadPct(markInMs, totalMs);

  const startRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    const anchorMs = trackMsFromPointer(event.clientX);
    dragAnchorMsRef.current = anchorMs;
    setDraftRange(null);
    const timing = storyboardEditTimingAt(timings, anchorMs);
    if (timing) onSelectShot(timing.shotNo);
  };

  const moveRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const anchorMs = dragAnchorMsRef.current;
    if (anchorMs == null) return;
    setDraftRange(
      storyboardEditSelectionRange(anchorMs, trackMsFromPointer(event.clientX))
    );
  };

  const endRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const anchorMs = dragAnchorMsRef.current;
    dragAnchorMsRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (anchorMs == null) return;
    const range = storyboardEditSelectionRange(
      anchorMs,
      trackMsFromPointer(event.clientX)
    );
    setDraftRange(null);
    if (!range) {
      timeline.onSelectRange(null);
      timeline.onSeek(anchorMs);
      return;
    }
    const timing = storyboardEditTimingAt(timings, range.startMs);
    if (!timing) return;
    timeline.onSelectRange({
      ...range,
      stableShotId: timing.stableShotId,
      shotNo: timing.shotNo,
    });
    timeline.onSeek(range.startMs);
  };

  const startTrim = (
    event: ReactPointerEvent<HTMLButtonElement>,
    shot: StoryboardEditShot,
    edge: "start" | "end"
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const trackWidthPx = trackRef.current?.getBoundingClientRect().width ?? 0;
    if (trackWidthPx <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    trimStartRef.current = {
      clientX: event.clientX,
      trackWidthPx,
      baseDurationMs: shot.timing.durationMs,
      maxDurationMs: edge === "start" ? shot.timing.endMs : undefined,
      edge,
      shotNo: shot.shotNo,
      stableShotId: shot.stableShotId,
    };
    setDraftTrim({
      stableShotId: shot.stableShotId,
      durationMs: shot.timing.durationMs,
      edge,
    });
  };

  const moveTrim = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = trimStartRef.current;
    if (!start) return;
    setDraftTrim({
      stableShotId: start.stableShotId,
      durationMs: storyboardTrimmedDurationMs({
        baseDurationMs: start.baseDurationMs,
        trackWidthPx: start.trackWidthPx,
        totalMs,
        deltaPx: event.clientX - start.clientX,
        edge: start.edge,
        maxDurationMs: start.maxDurationMs,
      }),
      edge: start.edge,
    });
  };

  const endTrim = async (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = trimStartRef.current;
    trimStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const trim = draftTrim;
    if (!start || !trim || trim.durationMs === start.baseDurationMs) {
      setDraftTrim(null);
      return;
    }
    try {
      await timeline.onTrimShotDuration({
        shotNo: start.shotNo,
        stableShotId: start.stableShotId,
        durationMs: trim.durationMs,
      });
    } finally {
      setDraftTrim(null);
    }
  };

  return (
    <div
      className="relative min-w-0 border-b border-r px-2 py-2"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
      data-testid="storyboard-edit-track-cell"
    >
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="剪辑时间条，拖动选中一段交给聊聊，右键出剪辑菜单"
        aria-keyshortcuts="Space ArrowLeft ArrowRight ArrowUp ArrowDown S F X I O Delete"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs)}
        aria-valuenow={Math.round(timeline.playheadMs)}
        aria-valuetext={formatStoryboardTimestamp(timeline.playheadMs)}
        data-testid="storyboard-edit-track"
        className="relative h-9 w-full cursor-text touch-none rounded-sm border border-border/70 bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        onPointerDown={startRangeDrag}
        onPointerMove={moveRangeDrag}
        onPointerUp={endRangeDrag}
        onPointerCancel={endRangeDrag}
      >
        {blocks.map(({ timing, leftPct, widthPct }) => {
          const shot = shots.find(
            item => item.stableShotId === timing.stableShotId
          );
          if (!shot) return null;
          const selected = shot.shotNo === selectedShotNo;
          const trimming =
            draftTrim?.stableShotId === shot.stableShotId ? draftTrim : null;
          const durationMs = trimming?.durationMs ?? timing.durationMs;
          const drawnWidthPct =
            totalMs > 0 ? (durationMs / totalMs) * 100 : widthPct;
          const drawnLeftPct =
            trimming?.edge === "start"
              ? leftPct + widthPct - drawnWidthPct
              : leftPct;
          const segments = storyboardEditSegments({
            durationMs,
            label: shot.shotLabel,
            visualClips: shot.timelineItem?.visualClips,
            visualClipsReplacePrimary:
              shot.timelineItem?.visualClipsReplacePrimary,
          });
          return (
            <div
              key={timing.stableShotId}
              className={`absolute bottom-0.5 top-0.5 overflow-hidden rounded-[2px] border ${
                selected
                  ? "z-20 border-primary ring-1 ring-primary"
                  : "z-10 border-white/40"
              } ${
                dropTargetShotId === shot.stableShotId
                  ? "outline-dashed outline-2 outline-primary"
                  : ""
              }`}
              style={{ left: `${drawnLeftPct}%`, width: `${drawnWidthPct}%` }}
              title={`${shot.shotLabel} · ${formatStoryboardTimestamp(timing.startMs)} · ${(durationMs / 1000).toFixed(1)}s · 右键出剪辑菜单`}
              data-testid={`storyboard-edit-block-${shot.stableShotId}`}
              data-storyboard-edit-shot-no={shot.shotNo}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                trackRef.current?.focus();
                timeline.onTogglePlay(false);
                onSelectShot(shot.shotNo);
                onOpenMenu({
                  shot,
                  atMs: trackMsFromPointer(event.clientX),
                  clientX: event.clientX,
                  clientY: event.clientY,
                });
              }}
              onDragOver={event => {
                if (!event.dataTransfer.types.includes(SHOT_DRAG_MIME)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetShotId(shot.stableShotId);
              }}
              onDragLeave={() => setDropTargetShotId(null)}
              onDrop={event => {
                setDropTargetShotId(null);
                const sourceStableShotId =
                  event.dataTransfer.getData(SHOT_DRAG_MIME);
                if (
                  !sourceStableShotId ||
                  sourceStableShotId === shot.stableShotId
                ) {
                  return;
                }
                event.preventDefault();
                void timeline.onReorderShot({
                  sourceStableShotId,
                  targetStableShotId: shot.stableShotId,
                });
              }}
            >
              {segments.map(segment => (
                <span
                  key={segment.id}
                  className={`absolute bottom-0 top-0 overflow-hidden ${
                    segment.kind === "primary"
                      ? "bg-emerald-500/25"
                      : "border-l border-white/40 bg-sky-500/45"
                  }`}
                  style={{
                    left: `${segment.leftPct}%`,
                    width: `${segment.widthPct}%`,
                  }}
                >
                  {segment.kind === "primary" && shot.posterUrl ? (
                    <img
                      src={shot.posterUrl}
                      alt=""
                      className="h-full w-full object-cover opacity-30"
                    />
                  ) : null}
                </span>
              ))}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-1 text-center font-mono text-[8px] leading-3 text-foreground/80">
                {shot.shotLabel}
              </span>
              {selected ? (
                <>
                  <button
                    type="button"
                    onPointerDown={event => startTrim(event, shot, "start")}
                    onPointerMove={moveTrim}
                    onPointerUp={event => void endTrim(event)}
                    onPointerCancel={event => void endTrim(event)}
                    className="absolute bottom-0 left-0 top-0 z-20 w-2 cursor-ew-resize touch-none bg-primary/70"
                    aria-label={`拖动左边缘修剪 ${shot.shotLabel} 的时长`}
                    title={`拖动左边缘修剪时长 · 当前 ${(durationMs / 1000).toFixed(1)}s`}
                    data-testid={`storyboard-edit-trim-start-${shot.stableShotId}`}
                  />
                  <button
                    type="button"
                    draggable
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        SHOT_DRAG_MIME,
                        shot.stableShotId
                      );
                      event.dataTransfer.setData("text/plain", shot.shotLabel);
                    }}
                    onDragEnd={() => setDropTargetShotId(null)}
                    onPointerDown={event => event.stopPropagation()}
                    className="absolute bottom-0 left-2 top-0 z-10 flex w-2.5 cursor-grab items-center justify-center bg-primary/55 text-[var(--background)] active:cursor-grabbing"
                    aria-label={`拖动 ${shot.shotLabel} 调整镜头顺序`}
                    title="拖到别的镜头上改顺序 · ⌥← / ⌥→"
                    data-testid={`storyboard-edit-reorder-${shot.stableShotId}`}
                  >
                    <GripVertical className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onPointerDown={event => startTrim(event, shot, "end")}
                    onPointerMove={moveTrim}
                    onPointerUp={event => void endTrim(event)}
                    onPointerCancel={event => void endTrim(event)}
                    className="absolute bottom-0 right-0 top-0 z-10 w-2 cursor-ew-resize touch-none bg-primary/70"
                    aria-label={`拖动修剪 ${shot.shotLabel} 的时长`}
                    title={`拖动修剪时长 · 当前 ${(durationMs / 1000).toFixed(1)}s · , / .`}
                    data-testid={`storyboard-edit-trim-${shot.stableShotId}`}
                  />
                </>
              ) : null}
            </div>
          );
        })}
        {highlight ? (
          <span
            className="pointer-events-none absolute bottom-0 top-0 z-30 border-x-2 border-primary bg-primary/25"
            style={{
              left: `${highlight.leftPct}%`,
              width: `${highlight.widthPct}%`,
            }}
            data-testid="storyboard-edit-selection"
          />
        ) : null}
        {markInPct != null ? (
          <span
            className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 bg-amber-500"
            style={{ left: `${markInPct}%` }}
            title="入点，按 O 打出点"
            data-testid="storyboard-edit-mark-in"
          />
        ) : null}
        {playheadPct != null ? (
          <div
            role="slider"
            tabIndex={0}
            aria-label="拖动剪辑播放头"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalMs)}
            aria-valuenow={Math.round(timeline.playheadMs)}
            aria-valuetext={formatStoryboardTimestamp(timeline.playheadMs)}
            title="拖动播放头，预览对应时间的视频或图片"
            className="group absolute bottom-0 top-0 z-40 w-5 -translate-x-1/2 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
            style={{ left: `${playheadPct}%` }}
            data-testid="storyboard-edit-playhead"
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              timeline.onTogglePlay(false);
              event.currentTarget.setPointerCapture(event.pointerId);
              timeline.onSeek(trackMsFromPointer(event.clientX));
            }}
            onPointerMove={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                timeline.onSeek(trackMsFromPointer(event.clientX));
              }
            }}
            onPointerUp={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-b-sm bg-rose-500 shadow-sm ring-1 ring-white/80 transition group-hover:scale-110" />
            <span className="absolute bottom-0 left-1/2 top-2 w-px -translate-x-1/2 bg-rose-500 shadow-[0_0_0_1px_rgb(244_63_94_/_0.18)]" />
          </div>
        ) : null}
      </div>
      <span
        className="sr-only"
        aria-live="polite"
        data-testid="storyboard-edit-status"
      >
        {pendingLabel ??
          (draftTrim
            ? `${(draftTrim.durationMs / 1000).toFixed(1)}s`
            : markInMs != null
              ? `入点 ${formatStoryboardTimestamp(markInMs)} · 按 O 打出点`
              : `${shots.length} 镜`)}
      </span>
    </div>
  );
}

const ACTION_LABELS: Record<StoryboardEditAction, string> = {
  split: "切割中…",
  extract: "提帧中…",
  selectShot: "选中中…",
  trimMinusFrame: "改时长…",
  trimPlusFrame: "改时长…",
  trimMinusHalfSec: "改时长…",
  trimPlusHalfSec: "改时长…",
  moveLeft: "换顺序…",
  moveRight: "换顺序…",
  insertAfter: "加镜头…",
  delete: "删除中…",
};

/**
 * 完整故事版矩阵里的一整行：行首是标题和两个按钮，右边一格横跨所有镜头列，
 * 装着按时间等比铺开的剪辑时间条。右键菜单和快捷键都收在这一层。
 */
export function StoryboardEditRow({
  timeline,
  shots,
  selectedShotNo,
  onSelectShot,
  columnSpan,
  shotActions,
}: {
  timeline: StoryboardBoardTimeline;
  shots: readonly StoryboardEditShot[];
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number) => void;
  columnSpan: number;
  shotActions?: StoryboardEditShotActions;
}) {
  const [pendingAction, setPendingAction] =
    useState<StoryboardEditAction | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [markInMs, setMarkInMs] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const timings = shots.map(shot => shot.timing);
  const closeMenu = useCallback(() => setMenu(null), []);

  // onSeek 要过一轮 state 才落到 timeline.playheadMs 上，所以连着敲
  // 「I → ↓ → O」时后一个键会读到上一个键之前的位置。这里自己记住"我要它去哪"，
  // 时间线报告的位置一变（播放、拖播放头、底部时间线）就跟着它重新对齐。
  const headRef = useRef(timeline.playheadMs);
  const reportedHeadRef = useRef(timeline.playheadMs);
  if (reportedHeadRef.current !== timeline.playheadMs) {
    reportedHeadRef.current = timeline.playheadMs;
    headRef.current = timeline.playheadMs;
  }
  const seekTo = (ms: number) => {
    headRef.current = ms;
    timeline.onSeek(ms);
  };

  /** 键盘用的「当前镜头」：先看选中的，没选就看播放头压在哪一镜上。 */
  const activeShot =
    shots.find(shot => shot.shotNo === selectedShotNo) ??
    shots.find(
      shot =>
        shot.stableShotId ===
        storyboardEditTimingAt(timings, headRef.current)?.stableShotId
    ) ??
    null;

  const runAction = (
    action: StoryboardEditAction,
    shot: StoryboardEditShot | null,
    atMs: number
  ) => {
    if (pendingAction || !shot) return;
    const trim = (deltaMs: number) =>
      timeline.onTrimShotDuration({
        shotNo: shot.shotNo,
        stableShotId: shot.stableShotId,
        durationMs: storyboardEditNudgedDurationMs(
          shot.timing.durationMs,
          deltaMs
        ),
      });
    const move = (direction: "prev" | "next") => {
      const targetStableShotId = storyboardEditNeighborShotId(
        timings,
        shot.stableShotId,
        direction
      );
      if (!targetStableShotId) return;
      return timeline.onReorderShot({
        sourceStableShotId: shot.stableShotId,
        targetStableShotId,
      });
    };

    let done: Promise<unknown> | unknown;
    switch (action) {
      case "split":
        done = timeline.onSplitAt(atMs);
        break;
      case "extract":
        done = timeline.onExtractFrameAt(atMs);
        break;
      case "selectShot":
        timeline.onSelectRange({
          startMs: shot.timing.startMs,
          endMs: shot.timing.endMs,
          stableShotId: shot.stableShotId,
          shotNo: shot.shotNo,
        });
        seekTo(shot.timing.startMs);
        break;
      case "trimMinusFrame":
        done = trim(-STORYBOARD_EDIT_FRAME_MS);
        break;
      case "trimPlusFrame":
        done = trim(STORYBOARD_EDIT_FRAME_MS);
        break;
      case "trimMinusHalfSec":
        done = trim(-500);
        break;
      case "trimPlusHalfSec":
        done = trim(500);
        break;
      case "moveLeft":
        done = move("prev");
        break;
      case "moveRight":
        done = move("next");
        break;
      case "insertAfter":
        done = shotActions?.onInsertShotAfter?.({
          shotNo: shot.shotNo,
          stableShotId: shot.stableShotId,
        });
        break;
      case "delete":
        done = shotActions?.onDeleteShot?.({
          shotNo: shot.shotNo,
          stableShotId: shot.stableShotId,
        });
        break;
    }

    closeMenu();
    if (done == null) return;
    timeline.onTogglePlay(false);
    setPendingAction(action);
    void Promise.resolve(done).finally(() => setPendingAction(null));
  };

  const markRange = (outMs: number) => {
    if (markInMs == null) return;
    const range = storyboardEditSelectionRange(markInMs, outMs);
    setMarkInMs(null);
    if (!range) return;
    const timing = storyboardEditTimingAt(timings, range.startMs);
    if (!timing) return;
    timeline.onSelectRange({
      ...range,
      stableShotId: timing.stableShotId,
      shotNo: timing.shotNo,
    });
    // 打出点后留在出点；跳回入点会触发底部时间线自动选镜，覆盖刚建立的片段卡。
  };

  const handleShortcut = (event: KeyboardEvent) => {
    const shortcut = storyboardEditShortcut(event);
    if (!shortcut) return;
    if (
      shortcut.kind === "action" &&
      storyboardEditNeedsRowFocus(shortcut.action) &&
      !rowRef.current?.contains(document.activeElement)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    switch (shortcut.kind) {
      case "togglePlay":
        timeline.onTogglePlay(!timeline.isPlaying);
        return;
      case "play":
        timeline.onTogglePlay(true);
        return;
      case "pause":
        timeline.onTogglePlay(false);
        return;
      case "seekBy":
        timeline.onTogglePlay(false);
        seekTo(
          storyboardEditSeekMs(
            headRef.current,
            shortcut.deltaMs,
            timeline.totalMs
          )
        );
        return;
      case "seekTo":
        timeline.onTogglePlay(false);
        seekTo(shortcut.position === "start" ? 0 : timeline.totalMs);
        return;
      case "seekEdge": {
        const edgeMs = storyboardEditEdgeMs(
          timings,
          headRef.current,
          shortcut.direction
        );
        if (edgeMs == null) return;
        timeline.onTogglePlay(false);
        seekTo(edgeMs);
        const timing = storyboardEditTimingAt(timings, edgeMs);
        if (timing) onSelectShot(timing.shotNo);
        return;
      }
      case "markIn":
        setMarkInMs(headRef.current);
        return;
      case "markOut":
        markRange(headRef.current);
        return;
      case "clearSelection":
        setMarkInMs(null);
        closeMenu();
        timeline.onSelectRange(null);
        return;
      case "action":
        runAction(shortcut.action, activeShot, headRef.current);
        return;
    }
  };

  // 快捷键挂在 window 上（捕获阶段，先于剪辑台自己那套方向键/空格），
  // 否则点过看板上任意一个按钮，焦点就离开时间条，快捷键跟着全部失灵。
  const shortcutRef = useRef(handleShortcut);
  shortcutRef.current = handleShortcut;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const allowed = storyboardEditShouldHandleKey({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        isEditableTarget: Boolean(
          target?.closest(
            'input, textarea, select, [contenteditable="true"], [role="textbox"]'
          )
        ),
        isButtonTarget: Boolean(target?.closest("button, a, [role='button']")),
        rowVisible: rowRef.current?.offsetParent != null,
      });
      if (!allowed) return;
      shortcutRef.current(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <>
      <StoryboardEditRowHeader />
      <div
        role="cell"
        ref={rowRef}
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <StoryboardEditTrack
          timeline={timeline}
          shots={shots}
          selectedShotNo={selectedShotNo}
          onSelectShot={onSelectShot}
          onOpenMenu={setMenu}
          trackRef={trackRef}
          markInMs={markInMs}
          pendingLabel={pendingAction ? ACTION_LABELS[pendingAction] : null}
        />
      </div>
      <StoryboardAudioRowHeader />
      <div
        role="cell"
        className="px-2"
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <StoryboardAudioTrack
          clips={timeline.audioClips}
          totalMs={timeline.totalMs}
          playheadMs={timeline.playheadMs}
        />
      </div>
      {menu ? (
        <StoryboardEditContextMenu
          menu={menu}
          shotCount={shots.length}
          canSplitHere={timeline.canSplitAt(menu.atMs)}
          canInsert={Boolean(shotActions?.onInsertShotAfter)}
          canDelete={Boolean(shotActions?.onDeleteShot)}
          pendingAction={pendingAction}
          onPick={action => runAction(action, menu.shot, menu.atMs)}
          onClose={closeMenu}
        />
      ) : null}
    </>
  );
}
