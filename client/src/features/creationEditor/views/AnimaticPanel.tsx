import { Film, Library, ListPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  creationTimelineShotId,
  resolveTimelineShots,
  useCreationEditor,
} from "../CreationEditorContext";
import type { CreationEditorShot } from "../types";
import AnimaticPlayer from "./AnimaticPlayer";
import Timeline, { type TimelinePlaybackMode } from "./Timeline";
import AnimaticMaterialDrawer from "./AnimaticMaterialDrawer";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { displayShotCode } from "@shared/shotIdentity";

function shotLabel(shot: CreationEditorShot | null | undefined) {
  return shot ? displayShotCode(shot) : "未选镜头";
}

function targetOwnsSpacebar(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="slider"]'
    )
  );
}

type AnimaticPanelProps = {
  layout?: "embedded" | "studio";
};

export default function AnimaticPanel({
  layout = "embedded",
}: AnimaticPanelProps) {
  const isStudioLayout = layout === "studio";
  const { setActiveSelection } = useStoryAgentActions();
  const {
    activeStoryId,
    shots,
    materialState,
    selectedShotNo,
    setSelectedShotNo,
    isLoading,
    error,
    timelineShotIds,
    addShotToTimeline,
    removeShotFromTimeline,
    moveShotInTimeline,
    resetTimelineShots,
    updateShotDuration,
    refreshShotVideoStatus,
    markVideoTakeUnusable,
    createVideoTakeRange,
    selectVideoTimelineSegment,
    clearVideoTimelineSegment,
    adoptVideoTake,
    reuseVideoTake,
    promoteStoryImage,
    createDerivedShotDraft,
    confirmDerivedShot,
    undoStoryOperation,
  } = useCreationEditor();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] =
    useState<TimelinePlaybackMode>("timeline");
  const [playbackResetKey, setPlaybackResetKey] = useState(0);
  const [materialDrawerOpen, setMaterialDrawerOpen] = useState(false);
  const [durationsByShotNo, setDurationsByShotNo] = useState<
    Record<number, number>
  >({});
  const pointerInsidePanelRef = useRef(false);
  const pendingDurationsRef = useRef(new Map<number, number>());
  const durationSaveTimersRef = useRef(new Map<number, number>());
  const updateShotDurationRef = useRef(updateShotDuration);
  const timelineShots = useMemo(
    () => resolveTimelineShots(shots, timelineShotIds),
    [shots, timelineShotIds]
  );
  const selectedShot = useMemo(
    () => shots.find(shot => shot.shotNo === selectedShotNo) ?? null,
    [selectedShotNo, shots]
  );
  const selectedTimelineId = selectedShot
    ? creationTimelineShotId(selectedShot)
    : null;
  const selectedShotIsOnTimeline = selectedTimelineId
    ? timelineShotIds.includes(selectedTimelineId)
    : false;
  const fullPlaybackShots = timelineShots.length > 0 ? timelineShots : shots;
  const playbackShots =
    playbackMode === "single" && selectedShot
      ? [selectedShot]
      : fullPlaybackShots;

  useEffect(() => {
    updateShotDurationRef.current = updateShotDuration;
  }, [updateShotDuration]);

  useEffect(
    () => () => {
      durationSaveTimersRef.current.forEach(timer =>
        window.clearTimeout(timer)
      );
      pendingDurationsRef.current.forEach((durationMs, shotNo) => {
        void updateShotDurationRef.current(shotNo, durationMs);
      });
      durationSaveTimersRef.current.clear();
      pendingDurationsRef.current.clear();
    },
    []
  );

  const selectShotWithContext = (shotNo: number) => {
    setSelectedShotNo(shotNo);
    const shot = shots.find(item => item.shotNo === shotNo);
    if (!shot) return;
    const material = materialState?.shots.find(item =>
      shot.stableShotId
        ? item.stableShotId === shot.stableShotId
        : item.shotNo === shotNo
    );
    const currentVideo = material?.currentVideo ?? null;
    const currentImage = material?.currentImage ?? null;
    const fullText = [shot.subject, shot.action, shot.dialogue]
      .filter(Boolean)
      .join("；");
    setActiveSelection({
      sourceType: currentVideo
        ? "animatic-video"
        : currentImage
          ? "storyboard-image"
          : "shot",
      sourceId: currentVideo
        ? String(currentVideo.id)
        : currentImage
          ? String(currentImage.id)
          : `${Math.max(0, shots.indexOf(shot))}:subject`,
      selectedText: fullText || shotLabel(shot),
      fullText: fullText || shotLabel(shot),
      storyId: activeStoryId,
      stableShotId: shot.stableShotId ?? shot.shotIdentity ?? null,
      shotNo,
      cueCode: shot.cueCode ?? null,
      imageId: currentImage?.id ?? null,
      videoTakeId: currentVideo?.id ?? null,
      objectVersion: currentVideo
        ? `video:${currentVideo.id}`
        : currentImage
          ? `image:${currentImage.id}`
          : null,
      materialStatus: currentVideo
        ? "current-video"
        : currentImage
          ? "current-image"
          : "unknown",
    });
  };

  const playFullFilm = () => {
    if (isPlaying && playbackMode === "timeline") {
      setIsPlaying(false);
      return;
    }
    const firstShotNo = fullPlaybackShots[0]?.shotNo ?? null;
    if (firstShotNo == null) return;
    setPlaybackMode("timeline");
    selectShotWithContext(firstShotNo);
    setPlaybackResetKey(current => current + 1);
    setIsPlaying(true);
  };

  const playShot = (shotNo: number) => {
    if (isPlaying && playbackMode === "single" && selectedShotNo === shotNo) {
      setIsPlaying(false);
      return;
    }
    setPlaybackMode("single");
    selectShotWithContext(shotNo);
    setPlaybackResetKey(current => current + 1);
    setIsPlaying(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pointerInsidePanelRef.current) return;
      if (event.key !== " " && event.key !== "Spacebar") return;
      if (targetOwnsSpacebar(event.target)) return;
      event.preventDefault();
      playFullFilm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playFullFilm]);

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
    if (
      shots.find(shot => creationTimelineShotId(shot) === shotId)?.shotNo ===
      selectedShotNo
    ) {
      setSelectedShotNo(nextShotNo);
    }
  };

  const addSelectedShotToTimeline = () => {
    if (!selectedShot || !selectedTimelineId) return;
    addShotToTimeline(selectedShot.shotNo, selectedTimelineId);
    setPlaybackMode("timeline");
    setSelectedShotNo(selectedShot.shotNo);
  };

  const handleDurationChange = (shotNo: number, durationMs: number) => {
    setDurationsByShotNo(current => ({
      ...current,
      [shotNo]: durationMs,
    }));
    pendingDurationsRef.current.set(shotNo, durationMs);
    const previousTimer = durationSaveTimersRef.current.get(shotNo);
    if (previousTimer != null) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      durationSaveTimersRef.current.delete(shotNo);
      const pendingDurationMs = pendingDurationsRef.current.get(shotNo);
      pendingDurationsRef.current.delete(shotNo);
      if (pendingDurationMs == null) return;
      void updateShotDurationRef.current(shotNo, pendingDurationMs);
    }, 300);
    durationSaveTimersRef.current.set(shotNo, timer);
  };

  return (
    <section
      className="creation-board-panel relative flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="动态分镜"
      data-testid="analysis-animatic-panel"
      data-layout={layout}
      onPointerEnter={() => {
        pointerInsidePanelRef.current = true;
      }}
      onPointerLeave={() => {
        pointerInsidePanelRef.current = false;
      }}
    >
      <div className="creation-board-panel-header justify-between">
        <div className="creation-board-panel-title">
          <Film className="creation-board-panel-icon" />
          <h2 className="creation-board-panel-title-text">动态分镜</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="creation-board-panel-status">
            {shotLabel(selectedShot)}
          </span>
          <button
            type="button"
            onClick={() => setMaterialDrawerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            aria-label="打开素材库"
            title="素材库"
          >
            <Library className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className={
          isStudioLayout
            ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
            : "flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
        }
      >
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
            {selectedShot && !selectedShotIsOnTimeline ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  当前查看 {shotLabel(selectedShot)}
                  ，还没放进剪辑时间轴。
                </span>
                <button
                  type="button"
                  onClick={addSelectedShotToTimeline}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/30 bg-background px-2.5 font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  加入时间轴
                </button>
              </div>
            ) : null}
            <div
              className={
                isStudioLayout
                  ? "min-h-0 flex-1 overflow-y-auto pr-1"
                  : undefined
              }
            >
              <AnimaticPlayer
                compactViewport={isStudioLayout}
                storyId={activeStoryId}
                shots={playbackShots}
                progressShots={fullPlaybackShots}
                selectedShotNo={selectedShotNo}
                durationsByShotNo={durationsByShotNo}
                onShotEnter={selectShotWithContext}
                isPlaying={isPlaying}
                onPlayingChange={setIsPlaying}
                onTogglePlayback={playFullFilm}
                onSelectContext={setActiveSelection}
                playbackResetKey={playbackResetKey}
                onRefreshShotVideoStatus={refreshShotVideoStatus}
                onMarkVideoTakeUnusable={markVideoTakeUnusable}
                onCreateVideoTakeRange={createVideoTakeRange}
                onSelectVideoTimelineSegment={selectVideoTimelineSegment}
                onClearVideoTimelineSegment={clearVideoTimelineSegment}
                onCreateDerivedShotDraft={createDerivedShotDraft}
                onConfirmDerivedShot={confirmDerivedShot}
                onUndoStoryOperation={undoStoryOperation}
                onDurationChange={handleDurationChange}
              />
            </div>
            <div className="shrink-0">
              <Timeline
                shots={timelineShots}
                selectedShotNo={selectedShotNo}
                durationsByShotNo={durationsByShotNo}
                playbackMode={playbackMode}
                isPlaying={isPlaying}
                onSelectShot={selectShotWithContext}
                onPlayAll={playFullFilm}
                onPlayShot={playShot}
                onRemoveShot={removeTimelineShot}
                onMoveShot={moveShotInTimeline}
                onResetTimeline={() => {
                  resetTimelineShots();
                  setPlaybackMode("timeline");
                  setIsPlaying(false);
                }}
                onDurationChange={handleDurationChange}
              />
            </div>
          </>
        )}
      </div>
      <AnimaticMaterialDrawer
        open={materialDrawerOpen}
        state={materialState}
        selectedStableShotId={selectedTimelineId}
        onClose={() => setMaterialDrawerOpen(false)}
        onSelectShot={selectShotWithContext}
        onPromoteImage={promoteStoryImage}
        onAdoptVideo={adoptVideoTake}
        onReuseVideo={reuseVideoTake}
        onMarkVideoTakeUnusable={markVideoTakeUnusable}
      />
    </section>
  );
}
