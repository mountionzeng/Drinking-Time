/**
 * AnalysisWorkspace — Main analysis page view.
 * Composes: BeverageAmbience + TopBar + WorkspaceLayout
 * Mounts StoryAgentProvider with projectId from hook.
 */
import TopBar from "@/app/shell/TopBar";
import BeverageAmbience from "@/features/nayin/views/BeverageAmbience";
import WuxingParticles from "@/features/nayin/views/WuxingParticles";
import AnalysisTimelineDrawer from "@/features/analysis/containers/AnalysisTimelineDrawer";
import { useProjectData } from "@/features/analysis/hooks/useProjectData";
import { useAnalysisOrchestration } from "@/features/analysis/hooks/useAnalysisOrchestration";
import { usePanelState } from "@/features/analysis/hooks/usePanelState";
import { StoryAgentProvider } from "@/features/storyAgent/StoryAgentContext";
import { useActiveStoryId } from "@/features/storyAgent/spine/selectors";
import WorkspaceStageRouter from "./WorkspaceStageRouter";

export default function AnalysisWorkspace() {
  const projectData = useProjectData();
  const panel = usePanelState();
  const analysis = useAnalysisOrchestration(projectData);
  const activeStoryId = useActiveStoryId();

  const openStoryWorkspace = () => {
    panel.setActiveInputTab("story");
  };

  return (
    <div className="h-screen flex flex-col bg-background relative">
      <BeverageAmbience />
      <WuxingParticles />

      <div className="relative z-10 flex flex-col h-full">
        <TopBar
          onStoryPanelToggle={openStoryWorkspace}
          showStoryPanelNav={
            panel.activeInputTab === "story" && activeStoryId !== null
          }
        />

        <StoryAgentProvider
          projectId={projectData.currentProjectId}
          onActiveStoryChange={projectData.setActiveStoryId}
        >
          <WorkspaceStageRouter
            activeInputTab={panel.activeInputTab}
            setActiveInputTab={panel.setActiveInputTab}
          />
        </StoryAgentProvider>
      </div>

      <AnalysisTimelineDrawer
        open={panel.timelineOpen}
        onOpenChange={panel.setTimelineOpen}
        references={projectData.references}
        isActive={analysis.analysisActive || projectData.references.length > 0}
        onPin={projectData.handlePinRef}
        onExclude={projectData.handleExcludeRef}
      />
    </div>
  );
}
