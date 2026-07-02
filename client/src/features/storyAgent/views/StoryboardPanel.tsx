import { Clapperboard, ImagePlus, Loader2 } from "lucide-react";

import { StoryboardReviewBoard } from "./StoryCardsBoard";
import { useStoryCardsBoardSlice } from "@/features/storyAgent/spine/selectors";
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
  const { updateStoryShotField, setActiveSelection } = useStoryAgentActions();
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
    promoteFrameCrop,
    promotingFrameCropShotNo,
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
        className="creation-board-panel flex h-full min-h-[280px] flex-col"
        aria-label="故事版看板"
      >
        <div className="creation-board-panel-header justify-between">
          <div className="creation-board-panel-title">
            <Clapperboard className="creation-board-panel-icon" />
            <span className="creation-board-panel-title-text">
              故事版看板
            </span>
          </div>
          <span className="creation-board-panel-status">等待生成</span>
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
      isGeneratingScript={isGeneratingScript}
      selectedShotNo={selectedShotNo}
      onSelectShot={shotNo => {
        setSelectedShotNo(shotNo);
        const shot = displayShots.find(item => item.shotNo === shotNo);
        if (!shot) return;
        const creationShot = creationShots.find(item => item.shotNo === shotNo);
        const imageId = creationShot?.imageId ?? null;
        const fullText = [shot.subject, shot.action, shot.dialogue]
          .filter(Boolean)
          .join("；");
        setActiveSelection({
          sourceType: imageId ? "storyboard-image" : "shot",
          sourceId: imageId
            ? String(imageId)
            : `${Math.max(0, displayShots.indexOf(shot))}:subject`,
          selectedText: fullText || `SH${String(shotNo).padStart(2, "0")}`,
          fullText: fullText || `SH${String(shotNo).padStart(2, "0")}`,
          storyId: activeStoryId,
          stableShotId: shot.stableShotId ?? shot.shotIdentity ?? null,
          shotNo,
          imageId,
          objectVersion: imageId ? `image:${imageId}` : null,
          materialStatus: imageId ? "current-image" : "unknown",
        });
      }}
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
      creationShots={creationShots}
      timelineShotIds={timelineShotIds}
      onAddShotToTimeline={addShotToTimeline}
      generatingVideoShotNo={generatingVideoShotNo}
      onGenerateShotVideo={generateShotVideo}
      onRefreshShotVideoStatus={refreshShotVideoStatus}
      onAdoptVideoTake={adoptVideoTake}
      onPromoteFrameCrop={promoteFrameCrop}
      promotingFrameCropShotNo={promotingFrameCropShotNo}
      shotVideoProviderStatus={shotVideoProviderStatus}
      className="h-full min-h-[280px] overflow-auto"
    />
  );
}
