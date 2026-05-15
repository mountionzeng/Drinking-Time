/**
 * AnalysisWorkspace — Main analysis page view.
 * Composes: BeverageAmbience + TopBar + (GuidedLanding | WorkspaceLayout)
 * Mounts StoryAgentProvider with projectId from hook.
 */
import TopBar from '@/app/shell/TopBar';
import BeverageAmbience from '@/features/nayin/views/BeverageAmbience';
import WuxingParticles from '@/features/nayin/views/WuxingParticles';
import AnalysisTimelineDrawer from '@/features/analysis/containers/AnalysisTimelineDrawer';
import { useProjectData } from '@/features/analysis/hooks/useProjectData';
import { useAnalysisOrchestration } from '@/features/analysis/hooks/useAnalysisOrchestration';
import { usePanelState } from '@/features/analysis/hooks/usePanelState';
import { StoryAgentProvider } from '@/features/storyAgent/StoryAgentContext';
import WorkspaceStageRouter from './WorkspaceStageRouter';

export default function AnalysisWorkspace() {
  const projectData = useProjectData();
  const panel = usePanelState();
  const analysis = useAnalysisOrchestration(projectData);

  return (
    <div className="h-screen flex flex-col bg-background relative">
      <BeverageAmbience />
      <WuxingParticles />

      <div className="relative z-10 flex flex-col h-full">
        <TopBar
          projects={projectData.projects}
          currentProjectId={projectData.currentProjectId}
          onSelectProject={projectData.setCurrentProjectId}
        />

        <StoryAgentProvider projectId={projectData.currentProjectId}>
          <WorkspaceStageRouter
            references={projectData.references}
            shots={projectData.shots}
            currentProjectId={projectData.currentProjectId}
            activeInputTab={panel.activeInputTab}
            setActiveInputTab={panel.setActiveInputTab}
            workspaceStageSticky={panel.workspaceStageSticky}
            setWorkspaceStageSticky={panel.setWorkspaceStageSticky}
            analysisActive={analysis.analysisActive}
            analysisQuery={analysis.analysisQuery}
            analysisRunMut={analysis.analysisRunMut}
            handleAnalysisComplete={analysis.handleAnalysisComplete}
            handleRunAnalysis={analysis.handleRunAnalysis}
            onUploadFile={projectData.handleUploadFile}
            onRefreshRefs={projectData.refreshRefs}
          />
        </StoryAgentProvider>
      </div>

      <AnalysisTimelineDrawer
        open={panel.timelineOpen}
        onOpenChange={panel.setTimelineOpen}
        projectId={projectData.currentProjectId}
        references={projectData.references}
        isActive={analysis.analysisActive || projectData.references.length > 0}
        onPin={projectData.handlePinRef}
        onExclude={projectData.handleExcludeRef}
      />
    </div>
  );
}
