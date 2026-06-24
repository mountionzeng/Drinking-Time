import { Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import type { CreationEditorShot } from "../CreationEditorContext";
import { MAX_SHOT_DURATION_MS, MIN_SHOT_DURATION_MS } from "../playback";
import { shotTimelineDurationMs } from "../videoAssetViewModel";

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

  if (shots.length === 0) {
    return (
      <div className="flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-md border border-border/70 bg-background/70 px-4 text-center text-sm text-muted-foreground">
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
      className="rounded-md border border-border/70 bg-background/70 p-2"
      aria-label="剪辑时间轴"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>时间轴</span>
          <span className="tabular-nums">
            {shots.length} 镜 · {(total / 1000).toFixed(1)}s
          </span>
        </div>
        <button
          type="button"
          onClick={onPlayAll}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {isPlayingTimeline ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isPlayingTimeline ? "暂停全部" : "播放全部"}
        </button>
      </div>
      <div className="flex min-h-[92px] gap-2 overflow-x-auto">
        {shots.map(shot => {
          const shotId = shot.stableShotId || shot.shotIdentity || shot.shotKey;
          const duration = durationFor(shot, durationsByShotNo);
          const selected = selectedShotNo === shot.shotNo;
          const isPlayingShot =
            isPlaying && playbackMode === "single" && selected;
          const width = `${Math.max(96, Math.round((duration / Math.max(total, 1)) * 760))}px`;

          return (
            <div
              key={shotId}
              className={`flex shrink-0 flex-col justify-between rounded-md border px-3 py-2 transition ${
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card hover:border-primary/40"
              }`}
              style={{ width }}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectShot(shot.shotNo)}
                  className="min-w-0 text-left"
                >
                  <span className="block text-xs font-semibold">
                    {shotLabel(shot)}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {shot.videoTakes?.some(take => take.isTimelineSelected)
                      ? (() => {
                          const selectedTake = shot.videoTakes?.find(
                            take => take.isTimelineSelected
                          );
                          if (
                            selectedTake?.selectedSelectionType === "range" &&
                            selectedTake.selectedRangeId != null
                          ) {
                            const range = selectedTake.ranges.find(
                              r => r.id === selectedTake.selectedRangeId
                            );
                            if (range)
                              return `片段 ${range.startSec.toFixed(1)}-${range.endSec.toFixed(1)}s`;
                          }
                          return "已选视频片段";
                        })()
                      : shot.beat || shot.subject || shot.mood || "镜头"}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onPlayShot(shot.shotNo)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-foreground transition hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    aria-label={`播放${shotLabel(shot)}`}
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
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <label className="relative mt-2 block text-xs text-muted-foreground">
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
                  className="w-full accent-[var(--primary)]"
                  aria-label={`${shotLabel(shot)} 时长`}
                />
              </label>
              {(() => {
                const selectedTake = shot.videoTakes?.find(
                  take => take.isTimelineSelected
                );
                if (!selectedTake) return null;
                const videoDur = selectedTake.durationSec ?? 5;
                if (
                  selectedTake.selectedSelectionType === "range" &&
                  selectedTake.selectedRangeId != null
                ) {
                  const range = selectedTake.ranges.find(
                    r => r.id === selectedTake.selectedRangeId
                  );
                  if (!range) return null;
                  const left = `${(range.startSec / videoDur) * 100}%`;
                  const right = `${(range.endSec / videoDur) * 100}%`;
                  return (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="absolute h-full rounded-full bg-primary/60"
                        style={{ left, right: `calc(100% - ${right})` }}
                      />
                    </div>
                  );
                }
                return (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary/30" />
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
