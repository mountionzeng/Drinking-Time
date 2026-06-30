import { Clapperboard, ImagePlus, Loader2 } from "lucide-react";

import { StoryboardReviewBoard } from "./StoryCardsBoard";
import {
  useStoryCardsBoardSlice,
  useStoryboardPanelArtSlice,
} from "@/features/storyAgent/spine/selectors";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import {
  useCreationEditor,
  type CreationEditorShot,
} from "@/features/creationEditor/CreationEditorContext";
import type { GeneratedImageItem } from "@/features/mobileChat/types";
import { shotIdentityFromShot } from "@shared/shotIdentity";

export function currentStoryboardImages(
  shots: readonly CreationEditorShot[],
  storyId = 0
): GeneratedImageItem[] {
  return shots.flatMap(shot => {
    if (shot.imageId == null || !shot.imageUrl) return [];
    return [
      {
        id: shot.imageId,
        imageUrl: shot.imageUrl,
        prompt: shot.imagePrompt ?? "",
        shotNo: shot.shotNo,
        shotIdentity: shot.stableShotId ?? shot.shotIdentity,
        storyId,
        status: "ready" as const,
      },
    ];
  });
}

export default function StoryboardPanel() {
  const { isGeneratingScript, latestScript, storyShots } =
    useStoryCardsBoardSlice();
  const { artDirection } = useStoryboardPanelArtSlice();
  const { updateStoryShotField, updateAllStoryShotField } =
    useStoryAgentActions();
  const {
    activeStoryId,
    selectedShotNo,
    setSelectedShotNo,
    shots: creationShots,
    timelineShotIds,
    addShotToTimeline,
    updatePersistedShotField,
    generateShotVideo,
    generatingVideoShotNo,
    refreshShotVideoStatus,
    adoptVideoTake,
    shotVideoProviderStatus,
  } = useCreationEditor();
  const displayShots = creationShots.length > 0 ? creationShots : storyShots;
  const generatedImages = currentStoryboardImages(
    creationShots,
    activeStoryId ?? 0
  );
  const hasStoryboard =
    isGeneratingScript ||
    displayShots.length > 0 ||
    generatedImages.length > 0 ||
    Boolean(latestScript);

  if (!hasStoryboard) {
    return (
      <section
        className="flex h-full min-h-[280px] flex-col rounded-md border"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--panel-header)",
        }}
        aria-label="故事版看板"
      >
        <div
          className="flex items-center justify-between gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <div className="flex items-center gap-1.5">
            <Clapperboard className="h-3.5 w-3.5 text-nayin-bright" />
            <span className="text-[10px] font-semibold text-foreground">
              故事版看板
            </span>
          </div>
          <span className="text-[9px] text-muted-foreground">等待生成</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          {isGeneratingScript ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus className="h-5 w-5 text-muted-foreground" />
          )}
          <p className="max-w-[18rem] text-[11px] leading-relaxed text-muted-foreground">
            Story Cards
            整理好求职优势后，点击“生成故事版”，这里会统一展示镜头、候选画面、提示词和导演解释。
          </p>
        </div>
      </section>
    );
  }

  return (
    <StoryboardReviewBoard
      images={generatedImages}
      shots={displayShots}
      latestScript={latestScript}
      artDirection={artDirection}
      isGeneratingScript={isGeneratingScript}
      selectedShotNo={selectedShotNo}
      onSelectShot={setSelectedShotNo}
      onUpdateShotField={(index, field, value) => {
        const target = displayShots[index];
        if (!target) return;
        const identity = shotIdentityFromShot(target, index);
        const spineIndex = storyShots.findIndex(
          (shot, shotIndex) =>
            identity != null &&
            shotIdentityFromShot(shot, shotIndex) === identity
        );
        if (spineIndex >= 0) {
          updateStoryShotField(spineIndex, field, value);
          return;
        }
        if (identity) {
          void updatePersistedShotField(identity, field, value);
        }
      }}
      onUpdateAllShotsField={updateAllStoryShotField}
      creationShots={creationShots}
      timelineShotIds={timelineShotIds}
      onAddShotToTimeline={addShotToTimeline}
      generatingVideoShotNo={generatingVideoShotNo}
      onGenerateShotVideo={generateShotVideo}
      onRefreshShotVideoStatus={refreshShotVideoStatus}
      onAdoptVideoTake={adoptVideoTake}
      shotVideoProviderStatus={shotVideoProviderStatus}
      className="h-full min-h-[280px] overflow-auto"
    />
  );
}
