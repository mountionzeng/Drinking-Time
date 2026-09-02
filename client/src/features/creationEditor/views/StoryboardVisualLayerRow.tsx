import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pause,
  Play,
  Plus,
  SkipBack,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
} from "@shared/storyMaterial";
import { timelineImageClipStartFrame } from "@shared/storyMaterial";
import {
  imageClipId,
  shotClipId,
  videoClipId,
  visualTrackId,
} from "@shared/visualClipModel";
import type { VisualObjectRef } from "@shared/visualObject";
import type { VisualObjectCommand } from "@shared/visualObjectCapabilities";
import {
  type ResolvedTimelineVisualLayerState,
  type TimelineVisualLayerAction,
} from "@shared/timelineVisualLayers";
import {
  frameToPx,
  msToPx,
  pxToFrame,
  pxToMs,
  type TimelineViewport,
} from "@shared/timelineViewport";
import {
  hasCanonicalImageClipIdentity,
  selectExtractedFrameCandidate,
  selectExtractedFrameCandidates,
  selectExtractedFramePair,
  type ExtractedFrameCandidateResult,
} from "@shared/extractedFrameTransition";
import {
  formatStoryboardTimestamp,
  type StoryboardTimingRow,
} from "@/features/storyAgent/storyboardTiming";
import {
  focusStoryboardClipForDrag,
  isStoryboardPointerOwner,
  storyboardEditFilmstripFrameUrls,
  storyboardEditPlayheadPx,
  consumeStoryboardVisualPasteContextMenu,
  storyboardGroupDragDeltaFrames,
  storyboardVisualClipShotTimingPreview,
  storyboardOwnedClipVisualLayer,
  type StoryboardEditFrameSource,
  type StoryboardEditRange,
  type StoryboardShotTimingPreview,
} from "../storyboardEditRow";
import type { StoryboardAudioClip } from "./StoryboardAudioWaveform";
import { STORY_IMAGE_DRAG_MIME } from "@/features/storyAgent/storyImageDrag";
import { VIDEO_TAKE_DRAG_MIME } from "@/features/storyAgent/views/videoTakeDrag";

import { StoryboardEditFilmstrip } from "./StoryboardEditFilmstrip";
import { StoryboardOwnedVideoClipBlock } from "./StoryboardOwnedVideoClipBlock";
import { storyboardVisualClipArrowMove } from "../storyboardVisualObjectInteraction";
import {
  STORYBOARD_IMAGE_CLIP_DRAG_MIME,
  STORYBOARD_SHOT_DRAG_MIME,
  STORYBOARD_VIDEO_CLIP_DRAG_MIME,
  STORYBOARD_VISUAL_LAYER_DRAG_MIME,
} from "../storyboardVisualDragProtocol";

export type StoryboardBoardTimeline = {
  /** Changes whenever the active Story/editor session changes. */
  storySessionKey?: string;
  /** False once the render that supplied this timeline is no longer current. */
  isStorySessionCurrent?: () => boolean;
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
  onSplitAt: (ms: number, stableShotId?: string) => Promise<void>;
  onExtractFrameAt: (ms: number, operationLayer: number) => Promise<void>;
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
    leftClipId: string;
    rightClipId: string;
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
    command: VisualObjectCommand,
    context: { timelineFrame: number; visualLayer: number }
  ) => Promise<void>;
  onPasteVisualObject?: (context: {
    timelineFrame: number;
    visualLayer?: number;
  }) => Promise<void>;
  canPasteVisualObject?: boolean;
  isVisualObjectCommandAvailable?: (
    object: VisualObjectRef,
    command: VisualObjectCommand,
    context?: { timelineFrame: number; visualLayer: number }
  ) => boolean;
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

/**
 * Resolve the command frame without treating an enlarged one-frame image
 * thumbnail as real timeline duration. Image callers pass the canonical frame;
 * video/shot callers intentionally use the pointer position within the track.
 */
export function storyboardVisualObjectMenuTimelineFrame(input: {
  explicitTimelineFrame?: number;
  clientX: number;
  trackLeft: number | null;
  viewport: TimelineViewport;
  playheadMs: number;
}): number {
  if (
    input.explicitTimelineFrame != null &&
    Number.isFinite(input.explicitTimelineFrame)
  ) {
    return Math.max(0, Math.round(input.explicitTimelineFrame));
  }
  if (input.trackLeft != null && Number.isFinite(input.trackLeft)) {
    return Math.max(
      0,
      pxToFrame(input.viewport, input.clientX - input.trackLeft)
    );
  }
  return Math.max(0, Math.round((input.playheadMs * 30) / 1_000));
}

export function storyboardVisualLayerAtDocumentPoint(
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

export function storyboardVisualLayerTrackGeometry(
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
 * Promise callbacks may outlive the Story that started them.  A key alone is
 * not enough here because A -> B -> A must not make the first A current again.
 */
export function createStoryboardAsyncSessionGuard(initialToken: symbol) {
  let committedToken = initialToken;
  return {
    commit(nextToken: symbol) {
      committedToken = nextToken;
    },
    isCurrent(candidate: symbol) {
      return candidate === committedToken;
    },
  };
}

/**
 * 把一次移动交给唯一命令，并保证失败一定被用户看见。
 *
 * 拖拽、外部拖放和键盘微调都走这里：它们各自只负责算出「哪个 clip、去哪一层、
 * 去哪一帧」，不再各自决定素材归属哪个镜头。
 */
export function submitVisualClipMove(input: {
  clipId: string;
  visualLayer: number;
  toStartFrame: number;
  onMoveVisualClip?: (move: {
    clipId: string;
    toTrackId: string;
    toStartFrame: number;
  }) => Promise<void>;
  isStorySessionCurrent?: () => boolean;
}): Promise<void> {
  const move = input.onMoveVisualClip;
  if (!move) return Promise.resolve();
  return move({
    clipId: input.clipId,
    toTrackId: visualTrackId(input.visualLayer),
    toStartFrame: Math.max(0, Math.round(input.toStartFrame)),
  }).catch((error: unknown) => {
    if (input.isStorySessionCurrent?.() === false) return;
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
export function clipAnchorPx(element: HTMLElement): number | null {
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
  isStorySessionCurrent?: () => boolean;
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
    isStorySessionCurrent: input.isStorySessionCurrent,
  });
}

export function useWindowPointerContinuation(input: {
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

export function hasExternalVisualPayload(dataTransfer: DataTransfer): boolean {
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
export function StoryboardVisualLayerHeader({
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
        if (
          !event.dataTransfer.types.includes(STORYBOARD_VISUAL_LAYER_DRAG_MIME)
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={event => {
        const value = event.dataTransfer.getData(
          STORYBOARD_VISUAL_LAYER_DRAG_MIME
        );
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
              STORYBOARD_VISUAL_LAYER_DRAG_MIME,
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

export type VisualPasteMenuState = {
  clientX: number;
  clientY: number;
  timelineFrame: number;
  visualLayer: number;
};

export type VisualObjectMenuState = {
  object: VisualObjectRef;
  clientX: number;
  clientY: number;
  timelineFrame?: number;
  visualLayer?: number;
};

type MenuState = {
  shot: StoryboardEditShot;
  atMs: number;
  clientX: number;
  clientY: number;
  magneticJoin: StoryboardMagneticJoin | null;
};

export function StoryboardVisualLayerRow({
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
  onOpenPasteMenu,
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
  onOpenPasteMenu: (menu: VisualPasteMenuState) => void;
}) {
  const totalMs = viewport.totalMs;
  const isCurrentStorySession = () =>
    timeline.isStorySessionCurrent?.() !== false;
  const frames = useMemo(
    () =>
      shots
        .flatMap(shot => {
          const extractedFrames = shot.extractedFrames ?? [];
          const imageClips = shot.timelineItem?.imageClips ?? [];
          const persisted = imageClips.map(clip => {
            const frame = extractedFrames.find(
              item => item.imageId === clip.imageId
            );
            const timelineFrame = timelineImageClipStartFrame(
              clip,
              shot.timing.startFrame
            );
            return {
              id: frame?.id ?? clip.id,
              clipId: clip.id,
              imageId: clip.imageId,
              imageUrl: clip.imageUrl,
              timelineFrame,
              visualLayer: clip.visualLayer,
              atMs: (timelineFrame * 1000) / 30,
              clip,
              shot,
            };
          });
          const persistedImageIds = new Set(
            imageClips.map(clip => clip.imageId)
          );
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
          (left, right) =>
            left.atMs - right.atMs || left.id.localeCompare(right.id)
        ),
    [shots, visualLayer]
  );
  const [transitionMenu, setTransitionMenu] = useState<{
    clientX: number;
    clientY: number;
    leftImageId: number;
    rightImageId: number;
    leftClipId: string;
    rightClipId: string;
    durationSec: number;
    timelineFrame: number;
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
            ? imageClipId(drag.clipId)
            : shotClipId(drag.stableShotId),
        startRectLeft: drag.startRectLeft,
        startLeftPx: drag.startLeftPx,
        startClientX: drag.startClientX,
        releaseClientX: event.clientX,
        releaseClientY: event.clientY,
        viewport: drag.viewport,
        onMoveVisualClip: timeline.onMoveVisualClip,
        isStorySessionCurrent: timeline.isStorySessionCurrent,
      });
    } finally {
      if (isCurrentStorySession()) {
        clipPointerCommitPendingRef.current = false;
        setClipPointerCommitPreview(null);
        if (drag.kind === "shot")
          onShotTimingPreviewChange?.(null, drag.gestureId);
      }
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
    clipId?: string;
  }) => {
    if (!frame.clipId) return;
    setTransitionMenu(null);
    setFrameMenu(null);
    setDeleteError(null);
    setPairingStart(frame);
    const nearest = selectExtractedFrameCandidates({
      frames: frames.filter(hasCanonicalImageClipIdentity),
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
      selectExtractedFrameCandidate({
        frames: frames.filter(hasCanonicalImageClipIdentity),
        start: pairingStart,
        atMs,
      })
    );
  };
  const finishPairing = async (pair: {
    leftImageId: number;
    rightImageId: number;
    leftClipId: string;
    rightClipId: string;
  }) => {
    if (!timeline.onCreateExtractedFrameTransition) return;
    setPending(true);
    try {
      const result = await timeline.onCreateExtractedFrameTransition(pair);
      if (!isCurrentStorySession()) return;
      if (result.applied) {
        setPairingStart(null);
        setPairingCandidate(null);
      }
    } finally {
      if (isCurrentStorySession()) setPending(false);
    }
  };
  const openAtMs = (atMs: number, clientX: number, clientY: number) => {
    const selected = selectExtractedFramePair({
      frames: frames.filter(hasCanonicalImageClipIdentity),
      atMs,
    });
    if (selected.kind !== "ok") return false;
    if (!selected.pair.left.clipId || !selected.pair.right.clipId) return false;
    setFrameMenu(null);
    setDeleteError(null);
    setTransitionMenu({
      clientX,
      clientY,
      leftImageId: selected.pair.left.imageId,
      rightImageId: selected.pair.right.imageId,
      leftClipId: selected.pair.left.clipId,
      rightClipId: selected.pair.right.clipId,
      durationSec: selected.pair.requestedDurationSec,
      timelineFrame: Math.max(0, Math.round((atMs * 30) / 1000)),
    });
    return true;
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
            const rect = event.currentTarget.getBoundingClientRect();
            const atMs = Math.max(
              0,
              Math.min(totalMs, pxToMs(viewport, event.clientX - rect.left))
            );
            if (
              timeline.onCreateExtractedFrameTransition &&
              openAtMs(atMs, event.clientX, event.clientY)
            ) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (timeline.canPasteVisualObject) {
              consumeStoryboardVisualPasteContextMenu(event);
              onOpenPasteMenu({
                clientX: event.clientX,
                clientY: event.clientY,
                timelineFrame: Math.max(0, Math.round((atMs * 30) / 1000)),
                visualLayer,
              });
              return;
            }
            return;
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
              !event.dataTransfer.types.includes(
                STORYBOARD_IMAGE_CLIP_DRAG_MIME
              ) &&
              !event.dataTransfer.types.includes(
                STORYBOARD_VIDEO_CLIP_DRAG_MIME
              ) &&
              !event.dataTransfer.types.includes(STORYBOARD_SHOT_DRAG_MIME)
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
                .then(result => {
                  if (isCurrentStorySession()) onSelectShot(result.shotNo);
                })
                .catch(error => {
                  if (!isCurrentStorySession()) return;
                  toast.error(
                    error instanceof Error ? error.message : "素材落位失败"
                  );
                });
              return;
            }
            const imagePayload = event.dataTransfer.getData(
              STORYBOARD_IMAGE_CLIP_DRAG_MIME
            );
            if (imagePayload && timeline.onMoveVisualClip) {
              event.preventDefault();
              const parsed = JSON.parse(imagePayload) as { clipId: string };
              // 落点就是绝对帧，不再要求那一刻恰好压在某个镜头上。
              submitVisualClipMove({
                clipId: imageClipId(parsed.clipId),
                visualLayer,
                toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
                onMoveVisualClip: timeline.onMoveVisualClip,
                isStorySessionCurrent: timeline.isStorySessionCurrent,
              });
              return;
            }
            const videoPayload = event.dataTransfer.getData(
              STORYBOARD_VIDEO_CLIP_DRAG_MIME
            );
            if (videoPayload && timeline.onMoveVisualClip) {
              event.preventDefault();
              const parsed = JSON.parse(videoPayload) as { clipId: string };
              submitVisualClipMove({
                clipId: videoClipId(parsed.clipId),
                visualLayer,
                toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
                onMoveVisualClip: timeline.onMoveVisualClip,
                isStorySessionCurrent: timeline.isStorySessionCurrent,
              });
              return;
            }
            const stableShotId = event.dataTransfer.getData(
              STORYBOARD_SHOT_DRAG_MIME
            );
            const sourceShot = shots.find(
              shot => shot.stableShotId === stableShotId
            );
            if (sourceShot && timeline.onMoveVisualClip) {
              event.preventDefault();
              submitVisualClipMove({
                clipId: shotClipId(stableShotId),
                visualLayer,
                toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
                onMoveVisualClip: timeline.onMoveVisualClip,
                isStorySessionCurrent: timeline.isStorySessionCurrent,
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
                        onMove: (deltaFrames, deltaVisualLayers) => {
                          onNudgeVisualClip({
                            clipId: shotClipId(shot.stableShotId),
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
                className={`absolute bottom-1 h-7 w-10 -translate-x-1/2 overflow-hidden rounded-sm border bg-background shadow-sm transition hover:z-20 hover:scale-105 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  clip
                    ? "touch-none cursor-grab active:cursor-grabbing"
                    : "cursor-pointer"
                } ${
                  active
                    ? "z-30 border-primary ring-1 ring-primary"
                    : "z-10 border-white/60"
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
                      frames: frames.filter(hasCanonicalImageClipIdentity),
                      start: pairingStart,
                    }).find(item => item.frame.id === frame.id);
                    if (
                      candidate?.pair.left.clipId &&
                      candidate.pair.right.clipId
                    )
                      void finishPairing({
                        leftImageId: candidate.pair.left.imageId,
                        rightImageId: candidate.pair.right.imageId,
                        leftClipId: candidate.pair.left.clipId,
                        rightClipId: candidate.pair.right.clipId,
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
                      timelineFrame: timelineImageClipStartFrame(
                        clip,
                        shot.timing.startFrame
                      ),
                      visualLayer,
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
                      onMove: (deltaFrames, deltaVisualLayers) => {
                        onNudgeVisualClip({
                          clipId: imageClipId(clip.id),
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
                      timelineFrame: timelineImageClipStartFrame(
                        clip,
                        shot.timing.startFrame
                      ),
                      visualLayer,
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
                if (
                  !pairingCandidate.pair.left.clipId ||
                  !pairingCandidate.pair.right.clipId
                )
                  return;
                void finishPairing({
                  leftImageId: pairingCandidate.pair.left.imageId,
                  rightImageId: pairingCandidate.pair.right.imageId,
                  leftClipId: pairingCandidate.pair.left.clipId,
                  rightClipId: pairingCandidate.pair.right.clipId,
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
                try {
                  const result =
                    await timeline.onCreateExtractedFrameTransition({
                      leftImageId: transitionMenu.leftImageId,
                      rightImageId: transitionMenu.rightImageId,
                      leftClipId: transitionMenu.leftClipId,
                      rightClipId: transitionMenu.rightClipId,
                    });
                  if (!isCurrentStorySession()) return;
                  if (result.applied) setTransitionMenu(null);
                } finally {
                  if (isCurrentStorySession()) setPending(false);
                }
              }}
            >
              {pending
                ? "正在生成确认卡…"
                : `用左右抽帧生成 ${transitionMenu.durationSec} 秒覆盖视频…`}
            </button>
            {timeline.canPasteVisualObject ? (
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                onClick={() => {
                  setTransitionMenu(null);
                  onOpenPasteMenu({
                    clientX: transitionMenu.clientX,
                    clientY: transitionMenu.clientY,
                    timelineFrame: transitionMenu.timelineFrame,
                    visualLayer,
                  });
                }}
              >
                粘贴到这一层
              </button>
            ) : null}
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
                    if (!isCurrentStorySession()) return;
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
                    if (isCurrentStorySession()) setDeletingImageId(null);
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
