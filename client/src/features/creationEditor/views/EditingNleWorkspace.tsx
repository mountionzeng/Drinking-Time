import { Clapperboard, FileUp, Loader2, Upload, Video } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
  timelineFramesToMs,
  timelineImageClipStartFrame,
  timelineOffsetMsToFrames,
} from "@shared/storyMaterial";
import { DEFAULT_TIMELINE_VIDEO_EFFECTS } from "@shared/storyMaterial";
import {
  buildTimelineLayout,
  overlayVisualLayer,
  resolveTimelineImageClipAt,
  resolveTimelineVisualFrame,
  timelineImageBeatsVisualSource,
} from "@shared/timelineLayout";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { readStoryImageDragPayload } from "@/features/storyAgent/storyImageDrag";
import { readVideoTakeDragPayload } from "@/features/storyAgent/views/videoTakeDrag";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { useTimelinePlaybackClock } from "../useTimelinePlaybackClock";
import {
  useVisualObjectEditingSession,
} from "../useVisualObjectEditingSession";
import { TimelineAudioPlayback } from "../TimelineAudioPlayback";
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
import { timelineMagneticJoins } from "@shared/timelineCommands";
import type { CreationEditorShot } from "../types";
import { stepTimelinePlayheadByFrames } from "../timelinePlayhead";
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
  const isArrowKey = input.key === "ArrowLeft" || input.key === "ArrowRight";
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

export function extractedFrameTargetVisualLayer(source: {
  visualLayer: number;
}): number {
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

function timelineVisualClipFrameUrl(
  clip: Pick<StoryTimelineVisualClip, "takeId" | "rangeId" | "sourceStartSec">
): string {
  return `/api/video-frames/${clip.takeId}?atSec=${clip.sourceStartSec.toFixed(3)}&rangeId=${clip.rangeId}`;
}

/** 解析实现已经收敛到 `@shared/timelineLayout`；这里只保留调用点习惯的签名。 */
export function resolveTimelineImageClip(
  items: readonly StoryTimelineItem[],
  timelineFrame: number,
  hiddenVisualLayers: readonly number[] = []
) {
  return resolveTimelineImageClipAt({
    items,
    hiddenVisualLayers,
    frame: timelineFrame,
  });
}

export function timelineImageWinsVisualOverlap(
  image: { clip: Pick<StoryTimelineImageClip, "visualLayer"> } | null,
  video: Pick<TimelineVideoSource, "visualLayer"> | null
): boolean {
  if (!image) return false;
  return timelineImageBeatsVisualSource(
    image as Parameters<typeof timelineImageBeatsVisualSource>[0],
    video ? video.visualLayer : null
  );
}

export function duplicatedTimelineImageClipId(input: {
  imageId: number;
  timelineFrame: number;
  visualLayer: number;
  nonce?: string;
}): string {
  const nonce =
    input.nonce ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  overlays: readonly StoryTimelineOverlay[] = [],
  hiddenVisualLayers: readonly number[] = []
): TimelineVideoSource | null {
  const timelineItems = timelineItemsForShots(shots);
  const timelineFrame = Math.max(0, Math.round((playheadMs * 30) / 1_000));
  const documentResolution = resolveTimelineVisualFrame({
    items: timelineItems,
    overlays,
    hiddenVisualLayers,
    frame: timelineFrame,
  });
  if (documentResolution.kind === "gap" || documentResolution.kind === "image")
    return null;
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
      visualLayer: overlayVisualLayer(overlay),
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
  // 隐藏层不参与赢家解析，和文档解析、导出用的是同一个隐藏集合。
  const timing = storyboardTimingWinnerAt(
    timings,
    lookupMs,
    hiddenVisualLayers
  );
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
  const videoUrl = timelineImageSource
    ? null
    : (editorPreview?.target.videoUrl ??
      timelineVideoSource?.videoUrl ??
      (suppressDefaultVideo ? null : playableVideoUrl(shot)));
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
                      ? (shot.timelineItem?.imageTransforms?.[
                          String(shot.imageId)
                        ] ?? shot.timelineItem?.transform)
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

type TimelineClipMoveTarget =
  | { kind: "shot"; stableShotId: string }
  | { kind: "image"; clipId: string; sourceStableShotId: string }
  | { kind: "video"; clipId: string; sourceStableShotId: string };

export type TimelineLane = {
  id: string;
  label: string;
  icon: "captions" | "video" | "voice" | "music" | "audio";
  domain: "visual" | "audio";
  /** Present for visual editing layers; higher values render above lower ones. */
  visualLayer?: number;
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
    moveTarget?: TimelineClipMoveTarget;
  }>;
};

export function timelineClipPointerPlacement(input: {
  startClientX: number;
  releaseClientX: number;
  pixelsPerSecond: number;
  targetVisualLayer: number;
}): { deltaFrames: number; visualLayer: number } {
  const pixelsPerSecond = Number.isFinite(input.pixelsPerSecond)
    ? Math.max(0, input.pixelsPerSecond)
    : 0;
  return {
    deltaFrames:
      pixelsPerSecond === 0
        ? 0
        : Math.round(
            ((input.releaseClientX - input.startClientX) / pixelsPerSecond) * 30
          ),
    visualLayer: Math.max(0, Math.round(input.targetVisualLayer)),
  };
}

const TIMELINE_IMAGE_CLIP_MIN_INTERACTION_WIDTH_PX = 28;

export function timelineClipInteractionWidth(input: {
  renderedWidth: number;
  moveKind?: TimelineClipMoveTarget["kind"];
}): number {
  const renderedWidth = Number.isFinite(input.renderedWidth)
    ? Math.max(0, input.renderedWidth)
    : 0;
  return input.moveKind === "image"
    ? Math.max(TIMELINE_IMAGE_CLIP_MIN_INTERACTION_WIDTH_PX, renderedWidth)
    : renderedWidth;
}

export function timelinePointerDragExceededThreshold(input: {
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  thresholdPx?: number;
}): boolean {
  const threshold = Math.max(0, input.thresholdPx ?? 4);
  return (
    Math.hypot(
      input.clientX - input.startClientX,
      input.clientY - input.startClientY
    ) >= threshold
  );
}

export function timelineClipKeyboardPlacement(input: {
  key: string;
  shiftKey: boolean;
  visualLayer: number;
}): { deltaFrames: number; visualLayer: number } | null {
  const step = input.shiftKey ? 15 : 1;
  if (input.key === "ArrowLeft") {
    return { deltaFrames: -step, visualLayer: input.visualLayer };
  }
  if (input.key === "ArrowRight") {
    return { deltaFrames: step, visualLayer: input.visualLayer };
  }
  if (input.key === "ArrowUp") {
    return { deltaFrames: 0, visualLayer: input.visualLayer + 1 };
  }
  if (input.key === "ArrowDown") {
    return { deltaFrames: 0, visualLayer: Math.max(0, input.visualLayer - 1) };
  }
  return null;
}

/** 字幕、旁白、音乐和原声只属于听觉编辑域，不跟随视觉镜头选中。 */
export function timelineLaneDomain(laneId: string): TimelineLane["domain"] {
  return ["captions", "voice", "music", "source-audio"].includes(laneId)
    ? "audio"
    : "visual";
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
  manifest: ChatCutTimelineManifest | null,
  requestedVisualLayerCount = 0
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

  const visualClips = timings.flatMap(timing => {
    const shot = shotsByNo.get(timing.shotNo);
    const baseVisualLayer = Math.max(
      0,
      Math.round(shot?.timelineItem?.visualLayer ?? 0)
    );
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
      visualLayer: baseVisualLayer,
      moveTarget: {
        kind: "shot" as const,
        stableShotId: timing.stableShotId,
      },
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
    const derivedVideoClips = (shot?.timelineItem?.visualClips ?? []).map(
      clip => {
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
          visualLayer: Math.max(
            0,
            Math.round(clip.visualLayer ?? baseVisualLayer)
          ),
          visualClip: clip,
          moveTarget: {
            kind: "video" as const,
            clipId: clip.id,
            sourceStableShotId: timing.stableShotId,
          },
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
      }
    );
    const derivedImageClips = (shot?.timelineItem?.imageClips ?? []).map(
      clip => {
        const startFrame = timelineImageClipStartFrame(clip, timing.startFrame);
        return {
          id: clip.id,
          label: clip.label,
          title: `${shot ? shotLabel(shot) : timing.stableShotId} · ${clip.label}`,
          startMs: timelineFramesToMs(startFrame),
          endMs: timelineFramesToMs(startFrame + clip.durationFrames),
          shotNo: timing.shotNo,
          imageUrl: clip.imageUrl,
          stableShotId: timing.stableShotId,
          visualLayer: Math.max(0, Math.round(clip.visualLayer)),
          imageEditTarget: undefined,
          moveTarget: {
            kind: "image" as const,
            clipId: clip.id,
            sourceStableShotId: timing.stableShotId,
          },
        };
      }
    );
    return shot?.timelineItem?.visualClipsReplacePrimary
      ? [...derivedVideoClips, ...derivedImageClips]
      : [baseClip, ...derivedVideoClips, ...derivedImageClips];
  });
  const maxVisualLayer = Math.max(
    0,
    ...visualClips.map(clip => clip.visualLayer)
  );
  // Always leave one empty layer above the highest occupied layer. Dropping into it
  // immediately promotes it into a normal layer, so visual stacking never has a cap.
  const topVisualLayer = Math.max(
    maxVisualLayer + 1,
    Math.max(0, Math.round(requestedVisualLayerCount) - 1)
  );
  for (let visualLayer = topVisualLayer; visualLayer >= 0; visualLayer -= 1) {
    lanes.push({
      id: visualLayer === 0 ? "primary-video" : `visual-${visualLayer}`,
      label:
        visualLayer === 0
          ? primaryIndex
            ? `V${primaryIndex}`
            : "画面 1"
          : `画面 ${visualLayer + 1}`,
      icon: "video",
      domain: "visual",
      visualLayer,
      tone: visualLayer === 0 ? "green" : "gray",
      clips: visualClips.filter(clip => clip.visualLayer === visualLayer),
    });
  }

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

export {
  clearVisualIntentIfCurrent,
  visualClipboardTargetLayer,
} from "../useVisualObjectEditingSession";

export default function EditingNleWorkspace({
  videoEditorHandoffTarget = null,
  onVideoEditorHandoffHandled,
}: {
  videoEditorHandoffTarget?: VideoClipEditorTarget | null;
  onVideoEditorHandoffHandled?: () => void;
}) {
  const creationEditor = useCreationEditor();
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
    visualEditSessionReady,
    activeStoryId,
    shots,
    timelineShotIds,
    selectedShotNo,
    setSelectedShotNo,
    chatCutTimeline,
    importStoryMaterial,
    deleteExtractedFrame,
    commitInsertedTimelineShotUndo,
    discardPersistedShot,
    insertTimelineShotAt,
    adoptVideoTake,
    reuseVideoTake,
    appendTimelineVideoClip,
    undoTimeline,
    moveVisualClip,
    updateTimelineVideoEdit,
    updateTimelineImageTransform,
    updateShotDuration,
    reorderShotInTimeline,
    attachChatCutXml,
    timelineItems,
    timelineOverlays,
    timelineVisualLayerState,
    manageTimelineVisualLayer,
    previewTimelineGroup,
    moveTimelineGroup,
    moveTimelineShot,
    addTimelineAnchorAtFrame,
    removeTimelineAnchor,
    trimTimelineItemEdge,
    rollTimelineJoin,
    detachTimelineMagnet,
    timelineWritePending,
    initialStoryLoading,
  } = creationEditor;
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
  /**
   * 播放头同步进 spine，供聊聊回答「我现在看的是哪一秒」。
   *
   * 只在**暂停时**同步，有两个原因：
   *
   * 1. 播放中 rAF 每帧都会推一次播放头。每帧写一次全局 store 会触发整棵树
   *    重渲染，rAF 那个 effect 被清理重建，时钟当场停摆——表现就是「播放键
   *    亮着但时间不走」。这是 2026-08-24 实测踩到的，不是理论担心。
   * 2. 聊聊只在用户发消息那一刻需要这个值，而那时用户必然不在播放。
   */
  const [boardSelectedRange, setBoardSelectedRange] =
    useState<StoryboardEditRange | null>(null);
  const [extractedFrameRequirements, setExtractedFrameRequirements] = useState<{
    left: {
      id: string;
      clipId: string;
      imageId: number;
      atMs: number;
      timelineFrame: number;
      visualLayer: number;
      imageUrl: string;
    };
    right: {
      id: string;
      clipId: string;
      imageId: number;
      atMs: number;
      timelineFrame: number;
      visualLayer: number;
      imageUrl: string;
    };
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
  const timingRowsRef = useRef(timings);
  useEffect(() => {
    timingRowsRef.current = timings;
  }, [timings]);
  /** 整条片长按最大结束时间算：移动之后靠前的镜头完全可能结束得最晚。 */
  const boardTimelineTotalMs = useMemo(
    () => storyboardTimingTotalMs(timings),
    [timings]
  );
  /**
   * 播放时钟提到这一层。以前它长在底部时间线里，故事版的播放键只能隔着
   * playbackRequest 这层 id 握手去「请求」它——2026-08-24 实测这条链路是断的：
   * 按下播放后状态确实变成 playing，播放头却一帧不动。
   *
   * 时钟放在父层还有一个理由：底部时间线是要删的，播放不该跟着一起没。
   */
  /**
   * 播放头跨进新镜头时同步选中它。
   *
   * 这是从被删掉的底部时间线里搬过来的行为（原先叫 `selectShot: true`）：
   * 播放时镜头详情要跟着走，否则播到第五镜、右边还停在第一镜。
   * 用 ref 记下「这次选中是播放头引起的」，避免选中态再反过来把播放头拽回
   * 镜头开头——那会让播放每跨一镜就卡一下。
   */
  const selectionFromPlayheadRef = useRef<number | null>(null);
  const selectShotFromPlayhead = useCallback(
    (playheadMs: number) => {
      if (timingRowsRef.current.length === 0) return;
      const lastTiming = timingRowsRef.current.at(-1);
      const lookupMs = Math.min(
        playheadMs,
        Math.max(0, (lastTiming?.endMs ?? playheadMs) - 1)
      );
      const nextShotNo = findShotAtTime(timingRowsRef.current, lookupMs);
      if (nextShotNo == null) return;
      selectionFromPlayheadRef.current = nextShotNo;
      setSelectedShotNo(nextShotNo);
    },
    [setSelectedShotNo]
  );
  const playbackClock = useTimelinePlaybackClock({
    totalMs: boardTimelineTotalMs,
    onPlayheadCommit: selectShotFromPlayhead,
  });
  const setSpinePlayheadMs = useStorySpine(state => state.setPlayheadMs);
  useEffect(() => {
    if (playbackClock.isPlaying) return;
    setSpinePlayheadMs(Math.max(0, Math.round(playbackClock.playheadMs)));
  }, [setSpinePlayheadMs, playbackClock.isPlaying, playbackClock.playheadMs]);
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
        playbackClock.playheadMs,
        timelineOverlays,
        timelineVisualLayerState.hidden
      ),
    [
      shots,
      timelineOverlays,
      playbackClock.playheadMs,
      timelineShotIds,
      timelineVisualLayerState.hidden,
    ]
  );
  const activeTimelineImageSource = useMemo(() => {
    const resolved = resolveTimelineVisualFrame({
      items: timelineItems,
      overlays: timelineOverlays,
      hiddenVisualLayers: timelineVisualLayerState.hidden,
      frame: Math.max(0, Math.round((playbackClock.playheadMs * 30) / 1000)),
    });
    return resolved.kind === "image"
      ? {
          imageUrl: resolved.placement.clip.imageUrl,
          transform: resolved.placement.clip.transform,
        }
      : null;
  }, [
    timelineItems,
    timelineOverlays,
    playbackClock.playheadMs,
    timelineVisualLayerState.hidden,
  ]);
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

  const resolveActiveVideoSource = useCallback(
    (playheadMs: number) =>
      resolveTimelineVideoSource(
        shots,
        timelineShotIds,
        playheadMs,
        timelineOverlays,
        timelineVisualLayerState.hidden
      ),
    [
      shots,
      timelineOverlays,
      timelineShotIds,
      timelineVisualLayerState.hidden,
    ]
  );
  const {
    editingStorySessionKey,
    isEditingStorySessionCurrent,
    hasVisualClipboard,
    splitAtPlayhead,
    extractFrameAtPlayhead,
    pasteVisualObject,
    isVisualObjectCommandAvailable,
    executeVisualObjectCommand,
  } = useVisualObjectEditingSession({
    editor: creationEditor,
    timings,
    selectShot,
    setActiveSelection,
    seekTimeline: playbackClock.seek,
    resolveVideoSource: resolveActiveVideoSource,
  });

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
      if (
        !shouldHandleCreationEditorUndoShortcut({
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
        })
      ) {
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
    return () =>
      window.removeEventListener("keydown", handleUndoShortcut, true);
  }, [undoTimeline]);

  const openVideoEditor = useCallback(
    (target: VideoClipEditorTarget) => {
      setSelectedShotNo(target.shotNo);
      playbackClock.setPlaying(false);
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
      playbackClock.setPlaying(false);
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
          transform: draft.transform,
          textOverlay: draft.textOverlay,
        });
        const nextTarget = {
          ...target,
          transform: draft.transform,
          textOverlay: draft.textOverlay,
        };
        setImageEditorTarget(nextTarget);
        toast.success(
          draft.textOverlay
            ? `${target.label} 构图与文字已保存`
            : `${target.label} 构图已保存`
        );
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

  const placeExternalVisual = useCallback(
    async (
      dataTransfer: DataTransfer,
      timelineFrame: number,
      visualLayer: number
    ): Promise<{ shotNo: number }> => {
      const imagePayload = readStoryImageDragPayload(dataTransfer);
      const videoPayload = readVideoTakeDragPayload(dataTransfer);
      const file = Array.from(dataTransfer.files).find(isVisualFile) ?? null;
      if (!imagePayload && !videoPayload && !file) {
        throw new Error("请拖入图片、视频或素材库里的画面");
      }
      const inserted = await insertTimelineShotAt({
        timelineFrame,
        visualLayer,
        referencedImageId: imagePayload?.imageId,
      });
      try {
        if (imagePayload) {
          // The insertion persisted a non-owning reference. Reassigning the
          // generated image row here would steal it from its source shot.
        } else if (videoPayload) {
          const take = shots
            .flatMap(shot => shot.videoTakes ?? [])
            .find(candidate => candidate.id === videoPayload.takeId);
          await reuseVideoTake({
            sourceTakeId: videoPayload.takeId,
            targetStableShotId: inserted.stableShotId,
            plannedDurationSec: Math.max(1 / 30, take?.durationSec ?? 3),
          });
        } else if (file) {
          const imported = await importStoryMaterial({
            fileName: file.name,
            mimeType: mediaMime(file),
            fileBase64: await fileBase64(file),
            targetStableShotId: inserted.stableShotId,
            preserveTimelineSelection: true,
            note: `拖入时间线 · 第 ${visualLayer + 1} 层 · ${timelineFrame} 帧`,
          });
          if (imported.kind === "video") {
            await adoptVideoTake({
              stableShotId: inserted.stableShotId,
              takeId: imported.takeId,
              plannedDurationSec: imported.plannedDurationSec,
            });
          }
        }
        commitInsertedTimelineShotUndo(inserted.stableShotId);
        return { shotNo: inserted.shotNo };
      } catch (error) {
        // 导入失败不能在故事里遗留一个看不见、没有素材的空镜头。
        try {
          await discardPersistedShot(inserted.stableShotId);
        } catch (cleanupError) {
          const reason =
            error instanceof Error ? error.message : "素材落位失败";
          const cleanupReason =
            cleanupError instanceof Error ? cleanupError.message : "清理失败";
          throw new Error(`${reason}；未完成镜头清理失败：${cleanupReason}`);
        }
        throw error;
      }
    },
    [
      adoptVideoTake,
      commitInsertedTimelineShotUndo,
      discardPersistedShot,
      importStoryMaterial,
      insertTimelineShotAt,
      reuseVideoTake,
      shots,
    ]
  );

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

  // 故事版看板的「剪辑」行和底部时间线共用同一份播放状态与同一批剪辑动作，
  // 所以折叠底部时间线之后，看板里依然能走带、切割、修剪和重排。
  const boardTimeline = useMemo<StoryboardBoardTimeline>(
    () => ({
      storySessionKey: editingStorySessionKey,
      isStorySessionCurrent: isEditingStorySessionCurrent,
      playheadMs: playbackClock.playheadMs,
      isPlaying: playbackClock.isPlaying,
      totalMs: boardTimelineTotalMs,
      audioClips: storyboardAudioClips,
      audioTotalMs: storyboardAudioTimelineTotalMs(storyboardAudioClips),
      anchors: timelineAnchors,
      overlays: timelineOverlays,
      visualLayerState: timelineVisualLayerState,
      onManageVisualLayer: manageTimelineVisualLayer,
      onMoveVisualClip: moveVisualClip,
      canPasteVisualObject: hasVisualClipboard && visualEditSessionReady,
      onPasteVisualObject: pasteVisualObject,
      isVisualObjectCommandAvailable,
      onVisualObjectCommand: executeVisualObjectCommand,
      onPlaceExternalVisual: placeExternalVisual,
      writePending: timelineWritePending,
      magneticJoins: timelineMagneticJoins(
        buildTimelineLayout(timelineItems),
        timelineVisualLayerState.hidden
      ),
      previewGroupMove: ({ stableShotId, direction }) =>
        previewTimelineGroup(stableShotId, direction),
      onMoveTimelineGroup: async ({ stableShotId, direction, deltaFrames }) => {
        const result = await moveTimelineGroup(
          stableShotId,
          direction,
          deltaFrames
        );
        if (!isEditingStorySessionCurrent()) return result;
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
        if (!isEditingStorySessionCurrent()) return result;
        if (result.reason) toast.error(result.reason);
        return result;
      },
      onAddAnchor: async timelineFrame => {
        const result = await addTimelineAnchorAtFrame(timelineFrame);
        if (!isEditingStorySessionCurrent()) return result;
        if (result.applied) toast.success("已钉下位置锚点");
        else if (result.reason) toast.error(result.reason);
        return result;
      },
      onRemoveAnchor: async ({ stableShotId, anchorId }) => {
        const result = await removeTimelineAnchor(stableShotId, anchorId);
        if (!isEditingStorySessionCurrent()) return result;
        if (result.applied) toast.success("已取消位置锚点");
        else if (result.reason) toast.error(result.reason);
        return result;
      },
      onCreateGapTransition: async ({
        beforeStableShotId,
        afterStableShotId,
      }) => {
        if (activeStoryId == null) {
          return { applied: false, reason: "故事未加载" };
        }
        const result = await proposeGapTransitionCard({
          storyId: activeStoryId,
          beforeStableShotId,
          afterStableShotId,
        });
        if (!isEditingStorySessionCurrent()) return result;
        if (result.applied) {
          toast.success("已在聊天里生成待确认的过渡镜头卡片");
        } else if (result.reason) {
          toast.error(result.reason);
        }
        return result;
      },
      onCreateExtractedFrameTransition: async ({
        leftImageId,
        rightImageId,
        leftClipId,
        rightClipId,
      }) => {
        if (activeStoryId == null) {
          return { applied: false, reason: "故事未加载" };
        }
        const extracted = timelineItems.flatMap(item => {
          const timing = timings.find(row => row.stableShotId === item.stableShotId);
          if (!timing) return [];
          return (item.imageClips ?? []).map(clip => {
            const timelineFrame = timelineImageClipStartFrame(
              clip,
              timing.startFrame
            );
            return {
              id: clip.id,
              clipId: clip.id,
              imageId: clip.imageId,
              atMs: timelineFramesToMs(timelineFrame),
              timelineFrame,
              visualLayer: clip.visualLayer,
              imageUrl: clip.imageUrl,
            };
          });
        });
        const left = extracted.find(
          frame => frame.clipId === leftClipId && frame.imageId === leftImageId
        );
        const right = extracted.find(
          frame => frame.clipId === rightClipId && frame.imageId === rightImageId
        );
        if (!left || !right) {
          return { applied: false, reason: "抽帧已失效，请重新选择" };
        }
        setExtractedFrameRequirements(
          left.atMs <= right.atMs
            ? { left, right }
            : { left: right, right: left }
        );
        return { applied: true };
      },
      onDeleteExtractedFrame: async imageId => {
        try {
          await deleteExtractedFrame(imageId);
          if (isEditingStorySessionCurrent()) {
            toast.success("已删除这张抽帧");
          }
          return { applied: true };
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "删除抽帧失败";
          if (isEditingStorySessionCurrent()) toast.error(reason);
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
          timelineOverlays,
          timelineVisualLayerState.hidden
        );
        return Boolean(source && !source.overlayId);
      },
      canExtractAt: playheadMs => {
        const visual = resolveTimelineVisualFrame({
          items: timelineItems,
          overlays: timelineOverlays,
          hiddenVisualLayers: timelineVisualLayerState.hidden,
          frame: timelineOffsetMsToFrames(playheadMs),
        });
        // 这里只做即时菜单提示；服务端仍会重新授权并判断素材是否可解码。
        return visual.kind !== "gap";
      },
      // 直接驱动时钟。以前要经过 playbackRequest 的 id 握手转给底部时间线，
      // 那一层随底部时间线一起删了。
      onSeek: playheadMs => playbackClock.seek(playheadMs),
      onTogglePlay: isPlaying => playbackClock.setPlaying(isPlaying),
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
          if (isEditingStorySessionCurrent()) {
            toast.error(error instanceof Error ? error.message : "时长未保存");
          }
        }
      },
      // 帧级、锚点安全的裁剪：另一头锚定不动，裁边贴到位置锚点为止。
      // 有它就走它——旧的 onTrimShotDuration 只改 plannedDurationMs，
      // 会被已经写死的 durationFrames 盖掉，松手瞬间又弹回原状。
      onTrimTimelineEdge: async ({
        stableShotId,
        edge,
        requestedBoundaryFrame,
      }) => {
        const result = await trimTimelineItemEdge(
          stableShotId,
          edge,
          requestedBoundaryFrame
        );
        if (!isEditingStorySessionCurrent()) return result;
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
        if (!isEditingStorySessionCurrent()) return result;
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
        if (!isEditingStorySessionCurrent()) return result;
        if (!result.applied && result.reason) toast.error(result.reason);
        return result;
      },
      onSplitAt: async (playheadMs, stableShotId) => {
        try {
          await splitAtPlayhead(playheadMs, stableShotId);
          if (isEditingStorySessionCurrent()) {
            toast.success("已在当前帧切割视频");
          }
        } catch (error) {
          if (isEditingStorySessionCurrent()) {
            toast.error(
              error instanceof Error ? error.message : "切割当前帧失败"
            );
          }
        }
      },
      onExtractFrameAt: async (playheadMs, operationLayer) => {
        try {
          await extractFrameAtPlayhead(playheadMs, operationLayer);
          if (isEditingStorySessionCurrent()) {
            toast.success("当前帧已加入该镜头的画面");
          }
        } catch (error) {
          if (isEditingStorySessionCurrent()) {
            toast.error(
              error instanceof Error ? error.message : "提取当前帧失败"
            );
          }
        }
      },
      onReorderShot: async input => {
        try {
          await reorderShotInTimeline(
            input.sourceStableShotId,
            input.targetStableShotId
          );
          if (isEditingStorySessionCurrent()) {
            toast.success("镜头顺序已保存");
          }
        } catch (error) {
          if (isEditingStorySessionCurrent()) {
            toast.error(
              error instanceof Error ? error.message : "镜头顺序未保存"
            );
          }
        }
      },
    }),
    [
      activeSelection?.sourceType,
      activeStoryId,
      editingStorySessionKey,
      executeVisualObjectCommand,
      isEditingStorySessionCurrent,
      isVisualObjectCommandAvailable,
      addTimelineAnchorAtFrame,
      boardSelectedRange,
      extractFrameAtPlayhead,
      detachTimelineMagnet,
      moveTimelineGroup,
      manageTimelineVisualLayer,
      moveTimelineShot,
      placeExternalVisual,
      pasteVisualObject,
      previewTimelineGroup,
      removeTimelineAnchor,
      reorderShotInTimeline,
      rollTimelineJoin,
      setActiveSelection,
      shots,
      storyboardAudioClips,
      splitAtPlayhead,
      timelineAnchors,
      playbackClock,
      timelineItems,
      timelineVisualLayerState,
      timelineShotIds,
      proposeGapTransitionCard,
      proposeExtractedFrameTransitionCard,
      timelineWritePending,
      hasVisualClipboard,
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
        playbackClock.togglePlaying();
        return;
      }
      playbackClock.setPlaying(false);
      playbackClock.seek(
        stepTimelinePlayheadByFrames(
          playbackClock.playheadMs,
          event.key === "ArrowRight" ? 1 : -1,
          chatCutTimeline?.fps ?? 30,
          timings.at(-1)?.endMs ?? 0,
          event.shiftKey ? 10 : 1
        )
      );
    };
    window.addEventListener("keydown", handleEditingShortcut);
    return () => window.removeEventListener("keydown", handleEditingShortcut);
  }, [
    chatCutTimeline?.fps,
    keyboardShortcutZoneRef,
    playbackClock.isPlaying,
    playbackClock.playheadMs,
    timings,
  ]);

  if (initialStoryLoading) {
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
            playheadMs={playbackClock.playheadMs}
            timelinePlaying={playbackClock.isPlaying}
            format={chatCutTimeline}
            onRequestTimelinePlaying={isPlaying =>
              playbackClock.setPlaying(isPlaying)
            }
            keyboardShortcutZoneRef={keyboardShortcutZoneRef}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      {/*
        底部时间线（MultiTrackTimeline，1282 行）已于 2026-08-24 删除：
        它和上方 Storyboard 是同一份数据的两个可编辑投影，标尺、缩放和图层
        操作各做了一遍。用户选择只留 Storyboard，标尺与缩放已搬过去。

        声音留在这一层：它不属于任何一个界面，跟着播放时钟走。
      */}
      <TimelineAudioPlayback
        manifest={chatCutTimeline}
        playheadMs={playbackClock.playheadMs}
        isPlaying={playbackClock.isPlaying}
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
              leftClipId: extractedFrameRequirements.left.clipId,
              rightClipId: extractedFrameRequirements.right.clipId,
              instruction,
              movementAmplitude,
            });
            if (result.applied) {
              setExtractedFrameRequirements(null);
              toast.success("已在聊天里生成待确认的普通镜头视频卡片");
            }
            return result;
          }}
        />
      ) : null}
    </div>
  );
}
