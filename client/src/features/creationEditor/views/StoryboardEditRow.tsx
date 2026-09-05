import { GripVertical, Loader2, Magnet } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import { timelineImageClipStartFrame } from "@shared/storyMaterial";
import { imageClipId, shotClipId, videoClipId } from "@shared/visualClipModel";
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
  type TimelineVisualLayerAction,
} from "@shared/timelineVisualLayers";
import {
  createTimelineViewport,
  DEFAULT_TIMELINE_SCALE,
  frameDeltaToPx,
  frameToPx,
  msToPx,
  type TimelineViewport,
} from "@shared/timelineViewport";
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
  storyboardVisualObjectShortcutRoute,
  storyboardOwnedClipVisualLayer,
  type StoryboardEditAction,
  type StoryboardEditFrameSource,
  type StoryboardEditRange,
  type StoryboardShotTimingPreview,
} from "../storyboardEditRow";
import { StoryboardAudioTrack } from "./StoryboardAudioWaveform";
import {
  StoryboardVisualLayerHeader,
  StoryboardVisualLayerRow,
  clipAnchorPx,
  commitVisualClipDrag,
  createStoryboardAsyncSessionGuard,
  hasExternalVisualPayload,
  storyboardVisualLayerAtDocumentPoint,
  storyboardVisualLayerTrackGeometry,
  storyboardVisualObjectMenuTimelineFrame,
  submitVisualClipMove,
  useWindowPointerContinuation,
  type StoryboardBoardTimeline,
  type StoryboardEditShotActions,
  type StoryboardEditShot,
  type StoryboardMagneticJoin,
  type StoryboardTimelineAnchor,
  type VisualPasteMenuState,
} from "./StoryboardVisualLayerRow";
import { StoryboardEditFilmstrip } from "./StoryboardEditFilmstrip";
import {
  SubtitleRowHeader,
  SubtitleTrackRow,
} from "../timelineMedia/SubtitleTrackRow";
import { AudioTrackSection } from "../timelineMedia/AudioTrackRow";
import { AddTimelineMediaMenu } from "../timelineMedia/AddTimelineMediaMenu";
import { TimelineMediaInspector } from "../timelineMedia/TimelineMediaInspector";
import { storyboardVisualClipArrowMove } from "../storyboardVisualObjectInteraction";
import {
  STORYBOARD_IMAGE_CLIP_DRAG_MIME,
  STORYBOARD_SHOT_DRAG_MIME,
  STORYBOARD_VIDEO_CLIP_DRAG_MIME,
} from "../storyboardVisualDragProtocol";

export {
  StoryboardEditTransport,
  commitVisualClipDrag,
  createStoryboardAsyncSessionGuard,
  storyboardVisualLayerAtPoint,
  storyboardVisualObjectMenuTimelineFrame,
  type StoryboardEditShotActions,
  type StoryboardBoardTimeline,
  type StoryboardEditShot,
  type StoryboardVisualLayerTrackGeometry,
} from "./StoryboardVisualLayerRow";

/**
 * 故事版看板里的「剪辑」行：不跟镜头列对齐，自己按时间等比铺成一整条，
 * 靠镜头编号和选中状态跟上面的镜头列关联。
 * 左键拖选一段交给聊聊、拖右边缘改时长、拖左边把手换顺序；
 * 右键出剪辑菜单，键盘走主流剪辑软件那一套快捷键。
 */
function StoryboardAudioRowHeader({ legacy = false }: { legacy?: boolean }) {
  return (
    <div
      role="rowheader"
      className="sticky left-0 z-20 flex flex-col justify-center border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
    >
      <span>{legacy ? "旧音频 · 只读" : "听觉 · 音轨"}</span>
      <span className="mt-0.5 text-[7px] font-normal text-muted-foreground/70">
        {legacy ? "显式导入后可剪辑" : "强弱 · 停顿"}
      </span>
    </div>
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
  onPaste,
}: {
  menu: GapMenuState;
  pending: boolean;
  onCreate: () => void;
  onClose: () => void;
  onPaste?: () => void;
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
      {onPaste ? (
        <button
          type="button"
          role="menuitem"
          disabled={pending}
          onClick={onPaste}
          className="flex w-full items-center px-3 py-1 text-left text-[11px] hover:bg-muted disabled:opacity-40"
        >
          粘贴到这里
        </button>
      ) : null}
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
  timelineFrame?: number;
  visualLayer?: number;
};

function StoryboardVisualObjectMenu({
  menu,
  commandAvailable,
  pending,
  onPick,
  onClose,
}: {
  menu: VisualObjectMenuState;
  commandAvailable: (command: VisualObjectCommand) => boolean;
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
              : !commandAvailable(capability.command)
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

function StoryboardVisualPasteMenu({
  menu,
  pending,
  onPaste,
  onClose,
}: {
  menu: VisualPasteMenuState;
  pending: boolean;
  onPaste: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120]" onPointerDown={onClose}>
      <div
        role="menu"
        aria-label={`视觉层 ${menu.visualLayer + 1} 空白操作`}
        className="fixed min-w-44 rounded-md border bg-popover p-1 shadow-xl"
        style={{ left: menu.clientX, top: menu.clientY }}
        onPointerDown={event => event.stopPropagation()}
        onContextMenu={event => event.preventDefault()}
      >
        <button
          autoFocus
          type="button"
          role="menuitem"
          disabled={pending}
          onClick={onPaste}
          data-testid="storyboard-visual-paste"
          className="flex w-full justify-between gap-6 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-45"
        >
          <span>粘贴</span>
          <span className="text-[9px] text-muted-foreground">⌘V</span>
        </button>
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
  onOpenPasteMenu,
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
  onOpenPasteMenu: (menu: VisualPasteMenuState) => void;
}) {
  const isCurrentStorySession = () =>
    timeline.isStorySessionCurrent?.() !== false;
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
      clipId: imageClipId(drag.clipId),
      startRectLeft: drag.startRectLeft,
      startLeftPx: drag.startLeftPx,
      startClientX: drag.startClientX,
      releaseClientX: event.clientX,
      releaseClientY: event.clientY,
      viewport: drag.viewport,
      onMoveVisualClip: timeline.onMoveVisualClip,
      isStorySessionCurrent: timeline.isStorySessionCurrent,
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
        if (!isCurrentStorySession()) return;
        if (result && !result.applied && result.reason) {
          onStatusMessage(result.reason);
        }
      } finally {
        if (isCurrentStorySession()) setDraftRollingJoin(null);
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
        if (!isCurrentStorySession()) return;
        if (!result.applied && result.reason) onStatusMessage(result.reason);
        return;
      }
      await timeline.onTrimShotDuration({
        shotNo: start.shotNo,
        stableShotId: start.stableShotId,
        durationMs: trim.durationMs,
      });
    } finally {
      if (isCurrentStorySession()) {
        setDraftTrim(null);
        setDraftRollingJoin(null);
      }
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
        clipId: shotClipId(start.stableShotId),
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
        isStorySessionCurrent: timeline.isStorySessionCurrent,
        // 松手落在所有轨道之外时保持在主轨，等同于以前的纯横移。
        resolveTrack: (clientX, clientY) =>
          storyboardVisualLayerAtDocumentPoint(clientX, clientY) ??
          storyboardVisualLayerTrackGeometry(0),
      });
    } finally {
      if (isCurrentStorySession()) {
        singleDragCommitPendingRef.current = false;
        setSingleDrag(null);
        onShotTimingPreviewChange?.(null, start.gestureId);
      }
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
            !event.dataTransfer.types.includes(STORYBOARD_SHOT_DRAG_MIME) &&
            !event.dataTransfer.types.includes(
              STORYBOARD_IMAGE_CLIP_DRAG_MIME
            ) &&
            !event.dataTransfer.types.includes(STORYBOARD_VIDEO_CLIP_DRAG_MIME)
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
            const atMs = trackMsFromPointer(event.clientX);
            event.preventDefault();
            event.stopPropagation();
            const parsed = JSON.parse(imagePayload) as { clipId: string };
            submitVisualClipMove({
              clipId: imageClipId(parsed.clipId),
              visualLayer: 0,
              toStartFrame: Math.round((Math.max(0, atMs) * 30) / 1000),
              onMoveVisualClip: timeline.onMoveVisualClip,
              isStorySessionCurrent: timeline.isStorySessionCurrent,
            });
            return;
          }
          const sourceStableShotId = event.dataTransfer.getData(
            STORYBOARD_SHOT_DRAG_MIME
          );
          const videoPayload = event.dataTransfer.getData(
            STORYBOARD_VIDEO_CLIP_DRAG_MIME
          );
          if (videoPayload && timeline.onMoveVisualClip) {
            const atMs = trackMsFromPointer(event.clientX);
            event.preventDefault();
            event.stopPropagation();
            const parsed = JSON.parse(videoPayload) as { clipId: string };
            submitVisualClipMove({
              clipId: videoClipId(parsed.clipId),
              visualLayer: 0,
              toStartFrame: Math.round((Math.max(0, atMs) * 30) / 1000),
              onMoveVisualClip: timeline.onMoveVisualClip,
              isStorySessionCurrent: timeline.isStorySessionCurrent,
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
            clipId: shotClipId(sourceStableShotId),
            visualLayer: 0,
            toStartFrame: Math.round((Math.max(0, targetMs) * 30) / 1000),
            onMoveVisualClip: timeline.onMoveVisualClip,
            isStorySessionCurrent: timeline.isStorySessionCurrent,
          });
        }}
        onContextMenu={event => {
          // 落在某个镜头块上时，块自己的 onContextMenu 已经 stopPropagation，
          // 冒泡到这里的只会是真正的空档。
          const atMs = trackMsFromPointer(event.clientX);
          if (storyboardEditTimingAt(timings, atMs)) return;
          const sorted = [...timings].sort((a, b) => a.startMs - b.startMs);
          const before = [...sorted].reverse().find(t => t.endMs <= atMs);
          const after = sorted.find(t => t.startMs >= atMs);
          if (timeline.onCreateGapTransition && before && after) {
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
            return;
          }
          if (timeline.canPasteVisualObject) {
            event.preventDefault();
            event.stopPropagation();
            onOpenPasteMenu({
              clientX: event.clientX,
              clientY: event.clientY,
              timelineFrame: Math.max(0, Math.round((atMs * 30) / 1000)),
              visualLayer: 0,
            });
          }
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
                    onMove: (deltaFrames, deltaVisualLayers) => {
                      onNudgeVisualClip({
                        clipId: imageClipId(clip.id),
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
                  timelineFrame: timelineImageClipStartFrame(
                    clip,
                    shot.timing.startFrame
                  ),
                  visualLayer: Math.max(0, clip.visualLayer),
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
                  timelineFrame: timelineImageClipStartFrame(
                    clip,
                    shot.timing.startFrame
                  ),
                  visualLayer: Math.max(0, clip.visualLayer),
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
                    onMove: (deltaFrames, deltaVisualLayers) => {
                      onNudgeVisualClip({
                        clipId: shotClipId(shot.stableShotId),
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
                if (
                  !event.dataTransfer.types.includes(STORYBOARD_SHOT_DRAG_MIME)
                )
                  return;
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
                if (storyImageDrop.accepts(event.dataTransfer)) {
                  event.preventDefault();
                  event.stopPropagation();
                  void storyImageDrop.drop(event.dataTransfer, {
                    kind: "shot",
                    stableShotId: shot.stableShotId,
                  });
                  return;
                }
                const sourceStableShotId = event.dataTransfer.getData(
                  STORYBOARD_SHOT_DRAG_MIME
                );
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
                            STORYBOARD_VIDEO_CLIP_DRAG_MIME,
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
                              onMove: (deltaFrames, deltaVisualLayers) => {
                                onNudgeVisualClip({
                                  clipId: videoClipId(segment.clip!.id),
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
                        STORYBOARD_SHOT_DRAG_MIME,
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
  const [pasteMenu, setPasteMenu] = useState<VisualPasteMenuState | null>(null);
  const [pastePending, setPastePending] = useState(false);
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
  const activeTimingGestureRef = useRef<symbol | null>(null);
  const shotTimingPreviewCallbackRef = useRef(onShotTimingPreviewChange);
  shotTimingPreviewCallbackRef.current = onShotTimingPreviewChange;
  const storySessionKeyRef = useRef(timeline.storySessionKey);
  const renderedStorySessionToken = useMemo(
    () => Symbol("storyboard-async-session"),
    [timeline.storySessionKey]
  );
  const asyncSessionGuardRef = useRef(
    createStoryboardAsyncSessionGuard(renderedStorySessionToken)
  );
  const isStorySessionTokenCurrent = useCallback(
    (candidate: symbol) =>
      asyncSessionGuardRef.current.isCurrent(candidate) &&
      timeline.isStorySessionCurrent?.() !== false,
    [timeline.isStorySessionCurrent]
  );
  const isRenderedStorySessionCurrent = useCallback(
    () => isStorySessionTokenCurrent(renderedStorySessionToken),
    [isStorySessionTokenCurrent, renderedStorySessionToken]
  );
  const childTimeline = useMemo<StoryboardBoardTimeline>(
    () => ({
      ...timeline,
      isStorySessionCurrent: isRenderedStorySessionCurrent,
    }),
    [isRenderedStorySessionCurrent, timeline]
  );
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
    setPasteMenu(null);
    setPastePending(false);
    focusReturnRef.current = null;
  }, [controlledSelectedVisualObject, selectedShotNo, shots]);
  useLayoutEffect(() => {
    // Only a committed render may advance the guard. An interrupted concurrent
    // render never reaches this effect and therefore cannot invalidate A.
    asyncSessionGuardRef.current.commit(renderedStorySessionToken);
    if (storySessionKeyRef.current === timeline.storySessionKey) return;
    storySessionKeyRef.current = timeline.storySessionKey;
    if (controlledSelectedVisualObject === undefined)
      setLocalSelectedVisualObject(null);
    onSelectVisualObject?.(null);
    setMenu(null);
    setObjectMenu(null);
    setGapMenu(null);
    setPendingAction(null);
    setPendingObjectKey(null);
    setGapTransitionPending(false);
    setStatusMessage(null);
    setMarkInMs(null);
    setFocusedAnchorId(null);
    const activeTimingGesture = activeTimingGestureRef.current;
    activeTimingGestureRef.current = null;
    if (activeTimingGesture)
      shotTimingPreviewCallbackRef.current?.(null, activeTimingGesture);
    projectedShotNoRef.current = undefined;
    pendingMenuItemRef.current = null;
    pendingGuardRef.current = createVisualObjectPendingGuard();
    focusReturnRef.current = null;
  }, [
    controlledSelectedVisualObject,
    onSelectVisualObject,
    renderedStorySessionToken,
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
  const visualObjectLayer = (object: VisualObjectRef): number | null => {
    if (object.type === "story-shot") {
      const item = timelineItems.find(
        candidate => candidate.stableShotId === object.stableShotId
      );
      return item == null ? null : Math.max(0, item.visualLayer ?? 0);
    }
    const owner = timelineItems.find(
      candidate => candidate.stableShotId === object.ownerStableShotId
    );
    if (!owner) return null;
    if (object.type === "owned-video-clip") {
      const clip = owner.visualClips?.find(
        candidate => candidate.id === object.clipId
      );
      return clip == null
        ? null
        : Math.max(0, clip.visualLayer ?? owner.visualLayer ?? 0);
    }
    const clip = owner.imageClips?.find(
      candidate => candidate.id === object.clipId
    );
    return clip == null ? null : Math.max(0, clip.visualLayer);
  };
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
    const sessionToken = renderedStorySessionToken;
    setStatusMessage("正在保存图层…");
    void timeline
      .onManageVisualLayer(action)
      .then(() => {
        if (isStorySessionTokenCurrent(sessionToken))
          setStatusMessage("图层已更新");
      })
      .catch(error => {
        if (!isStorySessionTokenCurrent(sessionToken)) return;
        setStatusMessage(
          error instanceof Error ? error.message : "图层更新失败"
        );
      });
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
  const openObjectMenu = useCallback(
    (next: VisualObjectMenuState) => {
      const trackRect = trackRef.current?.getBoundingClientRect();
      const timelineFrame = storyboardVisualObjectMenuTimelineFrame({
        explicitTimelineFrame: next.timelineFrame,
        clientX: next.clientX,
        trackLeft: trackRect?.left ?? null,
        viewport,
        playheadMs: timeline.playheadMs,
      });
      setMenu(null);
      setGapMenu(null);
      setObjectMenu({
        ...next,
        timelineFrame,
        visualLayer: next.visualLayer ?? visualObjectLayer(next.object) ?? 0,
      });
    },
    [timeline.playheadMs, timelineItems, viewport]
  );
  const pasteVisualObject = useCallback(
    (context: { timelineFrame: number; visualLayer?: number }) => {
      if (!timeline.onPasteVisualObject || pastePending) return;
      const sessionToken = renderedStorySessionToken;
      setPastePending(true);
      void timeline
        .onPasteVisualObject(context)
        .then(() => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          setPasteMenu(null);
          setStatusMessage("素材已粘贴");
        })
        .catch(error => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          setStatusMessage(error instanceof Error ? error.message : "粘贴失败");
        })
        .finally(() => {
          if (isStorySessionTokenCurrent(sessionToken)) setPastePending(false);
        });
    },
    [
      pastePending,
      timeline,
      isStorySessionTokenCurrent,
      renderedStorySessionToken,
    ]
  );
  const runObjectCommand = useCallback(
    (command: VisualObjectCommand) => {
      if (!objectMenu || !timeline.onVisualObjectCommand) return;
      const object = objectMenu.object;
      if (
        timeline.isVisualObjectCommandAvailable &&
        !timeline.isVisualObjectCommandAvailable(object, command, {
          timelineFrame:
            objectMenu.timelineFrame ??
            Math.max(0, Math.round((timeline.playheadMs * 30) / 1_000)),
          visualLayer: objectMenu.visualLayer ?? visualObjectLayer(object) ?? 0,
        })
      ) {
        return;
      }
      const key = visualObjectRefKey(object);
      const sessionToken = renderedStorySessionToken;
      pendingMenuItemRef.current =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.getAttribute("role") === "menuitem"
          ? document.activeElement
          : null;
      setPendingObjectKey(key);
      void pendingGuardRef.current
        .run(key, () =>
          timeline.onVisualObjectCommand!(object, command, {
            timelineFrame:
              objectMenu.timelineFrame ??
              Math.max(0, Math.round((timeline.playheadMs * 30) / 1_000)),
            visualLayer:
              objectMenu.visualLayer ?? visualObjectLayer(object) ?? 0,
          })
        )
        .then(result => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          if (result !== null) closeObjectMenu();
        })
        .catch(error => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          setStatusMessage(
            error instanceof Error ? error.message : "对象操作失败，请重试"
          );
          pendingMenuItemRef.current?.focus({ preventScroll: true });
        })
        .finally(() => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          pendingMenuItemRef.current = null;
          setPendingObjectKey(null);
        });
    },
    [closeObjectMenu, objectMenu, timeline]
  );
  const runSelectedObjectCommand = useCallback(
    (
      command: VisualObjectCommand,
      context: { timelineFrame: number; visualLayer: number }
    ) => {
      const object = selectedVisualObject;
      if (!object || !timeline.onVisualObjectCommand) return false;
      if (
        timeline.isVisualObjectCommandAvailable &&
        !timeline.isVisualObjectCommandAvailable(object, command, context)
      )
        return false;
      const key = visualObjectRefKey(object);
      const sessionToken = renderedStorySessionToken;
      setPendingObjectKey(key);
      void pendingGuardRef.current
        .run(key, () =>
          timeline.onVisualObjectCommand!(object, command, context)
        )
        .catch(error => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          setStatusMessage(
            error instanceof Error ? error.message : "对象操作失败，请重试"
          );
        })
        .finally(() => {
          if (isStorySessionTokenCurrent(sessionToken))
            setPendingObjectKey(null);
        });
      return true;
    },
    [
      selectedVisualObject,
      timeline,
      renderedStorySessionToken,
      isStorySessionTokenCurrent,
    ]
  );

  const createGapTransition = (target: GapMenuState) => {
    if (!timeline.onCreateGapTransition || gapTransitionPending) return;
    closeGapMenu();
    setGapTransitionPending(true);
    const sessionToken = renderedStorySessionToken;
    void Promise.resolve(
      timeline.onCreateGapTransition({
        beforeStableShotId: target.before.stableShotId,
        afterStableShotId: target.after.stableShotId,
      })
    )
      .then(result => {
        if (!isStorySessionTokenCurrent(sessionToken)) return;
        setStatusMessage(
          result?.applied
            ? "已在聊天里生成待确认的过渡镜头卡片"
            : (result?.reason ?? "创建过渡镜头失败")
        );
      })
      .finally(() => {
        if (isStorySessionTokenCurrent(sessionToken))
          setGapTransitionPending(false);
      });
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
  const selectedOperationLayer = selectedVisualObject
    ? visualObjectLayer(selectedVisualObject)
    : null;

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
    const sessionToken = renderedStorySessionToken;
    setPendingAction("removeAnchor");
    void Promise.resolve(
      timeline.onRemoveAnchor({
        stableShotId: anchor.stableShotId,
        anchorId: anchor.id,
      })
    )
      .then(result => {
        if (!isStorySessionTokenCurrent(sessionToken)) return;
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
      .finally(() => {
        if (isStorySessionTokenCurrent(sessionToken)) setPendingAction(null);
      });
  };

  const addAnchor = (ms: number) => {
    if (!timeline.onAddAnchor || pendingAction) return;
    setPendingAction("addAnchor");
    const sessionToken = renderedStorySessionToken;
    void Promise.resolve(timeline.onAddAnchor(frameAt(ms)))
      .then(result => {
        if (!isStorySessionTokenCurrent(sessionToken)) return;
        setStatusMessage(
          result?.applied ? "已钉下位置锚点" : (result?.reason ?? "打标失败")
        );
      })
      .finally(() => {
        if (isStorySessionTokenCurrent(sessionToken)) setPendingAction(null);
      });
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
      const sessionToken = renderedStorySessionToken;
      void timeline
        .onDetachTimelineMagnet({
          leftStableShotId: magneticJoin.leftStableShotId,
          rightStableShotId: magneticJoin.rightStableShotId,
        })
        .then(result => {
          if (!isStorySessionTokenCurrent(sessionToken)) return;
          setStatusMessage(
            result.applied
              ? "已取消这两个镜头的吸附"
              : (result.reason ?? "取消吸附失败")
          );
        })
        .finally(() => {
          if (isStorySessionTokenCurrent(sessionToken)) setPendingAction(null);
        });
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
        done = timeline.onSplitAt(atMs, shot.stableShotId);
        break;
      case "extract":
        done = timeline.onExtractFrameAt(
          atMs,
          selectedOperationLayer ??
            Math.max(0, shot.timelineItem?.visualLayer ?? 0)
        );
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
    const sessionToken = renderedStorySessionToken;
    void Promise.resolve(done)
      .catch(error => {
        if (!isStorySessionTokenCurrent(sessionToken)) return;
        setStatusMessage(
          error instanceof Error ? error.message : "剪辑操作失败，请重试"
        );
      })
      .finally(() => {
        if (isStorySessionTokenCurrent(sessionToken)) setPendingAction(null);
      });
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
    const selectedObjectContext = selectedVisualObject
      ? {
          timelineFrame: Math.max(
            0,
            Math.round((headRef.current * 30) / 1_000)
          ),
          visualLayer: visualObjectLayer(selectedVisualObject) ?? 0,
        }
      : null;
    const objectRoute = storyboardVisualObjectShortcutRoute({
      shortcut,
      selectedObject: selectedVisualObject,
      commandAvailable: (object, command) =>
        Boolean(
          timeline.onVisualObjectCommand &&
            (!timeline.isVisualObjectCommandAvailable ||
              timeline.isVisualObjectCommandAvailable(object, command, {
                timelineFrame: selectedObjectContext?.timelineFrame ?? 0,
                visualLayer:
                  selectedObjectContext?.visualLayer ??
                  visualObjectLayer(object) ??
                  0,
              }))
        ),
    });
    if (shortcut.kind === "copyVisualObject" && objectRoute.kind === "legacy")
      return;
    if (
      shortcut.kind === "pasteVisualObject" &&
      (!timeline.canPasteVisualObject || !timeline.onPasteVisualObject)
    )
      return;
    if (
      objectRoute.kind === "legacy" &&
      shortcut.kind === "action" &&
      storyboardEditNeedsRowFocus(shortcut.action) &&
      !rowRef.current?.contains(document.activeElement)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (objectRoute.kind === "blocked") return;
    if (objectRoute.kind === "object") {
      if (selectedObjectContext) {
        runSelectedObjectCommand(objectRoute.command, selectedObjectContext);
      }
      return;
    }
    switch (shortcut.kind) {
      case "copyVisualObject":
        return;
      case "pasteVisualObject":
        pasteVisualObject({
          timelineFrame: Math.max(
            0,
            Math.round((headRef.current * 30) / 1_000)
          ),
          ...(selectedOperationLayer == null
            ? {}
            : { visualLayer: selectedOperationLayer }),
        });
        return;
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
            'select, [role="combobox"], [role="dialog"], [role="menu"], [aria-haspopup="menu"], [data-renaming="true"], [data-rename-input="true"], [data-timeline-media-keyboard="true"]'
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

  const selectedSubtitleCue =
    timeline.subtitle?.cues.find(
      cue => cue.id === timeline.subtitle?.selectedCueId
    ) ?? null;
  const showMediaInspector = Boolean(
    selectedSubtitleCue || timeline.audio?.selectedClipId
  );

  return (
    <>
      {Array.from(
        { length: Math.max(1, visualLayerState.count - 1) },
        (_, index) => visualLayerState.count - 1 - index
      ).map((visualLayer, index) => (
        <StoryboardVisualLayerRow
          key={`${timeline.storySessionKey ?? "legacy-story"}:persisted-visual-layer-${visualLayer}`}
          shots={shots}
          timeline={childTimeline}
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
          onOpenPasteMenu={setPasteMenu}
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
            key={`${timeline.storySessionKey ?? "legacy-story"}:main-visual-track`}
            timeline={childTimeline}
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
            onOpenPasteMenu={setPasteMenu}
          />
        </div>
      </div>
      {/* 固定语义顺序：视觉层 → 主画面 → 字幕 → 五类声音。 */}
      {timeline.subtitle ? (
        <>
          <SubtitleRowHeader
            actions={
              timeline.addMedia ? (
                <AddTimelineMediaMenu {...timeline.addMedia} />
              ) : undefined
            }
          />
          <div
            role="cell"
            style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
          >
            <SubtitleTrackRow
              binding={timeline.subtitle}
              viewport={viewport}
              playheadMs={timeline.playheadMs}
              disabled={timeline.writePending === true}
            />
          </div>
        </>
      ) : null}
      {timeline.audio ? (
        <AudioTrackSection
          storyId={timeline.audio.storyId}
          audioState={timeline.audio.audioState}
          viewport={viewport}
          playheadMs={timeline.playheadMs}
          selectedClipId={timeline.audio.selectedClipId}
          pending={timeline.audio.pending}
          error={timeline.audio.error}
          onSelectClip={timeline.audio.onSelectClip}
          onMove={timeline.audio.onMove}
          onTrim={timeline.audio.onTrim}
          onDelete={timeline.audio.onDelete}
          onRequestAdd={() => undefined}
          addControl={
            timeline.addMedia ? (
              <AddTimelineMediaMenu
                {...timeline.addMedia}
                triggerLabel="添加声音"
              />
            ) : undefined
          }
          columnSpan={columnSpan}
        />
      ) : (
        <>
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
        </>
      )}
      {timeline.audio &&
      timeline.formalAudioPresent !== true &&
      timeline.audioClips.length > 0 ? (
        <>
          <StoryboardAudioRowHeader legacy />
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
        </>
      ) : null}
      {timeline.subtitle && showMediaInspector ? (
        <>
          <div
            role="rowheader"
            className="sticky left-0 z-20 flex items-center border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
            style={{
              borderColor:
                "color-mix(in srgb, var(--panel-border) 62%, transparent)",
              background: "var(--background)",
            }}
          >
            属性
          </div>
          <div
            role="cell"
            className="border-b border-r p-1"
            style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
          >
            <TimelineMediaInspector
              subtitleState={{
                tracks: [
                  { id: "subtitle-main", cues: [...timeline.subtitle.cues] },
                ],
              }}
              selectedCue={selectedSubtitleCue}
              audioState={timeline.audio?.audioState}
              selectedAudioClipId={timeline.audio?.selectedClipId}
              playheadFrame={Math.max(
                0,
                Math.round((timeline.playheadMs * 30) / 1_000)
              )}
              pending={timeline.audio?.pending ?? timeline.subtitle.pending}
              onSplit={timeline.subtitle.onSplit}
              onMerge={timeline.subtitle.onMerge}
              onDelete={timeline.subtitle.onDelete}
              onSetAudioGain={timeline.audio?.onSetGain}
              onSetAudioMuted={timeline.audio?.onSetMuted}
              onSetAudioFade={timeline.audio?.onSetFade}
              onReclassifyAudio={timeline.audio?.onReclassify}
              onDeleteAudio={timeline.audio?.onDelete}
              narrationCandidates={timeline.audio?.narrationCandidates}
              onGenerateNarration={timeline.audio?.onGenerateNarration}
              onAdoptNarrationCandidate={
                timeline.audio?.onAdoptNarrationCandidate
              }
              onDiscardNarrationCandidate={
                timeline.audio?.onDiscardNarrationCandidate
              }
            />
          </div>
        </>
      ) : null}
      {gapMenu ? (
        <StoryboardEditGapMenu
          menu={gapMenu}
          pending={gapTransitionPending}
          onCreate={() => createGapTransition(gapMenu)}
          onClose={closeGapMenu}
          onPaste={
            timeline.canPasteVisualObject
              ? () => {
                  const target = gapMenu;
                  closeGapMenu();
                  pasteVisualObject({
                    timelineFrame: Math.max(
                      0,
                      Math.round((target.atMs * 30) / 1_000)
                    ),
                    visualLayer: 0,
                  });
                }
              : undefined
          }
        />
      ) : null}
      {pasteMenu ? (
        <StoryboardVisualPasteMenu
          menu={pasteMenu}
          pending={pastePending}
          onPaste={() => pasteVisualObject(pasteMenu)}
          onClose={() => setPasteMenu(null)}
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
          commandAvailable={command =>
            Boolean(
              timeline.onVisualObjectCommand &&
                (!timeline.isVisualObjectCommandAvailable ||
                  timeline.isVisualObjectCommandAvailable(
                    objectMenu.object,
                    command,
                    {
                      timelineFrame:
                        objectMenu.timelineFrame ??
                        Math.max(
                          0,
                          Math.round((timeline.playheadMs * 30) / 1_000)
                        ),
                      visualLayer:
                        objectMenu.visualLayer ??
                        visualObjectLayer(objectMenu.object) ??
                        0,
                    }
                  ))
            )
          }
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
