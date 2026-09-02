import { Clapperboard, ImagePlus, Loader2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";

import { StoryboardReviewBoard } from "./StoryboardReviewBoard";
import {
  useStoryboardPanelArtSlice,
  useStoryCardsBoardSlice,
} from "@/features/storyAgent/spine/selectors";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { useCreationEditor } from "@/features/creationEditor/CreationEditorContext";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import type { GeneratedImageItem } from "@/features/storyAgent/storyTypes";
import type { StoryShot } from "@/features/storyAgent/types";
import { displayShotCode, shotIdentityFromShot } from "@shared/shotIdentity";
import { summarizeShotCandidates } from "@/features/storyAgent/shotCandidateSummary";
import type { VideoClipEditorTarget } from "@/features/creationEditor/videoClipEditorModel";
import type { ImageClipEditorTarget } from "@/features/creationEditor/imageClipEditorModel";
import type { StoryboardBoardTimeline } from "@/features/creationEditor/views/StoryboardEditRow";
import { withStoryboardVoiceTextFallbacks } from "./storyboardVoiceText";

export function mergeStoryboardDisplayShots(
  creationShots: readonly CreationEditorShot[],
  draftShots: readonly StoryShot[]
): CreationEditorShot[] {
  if (creationShots.length === 0 || draftShots.length === 0) {
    return [...creationShots];
  }
  const draftsByIdentity = new Map(
    draftShots.flatMap((shot, index) => {
      const identity = shotIdentityFromShot(shot, index);
      return identity ? [[identity, shot] as const] : [];
    })
  );
  return creationShots.map((shot, index) => {
    const identity = shotIdentityFromShot(shot, index);
    const draft = identity ? draftsByIdentity.get(identity) : undefined;
    if (!draft) return shot;
    // 草稿可以补充镜头内容，但不能把持久层刚刚插入并重排好的结构顺序覆盖掉。
    return {
      ...shot,
      ...draft,
      shotNo: shot.shotNo,
      shotKey: shot.shotKey,
      stableShotId: shot.stableShotId,
      shotIdentity: shot.shotIdentity,
    };
  });
}

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

export default function StoryboardPanel({
  defaultViewMode = "full",
  embeddedEditorMode = false,
  headerAction,
  onEditVideo,
  onEditImage,
  onCopyVideo,
  onPasteVideo,
  videoClipboardLabel = null,
  boardTimeline,
}: {
  defaultViewMode?: "full" | "simple";
  embeddedEditorMode?: boolean;
  boardTimeline?: StoryboardBoardTimeline;
  headerAction?: ReactNode;
  onEditVideo?: (target: VideoClipEditorTarget) => void;
  onEditImage?: (target: ImageClipEditorTarget) => void;
  onCopyVideo?: (target: VideoClipEditorTarget) => void;
  onPasteVideo?: (input: {
    stableShotId: string;
    shotNo: number;
    mode?: "replace" | "append";
    targetOffsetMs?: number;
  }) => Promise<void>;
  videoClipboardLabel?: string | null;
}) {
  const { isGeneratingScript, latestScript, storyShots } =
    useStoryCardsBoardSlice();
  const { artDirection } = useStoryboardPanelArtSlice();
  const { loadStory, setActiveSelection, registerImageRerenderRunner } =
    useStoryAgentActions();
  const storyTitle = useStorySpine(state => state.storyTitle);
  const setStoryShots = useStorySpine(state => state.setStoryShots);
  const setSaveStatus = useStorySpine(state => state.setSaveStatus);
  const setLastSavedAt = useStorySpine(state => state.setLastSavedAt);
  const {
    activeStoryId,
    publishingHandoff,
    selectedShotNo,
    setSelectedShotNo,
    shots: creationShots,
    timelineShotIds,
    addShotToTimeline,
    updatePersistedShotField,
    updatePersistedShotFields,
    insertPersistedShotAfter,
    rerenderShot,
    rerenderingShotNos,
    generateShotVideo,
    estimateStartEndShotVideo,
    generateStartEndShotVideo,
    generatingVideoShotNos,
    generatingVoiceShotIds,
    generateShotVoice,
    refreshShotVideoStatus,
    markVideoTakeUnusable,
    assignStoryImageToShot,
    deleteStoryImage,
    moveVideoTake,
    adoptVideoTake,
    removeTimelineVideoClip,
    promoteFrameCrop,
    importStoryMaterial,
    analyzeShotVideoDirection,
    analyzeShotConsistency,
    deletePersistedShot,
    promotingFrameCropShotNo,
    shotVideoProviderStatus,
    promptProjection,
    storyboardFieldVersions,
    restoreStoryboardFieldVersion,
    confirmPromptCandidate,
    rejectPromptCandidate,
    imageProviderStatus,
  } = useCreationEditor();
  const candidatesByShot = useMemo(
    () => summarizeShotCandidates(promptProjection),
    [promptProjection]
  );
  const continuityAnchor = useMemo(() => {
    const reference = artDirection.references.find(
      item =>
        item.selected !== false &&
        item.role === "character" &&
        Boolean(item.imageUrl)
    );
    return reference?.imageUrl
      ? {
          label: reference.label || "人物基准",
          imageUrl: reference.imageUrl,
        }
      : null;
  }, [artDirection.references]);
  const mergedCreationShots = useMemo(() => {
    return mergeStoryboardDisplayShots(creationShots, storyShots);
  }, [creationShots, storyShots]);
  const baseDisplayShots =
    mergedCreationShots.length > 0 ? mergedCreationShots : storyShots;
  const displayShots = useMemo(
    () =>
      withStoryboardVoiceTextFallbacks(
        baseDisplayShots,
        publishingHandoff?.draftBodiesBySource ??
          publishingHandoff?.draft.body ??
          ""
      ),
    [
      baseDisplayShots,
      publishingHandoff?.draft.body,
      publishingHandoff?.draftBodiesBySource,
    ]
  );
  const generatedImages = currentStoryboardImages(
    mergedCreationShots,
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
            <span className="creation-board-panel-title-text">故事版看板</span>
          </div>
          <div className="flex items-center gap-2">
            {headerAction}
            {!headerAction ? (
              <span className="creation-board-panel-status">等待生成</span>
            ) : null}
          </div>
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
      storyTitle={storyTitle}
      onRegisterImageRerenderRunner={registerImageRerenderRunner}
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
          selectedText: fullText || displayShotCode(shot),
          fullText: fullText || displayShotCode(shot),
          storyId: activeStoryId,
          stableShotId: shot.stableShotId ?? shot.shotIdentity ?? null,
          shotNo,
          cueCode: shot.cueCode ?? null,
          imageId,
          objectVersion: imageId ? `image:${imageId}` : null,
          materialStatus: imageId ? "current-image" : "unknown",
        });
      }}
      onUpdateShotField={async (index, field, value) => {
        const target = displayShots[index];
        if (!target) return;
        const identity = shotIdentityFromShot(target, index);
        if (!identity) {
          toast.error("镜头缺少稳定编号，内容未保存");
          return;
        }
        const previousValue = target[field] ?? "";
        setStoryShots(current =>
          current.map((shot, shotIndex) =>
            shotIdentityFromShot(shot, shotIndex) === identity
              ? { ...shot, [field]: value }
              : shot
          )
        );
        setSaveStatus("saving");
        try {
          await updatePersistedShotField(identity, field, value);
          setSaveStatus("saved");
          setLastSavedAt(Date.now());
        } catch (error) {
          setStoryShots(current =>
            current.map((shot, shotIndex) =>
              shotIdentityFromShot(shot, shotIndex) === identity &&
              (shot[field] ?? "") === value
                ? { ...shot, [field]: previousValue }
                : shot
            )
          );
          setSaveStatus("error");
          toast.error(
            error instanceof Error
              ? `镜头内容未保存：${error.message}`
              : "镜头内容未保存"
          );
        }
      }}
      generatingVoiceShotIds={generatingVoiceShotIds}
      onGenerateShotVoice={async (stableShotId, text) => {
        try {
          await generateShotVoice(stableShotId, text);
          setSaveStatus("saved");
          setLastSavedAt(Date.now());
          toast.success("旁白已生成并保存到当前镜头");
        } catch (error) {
          setSaveStatus("error");
          toast.error(
            error instanceof Error ? error.message : "旁白生成失败，请重试"
          );
        }
      }}
      storyboardFieldVersions={storyboardFieldVersions}
      onRestoreStoryboardFieldVersion={restoreStoryboardFieldVersion}
      creationShots={mergedCreationShots}
      timelineShotIds={timelineShotIds}
      onAddShotToTimeline={addShotToTimeline}
      onInsertShotAfter={async (shotNo, stableShotId) => {
        if (!stableShotId) return;
        const insertedShotNo = await insertPersistedShotAfter(stableShotId);
        if (activeStoryId) {
          await loadStory(activeStoryId);
        }
        if (insertedShotNo != null) {
          setSelectedShotNo(insertedShotNo);
        } else {
          setSelectedShotNo(shotNo + 1);
        }
      }}
      onDeleteShot={async (shotNo, stableShotId) => {
        const fallbackIndex = displayShots.findIndex(
          shot => shot.shotNo === shotNo
        );
        const resolvedStableShotId =
          stableShotId ??
          (fallbackIndex >= 0
            ? shotIdentityFromShot(displayShots[fallbackIndex], fallbackIndex)
            : null);
        if (!resolvedStableShotId) {
          throw new Error("镜头身份缺失，请刷新故事后重试");
        }
        const nextSelectedShotNo = await deletePersistedShot(
          resolvedStableShotId
        );
        if (activeStoryId) {
          await loadStory(activeStoryId);
        }
        setSelectedShotNo(nextSelectedShotNo);
        return nextSelectedShotNo;
      }}
      generatingImageShotNos={rerenderingShotNos}
      onGenerateShotImages={input =>
        rerenderShot(input.shotNo, input.rows, input.reference, {
          explicitInstruction: input.explicitInstruction,
          exactFrameEdit: input.exactFrameEdit,
          candidateCount: input.candidateCount,
          costConfirmation: input.costConfirmation,
          imageProvider: input.imageProvider,
          editMaskImageUrl: input.editMaskImageUrl,
        })
      }
      generatingVideoShotNos={generatingVideoShotNos}
      onGenerateShotVideo={generateShotVideo}
      onEstimateStartEndShotVideo={estimateStartEndShotVideo}
      onGenerateStartEndShotVideo={generateStartEndShotVideo}
      onRefreshShotVideoStatus={refreshShotVideoStatus}
      onMarkVideoTakeUnusable={markVideoTakeUnusable}
      onRemoveTimelineVideoClip={removeTimelineVideoClip}
      onEditVideo={onEditVideo}
      onEditImage={onEditImage}
      onCopyVideo={onCopyVideo}
      onPasteVideo={onPasteVideo}
      videoClipboardLabel={videoClipboardLabel}
      boardTimeline={boardTimeline}
      onMoveStoryImage={assignStoryImageToShot}
      onDeleteStoryImage={deleteStoryImage}
      onMoveVideoTake={moveVideoTake}
      onAdoptVideoTake={adoptVideoTake}
      onPromoteFrameCrop={promoteFrameCrop}
      onImportStoryMaterial={importStoryMaterial}
      onAnalyzeShotVideoDirection={analyzeShotVideoDirection}
      onAnalyzeShotConsistency={analyzeShotConsistency}
      continuityAnchor={continuityAnchor}
      onUpdateShotFields={updatePersistedShotFields}
      promotingFrameCropShotNo={promotingFrameCropShotNo}
      shotVideoProviderStatus={shotVideoProviderStatus}
      imageProviderStatus={imageProviderStatus}
      defaultViewMode={defaultViewMode}
      embeddedEditorMode={embeddedEditorMode}
      headerAction={headerAction}
      inheritedPublishingCover={publishingHandoff?.cover ?? null}
      className="h-full min-h-[280px] overflow-auto"
      candidatesByShot={candidatesByShot}
      onConfirmCandidate={async candidate => {
        try {
          await confirmPromptCandidate(candidate.revisionId);
        } catch (error) {
          toast.error(
            error instanceof Error ? `确认失败：${error.message}` : "确认失败"
          );
        }
      }}
      onRejectCandidate={async candidate => {
        try {
          await rejectPromptCandidate(candidate.revisionId);
        } catch (error) {
          toast.error(
            error instanceof Error ? `放弃失败：${error.message}` : "放弃失败"
          );
        }
      }}
    />
  );
}
