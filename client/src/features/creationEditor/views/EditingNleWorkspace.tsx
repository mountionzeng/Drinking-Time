import {
  Captions,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  SkipBack,
  Upload,
  Video,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import StoryboardPanel from "@/features/storyAgent/views/StoryboardPanel";
import {
  buildStoryboardTimingRows,
  formatStoryboardSecondsInput,
  formatStoryboardTimestamp,
  MAX_STORYBOARD_DURATION_MS,
  MIN_STORYBOARD_DURATION_MS,
  storyboardDurationMsFromSeconds,
} from "@/features/storyAgent/storyboardTiming";
import {
  chatCutBaseName,
  chatCutCueCode,
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
  timelineMsFromClientX,
} from "../timelinePlayhead";
import { videoTakeAffordance } from "../videoAssetViewModel";

const MIN_TIMELINE_SCALE = 8;
const MAX_TIMELINE_SCALE = 42;

function shotLabel(shotNo: number) {
  return `SH${String(shotNo).padStart(2, "0")}`;
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

function EditingStoryboardPanel({
  onRelink,
  relinkProgress,
}: {
  onRelink: (files: File[]) => Promise<void>;
  relinkProgress: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <aside
      className="flex min-h-0 w-[min(300px,34vw)] min-w-[240px] shrink-0 flex-col border-r border-border bg-background"
      aria-label="剪辑故事版看板"
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
      <div className="min-h-0 flex-1">
        <StoryboardPanel
          defaultViewMode="simple"
          embeddedEditorMode
          headerAction={
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(relinkProgress)}
              className="flex h-7 w-7 items-center justify-center rounded-sm bg-muted/50 text-muted-foreground transition hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
              aria-label={relinkProgress || "关联本地画面素材"}
              title={relinkProgress || "选择图片或视频，按文件名自动关联镜头"}
            >
              {relinkProgress ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
            </button>
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
  playheadMs,
  timelinePlaying,
  format,
  onUpdateDuration,
  onUpdateDialogue,
}: {
  shot: CreationEditorShot | null;
  timing?: { startMs: number; endMs: number; durationMs: number };
  sourceClip?: ChatCutTimelineClip | null;
  playheadMs: number;
  timelinePlaying: boolean;
  format: ChatCutTimelineManifest | null;
  onUpdateDuration: (durationMs: number) => Promise<void>;
  onUpdateDialogue: (dialogue: string) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoUrl = playableVideoUrl(shot);
  const imageUrl = shotImageUrl(shot);
  const durationMs = shot?.durationMs ?? timing?.durationMs ?? 2400;
  const durationValue = formatStoryboardSecondsInput(durationMs);
  const aspectRatio = format ? `${format.width} / ${format.height}` : "1 / 1";
  const timelineOffsetMs = timing
    ? Math.min(timing.durationMs, Math.max(0, playheadMs - timing.startMs))
    : 0;
  const sourceInMs = sourceClip?.sourceInMs ?? 0;
  const sourceDurationMs = Math.max(
    0,
    (sourceClip?.sourceOutMs ?? sourceInMs) - sourceInMs
  );
  const targetVideoTimeSeconds =
    (sourceInMs +
      (sourceDurationMs > 0
        ? Math.min(timelineOffsetMs, sourceDurationMs)
        : timelineOffsetMs)) /
    1000;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const maximumTime = Math.max(0, video.duration - 0.001);
    const targetTime = Math.min(targetVideoTimeSeconds, maximumTime);
    const drift = Math.abs(video.currentTime - targetTime);

    if (!timelinePlaying) {
      video.pause();
      if (drift > 0.035) video.currentTime = targetTime;
      return;
    }

    if (drift > 0.35) video.currentTime = targetTime;
    if (video.paused) void video.play().catch(() => undefined);
  }, [targetVideoTimeSeconds, timelinePlaying, videoUrl]);

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[color:var(--panel-header)]"
      aria-label="动态分镜预览"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold">动态分镜</span>
          {shot ? (
            <span className="ml-2 font-mono text-[10px] text-primary">
              {shotLabel(shot.shotNo)}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {timing
            ? `${formatStoryboardTimestamp(timing.startMs)} / ${formatStoryboardTimestamp(timing.endMs)}`
            : "00:00.000"}
        </span>
      </div>

      <div className="flex min-h-[220px] flex-1 items-center justify-center overflow-hidden bg-neutral-950 p-3">
        <div
          className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden border border-white/10 bg-black shadow-lg"
          style={{ aspectRatio, height: "min(100%, 52vh)" }}
        >
          {videoUrl ? (
            <video
              key={videoUrl}
              ref={videoRef}
              src={videoUrl}
              poster={imageUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={event => {
                const maximumTime = Math.max(
                  0,
                  event.currentTarget.duration - 0.001
                );
                event.currentTarget.currentTime = Math.min(
                  targetVideoTimeSeconds,
                  maximumTime
                );
                if (timelinePlaying) {
                  void event.currentTarget.play().catch(() => undefined);
                }
              }}
              onPlay={event => {
                const startSeconds = (sourceClip?.sourceInMs ?? 0) / 1000;
                const endSeconds = (sourceClip?.sourceOutMs ?? 0) / 1000;
                if (
                  event.currentTarget.currentTime < startSeconds ||
                  (endSeconds > startSeconds &&
                    event.currentTarget.currentTime >= endSeconds - 0.03)
                ) {
                  event.currentTarget.currentTime = startSeconds;
                }
              }}
              onTimeUpdate={event => {
                const endSeconds = (sourceClip?.sourceOutMs ?? 0) / 1000;
                if (
                  endSeconds > 0 &&
                  event.currentTarget.currentTime >= endSeconds
                ) {
                  event.currentTarget.pause();
                }
              }}
              className="h-full w-full object-contain"
              aria-label={`${shot ? shotLabel(shot.shotNo) : "当前镜头"} 视频预览`}
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={`${shot ? shotLabel(shot.shotNo) : "当前镜头"} 预览`}
              className="h-full w-full object-contain"
            />
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

      {shot ? (
        <div className="grid shrink-0 gap-2 border-t border-border bg-background p-2.5 md:grid-cols-[minmax(0,1fr)_112px]">
          <label className="min-w-0 text-[9px] font-semibold text-muted-foreground">
            台词 / 旁白
            <textarea
              key={`${shot.stableShotId}:dialogue:${shot.dialogue ?? ""}`}
              defaultValue={shot.dialogue ?? ""}
              rows={2}
              placeholder="输入这一镜对应的台词或旁白"
              onBlur={event => {
                const value = event.currentTarget.value.trim();
                if (value !== (shot.dialogue ?? "").trim()) {
                  void onUpdateDialogue(value);
                }
              }}
              className="mt-1 block w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="text-[9px] font-semibold text-muted-foreground">
            镜头时长 / s
            <input
              key={`${shot.stableShotId}:duration:${durationValue}`}
              type="number"
              min={MIN_STORYBOARD_DURATION_MS / 1000}
              max={MAX_STORYBOARD_DURATION_MS / 1000}
              step="0.001"
              defaultValue={durationValue}
              onKeyDown={event => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={event => {
                const nextDurationMs = storyboardDurationMsFromSeconds(
                  Number(event.currentTarget.value)
                );
                if (nextDurationMs == null) {
                  event.currentTarget.value = durationValue;
                  toast.error("镜头时长请输入 0.100–12.000 秒");
                  return;
                }
                if (nextDurationMs !== durationMs) {
                  void onUpdateDuration(nextDurationMs);
                }
              }}
              className="mt-1 h-[46px] w-full rounded-md border border-border bg-background px-2 font-mono text-sm font-semibold tabular-nums text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              aria-label="选中镜头时长秒数"
            />
          </label>
        </div>
      ) : null}
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
  const voiceClips =
    manifest?.audioTracks.flatMap(track =>
      track.clips.filter(clip => Boolean(chatCutCueCode(clip.name)))
    ) ?? [];
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
    clips: timings.map(timing => {
      const shot = shotsByNo.get(timing.shotNo);
      return {
        id: timing.stableShotId,
        label: shot
          ? chatCutSourceNameFromShot(shot)
          : shotLabel(timing.shotNo),
        title: shot
          ? `${shotLabel(shot.shotNo)} · ${chatCutSourceNameFromShot(shot)}`
          : shotLabel(timing.shotNo),
        startMs: timing.startMs,
        endMs: timing.endMs,
        shotNo: timing.shotNo,
        imageUrl: shot ? shotImageUrl(shot) : null,
      };
    }),
  });

  if (voiceClips.length > 0) {
    lanes.push({
      id: "voice",
      label: "A1 旁白",
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

  const musicClips =
    manifest?.audioTracks.flatMap(track =>
      track.clips.filter(clip => /bgm|music|配乐|音乐/i.test(clip.name))
    ) ?? [];
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
  const sourceAudio =
    manifest?.audioTracks.flatMap(track =>
      track.clips.filter(clip => !usedAudioIds.has(clip.id))
    ) ?? [];
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

function MultiTrackTimeline({
  shots,
  timelineShotIds,
  manifest,
  selectedShotNo,
  onSelectShot,
  onPlaybackChange,
}: {
  shots: CreationEditorShot[];
  timelineShotIds: string[];
  manifest: ChatCutTimelineManifest | null;
  selectedShotNo: number | null;
  onSelectShot: (shotNo: number) => void;
  onPlaybackChange: (playback: TimelinePlaybackState) => void;
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
  const playheadMsRef = useRef(initialPlayheadMs);
  const isPlayingRef = useRef(false);
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
    if (!isPlaying) return;
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const playheadLeft = (playheadMs / 1000) * scale;
    const visibleRight = viewport.scrollLeft + viewport.clientWidth;
    if (playheadLeft > visibleRight - 40) {
      viewport.scrollLeft = Math.max(
        0,
        playheadLeft - viewport.clientWidth * 0.35
      );
    }
  }, [isPlaying, playheadMs, scale]);

  const seekFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
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

  return (
    <section
      className="flex min-h-[260px] flex-[0_0_46%] flex-col border-t border-border bg-background"
      aria-label="多轨剪辑时间轴"
    >
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
                aria-label={`${lane.label} 轨道`}
              >
                {lane.clips.map(clip => {
                  const left = (clip.startMs / 1000) * scale;
                  const width = Math.max(
                    4,
                    ((clip.endMs - clip.startMs) / 1000) * scale
                  );
                  const selected = clip.shotNo === selectedShotNo;
                  return (
                    <button
                      key={`${lane.id}-${clip.id}`}
                      type="button"
                      onClick={() => {
                        setPlaybackRunning(false);
                        commitPlayhead(clip.startMs, {
                          selectShot: true,
                          playing: false,
                        });
                      }}
                      data-timeline-clip="true"
                      className={`absolute bottom-0.5 top-0.5 overflow-hidden rounded-sm border px-1 text-left text-[9px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${laneColors(
                        lane.tone
                      )} ${selected ? "ring-2 ring-primary" : ""}`}
                      style={{ left, width }}
                      title={clip.title}
                      aria-label={clip.title}
                    >
                      {clip.imageUrl ? (
                        <img
                          src={clip.imageUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover opacity-45"
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
                })}
              </div>
            ))}
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
              title="拖动播放头"
              onPointerDown={event => {
                event.preventDefault();
                event.stopPropagation();
                setPlaybackRunning(false);
                event.currentTarget.setPointerCapture(event.pointerId);
                seekPlayheadHandle(event.clientX);
              }}
              onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  seekPlayheadHandle(event.clientX);
                }
              }}
              onPointerUp={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onKeyDown={event => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                  return;
                }
                event.preventDefault();
                setPlaybackRunning(false);
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const stepMs = event.shiftKey ? 1000 : 100;
                commitPlayhead(playheadMsRef.current + direction * stepMs, {
                  selectShot: true,
                  playing: false,
                });
              }}
            >
              <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-b-sm bg-rose-500 shadow-sm ring-1 ring-white/70 group-focus-visible:ring-2 group-focus-visible:ring-rose-300" />
              <span className="absolute bottom-0 left-1/2 top-2 w-px -translate-x-1/2 bg-rose-500 shadow-[0_0_0_1px_rgb(244_63_94_/_0.18)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function EditingNleWorkspace() {
  const { setActiveSelection } = useStoryAgentActions();
  const {
    activeStoryId,
    shots,
    timelineShotIds,
    selectedShotNo,
    setSelectedShotNo,
    chatCutTimeline,
    updateShotDuration,
    updatePersistedShotField,
    importStoryMaterial,
    assignStoryImageToShot,
    isLoading,
  } = useCreationEditor();
  const [relinkProgress, setRelinkProgress] = useState<string | null>(null);
  const [timelinePlayback, setTimelinePlayback] =
    useState<TimelinePlaybackState>({ playheadMs: 0, isPlaying: false });
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
  const selectedSourceClip =
    selectedTimelineIndex >= 0
      ? (chatCutTimeline?.videoTracks.find(
          track => track.index === chatCutTimeline.primaryVideoTrackIndex
        )?.clips[selectedTimelineIndex] ?? null)
      : null;

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
        selectedText: fullText || shotLabel(shotNo),
        fullText: fullText || shotLabel(shotNo),
        storyId: activeStoryId,
        stableShotId: shot.stableShotId ?? shot.shotIdentity ?? null,
        shotNo,
        imageId: shot.imageId ?? null,
        objectVersion: shot.imageId ? `image:${shot.imageId}` : null,
        materialStatus: shot.imageId ? "current-image" : "unknown",
      });
    },
    [activeStoryId, setActiveSelection, setSelectedShotNo, shots]
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
    const matches = shots.flatMap(shot => {
      const file = filesByName.get(
        chatCutBaseName(chatCutSourceNameFromShot(shot))
      );
      const stableShotId = shot.stableShotId ?? shot.shotIdentity;
      return file && stableShotId ? [{ shot, stableShotId, file }] : [];
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
          note: `ChatCut XML 自动关联：${chatCutSourceNameFromShot(match.shot)}`,
        });
        if (result.kind === "image") {
          await assignStoryImageToShot({
            imageId: result.imageId,
            targetStableShotId: match.stableShotId,
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
      className="flex h-full min-h-0 flex-col"
      data-testid="editing-nle-workspace"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <EditingStoryboardPanel
          onRelink={relinkFiles}
          relinkProgress={relinkProgress}
        />
        <ShotPreview
          shot={selectedShot}
          timing={
            selectedShot ? timingByShotNo.get(selectedShot.shotNo) : undefined
          }
          sourceClip={selectedSourceClip}
          playheadMs={timelinePlayback.playheadMs}
          timelinePlaying={timelinePlayback.isPlaying}
          format={chatCutTimeline}
          onUpdateDuration={async durationMs => {
            if (!selectedShot) return;
            await updateShotDuration(selectedShot.shotNo, durationMs);
          }}
          onUpdateDialogue={async dialogue => {
            const stableShotId =
              selectedShot?.stableShotId ?? selectedShot?.shotIdentity;
            if (!stableShotId) throw new Error("当前镜头缺少稳定标识");
            await updatePersistedShotField(stableShotId, "dialogue", dialogue);
          }}
        />
      </div>
      <MultiTrackTimeline
        shots={shots}
        timelineShotIds={timelineShotIds}
        manifest={chatCutTimeline}
        selectedShotNo={selectedShot?.shotNo ?? null}
        onSelectShot={selectShot}
        onPlaybackChange={setTimelinePlayback}
      />
    </div>
  );
}
