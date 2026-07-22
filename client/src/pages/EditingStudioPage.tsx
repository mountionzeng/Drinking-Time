/**
 * EditingStudioPage — 剪辑工作室（聊天驱动剪辑，ChatCut 式交互）。
 * 左：小酌创作对话（StoryAgentChat；未打开故事时显示故事列表）
 * 右：故事版镜头 + 动态预览 + 多轨时间轴（共享同一套镜头数据）
 * 复用工作区同一套 Provider 栈与面板组件，只是一个专注剪辑的组合视图。
 */
import {
  Clapperboard,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import TopBar from "@/app/shell/TopBar";
import { useProjectData } from "@/features/analysis/hooks/useProjectData";
import {
  CreationEditorProvider,
  useCreationEditor,
} from "@/features/creationEditor/CreationEditorContext";
import EditingNleWorkspace from "@/features/creationEditor/views/EditingNleWorkspace";
import MaterialWarehousePanel from "@/features/creationEditor/views/MaterialWarehousePanel";
import BeverageAmbience from "@/features/nayin/views/BeverageAmbience";
import { StoryAgentProvider } from "@/features/storyAgent/StoryAgentContext";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useActiveStoryId } from "@/features/storyAgent/spine/selectors";
import StoryAgentChat from "@/features/storyAgent/views/StoryAgentChat";
import StoryListView from "@/features/storyAgent/views/StoryListView";
import { trpc } from "@/lib/trpc";
import { displayShotCode } from "@shared/shotIdentity";
import type { SelectionContext } from "@shared/selectionContext";

function ExportButton({ storyId }: { storyId: number }) {
  const { shots } = useCreationEditor();
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
        const skipped =
          result.skipped.length > 0
            ? `（跳过 ${result.skipped.length} 镜：${result.skipped
                .map(s =>
                  displayShotCode(
                    shots.find(shot => shot.shotNo === s.shotNo) ?? s
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
      className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
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
  const [chatCollapsed, setChatCollapsed] = useState(false);

  useEffect(() => {
    if (activeStoryId !== null && window.innerWidth < 1280) {
      setChatCollapsed(true);
    }
  }, [activeStoryId]);

  return (
    <CreationEditorProvider activeStoryId={activeStoryId}>
      <div className="flex h-full min-h-0">
        {/* 左：小酌创作对话（与工作区同一折叠交互） */}
        <div
          className="relative h-full shrink-0 overflow-hidden border-r transition-[width] duration-200"
          style={{
            width: chatCollapsed ? 48 : "min(340px, 38vw)",
            borderColor: "var(--nayin-border)",
          }}
        >
          <button
            type="button"
            onClick={() => setChatCollapsed(value => !value)}
            className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
            aria-label={chatCollapsed ? "展开小酌" : "折叠小酌"}
            title={chatCollapsed ? "展开小酌" : "折叠小酌"}
          >
            {chatCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
          <div
            className={`h-full ${
              chatCollapsed ? "invisible pointer-events-none" : ""
            }`}
            aria-hidden={chatCollapsed}
          >
            {activeStoryId !== null ? <StoryAgentChat /> : <StoryListView />}
          </div>
        </div>

        {/* 右：剪辑台 */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {activeStoryId !== null ? (
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden"
              data-story-panel="editing-nle"
              aria-label="剪辑工作台"
            >
              <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-3 backdrop-blur">
                <div className="min-w-0">
                  <h1 className="truncate text-xs font-semibold text-foreground">
                    剪辑工作台
                  </h1>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {timelineVisible
                      ? "故事版 · 动态预览 · 多轨时间线"
                      : "故事版 · 动态预览"}
                  </p>
                </div>
                <ExportButton storyId={activeStoryId} />
              </div>
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
              直接在对话里说想怎么剪，小酌会帮你动手。
            </div>
          )}
        </div>
      </div>
    </CreationEditorProvider>
  );
}

export default function EditingStudioPage() {
  const { currentProjectId } = useProjectData();
  const utils = trpc.useUtils();
  const timelineEditMut = trpc.creationAgent.timelineEditCommand.useMutation();
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [materialWarehouseVisible, setMaterialWarehouseVisible] =
    useState(false);

  // 对话驱动剪辑：这句话先交给剪辑代理；接住就执行时间轴操作并刷新剪辑台，
  // 没接住（不是剪辑意图）返回 null，小酌照常聊故事。
  const runEditingCommand = useCallback(
    async (
      instruction: string,
      selectionContext?: Pick<
        SelectionContext,
        | "sourceType"
        | "sourceId"
        | "stableShotId"
        | "shotNo"
        | "videoTakeId"
        | "rangeId"
        | "selection"
      >
    ) => {
      const storyId = storySpineStore.getState().activeStoryId;
      if (storyId == null) return null;
      const result = await timelineEditMut.mutateAsync({
        storyId,
        instruction,
        selectionContext,
      });
      if (!result.handled) return null;
      if (result.appliedCount > 0) {
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
            label: "素材仓库",
            active: materialWarehouseVisible,
            controls: "editing-material-warehouse",
            testId: "topbar-material-warehouse-toggle",
            onToggle: () => setMaterialWarehouseVisible(value => !value),
          },
          {
            label: "时间线",
            active: timelineVisible,
            testId: "topbar-timeline-toggle",
            onToggle: () => setTimelineVisible(value => !value),
          },
        ]}
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
