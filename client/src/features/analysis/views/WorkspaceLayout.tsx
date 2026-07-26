/**
 * WorkspaceLayout — Horizontal-scroll workspace layout.
 * Left: StoryAgentChat (always visible, anchor)
 * Right: scrollable strip of materialWarehouse → storyboard → animatic → promptTable
 */
import StoryAgentChat from "@/features/storyAgent/views/StoryAgentChat";
import StoryListView from "@/features/storyAgent/views/StoryListView";
import StoryCardsBoard from "@/features/storyAgent/views/StoryCardsBoard";
import StoryboardPanel from "@/features/storyAgent/views/StoryboardPanel";
import { CreationEditorProvider } from "@/features/creationEditor/CreationEditorContext";
import AnimaticPanel from "@/features/creationEditor/views/AnimaticPanel";
import MaterialWarehousePanel from "@/features/creationEditor/views/MaterialWarehousePanel";
import PromptTablePanel from "@/features/creationEditor/views/PromptTablePanel";
import { STORY_PANELS, type StoryPanel } from "@/features/analysis/storyPanels";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import {
  useActiveStoryId,
  useVisibleStoryPanels,
} from "@/features/storyAgent/spine/selectors";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { useSelectionCapture } from "@/features/storyAgent/hooks/useSelectionCapture";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

export type InputTab = "material" | "story";

interface WorkspaceLayoutProps {
  activeInputTab: InputTab;
}

export default function WorkspaceLayout({
  activeInputTab,
}: WorkspaceLayoutProps) {
  const activeStoryId = useActiveStoryId();
  const visibleStoryPanels = useVisibleStoryPanels();
  const setVisibleStoryPanels = useStorySpine(
    state => state.setVisibleStoryPanels
  );
  const { setActiveSelection } = useStoryAgentActions();
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const hasOpenStory = activeStoryId !== null;
  useSelectionCapture(setActiveSelection);
  useEffect(() => {
    const openChat = () => setChatCollapsed(false);
    window.addEventListener("dt:open-creation-chat", openChat);
    return () => window.removeEventListener("dt:open-creation-chat", openChat);
  }, []);
  useEffect(() => {
    if (!hasOpenStory || visibleStoryPanels.includes("materialWarehouse")) {
      return;
    }
    const migratedPanels: StoryPanel[] = [
      "materialWarehouse",
      ...visibleStoryPanels.filter(panel => panel !== "storyCards"),
    ];
    setVisibleStoryPanels(migratedPanels);
  }, [hasOpenStory, setVisibleStoryPanels, visibleStoryPanels]);
  const visiblePanelDefs = useMemo(
    () => STORY_PANELS.filter(panel => visibleStoryPanels.includes(panel.id)),
    [visibleStoryPanels]
  );
  const panelDefaultSize =
    visiblePanelDefs.length > 0 ? 100 / visiblePanelDefs.length : 100;
  const panelMinSize = visiblePanelDefs.length >= 4 ? 16 : 22;
  const boardStripMinWidth =
    visiblePanelDefs.length > 0 ? `${visiblePanelDefs.length * 24}rem` : "100%";
  const renderPanel = (panelId: StoryPanel) => {
    switch (panelId) {
      case "materialWarehouse":
        return <MaterialWarehousePanel />;
      case "storyCards":
        return <StoryCardsBoard />;
      case "storyboard":
        return <StoryboardPanel />;
      case "animatic":
        return <AnimaticPanel />;
      case "promptTable":
        return <PromptTablePanel />;
    }
  };

  return (
    <div className="flex-1 min-h-0">
      {activeInputTab === "story" ? (
        <CreationEditorProvider activeStoryId={activeStoryId}>
          <div className="h-full flex min-h-0">
            {/* Left: one story-scoped chat anchor across all creation panels. */}
            <div
              className="relative h-full shrink-0 overflow-hidden border-r transition-[width] duration-200"
              style={{
                width: chatCollapsed ? 48 : "min(320px, 40vw)",
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
                {activeStoryId !== null ? (
                  <StoryAgentChat />
                ) : (
                  <StoryListView />
                )}
              </div>
            </div>

            {/* Right: resizable creation boards */}
            <div className="min-w-0 flex-1 overflow-hidden">
              {!hasOpenStory ? (
                <div
                  className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
                  aria-label="未选择故事"
                >
                  从左侧新建或打开一个故事后，素材仓库、故事版看板、动态分镜和镜头设计表会显示在这里。
                </div>
              ) : visiblePanelDefs.length > 0 ? (
                <div className="h-full min-w-0 overflow-x-auto overflow-y-hidden custom-scrollbar">
                  <ResizablePanelGroup
                    direction="horizontal"
                    autoSaveId="story-creation-board-widths-v2"
                    className="h-full min-h-0"
                    style={{ minWidth: `max(100%, ${boardStripMinWidth})` }}
                  >
                    {visiblePanelDefs.map((panel, index) => (
                      <Fragment key={panel.id}>
                        {index > 0 ? (
                          <ResizableHandle className="creation-board-resize-handle" />
                        ) : null}
                        <ResizablePanel
                          id={panel.id}
                          order={index}
                          defaultSize={panelDefaultSize}
                          minSize={panelMinSize}
                          className="min-w-0"
                        >
                          <div
                            className="h-full min-h-0 overflow-hidden"
                            data-story-panel={panel.id}
                            aria-label={panel.label}
                          >
                            {renderPanel(panel.id)}
                          </div>
                        </ResizablePanel>
                      </Fragment>
                    ))}
                  </ResizablePanelGroup>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  在顶部打开一个看板后，内容会显示在这里。
                </div>
              )}
            </div>
          </div>
        </CreationEditorProvider>
      ) : (
        /* Material tab — keep original simple layout */
        <div className="h-full overflow-auto p-4">
          <div className="text-sm text-muted-foreground">
            素材面板（DropZone）— 此模式暂不使用横向滑动布局
          </div>
        </div>
      )}
    </div>
  );
}
