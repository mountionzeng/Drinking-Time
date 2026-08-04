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
import { useCallback, useState } from "react";
import { toast } from "sonner";
import TopBar from "@/app/shell/TopBar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useProjectData } from "@/features/analysis/hooks/useProjectData";
import { CreationEditorProvider } from "@/features/creationEditor/CreationEditorContext";
import EditingNleWorkspace from "@/features/creationEditor/views/EditingNleWorkspace";
import MaterialWarehousePanel from "@/features/creationEditor/views/MaterialWarehousePanel";
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
  useStoryAgentActions,
} from "@/features/storyAgent/StoryAgentContext";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useActiveStoryId } from "@/features/storyAgent/spine/selectors";
import StoryAgentChat from "@/features/storyAgent/views/StoryAgentChat";
import StoryListView from "@/features/storyAgent/views/StoryListView";
import { trpc } from "@/lib/trpc";
import { displayShotCode } from "@shared/shotIdentity";
import type { SelectionContext } from "@shared/selectionContext";
import { editingCapabilityReply } from "@shared/editingActionCapabilities";
import { normalizeEmotionAnalysisProfile } from "@/features/analysis/emotionAnalysis";
import { publicDailyLetterForDate } from "@/features/analysis/publicDailyLetter";
import DailyLetterWelcome from "@/features/analysis/views/DailyLetterWelcome";
import { useAuth } from "@/_core/hooks/useAuth";
import { useNayin } from "@/features/nayin/NayinContext";

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

function EditingStudioBody({
  timelineVisible,
  materialWarehouseVisible,
}: {
  timelineVisible: boolean;
  materialWarehouseVisible: boolean;
}) {
  const activeStoryId = useActiveStoryId();
  const { backToList, createNewStory } = useStoryAgentActions();
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [storyMenuOpen, setStoryMenuOpen] = useState(false);

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
                    setStoryMenuOpen(false);
                    backToList();
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[var(--nayin-accent)]" />
                  回到以前的故事
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStoryMenuOpen(false);
                    createNewStory();
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
              <StoryAgentChat showHeader={false} />
            ) : (
              <StoryListView />
            )}
          </div>
        </div>

        {/* 右：剪辑台 */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {activeStoryId !== null ? (
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden"
              data-story-panel="editing-nle"
              aria-label="Editing workspace"
            >
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <EditingNleWorkspace timelineVisible={timelineVisible} />
                {materialWarehouseVisible ? (
                  <div
                    id="editing-material-warehouse"
                    className="absolute inset-0 z-30 overflow-hidden bg-background"
                    data-story-panel="editing-material-warehouse"
                    aria-label="剪辑素材仓库"
                  >
                    <MaterialWarehousePanel />
                  </div>
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
    </CreationEditorProvider>
  );
}

export default function EditingStudioPage() {
  const { currentProjectId } = useProjectData();
  const activeStoryId = useActiveStoryId();
  const utils = trpc.useUtils();
  const timelineEditMut = trpc.creationAgent.timelineEditCommand.useMutation();
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [materialWarehouseVisible, setMaterialWarehouseVisible] =
    useState(false);
  const [dailyLetterOpen, setDailyLetterOpen] = useState(false);

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
      >
    ) => {
      const storyId = storySpineStore.getState().activeStoryId;
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
    [timelineEditMut, utils]
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <BeverageAmbience />
      <TopBar
        showStoryPanelNav={false}
        panelToggles={[
          {
            label: "Materials",
            active: materialWarehouseVisible,
            controls: "editing-material-warehouse",
            testId: "topbar-material-warehouse-toggle",
            onToggle: () => setMaterialWarehouseVisible(value => !value),
          },
          {
            label: "Timeline",
            active: timelineVisible,
            testId: "topbar-timeline-toggle",
            onToggle: () => setTimelineVisible(value => !value),
          },
        ]}
        panelActions={
          activeStoryId !== null ? (
            <ExportButton storyId={activeStoryId} />
          ) : null
        }
      />
      <DailyAttentionBar onOpen={() => setDailyLetterOpen(true)} />
      <DailyLetterWelcome
        forceOpen={dailyLetterOpen}
        onRequestClose={() => setDailyLetterOpen(false)}
      />
      <div className="relative z-10 min-h-0 flex-1">
        <StoryAgentProvider
          projectId={currentProjectId}
          editingCommandRunner={runEditingCommand}
        >
          <EditingStudioBody
            timelineVisible={timelineVisible}
            materialWarehouseVisible={materialWarehouseVisible}
          />
        </StoryAgentProvider>
      </div>
    </div>
  );
}
