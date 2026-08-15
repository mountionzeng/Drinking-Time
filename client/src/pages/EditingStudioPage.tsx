/**
 * EditingStudioPage — 剪辑工作室（聊天驱动剪辑，ChatCut 式交互）。
 * 左：聊聊创作对话（StoryAgentChat；未打开故事时显示故事列表）
 * 右：故事版镜头 + 动态预览 + 多轨时间轴（共享同一套镜头数据）
 * 复用工作区同一套 Provider 栈与面板组件，只是一个专注剪辑的组合视图。
 */
import {
  BookOpen,
  Clapperboard,
  Info,
  LibraryBig,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import TopBar from "@/app/shell/TopBar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useProjectData } from "@/features/analysis/hooks/useProjectData";
import type { StoryPanel } from "@/features/analysis/storyPanels";
import { CreationEditorProvider } from "@/features/creationEditor/CreationEditorContext";
import AnimaticPanel from "@/features/creationEditor/views/AnimaticPanel";
import EditingNleWorkspace from "@/features/creationEditor/views/EditingNleWorkspace";
import MaterialWarehousePanel from "@/features/creationEditor/views/MaterialWarehousePanel";
import PromptTablePanel from "@/features/creationEditor/views/PromptTablePanel";
import {
  parseLocalEditingChatCommand,
  shouldDeferStoryboardImageCommand,
} from "@/features/creationEditor/editingChatCommands";
import {
  executeTimelineUndo,
  recordTimelineUndoSnapshot,
} from "@/features/creationEditor/timelineUndoStore";
import BeverageAmbience from "@/features/nayin/views/BeverageAmbience";
import {
  StoryAgentProvider,
  useStoryAgent,
  useStoryAgentActions,
} from "@/features/storyAgent/StoryAgentContext";
import {
  storySpineStore,
  useStorySpine,
} from "@/features/storyAgent/spine/storySpine";
import {
  useActiveStoryId,
  useConfirmedIntent,
} from "@/features/storyAgent/spine/selectors";
import StoryAgentChat from "@/features/storyAgent/views/StoryAgentChat";
import { buildCapabilityIntent } from "@/features/storyAgent/views/StoryCapabilityMenu";
import StoryCardsBoard from "@/features/storyAgent/views/StoryCardsBoard";
import StoryListView from "@/features/storyAgent/views/StoryListView";
import StoryboardPanel from "@/features/storyAgent/views/StoryboardPanel";
import type { VideoClipEditorTarget } from "@/features/creationEditor/videoClipEditorModel";
import { trpc } from "@/lib/trpc";
import { displayShotCode } from "@shared/shotIdentity";
import type { SelectionContext } from "@shared/selectionContext";
import { editingCapabilityReply } from "@shared/editingActionCapabilities";
import { normalizeEmotionAnalysisProfile } from "@/features/analysis/emotionAnalysis";
import { publicDailyLetterForDate } from "@/features/analysis/publicDailyLetter";
import DailyLetterWelcome from "@/features/analysis/views/DailyLetterWelcome";
import { useAuth } from "@/_core/hooks/useAuth";
import { useNayin } from "@/features/nayin/NayinContext";
import PublishingDraftWorkspace from "@/features/publishingDraft/PublishingDraftWorkspace";
import PublishingVideoHandoffBanner from "@/features/publishingDraft/PublishingVideoHandoffBanner";
import {
  STUDIO_WORKSPACE_OPTIONS,
  isStoryPanelWorkspace,
  resolveStudioInteractionMode,
  resolveTimelineCommandStoryId,
  shouldShowPublishingHandoff,
  type StudioInteractionMode,
  type StudioWorkspace,
} from "./editingStudioWorkspace";

function DailyAttentionBar({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const { today } = useNayin();
  const profileQuery = trpc.emotionAnalysis.getProfile.useQuery(undefined, {
    enabled: Boolean(user?.id),
    retry: false,
  });
  const profile = normalizeEmotionAnalysisProfile(profileQuery.data, "server");
  const publicLetter = publicDailyLetterForDate(today.cstDateStr);
  const attention = profile?.dailyReference.mindset || publicLetter.attention;
  if (!attention) return null;

  return (
    <div
      className="relative z-10 flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-background/90 px-4 text-xs backdrop-blur"
      aria-label="今日来信"
    >
      <Info className="h-3.5 w-3.5 shrink-0 text-nayin" />
      <span className="font-chat-brand shrink-0 text-sm text-foreground">
        今日来信
      </span>
      <span
        className="min-w-0 truncate text-muted-foreground"
        title={attention}
      >
        {attention}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 px-2 text-[11px] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen className="h-3.5 w-3.5" />
        读信
      </button>
    </div>
  );
}

function ExportButton({ storyId }: { storyId: number }) {
  const exportMut = trpc.creationAgent.exportTimeline.useMutation();
  const [exporting, setExporting] = useState(false);

  const runExport = async () => {
    setExporting(true);
    try {
      const result = await exportMut.mutateAsync({
        storyId,
        fallbackToLatestTake: true,
      });
      if (result.status === "ok") {
        const storyShots = storySpineStore.getState().storyShots;
        const skipped =
          result.skipped.length > 0
            ? `（跳过 ${result.skipped.length} 镜：${result.skipped
                .map(s =>
                  displayShotCode(
                    storyShots.find(shot => shot.shotNo === s.shotNo) ?? s
                  )
                )
                .join("、")}）`
            : "";
        toast.success(
          `成片已导出：${result.segmentCount} 镜 · ${result.durationSec}s${skipped}`
        );
        window.open(result.videoUrl, "_blank");
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void runExport()}
      disabled={exporting}
      className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-primary-foreground shadow-[0_6px_14px_-8px_var(--nayin-accent)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: "var(--nayin-accent)" }}
    >
      {exporting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Clapperboard className="h-4 w-4" />
      )}
      {exporting ? "合成中…" : "导出成片"}
    </button>
  );
}

function StoryPanelWorkspace({
  workspace,
  onEditVideo,
}: {
  workspace: StoryPanel;
  onEditVideo: (target: VideoClipEditorTarget) => void;
}) {
  switch (workspace) {
    case "materialWarehouse":
      return <MaterialWarehousePanel />;
    case "storyboard":
      return <StoryboardPanel onEditVideo={onEditVideo} />;
    case "animatic":
      return <AnimaticPanel />;
    case "promptTable":
      return <PromptTablePanel />;
    case "storyCards":
      return <StoryCardsBoard />;
  }
}

function EditingStudioBody({
  workspace,
  interactionMode,
  onWorkspaceChange,
  timelineVisible,
}: {
  workspace: StudioWorkspace;
  interactionMode: StudioInteractionMode;
  onWorkspaceChange: (workspace: StudioWorkspace) => void;
  timelineVisible: boolean;
}) {
  const activeStoryId = useActiveStoryId();
  const { publishingBuffers } = useStoryAgent();
  const {
    backToList,
    createNewStory,
    discardPublishingBuffer,
    loadStory,
    setConfirmedIntent,
  } = useStoryAgentActions();
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [storyMenuOpen, setStoryMenuOpen] = useState(false);
  const [pendingStoryAction, setPendingStoryAction] = useState<
    "back" | "new" | null
  >(null);
  const [videoEditorHandoffTarget, setVideoEditorHandoffTarget] =
    useState<VideoClipEditorTarget | null>(null);
  const dirtyBuffers = Object.values(publishingBuffers).filter(
    buffer => buffer.storyId === activeStoryId
  );

  useEffect(() => {
    const startDailyThoughtConversation = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          message?: string;
          mode?: "visual" | "letter";
        }>
      ).detail;
      const message = detail?.message?.trim();
      if (!message || (detail.mode !== "visual" && detail.mode !== "letter")) {
        return;
      }

      createNewStory();
      setConfirmedIntent(buildCapabilityIntent("personal_memory"));
      setChatCollapsed(false);
      onWorkspaceChange("storyboard");

      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("dt:open-creation-chat", {
            detail: {
              draftMessage: message,
              autoSubmit: true,
            },
          })
        );
      }, 0);
    };

    window.addEventListener(
      "dt:start-daily-thought-conversation",
      startDailyThoughtConversation
    );
    return () =>
      window.removeEventListener(
        "dt:start-daily-thought-conversation",
        startDailyThoughtConversation
      );
  }, [createNewStory, onWorkspaceChange, setConfirmedIntent]);

  useEffect(() => {
    const openDailyLetterStory = (event: Event) => {
      const storyId = (event as CustomEvent<{ storyId?: number }>).detail
        ?.storyId;
      if (!storyId) return;
      setChatCollapsed(false);
      void loadStory(storyId);
    };
    window.addEventListener("dt:open-daily-letter-story", openDailyLetterStory);
    return () =>
      window.removeEventListener(
        "dt:open-daily-letter-story",
        openDailyLetterStory
      );
  }, [loadStory]);

  const runStoryAction = (action: "back" | "new") => {
    if (action === "back") backToList();
    else createNewStory();
  };

  const requestStoryAction = (action: "back" | "new") => {
    setStoryMenuOpen(false);
    if (dirtyBuffers.length > 0) {
      setPendingStoryAction(action);
      return;
    }
    runStoryAction(action);
  };

  const leaveWithDrafts = () => {
    if (!pendingStoryAction) return;
    const action = pendingStoryAction;
    setPendingStoryAction(null);
    runStoryAction(action);
  };

  const discardAndLeave = () => {
    if (!pendingStoryAction || activeStoryId == null) return;
    for (const buffer of dirtyBuffers) {
      discardPublishingBuffer(activeStoryId, buffer.platform);
    }
    leaveWithDrafts();
  };

  useEffect(() => {
    setVideoEditorHandoffTarget(null);
  }, [activeStoryId]);

  const openStoryboardVideoEditor = useCallback(
    (target: VideoClipEditorTarget) => {
      setVideoEditorHandoffTarget(target);
      onWorkspaceChange("editing");
    },
    [onWorkspaceChange]
  );

  return (
    <CreationEditorProvider activeStoryId={activeStoryId}>
      <div className="flex h-full min-h-0">
        {/* 左：聊聊创作对话（与工作区同一折叠交互） */}
        <div
          className="relative h-full shrink-0 overflow-hidden border-r transition-[width] duration-200"
          style={{
            width: chatCollapsed ? 48 : "min(340px, 38vw)",
            borderColor: "var(--nayin-border)",
          }}
        >
          <div className="absolute right-2 top-2 z-20 flex flex-col gap-2">
            <Popover open={storyMenuOpen} onOpenChange={setStoryMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                  aria-label="切换或新建故事"
                  title="切换或新建故事"
                >
                  <LibraryBig className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={10}
                className="w-48 p-1.5"
                style={{
                  background: "var(--panel-bg)",
                  borderColor: "var(--nayin-border)",
                }}
              >
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Stories
                </div>
                <button
                  type="button"
                  onClick={() => {
                    requestStoryAction("back");
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[var(--nayin-accent)]" />
                  回到以前的故事
                </button>
                <button
                  type="button"
                  onClick={() => {
                    requestStoryAction("new");
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--nayin-accent)]" />
                  开启新故事
                </button>
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={() => setChatCollapsed(value => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
              aria-label={chatCollapsed ? "展开聊聊" : "折叠聊聊"}
              title={chatCollapsed ? "展开聊聊" : "折叠聊聊"}
            >
              {chatCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
          <div
            className={`h-full ${
              chatCollapsed ? "invisible pointer-events-none" : ""
            }`}
            aria-hidden={chatCollapsed}
          >
            {activeStoryId !== null ? (
              <StoryAgentChat
                showHeader={false}
                interactionMode={interactionMode}
                onOpenPublishingWorkspace={() => onWorkspaceChange("publishing")}
              />
            ) : (
              <StoryListView />
            )}
          </div>
        </div>

        {/* 右：文字稿、五个故事面板与剪辑台共享同一 Story。 */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {workspace === "publishing" ? (
            <div id="publishing-draft-workspace" className="h-full">
              <PublishingDraftWorkspace
                onContinueToVideo={() => onWorkspaceChange("storyboard")}
              />
            </div>
          ) : activeStoryId !== null ? (
            <div
              id={
                workspace === "editing"
                  ? "editing-nle-workspace"
                  : `studio-${workspace}-workspace`
              }
              className="flex h-full min-h-0 flex-col overflow-hidden"
              data-story-panel={
                workspace === "editing" ? "editing-nle" : workspace
              }
              aria-label={
                STUDIO_WORKSPACE_OPTIONS.find(option => option.id === workspace)
                  ?.label
              }
            >
              {shouldShowPublishingHandoff(workspace) ? (
                <PublishingVideoHandoffBanner />
              ) : null}
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {workspace === "editing" ? (
                  <EditingNleWorkspace
                    timelineVisible={timelineVisible}
                    videoEditorHandoffTarget={videoEditorHandoffTarget}
                    onVideoEditorHandoffHandled={() =>
                      setVideoEditorHandoffTarget(null)
                    }
                  />
                ) : isStoryPanelWorkspace(workspace) ? (
                  <StoryPanelWorkspace
                    workspace={workspace}
                    onEditVideo={openStoryboardVideoEditor}
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
              aria-label="未选择故事"
            >
              从左侧打开一个故事，预览播放器和时间轴会显示在这里；
              直接在对话里说想怎么剪，聊聊会帮你动手。
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={pendingStoryAction !== null}
        onOpenChange={open => !open && setPendingStoryAction(null)}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>这篇文字稿还有未应用修改</DialogTitle>
            <DialogDescription>
              你的文字仍安全保存在当前 Story 的本地缓冲区，不会带到下一个
              Story。
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs leading-5 text-muted-foreground">
            回到文字稿可以先点“应用修改”；也可以保留草稿稍后处理，或明确丢弃这些修改后离开。
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingStoryAction(null)}
              className="h-9 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              留在这里
            </button>
            <button
              type="button"
              onClick={discardAndLeave}
              className="h-9 rounded-md border px-3 text-xs text-rose-700"
            >
              丢弃修改并离开
            </button>
            <button
              type="button"
              onClick={leaveWithDrafts}
              className="h-9 rounded-md px-3 text-xs font-medium text-background"
              style={{ background: "var(--nayin-accent)" }}
            >
              保留修改，稍后应用
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CreationEditorProvider>
  );
}

export default function EditingStudioPage() {
  const { currentProjectId } = useProjectData();
  const activeStoryId = useActiveStoryId();
  const confirmedIntent = useConfirmedIntent();
  const storyList = useStorySpine(state => state.storyList);
  const utils = trpc.useUtils();
  const timelineEditMut = trpc.creationAgent.timelineEditCommand.useMutation();
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [dailyLetterOpen, setDailyLetterOpen] = useState(false);
  const [workspace, setWorkspace] = useState<StudioWorkspace>("publishing");
  const interactionMode = resolveStudioInteractionMode(
    workspace,
    confirmedIntent
  );

  // 对话驱动剪辑：这句话先交给剪辑代理；接住就执行时间轴操作并刷新剪辑台，
  // 没接住（不是剪辑意图）返回 null，聊聊照常聊故事。
  const runEditingCommand = useCallback(
    async (
      instruction: string,
      selectionContext?: Pick<
        SelectionContext,
        | "sourceType"
        | "sourceId"
        | "stableShotId"
        | "shotNo"
        | "imageId"
        | "videoTakeId"
        | "rangeId"
        | "selection"
      >,
      requestedStoryId?: number | null
    ) => {
      const storyId = resolveTimelineCommandStoryId(
        requestedStoryId,
        activeStoryId,
        storySpineStore.getState().activeStoryId
      );
      if (storyId == null) return null;
      const localCommand = parseLocalEditingChatCommand(instruction);
      if (localCommand?.type === "capabilities") {
        return {
          handled: true as const,
          reply: editingCapabilityReply(),
        };
      }
      if (localCommand?.type === "undo") {
        const status = await executeTimelineUndo(storyId);
        return {
          handled: true as const,
          reply:
            status === "undone"
              ? "已撤销上一步剪辑，时间线和预览都恢复了。"
              : status === "empty"
                ? "当前会话里没有可以撤销的剪辑。"
                : "剪辑台还没有载入完成，暂时不能撤销。请等右侧时间线出现后再试。",
        };
      }
      const result = await timelineEditMut.mutateAsync({
        storyId,
        instruction,
        selectionContext,
      });
      if (!result.handled) return null;
      if (
        shouldDeferStoryboardImageCommand({
          sourceType: selectionContext?.sourceType,
          appliedCount: result.appliedCount,
          hasProposal: Boolean(result.proposal),
        })
      ) {
        return null;
      }
      if (result.appliedCount > 0) {
        if ("undoSnapshot" in result && result.undoSnapshot) {
          recordTimelineUndoSnapshot(storyId, result.undoSnapshot);
        }
        await Promise.all([
          utils.storyAgent.storyMaterialState.invalidate({ storyId }),
          utils.storyAgent.storyVideoAssets.invalidate({ storyId }),
        ]);
      }
      return {
        handled: true as const,
        reply: result.reply,
        transitionCandidate: result.proposal,
      };
    },
    [activeStoryId, timelineEditMut, utils]
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <BeverageAmbience />
      <TopBar
        showStoryPanelNav={false}
        panelToggles={STUDIO_WORKSPACE_OPTIONS.map(option => ({
          label: option.label,
          active: workspace === option.id,
          controls:
            option.id === "publishing"
              ? "publishing-draft-workspace"
              : option.id === "editing"
                ? "editing-nle-workspace"
                : `studio-${option.id}-workspace`,
          testId: `topbar-${option.id}-workspace-toggle`,
          onToggle: () => setWorkspace(option.id),
        }))}
        panelActions={
          workspace === "editing" && activeStoryId !== null ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={timelineVisible}
                onClick={() => setTimelineVisible(value => !value)}
                className="inline-flex h-9 items-center rounded-lg border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                style={{ borderColor: "var(--panel-border)" }}
              >
                Timeline
              </button>
              <ExportButton storyId={activeStoryId} />
            </div>
          ) : null
        }
      />
      <DailyAttentionBar onOpen={() => setDailyLetterOpen(true)} />
      <DailyLetterWelcome
        forceOpen={dailyLetterOpen}
        onRequestClose={() => setDailyLetterOpen(false)}
        onStartVisualConversation={message => {
          window.dispatchEvent(
            new CustomEvent("dt:start-daily-thought-conversation", {
              detail: { message, mode: "visual" },
            })
          );
        }}
        stories={storyList}
        onOpenStory={storyId => {
          window.dispatchEvent(
            new CustomEvent("dt:open-daily-letter-story", {
              detail: { storyId },
            })
          );
        }}
        onStartLetterStory={message => {
          window.dispatchEvent(
            new CustomEvent("dt:start-daily-thought-conversation", {
              detail: { message, mode: "letter" },
            })
          );
        }}
      />
      <div className="relative z-10 min-h-0 flex-1">
        <StoryAgentProvider
          projectId={currentProjectId}
          editingCommandRunner={runEditingCommand}
          interactionMode={interactionMode}
        >
          <EditingStudioBody
            workspace={workspace}
            interactionMode={interactionMode}
            onWorkspaceChange={setWorkspace}
            timelineVisible={timelineVisible}
          />
        </StoryAgentProvider>
      </div>
    </div>
  );
}
