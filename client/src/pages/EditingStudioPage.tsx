/**
 * EditingStudioPage — 剪辑工作室（聊天驱动剪辑，ChatCut 式交互）。
 * 左：小酌创作对话（StoryAgentChat；未打开故事时显示故事列表）
 * 右：动态分镜剪辑台（AnimaticPanel：预览播放器 + 时间轴 + 素材抽屉 + 一键剪辑）
 * 复用工作区同一套 Provider 栈与面板组件，只是一个专注剪辑的组合视图。
 */
import { Clapperboard, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import TopBar from "@/app/shell/TopBar";
import { useProjectData } from "@/features/analysis/hooks/useProjectData";
import { CreationEditorProvider } from "@/features/creationEditor/CreationEditorContext";
import AnimaticPanel from "@/features/creationEditor/views/AnimaticPanel";
import BeverageAmbience from "@/features/nayin/views/BeverageAmbience";
import { StoryAgentProvider } from "@/features/storyAgent/StoryAgentContext";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useActiveStoryId } from "@/features/storyAgent/spine/selectors";
import StoryAgentChat from "@/features/storyAgent/views/StoryAgentChat";
import StoryListView from "@/features/storyAgent/views/StoryListView";
import { trpc } from "@/lib/trpc";

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
        const skipped =
          result.skipped.length > 0
            ? `（跳过 ${result.skipped.length} 镜：${result.skipped
                .map(s => `SH${String(s.shotNo).padStart(2, "0")}`)
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
      className="absolute right-4 top-3 z-20 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
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

function EditingStudioBody() {
  const activeStoryId = useActiveStoryId();
  const [chatCollapsed, setChatCollapsed] = useState(false);

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
              className="h-full min-h-0 overflow-hidden"
              data-story-panel="animatic"
              aria-label="剪辑台"
            >
              <ExportButton storyId={activeStoryId} />
              <AnimaticPanel />
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

  // 对话驱动剪辑：这句话先交给剪辑代理；接住就执行时间轴操作并刷新剪辑台，
  // 没接住（不是剪辑意图）返回 null，小酌照常聊故事。
  const runEditingCommand = useCallback(
    async (instruction: string) => {
      const storyId = storySpineStore.getState().activeStoryId;
      if (storyId == null) return null;
      const result = await timelineEditMut.mutateAsync({
        storyId,
        instruction,
      });
      if (!result.handled) return null;
      await Promise.all([
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
        utils.storyAgent.storyVideoAssets.invalidate({ storyId }),
      ]);
      return { handled: true as const, reply: result.reply };
    },
    [timelineEditMut, utils]
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <BeverageAmbience />
      <TopBar showStoryPanelNav={false} />
      <div className="relative z-10 min-h-0 flex-1">
        <StoryAgentProvider
          projectId={currentProjectId}
          editingCommandRunner={runEditingCommand}
        >
          <EditingStudioBody />
        </StoryAgentProvider>
      </div>
    </div>
  );
}
