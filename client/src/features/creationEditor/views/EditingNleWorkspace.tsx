import {
  Captions,
  Clapperboard,
  ClipboardPaste,
  Copy,
  FileUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  Scissors,
  SkipBack,
  Upload,
  Video,
  Volume2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { displayShotCode } from "@shared/shotIdentity";
import type {
  StoryTimelineVisualClip,
  StoryTimelineImageClip,
  StoryTimelineOverlay,
  TimelineTransform,
  TimelineVideoEffects,
  StoryTimelineItem,
} from "@shared/storyMaterial";
import {
  timelineImageClipStartFrame,
  timelineOffsetMsToFrames,
} from "@shared/storyMaterial";
import { DEFAULT_TIMELINE_VIDEO_EFFECTS } from "@shared/storyMaterial";
import {
  buildTimelineLayout,
  resolveTimelineDocumentFrame,
} from "@shared/timelineLayout";
import { extractedFrameTimeMs } from "@shared/extractedFrameTransition";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import StoryboardPanel from "@/features/storyAgent/views/StoryboardPanel";
import {
  storyboardAudioTimelineTotalMs,
  type StoryboardAudioClip,
} from "./StoryboardAudioWaveform";
import {
  buildStoryboardTimingRows,
  storyboardTimingTotalMs,
  storyboardTimingWinnerAt,
  formatStoryboardTimestamp,
} from "@/features/storyAgent/storyboardTiming";
import {
  chatCutBaseName,
  chatCutCueCode,
  chatCutPlaybackAudioTracks,
  chatCutSourceNameFromShot,
  type ChatCutTimelineClip,
  type ChatCutTimelineManifest,
} from "../chatCutTimeline";
import {
  creationTimelineShotId,
  resolveTimelineShots,
  useCreationEditor,
} from "../CreationEditorContext";
import { timelineMagneticJoins } from "../timelineActions";
import type { CreationEditorShot } from "../types";
import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
  stepTimelinePlayheadByFrames,
  timelineMsFromClientX,
} from "../timelinePlayhead";
import { videoTakeAffordance, videoTakeFrameUrl } from "../videoAssetViewModel";
import {
  editedTimelineDurationMs,
  normalizeVideoClipEditDraft,
  videoClipboardPayloadFromTarget,
  videoClipboardPlannedDurationSec,
  videoClipEditorTargetForTake,
  videoClipEditorTargetForVisualClip,
  timelineVideoMotionStyle,
  type VideoClipboardPayload,
  type VideoClipEditDraft,
  type VideoClipEditorTarget,
} from "../videoClipEditorModel";
import {
  imageClipEditorTargetForShot,
  timelineTransformStyle,
  type ImageClipEditDraft,
  type ImageClipEditorTarget,
} from "../imageClipEditorModel";
import ImageClipEditorPanel from "./ImageClipEditorPanel";
import VideoClipEditorPanel from "./VideoClipEditorPanel";
import type { StoryboardBoardTimeline } from "./StoryboardEditRow";
import ExtractedFrameTransitionRequirementsDialog from "./ExtractedFrameTransitionRequirementsDialog";
import {
  storyboardEditSelectionSummary,
  storyboardEditShouldFollowSelectionToShot,
  type StoryboardEditRange,
} from "../storyboardEditRow";
import { shouldHandleCreationEditorUndoShortcut } from "../timelineUndoStore";

const MIN_TIMELINE_SCALE = 8;
const MAX_TIMELINE_SCALE = 42;
const DEFAULT_STORYBOARD_PANEL_SIZE = 50;
const DEFAULT_PREVIEW_PANEL_SIZE = 50;
const PREVIEW_CANVAS_INSET_PX = 12;

type VideoEditorPreview = {
  target: VideoClipEditorTarget;
  draft: VideoClipEditDraft;
};

export function fitProjectCanvas(input: {
  stageWidth: number;
  stageHeight: number;
  projectWidth: number;
  projectHeight: number;
  inset?: number;
}) {
  const inset = Number.isFinite(input.inset)
    ? Math.max(0, input.inset ?? 0)
    : 0;
  const availableWidth = Math.max(0, input.stageWidth - inset);
  const availableHeight = Math.max(0, input.stageHeight - inset);
  const projectWidth =
    Number.isFinite(input.projectWidth) && input.projectWidth > 0
      ? input.projectWidth
      : 1;
  const projectHeight =
    Number.isFinite(input.projectHeight) && input.projectHeight > 0
      ? input.projectHeight
      : 1;
  const projectAspect = projectWidth / projectHeight;

  if (availableWidth === 0 || availableHeight === 0) {
    return { width: 0, height: 0 };
  }
  if (availableWidth / availableHeight > projectAspect) {
    return {
      width: Math.floor(availableHeight * projectAspect),
      height: Math.floor(availableHeight),
    };
  }
  return {
    width: Math.floor(availableWidth),
    height: Math.floor(availableWidth / projectAspect),
  };
}

function shotLabel(
  shot: Pick<CreationEditorShot, "cueCode" | "shotKey" | "shotNo">
) {
  return displayShotCode(shot);
}

function playableVideoUrl(shot: CreationEditorShot | null): string | null {
  if (!shot) return null;
  if (
    shot.selectedVideoTake?.videoUrl &&
    videoTakeAffordance(shot.selectedVideoTake.status).canPlay
  ) {
    return shot.selectedVideoTake.videoUrl;
  }
  return (
    shot.videoTakes?.find(
      take => Boolean(take.videoUrl) && videoTakeAffordance(take.status).canPlay
    )?.videoUrl ?? null
  );
}

function shotImageUrl(shot: CreationEditorShot | null): string | null {
  return shot?.imageUrl || shot?.promptRun?.imageUrl || null;
}

const PREVIEW_CONTROL_PAUSE_WINDOW_MS = 1_200;

export function shouldForwardPreviewPause(input: {
  timelinePlaying: boolean;
  ignoreNextPause: boolean;
  mediaIsCurrent: boolean;
  mediaConnected: boolean;
  mediaEnded: boolean;
  lastInteractionAtMs: number | null;
  nowMs: number;
}): boolean {
  const interactionAgeMs =
    input.lastInteractionAtMs == null
      ? null
      : input.nowMs - input.lastInteractionAtMs;
  return (
    input.timelinePlaying &&
    !input.ignoreNextPause &&
    input.mediaIsCurrent &&
    input.mediaConnected &&
    !input.mediaEnded &&
    interactionAgeMs != null &&
    interactionAgeMs >= 0 &&
    interactionAgeMs <= PREVIEW_CONTROL_PAUSE_WINDOW_MS
  );
}

export type EditingShortcutTargetKind = "text" | "button" | "other";

/** Preview/时间线悬停快捷键：按钮焦点可以接管，文字输入始终让开。 */
export function shouldHandleEditingShortcut(input: {
  key: string;
  zoneActive: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  targetKind: EditingShortcutTargetKind;
}): boolean {
  const isArrowKey =
    input.key === "ArrowLeft" || input.key === "ArrowRight";
  const isSpaceKey = input.key === " " || input.key === "Spacebar";
  return (
    (isArrowKey || isSpaceKey) &&
    input.zoneActive &&
    !input.defaultPrevented &&
    !input.metaKey &&
    !input.ctrlKey &&
    !input.altKey &&
    input.targetKind !== "text"
  );
}

export type TimelineVideoSource = {
  shotNo: number;
  stableShotId: string;
  takeStableShotId: string;
  takeId: number;
  rangeId: number | null;
  videoUrl: string;
  sourceStartSec: number;
  sourceEndSec: number;
  sourceTimeSec: number;
  offsetMs: number;
  durationMs: number;
  existingClipId: string | null;
  label: string;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
  overlayId?: string;
  visualLayer: number;
};

export function extractedFrameTargetVisualLayer(
  source: { visualLayer: number }
): number {
  return Math.max(0, Math.round(source.visualLayer)) + 1;
}

const VIDEO_END_HOLD_EPSILON_SECONDS = 1 / 120;

export function timelineVideoPlaybackRate(
  source: Pick<
    TimelineVideoSource,
    "sourceStartSec" | "sourceEndSec" | "durationMs"
  > & { effects?: TimelineVideoEffects }
): number {
  if (source.effects) return source.effects.playbackRate;
  const sourceDurationSec = Math.max(
    0,
    source.sourceEndSec - source.sourceStartSec
  );
  const timelineDurationSec = Math.max(0, source.durationMs / 1_000);
  if (sourceDurationSec <= 0 || timelineDurationSec <= 0) return 1;
  return Math.min(4, Math.max(0.25, sourceDurationSec / timelineDurationSec));
}

export function timelineVideoShouldHoldLastFrame(input: {
  targetTimeSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  reverse?: boolean;
}): boolean {
  if (input.sourceEndSec <= input.sourceStartSec) return false;
  return input.reverse
    ? input.targetTimeSec <=
        input.sourceStartSec + VIDEO_END_HOLD_EPSILON_SECONDS
    : input.targetTimeSec >=
        input.sourceEndSec - VIDEO_END_HOLD_EPSILON_SECONDS;
}

export function timelineVideoSourceForSelectedShot(
  source: TimelineVideoSource | null | undefined,
  selectedShotNo: number | null | undefined
): TimelineVideoSource | null {
  return source && source.shotNo === selectedShotNo ? source : null;
}

export function timelineVisualClipFrameUrl(
  clip: Pick<StoryTimelineVisualClip, "takeId" | "rangeId" | "sourceStartSec">
): string {
  return `/api/video-frames/${clip.takeId}?atSec=${clip.sourceStartSec.toFixed(3)}&rangeId=${clip.rangeId}`;
}

export function resolveTimelineImageClip(
  items: readonly StoryTimelineItem[],
  timelineFrame: number
) {
  const frame = Math.max(0, Math.round(timelineFrame));
  return buildTimelineLayout(items)
    .flatMap(row =>
      (row.item.imageClips ?? []).map(clip => ({
        clip,
        stableShotId: row.item.stableShotId,
        startFrame: timelineImageClipStartFrame(clip, row.startFrame),
      }))
    )
    .filter(
      candidate =>
        frame >= candidate.startFrame &&
        frame < candidate.startFrame + candidate.clip.durationFrames
    )
    .sort(
      (left, right) =>
        right.clip.visualLayer - left.clip.visualLayer ||
        right.startFrame - left.startFrame ||
        right.clip.id.localeCompare(left.clip.id)
    )[0] ?? null;
}

export function timelineImageWinsVisualOverlap(
  image: { clip: Pick<StoryTimelineImageClip, "visualLayer"> } | null,
  video: Pick<TimelineVideoSource, "visualLayer"> | null
): boolean {
  if (!image) return false;
  return !video || image.clip.visualLayer >= video.visualLayer;
}

export function duplicatedTimelineImageClipId(input: {
  imageId: number;
  timelineFrame: number;
  visualLayer: number;
  nonce?: string;
}): string {
  const nonce = input.nonce ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `image-clip-${input.imageId}-${Math.max(0, Math.round(input.timelineFrame))}-${Math.max(0, Math.round(input.visualLayer))}-${nonce}`;
}

/**
 * 镜头列表里带着的时间线条目。绝对帧位置和位置锚点都在这里面，
 * 没有它就只能退回「按时长依次累加」，画不出 gap 和 overlap。
 */
function timelineItemsForShots(
  shots: readonly CreationEditorShot[]
): StoryTimelineItem[] {
  return shots.flatMap(shot => (shot.timelineItem ? [shot.timelineItem] : []));
}

export function resolveTimelineVideoSource(
  shots: CreationEditorShot[],
  timelineShotIds: string[],
  playheadMs: number,
  overlays: readonly StoryTimelineOverlay[] = []
): TimelineVideoSource | null {
  const timelineItems = timelineItemsForShots(shots);
  const timelineFrame = Math.max(0, Math.round((playheadMs * 30) / 1_000));
  const documentResolution = resolveTimelineDocumentFrame({
    items: timelineItems,
    overlays,
    frame: timelineFrame,
  });
  if (documentResolution.kind === "gap") return null;
  if (documentResolution.kind === "overlay") {
    const overlay = documentResolution.overlay;
    const sourceShot = shots.find(
      shot => creationTimelineShotId(shot) === overlay.sourceStableShotId
    );
    const durationFrames = overlay.mediaEndFrame - overlay.startFrame;
    const sourceTimeSec = Math.min(
      durationFrames / 30,
      Math.max(0, documentResolution.localFrame / 30)
    );
    return {
      shotNo: sourceShot?.shotNo ?? 1,
      stableShotId: overlay.sourceStableShotId,
      takeStableShotId: overlay.sourceStableShotId,
      takeId: overlay.takeId,
      rangeId: null,
      videoUrl: overlay.videoUrl,
      sourceStartSec: 0,
      sourceEndSec: durationFrames / 30,
      sourceTimeSec,
      offsetMs: 0,
      durationMs: (durationFrames * 1000) / 30,
      existingClipId: null,
      label: "抽帧生成的上层覆盖视频",
      effects: overlay.effects ?? { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      transform: overlay.transform,
      overlayId: overlay.id,
      visualLayer: 1,
    };
  }
  const timings = buildStoryboardTimingRows(
    shots,
    timelineShotIds,
    timelineItems
  );
  const totalMs = storyboardTimingTotalMs(timings);
  const lookupMs = Math.min(Math.max(0, playheadMs), Math.max(0, totalMs - 1));
  // 空档就是空档：返回 null，让预览画黑场，不要退回上一镜的画面。
  const timing = storyboardTimingWinnerAt(timings, lookupMs);
  if (!timing) return null;
  const shot = shots.find(item => item.shotNo === timing.shotNo);
  if (!shot) return null;
  const stableShotId = creationTimelineShotId(shot);
  const localMs = Math.max(0, lookupMs - timing.startMs);
  const visualClip = [...(shot.timelineItem?.visualClips ?? [])]
    .sort((left, right) => right.offsetMs - left.offsetMs)
    .find(
      clip =>
        localMs >= clip.offsetMs && localMs < clip.offsetMs + clip.durationMs
    );
  if (visualClip) {
    const clipOffsetMs = localMs - visualClip.offsetMs;
    const editorTarget = videoClipEditorTargetForVisualClip({
      stableShotId,
      shotNo: shot.shotNo,
      cueCode: shot.cueCode,
      label: visualClip.label,
      clip: visualClip,
      timelineItem: shot.timelineItem,
      mediaDurationSec: shot.videoTakes?.find(
        take => take.id === visualClip.takeId
      )?.durationSec,
    });
    const progress = Math.min(
      1,
      Math.max(0, clipOffsetMs / visualClip.durationMs)
    );
    const directedProgress = editorTarget.effects.reverse
      ? 1 - progress
      : progress;
    return {
      shotNo: shot.shotNo,
      stableShotId,
      takeStableShotId: visualClip.sourceStableShotId,
      takeId: visualClip.takeId,
      rangeId: visualClip.rangeId,
      videoUrl: visualClip.videoUrl,
      sourceStartSec: visualClip.sourceStartSec,
      sourceEndSec: visualClip.sourceEndSec,
      sourceTimeSec:
        visualClip.sourceStartSec +
        (visualClip.sourceEndSec - visualClip.sourceStartSec) *
          directedProgress,
      offsetMs: visualClip.offsetMs,
      durationMs: visualClip.durationMs,
      existingClipId: visualClip.id,
      label: visualClip.label,
      effects: editorTarget.effects,
      transform: editorTarget.transform,
      visualLayer: shot.timelineItem?.visualLayer ?? 0,
    };
  }
  if (shot.timelineItem?.visualClipsReplacePrimary) return null;

  const take =
    shot.selectedVideoTake ??
    shot.videoTakes?.find(
      item => Boolean(item.videoUrl) && videoTakeAffordance(item.status).canPlay
    );
  if (!take?.videoUrl) return null;
  const editorTarget = videoClipEditorTargetForTake({
    stableShotId,
    shotNo: shot.shotNo,
    cueCode: shot.cueCode,
    label: shotLabel(shot),
    take,
    timelineItem: shot.timelineItem,
  });
  if (!editorTarget) return null;
  const sourceStartSec = editorTarget.sourceStartSec;
  const sourceEndSec = editorTarget.sourceEndSec;
  const progress = Math.min(1, Math.max(0, localMs / timing.durationMs));
  const directedProgress = editorTarget.effects.reverse
    ? 1 - progress
    : progress;
  return {
    shotNo: shot.shotNo,
    stableShotId,
    takeStableShotId: take.stableShotId,
    takeId: take.id,
    rangeId: editorTarget.rangeId,
    videoUrl: take.videoUrl,
    sourceStartSec,
    sourceEndSec,
    sourceTimeSec:
      sourceStartSec + (sourceEndSec - sourceStartSec) * directedProgress,
    offsetMs: 0,
    durationMs: timing.durationMs,
    existingClipId: null,
    label: shotLabel(shot),
    effects: editorTarget.effects,
    transform: editorTarget.transform,
    visualLayer: shot.timelineItem?.visualLayer ?? 0,
  };
}

function chatCutClipIdFromShot(shot: CreationEditorShot | null): string | null {
  if (shot?.chatCutMapping?.itemId) return shot.chatCutMapping.itemId;
  if (!shot?.note) return null;
  return /^ChatCut XML\s+([^｜\s]+)/.exec(shot.note)?.[1] ?? null;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separator = value.indexOf(",");
      if (separator < 0) reject(new Error("文件编码失败"));
      else resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function mediaMime(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  return "video/mp4";
}

function isVisualFile(file: File) {
  return /^(image|video)\//.test(mediaMime(file));
}

export function timelineSubtitleText(
  manifest: ChatCutTimelineManifest | null,
  playheadMs: number,
  fallbackDialogue?: string | null
): string | null {
  const fallback = fallbackDialogue?.trim() || null;
  if (!manifest) return fallback;
  const activeVoiceClip = chatCutPlaybackAudioTracks(manifest)
    .flatMap(track => track.clips)
    .find(
      clip =>
        Boolean(chatCutCueCode(clip.name)) &&
        playheadMs >= clip.startMs &&
        playheadMs < clip.endMs
    );
  if (!activeVoiceClip) return null;
  const cueCode = chatCutCueCode(activeVoiceClip.name);
  const scriptedText = cueCode
    ? manifest.scriptCues.find(cue => cue.code === cueCode)?.text.trim()
    : "";
  return scriptedText || fallback;
}

function EditingStoryboardPanel({
  onRelink,
  relinkProgress,
  onAttachXml,
  attachProgress,
  onEditVideo,
  onEditImage,
  onCopyVideo,
  onPasteVideo,
  videoClipboardLabel,
  boardTimeline,
}: {
  boardTimeline: StoryboardBoardTimeline;
  onRelink: (files: File[]) => Promise<void>;
  relinkProgress: string | null;
  onAttachXml: (file: File) => Promise<void>;
  attachProgress: string | null;
  onEditVideo: (target: VideoClipEditorTarget) => void;
  onEditImage: (target: ImageClipEditorTarget) => void;
  onCopyVideo: (target: VideoClipEditorTarget) => void;
  onPasteVideo: (input: {
    stableShotId: string;
    shotNo: number;
    mode?: "replace" | "append";
    targetOffsetMs?: number;
  }) => Promise<void>;
  videoClipboardLabel: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="Storyboard"
      data-editing-surface="storyboard"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0) void onRelink(files);
        }}
      />
      <input
        ref={xmlInputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void onAttachXml(file);
        }}
      />
      <div className="min-h-0 flex-1">
        <StoryboardPanel
          defaultViewMode="full"
          embeddedEditorMode
          boardTimeline={boardTimeline}
          onEditVideo={onEditVideo}
          onEditImage={onEditImage}
          onCopyVideo={onCopyVideo}
          onPasteVideo={onPasteVideo}
          videoClipboardLabel={videoClipboardLabel}
          headerAction={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => xmlInputRef.current?.click()}
                disabled={Boolean(attachProgress)}
                className="flex h-7 w-7 items-center justify-center rounded-sm bg-muted/50 text-muted-foreground transition hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
                aria-label={attachProgress || "同步 ChatCut XML"}
                title={
                  attachProgress || "把 ChatCut 时间线与音频轨同步到当前故事"
                }
              >
                {attachProgress ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileUp className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={Boolean(relinkProgress)}
                className="flex h-7 w-7 items-center justify-center rounded-sm bg-muted/50 text-muted-foreground transition hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
                aria-label={relinkProgress || "关联本地画面素材"}
                title={
                  relinkProgress || "选择图片或视频，按 XML 文件名自动关联镜头"
                }
              >
                {relinkProgress ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          }
        />
      </div>
    </aside>
  );
}

function ShotPreview({
  shot,
  timing,
  sourceClip,
  timelineVideoSource,
  timelineImageSource,
  editorPreview,
  suppressDefaultVideo,
  playheadMs,
  timelinePlaying,
  format,
  onRequestTimelinePlaying,
  keyboardShortcutZoneRef,
}: {
  shot: CreationEditorShot | null;
  timing?: { startMs: number; endMs: number; durationMs: number };
  sourceClip?: ChatCutTimelineClip | null;
  timelineVideoSource?: TimelineVideoSource | null;
  timelineImageSource?: {
    imageUrl: string;
    transform?: TimelineTransform;
  } | null;
  editorPreview?: VideoEditorPreview | null;
  suppressDefaultVideo?: boolean;
  playheadMs: number;
  timelinePlaying: boolean;
  format: ChatCutTimelineManifest | null;
  onRequestTimelinePlaying: (isPlaying: boolean) => void;
  keyboardShortcutZoneRef: { current: boolean };
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ignoreNextVideoPauseRef = useRef(false);
  const previewControlInteractionAtRef = useRef<number | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const [previewStageSize, setPreviewStageSize] = useState({
    width: 0,
    height: 0,
  });
  const normalizedEditorDraft = editorPreview
    ? normalizeVideoClipEditDraft(
        editorPreview.draft,
        editorPreview.target.mediaDurationSec
      )
    : null;
  const videoUrl =
    timelineImageSource
      ? null
      : editorPreview?.target.videoUrl ??
        timelineVideoSource?.videoUrl ??
        (suppressDefaultVideo ? null : playableVideoUrl(shot));
  const imageUrl =
    timelineImageSource?.imageUrl ??
    editorPreview?.target.posterUrl ??
    shotImageUrl(shot);
  const aspectRatio = format ? `${format.width} / ${format.height}` : "1 / 1";
  const formatLabel = format ? `${format.width}×${format.height}` : "1080×1080";
  const canvasSize = fitProjectCanvas({
    stageWidth: previewStageSize.width,
    stageHeight: previewStageSize.height,
    projectWidth: format?.width ?? 1,
    projectHeight: format?.height ?? 1,
    inset: PREVIEW_CANVAS_INSET_PX,
  });
  const timelineOffsetMs = timing
    ? Math.min(timing.durationMs, Math.max(0, playheadMs - timing.startMs))
    : 0;
  const sourceInMs = sourceClip?.sourceInMs ?? 0;
  const sourceDurationMs = Math.max(
    0,
    (sourceClip?.sourceOutMs ?? sourceInMs) - sourceInMs
  );
  const sourceStartSeconds =
    normalizedEditorDraft?.sourceStartSec ??
    timelineVideoSource?.sourceStartSec ??
    sourceInMs / 1_000;
  const sourceEndSeconds =
    normalizedEditorDraft?.sourceEndSec ??
    timelineVideoSource?.sourceEndSec ??
    (sourceClip?.sourceOutMs ?? sourceInMs) / 1_000;
  const playbackRate =
    normalizedEditorDraft?.effects.playbackRate ??
    timelineVideoPlaybackRate({
      sourceStartSec: sourceStartSeconds,
      sourceEndSec: sourceEndSeconds,
      durationMs: timelineVideoSource?.durationMs ?? timing?.durationMs ?? 0,
      effects: timelineVideoSource?.effects,
    });
  const reverse =
    normalizedEditorDraft?.effects.reverse ??
    timelineVideoSource?.effects.reverse ??
    false;
  const sourceVolume =
    normalizedEditorDraft?.effects.volume ??
    timelineVideoSource?.effects.volume ??
    1;
  const sourceMuted =
    normalizedEditorDraft?.effects.muted ??
    timelineVideoSource?.effects.muted ??
    false;
  const videoTransform =
    timelineImageSource?.transform ??
    normalizedEditorDraft?.transform ??
    timelineVideoSource?.transform;
  const videoMotionStyle = timelineVideoMotionStyle(
    normalizedEditorDraft?.effects ?? timelineVideoSource?.effects
  );
  const editorSourceOffsetSeconds = Math.min(
    Math.max(0, sourceEndSeconds - sourceStartSeconds),
    (timelineOffsetMs / 1_000) * playbackRate
  );
  const targetVideoTimeSeconds = normalizedEditorDraft
    ? reverse
      ? Math.max(
          sourceStartSeconds,
          sourceEndSeconds - editorSourceOffsetSeconds
        )
      : Math.min(
          sourceEndSeconds,
          sourceStartSeconds + editorSourceOffsetSeconds
        )
    : (timelineVideoSource?.sourceTimeSec ??
      (sourceInMs +
        (sourceDurationMs > 0
          ? Math.min(timelineOffsetMs, sourceDurationMs)
          : timelineOffsetMs)) /
        1000);
  const shouldHoldLastFrame = timelineVideoShouldHoldLastFrame({
    targetTimeSec: targetVideoTimeSeconds,
    sourceStartSec: sourceStartSeconds,
    sourceEndSec: sourceEndSeconds,
    reverse,
  });
  const subtitleText = timelineSubtitleText(format, playheadMs, shot?.dialogue);

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      setPreviewStageSize(current =>
        current.width === next.width && current.height === next.height
          ? current
          : next
      );
    };
    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const maximumTime = Math.max(0, video.duration - 0.001);
    const lastFrameTime = Math.min(
      maximumTime,
      Math.max(
        sourceStartSeconds,
        sourceEndSeconds - VIDEO_END_HOLD_EPSILON_SECONDS
      )
    );
    const targetTime = Math.min(
      shouldHoldLastFrame ? lastFrameTime : targetVideoTimeSeconds,
      maximumTime
    );
    const drift = Math.abs(video.currentTime - targetTime);
    video.defaultPlaybackRate = playbackRate;
    video.playbackRate = playbackRate;
    video.volume = sourceVolume;
    video.muted = sourceMuted;

    if (!timelinePlaying || shouldHoldLastFrame || reverse) {
      if (!video.paused) {
        ignoreNextVideoPauseRef.current = true;
        video.pause();
      }
      if (drift > 0.004) video.currentTime = targetTime;
      return;
    }

    if (drift > 0.35) video.currentTime = targetTime;
    if (video.paused) void video.play().catch(() => undefined);
  }, [
    playbackRate,
    reverse,
    shouldHoldLastFrame,
    sourceEndSeconds,
    sourceStartSeconds,
    targetVideoTimeSeconds,
    timelinePlaying,
    videoUrl,
    sourceMuted,
    sourceVolume,
  ]);

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[color:var(--panel-header)]"
      aria-label="Preview"
      onPointerEnter={() => {
        keyboardShortcutZoneRef.current = true;
      }}
      onPointerMove={() => {
        keyboardShortcutZoneRef.current = true;
      }}
      onPointerLeave={() => {
        keyboardShortcutZoneRef.current = false;
      }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <span className="editing-panel-heading">Preview</span>
          {shot ? (
            <span className="ml-2 font-mono text-[10px] text-primary">
              {shotLabel(shot)}
            </span>
          ) : null}
          <span
            className="ml-2 font-mono text-[9px] tabular-nums text-muted-foreground"
            title="项目画布尺寸"
          >
            {formatLabel}
          </span>
          {editorPreview ? (
            <span
              className="ml-2 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
              data-testid="editing-preview-live-draft"
            >
              参数预览
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {timing
            ? `${formatStoryboardTimestamp(timing.startMs)} / ${formatStoryboardTimestamp(timing.endMs)}`
            : "00:00.000"}
        </span>
      </div>

      <div className="flex min-h-[150px] flex-1 flex-col overflow-hidden bg-muted/35">
        <div
          ref={previewStageRef}
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          data-testid="editing-preview-stage"
        >
          <div
            className="relative flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-black shadow-sm"
            style={{
              aspectRatio,
              width: canvasSize.width || 180,
              height: canvasSize.height || 180,
            }}
            data-testid="editing-project-canvas"
            data-project-size={formatLabel}
          >
            {videoUrl ? (
              <div
                className="h-full w-full"
                style={videoMotionStyle}
                data-testid={
                  videoMotionStyle ? "editing-preview-heartbeat" : undefined
                }
              >
                <video
                  key={
                    editorPreview
                      ? `editor-${editorPreview.target.takeId}-${editorPreview.target.clipId ?? "primary"}`
                      : videoUrl
                  }
                  ref={videoRef}
                  src={videoUrl}
                  poster={imageUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  onPointerDown={() => {
                    previewControlInteractionAtRef.current = Date.now();
                  }}
                  onKeyDown={event => {
                    if (
                      event.key === " " ||
                      event.key === "Enter" ||
                      event.key.toLowerCase() === "k" ||
                      event.key === "MediaPlayPause"
                    ) {
                      previewControlInteractionAtRef.current = Date.now();
                    }
                  }}
                  onLoadedMetadata={event => {
                    const maximumTime = Math.max(
                      0,
                      event.currentTarget.duration - 0.001
                    );
                    event.currentTarget.defaultPlaybackRate = playbackRate;
                    event.currentTarget.playbackRate = playbackRate;
                    event.currentTarget.volume = sourceVolume;
                    event.currentTarget.muted = sourceMuted;
                    const targetTime = shouldHoldLastFrame
                      ? Math.max(
                          sourceStartSeconds,
                          sourceEndSeconds - VIDEO_END_HOLD_EPSILON_SECONDS
                        )
                      : targetVideoTimeSeconds;
                    event.currentTarget.currentTime = Math.min(
                      targetTime,
                      maximumTime
                    );
                    if (timelinePlaying && !shouldHoldLastFrame && !reverse) {
                      void event.currentTarget.play().catch(() => undefined);
                    }
                  }}
                  onPlay={event => {
                    previewControlInteractionAtRef.current = null;
                    const startSeconds = sourceStartSeconds;
                    const endSeconds = sourceEndSeconds;
                    event.currentTarget.defaultPlaybackRate = playbackRate;
                    event.currentTarget.playbackRate = playbackRate;
                    event.currentTarget.volume = sourceVolume;
                    event.currentTarget.muted = sourceMuted;
                    if (
                      event.currentTarget.currentTime < startSeconds ||
                      (endSeconds > startSeconds &&
                        event.currentTarget.currentTime >= endSeconds - 0.03)
                    ) {
                      event.currentTarget.currentTime = reverse
                        ? Math.max(startSeconds, endSeconds - 1 / 120)
                        : startSeconds;
                    }
                    if (!timelinePlaying) onRequestTimelinePlaying(true);
                    if (reverse) {
                      ignoreNextVideoPauseRef.current = true;
                      event.currentTarget.pause();
                    }
                  }}
                  onPause={event => {
                    const ignoreNextPause = ignoreNextVideoPauseRef.current;
                    const lastInteractionAtMs =
                      previewControlInteractionAtRef.current;
                    ignoreNextVideoPauseRef.current = false;
                    previewControlInteractionAtRef.current = null;
                    if (
                      shouldForwardPreviewPause({
                        timelinePlaying,
                        ignoreNextPause,
                        mediaIsCurrent:
                          videoRef.current === event.currentTarget,
                        mediaConnected: event.currentTarget.isConnected,
                        mediaEnded: event.currentTarget.ended,
                        lastInteractionAtMs,
                        nowMs: Date.now(),
                      })
                    ) {
                      onRequestTimelinePlaying(false);
                    }
                  }}
                  onTimeUpdate={event => {
                    const endSeconds = sourceEndSeconds;
                    if (
                      !reverse &&
                      endSeconds > 0 &&
                      event.currentTarget.currentTime >= endSeconds
                    ) {
                      ignoreNextVideoPauseRef.current = true;
                      event.currentTarget.pause();
                      event.currentTarget.currentTime = Math.max(
                        sourceStartSeconds,
                        endSeconds - VIDEO_END_HOLD_EPSILON_SECONDS
                      );
                    }
                  }}
                  className="h-full w-full object-cover"
                  style={
                    videoTransform
                      ? timelineTransformStyle(videoTransform)
                      : undefined
                  }
                  aria-label={`${shot ? shotLabel(shot) : "当前镜头"} 视频预览`}
                />
              </div>
            ) : imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt={`${shot ? shotLabel(shot) : "当前镜头"} 预览`}
                  className="h-full w-full object-cover"
                  style={timelineTransformStyle(
                    shot?.imageId != null
                      ? shot.timelineItem?.imageTransforms?.[String(shot.imageId)] ??
                          shot.timelineItem?.transform
                      : shot?.timelineItem?.transform
                  )}
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[9px] font-medium text-white">
                  静态首帧占位 · 尚未采用视频
                </span>
              </>
            ) : (
              <div className="flex h-full min-h-[220px] w-full min-w-[220px] flex-col items-center justify-center gap-2 px-6 text-center text-neutral-400">
                <Video className="h-7 w-7" />
                <span className="text-xs">当前镜头尚未关联画面</span>
                <span className="max-w-[260px] truncate text-[10px] text-neutral-500">
                  {shot ? chatCutSourceNameFromShot(shot) : "从左侧选择镜头"}
                </span>
              </div>
            )}
          </div>
        </div>
        <div
          className="flex h-12 shrink-0 items-center justify-center overflow-hidden border-t border-border/70 bg-[color:var(--panel-header)] px-4 text-center"
          aria-live="polite"
          data-testid="editing-preview-subtitle-rail"
        >
          {subtitleText ? (
            <p
              className="m-0 line-clamp-2 max-w-[92%] text-[13px] font-medium leading-5 text-foreground"
              data-testid="editing-preview-subtitle"
            >
              {subtitleText}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type TimelineLane = {
  id: string;
  label: string;
  icon: "captions" | "video" | "voice" | "music" | "audio";
  domain: "visual" | "audio";
  tone: "blue" | "green" | "teal" | "amber" | "gray";
  clips: Array<{
    id: string;
    label: string;
    title: string;
    startMs: number;
    endMs: number;
    shotNo?: number;
    imageUrl?: string | null;
    stableShotId?: string;
    visualClip?: StoryTimelineVisualClip;
    videoEditTarget?: VideoClipEditorTarget;
    imageEditTarget?: ImageClipEditorTarget;
  }>;
};

/** 字幕、旁白、音乐和原声只属于听觉编辑域，不跟随视觉镜头选中。 */
export function timelineLaneDomain(
  laneId: string
): TimelineLane["domain"] {
  return ["captions", "voice", "music", "source-audio"].includes(laneId)
    ? "audio"
    : "visual";
}

function laneIcon(icon: TimelineLane["icon"]) {
  if (icon === "captions") return <Captions className="h-3 w-3" />;
  if (icon === "voice") return <Mic2 className="h-3 w-3" />;
  if (icon === "music") return <Music2 className="h-3 w-3" />;
  if (icon === "audio") return <Volume2 className="h-3 w-3" />;
  return <Video className="h-3 w-3" />;
}

function laneColors(tone: TimelineLane["tone"]) {
  if (tone === "blue") return "border-sky-500/55 bg-sky-500/25 text-sky-950";
  if (tone === "green")
    return "border-emerald-500/55 bg-emerald-500/30 text-emerald-950";
  if (tone === "teal") return "border-teal-500/55 bg-teal-500/25 text-teal-950";
  if (tone === "amber")
    return "border-amber-500/55 bg-amber-500/25 text-amber-950";
  return "border-border bg-muted text-foreground";
}

function cueText(clip: ChatCutTimelineClip, manifest: ChatCutTimelineManifest) {
  const code = chatCutCueCode(clip.name);
  const scripted = code
    ? manifest.scriptCues.find(cue => cue.code === code)?.text
    : null;
  return scripted ? `${code}｜${scripted}` : code || clip.name;
}

export function timelineVoiceLaneLabel(
  manifest: ChatCutTimelineManifest
): string {
  const voiceTracks = chatCutPlaybackAudioTracks(manifest).filter(track =>
    track.clips.some(clip => Boolean(chatCutCueCode(clip.name)))
  );
  const voiceClips = voiceTracks.flatMap(track =>
    track.clips.filter(clip => Boolean(chatCutCueCode(clip.name)))
  );
  const trackLabel =
    voiceTracks.length > 0
      ? voiceTracks.map(track => `A${track.index}`).join("+")
      : "旁白";
  const languageLabel =
    voiceClips.length > 0 &&
    voiceClips.every(clip => /^FR(?:[-_ ]|$)/i.test(clip.name))
      ? "法语旁白"
      : "旁白";
  return trackLabel === "旁白" ? trackLabel : `${trackLabel} ${languageLabel}`;
}

export function storyboardAudioClipsFromManifest(
  manifest: ChatCutTimelineManifest | null,
  storyId: number | null = null
): StoryboardAudioClip[] {
  if (!manifest) return [];
  return chatCutPlaybackAudioTracks(manifest).flatMap(track =>
    track.clips.map(clip => ({
      id: clip.id,
      name: clip.name,
      kind: chatCutCueCode(clip.name)
        ? "voice"
        : /bgm|music|配乐|音乐/i.test(clip.name)
          ? "music"
          : "source",
      audioUrl:
        storyId != null && clip.audioUrl
          ? `/api/story-audio/${storyId}/${encodeURIComponent(clip.id)}`
          : clip.audioUrl,
      startMs: clip.startMs,
      endMs: clip.endMs,
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs,
    }))
  );
}

function findShotAtTime(
  timings: ReturnType<typeof buildStoryboardTimingRows>,
  timeMs: number
) {
  // 重叠时跟着统一的 winner 走，别只挑故事顺序上第一个盖住这一刻的镜头。
  return storyboardTimingWinnerAt(timings, timeMs)?.shotNo;
}

export function buildTimelineLanes(
  shots: CreationEditorShot[],
  timelineShotIds: string[],
  manifest: ChatCutTimelineManifest | null
): TimelineLane[] {
  const timings = buildStoryboardTimingRows(
    shots,
    timelineShotIds,
    timelineItemsForShots(shots)
  );
  const shotsByNo = new Map(shots.map(shot => [shot.shotNo, shot]));
  const lanes: TimelineLane[] = [];
  const playbackAudioTracks = manifest
    ? chatCutPlaybackAudioTracks(manifest)
    : [];
  const voiceClips = playbackAudioTracks.flatMap(track =>
    track.clips.filter(clip => Boolean(chatCutCueCode(clip.name)))
  );
  if (voiceClips.length > 0 && manifest) {
    lanes.push({
      id: "captions",
      label: "台词",
      icon: "captions",
      domain: "audio",
      tone: "blue",
      clips: voiceClips.map(clip => ({
        id: `cue-${clip.id}`,
        label: cueText(clip, manifest),
        title: cueText(clip, manifest),
        startMs: clip.startMs,
        endMs: clip.endMs,
      })),
    });
  }

  const primaryIndex = manifest?.primaryVideoTrackIndex ?? null;
  const otherVideoTracks =
    manifest?.videoTracks
      .filter(track => track.index !== primaryIndex)
      .sort((left, right) => right.index - left.index) ?? [];
  for (const track of otherVideoTracks) {
    lanes.push({
      id: `video-${track.index}`,
      label: `V${track.index}`,
      icon: "video",
      domain: "visual",
      tone: "gray",
      clips: track.clips.map(clip => ({
        id: clip.id,
        label: clip.name,
        title: `${clip.name} · ${formatStoryboardTimestamp(clip.startMs)}–${formatStoryboardTimestamp(clip.endMs)}`,
        startMs: clip.startMs,
        endMs: clip.endMs,
        shotNo: findShotAtTime(timings, clip.startMs),
      })),
    });
  }

  lanes.push({
    id: "primary-video",
    label: primaryIndex ? `V${primaryIndex}` : "画面",
    icon: "video",
    domain: "visual",
    tone: "green",
    clips: timings.flatMap(timing => {
      const shot = shotsByNo.get(timing.shotNo);
      const baseClip = {
        id: timing.stableShotId,
        label: shot
          ? chatCutSourceNameFromShot(shot)
          : displayShotCode({ shotNo: timing.shotNo }),
        title: shot
          ? `${shotLabel(shot)} · ${chatCutSourceNameFromShot(shot)}`
          : displayShotCode({ shotNo: timing.shotNo }),
        startMs: timing.startMs,
        endMs: timing.endMs,
        shotNo: timing.shotNo,
        imageUrl: shot ? shotImageUrl(shot) : null,
        stableShotId: timing.stableShotId,
        videoEditTarget: shot
          ? (() => {
              const take =
                shot.selectedVideoTake ??
                shot.videoTakes?.find(
                  item =>
                    Boolean(item.videoUrl) &&
                    videoTakeAffordance(item.status).canPlay
                );
              return take
                ? (videoClipEditorTargetForTake({
                    stableShotId: timing.stableShotId,
                    shotNo: shot.shotNo,
                    cueCode: shot.cueCode,
                    label: `${shotLabel(shot)} · Take ${take.id}`,
                    take,
                    timelineItem: shot.timelineItem,
                    posterUrl: videoTakeFrameUrl(take, "start"),
                  }) ?? undefined)
                : undefined;
            })()
          : undefined,
        imageEditTarget:
          shot?.imageId && shotImageUrl(shot)
            ? imageClipEditorTargetForShot({
                shot,
                stableShotId: timing.stableShotId,
                imageId: shot.imageId,
                imageUrl: shotImageUrl(shot) ?? "",
                label: `${shotLabel(shot)} · 图片 #${shot.imageId}`,
              })
            : undefined,
      };
      const visualClips = shot?.timelineItem?.visualClips ?? [];
      const derivedClips = visualClips.map(clip => {
        const take = shot?.videoTakes?.find(item => item.id === clip.takeId);
        const posterUrl = timelineVisualClipFrameUrl(clip);
        return {
          id: clip.id,
          label: clip.label,
          title: `${shot ? shotLabel(shot) : timing.stableShotId} · ${clip.label}`,
          startMs: timing.startMs + clip.offsetMs,
          endMs: timing.startMs + clip.offsetMs + clip.durationMs,
          shotNo: timing.shotNo,
          imageUrl: posterUrl,
          stableShotId: timing.stableShotId,
          visualClip: clip,
          videoEditTarget: shot
            ? videoClipEditorTargetForVisualClip({
                stableShotId: timing.stableShotId,
                shotNo: shot.shotNo,
                cueCode: shot.cueCode,
                label: `${shotLabel(shot)} · ${clip.label}`,
                clip,
                timelineItem: shot.timelineItem,
                mediaDurationSec: take?.durationSec,
                posterUrl,
              })
            : undefined,
        };
      });
      return shot?.timelineItem?.visualClipsReplacePrimary
        ? derivedClips
        : [baseClip, ...derivedClips];
    }),
  });

  const musicClips = playbackAudioTracks.flatMap(track =>
    track.clips.filter(clip => /bgm|music|配乐|音乐/i.test(clip.name))
  );
  if (musicClips.length > 0) {
    lanes.push({
      id: "music",
      label: "A2 音乐",
      icon: "music",
      domain: "audio",
      tone: "teal",
      clips: musicClips.map(clip => ({
        id: clip.id,
        label: clip.name.replace(/\.[^.]+$/, ""),
        title: clip.name,
        startMs: clip.startMs,
        endMs: clip.endMs,
      })),
    });
  }

  const usedAudioIds = new Set(
    [...voiceClips, ...musicClips].map(clip => clip.id)
  );
  const sourceAudio = playbackAudioTracks.flatMap(track =>
    track.clips.filter(clip => !usedAudioIds.has(clip.id))
  );
  if (sourceAudio.length > 0) {
    lanes.push({
      id: "source-audio",
      label: "A3 原声",
      icon: "audio",
      domain: "audio",
      tone: "amber",
      clips: sourceAudio.map(clip => ({
        id: clip.id,
        label: clip.name,
        title: clip.name,
        startMs: clip.startMs,
        endMs: clip.endMs,
      })),
    });
  }
  // 旁白目前只作为独立听觉参考，不参与画面组移动。放在最底部，避免它夹在
  // 视频轨之间时给人「会随镜头一起走」的错觉；时间仍完全来自音频清单。
  if (voiceClips.length > 0) {
    lanes.push({
      id: "voice",
      label: manifest ? timelineVoiceLaneLabel(manifest) : "旁白",
      icon: "voice",
      domain: "audio",
      tone: "green",
      clips: voiceClips.map(clip => ({
        id: clip.id,
        label: chatCutCueCode(clip.name) || clip.name,
        title: manifest ? cueText(clip, manifest) : clip.name,
        startMs: clip.startMs,
        endMs: clip.endMs,
      })),
    });
  }
  return lanes;
}

type TimelinePlaybackState = {
  playheadMs: number;
  isPlaying: boolean;
};

type TimelinePlaybackRequest = {
  id: number;
  isPlaying: boolean;
};

/** 故事版看板点一下剪辑条时，把播放头搬过去。 */
type TimelineSeekRequest = {
  id: number;
  playheadMs: number;
};

export function timelineAudioTargetSeconds(
  clip: Pick<
    ChatCutTimelineClip,
    "startMs" | "endMs" | "sourceInMs" | "sourceOutMs"
  >,
  playheadMs: number
): number | null {
  if (playheadMs < clip.startMs || playheadMs >= clip.endMs) return null;
  const timelineOffsetMs = Math.max(0, playheadMs - clip.startMs);
  const sourceDurationMs = Math.max(0, clip.sourceOutMs - clip.sourceInMs);
  return (
    (clip.sourceInMs +
      (sourceDurationMs > 0
        ? Math.min(timelineOffsetMs, sourceDurationMs)
        : timelineOffsetMs)) /
    1000
  );
}

export function timelineAudioVolume(name: string): number {
  return /bgm|music|配乐|音乐/i.test(name) ? 0.18 : 1;
}

function TimelineAudioPlayback({
  manifest,
  playheadMs,
  isPlaying,
}: {
  manifest: ChatCutTimelineManifest | null;
  playheadMs: number;
  isPlaying: boolean;
}) {
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const clips = useMemo(
    () =>
      (manifest ? chatCutPlaybackAudioTracks(manifest) : [])
        .flatMap(track => track.clips)
        .filter(clip => Boolean(clip.audioUrl)),
    [manifest]
  );

  useEffect(() => {
    for (const clip of clips) {
      const audio = audioRefs.current.get(clip.id);
      if (!audio) continue;
      const targetSeconds = timelineAudioTargetSeconds(clip, playheadMs);
      if (targetSeconds == null) {
        audio.pause();
        continue;
      }
      audio.volume = timelineAudioVolume(clip.name);
      const drift = Math.abs(audio.currentTime - targetSeconds);
      if (drift > (isPlaying ? 0.35 : 0.004)) {
        try {
          audio.currentTime = targetSeconds;
        } catch {
          // Metadata may still be loading; the next playback tick retries.
        }
      }
      if (isPlaying) {
        if (audio.paused) void audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    }
  }, [clips, isPlaying, playheadMs]);

  useEffect(
    () => () => {
      audioRefs.current.forEach(audio => audio.pause());
    },
    []
  );

  return (
    <div className="hidden" aria-hidden="true">
      {clips.map(clip => (
        <audio
          key={clip.id}
          ref={element => {
            if (element) audioRefs.current.set(clip.id, element);
            else audioRefs.current.delete(clip.id);
          }}
          src={clip.audioUrl ?? undefined}
          preload="auto"
        />
      ))}
    </div>
  );
}

function MultiTrackTimeline({
  visible,
  shots,
  timelineShotIds,
  manifest,
  selectedShotNo,
  onSelectShot,
  onPlaybackChange,
  playbackRequest,
  seekRequest,
  onSplitAtPlayhead,
  onExtractFrameAtPlayhead,
  onMoveTimelineClip,
  onEditVideo,
  onEditImage,
  onCopyVideo,
  onPasteVideo,
  videoClipboardLabel,
  keyboardShortcutZoneRef,
}: {
  visible: boolean;
  shots: CreationEditorShot[];
  timelineShotIds: string[];
  manifest: ChatCutTimelineManifest | null;
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number) => void;
  onPlaybackChange: (playback: TimelinePlaybackState) => void;
  playbackRequest: TimelinePlaybackRequest;
  seekRequest: TimelineSeekRequest;
  onSplitAtPlayhead: (playheadMs: number) => Promise<void>;
  onExtractFrameAtPlayhead: (playheadMs: number) => Promise<void>;
  onMoveTimelineClip: (input: {
    clipId: string;
    sourceStableShotId: string;
    targetStableShotId: string;
    targetOffsetMs: number;
  }) => Promise<void>;
  onEditVideo: (target: VideoClipEditorTarget) => void;
  onEditImage: (target: ImageClipEditorTarget) => void;
  onCopyVideo: (target: VideoClipEditorTarget) => void;
  onPasteVideo: (input: {
    stableShotId: string;
    shotNo: number;
    mode?: "replace" | "append";
    targetOffsetMs?: number;
  }) => Promise<void>;
  videoClipboardLabel: string | null;
  keyboardShortcutZoneRef: { current: boolean };
}) {
  const [scale, setScale] = useState(16);
  const timings = useMemo(
    () =>
      buildStoryboardTimingRows(
        shots,
        timelineShotIds,
        timelineItemsForShots(shots)
      ),
    [shots, timelineShotIds]
  );
  const lanes = useMemo(
    () => buildTimelineLanes(shots, timelineShotIds, manifest),
    [manifest, shots, timelineShotIds]
  );
  const totalMs = Math.max(
    manifest?.durationMs ?? 0,
    timings.at(-1)?.endMs ?? 0,
    1000
  );
  const initialPlayheadMs =
    timings.find(timing => timing.shotNo === selectedShotNo)?.startMs ?? 0;
  const [playheadMs, setPlayheadMs] = useState(initialPlayheadMs);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "split" | "extract" | "move" | "paste" | null
  >(null);
  const [draggedVisualClip, setDraggedVisualClip] = useState<{
    clipId: string;
    sourceStableShotId: string;
  } | null>(null);
  const [hiddenLaneIds, setHiddenLaneIds] = useState<Set<string>>(
    () => new Set()
  );
  const [removedLaneIds, setRemovedLaneIds] = useState<Set<string>>(
    () => new Set()
  );
  const [timelinePasteTarget, setTimelinePasteTarget] = useState<{
    stableShotId: string;
    shotNo: number;
    targetOffsetMs: number;
  } | null>(null);
  const playheadMsRef = useRef(initialPlayheadMs);
  const isPlayingRef = useRef(false);
  const handledPlaybackRequestIdRef = useRef(0);
  const handledSeekRequestIdRef = useRef(0);
  const selectionFromPlayheadRef = useRef<number | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineWidth = Math.max(720, Math.ceil((totalMs / 1000) * scale));
  const tickStepSec = scale >= 24 ? 5 : 10;
  const tickCount = Math.ceil(totalMs / 1000 / tickStepSec);
  // 保留隐藏层的行高与名称，左右两侧始终对齐；隐藏只移除该层内容。
  const visibleLanes = lanes.filter(lane => !removedLaneIds.has(lane.id));

  const toggleLaneVisibility = useCallback((laneId: string) => {
    setHiddenLaneIds(current => {
      const next = new Set(current);
      if (next.has(laneId)) next.delete(laneId);
      else next.add(laneId);
      return next;
    });
  }, []);

  const removeLane = useCallback((laneId: string) => {
    setRemovedLaneIds(current => {
      const next = new Set(current);
      next.add(laneId);
      return next;
    });
  }, []);

  const setPlaybackRunning = useCallback(
    (nextPlaying: boolean) => {
      isPlayingRef.current = nextPlaying;
      setIsPlaying(nextPlaying);
      onPlaybackChange({
        playheadMs: playheadMsRef.current,
        isPlaying: nextPlaying,
      });
    },
    [onPlaybackChange]
  );

  // 这条时间线即使被折叠也继续当时钟用：故事版看板的走带和播放头读的是同一份状态。

  const commitPlayhead = useCallback(
    (
      requestedMs: number,
      options: { selectShot?: boolean; playing?: boolean } = {}
    ) => {
      const nextMs = clampTimelinePlayheadMs(requestedMs, totalMs);
      const nextPlaying = options.playing ?? isPlayingRef.current;
      playheadMsRef.current = nextMs;
      setPlayheadMs(nextMs);
      onPlaybackChange({ playheadMs: nextMs, isPlaying: nextPlaying });

      if (options.selectShot === false || timings.length === 0) return;
      const lastTiming = timings.at(-1);
      const lookupMs = Math.min(
        nextMs,
        Math.max(0, (lastTiming?.endMs ?? totalMs) - 1)
      );
      const nextShotNo = findShotAtTime(timings, lookupMs);
      if (nextShotNo != null && nextShotNo !== selectedShotNo) {
        selectionFromPlayheadRef.current = nextShotNo;
        onSelectShot(nextShotNo);
      }
    },
    [onPlaybackChange, onSelectShot, selectedShotNo, timings, totalMs]
  );

  useEffect(() => {
    if (selectedShotNo == null) return;
    if (selectionFromPlayheadRef.current === selectedShotNo) {
      selectionFromPlayheadRef.current = null;
      return;
    }
    const timing = timings.find(item => item.shotNo === selectedShotNo);
    if (!timing) return;
    isPlayingRef.current = false;
    setIsPlaying(false);
    playheadMsRef.current = timing.startMs;
    setPlayheadMs(timing.startMs);
    onPlaybackChange({ playheadMs: timing.startMs, isPlaying: false });
  }, [onPlaybackChange, selectedShotNo, timings]);

  useEffect(() => {
    if (!isPlaying) return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const tick = (currentTime: number) => {
      // 停止请求可能和已经排队的这一帧交错；旧帧不能再把父层 isPlaying 写回 true。
      if (!isPlayingRef.current) return;
      const next = advanceTimelinePlayhead(
        playheadMsRef.current,
        currentTime - previousTime,
        totalMs
      );
      previousTime = currentTime;

      // 先登记下一帧，再提交播放头/镜头选择状态。提交状态可能触发
      // effect 清理；如果顺序相反，旧循环会在清理之后又偷偷预约一帧，
      // 每次切镜头都会多出一条 rAF，最终表现为时间线加速和画面闪烁。
      animationFrame = requestAnimationFrame(tick);
      commitPlayhead(next.timeMs, {
        selectShot: true,
        playing: !next.ended,
      });
      if (next.ended) {
        cancelAnimationFrame(animationFrame);
        isPlayingRef.current = false;
        setIsPlaying(false);
        return;
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [commitPlayhead, isPlaying, totalMs]);

  const seekFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-timeline-clip]")) return;
      const timeline = timelineContentRef.current;
      if (!timeline) return;
      setPlaybackRunning(false);
      commitPlayhead(
        timelineMsFromClientX(
          event.clientX,
          timeline.getBoundingClientRect().left,
          scale,
          totalMs
        ),
        { selectShot: true, playing: false }
      );
    },
    [commitPlayhead, scale, setPlaybackRunning, totalMs]
  );

  const seekPlayheadHandle = useCallback(
    (clientX: number) => {
      const timeline = timelineContentRef.current;
      if (!timeline) return;
      commitPlayhead(
        timelineMsFromClientX(
          clientX,
          timeline.getBoundingClientRect().left,
          scale,
          totalMs
        ),
        { selectShot: true, playing: false }
      );
    },
    [commitPlayhead, scale, totalMs]
  );

  const togglePlayback = () => {
    if (isPlayingRef.current) {
      setPlaybackRunning(false);
      return;
    }
    if (playheadMsRef.current >= totalMs) {
      commitPlayhead(0, { selectShot: true, playing: false });
    }
    setPlaybackRunning(true);
  };

  useEffect(() => {
    if (
      playbackRequest.id === 0 ||
      playbackRequest.id === handledPlaybackRequestIdRef.current
    ) {
      return;
    }
    handledPlaybackRequestIdRef.current = playbackRequest.id;
    if (playbackRequest.isPlaying && playheadMsRef.current >= totalMs) {
      commitPlayhead(0, { selectShot: true, playing: false });
    }
    setPlaybackRunning(playbackRequest.isPlaying);
  }, [commitPlayhead, playbackRequest, setPlaybackRunning, totalMs]);

  useEffect(() => {
    if (
      seekRequest.id === 0 ||
      seekRequest.id === handledSeekRequestIdRef.current
    ) {
      return;
    }
    handledSeekRequestIdRef.current = seekRequest.id;
    commitPlayhead(seekRequest.playheadMs, { selectShot: true });
  }, [commitPlayhead, seekRequest]);

  const stepPlayheadByKeyboard = useCallback(
    (direction: -1 | 1, accelerated = false) => {
      setPlaybackRunning(false);
      commitPlayhead(
        stepTimelinePlayheadByFrames(
          playheadMsRef.current,
          direction,
          manifest?.fps ?? 30,
          totalMs,
          accelerated ? 10 : 1
        ),
        { selectShot: true, playing: false }
      );
    },
    [commitPlayhead, manifest?.fps, setPlaybackRunning, totalMs]
  );

  const runPlayheadAction = useCallback(
    async (action: "split" | "extract") => {
      setPlaybackRunning(false);
      setPendingAction(action);
      try {
        if (action === "split") {
          await onSplitAtPlayhead(playheadMsRef.current);
          toast.success("已在当前帧切割视频，片段可直接拖动");
        } else {
          await onExtractFrameAtPlayhead(playheadMsRef.current);
          toast.success("当前帧已加入该镜头的画面");
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : action === "split"
              ? "切割当前帧失败"
              : "提取当前帧失败"
        );
      } finally {
        setPendingAction(null);
      }
    },
    [onExtractFrameAtPlayhead, onSplitAtPlayhead, setPlaybackRunning]
  );

  const dropTimelineVisualClip = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      if (!draggedVisualClip || pendingAction) return;
      event.preventDefault();
      event.stopPropagation();
      const timeline = timelineContentRef.current;
      if (!timeline) return;
      const droppedMs = timelineMsFromClientX(
        event.clientX,
        timeline.getBoundingClientRect().left,
        scale,
        totalMs
      );
      const lastTiming = timings.at(-1);
      const lookupMs = Math.min(
        droppedMs,
        Math.max(0, (lastTiming?.endMs ?? totalMs) - 1)
      );
      const targetTiming = timings.find(
        timing => lookupMs >= timing.startMs && lookupMs < timing.endMs
      );
      if (!targetTiming) return;
      setPendingAction("move");
      try {
        await onMoveTimelineClip({
          ...draggedVisualClip,
          targetStableShotId: targetTiming.stableShotId,
          targetOffsetMs: Math.max(0, droppedMs - targetTiming.startMs),
        });
        onSelectShot(targetTiming.shotNo);
        toast.success("视频片段位置已保存");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "视频片段移动失败"
        );
      } finally {
        setPendingAction(null);
        setDraggedVisualClip(null);
      }
    },
    [
      draggedVisualClip,
      onMoveTimelineClip,
      onSelectShot,
      pendingAction,
      scale,
      timings,
      totalMs,
    ]
  );

  const rememberTimelinePasteTarget = useCallback(
    (clientX: number) => {
      const timeline = timelineContentRef.current;
      if (!timeline) return;
      const targetMs = timelineMsFromClientX(
        clientX,
        timeline.getBoundingClientRect().left,
        scale,
        totalMs
      );
      const lastTiming = timings.at(-1);
      const lookupMs = Math.min(
        targetMs,
        Math.max(0, (lastTiming?.endMs ?? totalMs) - 1)
      );
      const timing = timings.find(
        item => lookupMs >= item.startMs && lookupMs < item.endMs
      );
      setTimelinePasteTarget(
        timing
          ? {
              stableShotId: timing.stableShotId,
              shotNo: timing.shotNo,
              targetOffsetMs: Math.max(0, targetMs - timing.startMs),
            }
          : null
      );
    },
    [scale, timings, totalMs]
  );

  const pasteVideoIntoTimeline = useCallback(
    async (mode: "replace" | "append") => {
      if (!timelinePasteTarget || !videoClipboardLabel || pendingAction) return;
      setPlaybackRunning(false);
      setPendingAction("paste");
      try {
        await onPasteVideo({
          ...timelinePasteTarget,
          mode,
        });
        onSelectShot(timelinePasteTarget.shotNo);
      } finally {
        setPendingAction(null);
      }
    },
    [
      onPasteVideo,
      onSelectShot,
      pendingAction,
      setPlaybackRunning,
      timelinePasteTarget,
      videoClipboardLabel,
    ]
  );

  return (
    <section
      hidden={!visible}
      data-testid="editing-multitrack-timeline"
      className={`${visible ? "flex" : "hidden"} min-h-[230px] flex-[0_0_42%] flex-col border-t border-border bg-background`}
      aria-label="多轨剪辑时间轴"
      aria-hidden={!visible}
      onPointerEnter={() => {
        keyboardShortcutZoneRef.current = true;
      }}
      onPointerMove={() => {
        keyboardShortcutZoneRef.current = true;
      }}
      onPointerLeave={() => {
        keyboardShortcutZoneRef.current = false;
      }}
    >
      <TimelineAudioPlayback
        manifest={manifest}
        playheadMs={playheadMs}
        isPlaying={isPlaying}
      />
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">时间线</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {shots.length} 镜 · {formatStoryboardTimestamp(totalMs)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPlaybackRunning(false);
              commitPlayhead(0, { selectShot: true, playing: false });
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="回到时间线开头"
            title="回到开头"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={togglePlayback}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/50 bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20"
            aria-label={isPlaying ? "暂停时间线" : "播放时间线"}
            title={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </button>
          <span
            className="min-w-[66px] font-mono text-[10px] font-semibold tabular-nums text-rose-600"
            aria-live="off"
          >
            {formatStoryboardTimestamp(playheadMs)}
          </span>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={() =>
              setScale(value => Math.max(MIN_TIMELINE_SCALE, value - 2))
            }
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="缩小时间线"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <input
            type="range"
            min={MIN_TIMELINE_SCALE}
            max={MAX_TIMELINE_SCALE}
            step={1}
            value={scale}
            onChange={event => setScale(Number(event.currentTarget.value))}
            className="w-24 accent-[var(--primary)]"
            aria-label="时间线缩放"
          />
          <button
            type="button"
            onClick={() =>
              setScale(value => Math.min(MAX_TIMELINE_SCALE, value + 2))
            }
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="放大时间线"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-[76px] shrink-0 border-r border-border bg-muted/30 pt-6">
          {visibleLanes.map(lane => {
            const hidden = hiddenLaneIds.has(lane.id);
            return (
            <div
              key={lane.id}
              className={`group flex items-center gap-1 border-b border-border/70 px-1.5 text-[10px] font-semibold text-muted-foreground ${hidden ? "opacity-40" : ""}`}
              style={{ height: 27 }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1">
                {laneIcon(lane.icon)}
                <span className="truncate">{lane.label}</span>
              </span>
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => toggleLaneVisibility(lane.id)}
                aria-label={`${hidden ? "显示" : "隐藏"} ${lane.label}轨道`}
                title={`${hidden ? "显示" : "隐藏"} ${lane.label}轨道`}
              >
                {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => removeLane(lane.id)}
                aria-label={`删除 ${lane.label}轨道`}
                title={`删除 ${lane.label}轨道`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            );
          })}
        </div>
        <div
          ref={timelineViewportRef}
          className="min-w-0 flex-1 overflow-auto custom-scrollbar"
        >
          <div
            ref={timelineContentRef}
            className="relative"
            style={{ width: timelineWidth }}
          >
            <div
              className="relative h-6 cursor-crosshair border-b border-border bg-muted/20"
              onPointerDown={seekFromPointer}
              aria-label="时间标尺，点击定位"
            >
              {Array.from({ length: tickCount + 1 }, (_, index) => {
                const second = index * tickStepSec;
                return (
                  <span
                    key={second}
                    className="pointer-events-none absolute bottom-0 top-0 border-l border-border/70 pl-1 font-mono text-[9px] tabular-nums text-muted-foreground"
                    style={{ left: second * scale }}
                  >
                    {formatStoryboardTimestamp(second * 1000).replace(
                      /\.000$/,
                      ""
                    )}
                  </span>
                );
              })}
            </div>
            {visibleLanes.map(lane => {
              const hidden = hiddenLaneIds.has(lane.id);
              return (
              <div
                key={lane.id}
                className="relative cursor-crosshair border-b border-border/70 bg-background"
                style={{ height: 27 }}
                onPointerDown={seekFromPointer}
                onDragOver={event => {
                  if (lane.id !== "primary-video" || !draggedVisualClip) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={event => {
                  if (lane.id === "primary-video") {
                    void dropTimelineVisualClip(event);
                  }
                }}
                aria-label={`${lane.label} 轨道`}
              >
                {!hidden && lane.id === "primary-video" ? (
                  <ContextMenu.Root>
                    <ContextMenu.Trigger asChild>
                      <button
                        type="button"
                        className="absolute inset-0 z-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/35"
                        aria-label="主视频轨空白区"
                        title={
                          videoClipboardLabel
                            ? `右键粘贴 ${videoClipboardLabel}`
                            : "右键可粘贴已复制的视频"
                        }
                        onContextMenu={event =>
                          rememberTimelinePasteTarget(event.clientX)
                        }
                      />
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content
                        className="z-[90] min-w-[190px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                        data-testid="timeline-video-paste-menu"
                      >
                        <ContextMenu.Item
                          disabled={
                            !videoClipboardLabel ||
                            !timelinePasteTarget ||
                            pendingAction != null
                          }
                          onSelect={() =>
                            void pasteVideoIntoTimeline("replace")
                          }
                          className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                        >
                          {pendingAction === "paste" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ClipboardPaste className="h-3.5 w-3.5" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {videoClipboardLabel
                              ? "替换主视频"
                              : "剪贴板没有视频"}
                          </span>
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          disabled={
                            !videoClipboardLabel ||
                            !timelinePasteTarget ||
                            pendingAction != null
                          }
                          onSelect={() => void pasteVideoIntoTimeline("append")}
                          className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                        >
                          <ClipboardPaste className="h-3.5 w-3.5" />
                          <span className="min-w-0 flex-1 truncate">
                            插入为新片段
                          </span>
                        </ContextMenu.Item>
                        {videoClipboardLabel ? (
                          <ContextMenu.Label className="max-w-[220px] truncate px-2 py-1 text-[10px] text-muted-foreground">
                            {videoClipboardLabel}
                          </ContextMenu.Label>
                        ) : null}
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                ) : null}
                {!hidden && lane.clips.map(clip => {
                  const left = (clip.startMs / 1000) * scale;
                  const width = Math.max(
                    4,
                    ((clip.endMs - clip.startMs) / 1000) * scale
                  );
                  const selected =
                    lane.domain === "visual" && clip.shotNo === selectedShotNo;
                  const clipButton = (
                    <button
                      key={`${lane.id}-${clip.id}`}
                      type="button"
                      draggable={Boolean(clip.visualClip)}
                      onClick={() => {
                        setPlaybackRunning(false);
                        commitPlayhead(clip.startMs, {
                          // 听觉轨道只定位声音播放头，不反向切换视觉镜头。
                          selectShot: lane.domain === "visual",
                          playing: false,
                        });
                      }}
                      onDoubleClick={event => {
                        if (!clip.videoEditTarget && !clip.imageEditTarget)
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        setPlaybackRunning(false);
                        commitPlayhead(clip.startMs, {
                          selectShot: true,
                          playing: false,
                        });
                        if (clip.videoEditTarget) {
                          onEditVideo(clip.videoEditTarget);
                        } else if (clip.imageEditTarget) {
                          onEditImage(clip.imageEditTarget);
                        }
                      }}
                      onDragStart={event => {
                        if (!clip.visualClip || !clip.stableShotId) {
                          event.preventDefault();
                          return;
                        }
                        setPlaybackRunning(false);
                        setDraggedVisualClip({
                          clipId: clip.visualClip.id,
                          sourceStableShotId: clip.stableShotId,
                        });
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                          "text/plain",
                          clip.visualClip.label
                        );
                      }}
                      onDragEnd={() => setDraggedVisualClip(null)}
                      onContextMenu={event => {
                        if (clip.videoEditTarget) event.stopPropagation();
                      }}
                      data-timeline-clip="true"
                      className={`absolute bottom-0.5 top-0.5 z-10 overflow-hidden rounded-sm border px-1 text-left text-[9px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${clip.visualClip ? "cursor-grab active:cursor-grabbing" : ""} ${laneColors(
                        lane.tone
                      )} ${selected ? "ring-2 ring-primary" : ""} ${draggedVisualClip?.clipId === clip.visualClip?.id ? "opacity-45" : ""}`}
                      style={{ left, width }}
                      title={
                        clip.videoEditTarget
                          ? `${clip.title} · 双击编辑视频`
                          : clip.imageEditTarget
                            ? `${clip.title} · 双击编辑图片`
                            : clip.title
                      }
                      aria-label={clip.title}
                    >
                      {clip.imageUrl ? (
                        <img
                          src={clip.imageUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover opacity-45"
                          style={timelineTransformStyle(
                            clip.videoEditTarget?.transform ??
                              clip.imageEditTarget?.transform
                          )}
                        />
                      ) : lane.icon === "music" ? (
                        <span
                          className="absolute inset-x-0 bottom-1 top-1 opacity-25"
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(90deg,currentColor 0 1px,transparent 1px 5px)",
                          }}
                        />
                      ) : null}
                      <span className="relative block truncate">
                        {clip.label}
                      </span>
                    </button>
                  );
                  if (!clip.videoEditTarget) return clipButton;
                  return (
                    <ContextMenu.Root key={`${lane.id}-${clip.id}-menu`}>
                      <ContextMenu.Trigger asChild>
                        {clipButton}
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content
                          className="z-[90] min-w-[178px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                          data-testid={`timeline-video-copy-${clip.id}`}
                        >
                          <ContextMenu.Item
                            onSelect={() => onCopyVideo(clip.videoEditTarget!)}
                            className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[highlighted]:bg-accent"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            复制视频
                          </ContextMenu.Item>
                          <ContextMenu.Separator className="my-1 h-px bg-border" />
                          <ContextMenu.Item
                            disabled={
                              !videoClipboardLabel ||
                              !clip.stableShotId ||
                              clip.shotNo == null ||
                              pendingAction != null
                            }
                            onSelect={() => {
                              if (!clip.stableShotId || clip.shotNo == null)
                                return;
                              const shotNo = clip.shotNo;
                              const timing = timings.find(
                                candidate =>
                                  candidate.stableShotId === clip.stableShotId
                              );
                              setPlaybackRunning(false);
                              setPendingAction("paste");
                              void onPasteVideo({
                                stableShotId: clip.stableShotId,
                                shotNo,
                                mode: "append",
                                targetOffsetMs: Math.max(
                                  0,
                                  clip.endMs - (timing?.startMs ?? clip.startMs)
                                ),
                              })
                                .then(() => onSelectShot(shotNo))
                                .catch(error => {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "视频片段插入失败"
                                  );
                                })
                                .finally(() => setPendingAction(null));
                            }}
                            className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                            插入复制的视频到此片段后
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                  );
                })}
              </div>
              );
            })}
            <ContextMenu.Root>
              <ContextMenu.Trigger asChild>
                <div
                  role="slider"
                  tabIndex={0}
                  className="group absolute bottom-0 top-0 z-30 w-4 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
                  style={{ left: (playheadMs / 1000) * scale }}
                  aria-label="拖动播放头"
                  aria-valuemin={0}
                  aria-valuemax={totalMs}
                  aria-valuenow={Math.round(playheadMs)}
                  aria-valuetext={formatStoryboardTimestamp(playheadMs)}
                  title="拖动播放头；右键切割或提取当前帧"
                  onPointerDown={event => {
                    if (event.button === 2) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setPlaybackRunning(false);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    seekPlayheadHandle(event.clientX);
                  }}
                  onPointerMove={event => {
                    if (
                      event.currentTarget.hasPointerCapture(event.pointerId)
                    ) {
                      seekPlayheadHandle(event.clientX);
                    }
                  }}
                  onPointerUp={event => {
                    if (
                      event.currentTarget.hasPointerCapture(event.pointerId)
                    ) {
                      event.currentTarget.releasePointerCapture(
                        event.pointerId
                      );
                    }
                  }}
                  onKeyDown={event => {
                    if (
                      event.key !== "ArrowLeft" &&
                      event.key !== "ArrowRight"
                    ) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    stepPlayheadByKeyboard(
                      event.key === "ArrowRight" ? 1 : -1,
                      event.shiftKey
                    );
                  }}
                >
                  <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-b-sm bg-rose-500 shadow-sm ring-1 ring-white/70 group-focus-visible:ring-2 group-focus-visible:ring-rose-300" />
                  <span className="absolute bottom-0 left-1/2 top-2 w-px -translate-x-1/2 bg-rose-500 shadow-[0_0_0_1px_rgb(244_63_94_/_0.18)]" />
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className="z-[80] min-w-[190px] rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                  data-testid="timeline-playhead-menu"
                >
                  <ContextMenu.Item
                    disabled={pendingAction != null}
                    onSelect={() => void runPlayheadAction("split")}
                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                  >
                    {pendingAction === "split" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Scissors className="h-3.5 w-3.5" />
                    )}
                    切割当前帧
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    disabled={pendingAction != null}
                    onSelect={() => void runPlayheadAction("extract")}
                    className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-45"
                  >
                    {pendingAction === "extract" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                    提取当前帧作为素材
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function EditingNleWorkspace({
  timelineVisible = true,
  videoEditorHandoffTarget = null,
  onVideoEditorHandoffHandled,
}: {
  timelineVisible?: boolean;
  videoEditorHandoffTarget?: VideoClipEditorTarget | null;
  onVideoEditorHandoffHandled?: () => void;
}) {
  const {
    generateScript,
    setActiveSelection,
    proposeGapTransitionCard,
    proposeExtractedFrameTransitionCard,
  } = useStoryAgentActions();
  const activeSelection = useStorySpine(state => state.activeSelection);
  const confirmedIntent = useStorySpine(state => state.confirmedIntent);
  const isGeneratingScript = useStorySpine(state => state.isGeneratingScript);
  const hasConversationSource = useStorySpine(state =>
    state.messages.some(
      message => message.role === "user" && Boolean(message.content.trim())
    )
  );
  const {
    activeStoryId,
    shots,
    timelineShotIds,
    selectedShotNo,
    setSelectedShotNo,
    chatCutTimeline,
    importStoryMaterial,
    deleteExtractedFrame,
    adoptVideoTake,
    reuseVideoTake,
    appendTimelineVideoClip,
    undoTimeline,
    splitTimelineVideoClip,
    moveTimelineVideoClip,
    addTimelineImageClip,
    moveTimelineItemToLayer,
    moveTimelineImageClip,
    updateTimelineVideoEdit,
    updateTimelineImageTransform,
    updateShotDuration,
    reorderShotInTimeline,
    attachChatCutXml,
    timelineItems,
    timelineOverlays,
    previewTimelineGroup,
    moveTimelineGroup,
    moveTimelineShot,
    addTimelineAnchorAtFrame,
    removeTimelineAnchor,
    trimTimelineItemEdge,
    rollTimelineJoin,
    detachTimelineMagnet,
    timelineWritePending,
    isLoading,
  } = useCreationEditor();
  const [relinkProgress, setRelinkProgress] = useState<string | null>(null);
  const [attachProgress, setAttachProgress] = useState<string | null>(null);
  const [videoEditorTarget, setVideoEditorTarget] =
    useState<VideoClipEditorTarget | null>(null);
  const [videoEditorPreviewDraft, setVideoEditorPreviewDraft] =
    useState<VideoClipEditDraft | null>(null);
  const [videoClipboard, setVideoClipboard] =
    useState<VideoClipboardPayload | null>(null);
  const [savingVideoEdit, setSavingVideoEdit] = useState(false);
  const [imageEditorTarget, setImageEditorTarget] =
    useState<ImageClipEditorTarget | null>(null);
  const [savingImageEdit, setSavingImageEdit] = useState(false);
  const [timelinePlayback, setTimelinePlayback] =
    useState<TimelinePlaybackState>({ playheadMs: 0, isPlaying: false });
  const [timelinePlaybackRequest, setTimelinePlaybackRequest] =
    useState<TimelinePlaybackRequest>({ id: 0, isPlaying: false });
  const [timelineSeekRequest, setTimelineSeekRequest] =
    useState<TimelineSeekRequest>({ id: 0, playheadMs: 0 });
  const [boardSelectedRange, setBoardSelectedRange] =
    useState<StoryboardEditRange | null>(null);
  const [extractedFrameRequirements, setExtractedFrameRequirements] = useState<{
    left: { id: string; imageId: number; atMs: number; imageUrl: string };
    right: { id: string; imageId: number; atMs: number; imageUrl: string };
  } | null>(null);
  const keyboardShortcutZoneRef = useRef(false);
  const timelineShots = useMemo(
    () => resolveTimelineShots(shots, timelineShotIds),
    [shots, timelineShotIds]
  );
  const timings = useMemo(
    () => buildStoryboardTimingRows(shots, timelineShotIds, timelineItems),
    [shots, timelineItems, timelineShotIds]
  );
  /** 时间尺上要画的位置锚点，按绝对帧排好。 */
  const timelineAnchors = useMemo(
    () =>
      timelineItems.flatMap(item =>
        (item.anchors ?? []).map(anchor => ({
          id: anchor.id,
          stableShotId: item.stableShotId,
          timelineFrame: anchor.timelineFrame,
        }))
      ),
    [timelineItems]
  );
  const timingByShotNo = useMemo(
    () => new Map(timings.map(timing => [timing.shotNo, timing])),
    [timings]
  );
  const selectedShot =
    shots.find(shot => shot.shotNo === selectedShotNo) ??
    timelineShots[0] ??
    shots[0] ??
    null;
  const selectedTimelineIndex = selectedShot
    ? timelineShots.findIndex(
        shot =>
          creationTimelineShotId(shot) === creationTimelineShotId(selectedShot)
      )
    : -1;
  const primarySourceClips =
    chatCutTimeline?.videoTracks.find(
      track => track.index === chatCutTimeline.primaryVideoTrackIndex
    )?.clips ?? [];
  const selectedSourceClipId = chatCutClipIdFromShot(selectedShot);
  const selectedSourceClip =
    selectedShot?.shotType === "转场镜头"
      ? null
      : selectedSourceClipId
        ? (primarySourceClips.find(clip => clip.id === selectedSourceClipId) ??
          null)
        : selectedTimelineIndex >= 0
          ? (primarySourceClips[selectedTimelineIndex] ?? null)
          : null;
  const activeTimelineVideoSource = useMemo(
    () =>
      resolveTimelineVideoSource(
        shots,
        timelineShotIds,
        timelinePlayback.playheadMs,
        timelineOverlays
      ),
    [shots, timelineOverlays, timelinePlayback.playheadMs, timelineShotIds]
  );
  const activeTimelineImageSource = useMemo(() => {
    const resolved = resolveTimelineImageClip(
      timelineItems,
      Math.max(0, Math.round((timelinePlayback.playheadMs * 30) / 1000))
    );
    return timelineImageWinsVisualOverlap(resolved, activeTimelineVideoSource)
      ? {
          imageUrl: resolved!.clip.imageUrl,
          transform: resolved!.clip.transform,
        }
      : null;
  }, [activeTimelineVideoSource, timelineItems, timelinePlayback.playheadMs]);
  const storyboardAudioClips = useMemo(
    () => storyboardAudioClipsFromManifest(chatCutTimeline, activeStoryId),
    [activeStoryId, chatCutTimeline]
  );

  useEffect(() => {
    if (selectedShotNo == null && selectedShot) {
      setSelectedShotNo(selectedShot.shotNo);
    }
  }, [selectedShot, selectedShotNo, setSelectedShotNo]);

  const selectShot = useCallback(
    (shotNo: number) => {
      setSelectedShotNo(shotNo);
      const shot = shots.find(item => item.shotNo === shotNo);
      if (!shot) return;
      const fullText = [shot.dialogue, shot.action, shot.subject]
        .filter(Boolean)
        .join("；");
      setActiveSelection({
        sourceType: shot.imageId ? "storyboard-image" : "shot",
        sourceId: shot.imageId ? String(shot.imageId) : String(shotNo),
        selectedText: fullText || shotLabel(shot),
        fullText: fullText || shotLabel(shot),
        storyId: activeStoryId,
        stableShotId: shot.stableShotId ?? shot.shotIdentity ?? null,
        shotNo,
        cueCode: shot.cueCode ?? null,
        imageId: shot.imageId ?? null,
        objectVersion: shot.imageId ? `image:${shot.imageId}` : null,
        materialStatus: shot.imageId ? "current-image" : "unknown",
      });
    },
    [activeStoryId, setActiveSelection, setSelectedShotNo, shots]
  );

  const copyVideo = useCallback((target: VideoClipEditorTarget) => {
    const payload = videoClipboardPayloadFromTarget(target);
    setVideoClipboard(payload);
    toast.success(`已复制 ${target.label}`);
  }, []);

  const pasteVideo = useCallback(
    async (input: {
      stableShotId: string;
      shotNo: number;
      mode?: "replace" | "append";
      targetOffsetMs?: number;
    }) => {
      if (!videoClipboard) throw new Error("请先复制一个视频");
      if (input.mode === "append") {
        await appendTimelineVideoClip({
          sourceTakeId: videoClipboard.sourceTakeId,
          targetStableShotId: input.stableShotId,
          sourceStartSec: videoClipboard.sourceStartSec,
          sourceEndSec: videoClipboard.sourceEndSec,
          effects: videoClipboard.effects,
          transform: videoClipboard.transform,
          targetOffsetMs: input.targetOffsetMs,
        });
        const targetShot = shots.find(
          shot =>
            (shot.stableShotId ?? shot.shotIdentity) === input.stableShotId
        );
        selectShot(input.shotNo);
        toast.success(
          `已将 ${videoClipboard.label} 作为新片段加入 ${targetShot ? shotLabel(targetShot) : `镜头 ${input.shotNo}`}`
        );
        return;
      }
      const plannedDurationSec =
        videoClipboardPlannedDurationSec(videoClipboard);
      const reused = await reuseVideoTake({
        sourceTakeId: videoClipboard.sourceTakeId,
        targetStableShotId: input.stableShotId,
        plannedDurationSec,
      });
      const targetShot = shots.find(
        shot => (shot.stableShotId ?? shot.shotIdentity) === input.stableShotId
      );
      if (targetShot?.timelineItem) {
        await updateTimelineVideoEdit({
          stableShotId: input.stableShotId,
          takeId: reused.takeId,
          sourceStartSec: videoClipboard.sourceStartSec,
          sourceEndSec: videoClipboard.sourceEndSec,
          effects: videoClipboard.effects,
          transform: videoClipboard.transform,
        });
      }
      selectShot(input.shotNo);
      toast.success(
        `已将 ${videoClipboard.label} 粘贴到 ${targetShot ? shotLabel(targetShot) : `镜头 ${input.shotNo}`}`
      );
    },
    [
      appendTimelineVideoClip,
      reuseVideoTake,
      selectShot,
      shots,
      updateTimelineVideoEdit,
      videoClipboard,
    ]
  );

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldHandleCreationEditorUndoShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        defaultPrevented: event.defaultPrevented,
        repeat: event.repeat,
        targetIsEditable: Boolean(
          target?.closest(
            'input, textarea, select, [contenteditable="true"], [role="textbox"]'
          )
        ),
      })) {
        return;
      }
      event.preventDefault();
      void undoTimeline()
        .then(undone => {
          if (undone) toast.success("已撤销上一步剪辑");
          else toast.info("当前没有可撤销的剪辑");
        })
        .catch(error => {
          toast.error(error instanceof Error ? error.message : "撤销失败");
        });
    };
    window.addEventListener("keydown", handleUndoShortcut, true);
    return () => window.removeEventListener("keydown", handleUndoShortcut, true);
  }, [undoTimeline]);

  const openVideoEditor = useCallback(
    (target: VideoClipEditorTarget) => {
      setSelectedShotNo(target.shotNo);
      setTimelinePlayback(current => ({ ...current, isPlaying: false }));
      setTimelinePlaybackRequest(current => ({
        id: current.id + 1,
        isPlaying: false,
      }));
      setImageEditorTarget(null);
      setVideoEditorTarget(target);
      setVideoEditorPreviewDraft(
        normalizeVideoClipEditDraft(
          {
            sourceStartSec: target.sourceStartSec,
            sourceEndSec: target.sourceEndSec,
            effects: { ...target.effects },
            transform: { ...target.transform },
          },
          target.mediaDurationSec
        )
      );
      setActiveSelection({
        sourceType: target.clipId ? "timeline-range" : "animatic-video",
        sourceId: target.clipId ?? String(target.takeId),
        selectedText: `${target.label} · ${target.sourceStartSec.toFixed(2)}–${target.sourceEndSec.toFixed(2)} 秒`,
        fullText: `${target.label}，Take ${target.takeId}，素材范围 ${target.sourceStartSec.toFixed(2)} 到 ${target.sourceEndSec.toFixed(2)} 秒`,
        storyId: activeStoryId,
        stableShotId: target.stableShotId,
        shotNo: target.shotNo,
        cueCode: target.cueCode ?? null,
        videoTakeId: target.takeId,
        rangeId: target.rangeId,
        selection: {
          kind: "time",
          startSec: target.sourceStartSec,
          endSec: target.sourceEndSec,
        },
        objectVersion: target.clipId
          ? `timeline-clip:${target.clipId}`
          : `video-take:${target.takeId}`,
        materialStatus: target.clipId
          ? "timeline-range"
          : target.isTimelineSelected
            ? "current-video"
            : "unadopted-video",
      });
    },
    [activeStoryId, setActiveSelection, setSelectedShotNo]
  );

  useEffect(() => {
    if (!videoEditorHandoffTarget) return;
    openVideoEditor(videoEditorHandoffTarget);
    onVideoEditorHandoffHandled?.();
  }, [onVideoEditorHandoffHandled, openVideoEditor, videoEditorHandoffTarget]);

  const openImageEditor = useCallback(
    (target: ImageClipEditorTarget) => {
      setSelectedShotNo(target.shotNo);
      setTimelinePlayback(current => ({ ...current, isPlaying: false }));
      setTimelinePlaybackRequest(current => ({
        id: current.id + 1,
        isPlaying: false,
      }));
      setVideoEditorTarget(null);
      setVideoEditorPreviewDraft(null);
      setImageEditorTarget(target);
      setActiveSelection({
        sourceType: "storyboard-image",
        sourceId: String(target.imageId),
        selectedText: `${target.label} · 图片构图调整`,
        fullText: `${target.label}，旋转、缩放与位置调整`,
        storyId: activeStoryId,
        stableShotId: target.stableShotId,
        shotNo: target.shotNo,
        cueCode: target.cueCode ?? null,
        imageId: target.imageId,
        objectVersion: `image:${target.imageId}`,
        materialStatus: "current-image",
      });
    },
    [activeStoryId, setActiveSelection, setSelectedShotNo]
  );

  const applyImageEdit = useCallback(
    async (draft: ImageClipEditDraft) => {
      const target = imageEditorTarget;
      if (!target) return;
      setSavingImageEdit(true);
      try {
        await updateTimelineImageTransform({
          stableShotId: target.stableShotId,
          imageId: target.imageId,
          transform: draft,
        });
        const nextTarget = { ...target, transform: draft };
        setImageEditorTarget(nextTarget);
        toast.success(`${target.label} 构图已保存`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "图片编辑保存失败"
        );
      } finally {
        setSavingImageEdit(false);
      }
    },
    [imageEditorTarget, updateTimelineImageTransform]
  );

  const applyVideoEdit = useCallback(
    async (draft: VideoClipEditDraft) => {
      const target = videoEditorTarget;
      if (!target) return;
      setSavingVideoEdit(true);
      try {
        const plannedDurationSec = editedTimelineDurationMs(draft) / 1_000;
        if (!target.clipId && !target.isTimelineSelected) {
          await adoptVideoTake({
            stableShotId: target.stableShotId,
            takeId: target.takeId,
            plannedDurationSec,
          });
        }
        await updateTimelineVideoEdit({
          stableShotId: target.stableShotId,
          takeId: target.takeId,
          clipId: target.clipId,
          sourceStartSec: draft.sourceStartSec,
          sourceEndSec: draft.sourceEndSec,
          effects: draft.effects,
          transform: draft.transform,
        });
        const nextTarget = {
          ...target,
          ...draft,
          isTimelineSelected: true,
        };
        setVideoEditorTarget(nextTarget);
        openVideoEditor(nextTarget);
        toast.success(`${target.label} 已更新到时间线`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "视频编辑保存失败"
        );
      } finally {
        setSavingVideoEdit(false);
      }
    },
    [
      adoptVideoTake,
      openVideoEditor,
      updateTimelineVideoEdit,
      videoEditorTarget,
    ]
  );

  const closeVideoEditor = useCallback(() => {
    setVideoEditorTarget(null);
    setVideoEditorPreviewDraft(null);
  }, []);

  // 聊聊生成并插入镜头后会把该镜头设为活动选区；剪辑台跟随这个稳定 ID
  // 定位，而不是依赖会因插入而变化的 SH 序号。
  useEffect(() => {
    if (
      !storyboardEditShouldFollowSelectionToShot(activeSelection?.sourceType)
    ) {
      return;
    }
    const stableShotId = activeSelection?.stableShotId;
    if (!stableShotId) return;
    const shot = shots.find(
      item => (item.stableShotId ?? item.shotIdentity) === stableShotId
    );
    if (!shot || shot.shotNo === selectedShotNo) return;
    selectShot(shot.shotNo);
  }, [
    activeSelection?.sourceType,
    activeSelection?.stableShotId,
    selectShot,
    selectedShotNo,
    shots,
  ]);

  const relinkFiles = async (files: File[]) => {
    const visualFiles = files.filter(isVisualFile);
    if (visualFiles.length === 0) {
      toast.error("请选择图片或视频文件");
      return;
    }
    const filesByName = new Map(
      visualFiles.map(file => [chatCutBaseName(file.name), file])
    );
    const matches = shots.flatMap((shot, index) => {
      const mappedClipId = chatCutClipIdFromShot(shot);
      const sourceClip = mappedClipId
        ? primarySourceClips.find(clip => clip.id === mappedClipId)
        : primarySourceClips[index];
      const sourceName = sourceClip?.name || chatCutSourceNameFromShot(shot);
      const file = filesByName.get(chatCutBaseName(sourceName));
      const stableShotId = shot.stableShotId ?? shot.shotIdentity;
      return file && stableShotId
        ? [{ shot, stableShotId, file, sourceName }]
        : [];
    });
    if (matches.length === 0) {
      toast.error("所选文件名与当前故事镜头没有匹配项");
      return;
    }

    const encodedFiles = new Map<File, string>();
    let imported = 0;
    setRelinkProgress(`正在关联 0 / ${matches.length}`);
    try {
      for (const match of matches) {
        let encoded = encodedFiles.get(match.file);
        if (!encoded) {
          encoded = await fileBase64(match.file);
          encodedFiles.set(match.file, encoded);
        }
        const result = await importStoryMaterial({
          fileName: match.file.name,
          mimeType: mediaMime(match.file),
          fileBase64: encoded,
          targetStableShotId: match.stableShotId,
          note: `ChatCut XML 自动关联：${match.sourceName}`,
        });
        if (result.kind === "video") {
          await adoptVideoTake({
            stableShotId: result.stableShotId,
            takeId: result.takeId,
            plannedDurationSec: result.plannedDurationSec,
          });
        }
        imported += 1;
        setRelinkProgress(`正在关联 ${imported} / ${matches.length}`);
      }
      toast.success(`已关联 ${imported} 个镜头素材`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材关联失败");
    } finally {
      setRelinkProgress(null);
    }
  };

  const attachXml = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xml")) {
      toast.error("请选择 ChatCut 导出的 XML 文件");
      return;
    }
    if (file.size > 2_000_000) {
      toast.error("XML 文件过大，请控制在 2MB 以内");
      return;
    }
    setAttachProgress("正在同步时间线与音频轨");
    try {
      const summary = await attachChatCutXml(await file.text());
      toast.success(
        `已同步 ${summary.primaryClipCount} 个镜头、${summary.audioClipCount} 段音频 · ${summary.width}×${summary.height}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ChatCut XML 同步失败"
      );
    } finally {
      setAttachProgress(null);
    }
  };

  const splitAtPlayhead = useCallback(
    async (playheadMs: number) => {
      const source = resolveTimelineVideoSource(
        shots,
        timelineShotIds,
        playheadMs,
        timelineOverlays
      );
      if (!source) {
        throw new Error("当前帧没有可切割的视频，请先为这个镜头采用视频 Take");
      }
      const sourceDurationSec = source.sourceEndSec - source.sourceStartSec;
      if (sourceDurationSec <= 2 / 30) {
        throw new Error("当前视频片段太短，无法继续切割");
      }
      const sourceProgress = Math.min(
        1,
        Math.max(
          0,
          (source.sourceTimeSec - source.sourceStartSec) / sourceDurationSec
        )
      );
      const timelineProgress = source.effects.reverse
        ? 1 - sourceProgress
        : sourceProgress;
      await splitTimelineVideoClip({
        stableShotId: source.stableShotId,
        cutFrame: timelineOffsetMsToFrames(playheadMs),
        takeStableShotId: source.takeStableShotId,
        existingClipId: source.existingClipId,
        takeId: source.takeId,
        videoUrl: source.videoUrl,
        sourceStartSec: source.sourceStartSec,
        sourceEndSec: source.sourceEndSec,
        splitSourceSec: source.sourceTimeSec,
        offsetMs: source.offsetMs,
        durationMs: source.durationMs,
        splitOffsetMs: source.offsetMs + source.durationMs * timelineProgress,
        label: source.label,
        effects: source.effects,
        transform: source.transform,
        overlayId: source.overlayId,
      });
    },
    [shots, splitTimelineVideoClip, timelineOverlays, timelineShotIds]
  );

  const extractFrameAtPlayhead = useCallback(
    async (playheadMs: number) => {
      const timelineFrame = timelineOffsetMsToFrames(playheadMs);
      const imageSource = resolveTimelineImageClip(timelineItems, timelineFrame);
      const source = resolveTimelineVideoSource(
        shots,
        timelineShotIds,
        playheadMs,
        timelineOverlays
      );
      if (timelineImageWinsVisualOverlap(imageSource, source)) {
        const targetLayer = extractedFrameTargetVisualLayer(imageSource!.clip);
        await addTimelineImageClip({
          clipId: duplicatedTimelineImageClipId({
            imageId: imageSource!.clip.imageId,
            timelineFrame,
            visualLayer: targetLayer,
          }),
          stableShotId: imageSource!.stableShotId,
          timelineFrame,
          imageId: imageSource!.clip.imageId,
          imageUrl: imageSource!.clip.imageUrl,
          label: `抽帧 ${formatStoryboardTimestamp(playheadMs)}`,
          visualLayer: targetLayer,
        });
        return;
      }
      if (!source) {
        throw new Error("当前帧没有可提取的图片或视频");
      }
      const finalFrameInset = 1 / 30;
      const captureAtSec = Math.max(
        source.sourceStartSec,
        Math.min(
          source.sourceTimeSec,
          Math.max(source.sourceStartSec, source.sourceEndSec - finalFrameInset)
        )
      );
      const rangeQuery = source.rangeId ? `&rangeId=${source.rangeId}` : "";
      const response = await fetch(
        `/api/video-frames/${source.takeId}?atSec=${captureAtSec.toFixed(3)}${rangeQuery}`
      );
      if (!response.ok) throw new Error("服务器无法提取当前视频帧");
      const frameBlob = await response.blob();
      const mimeType = frameBlob.type || "image/png";
      const frameBase64 = await fileBase64(
        new File([frameBlob], "timeline-frame.png", { type: mimeType })
      );
      const imported = await importStoryMaterial({
        fileName: `${source.label.replace(/[\s\\/:*?"<>|]+/g, "-") || "shot"}-${Math.round(playheadMs)}ms.png`,
        mimeType,
        fileBase64: frameBase64,
        targetStableShotId: source.stableShotId,
        preserveTimelineSelection: true,
        note: `时间线抽帧 · ${Math.round(playheadMs)}ms · ${formatStoryboardTimestamp(playheadMs)} · 来源 Take ${source.takeId}`,
      });
      if (imported.kind !== "image") {
        throw new Error("服务器返回的抽帧素材类型不正确");
      }
      await addTimelineImageClip({
        stableShotId: source.stableShotId,
        timelineFrame,
        imageId: imported.imageId,
        imageUrl: imported.imageUrl,
        label: `抽帧 ${formatStoryboardTimestamp(playheadMs)}`,
        visualLayer: extractedFrameTargetVisualLayer(source),
      });
    },
    [
      addTimelineImageClip,
      importStoryMaterial,
      shots,
      timelineItems,
      timelineOverlays,
      timelineShotIds,
    ]
  );

  // 故事版看板的「剪辑」行和底部时间线共用同一份播放状态与同一批剪辑动作，
  // 所以折叠底部时间线之后，看板里依然能走带、切割、修剪和重排。
  const boardTimeline = useMemo<StoryboardBoardTimeline>(
    () => ({
      playheadMs: timelinePlayback.playheadMs,
      isPlaying: timelinePlayback.isPlaying,
      // 整条片长按最大结束时间算：移动之后靠前的镜头完全可能结束得最晚。
      totalMs: storyboardTimingTotalMs(timings),
      audioClips: storyboardAudioClips,
      audioTotalMs: storyboardAudioTimelineTotalMs(storyboardAudioClips),
      anchors: timelineAnchors,
      overlays: timelineOverlays,
      onMoveTimelineItemToLayer: moveTimelineItemToLayer,
      onMoveTimelineImageClip: moveTimelineImageClip,
      writePending: timelineWritePending,
      magneticJoins: timelineMagneticJoins(buildTimelineLayout(timelineItems)),
      previewGroupMove: ({ stableShotId, direction }) =>
        previewTimelineGroup(stableShotId, direction),
      onMoveTimelineGroup: async ({ stableShotId, direction, deltaFrames }) => {
        const result = await moveTimelineGroup(
          stableShotId,
          direction,
          deltaFrames
        );
        if (result.applied) toast.success("已整体移动这一组镜头");
        else if (result.reason) toast.error(result.reason);
        return result;
      },
      // 拖镜头本体：只移动这一镜，同方向的邻居原地不动。批量移动仍然
      // 走上面的 onMoveTimelineGroup，由六点抓手触发。
      onMoveTimelineShot: async ({
        stableShotId,
        deltaFrames,
        snapThresholdFrames,
        visualLayer,
      }) => {
        const result = await moveTimelineShot(
          stableShotId,
          deltaFrames,
          snapThresholdFrames,
          visualLayer
        );
        if (result.reason) toast.error(result.reason);
        return result;
      },
      onAddAnchor: async timelineFrame => {
        const result = await addTimelineAnchorAtFrame(timelineFrame);
        if (result.applied) toast.success("已钉下位置锚点");
        else if (result.reason) toast.error(result.reason);
        return result;
      },
      onRemoveAnchor: async ({ stableShotId, anchorId }) => {
        const result = await removeTimelineAnchor(stableShotId, anchorId);
        if (result.applied) toast.success("已取消位置锚点");
        else if (result.reason) toast.error(result.reason);
        return result;
      },
      onCreateGapTransition: async ({ beforeStableShotId, afterStableShotId }) => {
        if (activeStoryId == null) {
          return { applied: false, reason: "故事未加载" };
        }
        const result = await proposeGapTransitionCard({
          storyId: activeStoryId,
          beforeStableShotId,
          afterStableShotId,
        });
        if (result.applied) {
          toast.success("已在聊天里生成待确认的过渡镜头卡片");
        } else if (result.reason) {
          toast.error(result.reason);
        }
        return result;
      },
      onCreateExtractedFrameTransition: async ({ leftImageId, rightImageId }) => {
        if (activeStoryId == null) {
          return { applied: false, reason: "故事未加载" };
        }
        const extracted = shots.flatMap(shot =>
          ((shot as typeof shot & {
            imageVersions?: Array<{ id: number; imageUrl: string; prompt: string | null }>;
          }).imageVersions ?? []).flatMap(image => {
            const atMs = extractedFrameTimeMs(image.prompt);
            return atMs == null
              ? []
              : [{ id: `image-${image.id}`, imageId: image.id, atMs, imageUrl: image.imageUrl }];
          })
        );
        const left = extracted.find(frame => frame.imageId === leftImageId);
        const right = extracted.find(frame => frame.imageId === rightImageId);
        if (!left || !right) {
          return { applied: false, reason: "抽帧已失效，请重新选择" };
        }
        setExtractedFrameRequirements(
          left.atMs <= right.atMs ? { left, right } : { left: right, right: left }
        );
        return { applied: true };
      },
      onDeleteExtractedFrame: async imageId => {
        try {
          await deleteExtractedFrame(imageId);
          toast.success("已删除这张抽帧");
          return { applied: true };
        } catch (error) {
          const reason = error instanceof Error ? error.message : "删除抽帧失败";
          toast.error(reason);
          return { applied: false, reason };
        }
      },
      selectedRange: boardSelectedRange,
      // 切割和提帧都要拿到那一处的视频，没有视频就让菜单和按钮提前灰掉。
      canSplitAt: playheadMs => {
        const source = resolveTimelineVideoSource(
          shots,
          timelineShotIds,
          playheadMs,
          timelineOverlays
        );
        return Boolean(source && !source.overlayId);
      },
      canExtractAt: playheadMs => {
        const source = resolveTimelineVideoSource(
          shots,
          timelineShotIds,
          playheadMs,
          timelineOverlays
        );
        const image = resolveTimelineImageClip(
          timelineItems,
          timelineOffsetMsToFrames(playheadMs)
        );
        return Boolean(source || image);
      },
      onSeek: playheadMs =>
        setTimelineSeekRequest(current => ({
          id: current.id + 1,
          playheadMs,
        })),
      onTogglePlay: isPlaying =>
        setTimelinePlaybackRequest(current => ({
          id: current.id + 1,
          isPlaying,
        })),
      onSelectRange: range => {
        setBoardSelectedRange(
          range ? { startMs: range.startMs, endMs: range.endMs } : null
        );
        if (!range) {
          // 取消选区（Esc 或空点一下）要连聊聊那张卡一起撤掉，不然时间条上高亮没了，
          // 下一条消息却还挂着上一个选区。只撤自己那张，别顺手把划词选中也清了。
          if (activeSelection?.sourceType === "timeline-range") {
            setActiveSelection(null);
          }
          return;
        }
        const timing = timings.find(
          item => item.stableShotId === range.stableShotId
        );
        const shot = shots.find(item => item.shotNo === range.shotNo);
        if (!timing) return;
        // 选区可以横跨几个镜头，把跨到的镜头都点名再交给聊聊。
        const coveredLabels = timings
          .filter(
            item => item.startMs < range.endMs && item.endMs > range.startMs
          )
          .map(item => {
            const covered = shots.find(
              candidate => candidate.shotNo === item.shotNo
            );
            return covered ? shotLabel(covered) : `镜头 ${item.shotNo}`;
          });
        const summary = storyboardEditSelectionSummary({
          shotLabels:
            coveredLabels.length > 0
              ? coveredLabels
              : [shot ? shotLabel(shot) : `镜头 ${range.shotNo}`],
          range,
          timing,
        });
        setActiveSelection({
          sourceType: "timeline-range",
          sourceId: `${range.stableShotId}:${Math.round(range.startMs)}-${Math.round(range.endMs)}`,
          selectedText: summary.selectedText,
          fullText: summary.fullText,
          storyId: activeStoryId,
          stableShotId: range.stableShotId,
          shotNo: range.shotNo,
          cueCode: shot?.cueCode ?? null,
          selection: {
            kind: "time",
            startSec: range.startMs / 1000,
            endSec: range.endMs / 1000,
          },
          objectVersion: `storyboard-range:${range.stableShotId}`,
          materialStatus: "timeline-range",
        });
        toast.success("已选中这一段，在左边对话框说要怎么改就行");
      },
      onTrimShotDuration: async input => {
        try {
          await updateShotDuration(input.shotNo, input.durationMs);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "时长未保存");
        }
      },
      // 帧级、锚点安全的裁剪：另一头锚定不动，裁边贴到位置锚点为止。
      // 有它就走它——旧的 onTrimShotDuration 只改 plannedDurationMs，
      // 会被已经写死的 durationFrames 盖掉，松手瞬间又弹回原状。
      onTrimTimelineEdge: async ({ stableShotId, edge, requestedBoundaryFrame }) => {
        const result = await trimTimelineItemEdge(
          stableShotId,
          edge,
          requestedBoundaryFrame
        );
        if (!result.applied && result.reason) toast.error(result.reason);
        return result;
      },
      onRollTimelineJoin: async ({
        leftStableShotId,
        rightStableShotId,
        requestedBoundaryFrame,
      }) => {
        const result = await rollTimelineJoin(
          leftStableShotId,
          rightStableShotId,
          requestedBoundaryFrame
        );
        if (!result.applied && result.reason) toast.error(result.reason);
        return result;
      },
      onDetachTimelineMagnet: async ({
        leftStableShotId,
        rightStableShotId,
      }) => {
        const result = await detachTimelineMagnet(
          leftStableShotId,
          rightStableShotId
        );
        if (!result.applied && result.reason) toast.error(result.reason);
        return result;
      },
      onSplitAt: async playheadMs => {
        try {
          await splitAtPlayhead(playheadMs);
          toast.success("已在当前帧切割视频");
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "切割当前帧失败"
          );
        }
      },
      onExtractFrameAt: async playheadMs => {
        try {
          await extractFrameAtPlayhead(playheadMs);
          toast.success("当前帧已加入该镜头的画面");
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "提取当前帧失败"
          );
        }
      },
      onReorderShot: async input => {
        try {
          await reorderShotInTimeline(
            input.sourceStableShotId,
            input.targetStableShotId
          );
          toast.success("镜头顺序已保存");
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "镜头顺序未保存"
          );
        }
      },
    }),
    [
      activeSelection?.sourceType,
      activeStoryId,
      addTimelineAnchorAtFrame,
      boardSelectedRange,
      extractFrameAtPlayhead,
      detachTimelineMagnet,
      moveTimelineGroup,
      moveTimelineImageClip,
      moveTimelineItemToLayer,
      moveTimelineShot,
      previewTimelineGroup,
      removeTimelineAnchor,
      reorderShotInTimeline,
      rollTimelineJoin,
      setActiveSelection,
      shots,
      storyboardAudioClips,
      splitAtPlayhead,
      timelineAnchors,
      timelinePlayback.isPlaying,
      timelinePlayback.playheadMs,
      timelineItems,
      timelineShotIds,
      proposeGapTransitionCard,
      proposeExtractedFrameTransitionCard,
      timelineWritePending,
      timelineOverlays,
      timings,
      trimTimelineItemEdge,
      updateShotDuration,
    ]
  );

  useEffect(() => {
    const handleEditingShortcut = (event: KeyboardEvent) => {
      const isSpaceKey = event.key === " " || event.key === "Spacebar";
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetKind: EditingShortcutTargetKind = target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"]'
      )
        ? "text"
        : target?.closest("button, a, [role='button']")
          ? "button"
          : "other";
      if (
        !shouldHandleEditingShortcut({
          key: event.key,
          zoneActive: keyboardShortcutZoneRef.current,
          defaultPrevented: event.defaultPrevented,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          targetKind,
        })
      ) {
        return;
      }
      event.preventDefault();
      if (isSpaceKey) {
        setTimelinePlaybackRequest(current => ({
          id: current.id + 1,
          isPlaying: !timelinePlayback.isPlaying,
        }));
        return;
      }
      setTimelinePlaybackRequest(current => ({
        id: current.id + 1,
        isPlaying: false,
      }));
      setTimelineSeekRequest(current => ({
        id: current.id + 1,
        playheadMs: stepTimelinePlayheadByFrames(
          timelinePlayback.playheadMs,
          event.key === "ArrowRight" ? 1 : -1,
          chatCutTimeline?.fps ?? 30,
          timings.at(-1)?.endMs ?? 0,
          event.shiftKey ? 10 : 1
        ),
      }));
    };
    window.addEventListener("keydown", handleEditingShortcut);
    return () => window.removeEventListener("keydown", handleEditingShortcut);
  }, [
    chatCutTimeline?.fps,
    keyboardShortcutZoneRef,
    timelinePlayback.isPlaying,
    timelinePlayback.playheadMs,
    timings,
  ]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在加载剪辑工作台…
      </div>
    );
  }

  if (shots.length === 0) {
    return (
      <section
        className="flex h-full flex-col items-center justify-center px-6 text-center"
        aria-label="Storyboard empty state"
      >
        <div className="w-full max-w-[31rem]">
          <div
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: "var(--nayin-glow)" }}
          >
            {isGeneratingScript ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--nayin-accent)]" />
            ) : (
              <Clapperboard className="h-5 w-5 text-[var(--nayin-accent)]" />
            )}
          </div>
          <p className="mt-4 text-base font-semibold tracking-tight text-foreground">
            {isGeneratingScript
              ? "正在生成 Storyboard 表格…"
              : "先从左边，讲一句你的故事"}
          </p>
          <p className="mx-auto mt-1.5 max-w-[26rem] text-xs leading-relaxed text-muted-foreground">
            {!confirmedIntent
              ? "选择这次想做成什么，或直接说出脑海里的第一句话。这里随后会长出镜头和时间线。"
              : !hasConversationSource
                ? "意图已经确认。请先在左侧说出要讲的内容，再直接生成表格。"
                : "直接使用对话原文生成镜头表，不再要求先生成 Story Card。"}
          </p>
          {!confirmedIntent ? (
            <ol
              className="mt-6 grid grid-cols-3 gap-2 text-left"
              aria-label="新故事步骤"
            >
              {[
                ["01", "选一个方向"],
                ["02", "说出故事"],
                ["03", "生成镜头"],
              ].map(([step, label]) => (
                <li
                  key={step}
                  className="border-t pt-2"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  <span className="font-mono text-[9px] text-nayin-bright">
                    {step}
                  </span>
                  <span className="mt-1 block text-[10.5px] font-medium text-foreground">
                    {label}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void generateScript()}
          disabled={
            !confirmedIntent || !hasConversationSource || isGeneratingScript
          }
          className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: "var(--nayin-accent)",
            color: "var(--background)",
          }}
        >
          {isGeneratingScript ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clapperboard className="h-3.5 w-3.5" />
          )}
          直接生成 Storyboard 表格
        </button>
      </section>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      data-testid="editing-nle-workspace"
    >
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="editing-storyboard-preview-widths-v3"
        className="min-h-0 flex-1 overflow-hidden"
        data-testid="editing-storyboard-preview-split"
      >
        <ResizablePanel
          id="editing-storyboard"
          order={1}
          defaultSize={DEFAULT_STORYBOARD_PANEL_SIZE}
          minSize={30}
          maxSize={68}
          className="min-w-0"
        >
          <EditingStoryboardPanel
            boardTimeline={boardTimeline}
            onRelink={relinkFiles}
            relinkProgress={relinkProgress}
            onAttachXml={attachXml}
            attachProgress={attachProgress}
            onEditVideo={openVideoEditor}
            onEditImage={openImageEditor}
            onCopyVideo={copyVideo}
            onPasteVideo={pasteVideo}
            videoClipboardLabel={videoClipboard?.label ?? null}
          />
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className="creation-board-resize-handle !w-2 after:!w-2"
          aria-label="Resize Storyboard and Preview"
          title="Resize Storyboard and Preview"
        />
        <ResizablePanel
          id="editing-preview"
          order={2}
          defaultSize={DEFAULT_PREVIEW_PANEL_SIZE}
          minSize={32}
          className="min-w-0"
        >
          <ShotPreview
            shot={selectedShot}
            timing={
              selectedShot ? timingByShotNo.get(selectedShot.shotNo) : undefined
            }
            sourceClip={selectedSourceClip}
            timelineVideoSource={timelineVideoSourceForSelectedShot(
              activeTimelineVideoSource,
              selectedShot?.shotNo
            )}
            timelineImageSource={activeTimelineImageSource}
            editorPreview={
              videoEditorTarget && videoEditorPreviewDraft
                ? {
                    target: videoEditorTarget,
                    draft: videoEditorPreviewDraft,
                  }
                : null
            }
            suppressDefaultVideo={Boolean(
              selectedShot?.timelineItem?.visualClipsReplacePrimary
            )}
            playheadMs={timelinePlayback.playheadMs}
            timelinePlaying={timelinePlayback.isPlaying}
            format={chatCutTimeline}
            onRequestTimelinePlaying={isPlaying => {
              setTimelinePlaybackRequest(current => ({
                id: current.id + 1,
                isPlaying,
              }));
            }}
            keyboardShortcutZoneRef={keyboardShortcutZoneRef}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <MultiTrackTimeline
        visible={timelineVisible}
        shots={shots}
        timelineShotIds={timelineShotIds}
        manifest={chatCutTimeline}
        selectedShotNo={selectedShot?.shotNo ?? null}
        onSelectShot={selectShot}
        onPlaybackChange={setTimelinePlayback}
        playbackRequest={timelinePlaybackRequest}
        seekRequest={timelineSeekRequest}
        onSplitAtPlayhead={splitAtPlayhead}
        onExtractFrameAtPlayhead={extractFrameAtPlayhead}
        onMoveTimelineClip={moveTimelineVideoClip}
        onEditVideo={openVideoEditor}
        onEditImage={openImageEditor}
        onCopyVideo={copyVideo}
        onPasteVideo={pasteVideo}
        videoClipboardLabel={videoClipboard?.label ?? null}
        keyboardShortcutZoneRef={keyboardShortcutZoneRef}
      />
      {videoEditorTarget ? (
        <VideoClipEditorPanel
          target={videoEditorTarget}
          saving={savingVideoEdit}
          onClose={closeVideoEditor}
          onApply={applyVideoEdit}
          onPreviewChange={setVideoEditorPreviewDraft}
        />
      ) : null}
      {imageEditorTarget ? (
        <ImageClipEditorPanel
          target={imageEditorTarget}
          saving={savingImageEdit}
          onClose={() => setImageEditorTarget(null)}
          onApply={applyImageEdit}
        />
      ) : null}
      {extractedFrameRequirements ? (
        <ExtractedFrameTransitionRequirementsDialog
          left={extractedFrameRequirements.left}
          right={extractedFrameRequirements.right}
          onCancel={() => setExtractedFrameRequirements(null)}
          onContinue={async ({ instruction, movementAmplitude }) => {
            if (activeStoryId == null) {
              return { applied: false, reason: "故事未加载" };
            }
            const result = await proposeExtractedFrameTransitionCard({
              storyId: activeStoryId,
              leftImageId: extractedFrameRequirements.left.imageId,
              rightImageId: extractedFrameRequirements.right.imageId,
              instruction,
              movementAmplitude,
            });
            if (result.applied) {
              setExtractedFrameRequirements(null);
              toast.success("已在聊天里生成待确认的覆盖视频卡片");
            }
            return result;
          }}
        />
      ) : null}
    </div>
  );
}
