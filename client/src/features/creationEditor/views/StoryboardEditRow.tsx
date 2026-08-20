import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pause,
  Play,
  SkipBack,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { StoryTimelineItem, StoryTimelineOverlay } from "@shared/storyMaterial";
import { selectExtractedFramePair } from "@shared/extractedFrameTransition";
import {
  formatStoryboardTimestamp,
  storyboardTimingTotalMs,
  type StoryboardTimingRow,
} from "@/features/storyAgent/storyboardTiming";

import {
  STORYBOARD_EDIT_FRAME_MS,
  storyboardEditBlocks,
  storyboardEditEdgeMs,
  storyboardEditFilmstripFrameUrls,
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
  storyboardGroupDragDeltaFrames,
  storyboardReleasedDragDeltaFrames,
  storyboardGroupDragStep,
  storyboardGroupDragSummary,
  storyboardTrimmedBoundaryFrame,
  storyboardTrimmedDurationMs,
  storyboardVisualLayerShotIds,
  type StoryboardEditAction,
  type StoryboardEditFrameSource,
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
  /** 听觉轨道自己的时间范围，不随视觉镜头时长重排。 */
  audioTotalMs?: number;
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
  /**
   * 锚点安全的帧级裁剪：给出这次拖动/微调之后另一头锚定不动时对应的绝对帧边界。
   * 有它就走它——旧的 onTrimShotDuration 只改毫秒，改动会被已经写死的
   * durationFrames 盖掉，松手瞬间又弹回原状。
   */
  onTrimTimelineEdge?: (input: {
    stableShotId: string;
    edge: "start" | "end";
    requestedBoundaryFrame: number;
  }) => Promise<{ applied: boolean; reason?: string }>;
  onSplitAt: (ms: number) => Promise<void>;
  onExtractFrameAt: (ms: number) => Promise<void>;
  onReorderShot: (input: {
    sourceStableShotId: string;
    targetStableShotId: string;
  }) => Promise<void> | void;
  /**
   * 位置锚点与方向批量移动。都是可选的：还没接上的调用点保持原有行为，
   * 六点把手仍然只做单镜换顺序。
   */
  anchors?: readonly StoryboardTimelineAnchor[];
  /** 拖之前先问一句：这次会带上哪些镜头、被谁挡住。 */
  previewGroupMove?: (input: {
    stableShotId: string;
    direction: "left" | "right";
  }) => StoryboardGroupPreview;
  onMoveTimelineGroup?: (input: {
    stableShotId: string;
    direction: "left" | "right";
    deltaFrames: number;
  }) => Promise<{ applied: boolean; reason?: string }>;
  /**
   * 拖镜头本体：只移动这一镜，同方向的邻居原地不动。批量移动是六点抓手的
   * 单独手势（onMoveTimelineGroup），两者不共用同一个拖动入口。
   */
  onMoveTimelineShot?: (input: {
    stableShotId: string;
    deltaFrames: number;
  }) => Promise<{ applied: boolean; reason?: string }>;
  onAddAnchor?: (
    timelineFrame: number
  ) => Promise<{ applied: boolean; reason?: string }>;
  /**
   * 空档右键「自动创建镜头」：用前一镜的末帧和后一镜的首帧生成过渡提案。
   * 只生成待确认卡片（注入聊天），真正调用模型和扣费仍要等用户在卡片上点确认。
   */
  onCreateGapTransition?: (input: {
    beforeStableShotId: string;
    afterStableShotId: string;
  }) => Promise<{ applied: boolean; reason?: string }>;
  onCreateExtractedFrameTransition?: (input: {
    leftImageId: number;
    rightImageId: number;
  }) => Promise<{ applied: boolean; reason?: string }>;
  onDeleteExtractedFrame?: (imageId: number) => Promise<{
    applied: boolean;
    reason?: string;
  }>;
  overlays?: readonly StoryTimelineOverlay[];
  onRemoveAnchor?: (input: {
    stableShotId: string;
    anchorId: string;
  }) => Promise<{ applied: boolean; reason?: string }>;
  /** 正在保存时忽略新的时间线改动，避免用过期位置算下一步。 */
  writePending?: boolean;
};

export type StoryboardTimelineAnchor = {
  id: string;
  stableShotId: string;
  timelineFrame: number;
};

export type StoryboardGroupPreview =
  | {
      kind: "ok";
      stableShotIds: string[];
      boundaryStableShotId: string | null;
    }
  | { kind: "blocked"; reason: string };

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
  /** 当前主视频在成片里的真实来源范围，用来画出随时间变化的缩略帧。 */
  primaryFrameSource?: StoryboardEditFrameSource | null;
  /** 通过右键“抽帧”保存的时间线画面，显示在剪辑行上方的独立轨道。 */
  extractedFrames?: readonly {
    id: string;
    imageId: number;
    imageUrl: string;
    atMs: number;
  }[];
};

function StoryboardEditFilmstrip({
  frameUrls,
  posterUrl,
  testId,
}: {
  frameUrls: readonly string[];
  posterUrl?: string | null;
  testId: string;
}) {
  if (frameUrls.length === 0 && !posterUrl) return null;
  return (
    <span
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      data-testid={testId}
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      ) : null}
      {frameUrls.length > 0 ? (
        <span className="absolute inset-0 flex">
          {frameUrls.map((src, index) => (
            <img
              key={`${src}-${index}`}
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full min-w-0 flex-1 select-none border-r border-black/15 object-cover last:border-r-0"
              onError={event => {
                // 抽帧暂时失败时露出底下的主图/色块，避免出现破图图标。
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          ))}
        </span>
      ) : null}
      <span className="absolute inset-0 bg-black/10" />
    </span>
  );
}

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
function StoryboardEditRowHeader({
  hidden,
  onToggleHidden,
  onAddAbove,
  onAddBelow,
}: {
  hidden: boolean;
  onToggleHidden: () => void;
  onAddAbove: () => void;
  onAddBelow: () => void;
}) {
  return (
    <div
      role="rowheader"
      className="group sticky left-0 z-20 flex items-center gap-1 border-b border-r px-1.5 py-2 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
    >
      <span className="min-w-0 flex-1 truncate">视觉 · 剪辑</span>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        onClick={onToggleHidden}
        aria-label={`${hidden ? "显示" : "隐藏"}主视觉层`}
        title={`${hidden ? "显示" : "隐藏"}主视觉层`}
      >
        {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        onClick={onAddAbove}
        aria-label="在上方增加剪辑层"
        title="在上方增加剪辑层"
      >
        <ArrowUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        onClick={onAddBelow}
        aria-label="在下方增加剪辑层"
        title="在下方增加剪辑层"
      >
        <ArrowDown className="h-3 w-3" />
      </button>
    </div>
  );
}

function StoryboardExtraLayerHeader({
  index,
  hidden,
  onToggleHidden,
  onDelete,
}: {
  index: number;
  hidden: boolean;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="rowheader"
      className={`sticky left-0 z-20 flex items-center gap-1 border-b border-r px-1.5 py-2 text-[9px] font-semibold text-muted-foreground ${hidden ? "opacity-45" : ""}`}
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
    >
      <span className="min-w-0 flex-1 truncate">视觉层 {index + 1}</span>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        onClick={onToggleHidden}
        aria-label={`${hidden ? "显示" : "隐藏"}视觉层 ${index + 1}`}
        title={`${hidden ? "显示" : "隐藏"}视觉层 ${index + 1}`}
      >
        {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
        aria-label={`删除视觉层 ${index + 1}`}
        title={`删除视觉层 ${index + 1}`}
      >
        <Trash2 className="h-3 w-3" />
      </button>
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
      <span>听觉 · 音轨</span>
      <span className="mt-0.5 text-[7px] font-normal text-muted-foreground/70">
        强弱 · 停顿
      </span>
    </div>
  );
}

function StoryboardExtractedFrameRows({
  shots,
  timeline,
  columnSpan,
  onSelectShot,
}: {
  shots: readonly StoryboardEditShot[];
  timeline: StoryboardBoardTimeline;
  columnSpan: number;
  onSelectShot: (shotNo: number) => void;
}) {
  const totalMs = Math.max(
    timeline.totalMs,
    storyboardTimingTotalMs(shots.map(shot => shot.timing)),
    ...(timeline.overlays ?? []).map(overlay => (overlay.endFrame * 1000) / 30)
  );
  const frames = shots
    .flatMap(shot =>
      (shot.extractedFrames ?? []).map(frame => ({ ...frame, shot }))
    )
    .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id));
  const [transitionMenu, setTransitionMenu] = useState<{
    clientX: number;
    clientY: number;
    leftImageId: number;
    rightImageId: number;
    durationSec: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [frameMenu, setFrameMenu] = useState<{
    clientX: number;
    clientY: number;
    frames: Array<{
      imageId: number;
      shotLabel: string;
      atMs: number;
    }>;
  } | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadPct = storyboardEditPlayheadPct(timeline.playheadMs, totalMs);
  const seekFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    timeline.onSeek(
      Math.max(
        0,
        Math.min(totalMs, ((clientX - rect.left) / rect.width) * totalMs)
      )
    );
  };
  useEffect(() => {
    if (!transitionMenu && !frameMenu) return;
    const close = () => {
      if (deletingImageId != null) return;
      setTransitionMenu(null);
      setFrameMenu(null);
      setDeleteError(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [deletingImageId, frameMenu, transitionMenu]);
  const openAtMs = (atMs: number, clientX: number, clientY: number) => {
    const selected = selectExtractedFramePair({ frames, atMs });
    if (selected.kind !== "ok") return;
    setFrameMenu(null);
    setDeleteError(null);
    setTransitionMenu({
      clientX,
      clientY,
      leftImageId: selected.pair.left.imageId,
      rightImageId: selected.pair.right.imageId,
      durationSec: selected.pair.requestedDurationSec,
    });
  };
  return (
    <>
      <div
        role="rowheader"
        className="sticky left-0 z-20 flex flex-col justify-center border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
        style={{
          borderColor:
            "color-mix(in srgb, var(--panel-border) 62%, transparent)",
          background: "var(--background)",
        }}
      >
        <span>抽帧 · 上层</span>
        <span className="mt-0.5 text-[7px] font-normal text-muted-foreground/70">
          右键剪辑条添加
        </span>
      </div>
      <div
        role="cell"
        className="px-2 py-1"
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <div
          ref={trackRef}
          className="relative h-12 overflow-hidden rounded-sm border border-border/70 bg-muted/15"
          data-testid="storyboard-extracted-frame-track"
          aria-label="抽帧上层轨道"
          role="button"
          tabIndex={0}
          aria-keyshortcuts="Shift+F10 ContextMenu"
          onContextMenu={event => {
            if (!timeline.onCreateExtractedFrameTransition) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            openAtMs(
              Math.max(
                0,
                Math.min(
                  totalMs,
                  ((event.clientX - rect.left) / Math.max(1, rect.width)) * totalMs
                )
              ),
              event.clientX,
              event.clientY
            );
          }}
          onKeyDown={event => {
            if (
              !timeline.onCreateExtractedFrameTransition ||
              !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
            ) return;
            event.preventDefault();
            const rect = trackRef.current?.getBoundingClientRect();
            openAtMs(
              timeline.playheadMs,
              rect ? rect.left + rect.width / 2 : 0,
              rect ? rect.top + rect.height / 2 : 0
            );
          }}
        >
          {frames.length === 0 ? (
            <span className="absolute inset-0 flex items-center px-2 text-[8px] text-muted-foreground/65">
              在剪辑条上右键，选择“抽帧”
            </span>
          ) : null}
          {frames.map(({ shot, ...frame }) => {
            const leftPct =
              totalMs > 0
                ? Math.min(100, Math.max(0, (frame.atMs / totalMs) * 100))
                : 0;
            const active = Math.abs(timeline.playheadMs - frame.atMs) <= 50;
            return (
              <button
                key={frame.id}
                type="button"
                className={`absolute bottom-1 top-1 z-10 w-10 -translate-x-1/2 overflow-hidden rounded-sm border bg-background shadow-sm transition hover:z-20 hover:scale-105 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  active ? "border-primary ring-1 ring-primary" : "border-white/60"
                }`}
                style={{ left: `${leftPct}%` }}
                onClick={() => {
                  onSelectShot(shot.shotNo);
                  timeline.onTogglePlay(false);
                  timeline.onSeek(frame.atMs);
                }}
                onContextMenu={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTransitionMenu(null);
                  setDeleteError(null);
                  const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 0;
                  const overlappingFrames = frames.filter(candidate => {
                    if (trackWidth <= 0 || totalMs <= 0) {
                      return candidate.imageId === frame.imageId;
                    }
                    return (
                      (Math.abs(candidate.atMs - frame.atMs) / totalMs) * trackWidth <
                      38
                    );
                  });
                  setFrameMenu({
                    clientX: event.clientX,
                    clientY: event.clientY,
                    frames: overlappingFrames.map(candidate => ({
                      imageId: candidate.imageId,
                      shotLabel: candidate.shot.shotLabel,
                      atMs: candidate.atMs,
                    })),
                  });
                }}
                onKeyDown={event => {
                  if (
                    !(event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10"))
                  ) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setTransitionMenu(null);
                  setDeleteError(null);
                  setFrameMenu({
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2,
                    frames: [
                      {
                        imageId: frame.imageId,
                        shotLabel: shot.shotLabel,
                        atMs: frame.atMs,
                      },
                    ],
                  });
                }}
                aria-keyshortcuts="Shift+F10 ContextMenu"
                aria-label={`查看抽帧 ${shot.shotLabel} ${formatStoryboardTimestamp(frame.atMs)}`}
                title={`${shot.shotLabel} · 抽帧 ${formatStoryboardTimestamp(frame.atMs)} · 图片 #${frame.imageId}`}
                data-testid={`storyboard-extracted-frame-${frame.imageId}`}
              >
                <img
                  src={frame.imageUrl}
                  alt=""
                  draggable={false}
                  className="h-full w-full select-none object-cover"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/65 px-0.5 font-mono text-[6px] leading-3 text-white">
                  {formatStoryboardTimestamp(frame.atMs)}
                </span>
              </button>
            );
          })}
          {(timeline.overlays ?? []).map(overlay => {
            const leftPct = totalMs > 0 ? ((overlay.startFrame * 1000) / 30 / totalMs) * 100 : 0;
            const mediaWidthPct = totalMs > 0 ? (((overlay.mediaEndFrame - overlay.startFrame) * 1000) / 30 / totalMs) * 100 : 0;
            const gapWidthPct = totalMs > 0 ? (((overlay.endFrame - overlay.mediaEndFrame) * 1000) / 30 / totalMs) * 100 : 0;
            return (
              <div key={overlay.id} data-testid={`storyboard-overlay-${overlay.id}`}>
                <video
                  src={overlay.videoUrl}
                  muted
                  preload="metadata"
                  className="pointer-events-none absolute bottom-1 top-1 z-[5] rounded-sm border border-cyan-400/70 bg-black object-cover"
                  style={{ left: `${leftPct}%`, width: `${Math.max(mediaWidthPct, 0.4)}%` }}
                />
                {gapWidthPct > 0 ? (
                  <span
                    className="pointer-events-none absolute bottom-1 top-1 z-[4] border border-dashed border-cyan-500/50 bg-black"
                    style={{ left: `${leftPct + mediaWidthPct}%`, width: `${gapWidthPct}%` }}
                    title="未生成区间 · 留空"
                  />
                ) : null}
              </div>
            );
          })}
          {playheadPct != null ? (
            <div
              role="slider"
              tabIndex={0}
              aria-label="拖动顶层播放头"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalMs)}
              aria-valuenow={Math.round(timeline.playheadMs)}
              aria-valuetext={formatStoryboardTimestamp(timeline.playheadMs)}
              title="播放头位于所有视觉剪辑层最上方"
              className="group absolute bottom-0 top-0 z-50 w-5 -translate-x-1/2 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
              style={{ left: `${playheadPct}%` }}
              data-testid="storyboard-top-playhead"
              onPointerDown={event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                timeline.onTogglePlay(false);
                event.currentTarget.setPointerCapture(event.pointerId);
                seekFromClientX(event.clientX);
              }}
              onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  seekFromClientX(event.clientX);
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
        {transitionMenu ? (
          <div
            role="menu"
            className="fixed z-[100] min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: transitionMenu.clientX, top: transitionMenu.clientY }}
            onPointerDown={event => event.stopPropagation()}
            data-testid="storyboard-extracted-frame-transition-menu"
          >
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
              onClick={async () => {
                if (!timeline.onCreateExtractedFrameTransition) return;
                setPending(true);
                const result = await timeline.onCreateExtractedFrameTransition({
                  leftImageId: transitionMenu.leftImageId,
                  rightImageId: transitionMenu.rightImageId,
                });
                setPending(false);
                if (result.applied) setTransitionMenu(null);
              }}
            >
              {pending
                ? "正在生成确认卡…"
                : `用左右抽帧生成 ${transitionMenu.durationSec} 秒覆盖视频…`}
            </button>
          </div>
        ) : null}
        {frameMenu ? (
          <div
            role="menu"
            aria-label="抽帧操作"
            className="fixed z-[110] min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{
              left: Math.min(frameMenu.clientX, window.innerWidth - 208),
              top: Math.min(frameMenu.clientY, window.innerHeight - 120),
            }}
            onPointerDown={event => event.stopPropagation()}
            onContextMenu={event => event.preventDefault()}
            data-testid="storyboard-extracted-frame-delete-menu"
          >
            <div className="border-b border-border/60 px-2 pb-1 text-[9px] text-muted-foreground">
              {frameMenu.frames.length > 1
                ? `此处有 ${frameMenu.frames.length} 张重叠抽帧`
                : `${frameMenu.frames[0]?.shotLabel ?? "抽帧"} · ${formatStoryboardTimestamp(frameMenu.frames[0]?.atMs ?? 0)} · 图片 #${frameMenu.frames[0]?.imageId ?? "-"}`}
            </div>
            {frameMenu.frames.map(candidate => (
              <button
                key={candidate.imageId}
                type="button"
                role="menuitem"
                disabled={deletingImageId != null || !timeline.onDeleteExtractedFrame}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-destructive transition enabled:hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`storyboard-extracted-frame-delete-action-${candidate.imageId}`}
                onClick={async () => {
                  if (!timeline.onDeleteExtractedFrame || deletingImageId != null) return;
                  setDeletingImageId(candidate.imageId);
                  setDeleteError(null);
                  try {
                    const result = await timeline.onDeleteExtractedFrame(candidate.imageId);
                    if (result.applied) {
                      setFrameMenu(current => {
                        if (!current) return null;
                        const remaining = current.frames.filter(
                          item => item.imageId !== candidate.imageId
                        );
                        return remaining.length > 0
                          ? { ...current, frames: remaining }
                          : null;
                      });
                    } else {
                      setDeleteError(result.reason ?? "删除抽帧失败");
                    }
                  } finally {
                    setDeletingImageId(null);
                  }
                }}
              >
                {deletingImageId === candidate.imageId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {deletingImageId === candidate.imageId
                  ? "正在删除…"
                  : frameMenu.frames.length > 1
                    ? `删除 ${candidate.shotLabel} ${formatStoryboardTimestamp(candidate.atMs)} · 图片 #${candidate.imageId}`
                    : "删除这张抽帧"}
              </button>
            ))}
            {deleteError ? (
              <p role="alert" className="max-w-52 px-2 py-1 text-[9px] text-destructive">
                {deleteError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

type MenuState = {
  shot: StoryboardEditShot;
  atMs: number;
  clientX: number;
  clientY: number;
};

const MAIN_VISUAL_LAYER_ID = "main-visual-layer";

type GapMenuState = {
  atMs: number;
  clientX: number;
  clientY: number;
  before: StoryboardTimingRow;
  after: StoryboardTimingRow;
};

/** 空档右键菜单：眼下只有一件事可做，所以不复用镜头那套多项菜单。 */
function StoryboardEditGapMenu({
  menu,
  pending,
  onCreate,
  onClose,
}: {
  menu: GapMenuState;
  pending: boolean;
  onCreate: () => void;
  onClose: () => void;
}) {
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
      aria-label="空档剪辑菜单"
      data-testid="storyboard-edit-gap-menu"
      className="fixed z-[100] min-w-[220px] rounded-md border border-border bg-[var(--background)] py-1 shadow-lg"
      style={{
        left: Math.min(menu.clientX, window.innerWidth - 240),
        top: Math.min(menu.clientY, window.innerHeight - 120),
      }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      <div className="border-b border-border/60 px-3 pb-1 text-[9px] text-muted-foreground">
        空档 · {formatStoryboardTimestamp(menu.atMs)}
      </div>
      <button
        type="button"
        role="menuitem"
        disabled={pending}
        onClick={onCreate}
        data-testid="storyboard-edit-gap-menu-createGapTransition"
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] text-foreground transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted"
      >
        {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
        自动创建镜头（用前后帧生成过渡）
      </button>
    </div>
  );
}

/** 右键菜单。用 fixed 定位，免得被横向滚动的故事版矩阵裁掉。 */
function StoryboardEditContextMenu({
  menu,
  shotCount,
  canSplitHere,
  canInsert,
  canDelete,
  anchorState,
  pendingAction,
  onPick,
  onClose,
}: {
  menu: MenuState;
  shotCount: number;
  canSplitHere: boolean;
  canInsert: boolean;
  canDelete: boolean;
  anchorState?: {
    inGap: boolean;
    alreadyAnchored: boolean;
    removableAnchorLabel: string | null;
  };
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
    anchors: anchorState,
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
  onOpenGapMenu,
  trackRef,
  markInMs,
  pendingLabel,
  focusedAnchorId,
  onFocusAnchor,
  onRemoveAnchor,
  statusMessage,
  onStatusMessage,
  excludedShotIds,
  onMoveShotToLayer,
  disableGroupMove = false,
}: {
  timeline: StoryboardBoardTimeline;
  shots: readonly StoryboardEditShot[];
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number) => void;
  onOpenMenu: (menu: MenuState) => void;
  onOpenGapMenu: (menu: GapMenuState) => void;
  trackRef: React.MutableRefObject<HTMLDivElement | null>;
  markInMs: number | null;
  pendingLabel: string | null;
  focusedAnchorId: string | null;
  onFocusAnchor: (anchorId: string | null) => void;
  onRemoveAnchor: (anchor: StoryboardTimelineAnchor) => void;
  statusMessage: string | null;
  onStatusMessage: (message: string | null) => void;
  excludedShotIds?: ReadonlySet<string>;
  onMoveShotToLayer?: (stableShotId: string, layerId: string) => void;
  disableGroupMove?: boolean;
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
    startFrame: number;
    durationFrames: number;
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
  const groupDragRef = useRef<{
    clientX: number;
    trackWidthPx: number;
    stableShotId: string;
    direction: "left" | "right" | null;
  } | null>(null);
  const [groupDrag, setGroupDrag] = useState<{
    stableShotId: string;
    direction: "left" | "right" | null;
    deltaFrames: number;
    stableShotIds: string[];
    boundaryStableShotId: string | null;
    blockedReason: string | null;
  } | null>(null);
  const singleDragRef = useRef<{
    clientX: number;
    trackWidthPx: number;
    stableShotId: string;
  } | null>(null);
  const [singleDrag, setSingleDrag] = useState<{
    stableShotId: string;
    deltaFrames: number;
    blockedReason: string | null;
  } | null>(null);

  const timings = shots.map(shot => shot.timing);
  // 整条片长按最大结束时间算：移动之后靠前的镜头完全可能结束得最晚。
  const totalMs = Math.max(timeline.totalMs, storyboardTimingTotalMs(timings));
  const groupEnabled =
    !disableGroupMove &&
    Boolean(timeline.previewGroupMove && timeline.onMoveTimelineGroup);
  const singleMoveEnabled = !disableGroupMove && Boolean(timeline.onMoveTimelineShot);
  const labelByShotId = new Map(
    shots.map(shot => [shot.stableShotId, shot.shotLabel] as const)
  );
  const anchors = [...(timeline.anchors ?? [])].sort(
    (left, right) =>
      left.timelineFrame - right.timelineFrame || left.id.localeCompare(right.id)
  );

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
      startFrame: shot.timing.startFrame,
      durationFrames: shot.timing.durationFrames,
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
      if (timeline.onTrimTimelineEdge) {
        const result = await timeline.onTrimTimelineEdge({
          stableShotId: start.stableShotId,
          edge: start.edge,
          requestedBoundaryFrame: storyboardTrimmedBoundaryFrame({
            startFrame: start.startFrame,
            durationFrames: start.durationFrames,
            edge: start.edge,
            newDurationMs: trim.durationMs,
          }),
        });
        if (!result.applied && result.reason) onStatusMessage(result.reason);
        return;
      }
      await timeline.onTrimShotDuration({
        shotNo: start.shotNo,
        stableShotId: start.stableShotId,
        durationMs: trim.durationMs,
      });
    } finally {
      setDraftTrim(null);
    }
  };

  const clearGroupDrag = useCallback(() => {
    groupDragRef.current = null;
    setGroupDrag(null);
  }, []);

  const startGroupDrag = (
    event: ReactPointerEvent<HTMLElement>,
    shot: StoryboardEditShot
  ) => {
    if (event.button !== 0 || !groupEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    const trackWidthPx = trackRef.current?.getBoundingClientRect().width ?? 0;
    if (trackWidthPx <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    // 上一条结果不能盖住这次手势的反馈——尤其是「这一镜锁住了」这种拒绝原因。
    onStatusMessage(null);
    groupDragRef.current = {
      clientX: event.clientX,
      trackWidthPx,
      stableShotId: shot.stableShotId,
      direction: null,
    };
    // 还没越过阈值就先把两侧的候选范围亮出来，鼠标/触摸/键盘都能看见。
    const left = timeline.previewGroupMove?.({
      stableShotId: shot.stableShotId,
      direction: "left",
    });
    const right = timeline.previewGroupMove?.({
      stableShotId: shot.stableShotId,
      direction: "right",
    });
    const candidates = [left, right].flatMap(preview =>
      preview?.kind === "ok" ? preview.stableShotIds : []
    );
    setGroupDrag({
      stableShotId: shot.stableShotId,
      direction: null,
      deltaFrames: 0,
      stableShotIds: Array.from(new Set(candidates)),
      boundaryStableShotId: null,
      blockedReason:
        left?.kind === "blocked"
          ? left.reason
          : right?.kind === "blocked"
            ? right.reason
            : null,
    });
  };

  const moveGroupDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = groupDragRef.current;
    if (!start) return;
    const step = storyboardGroupDragStep({
      lockedDirection: start.direction,
      deltaPx: event.clientX - start.clientX,
      trackWidthPx: start.trackWidthPx,
      totalMs,
    });
    if (!step) return;
    if (start.direction == null) {
      // 方向在越过阈值的这一刻锁死，之后指针划回另一侧也不换组员。
      start.direction = step.direction;
      const preview = timeline.previewGroupMove?.({
        stableShotId: start.stableShotId,
        direction: step.direction,
      });
      setGroupDrag({
        stableShotId: start.stableShotId,
        direction: step.direction,
        deltaFrames: step.deltaFrames,
        stableShotIds: preview?.kind === "ok" ? preview.stableShotIds : [],
        boundaryStableShotId:
          preview?.kind === "ok" ? preview.boundaryStableShotId : null,
        blockedReason: preview?.kind === "blocked" ? preview.reason : null,
      });
      return;
    }
    setGroupDrag(current =>
      current == null || current.deltaFrames === step.deltaFrames
        ? current
        : { ...current, deltaFrames: step.deltaFrames }
    );
  };

  const endGroupDrag = async (event: ReactPointerEvent<HTMLElement>) => {
    const start = groupDragRef.current;
    const step = start
      ? storyboardGroupDragStep({
          lockedDirection: start.direction,
          deltaPx: event.clientX - start.clientX,
          trackWidthPx: start.trackWidthPx,
          totalMs,
        })
      : null;
    groupDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setGroupDrag(null);
    if (!start || !step) {
      // 没越过拖动阈值就是点选：把播放头落到用户看中的那张缩略画面上。
      timeline.onSelectRange(null);
      timeline.onSeek(trackMsFromPointer(event.clientX));
      return;
    }
    if (step.deltaFrames === 0) return;
    await timeline.onMoveTimelineGroup?.({
      stableShotId: start.stableShotId,
      direction: step.direction,
      deltaFrames: step.deltaFrames,
    });
  };

  // 拖到一半按 Esc 或丢掉指针捕获都直接取消，不写任何数据。
  useEffect(() => {
    if (!groupDrag) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      clearGroupDrag();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [clearGroupDrag, groupDrag]);

  const clearSingleDrag = useCallback(() => {
    singleDragRef.current = null;
    setSingleDrag(null);
  }, []);

  const startSingleDrag = (
    event: ReactPointerEvent<HTMLElement>,
    shot: StoryboardEditShot
  ) => {
    if (event.button !== 0 || !singleMoveEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    const trackWidthPx = trackRef.current?.getBoundingClientRect().width ?? 0;
    if (trackWidthPx <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    onStatusMessage(null);
    singleDragRef.current = {
      clientX: event.clientX,
      trackWidthPx,
      stableShotId: shot.stableShotId,
    };
    setSingleDrag({
      stableShotId: shot.stableShotId,
      deltaFrames: 0,
      // 锚定的这一镜不能移动；这里立刻给出理由，不用等松手才告诉用户。
      blockedReason:
        shot.timing.anchorFrames.length > 0
          ? "这一镜已有位置锚点，不能移动"
          : null,
    });
  };

  const moveSingleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = singleDragRef.current;
    if (!start) return;
    const deltaFrames = storyboardGroupDragDeltaFrames({
      deltaPx: event.clientX - start.clientX,
      trackWidthPx: start.trackWidthPx,
      totalMs,
    });
    setSingleDrag(current =>
      current == null || current.deltaFrames === deltaFrames
        ? current
        : { ...current, deltaFrames }
    );
  };

  const endSingleDrag = async (event: ReactPointerEvent<HTMLElement>) => {
    const start = singleDragRef.current;
    const deltaFrames = start
      ? storyboardReleasedDragDeltaFrames({
          startClientX: start.clientX,
          releaseClientX: event.clientX,
          trackWidthPx: start.trackWidthPx,
          totalMs,
        })
      : 0;
    singleDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSingleDrag(null);
    if (!start || deltaFrames === 0) return;
    await timeline.onMoveTimelineShot?.({
      stableShotId: start.stableShotId,
      deltaFrames,
    });
  };

  // 拖到一半按 Esc 或丢掉指针捕获都直接取消，不写任何数据。
  useEffect(() => {
    if (!singleDrag) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      clearSingleDrag();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [clearSingleDrag, singleDrag]);

  const groupGhostShotIds =
    groupDrag?.direction && groupDrag.deltaFrames !== 0
      ? groupDrag.stableShotIds
      : [];
  const groupDeltaPct =
    totalMs > 0 && groupDrag
      ? ((groupDrag.deltaFrames * (1000 / 30)) / totalMs) * 100
      : 0;

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
        aria-label={
          singleMoveEnabled
            ? "剪辑时间条，拖动镜头只移动它自己，六点抓手整体移动同方向连续的镜头，按住 Shift 拖动改为选中一段交给聊聊，右键出剪辑菜单"
            : "剪辑时间条，拖动选中一段交给聊聊，右键出剪辑菜单"
        }
        aria-keyshortcuts="Space ArrowLeft ArrowRight ArrowUp ArrowDown S F X I O Delete"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs)}
        aria-valuenow={Math.round(timeline.playheadMs)}
        aria-valuetext={formatStoryboardTimestamp(timeline.playheadMs)}
        data-testid="storyboard-edit-track"
        className="relative h-18 w-full cursor-text touch-none rounded-sm border border-border/70 bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        onPointerDown={startRangeDrag}
        onPointerMove={moveRangeDrag}
        onPointerUp={endRangeDrag}
        onPointerCancel={endRangeDrag}
        onDragOver={event => {
          if (!event.dataTransfer.types.includes(SHOT_DRAG_MIME)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={event => {
          const sourceStableShotId = event.dataTransfer.getData(SHOT_DRAG_MIME);
          if (!sourceStableShotId || !onMoveShotToLayer) return;
          event.preventDefault();
          event.stopPropagation();
          onMoveShotToLayer(sourceStableShotId, MAIN_VISUAL_LAYER_ID);
        }}
        onContextMenu={event => {
          // 落在某个镜头块上时，块自己的 onContextMenu 已经 stopPropagation，
          // 冒泡到这里的只会是真正的空档。
          if (!timeline.onCreateGapTransition) return;
          const atMs = trackMsFromPointer(event.clientX);
          if (storyboardEditTimingAt(timings, atMs)) return;
          const sorted = [...timings].sort((a, b) => a.startMs - b.startMs);
          const before = [...sorted].reverse().find(t => t.endMs <= atMs);
          const after = sorted.find(t => t.startMs >= atMs);
          if (!before || !after) return;
          event.preventDefault();
          event.stopPropagation();
          trackRef.current?.focus();
          timeline.onTogglePlay(false);
          onOpenGapMenu({
            atMs,
            before,
            after,
            clientX: event.clientX,
            clientY: event.clientY,
          });
        }}
      >
        {blocks.map(({ timing, leftPct, widthPct }) => {
          if (excludedShotIds?.has(timing.stableShotId)) return null;
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
              className={`absolute bottom-0.5 top-4 overflow-visible rounded-[2px] border ${
                selected
                  ? "z-20 border-primary ring-1 ring-primary"
                  : "z-10 border-white/40"
              } ${
                dropTargetShotId === shot.stableShotId
                  ? "outline-dashed outline-2 outline-primary"
                  : ""
              }`}
              style={{ left: `${drawnLeftPct}%`, width: `${drawnWidthPct}%` }}
              title={
                singleMoveEnabled
                  ? `${shot.shotLabel} · ${formatStoryboardTimestamp(timing.startMs)} · ${(durationMs / 1000).toFixed(1)}s · 拖动只移动这一镜 · 六点抓手整体移动 · ⇧拖动改选一段 · 右键出剪辑菜单`
                  : `${shot.shotLabel} · ${formatStoryboardTimestamp(timing.startMs)} · ${(durationMs / 1000).toFixed(1)}s · 右键出剪辑菜单`
              }
              data-testid={`storyboard-edit-block-${shot.stableShotId}`}
              data-storyboard-edit-shot-no={shot.shotNo}
              // 抓住镜头本身只移动它自己——和主流剪辑软件一致。要整体移动一串
              // 连续镜头，用选中后出现的六点抓手。按住 ⇧ 才是拉选区。
              onPointerDown={event => {
                if (!singleMoveEnabled || event.shiftKey || event.button !== 0) {
                  return;
                }
                onSelectShot(shot.shotNo);
                startSingleDrag(event, shot);
              }}
              onPointerMove={singleMoveEnabled ? moveSingleDrag : undefined}
              onPointerUp={
                singleMoveEnabled ? event => void endSingleDrag(event) : undefined
              }
              onPointerCancel={
                singleMoveEnabled ? () => clearSingleDrag() : undefined
              }
              onLostPointerCapture={
                singleMoveEnabled ? () => clearSingleDrag() : undefined
              }
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
              {segments.map(segment => {
                const segmentDurationMs =
                  durationMs * (segment.widthPct / 100);
                const source: StoryboardEditFrameSource | null = segment.clip
                  ? {
                      takeId: segment.clip.takeId,
                      rangeId: segment.clip.rangeId,
                      sourceStartSec: segment.clip.sourceStartSec,
                      sourceEndSec: segment.clip.sourceEndSec,
                      reverse: segment.clip.effects?.reverse,
                    }
                  : (shot.primaryFrameSource ?? null);
                const frameUrls = storyboardEditFilmstripFrameUrls({
                  source,
                  durationMs: segmentDurationMs,
                });
                return (
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
                    <StoryboardEditFilmstrip
                      frameUrls={frameUrls}
                      posterUrl={
                        segment.kind === "primary" ? shot.posterUrl : null
                      }
                      testId={`storyboard-edit-filmstrip-${shot.stableShotId}-${segment.id}`}
                    />
                  </span>
                );
              })}
              {anchors
                .filter(anchor => anchor.stableShotId === shot.stableShotId)
                .map(anchor => {
                  const localPct =
                    timing.durationFrames > 0
                      ? ((anchor.timelineFrame - timing.startFrame) /
                          timing.durationFrames) *
                        100
                      : 0;
                  if (localPct < 0 || localPct > 100) return null;
                  return (
                    <span
                      key={anchor.id}
                      // 视觉副本，键盘焦点只留给时间尺上的那一个。
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 bg-amber-400"
                      style={{ left: `${localPct}%` }}
                      data-testid={`storyboard-edit-shot-anchor-${anchor.id}`}
                    />
                  );
                })}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-4 items-end justify-center bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 font-mono text-[8px] leading-none text-white drop-shadow-sm">
                <span className="truncate">
                  {shot.shotLabel}
                  {timing.anchorFrames.length > 0 ? " · 锁" : ""}
                </span>
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
                    // 批量移动使用 Pointer Events；原生 drag 会触发 pointercancel，
                    // 导致松手前清空手势。只有旧的单镜排序模式才开启原生拖放。
                    draggable={!groupEnabled}
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        SHOT_DRAG_MIME,
                        shot.stableShotId
                      );
                      event.dataTransfer.setData("text/plain", shot.shotLabel);
                    }}
                    onDragEnd={
                      groupEnabled ? undefined : () => setDropTargetShotId(null)
                    }
                    onPointerDown={event => {
                      event.stopPropagation();
                      if (groupEnabled) startGroupDrag(event, shot);
                    }}
                    onPointerMove={groupEnabled ? moveGroupDrag : undefined}
                    onPointerUp={
                      groupEnabled
                        ? event => void endGroupDrag(event)
                        : undefined
                    }
                    onPointerCancel={
                      groupEnabled
                        ? () => clearGroupDrag()
                        : undefined
                    }
                    onLostPointerCapture={
                      groupEnabled ? () => clearGroupDrag() : undefined
                    }
                    disabled={groupEnabled && timeline.writePending === true}
                    className="absolute -top-4 left-0 z-30 flex h-4 w-4 cursor-grab touch-none items-center justify-center rounded-t-sm bg-primary/70 text-[var(--background)] shadow-sm active:cursor-grabbing disabled:cursor-wait"
                    aria-label={
                      groupEnabled
                        ? `拖动 ${shot.shotLabel} 整体移动它和同侧连续的镜头；改顺序用 ⌥← / ⌥→ 或右键菜单`
                        : `拖动 ${shot.shotLabel} 调整镜头顺序`
                    }
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    title={
                      groupEnabled
                        ? "向左/向右拖：整体移动这一镜和同侧连续的镜头，遇到锚定镜头为止 · 改顺序用 ⌥← / ⌥→"
                        : "拖到别的镜头上改顺序 · ⌥← / ⌥→"
                    }
                    data-testid={
                      groupEnabled
                        ? `storyboard-edit-group-grip-${shot.stableShotId}`
                        : `storyboard-edit-reorder-${shot.stableShotId}`
                    }
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
        {groupDrag
          ? blocks
              .filter(block =>
                groupDrag.stableShotIds.includes(block.timing.stableShotId)
              )
              .map(block => (
                <span
                  key={`group-ghost-${block.timing.stableShotId}`}
                  className={`pointer-events-none absolute bottom-0.5 top-4 z-30 rounded-[2px] border-2 border-dashed ${
                    groupDrag.direction
                      ? "border-primary bg-primary/20"
                      : "border-primary/50 bg-primary/10"
                  }`}
                  style={{
                    left: `${block.leftPct + (groupGhostShotIds.includes(block.timing.stableShotId) ? groupDeltaPct : 0)}%`,
                    width: `${block.widthPct}%`,
                  }}
                  data-testid={`storyboard-edit-group-ghost-${block.timing.stableShotId}`}
                />
              ))
          : null}
        {singleDrag && singleDrag.deltaFrames !== 0 && !singleDrag.blockedReason
          ? blocks
              .filter(
                block => block.timing.stableShotId === singleDrag.stableShotId
              )
              .map(block => {
                const deltaPct =
                  totalMs > 0
                    ? ((singleDrag.deltaFrames * (1000 / 30)) / totalMs) * 100
                    : 0;
                return (
                  <span
                    key={`single-ghost-${block.timing.stableShotId}`}
                    className="pointer-events-none absolute bottom-0.5 top-4 z-30 rounded-[2px] border-2 border-dashed border-primary bg-primary/20"
                    style={{
                      left: `${block.leftPct + deltaPct}%`,
                      width: `${block.widthPct}%`,
                    }}
                    data-testid={`storyboard-edit-single-ghost-${block.timing.stableShotId}`}
                  />
                );
              })
          : null}
        {anchors.map((anchor, index) => {
          const leftPct =
            totalMs > 0
              ? ((anchor.timelineFrame * (1000 / 30)) / totalMs) * 100
              : 0;
          if (leftPct < 0 || leftPct > 100) return null;
          const label = labelByShotId.get(anchor.stableShotId) ?? "镜头";
          const focused =
            focusedAnchorId === anchor.id ||
            (focusedAnchorId == null && index === 0);
          return (
            <button
              key={anchor.id}
              type="button"
              // 每个锚点只占一个键盘停留点：这个是可操作的，镜头块里那道是它的影子。
              tabIndex={focused ? 0 : -1}
              className="absolute -top-1 z-40 h-3 w-3 -translate-x-1/2 rounded-sm bg-amber-500 outline-none ring-white/70 focus-visible:ring-2"
              style={{ left: `${leftPct}%` }}
              aria-label={`${label} 的位置锚点，${formatStoryboardTimestamp(anchor.timelineFrame * (1000 / 30))}，按 Delete 取消`}
              aria-keyshortcuts="Delete Backspace ArrowLeft ArrowRight"
              title={`${label} 位置锚点 · Delete 取消`}
              data-testid={`storyboard-edit-anchor-${anchor.id}`}
              data-storyboard-edit-anchor="true"
              onFocus={() => onFocusAnchor(anchor.id)}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                timeline.onSeek(anchor.timelineFrame * (1000 / 30));
              }}
              onKeyDown={event => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemoveAnchor(anchor);
                  return;
                }
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const next =
                  anchors[index + (event.key === "ArrowLeft" ? -1 : 1)];
                if (!next) return;
                onFocusAnchor(next.id);
                (
                  event.currentTarget.parentElement?.querySelector(
                    `[data-testid="storyboard-edit-anchor-${next.id}"]`
                  ) as HTMLElement | null
                )?.focus();
              }}
            />
          );
        })}
        {groupDrag?.blockedReason ? (
          <span
            className="pointer-events-none absolute -top-6 z-50 -translate-x-1/2 whitespace-nowrap rounded-sm bg-rose-600 px-2 py-0.5 text-[10px] font-medium text-white shadow"
            // 轨道有几千像素宽，提示必须贴着被拖的那一镜，否则会飘到屏幕外。
            style={{
              left: `${
                blocks.find(
                  block => block.timing.stableShotId === groupDrag.stableShotId
                )?.leftPct ?? 0
              }%`,
            }}
            data-testid="storyboard-edit-group-blocked"
          >
            {groupDrag.blockedReason}
          </span>
        ) : null}
        {singleDrag?.blockedReason ? (
          <span
            className="pointer-events-none absolute -top-6 z-50 -translate-x-1/2 whitespace-nowrap rounded-sm bg-rose-600 px-2 py-0.5 text-[10px] font-medium text-white shadow"
            style={{
              left: `${
                blocks.find(
                  block => block.timing.stableShotId === singleDrag.stableShotId
                )?.leftPct ?? 0
              }%`,
            }}
            data-testid="storyboard-edit-single-blocked"
          >
            {singleDrag.blockedReason}
          </span>
        ) : null}
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
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 z-40 w-px -translate-x-1/2"
            style={{ left: `${playheadPct}%` }}
            data-testid="storyboard-edit-playhead"
          >
            <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-rose-500 shadow-[0_0_0_1px_rgb(244_63_94_/_0.18)]" />
          </span>
        ) : null}
      </div>
      <span
        className="sr-only"
        aria-live="polite"
        data-testid="storyboard-edit-status"
      >
        {statusMessage ??
          pendingLabel ??
          (groupDrag?.blockedReason ??
            (groupDrag?.direction
              ? storyboardGroupDragSummary({
                  direction: groupDrag.direction,
                  shotLabels: groupDrag.stableShotIds.map(
                    id => labelByShotId.get(id) ?? id
                  ),
                  deltaFrames: groupDrag.deltaFrames,
                  boundaryLabel: groupDrag.boundaryStableShotId
                    ? (labelByShotId.get(groupDrag.boundaryStableShotId) ?? null)
                    : null,
                })
              : (singleDrag?.blockedReason ??
                  (singleDrag
                    ? `移动 ${labelByShotId.get(singleDrag.stableShotId) ?? singleDrag.stableShotId} · ${singleDrag.deltaFrames > 0 ? "+" : ""}${(singleDrag.deltaFrames / 30).toFixed(2)}s`
                    : draftTrim
                      ? `${(draftTrim.durationMs / 1000).toFixed(1)}s`
                      : markInMs != null
                        ? `入点 ${formatStoryboardTimestamp(markInMs)} · 按 O 打出点`
                        : `${shots.length} 镜`))))}
      </span>
    </div>
  );
}

const ACTION_LABELS: Record<StoryboardEditAction, string> = {
  addAnchor: "打标中…",
  removeAnchor: "取消锚点…",
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
  const [mainLayerHidden, setMainLayerHidden] = useState(false);
  const [extraLayers, setExtraLayers] = useState<
    Array<{ id: string; hidden: boolean; position: "above" | "below" }>
  >([]);
  const [layerAssignments, setLayerAssignments] = useState<
    Record<string, string>
  >({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [gapMenu, setGapMenu] = useState<GapMenuState | null>(null);
  const [gapTransitionPending, setGapTransitionPending] = useState(false);
  const [markInMs, setMarkInMs] = useState<number | null>(null);
  const [focusedAnchorId, setFocusedAnchorId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const anchors = timeline.anchors ?? [];

  const addVisualLayer = (position: "above" | "below") => {
    const layer = {
      id: `visual-layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      hidden: false,
      position,
    };
    setExtraLayers(current =>
      position === "above" ? [layer, ...current] : [...current, layer]
    );
  };

  const moveShotToLayer = useCallback((stableShotId: string, layerId: string) => {
    setLayerAssignments(current => ({ ...current, [stableShotId]: layerId }));
  }, []);

  const renderExtraLayer = (layer: (typeof extraLayers)[number], index: number) => {
    const layerShotIds = new Set(
      storyboardVisualLayerShotIds({
        stableShotIds: shots.map(shot => shot.stableShotId),
        assignments: layerAssignments,
        layerId: layer.id,
        mainLayerId: MAIN_VISUAL_LAYER_ID,
      })
    );
    const layerShots = shots.filter(shot => layerShotIds.has(shot.stableShotId));
    return (
      <Fragment key={layer.id}>
        <StoryboardExtraLayerHeader
          index={index + 1}
          hidden={layer.hidden}
          onToggleHidden={() =>
            setExtraLayers(current =>
              current.map(item =>
                item.id === layer.id ? { ...item, hidden: !item.hidden } : item
              )
            )
          }
          onDelete={() => {
            setExtraLayers(current =>
              current.filter(item => item.id !== layer.id)
            );
            setLayerAssignments(current => {
              const next = { ...current };
              for (const [shotId, assignedLayerId] of Object.entries(next)) {
                if (assignedLayerId === layer.id) next[shotId] = MAIN_VISUAL_LAYER_ID;
              }
              return next;
            });
          }}
        />
        <div
          role="cell"
          className={`px-2 ${layer.hidden ? "opacity-25" : ""}`}
          style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes(SHOT_DRAG_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={event => {
            const sourceStableShotId = event.dataTransfer.getData(SHOT_DRAG_MIME);
            if (!sourceStableShotId) return;
            event.preventDefault();
            event.stopPropagation();
            moveShotToLayer(sourceStableShotId, layer.id);
          }}
        >
          <div
            className="relative h-12 border-b border-r bg-muted/10"
            aria-label={`视觉层 ${index + 1} 时间线`}
            data-testid={`storyboard-visual-layer-${index + 1}`}
          >
            {layerShots.map(shot => {
              const timing = shot.timing;
              const left = timeline.totalMs > 0 ? (timing.startMs / timeline.totalMs) * 100 : 0;
              const width = timeline.totalMs > 0 ? (timing.durationMs / timeline.totalMs) * 100 : 0;
              return (
                <button
                  key={shot.stableShotId}
                  type="button"
                  className="absolute bottom-1 top-1 overflow-hidden rounded-sm border border-sky-500/60 bg-sky-500/20 px-1 text-center text-[8px] text-foreground"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  draggable
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(SHOT_DRAG_MIME, shot.stableShotId);
                  }}
                  onClick={() => onSelectShot(shot.shotNo)}
                  title={`${shot.shotLabel} · 覆盖画面；底层镜头顺序保持不变`}
                  data-storyboard-overlay-shot-id={shot.stableShotId}
                >
                  <span className="block truncate">{shot.shotLabel} · 覆盖</span>
                </button>
              );
            })}
          </div>
        </div>
      </Fragment>
    );
  };

  const timings = shots.map(shot => shot.timing);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeGapMenu = useCallback(() => setGapMenu(null), []);

  const createGapTransition = (target: GapMenuState) => {
    if (!timeline.onCreateGapTransition || gapTransitionPending) return;
    closeGapMenu();
    setGapTransitionPending(true);
    void Promise.resolve(
      timeline.onCreateGapTransition({
        beforeStableShotId: target.before.stableShotId,
        afterStableShotId: target.after.stableShotId,
      })
    )
      .then(result => {
        setStatusMessage(
          result?.applied
            ? "已在聊天里生成待确认的过渡镜头卡片"
            : (result?.reason ?? "创建过渡镜头失败")
        );
      })
      .finally(() => setGapTransitionPending(false));
  };

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

  const frameAt = (ms: number) => Math.max(0, Math.round((ms * 30) / 1000));

  const anchorAt = (ms: number) =>
    anchors.find(anchor => anchor.timelineFrame === frameAt(ms)) ?? null;

  /** 删掉一个锚点之后把焦点交给最近的下一个，全删完了就还给时间条。 */
  const removeAnchor = (anchor: StoryboardTimelineAnchor) => {
    if (!timeline.onRemoveAnchor || pendingAction) return;
    const ordered = [...anchors].sort(
      (left, right) => left.timelineFrame - right.timelineFrame
    );
    const index = ordered.findIndex(entry => entry.id === anchor.id);
    const next = ordered[index + 1] ?? ordered[index - 1] ?? null;
    setPendingAction("removeAnchor");
    void Promise.resolve(
      timeline.onRemoveAnchor({
        stableShotId: anchor.stableShotId,
        anchorId: anchor.id,
      })
    )
      .then(result => {
        setStatusMessage(
          result?.applied ? "已取消位置锚点" : (result?.reason ?? "取消锚点失败")
        );
        if (result?.applied) {
          setFocusedAnchorId(next?.id ?? null);
          if (!next) trackRef.current?.focus();
        }
      })
      .finally(() => setPendingAction(null));
  };

  const addAnchor = (ms: number) => {
    if (!timeline.onAddAnchor || pendingAction) return;
    setPendingAction("addAnchor");
    void Promise.resolve(timeline.onAddAnchor(frameAt(ms)))
      .then(result => {
        setStatusMessage(
          result?.applied ? "已钉下位置锚点" : (result?.reason ?? "打标失败")
        );
      })
      .finally(() => setPendingAction(null));
  };

  const runAction = (
    action: StoryboardEditAction,
    shot: StoryboardEditShot | null,
    atMs: number
  ) => {
    if (action === "addAnchor") {
      closeMenu();
      addAnchor(atMs);
      return;
    }
    if (action === "removeAnchor") {
      closeMenu();
      const anchor = anchorAt(atMs);
      if (anchor) removeAnchor(anchor);
      return;
    }
    if (pendingAction || !shot) return;
    // 快捷键/菜单里的微调时长历来只动结尾（开头锚定不动），所以这里固定用 "end" 边。
    const trim = (deltaMs: number) => {
      const newDurationMs = storyboardEditNudgedDurationMs(
        shot.timing.durationMs,
        deltaMs
      );
      if (timeline.onTrimTimelineEdge) {
        return timeline.onTrimTimelineEdge({
          stableShotId: shot.stableShotId,
          edge: "end",
          requestedBoundaryFrame: storyboardTrimmedBoundaryFrame({
            startFrame: shot.timing.startFrame,
            durationFrames: shot.timing.durationFrames,
            edge: "end",
            newDurationMs,
          }),
        });
      }
      return timeline.onTrimShotDuration({
        shotNo: shot.shotNo,
        stableShotId: shot.stableShotId,
        durationMs: newDurationMs,
      });
    };
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
    void Promise.resolve(done)
      .catch(error => {
        setStatusMessage(
          error instanceof Error ? error.message : "剪辑操作失败，请重试"
        );
      })
      .finally(() => setPendingAction(null));
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
      case "addAnchor":
        if (!timeline.onAddAnchor) return;
        timeline.onTogglePlay(false);
        // headRef 是「我要它去哪」，比 timeline.playheadMs 更新一步。
        addAnchor(headRef.current);
        return;
      case "clearSelection":
        setMarkInMs(null);
        setStatusMessage(null);
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
        isAnchorTarget: Boolean(
          target?.closest('[data-storyboard-edit-anchor="true"]')
        ),
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
      {extraLayers
        .filter(layer => layer.position === "above")
        .map((layer, index) => renderExtraLayer(layer, index))}
      <StoryboardExtractedFrameRows
        shots={shots}
        timeline={timeline}
        columnSpan={columnSpan}
        onSelectShot={onSelectShot}
      />
      <StoryboardEditRowHeader
        hidden={mainLayerHidden}
        onToggleHidden={() => setMainLayerHidden(current => !current)}
        onAddAbove={() => addVisualLayer("above")}
        onAddBelow={() => addVisualLayer("below")}
      />
      <div
        role="cell"
        ref={rowRef}
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <div className={mainLayerHidden ? "opacity-25" : undefined}>
          <StoryboardEditTrack
            timeline={timeline}
            shots={shots}
            selectedShotNo={selectedShotNo}
            onSelectShot={onSelectShot}
            onOpenMenu={setMenu}
            onOpenGapMenu={setGapMenu}
            trackRef={trackRef}
            markInMs={markInMs}
            pendingLabel={pendingAction ? ACTION_LABELS[pendingAction] : null}
            focusedAnchorId={focusedAnchorId}
            onFocusAnchor={setFocusedAnchorId}
            onRemoveAnchor={removeAnchor}
            statusMessage={statusMessage}
            onStatusMessage={setStatusMessage}
            onMoveShotToLayer={moveShotToLayer}
            disableGroupMove={extraLayers.length > 0}
          />
        </div>
      </div>
      {extraLayers
        .filter(layer => layer.position === "below")
        .map((layer, index) => renderExtraLayer(layer, index))}
      <StoryboardAudioRowHeader />
      <div
        role="cell"
        className="px-2"
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <StoryboardAudioTrack
          clips={timeline.audioClips}
          totalMs={timeline.audioTotalMs ?? timeline.totalMs}
          playheadMs={timeline.playheadMs}
        />
      </div>
      {gapMenu ? (
        <StoryboardEditGapMenu
          menu={gapMenu}
          pending={gapTransitionPending}
          onCreate={() => createGapTransition(gapMenu)}
          onClose={closeGapMenu}
        />
      ) : null}
      {menu ? (
        <StoryboardEditContextMenu
          menu={menu}
          shotCount={shots.length}
          canSplitHere={timeline.canSplitAt(menu.atMs)}
          canInsert={Boolean(shotActions?.onInsertShotAfter)}
          canDelete={Boolean(shotActions?.onDeleteShot)}
          anchorState={
            timeline.onAddAnchor
              ? {
                  inGap: storyboardEditTimingAt(timings, menu.atMs) == null,
                  alreadyAnchored: anchorAt(menu.atMs) != null,
                  removableAnchorLabel: anchorAt(menu.atMs)
                    ? formatStoryboardTimestamp(menu.atMs)
                    : null,
                }
              : undefined
          }
          pendingAction={pendingAction}
          onPick={action => runAction(action, menu.shot, menu.atMs)}
          onClose={closeMenu}
        />
      ) : null}
    </>
  );
}
