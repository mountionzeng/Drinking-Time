import {
  Captions,
  ClipboardPaste,
  Copy,
  FileUp,
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
  TimelineTransform,
  TimelineVideoEffects,
} from "@shared/storyMaterial";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import StoryboardPanel from "@/features/storyAgent/views/StoryboardPanel";
import {
  buildStoryboardTimingRows,
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
  type CreationEditorShot,
} from "../CreationEditorContext";
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
};

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

export function resolveTimelineVideoSource(
  shots: CreationEditorShot[],
  timelineShotIds: string[],
  playheadMs: number
): TimelineVideoSource | null {
  const timings = buildStoryboardTimingRows(shots, timelineShotIds);
  const finalEndMs = timings.at(-1)?.endMs ?? 0;
  const lookupMs = Math.min(
    Math.max(0, playheadMs),
    Math.max(0, finalEndMs - 1)
  );
  const timing = timings.find(
    item => lookupMs >= item.startMs && lookupMs < item.endMs
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
    takeStableShotId: stableShotId,
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
}: {
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
  editorPreview,
  suppressDefaultVideo,
  playheadMs,
  timelinePlaying,
  format,
  onRequestTimelinePlaying,
}: {
  shot: CreationEditorShot | null;
  timing?: { startMs: number; endMs: number; durationMs: number };
  sourceClip?: ChatCutTimelineClip | null;
  timelineVideoSource?: TimelineVideoSource | null;
  editorPreview?: VideoEditorPreview | null;
  suppressDefaultVideo?: boolean;
  playheadMs: number;
  timelinePlaying: boolean;
  format: ChatCutTimelineManifest | null;
  onRequestTimelinePlaying: (isPlaying: boolean) => void;
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
    editorPreview?.target.videoUrl ??
    timelineVideoSource?.videoUrl ??
    (suppressDefaultVideo ? null : playableVideoUrl(shot));
  const imageUrl = editorPreview?.target.posterUrl ?? shotImageUrl(shot);
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
    normalizedEditorDraft?.transform ?? timelineVideoSource?.transform;
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
                      mediaIsCurrent: videoRef.current === event.currentTarget,
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
            ) : imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt={`${shot ? shotLabel(shot) : "当前镜头"} 预览`}
                  className="h-full w-full object-cover"
                  style={timelineTransformStyle(shot?.timelineItem?.transform)}
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

function findShotAtTime(
  timings: ReturnType<typeof buildStoryboardTimingRows>,
  timeMs: number
) {
  return timings.find(
    timing => timeMs >= timing.startMs && timeMs < timing.endMs
  )?.shotNo;
}

function buildTimelineLanes(
  shots: CreationEditorShot[],
  timelineShotIds: string[],
  manifest: ChatCutTimelineManifest | null
): TimelineLane[] {
  const timings = buildStoryboardTimingRows(shots, timelineShotIds);
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
      tone: "blue",
      clips: voiceClips.map(clip => ({
        id: `cue-${clip.id}`,
        label: cueText(clip, manifest),
        title: cueText(clip, manifest),
        startMs: clip.startMs,
        endMs: clip.endMs,
        shotNo: findShotAtTime(timings, clip.startMs),
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

  if (voiceClips.length > 0) {
    lanes.push({
      id: "voice",
      label: manifest ? timelineVoiceLaneLabel(manifest) : "旁白",
      icon: "voice",
      tone: "green",
      clips: voiceClips.map(clip => ({
        id: clip.id,
        label: chatCutCueCode(clip.name) || clip.name,
        title: manifest ? cueText(clip, manifest) : clip.name,
        startMs: clip.startMs,
        endMs: clip.endMs,
        shotNo: findShotAtTime(timings, clip.startMs),
      })),
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
      tone: "amber",
      clips: sourceAudio.map(clip => ({
        id: clip.id,
        label: clip.name,
        title: clip.name,
        startMs: clip.startMs,
        endMs: clip.endMs,
        shotNo: findShotAtTime(timings, clip.startMs),
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
  onSplitAtPlayhead,
  onExtractFrameAtPlayhead,
  onMoveTimelineClip,
  onEditVideo,
  onEditImage,
  onCopyVideo,
  onPasteVideo,
  videoClipboardLabel,
}: {
  visible: boolean;
  shots: CreationEditorShot[];
  timelineShotIds: string[];
  manifest: ChatCutTimelineManifest | null;
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number) => void;
  onPlaybackChange: (playback: TimelinePlaybackState) => void;
  playbackRequest: TimelinePlaybackRequest;
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
}) {
  const [scale, setScale] = useState(16);
  const timings = useMemo(
    () => buildStoryboardTimingRows(shots, timelineShotIds),
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
  const [timelinePasteTarget, setTimelinePasteTarget] = useState<{
    stableShotId: string;
    shotNo: number;
    targetOffsetMs: number;
  } | null>(null);
  const playheadMsRef = useRef(initialPlayheadMs);
  const isPlayingRef = useRef(false);
  const handledPlaybackRequestIdRef = useRef(0);
  const selectionFromPlayheadRef = useRef<number | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineWidth = Math.max(720, Math.ceil((totalMs / 1000) * scale));
  const tickStepSec = scale >= 24 ? 5 : 10;
  const tickCount = Math.ceil(totalMs / 1000 / tickStepSec);

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

  useEffect(() => {
    if (!visible) setPlaybackRunning(false);
  }, [setPlaybackRunning, visible]);

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
      const next = advanceTimelinePlayhead(
        playheadMsRef.current,
        currentTime - previousTime,
        totalMs
      );
      previousTime = currentTime;
      commitPlayhead(next.timeMs, {
        selectShot: true,
        playing: !next.ended,
      });
      if (next.ended) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [commitPlayhead, isPlaying, totalMs]);

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const playheadLeft = (playheadMs / 1000) * scale;
    const visibleLeft = viewport.scrollLeft;
    const visibleRight = viewport.scrollLeft + viewport.clientWidth;
    const margin = Math.min(60, viewport.clientWidth * 0.15);
    if (playheadLeft < visibleLeft + margin) {
      viewport.scrollLeft = Math.max(0, playheadLeft - margin);
    } else if (playheadLeft > visibleRight - margin) {
      viewport.scrollLeft = Math.max(
        0,
        playheadLeft - viewport.clientWidth * 0.35
      );
    }
  }, [playheadMs, scale]);

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

  useEffect(() => {
    if (!visible) return;
    const handleTimelineArrowKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"]'
        )
      ) {
        return;
      }
      event.preventDefault();
      stepPlayheadByKeyboard(
        event.key === "ArrowRight" ? 1 : -1,
        event.shiftKey
      );
    };
    window.addEventListener("keydown", handleTimelineArrowKey);
    return () => window.removeEventListener("keydown", handleTimelineArrowKey);
  }, [stepPlayheadByKeyboard, visible]);

  return (
    <section
      hidden={!visible}
      data-testid="editing-multitrack-timeline"
      className={`${visible ? "flex" : "hidden"} min-h-[230px] flex-[0_0_42%] flex-col border-t border-border bg-background`}
      aria-label="多轨剪辑时间轴"
      aria-hidden={!visible}
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
          {lanes.map(lane => (
            <div
              key={lane.id}
              className="flex h-[27px] items-center gap-1.5 border-b border-border/70 px-2 text-[10px] font-semibold text-muted-foreground"
            >
              {laneIcon(lane.icon)}
              <span className="truncate">{lane.label}</span>
            </div>
          ))}
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
            {lanes.map(lane => (
              <div
                key={lane.id}
                className="relative h-[27px] cursor-crosshair border-b border-border/70 bg-background"
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
                {lane.id === "primary-video" ? (
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
                {lane.clips.map(clip => {
                  const left = (clip.startMs / 1000) * scale;
                  const width = Math.max(
                    4,
                    ((clip.endMs - clip.startMs) / 1000) * scale
                  );
                  const selected = clip.shotNo === selectedShotNo;
                  const clipButton = (
                    <button
                      key={`${lane.id}-${clip.id}`}
                      type="button"
                      draggable={Boolean(clip.visualClip)}
                      onClick={() => {
                        setPlaybackRunning(false);
                        commitPlayhead(clip.startMs, {
                          selectShot: true,
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
            ))}
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
}: {
  timelineVisible?: boolean;
}) {
  const { setActiveSelection } = useStoryAgentActions();
  const activeSelection = useStorySpine(state => state.activeSelection);
  const {
    activeStoryId,
    shots,
    timelineShotIds,
    selectedShotNo,
    setSelectedShotNo,
    chatCutTimeline,
    importStoryMaterial,
    adoptVideoTake,
    reuseVideoTake,
    appendTimelineVideoClip,
    undoTimeline,
    splitTimelineVideoClip,
    moveTimelineVideoClip,
    updateTimelineVideoEdit,
    updateTimelineImageTransform,
    attachChatCutXml,
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
  const timelineShots = useMemo(
    () => resolveTimelineShots(shots, timelineShotIds),
    [shots, timelineShotIds]
  );
  const timings = useMemo(
    () => buildStoryboardTimingRows(shots, timelineShotIds),
    [shots, timelineShotIds]
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
        timelinePlayback.playheadMs
      ),
    [shots, timelinePlayback.playheadMs, timelineShotIds]
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
      if (
        event.defaultPrevented ||
        event.shiftKey ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"]'
        )
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
    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
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

  // 小酌生成并插入镜头后会把该镜头设为活动选区；剪辑台跟随这个稳定 ID
  // 定位，而不是依赖会因插入而变化的 SH 序号。
  useEffect(() => {
    const stableShotId = activeSelection?.stableShotId;
    if (!stableShotId) return;
    const shot = shots.find(
      item => (item.stableShotId ?? item.shotIdentity) === stableShotId
    );
    if (!shot || shot.shotNo === selectedShotNo) return;
    selectShot(shot.shotNo);
  }, [activeSelection?.stableShotId, selectShot, selectedShotNo, shots]);

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
        playheadMs
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
      });
    },
    [shots, splitTimelineVideoClip, timelineShotIds]
  );

  const extractFrameAtPlayhead = useCallback(
    async (playheadMs: number) => {
      const source = resolveTimelineVideoSource(
        shots,
        timelineShotIds,
        playheadMs
      );
      if (!source) {
        throw new Error("当前帧没有可提取的视频，请先为这个镜头采用视频 Take");
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
      await importStoryMaterial({
        fileName: `${source.label.replace(/[\s\\/:*?"<>|]+/g, "-") || "shot"}-${Math.round(playheadMs)}ms.png`,
        mimeType,
        fileBase64: frameBase64,
        targetStableShotId: source.stableShotId,
        preserveTimelineSelection: true,
        note: `时间线 ${formatStoryboardTimestamp(playheadMs)} 提取帧，来源 Take ${source.takeId}`,
      });
    },
    [importStoryMaterial, shots, timelineShotIds]
  );

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
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        当前故事还没有镜头。
      </div>
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
        onSplitAtPlayhead={splitAtPlayhead}
        onExtractFrameAtPlayhead={extractFrameAtPlayhead}
        onMoveTimelineClip={moveTimelineVideoClip}
        onEditVideo={openVideoEditor}
        onEditImage={openImageEditor}
        onCopyVideo={copyVideo}
        onPasteVideo={pasteVideo}
        videoClipboardLabel={videoClipboard?.label ?? null}
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
    </div>
  );
}
