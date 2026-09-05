/**
 * EditingStudioPage — 剪辑工作室（聊天驱动剪辑，ChatCut 式交互）。
 * 左：聊聊创作对话（StoryAgentChat；未打开故事时显示故事列表）
 * 右：故事版镜头 + 动态预览 + 多轨时间轴（共享同一套镜头数据）
 * 复用工作区同一套 Provider 栈与面板组件，只是一个专注剪辑的组合视图。
 */
import {
  Clapperboard,
  LibraryBig,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import WuxingMotifIcon, {
  WUXING_MOTIF_NAME,
} from "@/features/nayin/views/WuxingMotifIcon";
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
import {
  shouldRouteWorkspaceForStoryTransition,
  workspaceForStoryStage,
} from "@/features/storyAgent/recentStoryEntry";
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
import {
  STUDIO_WORKSPACE_OPTIONS,
  isStoryPanelWorkspace,
  resolveStudioInteractionMode,
  resolveTimelineCommandStoryId,
  type StudioInteractionMode,
  type StudioWorkspace,
} from "./editingStudioWorkspace";

function DailyAttentionBar({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const { today, element } = useNayin();
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
      className="relative z-10 flex h-7 shrink-0 items-center gap-1.5 pb-1.5 text-[11px]"
      aria-label="今日来信"
    >
      {/* 小物 + 「今日来信」本身就是读信入口，跟着当天的五行走：
          木是茶叶、土是咖啡豆……和左边那颗 Logo 是同一套东西。 */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`读信 · 今日来信（${WUXING_MOTIF_NAME[element]}）`}
        title="读信"
        className="group -ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <WuxingMotifIcon element={element} size={15} />
        <span className="font-chat-brand text-xs text-foreground">
          今日来信
        </span>
      </button>
      <span
        className="min-w-0 truncate text-muted-foreground"
        title={attention}
      >
        {attention}
      </span>
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
  onTimelineVisibleChange,
  materialVisible,
  onMaterialVisibleChange,
}: {
  workspace: StudioWorkspace;
  interactionMode: StudioInteractionMode;
  onWorkspaceChange: (workspace: StudioWorkspace) => void;
  onTimelineVisibleChange: (visible: boolean) => void;
  materialVisible: boolean;
  onMaterialVisibleChange: (visible: boolean) => void;
}) {
  const activeStoryId = useActiveStoryId();
  const storyShotCount = useStorySpine(state => state.storyShots.length);
  const { publishingBuffers } = useStoryAgent();
  const {
    backToList,
    createNewStory,
    discardPublishingBuffer,
    loadStory,
    setConfirmedIntent,
  } = useStoryAgentActions();
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [pendingStoryAction, setPendingStoryAction] = useState<
    "back" | "new" | null
  >(null);
  const [videoEditorHandoffTarget, setVideoEditorHandoffTarget] =
    useState<VideoClipEditorTarget | null>(null);
  const previousStoryIdRef = useRef<number | null>(null);
  const dirtyBuffers = Object.values(publishingBuffers).filter(
    buffer => buffer.storyId === activeStoryId
  );

  useEffect(() => {
    const previousStoryId = previousStoryIdRef.current;
    previousStoryIdRef.current = activeStoryId;
    if (!shouldRouteWorkspaceForStoryTransition(previousStoryId, activeStoryId))
      return;
    onWorkspaceChange(workspaceForStoryStage(storyShotCount));
  }, [activeStoryId, onWorkspaceChange, storyShotCount]);

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
    // 日签和顶栏 Logo 菜单都从这里进某篇故事。TopBar 渲染在 StoryAgentProvider
    // 外面（拿不到 loadStory），所以走 window 事件跨过这层边界。
    window.addEventListener("dt:open-daily-letter-story", openDailyLetterStory);
    window.addEventListener("dt:open-story", openDailyLetterStory);
    return () => {
      window.removeEventListener(
        "dt:open-daily-letter-story",
        openDailyLetterStory
      );
      window.removeEventListener("dt:open-story", openDailyLetterStory);
    };
  }, [loadStory]);

  const runStoryAction = (action: "back" | "new") => {
    if (action === "back") backToList();
    else createNewStory();
  };

  const requestStoryAction = (action: "back" | "new") => {
    if (dirtyBuffers.length > 0) {
      setPendingStoryAction(action);
      return;
    }
    runStoryAction(action);
  };

  useEffect(() => {
    const onStoryMenuAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: "back" | "new" }>).detail
        ?.action;
      if (action !== "back" && action !== "new") return;
      requestStoryAction(action);
    };
    window.addEventListener("dt:story-menu-action", onStoryMenuAction);
    return () =>
      window.removeEventListener("dt:story-menu-action", onStoryMenuAction);
  });

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
                onOpenPublishingWorkspace={() =>
                  onWorkspaceChange("publishing")
                }
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
                onContinueToVideo={() => {
                  // 成片生成完成后直接落到可连续播放的剪辑台，避免用户还要
                  // 从故事版看板再找一次完整时间线。
                  onTimelineVisibleChange(true);
                  onWorkspaceChange("editing");
                }}
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
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {workspace === "editing" ? (
                  <EditingNleWorkspace
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
              {workspace === "editing" && materialVisible ? (
                <MaterialWarehousePanel
                  variant="drawer"
                  onClose={() => onMaterialVisibleChange(false)}
                />
              ) : null}
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
  // 顶栏 Logo 菜单只露最近三条，这里先按最后修改时间排一次。
  const recentStories = useMemo(
    () =>
      [...storyList].sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
          new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
      ),
    [storyList]
  );
  const storyMenu = useMemo(
    () => ({
      stories: recentStories,
      onNewStory: () =>
        window.dispatchEvent(
          new CustomEvent("dt:story-menu-action", { detail: { action: "new" } })
        ),
      onBrowseAll: () =>
        window.dispatchEvent(
          new CustomEvent("dt:story-menu-action", {
            detail: { action: "back" },
          })
        ),
      onOpenStory: (storyId: number) =>
        window.dispatchEvent(
          new CustomEvent("dt:open-story", { detail: { storyId } })
        ),
    }),
    [recentStories]
  );
  const utils = trpc.useUtils();
  const timelineEditMut = trpc.creationAgent.timelineEditCommand.useMutation();
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [materialVisible, setMaterialVisible] = useState(false);
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
        // 「把这里改一下」里的「这里」：没有显式选中素材时，就是播放头
        // 停在的那一刻。服务端会把它解析成那一帧真正可见的镜头。
        playheadMs: storySpineStore.getState().playheadMs,
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
        storyMenu={storyMenu}
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
          onToggle: () => {
            setWorkspace(option.id);
          },
        }))}
        panelActions={
          workspace === "editing" && activeStoryId !== null ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={materialVisible}
                aria-controls="editing-material-warehouse"
                onClick={() =>
                  setMaterialVisible(value => {
                    const next = !value;
                    if (next) setTimelineVisible(false);
                    return next;
                  })
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <LibraryBig className="h-3.5 w-3.5" />
                素材仓库
              </button>
              <button
                type="button"
                aria-pressed={timelineVisible}
                onClick={() =>
                  setTimelineVisible(value => {
                    const next = !value;
                    if (next) setMaterialVisible(false);
                    return next;
                  })
                }
                className="inline-flex h-9 items-center rounded-lg border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                style={{ borderColor: "var(--panel-border)" }}
              >
                Timeline
              </button>
              <ExportButton storyId={activeStoryId} />
            </div>
          ) : null
        }
        secondaryRow={
          <DailyAttentionBar onOpen={() => setDailyLetterOpen(true)} />
        }
      />
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
            onTimelineVisibleChange={setTimelineVisible}
            materialVisible={materialVisible}
            onMaterialVisibleChange={setMaterialVisible}
          />
        </StoryAgentProvider>
      </div>
    </div>
  );
}
