/**
 * StoryCardsBoard — Reorderable list of memory cards harvested from the
 * story-guide chat. The order matters: each ordering produces a different
 * generated script.
 *
 * Sits in the TEMPLATE DRAFT slot of the analysis page.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  Reorder,
  useDragControls,
} from "framer-motion";
import {
  GripVertical,
  X,
  Sparkles,
  FlaskConical,
  Loader2,
  Clapperboard,
  CheckCircle2,
} from "lucide-react";
import {
  isFictionStoryCardConfirmed,
  useStoryAgentActions,
  type GenerationProfileArg,
} from "@/features/storyAgent/StoryAgentContext";
import { useStoryCardsBoardSlice } from "@/features/storyAgent/spine/selectors";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useStoryGeneratedImages } from "./StoryImagesStrip";
import { useNayin } from "@/features/nayin/NayinContext";
import type {
  StoryCard,
  StoryShot,
  VisualCanvasItem,
} from "@/features/storyAgent/types";
import type { NayinElement } from "@/features/nayin/nayin";
import {
  buildMobileStoryboardScenes,
  parseShotNo,
  type GeneratedImageItem,
} from "@/features/storyAgent/storyTypes";
import StoryCardsGraph from "./StoryCardsGraph";
import {
  artChoiceKey,
  FALLBACK_VISUAL_STYLES,
  GenerationSettingsPanel,
  narrativeChoicesForIntent,
  type ArtLibraryVersionView,
} from "./GenerationSettingsPanel";
import { CardReferenceDock } from "./CardReferenceDock";

export {
  STORYBOARD_MATRIX_ROWS,
  STORYBOARD_MATRIX_VISIBLE_ROWS,
  storyboardMatrixSwapPlan,
  storyboardMatrixTextareaHeight,
} from "./StoryboardMatrix";
export {
  StoryboardVideoThumbnail,
  storyboardPreviewVideoTake,
} from "./StoryboardMediaPreview";
export type {
  StoryboardMatrixField,
  StoryboardMatrixRow,
} from "./StoryboardMatrix";

const EMPTY_HINT: Record<NayinElement, string> = {
  metal: "先开瓶啤酒，和聊聊说说一句让你记住的话",
  wood: "泡上一壶龙井，慢慢回忆那个让你停下来的瞬间",
  water: "剥一颗椰子，把那个画面讲给聊聊",
  fire: "冲一泡大红袍，让聊聊带你回到那一刻",
  earth: "研一杯咖啡，和聊聊说一段你忘不掉的事",
};

function emotionAccent(emotion: string): string {
  // Hash-derived hue from the emotion string so similar emotions cluster.
  let h = 0;
  for (let i = 0; i < emotion.length; i++)
    h = (h * 31 + emotion.charCodeAt(i)) % 360;
  return `oklch(0.92 0.04 ${h})`;
}

function latestGeneratedImageForCard(
  images: GeneratedImageItem[],
  sceneImageId: number | undefined,
  shotNo: number
): GeneratedImageItem | undefined {
  const matched = images
    .filter(
      image => image.status !== "error" && parseShotNo(image.shotNo) === shotNo
    )
    .sort((left, right) => left.id - right.id);
  if (matched.length > 0) return matched[matched.length - 1];
  return images.find(image => image.id === sceneImageId);
}

function rationaleForShot(shots: StoryShot[], shotNo: number): string | null {
  return shots.find(shot => shot.shotNo === shotNo)?.rationale?.trim() || null;
}

function isRealEmotion(emotion?: string): emotion is string {
  const value = emotion?.trim();
  return Boolean(value && value !== "未标" && value !== "未标记");
}

function EmotionBridge({
  previousEmotion,
  currentEmotion,
}: {
  previousEmotion?: string;
  currentEmotion: string;
}) {
  if (
    !isRealEmotion(previousEmotion) ||
    !isRealEmotion(currentEmotion) ||
    previousEmotion === currentEmotion
  ) {
    return null;
  }

  return (
    <div
      className="flex justify-center py-1.5"
      aria-label={`情绪流动：${previousEmotion} 到 ${currentEmotion}`}
    >
      <div className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
        <span
          className="h-3 w-px bg-[var(--panel-border)]"
          aria-hidden="true"
        />
        <span
          className="rounded-full border px-2 py-0.5 font-mono"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel-header)",
            color: "var(--nayin-accent-bright)",
          }}
        >
          {previousEmotion} → {currentEmotion}
        </span>
      </div>
    </div>
  );
}

function CardItem({
  card,
  index,
  previousEmotion,
  visualItems,
  generatedImage,
  imageRationale,
  onRemove,
  onCommitContent,
  onDeleteGeneratedImage,
}: {
  card: StoryCard;
  index: number;
  previousEmotion?: string;
  visualItems: VisualCanvasItem[];
  generatedImage?: GeneratedImageItem;
  imageRationale?: string | null;
  onRemove: () => void;
  onCommitContent: (content: string) => void;
  onDeleteGeneratedImage: (image: GeneratedImageItem) => void;
}) {
  const controls = useDragControls();
  const tint = emotionAccent(card.emotion);

  return (
    <Reorder.Item
      value={card}
      dragListener={false}
      dragControls={controls}
      className="select-none"
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 12px 40px -12px var(--nayin-glow)",
        zIndex: 10,
      }}
    >
      <EmotionBridge
        previousEmotion={previousEmotion}
        currentEmotion={card.emotion}
      />
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="rounded-lg border p-3 group relative"
        style={{
          background: `linear-gradient(135deg, ${tint} 0%, var(--card) 70%)`,
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <button
            type="button"
            onPointerDown={e => controls.start(e)}
            className="shrink-0 mt-0.5 cursor-grab active:cursor-grabbing opacity-30 group-hover:opacity-70 transition-opacity"
            aria-label="拖拽排序"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Index badge */}
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold mt-0.5"
            style={{
              background: "var(--nayin-accent)",
              color: "var(--background)",
            }}
          >
            {index + 1}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold text-foreground truncate">
                {card.title}
              </h4>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                style={{
                  background: "var(--nayin-glow)",
                  color: "var(--nayin-accent-bright)",
                }}
              >
                {card.emotion}
              </span>
            </div>
            <p
              data-selection-source={`card:${card.id}`}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="编辑卡片内容"
              tabIndex={0}
              onPointerDown={e => e.stopPropagation()}
              onKeyDown={e => {
                // Enter commits & blurs; Shift+Enter keeps newline
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
              onBlur={e => {
                const next = (e.currentTarget.innerText || "").trim();
                if (next && next !== card.content) onCommitContent(next);
                else e.currentTarget.innerText = card.content;
              }}
              className="text-[11px] text-muted-foreground leading-relaxed select-text cursor-text rounded-sm outline-none -mx-1 px-1 focus:bg-foreground/[0.04] focus:ring-1 focus:ring-[var(--nayin-accent)]/40 hover:bg-foreground/[0.02] transition-colors"
            >
              {card.content}
            </p>
            {card.dialogue && (
              <div
                className="mt-2 px-2 py-1.5 rounded text-[10px] italic leading-relaxed"
                style={{
                  background: "var(--nayin-glow)",
                  color: "var(--nayin-accent-bright)",
                  borderLeft: "2px solid var(--nayin-accent)",
                }}
              >
                💬 {card.dialogue}
              </div>
            )}
            {card.sensoryDetails.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {card.sensoryDetails.map((d, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                    style={{
                      background: "var(--panel-header)",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    · {d}
                  </span>
                ))}
              </div>
            )}
            <CardReferenceDock
              cardId={card.id}
              visualItems={visualItems}
              generatedImage={generatedImage}
              imageRationale={imageRationale}
              onDeleteGeneratedImage={onDeleteGeneratedImage}
            />
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-all"
            aria-label="删除卡片"
            title="删除这张卡片"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    </Reorder.Item>
  );
}

export default function StoryCardsBoard() {
  const {
    cards,
    isGeneratingScript,
    latestScript,
    storyShots,
    visualCanvasItems,
    confirmedIntent,
    pendingIntentDraft,
  } = useStoryCardsBoardSlice();
  const {
    reorderCards,
    removeCard,
    updateCardContent,
    generateScript,
    removeStoryImage,
    confirmPendingIntent,
    confirmFictionStoryCards,
  } = useStoryAgentActions();
  const { element } = useNayin();
  const [boardView, setBoardView] = useState<"graph" | "list">("graph");
  const lastOrderRef = useRef<string>("");
  const utils = trpc.useUtils();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();
  const activeStoryId = useStorySpine(state => state.activeStoryId);
  const promptProjectionQuery = trpc.promptLineage.getStoryProjection.useQuery(
    { storyId: activeStoryId ?? 0 },
    { enabled: activeStoryId != null && activeStoryId > 0 }
  );
  const artLibraryQuery = trpc.artPromptLibrary.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const bindArtLibraryMut = trpc.artPromptLibrary.bindToStory.useMutation();
  const generatedImages = useStoryGeneratedImages();
  const [selectedNarrativeId, setSelectedNarrativeId] = useState("");
  const [selectedArtChoiceId, setSelectedArtChoiceId] = useState("");
  const [bindingLibraryVersionId, setBindingLibraryVersionId] = useState<
    number | null
  >(null);
  const generatedScenes = useMemo(
    () => buildMobileStoryboardScenes(cards, generatedImages),
    [cards, generatedImages]
  );
  const promptProjection =
    promptProjectionQuery.data?.mode === "lineage"
      ? promptProjectionQuery.data.projection
      : null;
  const artLibraryVersions = (artLibraryQuery.data ??
    []) as ArtLibraryVersionView[];
  const currentLibraryVersionId =
    promptProjection?.artBinding?.libraryVersionId ?? null;
  const handleDeleteGeneratedImage = useCallback(
    async (image: GeneratedImageItem) => {
      removeStoryImage(image.id);
      if (image.storyId == null) return;
      utils.storyAgent.storyGet.setData({ id: image.storyId }, current => {
        if (!current?.body || typeof current.body !== "object") return current;
        const body = current.body as Record<string, unknown>;
        const mobileImages = Array.isArray(body.mobileImages)
          ? body.mobileImages.filter(item => {
              if (!item || typeof item !== "object") return true;
              return (item as { id?: unknown }).id !== image.id;
            })
          : body.mobileImages;
        return { ...current, body: { ...body, mobileImages } };
      });
      try {
        await signalMut.mutateAsync({
          storyId: image.storyId,
          imageId: image.id,
          action: "swipe_left",
          metadata: { source: "story-cards-delete" },
        });
        void utils.storyAgent.storyImages.invalidate({
          storyId: image.storyId,
        });
        void utils.storyAgent.storyGet.invalidate({ id: image.storyId });
      } catch (error) {
        console.warn(
          "[StoryCardsBoard] record image delete signal failed:",
          error instanceof Error ? error.message : error
        );
      }
    },
    [removeStoryImage, signalMut, utils]
  );

  // Detect whether order changed since last script
  const orderChanged = useMemo(() => {
    if (!latestScript) return cards.length > 0;
    if (latestScript.cardOrder.length !== cards.length) return true;
    return cards.some((c, i) => latestScript.cardOrder[i] !== c.id);
  }, [cards, latestScript]);
  const effectiveIntent = confirmedIntent ?? pendingIntentDraft;
  const isFictionIntent = effectiveIntent?.purpose === "fiction";
  const hasPendingFictionIntent =
    !confirmedIntent && pendingIntentDraft?.purpose === "fiction";
  const hasConfirmedFictionIntent = confirmedIntent?.purpose === "fiction";
  const fictionCardsConfirmed = isFictionStoryCardConfirmed(
    confirmedIntent,
    cards
  );
  const shouldGateFictionStoryboard =
    isFictionIntent && (!hasConfirmedFictionIntent || !fictionCardsConfirmed);
  const primaryActionDisabled = isGeneratingScript || cards.length === 0;
  const narrativeChoices = useMemo(
    () => narrativeChoicesForIntent(effectiveIntent?.purpose),
    [effectiveIntent?.purpose]
  );
  const activeNarrativeId = narrativeChoices.some(
    choice => choice.id === selectedNarrativeId
  )
    ? selectedNarrativeId
    : (narrativeChoices[0]?.id ?? "");
  const defaultArtChoiceId = currentLibraryVersionId
    ? artChoiceKey("library", currentLibraryVersionId)
    : artChoiceKey("preset", FALLBACK_VISUAL_STYLES[0]?.id ?? "");
  const activeArtChoiceId =
    selectedArtChoiceId &&
    (FALLBACK_VISUAL_STYLES.some(
      preset => selectedArtChoiceId === artChoiceKey("preset", preset.id)
    ) ||
      artLibraryVersions.some(
        version =>
          selectedArtChoiceId === artChoiceKey("library", version.version.id)
      ))
      ? selectedArtChoiceId
      : defaultArtChoiceId;
  const selectedNarrativeChoice =
    narrativeChoices.find(choice => choice.id === activeNarrativeId) ??
    narrativeChoices[0] ??
    null;
  const selectedArtPreset = FALLBACK_VISUAL_STYLES.find(
    preset => activeArtChoiceId === artChoiceKey("preset", preset.id)
  );
  const selectedArtLibrary = artLibraryVersions.find(
    version => activeArtChoiceId === artChoiceKey("library", version.version.id)
  );
  const generationProfile = useMemo<GenerationProfileArg>(
    () => ({
      scriptStyle: selectedNarrativeChoice
        ? {
            id: selectedNarrativeChoice.id,
            label: selectedNarrativeChoice.label,
            logline: selectedNarrativeChoice.logline,
            arc: selectedNarrativeChoice.arc,
            treatment: selectedNarrativeChoice.treatment,
          }
        : undefined,
      artStyle: selectedArtLibrary
        ? {
            id: artChoiceKey("library", selectedArtLibrary.version.id),
            source: "library",
            title: selectedArtLibrary.library.name,
            description: selectedArtLibrary.library.description,
            libraryVersionId: selectedArtLibrary.version.id,
            items: selectedArtLibrary.items.map(item => ({
              dimension: item.dimension,
              content: item.content,
              negativeContent: item.negativeContent,
            })),
          }
        : selectedArtPreset
          ? {
              id: selectedArtPreset.id,
              source: "preset",
              title: selectedArtPreset.title,
              description: selectedArtPreset.description,
              recipe: selectedArtPreset.recipe,
            }
          : undefined,
    }),
    [selectedArtLibrary, selectedArtPreset, selectedNarrativeChoice]
  );
  const handleBindArtLibrary = useCallback(
    async (libraryVersionId: number) => {
      if (activeStoryId == null || activeStoryId <= 0 || !promptProjection) {
        toast.error("故事保存后才能绑定美术库");
        return;
      }
      setBindingLibraryVersionId(libraryVersionId);
      try {
        const result = await bindArtLibraryMut.mutateAsync({
          storyId: activeStoryId,
          libraryVersionId,
          expectedVersion: promptProjection.state.version,
        });
        if (result.projection) {
          utils.promptLineage.getStoryProjection.setData(
            { storyId: activeStoryId },
            { mode: "lineage", projection: result.projection }
          );
        }
        setSelectedArtChoiceId(artChoiceKey("library", libraryVersionId));
        await Promise.all([
          utils.promptLineage.getStoryProjection.invalidate({
            storyId: activeStoryId,
          }),
          utils.storyAgent.storyGet.invalidate({ id: activeStoryId }),
        ]);
        toast.success("美术库已绑定到故事");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "绑定美术库失败");
      } finally {
        setBindingLibraryVersionId(null);
      }
    },
    [activeStoryId, bindArtLibraryMut, promptProjection, utils]
  );
  const handlePrimaryAction = useCallback(() => {
    if (hasPendingFictionIntent) {
      confirmPendingIntent();
      return;
    }
    if (shouldGateFictionStoryboard) {
      confirmFictionStoryCards();
      return;
    }
    void generateScript(undefined, generationProfile);
  }, [
    confirmFictionStoryCards,
    confirmPendingIntent,
    generateScript,
    generationProfile,
    hasPendingFictionIntent,
    shouldGateFictionStoryboard,
  ]);

  // Track the last order string for animation triggers (reserved for future use)
  const orderKey = cards.map(c => c.id).join("|");
  if (orderKey !== lastOrderRef.current) lastOrderRef.current = orderKey;

  return (
    <div className="creation-board-panel h-full flex flex-col">
      <div className="creation-board-panel-header justify-between">
        <div className="creation-board-panel-title">
          <Sparkles className="creation-board-panel-icon" />
          <h2 className="creation-board-panel-title-text">故事卡片</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="creation-board-panel-status">
            {cards.length > 0 ? `${cards.length} 张卡片` : "等待卡片"}
          </span>
          {cards.length > 0 ? (
            <span
              className="inline-flex rounded-full border p-0.5 text-[10px]"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--background)",
              }}
            >
              <button
                type="button"
                onClick={() => setBoardView("graph")}
                className="rounded-full px-2 py-0.5 transition"
                style={{
                  background:
                    boardView === "graph"
                      ? "var(--nayin-accent)"
                      : "transparent",
                  color:
                    boardView === "graph"
                      ? "var(--background)"
                      : "var(--muted-foreground)",
                }}
              >
                图谱
              </button>
              <button
                type="button"
                onClick={() => setBoardView("list")}
                className="rounded-full px-2 py-0.5 transition"
                style={{
                  background:
                    boardView === "list"
                      ? "var(--nayin-accent)"
                      : "transparent",
                  color:
                    boardView === "list"
                      ? "var(--background)"
                      : "var(--muted-foreground)",
                }}
              >
                列表
              </button>
            </span>
          ) : null}
        </div>
      </div>

      <div className="creation-board-panel-body flex min-h-0 flex-1 flex-col overflow-hidden">
        {cards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-[180px] flex-col items-center justify-center text-center gap-3 px-4"
          >
            <FlaskConical className="w-7 h-7 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
              {EMPTY_HINT[element]}
            </p>
            <p className="text-[10px] text-muted-foreground/70 max-w-[16rem]">
              聊聊会在你描述出{" "}
              <span className="text-nayin-bright">
                具体场景 + 情感 + 感官细节
              </span>{" "}
              时，自动把那一刻提炼成卡片，飞到这里来。
            </p>
          </motion.div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
              <GenerationSettingsPanel
                narrativeChoices={narrativeChoices}
                activeNarrativeId={activeNarrativeId}
                onSelectNarrative={setSelectedNarrativeId}
                activeArtChoiceId={activeArtChoiceId}
                artLibraryVersions={artLibraryVersions}
                currentLibraryVersionId={currentLibraryVersionId}
                artLibraryLoading={
                  artLibraryQuery.isLoading || artLibraryQuery.isFetching
                }
                artLibraryError={artLibraryQuery.error?.message ?? null}
                canBindArtLibrary={Boolean(activeStoryId && promptProjection)}
                bindingLibraryVersionId={bindingLibraryVersionId}
                onSelectArtPreset={preset =>
                  setSelectedArtChoiceId(artChoiceKey("preset", preset.id))
                }
                onSelectArtLibrary={libraryVersion =>
                  setSelectedArtChoiceId(
                    artChoiceKey("library", libraryVersion.version.id)
                  )
                }
                onBindArtLibrary={libraryVersionId => {
                  void handleBindArtLibrary(libraryVersionId);
                }}
              />

              {boardView === "graph" ? (
                <StoryCardsGraph
                  cards={cards}
                  storyShots={storyShots}
                  onRemoveCard={removeCard}
                  mode={isFictionIntent ? "fiction" : "default"}
                />
              ) : (
                <Reorder.Group
                  axis="y"
                  values={cards}
                  onReorder={reorderCards}
                  className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1"
                >
                  <AnimatePresence>
                    {cards.map((card, idx) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        index={idx}
                        previousEmotion={cards[idx - 1]?.emotion}
                        visualItems={visualCanvasItems.filter(
                          item => item.cardId === card.id
                        )}
                        generatedImage={latestGeneratedImageForCard(
                          generatedImages,
                          generatedScenes[idx]?.imageId,
                          idx + 1
                        )}
                        imageRationale={rationaleForShot(storyShots, idx + 1)}
                        onRemove={() => removeCard(card.id)}
                        onCommitContent={text =>
                          updateCardContent(card.id, text)
                        }
                        onDeleteGeneratedImage={handleDeleteGeneratedImage}
                      />
                    ))}
                  </AnimatePresence>
                </Reorder.Group>
              )}
            </div>

            <div
              className="mt-2 flex shrink-0 flex-col gap-2 border-t pt-2.5"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {isFictionIntent ? (
                <div
                  className="rounded-lg border p-2 text-[11px] leading-relaxed"
                  style={{
                    borderColor: fictionCardsConfirmed
                      ? "var(--nayin-accent-dim)"
                      : "var(--panel-border)",
                    background: "var(--background)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{
                        color: fictionCardsConfirmed
                          ? "var(--nayin-accent)"
                          : "var(--muted-foreground)",
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {hasPendingFictionIntent
                          ? "先确认创造另一个世界"
                          : fictionCardsConfirmed
                            ? "虚构故事卡已确认"
                            : "先确认虚构故事卡"}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {hasPendingFictionIntent
                          ? "聊聊已经判断这是虚构短片；确认意图后，故事卡会按世界、人物和冲突继续生长。"
                          : fictionCardsConfirmed
                            ? "现在可以生成 3-5 镜短片；如果改卡片，需要重新确认。"
                            : "确认后再进入拆镜，避免还没定故事方向就生成镜头。"}
                      </p>
                    </div>
                    {hasPendingFictionIntent ? (
                      <button
                        type="button"
                        onClick={confirmPendingIntent}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                        style={{
                          borderColor: "var(--nayin-accent-dim)",
                          color: "var(--nayin-accent)",
                        }}
                      >
                        确认意图
                      </button>
                    ) : !fictionCardsConfirmed ? (
                      <button
                        type="button"
                        onClick={confirmFictionStoryCards}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                        style={{
                          borderColor: "var(--nayin-accent-dim)",
                          color: "var(--nayin-accent)",
                        }}
                      >
                        确认故事卡
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={primaryActionDisabled}
                className="text-xs py-2 rounded-md font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{
                  background: "var(--nayin-accent)",
                  color: "var(--background)",
                  boxShadow: "0 4px 16px -6px var(--nayin-glow)",
                }}
              >
                {isGeneratingScript ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在生成故事版…
                  </>
                ) : (
                  <>
                    <Clapperboard className="w-3.5 h-3.5" />
                    {latestScript && !orderChanged
                      ? "重新生成故事版"
                      : latestScript && orderChanged
                        ? "按新顺序生成故事版"
                        : hasPendingFictionIntent
                          ? "先确认意图"
                          : shouldGateFictionStoryboard
                            ? "确认故事卡"
                            : "生成故事版"}
                  </>
                )}
              </button>
              <p className="text-[10px] text-muted-foreground/70 text-center">
                生成剧本 · 统一提示词 · 关键镜头草稿图
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
