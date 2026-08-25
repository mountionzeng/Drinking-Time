import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Magnet,
  Pause,
  Play,
  Plus,
  SkipBack,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualClip,
} from "@shared/storyMaterial";
import { timelineImageClipStartFrame } from "@shared/storyMaterial";
import { visualTrackId } from "@shared/visualClipModel";
import { visualObjectRefKey, type VisualObjectRef } from "@shared/visualObject";
import {
  createVisualObjectPendingGuard,
  visualObjectCapabilities,
  type VisualObjectCommand,
} from "@shared/visualObjectCapabilities";
import {
  canRemoveTimelineVisualLayer,
  countTimelineVisualLayerClips,
  resolveTimelineVisualLayerState,
  type ResolvedTimelineVisualLayerState,
  type TimelineVisualLayerAction,
} from "@shared/timelineVisualLayers";
import {
  createTimelineViewport,
  DEFAULT_TIMELINE_SCALE,
  frameDeltaToPx,
  frameToPx,
  msToPx,
  pxToFrame,
  pxToMs,
  type TimelineViewport,
} from "@shared/timelineViewport";
import {
  selectExtractedFrameCandidate,
  selectExtractedFrameCandidates,
  selectExtractedFramePair,
  type ExtractedFrameCandidateResult,
} from "@shared/extractedFrameTransition";
import {
  formatStoryboardTimestamp,
  type StoryboardTimingRow,
} from "@/features/storyAgent/storyboardTiming";
import { useStoryImageDrop } from "../useStoryImageDrop";
import { useStoryboardVisualClipNudge } from "../useStoryboardVisualClipNudge";

import {
  STORYBOARD_EDIT_FRAME_MS,
  focusStoryboardClipForDrag,
  isStoryboardClipPointerDrag,
  isStoryboardPointerOwner,
  storyboardEditBlocks,
  storyboardEditEdgeMs,
  storyboardEditFilmstripFrameUrls,
  storyboardEditMenuItems,
  storyboardMagnetThresholdFrames,
  storyboardRollingBoundaryFrame,
  storyboardEditNeighborShotId,
  storyboardEditNudgedDurationMs,
  storyboardEditPlayheadPx,
  storyboardEditRangePx,
  storyboardEditSeekMs,
  storyboardEditSegments,
  storyboardEditSelectionRange,
  storyboardEditNeedsRowFocus,
  storyboardEditShortcut,
  storyboardEditShouldHandleKey,
  storyboardEditTimingAt,
  storyboardEditTrackMs,
  storyboardGroupDragDeltaFrames,
  storyboardGripDragMode,
  storyboardGroupDragStep,
  storyboardGroupDragSummary,
  storyboardTrimmedBoundaryFrame,
  storyboardTrimmedDurationMs,
  storyboardVisualClipShotTimingPreview,
  storyboardVisualObjectMenuFocusIndex,
  storyboardOwnedClipVisualLayer,
  storyboardOwnedClipNudgeBase,
  type StoryboardEditAction,
  type StoryboardEditFrameSource,
  type StoryboardEditRange,
  type StoryboardShotTimingPreview,
} from "../storyboardEditRow";
import {
  StoryboardAudioTrack,
  type StoryboardAudioClip,
} from "./StoryboardAudioWaveform";
import { STORY_IMAGE_DRAG_MIME } from "@/features/storyAgent/storyImageDrag";
import { VIDEO_TAKE_DRAG_MIME } from "@/features/storyAgent/views/videoTakeDrag";

/**
 * 故事版看板里的「剪辑」行：不跟镜头列对齐，自己按时间等比铺成一整条，
 * 靠镜头编号和选中状态跟上面的镜头列关联。
 * 左键拖选一段交给聊聊、拖右边缘改时长、拖左边把手换顺序；
 * 右键出剪辑菜单，键盘走主流剪辑软件那一套快捷键。
 */
export type StoryboardBoardTimeline = {
  /** Changes whenever the active Story/editor session changes. */
  storySessionKey?: string;
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
  /** 这个时间点上有没有可切的视频。 */
  canSplitAt: (ms: number) => boolean;
  /** 这个时间点上有没有可继续抽取的图片或视频。 */
  canExtractAt: (ms: number) => boolean;
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
  magneticJoins?: readonly StoryboardMagneticJoin[];
  onRollTimelineJoin?: (
    input: StoryboardMagneticJoin & {
      requestedBoundaryFrame: number;
    }
  ) => Promise<{ applied: boolean; reason?: string }>;
  onDetachTimelineMagnet?: (
    input: Pick<
      StoryboardMagneticJoin,
      "leftStableShotId" | "rightStableShotId"
    >
  ) => Promise<{ applied: boolean; reason?: string }>;
  onSplitAt: (ms: number) => Promise<void>;
  onExtractFrameAt: (ms: number) => Promise<void>;
  onReorderShot: (input: {
    sourceStableShotId: string;
    targetStableShotId: string;
  }) => Promise<void> | void;
  /**
   * 位置锚点与方向批量移动。都是可选的：还没接上的调用点保持原有行为，
   * 抓手默认移动单镜；按住 Shift 才进入方向批量移动。
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
    snapThresholdFrames: number;
    visualLayer?: number;
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
  /** 唯一的素材移动命令：图片和视频共用同一条提交路径。 */
  onMoveVisualClip?: (input: {
    clipId: string;
    toTrackId: string;
    toStartFrame: number;
  }) => Promise<void>;
  /** Narrow U2 facade; commands without an implementation remain visibly disabled. */
  onVisualObjectCommand?: (
    object: VisualObjectRef,
    command: VisualObjectCommand
  ) => Promise<void>;
  onPlaceExternalVisual?: (
    dataTransfer: DataTransfer,
    timelineFrame: number,
    visualLayer: number
  ) => Promise<{ shotNo: number }>;
  overlays?: readonly StoryTimelineOverlay[];
  /** 渲染形态的图层状态：`count` 已含派生的空白投放层，`explicitCount` 是落库值。 */
  visualLayerState?: ResolvedTimelineVisualLayerState;
  onManageVisualLayer?: (action: TimelineVisualLayerAction) => Promise<void>;
  onRemoveAnchor?: (input: {
    stableShotId: string;
    anchorId: string;
  }) => Promise<{ applied: boolean; reason?: string }>;
  /** 正在保存时阻止新拖拽；方向键微调由队列合并，不会丢输入。 */
  writePending?: boolean;
};

export type StoryboardVisualLayerTrackGeometry = {
  visualLayer: number;
  rect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
  };
};

/**
 * Pointer capture and translated drag previews make `elementFromPoint()`
 * unreliable: the returned child can still belong to the source layer. The
 * Storyboard owns the layer tracks, so resolve the destination from their
 * visible geometry instead of the DOM ancestry of whichever child is on top.
 */
export function storyboardVisualLayerAtPoint(input: {
  clientX: number;
  clientY: number;
  tracks: readonly StoryboardVisualLayerTrackGeometry[];
}): StoryboardVisualLayerTrackGeometry | null {
  return (
    input.tracks.find(
      track =>
        Number.isFinite(track.visualLayer) &&
        track.rect.width > 0 &&
        input.clientX >= track.rect.left &&
        input.clientX <= track.rect.right &&
        input.clientY >= track.rect.top &&
        input.clientY <= track.rect.bottom
    ) ?? null
  );
}

function storyboardVisualLayerAtDocumentPoint(
  clientX: number,
  clientY: number
): StoryboardVisualLayerTrackGeometry | null {
  return storyboardVisualLayerAtPoint({
    clientX,
    clientY,
    tracks: Array.from(
      document.querySelectorAll<HTMLElement>("[data-storyboard-visual-layer]")
    ).map(track => {
      const rect = track.getBoundingClientRect();
      return {
        visualLayer: Number(track.dataset.storyboardVisualLayer),
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
        },
      };
    }),
  });
}

function storyboardVisualLayerTrackGeometry(
  visualLayer: number
): StoryboardVisualLayerTrackGeometry | null {
  const track = document.querySelector<HTMLElement>(
    `[data-storyboard-visual-layer="${visualLayer}"]`
  );
  if (!track) return null;
  const rect = track.getBoundingClientRect();
  return {
    visualLayer,
    rect: {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
    },
  };
}

/**
 * 把一次移动交给唯一命令，并保证失败一定被用户看见。
 *
 * 拖拽、外部拖放和键盘微调都走这里：它们各自只负责算出「哪个 clip、去哪一层、
 * 去哪一帧」，不再各自决定素材归属哪个镜头。
 */
function submitVisualClipMove(input: {
  clipId: string;
  visualLayer: number;
  toStartFrame: number;
  onMoveVisualClip?: (move: {
    clipId: string;
    toTrackId: string;
    toStartFrame: number;
  }) => Promise<void>;
}): Promise<void> {
  const move = input.onMoveVisualClip;
  if (!move) return Promise.resolve();
  return move({
    clipId: input.clipId,
    toTrackId: visualTrackId(input.visualLayer),
    toStartFrame: Math.max(0, Math.round(input.toStartFrame)),
  }).catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : "素材没有移动成功");
  });
}

/**
 * 剪辑块自己渲染出来的起点像素。
 *
 * 一帧图片的抓取盒是固定 40px 并且 -translate-x-1/2 居中，所以它的
 * getBoundingClientRect().left 比真实帧位置左半个盒子。行内 left 像素才是
 * 渲染时用的那个真实起点，拿它当锚点还顺带免疫拖动过程中的横向滚动。
 */
function clipAnchorPx(element: HTMLElement): number | null {
  const raw = element.style.left;
  if (!raw.endsWith("px")) return null;
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : null;
}

/**
 * 拖拽提交的唯一出口。
 *
 * 像素 → (轨道, 绝对帧) 换算完就交给服务端命令，客户端不再决定素材归属哪个
 * 镜头、也不再算相对偏移。任何一步失败都必须让用户看见，不能像以前那样直接
 * return 掉，看上去就是「拖了没反应」。
 */
export function commitVisualClipDrag(input: {
  clipId: string;
  /** 抓取瞬间这个剪辑块渲染出来的起点像素；拿不到时回退到它的左边缘。 */
  startLeftPx: number | null;
  startRectLeft: number;
  startClientX: number;
  releaseClientX: number;
  releaseClientY: number;
  viewport: TimelineViewport;
  onMoveVisualClip?: (move: {
    clipId: string;
    toTrackId: string;
    toStartFrame: number;
  }) => Promise<void>;
  /** 命中哪条轨道。默认查真实 DOM；测试注入几何，好让换算本身可验证。 */
  resolveTrack?: (
    clientX: number,
    clientY: number
  ) => StoryboardVisualLayerTrackGeometry | null;
}): Promise<void> {
  const move = input.onMoveVisualClip;
  if (!move) return Promise.resolve();
  const resolveTrack =
    input.resolveTrack ?? storyboardVisualLayerAtDocumentPoint;
  const targetTrack = resolveTrack(input.releaseClientX, input.releaseClientY);
  if (!targetTrack || targetTrack.rect.width <= 0) {
    toast.error("没落在任何图层上，位置没有改变");
    return Promise.resolve();
  }
  // 保住抓取点：跟着走的是这个剪辑块自己的起点，不是鼠标。
  const startPx =
    input.startLeftPx ?? input.startRectLeft - targetTrack.rect.left;
  const movedPx = startPx + (input.releaseClientX - input.startClientX);
  return submitVisualClipMove({
    clipId: input.clipId,
    visualLayer: targetTrack.visualLayer,
    toStartFrame: pxToFrame(input.viewport, movedPx),
    onMoveVisualClip: move,
  });
}

function useWindowPointerContinuation(input: {
  active: boolean;
  onMove: (event: PointerEvent) => void;
  onFinish: (event: PointerEvent) => void;
  onCancel: (event: PointerEvent) => void;
}) {
  const handlersRef = useRef(input);
  handlersRef.current = input;
  useEffect(() => {
    if (!input.active) return;
    const move = (event: PointerEvent) => handlersRef.current.onMove(event);
    const finish = (event: PointerEvent) => handlersRef.current.onFinish(event);
    const cancel = (event: PointerEvent) => handlersRef.current.onCancel(event);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [input.active]);
}

function storyboardVisualClipArrowMove(input: {
  event: ReactKeyboardEvent<HTMLElement>;
  visualLayer: number;
  onMove: (deltaFrames: number, deltaVisualLayers: number) => void;
}) {
  const { event } = input;
  if (!event.key.startsWith("Arrow")) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const step = event.shiftKey ? 15 : 1;
    input.onMove(event.key === "ArrowLeft" ? -step : step, 0);
  } else {
    input.onMove(0, event.key === "ArrowUp" ? 1 : -1);
  }
  return true;
}

export type StoryboardMagneticJoin = {
  leftStableShotId: string;
  rightStableShotId: string;
  boundaryFrame: number;
};

export type StoryboardTimelineAnchor = {
  id: string;
  stableShotId: string;
  timelineFrame: number;
};

type StoryboardGroupPreview =
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
const IMAGE_CLIP_DRAG_MIME = "application/x-storyboard-image-clip";
const VIDEO_CLIP_DRAG_MIME = "application/x-storyboard-video-clip";

function hasExternalVisualPayload(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return (
    types.includes("Files") ||
    types.includes(STORY_IMAGE_DRAG_MIME) ||
    types.includes(VIDEO_TAKE_DRAG_MIME)
  );
}

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
const VISUAL_LAYER_DRAG_MIME = "application/x-storyboard-visual-layer";

function StoryboardVisualLayerHeader({
  visualLayer,
  hidden,
  onToggleHidden,
  onAddAbove,
  onAddBelow,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  canDelete,
  onDelete,
  onDropLayer,
}: {
  visualLayer: number;
  hidden: boolean;
  onToggleHidden: () => void;
  onAddAbove: () => void;
  onAddBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onDropLayer: (sourceLayer: number) => void;
}) {
  return (
    <div
      role="rowheader"
      className="group sticky left-0 z-20 flex flex-col justify-center gap-1 border-b border-r px-1.5 py-1 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes(VISUAL_LAYER_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={event => {
        const value = event.dataTransfer.getData(VISUAL_LAYER_DRAG_MIME);
        if (!value) return;
        event.preventDefault();
        onDropLayer(Number(value));
      }}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <span
          draggable
          onDragStart={event => {
            event.dataTransfer.setData(
              VISUAL_LAYER_DRAG_MIME,
              String(visualLayer)
            );
            event.dataTransfer.effectAllowed = "move";
          }}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-0.5 truncate active:cursor-grabbing"
          title="拖动可调整整层顺序"
        >
          <GripVertical className="h-3 w-3 shrink-0" />
          {visualLayer === 0 ? "视觉 · 剪辑" : `视觉层 ${visualLayer + 1}`}
        </span>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-sm transition hover:bg-muted hover:text-foreground"
          onClick={onToggleHidden}
          aria-label={`${hidden ? "显示" : "隐藏"}视觉层 ${visualLayer + 1}`}
          title={`${hidden ? "显示" : "隐藏"}视觉层 ${visualLayer + 1}`}
        >
          {hidden ? (
            <EyeOff className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          disabled={!canDelete}
          className="flex h-5 w-5 items-center justify-center rounded-sm text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-30"
          onClick={onDelete}
          aria-label={`删除视觉层 ${visualLayer + 1}`}
          title={
            canDelete
              ? "删除图层；非空层会先确认并把素材合并到相邻层"
              : "最高的空白投放层始终保留，删不掉"
          }
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div
        className="flex items-center gap-0.5"
        aria-label={`视觉层 ${visualLayer + 1} 排列控制`}
      >
        <button
          type="button"
          className="flex h-4 flex-1 items-center justify-center rounded-sm border border-border/60 text-[7px] transition hover:bg-muted"
          onClick={onAddAbove}
          title="在上方插入图层"
        >
          <Plus className="h-2.5 w-2.5" />上
        </button>
        <button
          type="button"
          className="flex h-4 flex-1 items-center justify-center rounded-sm border border-border/60 text-[7px] transition hover:bg-muted"
          onClick={onAddBelow}
          title="在下方插入图层"
        >
          <Plus className="h-2.5 w-2.5" />下
        </button>
        <button
          type="button"
          disabled={!canMoveUp}
          className="flex h-4 w-5 items-center justify-center rounded-sm border border-border/60 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
          onClick={onMoveUp}
          aria-label={`视觉层 ${visualLayer + 1} 上移`}
          title="整层上移"
        >
          <ArrowUp className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          className="flex h-4 w-5 items-center justify-center rounded-sm border border-border/60 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
          onClick={onMoveDown}
          aria-label={`视觉层 ${visualLayer + 1} 下移`}
          title="整层下移"
        >
          <ArrowDown className="h-2.5 w-2.5" />
        </button>
      </div>
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

function StoryboardOwnedVideoClipBlock({
  shot,
  clip,
  visualLayer,
  viewport,
  timeline,
  selectedVisualObject,
  onSelectVisualObject,
  onNudgeVisualClip,
  onOpenObjectMenu,
}: {
  shot: StoryboardEditShot;
  clip: StoryTimelineVisualClip;
  visualLayer: number;
  viewport: TimelineViewport;
  timeline: StoryboardBoardTimeline;
  selectedVisualObject: VisualObjectRef | null;
  onSelectVisualObject: (object: VisualObjectRef, target: HTMLElement) => void;
  onNudgeVisualClip: (input: {
    clipId: string;
    startVisualLayer: number;
    deltaVisualLayers: number;
    startFrame: number;
    deltaFrames: number;
  }) => void;
  onOpenObjectMenu: (menu: VisualObjectMenuState) => void;
}) {
  const object = {
    type: "owned-video-clip",
    clipId: clip.id,
    ownerStableShotId: shot.stableShotId,
  } as const;
  const nudgeBase = storyboardOwnedClipNudgeBase({
    ownerStartFrame: shot.timing.startFrame,
    clip,
  });
  const startFrame = nudgeBase.startFrame;
  const leftPx = frameToPx(viewport, startFrame);
  const widthPx = Math.max(1, msToPx(viewport, clip.durationMs));
  const openMenu = (target: HTMLElement, clientX: number, clientY: number) => {
    onSelectVisualObject(object, target);
    onOpenObjectMenu({ object, clientX, clientY });
  };
  return (
    <button
      type="button"
      className="absolute bottom-1 top-1 z-[18] touch-none cursor-grab overflow-hidden rounded-sm border border-sky-400/70 bg-sky-500/45 text-left text-[8px] outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary"
      style={{ left: leftPx, width: widthPx }}
      data-testid={`storyboard-owned-video-clip-${visualLayer + 1}-${clip.id}`}
      data-visual-object-type="owned-video-clip"
      data-visual-object-id={clip.id}
      data-visual-clip-move-target="true"
      aria-selected={
        selectedVisualObject?.type === "owned-video-clip" &&
        visualObjectRefKey(selectedVisualObject) === visualObjectRefKey(object)
      }
      aria-label={`${clip.label}，视频片段，视觉层 ${visualLayer + 1}`}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
      draggable={Boolean(timeline.onMoveVisualClip)}
      onPointerDown={event => {
        // Keep native drag eligible; only stop the host shot gesture.
        event.stopPropagation();
        onSelectVisualObject(object, event.currentTarget);
      }}
      onDragStart={event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          VIDEO_CLIP_DRAG_MIME,
          JSON.stringify({ clipId: clip.id, sourceVisualLayer: visualLayer })
        );
      }}
      onClick={event => {
        event.stopPropagation();
        timeline.onTogglePlay(false);
        onSelectVisualObject(object, event.currentTarget);
      }}
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(event.currentTarget, event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if (
          storyboardVisualClipArrowMove({
            event,
            visualLayer,
            onMove: (deltaFrames, deltaVisualLayers) => {
              onNudgeVisualClip({
                clipId: nudgeBase.clipId,
                startVisualLayer: nudgeBase.startVisualLayer,
                deltaVisualLayers,
                startFrame,
                deltaFrames,
              });
            },
          })
        )
          return;
        if (
          !(
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        openMenu(
          event.currentTarget,
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
      }}
    >
      <StoryboardEditFilmstrip
        frameUrls={storyboardEditFilmstripFrameUrls({
          source: {
            takeId: clip.takeId,
            rangeId: clip.rangeId,
            sourceStartSec: clip.sourceStartSec,
            sourceEndSec: clip.sourceEndSec,
            reverse: clip.effects?.reverse,
          },
          durationMs: clip.durationMs,
        })}
        posterUrl={null}
        testId={`storyboard-owned-video-filmstrip-${clip.id}`}
      />
      <span className="relative block truncate px-1">{clip.label}</span>
    </button>
  );
}

function StoryboardUpperVisualLayerRow({
  shots,
  timeline,
  viewport,
  columnSpan,
  onSelectShot,
  visualLayer,
  showTopPlayhead,
  hidden,
  canDelete,
  onManageLayer,
  onNudgeVisualClip,
  onShotTimingPreviewChange,
  selectedVisualObject,
  onSelectVisualObject,
  onOpenMenu,
  onOpenObjectMenu,
}: {
  shots: readonly StoryboardEditShot[];
  timeline: StoryboardBoardTimeline;
  viewport: TimelineViewport;
  columnSpan: number;
  onSelectShot: (shotNo: number) => void;
  visualLayer: number;
  showTopPlayhead: boolean;
  hidden: boolean;
  canDelete: boolean;
  onManageLayer: (action: TimelineVisualLayerAction) => void;
  onNudgeVisualClip: (input: {
    clipId: string;
    startVisualLayer: number;
    deltaVisualLayers: number;
    startFrame: number;
    deltaFrames: number;
  }) => void;
  onShotTimingPreviewChange?: (
    preview: StoryboardShotTimingPreview | null,
    gestureId: symbol
  ) => void;
  selectedVisualObject: VisualObjectRef | null;
  onSelectVisualObject: (object: VisualObjectRef, target: HTMLElement) => void;
  onOpenMenu: (menu: MenuState) => void;
  onOpenObjectMenu: (menu: VisualObjectMenuState) => void;
}) {
  const totalMs = viewport.totalMs;
  const frames = shots
    .flatMap(shot => {
      const extractedFrames = shot.extractedFrames ?? [];
      const imageClips = shot.timelineItem?.imageClips ?? [];
      const persisted = imageClips.map(clip => {
        const frame = extractedFrames.find(
          item => item.imageId === clip.imageId
        );
        return {
          id: frame?.id ?? clip.id,
          imageId: clip.imageId,
          imageUrl: clip.imageUrl,
          atMs:
            (timelineImageClipStartFrame(clip, shot.timing.startFrame) * 1000) /
            30,
          clip,
          shot,
        };
      });
      const persistedImageIds = new Set(imageClips.map(clip => clip.imageId));
      const legacy = extractedFrames
        .filter(frame => !persistedImageIds.has(frame.imageId))
        .map(frame => ({ ...frame, clip: undefined, shot }));
      return [...persisted, ...legacy];
    })
    .filter(
      frame =>
        frame.clip?.visualLayer === visualLayer ||
        (!frame.clip && visualLayer === 1)
    )
    .sort(
      (left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id)
    );
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
  const [pairingStart, setPairingStart] = useState<{
    id: string;
    imageId: number;
    atMs: number;
  } | null>(null);
  const [pairingCandidate, setPairingCandidate] =
    useState<ExtractedFrameCandidateResult | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const clipPointerDragRef = useRef<
    | {
        kind: "image";
        pointerId: number;
        startClientX: number;
        startClientY: number;
        /** 抓取瞬间这个剪辑块自己的左边缘，用来保住抓取点的相对位置。 */
        startRectLeft: number;
        startLeftPx: number | null;
        viewport: TimelineViewport;
        moved: boolean;
        clipId: string;
        sourceStableShotId: string;
      }
    | {
        kind: "shot";
        pointerId: number;
        startClientX: number;
        startClientY: number;
        startRectLeft: number;
        startLeftPx: number | null;
        viewport: TimelineViewport;
        moved: boolean;
        gestureId: symbol;
        stableShotId: string;
        startFrame: number;
        durationFrames: number;
      }
    | null
  >(null);
  const suppressClipClickRef = useRef(false);
  const [clipPointerPreview, setClipPointerPreview] = useState<{
    kind: "image" | "shot";
    id: string;
    deltaX: number;
    deltaY: number;
  } | null>(null);
  const clipPointerCommitPendingRef = useRef(false);
  const [clipPointerCommitPreview, setClipPointerCommitPreview] = useState<{
    kind: "image" | "shot";
    id: string;
    deltaX: number;
    deltaY: number;
  } | null>(null);
  const visibleClipPointerPreview =
    clipPointerPreview ?? clipPointerCommitPreview;
  const playheadPx = storyboardEditPlayheadPx(timeline.playheadMs, viewport);
  const seekFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    timeline.onSeek(Math.min(totalMs, pxToMs(viewport, clientX - rect.left)));
  };
  const startClipPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    payload:
      | { kind: "image"; clipId: string; sourceStableShotId: string }
      | {
          kind: "shot";
          stableShotId: string;
          startFrame: number;
          durationFrames: number;
        }
  ) => {
    if (
      event.button !== 0 ||
      timeline.writePending ||
      clipPointerCommitPendingRef.current
    )
      return;
    focusStoryboardClipForDrag(event.currentTarget);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClipClickRef.current = false;
    const dragBase = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRectLeft: event.currentTarget.getBoundingClientRect().left,
      startLeftPx: clipAnchorPx(event.currentTarget),
      viewport,
      moved: false,
    };
    clipPointerDragRef.current =
      payload.kind === "shot"
        ? {
            ...payload,
            ...dragBase,
            gestureId: Symbol("upper-shot-drag"),
          }
        : { ...payload, ...dragBase };
    setClipPointerPreview({
      kind: payload.kind,
      id: payload.kind === "image" ? payload.clipId : payload.stableShotId,
      deltaX: 0,
      deltaY: 0,
    });
  };
  const moveClipPointerDrag = (
    event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">
  ) => {
    const drag = clipPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY
      ) >= 4
    ) {
      drag.moved = true;
      suppressClipClickRef.current = true;
    }
    if (!drag.moved) return;
    if (drag.kind === "shot") {
      onShotTimingPreviewChange?.(
        storyboardVisualClipShotTimingPreview({
          kind: "shot",
          stableShotId: drag.stableShotId,
          startFrame: drag.startFrame,
          durationFrames: drag.durationFrames,
          deltaFrames: storyboardGroupDragDeltaFrames({
            deltaPx: event.clientX - drag.startClientX,
            viewport: drag.viewport,
          }),
        }),
        drag.gestureId
      );
    }
    setClipPointerPreview({
      kind: drag.kind,
      id: drag.kind === "image" ? drag.clipId : drag.stableShotId,
      deltaX: event.clientX - drag.startClientX,
      deltaY: event.clientY - drag.startClientY,
    });
  };
  const finishClipPointerDragAt = async (
    event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">
  ) => {
    const drag = clipPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clipPointerDragRef.current = null;
    if (!drag.moved) {
      setClipPointerPreview(null);
      if (drag.kind === "shot")
        onShotTimingPreviewChange?.(null, drag.gestureId);
      return;
    }
    const releasePreview = {
      kind: drag.kind,
      id: drag.kind === "image" ? drag.clipId : drag.stableShotId,
      deltaX: event.clientX - drag.startClientX,
      deltaY: event.clientY - drag.startClientY,
    };
    // pointerup 可能早于最后一个 pointermove；以真实释放点固定最终预览。
    // 活跃手势与提交中预览分开，窗口监听随前者结束，不会重复 finish。
    setClipPointerPreview(null);
    setClipPointerCommitPreview(releasePreview);
    if (drag.kind === "shot") {
      onShotTimingPreviewChange?.(
        storyboardVisualClipShotTimingPreview({
          kind: "shot",
          stableShotId: drag.stableShotId,
          startFrame: drag.startFrame,
          durationFrames: drag.durationFrames,
          deltaFrames: storyboardGroupDragDeltaFrames({
            deltaPx: event.clientX - drag.startClientX,
            viewport: drag.viewport,
          }),
        }),
        drag.gestureId
      );
    }
    clipPointerCommitPendingRef.current = true;
    try {
      await commitVisualClipDrag({
        clipId:
          drag.kind === "image"
            ? `image:${drag.clipId}`
            : `shot:${drag.stableShotId}`,
        startRectLeft: drag.startRectLeft,
        startLeftPx: drag.startLeftPx,
        startClientX: drag.startClientX,
        releaseClientX: event.clientX,
        releaseClientY: event.clientY,
        viewport: drag.viewport,
        onMoveVisualClip: timeline.onMoveVisualClip,
      });
    } finally {
      clipPointerCommitPendingRef.current = false;
      setClipPointerCommitPreview(null);
      if (drag.kind === "shot")
        onShotTimingPreviewChange?.(null, drag.gestureId);
    }
  };
  const finishClipPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    // 先同步取走 active drag 并标记 pending，再释放 capture；否则浏览器可能在
    // releasePointerCapture 期间派发取消/窗口事件，把最终预览提前清掉或重复提交。
    const pendingMove = finishClipPointerDragAt(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
    void pendingMove;
  };
  const cancelClipPointerDrag = (event: Pick<PointerEvent, "pointerId">) => {
    const drag = clipPointerDragRef.current;
    if (!drag || !isStoryboardPointerOwner(drag.pointerId, event.pointerId))
      return;
    clipPointerDragRef.current = null;
    if (drag.kind === "shot") onShotTimingPreviewChange?.(null, drag.gestureId);
    suppressClipClickRef.current = false;
    setClipPointerPreview(null);
  };
  useWindowPointerContinuation({
    active: clipPointerPreview != null,
    onMove: moveClipPointerDrag,
    onFinish: event => void finishClipPointerDragAt(event),
    onCancel: cancelClipPointerDrag,
  });
  const consumeSuppressedClipClick = () => {
    if (!suppressClipClickRef.current) return false;
    suppressClipClickRef.current = false;
    return true;
  };
  useEffect(() => {
    if (!transitionMenu && !frameMenu && !pairingStart) return;
    const close = (event?: Event) => {
      if (deletingImageId != null) return;
      if (
        pairingStart &&
        event?.target instanceof Node &&
        trackRef.current?.contains(event.target)
      )
        return;
      setTransitionMenu(null);
      setFrameMenu(null);
      setDeleteError(null);
      setPairingStart(null);
      setPairingCandidate(null);
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
  }, [deletingImageId, frameMenu, pairingStart, transitionMenu]);
  const startPairing = (frame: {
    id: string;
    imageId: number;
    atMs: number;
  }) => {
    setTransitionMenu(null);
    setFrameMenu(null);
    setDeleteError(null);
    setPairingStart(frame);
    const nearest = selectExtractedFrameCandidates({
      frames,
      start: frame,
    }).sort(
      (left, right) =>
        Math.abs(left.frame.atMs - frame.atMs) -
          Math.abs(right.frame.atMs - frame.atMs) ||
        left.frame.atMs - right.frame.atMs
    )[0];
    setPairingCandidate(
      nearest
        ? { kind: "ok", candidate: nearest.frame, pair: nearest.pair }
        : { kind: "blocked", reason: "起始抽帧附近没有间隔至少 1 秒的抽帧" }
    );
  };
  const updatePairingCandidate = (clientX: number) => {
    if (!pairingStart) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const atMs = Math.min(totalMs, pxToMs(viewport, clientX - rect.left));
    setPairingCandidate(
      selectExtractedFrameCandidate({ frames, start: pairingStart, atMs })
    );
  };
  const finishPairing = async (pair: {
    leftImageId: number;
    rightImageId: number;
  }) => {
    if (!timeline.onCreateExtractedFrameTransition) return;
    setPending(true);
    try {
      const result = await timeline.onCreateExtractedFrameTransition(pair);
      if (result.applied) {
        setPairingStart(null);
        setPairingCandidate(null);
      }
    } finally {
      setPending(false);
    }
  };
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
      <StoryboardVisualLayerHeader
        visualLayer={visualLayer}
        hidden={hidden}
        onToggleHidden={() =>
          onManageLayer({ kind: "toggle-hidden", layer: visualLayer })
        }
        onAddAbove={() =>
          onManageLayer({ kind: "insert", at: visualLayer + 1 })
        }
        onAddBelow={() => onManageLayer({ kind: "insert", at: visualLayer })}
        onMoveUp={() =>
          onManageLayer({
            kind: "move",
            from: visualLayer,
            to: visualLayer + 1,
          })
        }
        onMoveDown={() =>
          onManageLayer({
            kind: "move",
            from: visualLayer,
            to: visualLayer - 1,
          })
        }
        canMoveUp={
          visualLayer <
          (timeline.visualLayerState?.count ?? visualLayer + 1) - 1
        }
        canMoveDown={visualLayer > 0}
        canDelete={canDelete}
        onDelete={() => onManageLayer({ kind: "remove", layer: visualLayer })}
        onDropLayer={sourceLayer =>
          onManageLayer({ kind: "move", from: sourceLayer, to: visualLayer })
        }
      />
      <div
        role="cell"
        className={`py-1 transition-opacity ${hidden ? "opacity-35 grayscale" : ""}`}
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <div
          ref={trackRef}
          className="relative h-12 overflow-hidden rounded-sm border border-border/70 bg-muted/15"
          data-testid={`storyboard-visual-layer-track-${visualLayer + 1}`}
          data-storyboard-visual-layer={visualLayer}
          aria-label={`视觉层 ${visualLayer + 1} 时间线`}
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
                Math.min(totalMs, pxToMs(viewport, event.clientX - rect.left))
              ),
              event.clientX,
              event.clientY
            );
          }}
          onPointerMove={event => updatePairingCandidate(event.clientX)}
          onDragOver={event => {
            if (
              timeline.onPlaceExternalVisual &&
              hasExternalVisualPayload(event.dataTransfer)
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              return;
            }
            if (
              !event.dataTransfer.types.includes(IMAGE_CLIP_DRAG_MIME) &&
              !event.dataTransfer.types.includes(VIDEO_CLIP_DRAG_MIME) &&
              !event.dataTransfer.types.includes(SHOT_DRAG_MIME)
            )
              return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={event => {
            const rect = trackRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0) return;
            const targetMs = Math.max(
              0,
              Math.min(totalMs, pxToMs(viewport, event.clientX - rect.left))
            );
            if (
              timeline.onPlaceExternalVisual &&
              hasExternalVisualPayload(event.dataTransfer)
            ) {
              event.preventDefault();
              event.stopPropagation();
              void timeline
                .onPlaceExternalVisual(
                  event.dataTransfer,
                  Math.round((targetMs * 30) / 1000),
                  visualLayer
                )
                .then(result => onSelectShot(result.shotNo))
                .catch(error =>
                  toast.error(
                    error instanceof Error ? error.message : "素材落位失败"
                  )
                );
              return;
            }
            const imagePayload =
              event.dataTransfer.getData(IMAGE_CLIP_DRAG_MIME);
            if (imagePayload && timeline.onMoveVisualClip) {
              event.preventDefault();
              const parsed = JSON.parse(imagePayload) as { clipId: string };
              // 落点就是绝对帧，不再要求那一刻恰好压在某个镜头上。
              submitVisualClipMove({
                clipId: `image:${parsed.clipId}`,
                visualLayer,
                toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
                onMoveVisualClip: timeline.onMoveVisualClip,
              });
              return;
            }
            const videoPayload =
              event.dataTransfer.getData(VIDEO_CLIP_DRAG_MIME);
            if (videoPayload && timeline.onMoveVisualClip) {
              event.preventDefault();
              const parsed = JSON.parse(videoPayload) as { clipId: string };
              submitVisualClipMove({
                clipId: `video:${parsed.clipId}`,
                visualLayer,
                toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
                onMoveVisualClip: timeline.onMoveVisualClip,
              });
              return;
            }
            const stableShotId = event.dataTransfer.getData(SHOT_DRAG_MIME);
            const sourceShot = shots.find(
              shot => shot.stableShotId === stableShotId
            );
            if (sourceShot && timeline.onMoveVisualClip) {
              event.preventDefault();
              submitVisualClipMove({
                clipId: `shot:${stableShotId}`,
                visualLayer,
                toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
                onMoveVisualClip: timeline.onMoveVisualClip,
              });
            }
          }}
          onPointerLeave={() => {
            if (pairingStart) setPairingCandidate(null);
          }}
          onClick={event => {
            if (pairingStart && event.target === event.currentTarget) {
              setPairingStart(null);
              setPairingCandidate(null);
            }
          }}
          onKeyDown={event => {
            if (
              !timeline.onCreateExtractedFrameTransition ||
              !(
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              )
            )
              return;
            event.preventDefault();
            const rect = trackRef.current?.getBoundingClientRect();
            openAtMs(
              timeline.playheadMs,
              rect ? rect.left + rect.width / 2 : 0,
              rect ? rect.top + rect.height / 2 : 0
            );
          }}
        >
          {frames.length === 0 &&
          !shots.some(
            shot => (shot.timelineItem?.visualLayer ?? 0) === visualLayer
          ) ? (
            <span className="absolute inset-0 flex items-center px-2 text-[8px] text-muted-foreground/65">
              在剪辑条上右键，选择“抽帧”
            </span>
          ) : null}
          {shots
            .filter(
              shot => (shot.timelineItem?.visualLayer ?? 0) === visualLayer
            )
            .map(shot => {
              const leftPx = msToPx(viewport, shot.timing.startMs);
              const widthPx = msToPx(viewport, shot.timing.durationMs);
              return (
                <div
                  key={`upper-shot-${shot.stableShotId}`}
                  role="button"
                  tabIndex={0}
                  data-pointer-clip-move="true"
                  className="absolute bottom-1 top-1 z-[6] touch-none cursor-grab overflow-hidden rounded-sm border border-cyan-400/70 bg-cyan-500/25 px-1 text-left text-[8px] active:cursor-grabbing focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{
                    left: leftPx,
                    width: Math.max(widthPx, 1),
                    transform:
                      visibleClipPointerPreview?.kind === "shot" &&
                      visibleClipPointerPreview.id === shot.stableShotId
                        ? `translate(${visibleClipPointerPreview.deltaX}px, ${visibleClipPointerPreview.deltaY}px)`
                        : undefined,
                  }}
                  onPointerDown={event => {
                    onSelectVisualObject(
                      {
                        type: "story-shot",
                        stableShotId: shot.stableShotId,
                        shotNo: shot.shotNo,
                      },
                      event.currentTarget
                    );
                    startClipPointerDrag(event, {
                      kind: "shot",
                      stableShotId: shot.stableShotId,
                      startFrame: shot.timing.startFrame,
                      durationFrames: shot.timing.durationFrames,
                    });
                  }}
                  onPointerMove={moveClipPointerDrag}
                  onPointerUp={finishClipPointerDrag}
                  onPointerCancel={cancelClipPointerDrag}
                  onClick={event => {
                    if (consumeSuppressedClipClick()) return;
                    onSelectVisualObject(
                      {
                        type: "story-shot",
                        stableShotId: shot.stableShotId,
                        shotNo: shot.shotNo,
                      },
                      event.currentTarget
                    );
                  }}
                  onKeyDown={event => {
                    if (
                      storyboardVisualClipArrowMove({
                        event,
                        visualLayer,
                        onMove: (deltaFrames, deltaVisualLayers) => {
                          onNudgeVisualClip({
                            clipId: `shot:${shot.stableShotId}`,
                            startVisualLayer: visualLayer,
                            deltaVisualLayers,
                            startFrame: shot.timing.startFrame,
                            deltaFrames,
                          });
                        },
                      })
                    )
                      return;
                    if (
                      !(
                        event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10")
                      )
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectVisualObject(
                      {
                        type: "story-shot",
                        stableShotId: shot.stableShotId,
                        shotNo: shot.shotNo,
                      },
                      event.currentTarget
                    );
                    const rect = event.currentTarget.getBoundingClientRect();
                    onOpenMenu({
                      shot,
                      atMs: shot.timing.startMs,
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top + rect.height / 2,
                      magneticJoin: null,
                    });
                  }}
                  onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    timeline.onTogglePlay(false);
                    onSelectVisualObject(
                      {
                        type: "story-shot",
                        stableShotId: shot.stableShotId,
                        shotNo: shot.shotNo,
                      },
                      event.currentTarget
                    );
                    const rect = event.currentTarget.getBoundingClientRect();
                    const progress =
                      rect.width > 0
                        ? Math.max(
                            0,
                            Math.min(
                              1,
                              (event.clientX - rect.left) / rect.width
                            )
                          )
                        : 0;
                    onOpenMenu({
                      shot,
                      atMs:
                        shot.timing.startMs + progress * shot.timing.durationMs,
                      clientX: event.clientX,
                      clientY: event.clientY,
                      magneticJoin: null,
                    });
                  }}
                  data-visual-clip-move-target="true"
                  data-visual-object-type="story-shot"
                  data-visual-object-id={shot.stableShotId}
                  aria-selected={
                    selectedVisualObject?.type === "story-shot" &&
                    selectedVisualObject.stableShotId === shot.stableShotId
                  }
                  data-testid={`storyboard-visual-layer-shot-${visualLayer + 1}-${shot.stableShotId}`}
                  aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
                  aria-label={`${shot.shotLabel} 视频剪辑，方向键左右移动、上下换层，按住 Shift 加速`}
                  title={`${shot.shotLabel} · 方向键左右移动、上下换层，Shift+左右移动 15 帧 · 可继续切割`}
                >
                  <StoryboardEditFilmstrip
                    frameUrls={storyboardEditFilmstripFrameUrls({
                      source: shot.primaryFrameSource,
                      durationMs: shot.timing.durationMs,
                    })}
                    posterUrl={shot.posterUrl}
                    testId={`storyboard-upper-shot-filmstrip-${shot.stableShotId}`}
                  />
                  <span className="relative block truncate">
                    {shot.shotLabel}
                  </span>
                </div>
              );
            })}
          {shots.flatMap(shot =>
            (shot.timelineItem?.visualClips ?? [])
              .filter(
                clip => storyboardOwnedClipVisualLayer(clip) === visualLayer
              )
              .map(clip => (
                <StoryboardOwnedVideoClipBlock
                  key={`owned-video-${shot.stableShotId}-${clip.id}`}
                  shot={shot}
                  clip={clip}
                  visualLayer={visualLayer}
                  viewport={viewport}
                  timeline={timeline}
                  selectedVisualObject={selectedVisualObject}
                  onSelectVisualObject={onSelectVisualObject}
                  onNudgeVisualClip={onNudgeVisualClip}
                  onOpenObjectMenu={onOpenObjectMenu}
                />
              ))
          )}
          {frames.map(({ shot, clip, ...frame }) => {
            const leftPx = msToPx(viewport, frame.atMs);
            const active = Math.abs(timeline.playheadMs - frame.atMs) <= 50;
            return (
              <div
                key={`${shot.stableShotId}-${clip?.id ?? frame.id}-${visualLayer}`}
                role="button"
                tabIndex={0}
                data-pointer-clip-move={clip ? "true" : undefined}
                className={`absolute bottom-1 z-10 h-7 w-10 -translate-x-1/2 overflow-hidden rounded-sm border bg-background shadow-sm transition hover:z-20 hover:scale-105 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  clip
                    ? "touch-none cursor-grab active:cursor-grabbing"
                    : "cursor-pointer"
                } ${
                  active
                    ? "border-primary ring-1 ring-primary"
                    : "border-white/60"
                }`}
                style={{
                  left: leftPx,
                  transform:
                    visibleClipPointerPreview?.kind === "image" &&
                    visibleClipPointerPreview.id === clip?.id
                      ? `translate(calc(-50% + ${visibleClipPointerPreview.deltaX}px), ${visibleClipPointerPreview.deltaY}px)`
                      : undefined,
                }}
                onPointerDown={
                  clip
                    ? event => {
                        onSelectVisualObject(
                          {
                            type: "image-clip",
                            clipId: clip.id,
                            ownerStableShotId: shot.stableShotId,
                          },
                          event.currentTarget
                        );
                        startClipPointerDrag(event, {
                          kind: "image",
                          clipId: clip.id,
                          sourceStableShotId: shot.stableShotId,
                        });
                      }
                    : undefined
                }
                onPointerMove={clip ? moveClipPointerDrag : undefined}
                onPointerUp={clip ? finishClipPointerDrag : undefined}
                onPointerCancel={clip ? cancelClipPointerDrag : undefined}
                onClick={event => {
                  if (consumeSuppressedClipClick()) return;
                  if (pairingStart) {
                    if (pairingStart.id === frame.id) {
                      setPairingStart(null);
                      setPairingCandidate(null);
                      return;
                    }
                    const candidate = selectExtractedFrameCandidates({
                      frames,
                      start: pairingStart,
                    }).find(item => item.frame.id === frame.id);
                    if (candidate)
                      void finishPairing({
                        leftImageId: candidate.pair.left.imageId,
                        rightImageId: candidate.pair.right.imageId,
                      });
                    return;
                  }
                  onSelectVisualObject(
                    clip
                      ? {
                          type: "image-clip",
                          clipId: clip.id,
                          ownerStableShotId: shot.stableShotId,
                        }
                      : {
                          type: "story-shot",
                          stableShotId: shot.stableShotId,
                          shotNo: shot.shotNo,
                        },
                    event.currentTarget
                  );
                  timeline.onTogglePlay(false);
                  timeline.onSeek(frame.atMs);
                  startPairing({
                    id: frame.id,
                    imageId: frame.imageId,
                    atMs: frame.atMs,
                  });
                }}
                onContextMenu={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTransitionMenu(null);
                  setDeleteError(null);
                  onSelectVisualObject(
                    clip
                      ? {
                          type: "image-clip",
                          clipId: clip.id,
                          ownerStableShotId: shot.stableShotId,
                        }
                      : {
                          type: "story-shot",
                          stableShotId: shot.stableShotId,
                          shotNo: shot.shotNo,
                        },
                    event.currentTarget
                  );
                  if (clip) {
                    setFrameMenu(null);
                    onOpenObjectMenu({
                      object: {
                        type: "image-clip",
                        clipId: clip.id,
                        ownerStableShotId: shot.stableShotId,
                      },
                      clientX: event.clientX,
                      clientY: event.clientY,
                    });
                    return;
                  }
                  const overlappingFrames = frames.filter(candidate => {
                    if (totalMs <= 0) {
                      return candidate.imageId === frame.imageId;
                    }
                    return (
                      Math.abs(
                        msToPx(viewport, candidate.atMs) -
                          msToPx(viewport, frame.atMs)
                      ) < 38
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
                    clip &&
                    timeline.onMoveVisualClip &&
                    storyboardVisualClipArrowMove({
                      event,
                      visualLayer,
                      onMove: (deltaFrames, deltaVisualLayers) => {
                        onNudgeVisualClip({
                          clipId: `image:${clip.id}`,
                          startVisualLayer: visualLayer,
                          deltaVisualLayers,
                          startFrame: timelineImageClipStartFrame(
                            clip,
                            shot.timing.startFrame
                          ),
                          deltaFrames,
                        });
                      },
                    })
                  )
                    return;
                  if (
                    !(
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    )
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectVisualObject(
                    clip
                      ? {
                          type: "image-clip",
                          clipId: clip.id,
                          ownerStableShotId: shot.stableShotId,
                        }
                      : {
                          type: "story-shot",
                          stableShotId: shot.stableShotId,
                          shotNo: shot.shotNo,
                        },
                    event.currentTarget
                  );
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (clip) {
                    setFrameMenu(null);
                    onOpenObjectMenu({
                      object: {
                        type: "image-clip",
                        clipId: clip.id,
                        ownerStableShotId: shot.stableShotId,
                      },
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top + rect.height / 2,
                    });
                    return;
                  }
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
                data-visual-clip-move-target={clip ? "true" : undefined}
                data-visual-object-type={clip ? "image-clip" : undefined}
                data-visual-object-id={clip?.id}
                aria-selected={
                  clip
                    ? selectedVisualObject?.type === "image-clip" &&
                      selectedVisualObject.clipId === clip.id
                    : selectedVisualObject?.type === "story-shot" &&
                      selectedVisualObject.stableShotId === shot.stableShotId
                }
                aria-keyshortcuts={
                  clip
                    ? "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
                    : "Shift+F10 ContextMenu"
                }
                aria-label={`查看抽帧 ${shot.shotLabel} ${formatStoryboardTimestamp(frame.atMs)}${clip ? "，方向键左右移动、上下换层，按住 Shift 加速" : ""}`}
                title={`${shot.shotLabel} · 抽帧 ${formatStoryboardTimestamp(frame.atMs)} · 图片 #${frame.imageId}${clip ? " · 方向键左右移动、上下换层，Shift+左右移动 15 帧" : ""}`}
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
              </div>
            );
          })}
          {pairingStart && pairingCandidate?.kind === "ok" ? (
            <button
              type="button"
              aria-label={`选择候选抽帧 ${formatStoryboardTimestamp(pairingCandidate.candidate.atMs)}`}
              data-testid="storyboard-extracted-frame-pair-candidate"
              className="absolute z-[30] -translate-x-1/2 rounded-full border border-primary bg-primary p-1 text-primary-foreground shadow-lg"
              style={{
                left: msToPx(viewport, pairingCandidate.candidate.atMs),
                top: "0.1rem",
              }}
              onClick={event => {
                event.stopPropagation();
                void finishPairing({
                  leftImageId: pairingCandidate.pair.left.imageId,
                  rightImageId: pairingCandidate.pair.right.imageId,
                });
              }}
            >
              {pairingCandidate.candidate.atMs < pairingStart.atMs ? (
                <ArrowLeft className="h-3 w-3" />
              ) : (
                <ArrowRight className="h-3 w-3" />
              )}
            </button>
          ) : null}
          {visualLayer === 1
            ? (timeline.overlays ?? [])
                .filter(
                  overlay =>
                    !shots.some(
                      shot =>
                        shot.stableShotId === overlay.sourceStableShotId &&
                        (shot.timelineItem?.visualLayer ?? 0) > 0
                    )
                )
                .map(overlay => {
                  const leftPx = frameToPx(viewport, overlay.startFrame);
                  const mediaWidthPx = frameToPx(
                    viewport,
                    overlay.mediaEndFrame - overlay.startFrame
                  );
                  const gapWidthPx = frameToPx(
                    viewport,
                    overlay.endFrame - overlay.mediaEndFrame
                  );
                  return (
                    <div
                      key={overlay.id}
                      data-testid={`storyboard-overlay-${overlay.id}`}
                    >
                      <video
                        src={overlay.videoUrl}
                        muted
                        preload="metadata"
                        className="pointer-events-none absolute bottom-1 top-1 z-[5] rounded-sm border border-cyan-400/70 bg-black object-cover"
                        style={{
                          left: leftPx,
                          width: Math.max(mediaWidthPx, 1),
                        }}
                      />
                      {gapWidthPx > 0 ? (
                        <span
                          className="pointer-events-none absolute bottom-1 top-1 z-[4] border border-dashed border-cyan-500/50 bg-black"
                          style={{
                            left: leftPx + mediaWidthPx,
                            width: gapWidthPx,
                          }}
                          title="未生成区间 · 留空"
                        />
                      ) : null}
                    </div>
                  );
                })
            : null}
          {showTopPlayhead && playheadPx != null ? (
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
              style={{ left: playheadPx }}
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
            style={{
              left: transitionMenu.clientX,
              top: transitionMenu.clientY,
            }}
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
                disabled={
                  deletingImageId != null || !timeline.onDeleteExtractedFrame
                }
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-destructive transition enabled:hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`storyboard-extracted-frame-delete-action-${candidate.imageId}`}
                onClick={async () => {
                  if (
                    !timeline.onDeleteExtractedFrame ||
                    deletingImageId != null
                  )
                    return;
                  setDeletingImageId(candidate.imageId);
                  setDeleteError(null);
                  try {
                    const result = await timeline.onDeleteExtractedFrame(
                      candidate.imageId
                    );
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
              <p
                role="alert"
                className="max-w-52 px-2 py-1 text-[9px] text-destructive"
              >
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
  magneticJoin: StoryboardMagneticJoin | null;
};

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
  canExtractHere,
  canInsert,
  canDelete,
  anchorState,
  magneticJoin,
  pendingAction,
  writePending,
  onPick,
  onClose,
}: {
  menu: MenuState;
  shotCount: number;
  canSplitHere: boolean;
  canExtractHere: boolean;
  canInsert: boolean;
  canDelete: boolean;
  anchorState?: {
    inGap: boolean;
    alreadyAnchored: boolean;
    removableAnchorLabel: string | null;
  };
  magneticJoin: StoryboardMagneticJoin | null;
  pendingAction: StoryboardEditAction | null;
  writePending: boolean;
  onPick: (action: StoryboardEditAction) => void;
  onClose: () => void;
}) {
  const items = storyboardEditMenuItems({
    shotLabel: menu.shot.shotLabel,
    canSplitHere,
    canExtractHere,
    isFirst: menu.shot.timing.position === 0,
    isLast: menu.shot.timing.position === shotCount - 1,
    shotCount,
    canInsert,
    canDelete,
    anchors: anchorState,
    canDetachMagnet: magneticJoin != null,
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
          disabled={
            item.disabledReason != null || pendingAction != null || writePending
          }
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

const VISUAL_OBJECT_COMMAND_LABELS: Record<VisualObjectCommand, string> = {
  move: "移动（拖动或方向键）",
  split: "在这里切一刀",
  "extract-frame": "抽帧（存成画面）",
  chat: "交给聊聊",
  copy: "复制",
  delete: "删除",
  "generate-video": "用图片生成视频",
  "set-anchor": "设置位置锚点",
};

type VisualObjectMenuState = {
  object: VisualObjectRef;
  clientX: number;
  clientY: number;
};

function StoryboardVisualObjectMenu({
  menu,
  commandAvailable,
  pending,
  onPick,
  onClose,
}: {
  menu: VisualObjectMenuState;
  commandAvailable: boolean;
  pending: boolean;
  onPick: (command: VisualObjectCommand) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const capabilities = visualObjectCapabilities(menu.object);
  const focusable = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]'
      ) ?? []
    );
  useEffect(() => {
    focusable()[0]?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      className="fixed inset-0 z-[120]"
      onPointerDown={onClose}
      onContextMenu={event => event.preventDefault()}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${menu.object.type} 操作`}
        className="fixed min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl"
        style={{ left: menu.clientX, top: menu.clientY }}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => {
          const items = focusable();
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement
          );
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          const next = storyboardVisualObjectMenuFocusIndex({
            key: event.key,
            currentIndex: current,
            itemCount: items.length,
          });
          if (next == null) return;
          event.preventDefault();
          event.stopPropagation();
          items[next]?.focus({ preventScroll: true });
        }}
      >
        {capabilities.map(capability => {
          const unavailableReason =
            capability.command === "move"
              ? "请直接拖动素材或使用方向键"
              : !commandAvailable
                ? "该操作将在持久化命令接入后启用"
                : undefined;
          const disabled =
            pending || !capability.enabled || Boolean(unavailableReason);
          return (
            <button
              key={capability.command}
              type="button"
              role="menuitem"
              aria-disabled={disabled}
              tabIndex={-1}
              title={capability.disabledReason ?? unavailableReason}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs ${disabled ? "cursor-not-allowed opacity-45" : "hover:bg-muted"}`}
              onClick={() => {
                if (!disabled) onPick(capability.command);
              }}
            >
              <span>{VISUAL_OBJECT_COMMAND_LABELS[capability.command]}</span>
              {disabled ? (
                <span className="ml-3 text-[9px]">暂不可用</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StoryboardEditTrack({
  timeline,
  viewport,
  shots,
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
  disableGroupMove = false,
  onNudgeVisualClip,
  onShotTimingPreviewChange,
  selectedVisualObject,
  onSelectVisualObject,
  onOpenObjectMenu,
}: {
  timeline: StoryboardBoardTimeline;
  viewport: TimelineViewport;
  shots: readonly StoryboardEditShot[];
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
  disableGroupMove?: boolean;
  onNudgeVisualClip: (input: {
    clipId: string;
    startVisualLayer: number;
    deltaVisualLayers: number;
    startFrame: number;
    deltaFrames: number;
  }) => void;
  onShotTimingPreviewChange?: (
    preview: StoryboardShotTimingPreview | null,
    gestureId: symbol
  ) => void;
  selectedVisualObject: VisualObjectRef | null;
  onSelectVisualObject: (object: VisualObjectRef, target: HTMLElement) => void;
  onOpenObjectMenu: (menu: VisualObjectMenuState) => void;
}) {
  const dragAnchorMsRef = useRef<number | null>(null);
  const imagePointerDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startRectLeft: number;
    startLeftPx: number | null;
    viewport: TimelineViewport;
    moved: boolean;
    clipId: string;
    sourceStableShotId: string;
  } | null>(null);
  const suppressImageClickRef = useRef(false);
  const [imagePointerActive, setImagePointerActive] = useState(false);
  const trimStartRef = useRef<{
    clientX: number;
    baseDurationMs: number;
    maxDurationMs?: number;
    edge: "start" | "end";
    shotNo: number;
    stableShotId: string;
    startFrame: number;
    durationFrames: number;
    rollingJoin: StoryboardMagneticJoin | null;
    rollingLeftStartFrame: number | null;
    rollingRightEndFrame: number | null;
  } | null>(null);
  const [draftRange, setDraftRange] = useState<StoryboardEditRange | null>(
    null
  );
  const [draftTrim, setDraftTrim] = useState<{
    stableShotId: string;
    durationMs: number;
    edge: "start" | "end";
  } | null>(null);
  const [draftRollingJoin, setDraftRollingJoin] = useState<
    | (StoryboardMagneticJoin & {
        requestedBoundaryFrame: number;
        leftStartFrame: number;
        rightEndFrame: number;
      })
    | null
  >(null);
  const [dropTargetShotId, setDropTargetShotId] = useState<string | null>(null);
  const storyImageDrop = useStoryImageDrop();
  const groupDragRef = useRef<{
    clientX: number;
    stableShotId: string;
    direction: "left" | "right" | null;
    viewport: TimelineViewport;
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
    pointerId: number;
    gestureId: symbol;
    clientX: number;
    clientY: number;
    shotNo: number;
    stableShotId: string;
    startFrame: number;
    durationFrames: number;
    blockedReason: string | null;
    viewport: TimelineViewport;
  } | null>(null);
  // 松手后命令可能要等持久化返回；这段时间保留 ghost，避免界面先弹回原位。
  // lostpointercapture 会紧跟 releasePointerCapture 同步触发，不能把它清掉。
  const singleDragCommitPendingRef = useRef(false);
  const gripDragModeRef = useRef<"single" | "group" | null>(null);
  const [singleDrag, setSingleDrag] = useState<{
    stableShotId: string;
    deltaFrames: number;
    blockedReason: string | null;
  } | null>(null);

  const timings = shots.map(shot => shot.timing);
  // 整条片长按最大结束时间算：移动之后靠前的镜头完全可能结束得最晚。
  const totalMs = viewport.totalMs;
  const groupEnabled =
    !disableGroupMove &&
    Boolean(timeline.previewGroupMove && timeline.onMoveTimelineGroup);
  const singleMoveEnabled =
    !disableGroupMove && Boolean(timeline.onMoveVisualClip);
  const labelByShotId = new Map(
    shots.map(shot => [shot.stableShotId, shot.shotLabel] as const)
  );
  const anchors = [...(timeline.anchors ?? [])].sort(
    (left, right) =>
      left.timelineFrame - right.timelineFrame ||
      left.id.localeCompare(right.id)
  );

  const trackMsFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return storyboardEditTrackMs({
        clientX,
        trackLeft: rect.left,
        viewport,
      });
    },
    [trackRef, viewport]
  );

  const startImagePointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    clipId: string,
    sourceStableShotId: string
  ) => {
    if (event.button !== 0 || timeline.writePending) return;
    focusStoryboardClipForDrag(event.currentTarget);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressImageClickRef.current = false;
    imagePointerDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRectLeft: event.currentTarget.getBoundingClientRect().left,
      startLeftPx: clipAnchorPx(event.currentTarget),
      viewport,
      moved: false,
      clipId,
      sourceStableShotId,
    };
    setImagePointerActive(true);
  };
  const moveImagePointerDrag = (
    event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">
  ) => {
    const drag = imagePointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY
      ) >= 4
    ) {
      drag.moved = true;
      suppressImageClickRef.current = true;
    }
  };
  const finishImagePointerDragAt = (
    event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">
  ) => {
    const drag = imagePointerDragRef.current;
    if (!drag || !isStoryboardPointerOwner(drag.pointerId, event.pointerId))
      return;
    imagePointerDragRef.current = null;
    setImagePointerActive(false);
    if (!drag.moved) return;
    commitVisualClipDrag({
      clipId: `image:${drag.clipId}`,
      startRectLeft: drag.startRectLeft,
      startLeftPx: drag.startLeftPx,
      startClientX: drag.startClientX,
      releaseClientX: event.clientX,
      releaseClientY: event.clientY,
      viewport: drag.viewport,
      onMoveVisualClip: timeline.onMoveVisualClip,
    });
  };
  const finishImagePointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    // 先消费有效手势再释放 capture；lostpointercapture 可能同步触发，不能让它
    // 抢先清掉仍待提交的图片拖动。
    finishImagePointerDragAt(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const cancelImagePointerDrag = (event: Pick<PointerEvent, "pointerId">) => {
    const drag = imagePointerDragRef.current;
    if (!drag || !isStoryboardPointerOwner(drag.pointerId, event.pointerId))
      return;
    imagePointerDragRef.current = null;
    suppressImageClickRef.current = false;
    setImagePointerActive(false);
  };
  useWindowPointerContinuation({
    active: imagePointerActive,
    onMove: moveImagePointerDrag,
    onFinish: finishImagePointerDragAt,
    onCancel: cancelImagePointerDrag,
  });

  const blocks = storyboardEditBlocks(timings, viewport);
  const activeRange = draftRange ?? timeline.selectedRange;
  const highlight = activeRange
    ? storyboardEditRangePx(activeRange, viewport)
    : null;
  const playheadPx = storyboardEditPlayheadPx(timeline.playheadMs, viewport);
  const markInPx =
    markInMs == null ? null : storyboardEditPlayheadPx(markInMs, viewport);

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
    if (event.button !== 0 || timeline.writePending) return;
    event.preventDefault();
    event.stopPropagation();
    if (!trackRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    const rollingJoin = timeline.onRollTimelineJoin
      ? ((timeline.magneticJoins ?? []).find(join =>
          edge === "end"
            ? join.leftStableShotId === shot.stableShotId
            : join.rightStableShotId === shot.stableShotId
        ) ?? null)
      : null;
    const rollingLeft = rollingJoin
      ? shots.find(item => item.stableShotId === rollingJoin.leftStableShotId)
      : null;
    const rollingRight = rollingJoin
      ? shots.find(item => item.stableShotId === rollingJoin.rightStableShotId)
      : null;
    trimStartRef.current = {
      clientX: event.clientX,
      baseDurationMs: shot.timing.durationMs,
      maxDurationMs: edge === "start" ? shot.timing.endMs : undefined,
      edge,
      shotNo: shot.shotNo,
      stableShotId: shot.stableShotId,
      startFrame: shot.timing.startFrame,
      durationFrames: shot.timing.durationFrames,
      rollingJoin,
      rollingLeftStartFrame: rollingLeft?.timing.startFrame ?? null,
      rollingRightEndFrame:
        rollingRight == null
          ? null
          : rollingRight.timing.startFrame + rollingRight.timing.durationFrames,
    };
    if (rollingJoin && rollingLeft && rollingRight) {
      setDraftTrim(null);
      setDraftRollingJoin({
        ...rollingJoin,
        requestedBoundaryFrame: rollingJoin.boundaryFrame,
        leftStartFrame: rollingLeft.timing.startFrame,
        rightEndFrame:
          rollingRight.timing.startFrame + rollingRight.timing.durationFrames,
      });
    } else {
      setDraftRollingJoin(null);
      setDraftTrim({
        stableShotId: shot.stableShotId,
        durationMs: shot.timing.durationMs,
        edge,
      });
    }
  };

  const moveTrim = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = trimStartRef.current;
    if (!start) return;
    if (
      start.rollingJoin &&
      start.rollingLeftStartFrame != null &&
      start.rollingRightEndFrame != null
    ) {
      setDraftRollingJoin({
        ...start.rollingJoin,
        requestedBoundaryFrame: storyboardRollingBoundaryFrame({
          baseBoundaryFrame: start.rollingJoin.boundaryFrame,
          leftStartFrame: start.rollingLeftStartFrame,
          rightEndFrame: start.rollingRightEndFrame,
          startClientX: start.clientX,
          currentClientX: event.clientX,
          viewport,
        }),
        leftStartFrame: start.rollingLeftStartFrame,
        rightEndFrame: start.rollingRightEndFrame,
      });
      return;
    }
    setDraftTrim({
      stableShotId: start.stableShotId,
      durationMs: storyboardTrimmedDurationMs({
        baseDurationMs: start.baseDurationMs,
        viewport,
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
    const trim =
      start && !start.rollingJoin
        ? {
            stableShotId: start.stableShotId,
            durationMs: storyboardTrimmedDurationMs({
              baseDurationMs: start.baseDurationMs,
              viewport,
              deltaPx: event.clientX - start.clientX,
              edge: start.edge,
              maxDurationMs: start.maxDurationMs,
            }),
            edge: start.edge,
          }
        : draftTrim;
    const rolling =
      start?.rollingJoin &&
      start.rollingLeftStartFrame != null &&
      start.rollingRightEndFrame != null
        ? {
            ...start.rollingJoin,
            requestedBoundaryFrame: storyboardRollingBoundaryFrame({
              baseBoundaryFrame: start.rollingJoin.boundaryFrame,
              leftStartFrame: start.rollingLeftStartFrame,
              rightEndFrame: start.rollingRightEndFrame,
              startClientX: start.clientX,
              currentClientX: event.clientX,
              viewport,
            }),
            leftStartFrame: start.rollingLeftStartFrame,
            rightEndFrame: start.rollingRightEndFrame,
          }
        : draftRollingJoin;
    if (
      start?.rollingJoin &&
      rolling &&
      rolling.requestedBoundaryFrame !== start.rollingJoin.boundaryFrame
    ) {
      try {
        const result = await timeline.onRollTimelineJoin?.({
          leftStableShotId: rolling.leftStableShotId,
          rightStableShotId: rolling.rightStableShotId,
          boundaryFrame: rolling.boundaryFrame,
          requestedBoundaryFrame: rolling.requestedBoundaryFrame,
        });
        if (result && !result.applied && result.reason) {
          onStatusMessage(result.reason);
        }
      } finally {
        setDraftRollingJoin(null);
      }
      return;
    }
    if (!start || !trim || trim.durationMs === start.baseDurationMs) {
      setDraftTrim(null);
      setDraftRollingJoin(null);
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
      setDraftRollingJoin(null);
    }
  };

  const cancelTrim = () => {
    trimStartRef.current = null;
    setDraftTrim(null);
    setDraftRollingJoin(null);
  };

  const clearGroupDrag = useCallback(() => {
    groupDragRef.current = null;
    setGroupDrag(null);
  }, []);

  const startGroupDrag = (
    event: ReactPointerEvent<HTMLElement>,
    shot: StoryboardEditShot
  ) => {
    if (event.button !== 0 || !groupEnabled || timeline.writePending) return;
    event.preventDefault();
    event.stopPropagation();
    if (!trackRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    // 上一条结果不能盖住这次手势的反馈——尤其是「这一镜锁住了」这种拒绝原因。
    onStatusMessage(null);
    groupDragRef.current = {
      clientX: event.clientX,
      stableShotId: shot.stableShotId,
      direction: null,
      viewport,
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
      viewport: start.viewport,
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
          viewport: start.viewport,
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
    if (singleDragCommitPendingRef.current) return;
    const drag = singleDragRef.current;
    singleDragRef.current = null;
    setSingleDrag(null);
    if (drag) onShotTimingPreviewChange?.(null, drag.gestureId);
  }, [onShotTimingPreviewChange]);
  const clearSingleDragForPointer = useCallback(
    (pointerId: number) => {
      const start = singleDragRef.current;
      if (start && isStoryboardPointerOwner(start.pointerId, pointerId)) {
        clearSingleDrag();
      }
    },
    [clearSingleDrag]
  );

  const startSingleDrag = (
    event: ReactPointerEvent<HTMLElement>,
    shot: StoryboardEditShot
  ) => {
    if (
      event.button !== 0 ||
      !singleMoveEnabled ||
      timeline.writePending ||
      singleDragCommitPendingRef.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!trackRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    timeline.onTogglePlay(false);
    onStatusMessage(null);
    const blockedReason =
      shot.timing.anchorFrames.length > 0
        ? "这一镜已有位置锚点，不能移动"
        : null;
    singleDragRef.current = {
      pointerId: event.pointerId,
      gestureId: Symbol("main-shot-drag"),
      clientX: event.clientX,
      clientY: event.clientY,
      shotNo: shot.shotNo,
      stableShotId: shot.stableShotId,
      startFrame: shot.timing.startFrame,
      durationFrames: shot.timing.durationFrames,
      blockedReason,
      viewport,
    };
    setSingleDrag({
      stableShotId: shot.stableShotId,
      deltaFrames: 0,
      // 锚定的这一镜不能移动；这里立刻给出理由，不用等松手才告诉用户。
      blockedReason,
    });
  };

  const moveSingleDrag = (
    event: Pick<PointerEvent, "pointerId" | "clientX">
  ) => {
    const start = singleDragRef.current;
    if (!start || !isStoryboardPointerOwner(start.pointerId, event.pointerId))
      return;
    const deltaFrames = storyboardGroupDragDeltaFrames({
      deltaPx: event.clientX - start.clientX,
      viewport: start.viewport,
    });
    setSingleDrag(current =>
      current == null || current.deltaFrames === deltaFrames
        ? current
        : { ...current, deltaFrames }
    );
    onShotTimingPreviewChange?.(
      start.blockedReason || deltaFrames === 0
        ? null
        : storyboardVisualClipShotTimingPreview({
            kind: "shot",
            stableShotId: start.stableShotId,
            startFrame: start.startFrame,
            durationFrames: start.durationFrames,
            deltaFrames,
          }),
      start.gestureId
    );
  };

  const endSingleDragAt = async (
    event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">
  ) => {
    const start = singleDragRef.current;
    if (!start || !isStoryboardPointerOwner(start.pointerId, event.pointerId))
      return;
    singleDragRef.current = null;
    if (!isStoryboardClipPointerDrag(start, event)) {
      setSingleDrag(null);
      onShotTimingPreviewChange?.(null, start.gestureId);
      // 点击才选择；拖动不能触发分镜列展开与自动横滚。
      onSelectShot(start.shotNo);
      return;
    }
    const releaseDeltaFrames = storyboardGroupDragDeltaFrames({
      deltaPx: event.clientX - start.clientX,
      viewport: start.viewport,
    });
    // pointerup 可能早于最后一个 pointermove；以真实释放点固定最终 ghost。
    setSingleDrag(current => ({
      stableShotId: start.stableShotId,
      deltaFrames: releaseDeltaFrames,
      blockedReason: current?.blockedReason ?? null,
    }));
    onShotTimingPreviewChange?.(
      start.blockedReason || releaseDeltaFrames === 0
        ? null
        : storyboardVisualClipShotTimingPreview({
            kind: "shot",
            stableShotId: start.stableShotId,
            startFrame: start.startFrame,
            durationFrames: start.durationFrames,
            deltaFrames: releaseDeltaFrames,
          }),
      start.gestureId
    );
    singleDragCommitPendingRef.current = true;
    const sourceTiming = timings.find(
      timing => timing.stableShotId === start.stableShotId
    );
    try {
      await commitVisualClipDrag({
        clipId: `shot:${start.stableShotId}`,
        // 镜头块渲染在绝对时间像素上，用它当锚点就能保住抓取点。
        startLeftPx: sourceTiming
          ? msToPx(start.viewport, sourceTiming.startMs)
          : null,
        startRectLeft: 0,
        startClientX: start.clientX,
        releaseClientX: event.clientX,
        releaseClientY: event.clientY,
        viewport: start.viewport,
        onMoveVisualClip: timeline.onMoveVisualClip,
        // 松手落在所有轨道之外时保持在主轨，等同于以前的纯横移。
        resolveTrack: (clientX, clientY) =>
          storyboardVisualLayerAtDocumentPoint(clientX, clientY) ??
          storyboardVisualLayerTrackGeometry(0),
      });
    } finally {
      singleDragCommitPendingRef.current = false;
      setSingleDrag(null);
      onShotTimingPreviewChange?.(null, start.gestureId);
    }
  };
  const endSingleDrag = async (event: ReactPointerEvent<HTMLElement>) => {
    // Read and clear the drag synchronously before releasing capture. React's
    // lostpointercapture handler is allowed to fire immediately and otherwise
    // clears singleDragRef before the move can be committed.
    const pendingMove = endSingleDragAt(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    await pendingMove;
  };
  useWindowPointerContinuation({
    active: singleDrag != null,
    onMove: moveSingleDrag,
    onFinish: event => void endSingleDragAt(event),
    onCancel: event => {
      clearSingleDragForPointer(event.pointerId);
    },
  });

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

  const clearGripDrag = useCallback(
    (pointerId?: number) => {
      const mode = gripDragModeRef.current;
      if (
        mode === "single" &&
        pointerId != null &&
        singleDragRef.current &&
        !isStoryboardPointerOwner(singleDragRef.current.pointerId, pointerId)
      ) {
        return;
      }
      gripDragModeRef.current = null;
      if (mode === "group") clearGroupDrag();
      if (mode === "single") clearSingleDrag();
    },
    [clearGroupDrag, clearSingleDrag]
  );

  const startGripDrag = (
    event: ReactPointerEvent<HTMLElement>,
    shot: StoryboardEditShot
  ) => {
    // 抓手的日常动作必须与用户选中的对象一致：默认只动这一镜。
    // 批量移动保留为明确的 Shift 修饰手势，避免一次普通拖动带走整串。
    const mode = storyboardGripDragMode({
      shiftKey: event.shiftKey,
      singleMoveEnabled,
      groupMoveEnabled: groupEnabled,
    });
    gripDragModeRef.current = mode;
    if (mode === "group") {
      startGroupDrag(event, shot);
      return;
    }
    if (mode === "single") {
      startSingleDrag(event, shot);
    }
  };

  const moveGripDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (gripDragModeRef.current === "group") moveGroupDrag(event);
    if (gripDragModeRef.current === "single") moveSingleDrag(event);
  };

  const endGripDrag = async (event: ReactPointerEvent<HTMLElement>) => {
    const mode = gripDragModeRef.current;
    gripDragModeRef.current = null;
    if (mode === "group") await endGroupDrag(event);
    if (mode === "single") await endSingleDrag(event);
  };

  const groupGhostShotIds =
    groupDrag?.direction && groupDrag.deltaFrames !== 0
      ? groupDrag.stableShotIds
      : [];
  const groupDeltaPx = groupDrag
    ? frameDeltaToPx(viewport, groupDrag.deltaFrames)
    : 0;
  const mainImageClips = shots.flatMap(shot =>
    (shot.timelineItem?.imageClips ?? [])
      .filter(clip => clip.visualLayer === 0)
      .map(clip => ({
        shot,
        clip,
        atMs:
          (timelineImageClipStartFrame(clip, shot.timing.startFrame) * 1000) /
          30,
      }))
  );

  return (
    <div
      className="relative min-w-0 border-b border-r py-2"
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
            ? "剪辑时间条，拖动镜头或六点抓手只移动这一镜，按住 Shift 拖六点抓手才整体移动连续镜头，按住 Shift 拖镜头画面则选中一段交给聊聊，右键出剪辑菜单"
            : "剪辑时间条，拖动选中一段交给聊聊，右键出剪辑菜单"
        }
        aria-keyshortcuts="Space ArrowLeft ArrowRight ArrowUp ArrowDown S F X I O Delete"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs)}
        aria-valuenow={Math.round(timeline.playheadMs)}
        aria-valuetext={formatStoryboardTimestamp(timeline.playheadMs)}
        data-testid="storyboard-edit-track"
        data-storyboard-visual-layer={0}
        className="relative h-18 w-full cursor-text touch-none rounded-sm border border-border/70 bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        onPointerDown={startRangeDrag}
        onPointerMove={moveRangeDrag}
        onPointerUp={endRangeDrag}
        onPointerCancel={endRangeDrag}
        onDragOver={event => {
          if (
            timeline.onPlaceExternalVisual &&
            hasExternalVisualPayload(event.dataTransfer)
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            return;
          }
          if (
            !event.dataTransfer.types.includes(SHOT_DRAG_MIME) &&
            !event.dataTransfer.types.includes(IMAGE_CLIP_DRAG_MIME) &&
            !event.dataTransfer.types.includes(VIDEO_CLIP_DRAG_MIME)
          )
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={event => {
          if (
            timeline.onPlaceExternalVisual &&
            hasExternalVisualPayload(event.dataTransfer)
          ) {
            event.preventDefault();
            event.stopPropagation();
            const atMs = trackMsFromPointer(event.clientX);
            void timeline
              .onPlaceExternalVisual(
                event.dataTransfer,
                Math.round((atMs * 30) / 1000),
                0
              )
              .then(result => onSelectShot(result.shotNo))
              .catch(error =>
                toast.error(
                  error instanceof Error ? error.message : "素材落位失败"
                )
              );
            return;
          }
          const imagePayload = event.dataTransfer.getData(IMAGE_CLIP_DRAG_MIME);
          if (imagePayload && timeline.onMoveVisualClip) {
            const atMs = trackMsFromPointer(event.clientX);
            event.preventDefault();
            event.stopPropagation();
            const parsed = JSON.parse(imagePayload) as { clipId: string };
            submitVisualClipMove({
              clipId: `image:${parsed.clipId}`,
              visualLayer: 0,
              toStartFrame: Math.round((Math.max(0, atMs) * 30) / 1000),
              onMoveVisualClip: timeline.onMoveVisualClip,
            });
            return;
          }
          const sourceStableShotId = event.dataTransfer.getData(SHOT_DRAG_MIME);
          const videoPayload = event.dataTransfer.getData(VIDEO_CLIP_DRAG_MIME);
          if (videoPayload && timeline.onMoveVisualClip) {
            const atMs = trackMsFromPointer(event.clientX);
            event.preventDefault();
            event.stopPropagation();
            const parsed = JSON.parse(videoPayload) as { clipId: string };
            submitVisualClipMove({
              clipId: `video:${parsed.clipId}`,
              visualLayer: 0,
              toStartFrame: Math.round((Math.max(0, atMs) * 30) / 1000),
              onMoveVisualClip: timeline.onMoveVisualClip,
            });
            return;
          }
          const sourceShot = shots.find(
            shot => shot.stableShotId === sourceStableShotId
          );
          if (!sourceShot || !timeline.onMoveVisualClip) return;
          event.preventDefault();
          event.stopPropagation();
          const targetMs = trackMsFromPointer(event.clientX);
          submitVisualClipMove({
            clipId: `shot:${sourceStableShotId}`,
            visualLayer: 0,
            toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
            onMoveVisualClip: timeline.onMoveVisualClip,
          });
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
        {mainImageClips.map(({ shot, clip, atMs }) => {
          const leftPx = msToPx(viewport, atMs);
          return (
            <div
              key={clip.id}
              role="button"
              tabIndex={0}
              data-pointer-clip-move="true"
              className="absolute bottom-1 top-5 z-[25] w-10 -translate-x-1/2 touch-none cursor-grab overflow-hidden rounded-sm border border-sky-400 bg-background shadow-sm active:cursor-grabbing focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{ left: leftPx }}
              onPointerDown={event => {
                onSelectVisualObject(
                  {
                    type: "image-clip",
                    clipId: clip.id,
                    ownerStableShotId: shot.stableShotId,
                  },
                  event.currentTarget
                );
                startImagePointerDrag(event, clip.id, shot.stableShotId);
              }}
              onPointerMove={moveImagePointerDrag}
              onPointerUp={finishImagePointerDrag}
              onPointerCancel={cancelImagePointerDrag}
              onClick={event => {
                if (suppressImageClickRef.current) {
                  suppressImageClickRef.current = false;
                  return;
                }
                event.stopPropagation();
                onSelectVisualObject(
                  {
                    type: "image-clip",
                    clipId: clip.id,
                    ownerStableShotId: shot.stableShotId,
                  },
                  event.currentTarget
                );
                timeline.onSeek(atMs);
              }}
              onKeyDown={event => {
                if (
                  storyboardVisualClipArrowMove({
                    event,
                    visualLayer: 0,
                    onMove: (deltaFrames, deltaVisualLayers) => {
                      onNudgeVisualClip({
                        clipId: `image:${clip.id}`,
                        startVisualLayer: 0,
                        deltaVisualLayers,
                        startFrame: timelineImageClipStartFrame(
                          clip,
                          shot.timing.startFrame
                        ),
                        deltaFrames,
                      });
                    },
                  })
                )
                  return;
                if (
                  !(
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  )
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                onSelectVisualObject(
                  {
                    type: "image-clip",
                    clipId: clip.id,
                    ownerStableShotId: shot.stableShotId,
                  },
                  event.currentTarget
                );
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenObjectMenu({
                  object: {
                    type: "image-clip",
                    clipId: clip.id,
                    ownerStableShotId: shot.stableShotId,
                  },
                  clientX: rect.left + rect.width / 2,
                  clientY: rect.top + rect.height / 2,
                });
              }}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                onSelectVisualObject(
                  {
                    type: "image-clip",
                    clipId: clip.id,
                    ownerStableShotId: shot.stableShotId,
                  },
                  event.currentTarget
                );
                onOpenObjectMenu({
                  object: {
                    type: "image-clip",
                    clipId: clip.id,
                    ownerStableShotId: shot.stableShotId,
                  },
                  clientX: event.clientX,
                  clientY: event.clientY,
                });
              }}
              data-visual-clip-move-target="true"
              data-visual-object-type="image-clip"
              data-visual-object-id={clip.id}
              aria-selected={
                selectedVisualObject?.type === "image-clip" &&
                selectedVisualObject.clipId === clip.id
              }
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
              aria-label={`${clip.label}，图片`}
              title={`${clip.label} · 方向键左右移动、上下换层，Shift+左右移动 15 帧`}
              data-testid={`storyboard-main-image-clip-${clip.imageId}`}
            >
              <img
                src={clip.imageUrl}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
            </div>
          );
        })}
        {blocks.map(({ timing, leftPx, widthPx }) => {
          if (excludedShotIds?.has(timing.stableShotId)) return null;
          const shot = shots.find(
            item => item.stableShotId === timing.stableShotId
          );
          if (!shot) return null;
          const selected =
            selectedVisualObject?.type === "story-shot" &&
            selectedVisualObject.stableShotId === shot.stableShotId;
          const trimming =
            draftTrim?.stableShotId === shot.stableShotId ? draftTrim : null;
          const rollingSide =
            draftRollingJoin?.leftStableShotId === shot.stableShotId
              ? "left"
              : draftRollingJoin?.rightStableShotId === shot.stableShotId
                ? "right"
                : null;
          const rollingDurationFrames =
            rollingSide === "left" && draftRollingJoin
              ? draftRollingJoin.requestedBoundaryFrame -
                draftRollingJoin.leftStartFrame
              : rollingSide === "right" && draftRollingJoin
                ? draftRollingJoin.rightEndFrame -
                  draftRollingJoin.requestedBoundaryFrame
                : null;
          const durationMs =
            rollingDurationFrames == null
              ? (trimming?.durationMs ?? timing.durationMs)
              : (rollingDurationFrames * 1000) / 30;
          const drawnWidthPx = msToPx(viewport, durationMs);
          const drawnLeftPx =
            rollingSide === "right" && draftRollingJoin
              ? frameToPx(viewport, draftRollingJoin.requestedBoundaryFrame)
              : trimming?.edge === "start"
                ? leftPx + widthPx - drawnWidthPx
                : leftPx;
          const segments = storyboardEditSegments({
            durationMs,
            label: shot.shotLabel,
            visualClips: (shot.timelineItem?.visualClips ?? []).filter(
              clip => storyboardOwnedClipVisualLayer(clip) === 0
            ),
            visualClipsReplacePrimary:
              shot.timelineItem?.visualClipsReplacePrimary,
          });
          return (
            <div
              key={timing.stableShotId}
              tabIndex={0}
              className={`absolute bottom-0.5 top-4 overflow-visible rounded-[2px] border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                selected
                  ? "z-20 border-primary ring-1 ring-primary"
                  : "z-10 border-white/40"
              } ${
                dropTargetShotId === shot.stableShotId
                  ? "outline-dashed outline-2 outline-primary"
                  : ""
              }`}
              style={{ left: drawnLeftPx, width: drawnWidthPx }}
              title={
                singleMoveEnabled
                  ? `${shot.shotLabel} · ${formatStoryboardTimestamp(timing.startMs)} · ${(durationMs / 1000).toFixed(1)}s · 方向键左右移动、上下换层，Shift+左右移动 15 帧 · 拖动或六点抓手只移动这一镜 · ⇧拖六点抓手才整体移动 · ⇧拖画面改选一段 · 右键出剪辑菜单`
                  : `${shot.shotLabel} · ${formatStoryboardTimestamp(timing.startMs)} · ${(durationMs / 1000).toFixed(1)}s · 右键出剪辑菜单`
              }
              data-visual-clip-move-target="true"
              data-visual-object-type="story-shot"
              data-visual-object-id={shot.stableShotId}
              aria-selected={selected}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
              aria-label={`${shot.shotLabel} 视频剪辑，方向键左右移动、上下换层，按住 Shift 加速`}
              data-testid={`storyboard-edit-block-${shot.stableShotId}`}
              data-storyboard-edit-shot-no={shot.shotNo}
              // 抓住镜头本身只移动它自己——和主流剪辑软件一致。要整体移动一串
              // 连续镜头，用选中后出现的六点抓手。按住 ⇧ 才是拉选区。
              onPointerDown={event => {
                if (
                  !singleMoveEnabled ||
                  event.shiftKey ||
                  event.button !== 0
                ) {
                  return;
                }
                onSelectVisualObject(
                  {
                    type: "story-shot",
                    stableShotId: shot.stableShotId,
                    shotNo: shot.shotNo,
                  },
                  event.currentTarget
                );
                focusStoryboardClipForDrag(event.currentTarget);
                startSingleDrag(event, shot);
              }}
              onPointerMove={singleMoveEnabled ? moveSingleDrag : undefined}
              onPointerUp={
                singleMoveEnabled
                  ? event => void endSingleDrag(event)
                  : undefined
              }
              onPointerCancel={
                singleMoveEnabled
                  ? event => clearSingleDragForPointer(event.pointerId)
                  : undefined
              }
              onLostPointerCapture={
                singleMoveEnabled
                  ? event => clearSingleDragForPointer(event.pointerId)
                  : undefined
              }
              onKeyDown={event => {
                if (
                  storyboardVisualClipArrowMove({
                    event,
                    visualLayer: 0,
                    onMove: (deltaFrames, deltaVisualLayers) => {
                      onNudgeVisualClip({
                        clipId: `shot:${shot.stableShotId}`,
                        startVisualLayer: 0,
                        deltaVisualLayers,
                        startFrame: shot.timing.startFrame,
                        deltaFrames,
                      });
                    },
                  })
                )
                  return;
                if (
                  !(
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  )
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                timeline.onTogglePlay(false);
                onSelectVisualObject(
                  {
                    type: "story-shot",
                    stableShotId: shot.stableShotId,
                    shotNo: shot.shotNo,
                  },
                  event.currentTarget
                );
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenMenu({
                  shot,
                  atMs: shot.timing.startMs,
                  clientX: rect.left + rect.width / 2,
                  clientY: rect.top + rect.height / 2,
                  magneticJoin: null,
                });
              }}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                trackRef.current?.focus();
                timeline.onTogglePlay(false);
                onSelectVisualObject(
                  {
                    type: "story-shot",
                    stableShotId: shot.stableShotId,
                    shotNo: shot.shotNo,
                  },
                  event.currentTarget
                );
                const atMs = trackMsFromPointer(event.clientX);
                const atFrame = Math.round((atMs * 30) / 1000);
                const thresholdFrames = storyboardMagnetThresholdFrames({
                  viewport,
                });
                const magneticJoin =
                  (timeline.magneticJoins ?? []).find(
                    join =>
                      (join.leftStableShotId === shot.stableShotId ||
                        join.rightStableShotId === shot.stableShotId) &&
                      Math.abs(join.boundaryFrame - atFrame) <= thresholdFrames
                  ) ?? null;
                onOpenMenu({
                  shot,
                  atMs,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  magneticJoin,
                });
              }}
              onDragOver={event => {
                if (
                  timeline.onPlaceExternalVisual &&
                  hasExternalVisualPayload(event.dataTransfer)
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropTargetShotId(shot.stableShotId);
                  return;
                }
                // 兼容没有接统一落位接口的独立渲染调用点。
                if (storyImageDrop.accepts(event.dataTransfer)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropTargetShotId(shot.stableShotId);
                  return;
                }
                if (!event.dataTransfer.types.includes(SHOT_DRAG_MIME)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetShotId(shot.stableShotId);
              }}
              onDragLeave={() => setDropTargetShotId(null)}
              onDrop={event => {
                setDropTargetShotId(null);
                if (
                  timeline.onPlaceExternalVisual &&
                  hasExternalVisualPayload(event.dataTransfer)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  const atMs = trackMsFromPointer(event.clientX);
                  void timeline
                    .onPlaceExternalVisual(
                      event.dataTransfer,
                      Math.round((atMs * 30) / 1000),
                      0
                    )
                    .then(result => onSelectShot(result.shotNo))
                    .catch(error =>
                      toast.error(
                        error instanceof Error ? error.message : "素材落位失败"
                      )
                    );
                  return;
                }
                if (storyImageDrop.accepts(event.dataTransfer)) {
                  event.preventDefault();
                  event.stopPropagation();
                  void storyImageDrop.drop(event.dataTransfer, {
                    kind: "shot",
                    stableShotId: shot.stableShotId,
                  });
                  return;
                }
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
                const segmentDurationMs = durationMs * (segment.widthPct / 100);
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
                    {segment.clip ? (
                      <button
                        type="button"
                        className="absolute inset-0 z-10 min-w-6 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        data-visual-object-type="owned-video-clip"
                        data-visual-object-id={segment.clip.id}
                        aria-selected={
                          selectedVisualObject?.type === "owned-video-clip" &&
                          selectedVisualObject.clipId === segment.clip.id
                        }
                        aria-label={`${segment.clip.label}，视频片段`}
                        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
                        data-visual-clip-move-target="true"
                        onPointerDown={event => {
                          event.stopPropagation();
                          onSelectVisualObject(
                            {
                              type: "owned-video-clip",
                              clipId: segment.clip!.id,
                              ownerStableShotId: shot.stableShotId,
                            },
                            event.currentTarget
                          );
                        }}
                        draggable={Boolean(timeline.onMoveVisualClip)}
                        onDragStart={event => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            VIDEO_CLIP_DRAG_MIME,
                            JSON.stringify({ clipId: segment.clip!.id })
                          );
                        }}
                        onClick={event => {
                          event.stopPropagation();
                          timeline.onTogglePlay(false);
                          onSelectVisualObject(
                            {
                              type: "owned-video-clip",
                              clipId: segment.clip!.id,
                              ownerStableShotId: shot.stableShotId,
                            },
                            event.currentTarget
                          );
                        }}
                        onContextMenu={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectVisualObject(
                            {
                              type: "owned-video-clip",
                              clipId: segment.clip!.id,
                              ownerStableShotId: shot.stableShotId,
                            },
                            event.currentTarget
                          );
                          onOpenObjectMenu({
                            object: {
                              type: "owned-video-clip",
                              clipId: segment.clip!.id,
                              ownerStableShotId: shot.stableShotId,
                            },
                            clientX: event.clientX,
                            clientY: event.clientY,
                          });
                        }}
                        onKeyDown={event => {
                          if (
                            storyboardVisualClipArrowMove({
                              event,
                              visualLayer: 0,
                              onMove: (deltaFrames, deltaVisualLayers) => {
                                onNudgeVisualClip({
                                  clipId: `video:${segment.clip!.id}`,
                                  startVisualLayer: 0,
                                  deltaVisualLayers,
                                  startFrame:
                                    shot.timing.startFrame +
                                    Math.round(
                                      ((segment.clip!.offsetMs ?? 0) * 30) /
                                        1000
                                    ),
                                  deltaFrames,
                                });
                              },
                            })
                          )
                            return;
                          if (
                            !(
                              event.key === "ContextMenu" ||
                              (event.shiftKey && event.key === "F10")
                            )
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectVisualObject(
                            {
                              type: "owned-video-clip",
                              clipId: segment.clip!.id,
                              ownerStableShotId: shot.stableShotId,
                            },
                            event.currentTarget
                          );
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          onOpenObjectMenu({
                            object: {
                              type: "owned-video-clip",
                              clipId: segment.clip!.id,
                              ownerStableShotId: shot.stableShotId,
                            },
                            clientX: rect.left + rect.width / 2,
                            clientY: rect.top + rect.height / 2,
                          });
                        }}
                      />
                    ) : null}
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
                    onPointerCancel={cancelTrim}
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
                    onPointerDown={event => startGripDrag(event, shot)}
                    onPointerMove={
                      groupEnabled || singleMoveEnabled
                        ? moveGripDrag
                        : undefined
                    }
                    onPointerUp={
                      groupEnabled || singleMoveEnabled
                        ? event => void endGripDrag(event)
                        : undefined
                    }
                    onPointerCancel={
                      groupEnabled || singleMoveEnabled
                        ? event => clearGripDrag(event.pointerId)
                        : undefined
                    }
                    onLostPointerCapture={
                      groupEnabled || singleMoveEnabled
                        ? event => clearGripDrag(event.pointerId)
                        : undefined
                    }
                    disabled={timeline.writePending === true}
                    className="absolute -top-4 left-1/2 z-30 flex h-4 w-8 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-t-sm bg-primary/70 text-[var(--background)] shadow-sm active:cursor-grabbing disabled:cursor-wait"
                    aria-label={
                      singleMoveEnabled
                        ? `拖动只移动 ${shot.shotLabel}；按住 Shift 拖动才整体移动连续镜头；改顺序用 ⌥← / ⌥→ 或右键菜单`
                        : groupEnabled
                          ? `拖动 ${shot.shotLabel} 整体移动它和同侧连续的镜头；改顺序用 ⌥← / ⌥→ 或右键菜单`
                          : `拖动 ${shot.shotLabel} 调整镜头顺序`
                    }
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    title={
                      singleMoveEnabled
                        ? "拖动：只移动这一镜 · Shift+拖动：整体移动连续镜头 · 改顺序用 ⌥← / ⌥→"
                        : groupEnabled
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
                    onPointerCancel={cancelTrim}
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
        {(timeline.magneticJoins ?? []).map(join => {
          const leftPx = frameToPx(viewport, join.boundaryFrame);
          if (leftPx < 0 || leftPx > viewport.contentWidth) return null;
          return (
            <span
              key={`${join.leftStableShotId}-${join.rightStableShotId}`}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-40 -ml-1 flex h-4 w-2 items-center justify-center text-primary"
              style={{ left: leftPx }}
              data-testid={`storyboard-magnetic-join-${join.leftStableShotId}-${join.rightStableShotId}`}
            >
              <Magnet className="h-2.5 w-2.5" />
            </span>
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
                    left:
                      block.leftPx +
                      (groupGhostShotIds.includes(block.timing.stableShotId)
                        ? groupDeltaPx
                        : 0),
                    width: block.widthPx,
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
                const deltaPx = frameDeltaToPx(
                  viewport,
                  singleDrag.deltaFrames
                );
                return (
                  <span
                    key={`single-ghost-${block.timing.stableShotId}`}
                    className="pointer-events-none absolute bottom-0.5 top-4 z-30 rounded-[2px] border-2 border-dashed border-primary bg-primary/20"
                    style={{
                      left: block.leftPx + deltaPx,
                      width: block.widthPx,
                    }}
                    data-testid={`storyboard-edit-single-ghost-${block.timing.stableShotId}`}
                  />
                );
              })
          : null}
        {anchors.map((anchor, index) => {
          const leftPx = frameToPx(viewport, anchor.timelineFrame);
          if (leftPx < 0 || leftPx > viewport.contentWidth) return null;
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
              style={{ left: leftPx }}
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
              left:
                blocks.find(
                  block => block.timing.stableShotId === groupDrag.stableShotId
                )?.leftPx ?? 0,
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
              left:
                blocks.find(
                  block => block.timing.stableShotId === singleDrag.stableShotId
                )?.leftPx ?? 0,
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
              left: highlight.leftPx,
              width: highlight.widthPx,
            }}
            data-testid="storyboard-edit-selection"
          />
        ) : null}
        {markInPx != null ? (
          <span
            className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 bg-amber-500"
            style={{ left: markInPx }}
            title="入点，按 O 打出点"
            data-testid="storyboard-edit-mark-in"
          />
        ) : null}
        {playheadPx != null ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 z-40 w-px -translate-x-1/2"
            style={{ left: playheadPx }}
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
          groupDrag?.blockedReason ??
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
                    : `${shots.length} 镜`)))}
      </span>
    </div>
  );
}

const ACTION_LABELS: Record<StoryboardEditAction, string> = {
  addAnchor: "打标中…",
  removeAnchor: "取消锚点…",
  detachMagnet: "取消吸附…",
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
  viewport: providedViewport,
  shots,
  selectedShotNo,
  onSelectShot,
  columnSpan,
  shotActions,
  onShotTimingPreviewChange,
  selectedVisualObject: controlledSelectedVisualObject,
  onSelectVisualObject,
}: {
  timeline: StoryboardBoardTimeline;
  viewport?: TimelineViewport;
  shots: readonly StoryboardEditShot[];
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number | null) => void;
  columnSpan: number;
  shotActions?: StoryboardEditShotActions;
  onShotTimingPreviewChange?: (
    preview: StoryboardShotTimingPreview | null,
    gestureId: symbol
  ) => void;
  selectedVisualObject?: VisualObjectRef | null;
  onSelectVisualObject?: (object: VisualObjectRef | null) => void;
}) {
  // 生产看板显式传入和标尺、缩放控件同一个 viewport。回退只服务
  // 独立渲染与旧测试夹具，坐标语义仍是像素。
  const viewport =
    providedViewport ??
    createTimelineViewport({
      totalMs: Math.max(
        timeline.totalMs,
        ...shots.map(shot => shot.timing.endMs),
        ...(timeline.overlays ?? []).map(
          overlay => (overlay.endFrame * 1000) / 30
        )
      ),
      scale: DEFAULT_TIMELINE_SCALE,
    });
  const [pendingAction, setPendingAction] =
    useState<StoryboardEditAction | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [objectMenu, setObjectMenu] = useState<VisualObjectMenuState | null>(
    null
  );
  const [pendingObjectKey, setPendingObjectKey] = useState<string | null>(null);
  const [gapMenu, setGapMenu] = useState<GapMenuState | null>(null);
  const [gapTransitionPending, setGapTransitionPending] = useState(false);
  const [markInMs, setMarkInMs] = useState<number | null>(null);
  const [focusedAnchorId, setFocusedAnchorId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [localSelectedVisualObject, setLocalSelectedVisualObject] =
    useState<VisualObjectRef | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const pendingGuardRef = useRef(createVisualObjectPendingGuard());
  const pendingMenuItemRef = useRef<HTMLElement | null>(null);
  const projectedShotNoRef = useRef<number | null | undefined>(undefined);
  const storySessionKeyRef = useRef(timeline.storySessionKey);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const selectedVisualObject =
    controlledSelectedVisualObject !== undefined
      ? controlledSelectedVisualObject
      : (localSelectedVisualObject ??
        (selectedShotNo == null
          ? null
          : (() => {
              const shot = shots.find(item => item.shotNo === selectedShotNo);
              return shot
                ? ({
                    type: "story-shot",
                    stableShotId: shot.stableShotId,
                    shotNo: shot.shotNo,
                  } as const)
                : null;
            })()));
  const selectVisualObject = useCallback(
    (object: VisualObjectRef, target: HTMLElement) => {
      focusReturnRef.current = target;
      if (controlledSelectedVisualObject === undefined) {
        setLocalSelectedVisualObject(object);
      }
      onSelectVisualObject?.(object);
      const projectedShotNo =
        object.type === "story-shot" ? (object.shotNo ?? null) : null;
      projectedShotNoRef.current = projectedShotNo;
      onSelectShot(projectedShotNo);
    },
    [controlledSelectedVisualObject, onSelectShot, onSelectVisualObject]
  );
  useEffect(() => {
    if (projectedShotNoRef.current === selectedShotNo) {
      projectedShotNoRef.current = undefined;
      return;
    }
    if (controlledSelectedVisualObject !== undefined) return;
    const shot =
      selectedShotNo == null
        ? null
        : (shots.find(item => item.shotNo === selectedShotNo) ?? null);
    setLocalSelectedVisualObject(
      shot
        ? {
            type: "story-shot",
            stableShotId: shot.stableShotId,
            shotNo: shot.shotNo,
          }
        : null
    );
    setMenu(null);
    setObjectMenu(null);
    focusReturnRef.current = null;
  }, [controlledSelectedVisualObject, selectedShotNo, shots]);
  useEffect(() => {
    if (storySessionKeyRef.current === timeline.storySessionKey) return;
    storySessionKeyRef.current = timeline.storySessionKey;
    if (controlledSelectedVisualObject === undefined)
      setLocalSelectedVisualObject(null);
    onSelectVisualObject?.(null);
    setMenu(null);
    setObjectMenu(null);
    focusReturnRef.current = null;
  }, [
    controlledSelectedVisualObject,
    onSelectVisualObject,
    timeline.storySessionKey,
  ]);
  useEffect(() => {
    if (!selectedVisualObject) return;
    const availableKeys = new Set<string>();
    for (const shot of shots) {
      availableKeys.add(
        visualObjectRefKey({
          type: "story-shot",
          stableShotId: shot.stableShotId,
        })
      );
      for (const clip of shot.timelineItem?.visualClips ?? []) {
        availableKeys.add(
          visualObjectRefKey({
            type: "owned-video-clip",
            clipId: clip.id,
            ownerStableShotId: shot.stableShotId,
          })
        );
      }
      for (const clip of shot.timelineItem?.imageClips ?? []) {
        availableKeys.add(
          visualObjectRefKey({
            type: "image-clip",
            clipId: clip.id,
            ownerStableShotId: shot.stableShotId,
          })
        );
      }
    }
    if (availableKeys.has(visualObjectRefKey(selectedVisualObject))) return;
    if (controlledSelectedVisualObject === undefined)
      setLocalSelectedVisualObject(null);
    onSelectVisualObject?.(null);
    onSelectShot(null);
    setMenu(null);
    setObjectMenu(null);
    focusReturnRef.current = null;
  }, [
    controlledSelectedVisualObject,
    onSelectShot,
    onSelectVisualObject,
    selectedVisualObject,
    shots,
  ]);
  useEffect(() => {
    if (
      objectMenu &&
      visualObjectRefKey(objectMenu.object) !==
        (selectedVisualObject ? visualObjectRefKey(selectedVisualObject) : null)
    ) {
      setObjectMenu(null);
    }
  }, [objectMenu, selectedVisualObject]);
  const activeTimingGestureRef = useRef<symbol | null>(null);
  const shotTimingPreviewCallbackRef = useRef(onShotTimingPreviewChange);
  shotTimingPreviewCallbackRef.current = onShotTimingPreviewChange;
  const handleShotTimingPreviewChange = useCallback(
    (preview: StoryboardShotTimingPreview | null, gestureId: symbol) => {
      if (preview) {
        activeTimingGestureRef.current = gestureId;
      } else if (activeTimingGestureRef.current !== gestureId) {
        return;
      } else {
        activeTimingGestureRef.current = null;
      }
      onShotTimingPreviewChange?.(preview, gestureId);
    },
    [onShotTimingPreviewChange]
  );
  useEffect(() => {
    return () => {
      const gestureId = activeTimingGestureRef.current;
      if (gestureId) shotTimingPreviewCallbackRef.current?.(null, gestureId);
    };
  }, []);
  const anchors = timeline.anchors ?? [];
  const timelineItems = shots.flatMap(shot =>
    shot.timelineItem ? [shot.timelineItem] : []
  );
  const timelineOverlays = timeline.overlays ?? [];
  const visualLayerState =
    timeline.visualLayerState ??
    resolveTimelineVisualLayerState(null, timelineItems, timelineOverlays);
  const persistedLayerState = {
    count: visualLayerState.explicitCount,
    hidden: visualLayerState.hidden,
  };
  const canRemoveLayer = (layer: number) =>
    canRemoveTimelineVisualLayer({
      items: timelineItems,
      overlays: timelineOverlays,
      state: persistedLayerState,
      layer,
    });
  const mainLayerHidden = visualLayerState.hidden.includes(0);
  const nudgeVisualClip = useStoryboardVisualClipNudge(
    timeline.onMoveVisualClip
  );
  const manageVisualLayer = (action: TimelineVisualLayerAction) => {
    if (!timeline.onManageVisualLayer || timeline.writePending) return;
    if (action.kind === "move") {
      if (
        action.from < 0 ||
        action.to < 0 ||
        action.from >= visualLayerState.count ||
        action.to >= visualLayerState.count
      )
        return;
    }
    if (action.kind === "remove") {
      const clipCount = countTimelineVisualLayerClips(
        timelineItems,
        action.layer,
        timelineOverlays
      );
      if (
        clipCount > 0 &&
        !window.confirm(
          `视觉层 ${action.layer + 1} 中有 ${clipCount} 个素材。删除图层会保留素材，并把它们合并到相邻图层。继续吗？`
        )
      )
        return;
    }
    setStatusMessage("正在保存图层…");
    void timeline
      .onManageVisualLayer(action)
      .then(() => setStatusMessage("图层已更新"))
      .catch(error =>
        setStatusMessage(
          error instanceof Error ? error.message : "图层更新失败"
        )
      );
  };

  const timings = shots.map(shot => shot.timing);
  const closeMenu = useCallback(() => {
    setMenu(null);
    focusReturnRef.current?.focus({ preventScroll: true });
  }, []);
  const closeGapMenu = useCallback(() => setGapMenu(null), []);
  const closeObjectMenu = useCallback(() => {
    setObjectMenu(null);
    focusReturnRef.current?.focus({ preventScroll: true });
  }, []);
  const openObjectMenu = useCallback((next: VisualObjectMenuState) => {
    setMenu(null);
    setGapMenu(null);
    setObjectMenu(next);
  }, []);
  const runObjectCommand = useCallback(
    (command: VisualObjectCommand) => {
      if (!objectMenu || !timeline.onVisualObjectCommand) return;
      const object = objectMenu.object;
      const key = visualObjectRefKey(object);
      pendingMenuItemRef.current =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.getAttribute("role") === "menuitem"
          ? document.activeElement
          : null;
      setPendingObjectKey(key);
      void pendingGuardRef.current
        .run(key, () => timeline.onVisualObjectCommand!(object, command))
        .then(result => {
          if (result !== null) closeObjectMenu();
        })
        .catch(error => {
          setStatusMessage(
            error instanceof Error ? error.message : "对象操作失败，请重试"
          );
          pendingMenuItemRef.current?.focus({ preventScroll: true });
        })
        .finally(() => {
          pendingMenuItemRef.current = null;
          setPendingObjectKey(null);
        });
    },
    [closeObjectMenu, objectMenu, timeline]
  );

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
          result?.applied
            ? "已取消位置锚点"
            : (result?.reason ?? "取消锚点失败")
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
    atMs: number,
    magneticJoin: StoryboardMagneticJoin | null = null
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
    if (action === "detachMagnet") {
      closeMenu();
      if (
        !magneticJoin ||
        !timeline.onDetachTimelineMagnet ||
        pendingAction ||
        timeline.writePending
      ) {
        return;
      }
      setPendingAction("detachMagnet");
      void timeline
        .onDetachTimelineMagnet({
          leftStableShotId: magneticJoin.leftStableShotId,
          rightStableShotId: magneticJoin.rightStableShotId,
        })
        .then(result => {
          setStatusMessage(
            result.applied
              ? "已取消这两个镜头的吸附"
              : (result.reason ?? "取消吸附失败")
          );
        })
        .finally(() => setPendingAction(null));
      return;
    }
    if (pendingAction || timeline.writePending || !shot) return;
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
        isVisualClipMoveTarget: Boolean(
          target?.closest('[data-visual-clip-move-target="true"]')
        ),
        isInteractionBoundary: Boolean(
          target?.closest(
            'select, [role="combobox"], [role="dialog"], [role="menu"], [data-renaming="true"], [data-rename-input="true"]'
          )
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
      {Array.from(
        { length: Math.max(1, visualLayerState.count - 1) },
        (_, index) => visualLayerState.count - 1 - index
      ).map((visualLayer, index) => (
        <StoryboardUpperVisualLayerRow
          key={`persisted-visual-layer-${visualLayer}`}
          shots={shots}
          timeline={timeline}
          viewport={viewport}
          columnSpan={columnSpan}
          onSelectShot={onSelectShot}
          visualLayer={visualLayer}
          showTopPlayhead={index === 0}
          hidden={visualLayerState.hidden.includes(visualLayer)}
          canDelete={canRemoveLayer(visualLayer)}
          onManageLayer={manageVisualLayer}
          onNudgeVisualClip={nudgeVisualClip}
          onShotTimingPreviewChange={handleShotTimingPreviewChange}
          selectedVisualObject={selectedVisualObject}
          onSelectVisualObject={selectVisualObject}
          onOpenMenu={setMenu}
          onOpenObjectMenu={openObjectMenu}
        />
      ))}
      <StoryboardVisualLayerHeader
        visualLayer={0}
        hidden={mainLayerHidden}
        onToggleHidden={() =>
          manageVisualLayer({ kind: "toggle-hidden", layer: 0 })
        }
        onAddAbove={() => manageVisualLayer({ kind: "insert", at: 1 })}
        onAddBelow={() => manageVisualLayer({ kind: "insert", at: 0 })}
        onMoveUp={() => manageVisualLayer({ kind: "move", from: 0, to: 1 })}
        onMoveDown={() => {}}
        canMoveUp={visualLayerState.count > 1}
        canMoveDown={false}
        canDelete={canRemoveLayer(0)}
        onDelete={() => manageVisualLayer({ kind: "remove", layer: 0 })}
        onDropLayer={sourceLayer =>
          manageVisualLayer({ kind: "move", from: sourceLayer, to: 0 })
        }
      />
      <div
        role="cell"
        ref={rowRef}
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <div className={mainLayerHidden ? "opacity-25" : undefined}>
          <StoryboardEditTrack
            timeline={timeline}
            viewport={viewport}
            shots={shots}
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
            excludedShotIds={
              new Set(
                shots
                  .filter(shot => (shot.timelineItem?.visualLayer ?? 0) > 0)
                  .map(shot => shot.stableShotId)
              )
            }
            disableGroupMove={false}
            onNudgeVisualClip={nudgeVisualClip}
            onShotTimingPreviewChange={handleShotTimingPreviewChange}
            selectedVisualObject={selectedVisualObject}
            onSelectVisualObject={selectVisualObject}
            onOpenObjectMenu={openObjectMenu}
          />
        </div>
      </div>
      <StoryboardAudioRowHeader />
      <div
        role="cell"
        style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
      >
        <StoryboardAudioTrack
          clips={timeline.audioClips}
          viewport={viewport}
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
          canExtractHere={timeline.canExtractAt(menu.atMs)}
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
          magneticJoin={menu.magneticJoin}
          pendingAction={pendingAction}
          writePending={timeline.writePending === true}
          onPick={action =>
            runAction(action, menu.shot, menu.atMs, menu.magneticJoin)
          }
          onClose={closeMenu}
        />
      ) : null}
      {objectMenu ? (
        <StoryboardVisualObjectMenu
          key={visualObjectRefKey(objectMenu.object)}
          menu={objectMenu}
          commandAvailable={Boolean(timeline.onVisualObjectCommand)}
          pending={
            pendingObjectKey === visualObjectRefKey(objectMenu.object) ||
            pendingGuardRef.current.isPending(
              visualObjectRefKey(objectMenu.object)
            )
          }
          onPick={runObjectCommand}
          onClose={closeObjectMenu}
        />
      ) : null}
    </>
  );
}
