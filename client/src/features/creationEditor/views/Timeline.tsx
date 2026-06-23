import type { CreationEditorShot } from "../CreationEditorContext";
import { MAX_SHOT_DURATION_MS, MIN_SHOT_DURATION_MS } from "../playback";
import { shotTimelineDurationMs } from "../videoAssetViewModel";

type TimelineProps = {
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  durationsByShotNo?: Record<number, number>;
  onSelectShot: (shotNo: number) => void;
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
  onSelectShot,
  onDurationChange,
}: TimelineProps) {
  const total = shots.reduce(
    (sum, shot) => sum + durationFor(shot, durationsByShotNo),
    0
  );

  if (shots.length === 0) {
    return (
      <div className="flex min-h-[92px] items-center justify-center rounded-md border border-border/70 bg-background/70 text-sm text-muted-foreground">
        还没有可剪辑的镜头
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-border/70 bg-background/70 p-2"
      aria-label="剪辑时间轴"
    >
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>时间轴</span>
        <span>{(total / 1000).toFixed(1)}s</span>
      </div>
      <div className="flex min-h-[92px] gap-2 overflow-x-auto">
        {shots.map(shot => {
          const duration = durationFor(shot, durationsByShotNo);
          const selected = selectedShotNo === shot.shotNo;
          const width = `${Math.max(96, Math.round((duration / Math.max(total, 1)) * 760))}px`;

          return (
            <div
              key={shot.shotKey}
              className={`flex shrink-0 flex-col justify-between rounded-md border px-3 py-2 transition ${
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card hover:border-primary/40"
              }`}
              style={{ width }}
            >
              <button
                type="button"
                onClick={() => onSelectShot(shot.shotNo)}
                className="text-left"
              >
                <span className="block text-xs font-semibold">
                  {shotLabel(shot)}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {shot.videoTakes?.some(take => take.isTimelineSelected)
                    ? "已选视频片段"
                    : shot.beat || shot.subject || shot.mood || "镜头"}
                </span>
              </button>
              <label className="mt-2 block text-xs text-muted-foreground">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
