import { Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CreationEditorShot } from "../CreationEditorContext";
import { MAX_SHOT_DURATION_MS, MIN_SHOT_DURATION_MS } from "../playback";
import {
  shotTimelineDurationMs,
  videoTakeAffordance,
} from "../videoAssetViewModel";

export type TimelinePlaybackMode = "timeline" | "single";

type TimelineProps = {
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  durationsByShotNo?: Record<number, number>;
  playbackMode: TimelinePlaybackMode;
  isPlaying: boolean;
  onSelectShot: (shotNo: number) => void;
  onPlayAll: () => void;
  onPlayShot: (shotNo: number) => void;
  onRemoveShot: (shotId: string) => void;
  onResetTimeline: () => void;
  onDurationChange: (shotNo: number, durationMs: number) => void;
};

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, "0")}`;
}

function durationFor(
  shot: CreationEditorShot,
  durationsByShotNo: Record<number, number>
) {
  return durationsByShotNo[shot.shotNo] ?? shotTimelineDurationMs(shot);
}

function shotSummary(shot: CreationEditorShot) {
  return shot.beat || shot.subject || shot.intent || shot.mood || "镜头";
}

function materialStatus(shot: CreationEditorShot) {
  const timelineTake = shot.videoTakes?.find(take => take.isTimelineSelected);
  if (timelineTake) {
    return timelineTake.selectedSelectionType === "range"
      ? "时间轴片段"
      : "时间轴视频";
  }

  const playableTake = shot.videoTakes?.find(
    take => Boolean(take.videoUrl) && videoTakeAffordance(take.status).canPlay
  );
  if (playableTake) return "当前视频";

  const failedTake = shot.videoTakes?.find(take => take.status === "failed");
  if (shot.imageUrl && failedTake) return "主图兜底";
  if (shot.imageUrl) return "当前主图";
  if (failedTake) return "视频失败";
  return "缺素材";
}

function rangeLabel(shot: CreationEditorShot) {
  const selectedTake = shot.videoTakes?.find(take => take.isTimelineSelected);
  if (
    selectedTake?.selectedSelectionType === "range" &&
    selectedTake.selectedRangeId != null
  ) {
    const range = selectedTake.ranges.find(
      item => item.id === selectedTake.selectedRangeId
    );
    if (range) {
      return `${range.startSec.toFixed(1)}-${range.endSec.toFixed(1)}s`;
    }
  }
  return null;
}

function RangeMarker({ shot }: { shot: CreationEditorShot }) {
  const selectedTake = shot.videoTakes?.find(take => take.isTimelineSelected);
  if (!selectedTake) return null;
  const videoDur = selectedTake.durationSec ?? 5;
  if (
    selectedTake.selectedSelectionType === "range" &&
    selectedTake.selectedRangeId != null
  ) {
    const range = selectedTake.ranges.find(
      item => item.id === selectedTake.selectedRangeId
    );
    if (!range) return null;
    const left = `${Math.max(0, (range.startSec / videoDur) * 100)}%`;
    const right = `${Math.max(0, 100 - (range.endSec / videoDur) * 100)}%`;
    return (
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-primary/70"
          style={{ left, right }}
        />
      </div>
    );
  }
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-primary/35" />
  );
}

export default function Timeline({
  shots,
  selectedShotNo,
  durationsByShotNo = {},
  playbackMode,
  isPlaying,
  onSelectShot,
  onPlayAll,
  onPlayShot,
  onRemoveShot,
  onResetTimeline,
  onDurationChange,
}: TimelineProps) {
  const total = shots.reduce(
    (sum, shot) => sum + durationFor(shot, durationsByShotNo),
    0
  );
  const isPlayingTimeline = isPlaying && playbackMode === "timeline";
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedShotNo == null) return;
    const target = railRef.current?.querySelector<HTMLElement>(
      `[data-timeline-shot-no="${selectedShotNo}"]`
    );
    target?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedShotNo, shots]);

  if (shots.length === 0) {
    return (
      <div className="flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-md border border-border/70 bg-background px-4 text-center text-sm text-muted-foreground">
        <span>时间轴为空，从故事版看板把镜头加入这里。</span>
        <button
          type="button"
          onClick={onResetTimeline}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          加回全部镜头
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-border/70 bg-background p-2"
      aria-label="剪辑时间轴"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground">时间轴</div>
          <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {shots.length} 镜 · {(total / 1000).toFixed(1)}s
          </div>
        </div>
        <button
          type="button"
          onClick={onPlayAll}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {isPlayingTimeline ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isPlayingTimeline ? "暂停全部" : "播放全部"}
        </button>
      </div>

      <div
        ref={railRef}
        className="flex min-h-[138px] gap-2 overflow-x-auto pb-1"
      >
        {shots.map(shot => {
          const shotId = shot.stableShotId || shot.shotIdentity || shot.shotKey;
          const duration = durationFor(shot, durationsByShotNo);
          const selected = selectedShotNo === shot.shotNo;
          const isPlayingShot =
            isPlaying && playbackMode === "single" && selected;
          const status = materialStatus(shot);
          const selectedRange = rangeLabel(shot);

          return (
            <div
              key={shotId}
              data-timeline-shot-no={shot.shotNo}
              className={`flex h-[132px] w-[172px] shrink-0 flex-col rounded-md border p-2 transition ${
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectShot(shot.shotNo)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <span className="block truncate text-xs font-semibold">
                    {shotLabel(shot)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {shotSummary(shot)}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onPlayShot(shot.shotNo)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-foreground transition hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    aria-label={`播放${shotLabel(shot)}`}
                    title={`播放${shotLabel(shot)}`}
                  >
                    {isPlayingShot ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveShot(shotId)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                    aria-label={`从时间轴移除${shotLabel(shot)}`}
                    title={`移除${shotLabel(shot)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex min-h-[22px] items-center justify-between gap-1">
                <span className="truncate rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {status}
                </span>
                {selectedRange ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {selectedRange}
                  </span>
                ) : null}
              </div>

              <label className="mt-auto block text-xs text-muted-foreground">
                <span className="mb-1 block tabular-nums">
                  {(duration / 1000).toFixed(1)}s
                </span>
                <input
                  type="range"
                  min={MIN_SHOT_DURATION_MS}
                  max={MAX_SHOT_DURATION_MS}
                  step={200}
                  value={duration}
                  onChange={event =>
                    onDurationChange(
                      shot.shotNo,
                      Number(event.currentTarget.value)
                    )
                  }
                  className="block w-full accent-[var(--primary)]"
                  aria-label={`${shotLabel(shot)} 时长`}
                />
              </label>
              <RangeMarker shot={shot} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
