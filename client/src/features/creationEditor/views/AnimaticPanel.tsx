import { Film } from "lucide-react";
import { useMemo, useState } from "react";
import {
  creationTimelineShotId,
  resolveTimelineShots,
  useCreationEditor,
} from "../CreationEditorContext";
import AnimaticPlayer from "./AnimaticPlayer";
import Timeline, { type TimelinePlaybackMode } from "./Timeline";

function shotLabel(shotNo: number | null) {
  return shotNo == null ? "未选镜头" : `SH${String(shotNo).padStart(2, "0")}`;
}

export default function AnimaticPanel() {
  const {
    shots,
    selectedShotNo,
    setSelectedShotNo,
    isLoading,
    error,
    timelineShotIds,
    removeShotFromTimeline,
    resetTimelineShots,
    updateShotDuration,
    promoteFrameCrop,
    promotingFrameCropShotNo,
    generateShotVideo,
    generatingVideoShotNo,
    refreshShotVideoStatus,
    createVideoTakeRange,
    selectVideoTimelineSegment,
    clearVideoTimelineSegment,
    shotVideoProviderStatus,
  } = useCreationEditor();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] =
    useState<TimelinePlaybackMode>("timeline");
  const [playbackResetKey, setPlaybackResetKey] = useState(0);
  const [durationsByShotNo, setDurationsByShotNo] = useState<
    Record<number, number>
  >({});
  const timelineShots = useMemo(
    () => resolveTimelineShots(shots, timelineShotIds),
    [shots, timelineShotIds]
  );
  const selectedShot = useMemo(
    () => shots.find(shot => shot.shotNo === selectedShotNo) ?? null,
    [selectedShotNo, shots]
  );
  const playbackShots =
    playbackMode === "single" && selectedShot ? [selectedShot] : timelineShots;

  const playTimeline = () => {
    if (isPlaying && playbackMode === "timeline") {
      setIsPlaying(false);
      return;
    }
    const firstShotNo = timelineShots[0]?.shotNo ?? null;
    if (firstShotNo == null) return;
    setPlaybackMode("timeline");
    setSelectedShotNo(firstShotNo);
    setPlaybackResetKey(current => current + 1);
    setIsPlaying(true);
  };

  const playShot = (shotNo: number) => {
    if (
      isPlaying &&
      playbackMode === "single" &&
      selectedShotNo === shotNo
    ) {
      setIsPlaying(false);
      return;
    }
    setPlaybackMode("single");
    setSelectedShotNo(shotNo);
    setPlaybackResetKey(current => current + 1);
    setIsPlaying(true);
  };

  const removeTimelineShot = (shotId: string) => {
    const index = timelineShotIds.indexOf(shotId);
    const nextShotNo =
      resolveTimelineShots(shots, [timelineShotIds[index + 1]])[0]?.shotNo ??
      resolveTimelineShots(shots, [timelineShotIds[index - 1]])[0]?.shotNo ??
      shots.find(shot => creationTimelineShotId(shot) !== shotId)?.shotNo ??
      null;
    removeShotFromTimeline(shotId);
    setIsPlaying(false);
    setPlaybackMode("timeline");
    if (shots.find(shot => creationTimelineShotId(shot) === shotId)?.shotNo === selectedShotNo) {
      setSelectedShotNo(nextShotNo);
    }
  };

  return (
    <section
      className="monitor-panel flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="动态分镜"
      data-testid="analysis-animatic-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">动态分镜</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {shotLabel(selectedShotNo)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message || "加载动态分镜失败"}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            正在加载动态分镜…
          </div>
        ) : shots.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            生成故事版后，动态分镜会出现在这里。
          </div>
        ) : (
          <>
            <AnimaticPlayer
              shots={playbackShots}
              selectedShotNo={selectedShotNo}
              durationsByShotNo={durationsByShotNo}
              onShotEnter={setSelectedShotNo}
              isPlaying={isPlaying}
              onPlayingChange={setIsPlaying}
              playbackResetKey={playbackResetKey}
              onPromoteFrameCrop={promoteFrameCrop}
              promotingFrameCropShotNo={promotingFrameCropShotNo}
              onGenerateShotVideo={generateShotVideo}
              onRefreshShotVideoStatus={refreshShotVideoStatus}
              generatingVideoShotNo={generatingVideoShotNo}
              onCreateVideoTakeRange={createVideoTakeRange}
              onSelectVideoTimelineSegment={selectVideoTimelineSegment}
              onClearVideoTimelineSegment={clearVideoTimelineSegment}
              shotVideoProviderStatus={shotVideoProviderStatus}
            />
            <div className="shrink-0">
              <Timeline
                shots={timelineShots}
                selectedShotNo={selectedShotNo}
                durationsByShotNo={durationsByShotNo}
                playbackMode={playbackMode}
                isPlaying={isPlaying}
                onSelectShot={setSelectedShotNo}
                onPlayAll={playTimeline}
                onPlayShot={playShot}
                onRemoveShot={removeTimelineShot}
                onResetTimeline={() => {
                  resetTimelineShots();
                  setPlaybackMode("timeline");
                  setIsPlaying(false);
                }}
                onDurationChange={(shotNo, durationMs) => {
                  setDurationsByShotNo(current => ({
                    ...current,
                    [shotNo]: durationMs,
                  }));
                  void updateShotDuration(shotNo, durationMs);
                }}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
