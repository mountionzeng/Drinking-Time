/**
 * WorkspaceStageRouter — Determines whether to show GuidedLanding or WorkspaceLayout.
 * Lives inside StoryAgentProvider so it can access story cards for stage derivation.
 */
import { useEffect, useMemo } from 'react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import GuidedLanding from './GuidedLanding';
import WorkspaceLayout from './WorkspaceLayout';
import type { InputTab } from './WorkspaceLayout';
import type { useAnalysisOrchestration } from '@/features/analysis/hooks/useAnalysisOrchestration';
import type { useProjectData } from '@/features/analysis/hooks/useProjectData';

type AnalysisReturn = ReturnType<typeof useAnalysisOrchestration>;
type ProjectReturn = ReturnType<typeof useProjectData>;

interface Props {
  references: ProjectReturn['references'];
  currentProjectId: ProjectReturn['currentProjectId'];
  activeInputTab: InputTab;
  setActiveInputTab: (tab: InputTab) => void;
  workspaceStageSticky: boolean;
  setWorkspaceStageSticky: (sticky: boolean) => void;
  analysisActive: AnalysisReturn['analysisActive'];
  analysisQuery: AnalysisReturn['analysisQuery'];
  analysisRunMut: AnalysisReturn['analysisRunMut'];
  handleAnalysisComplete: AnalysisReturn['handleAnalysisComplete'];
  handleRunAnalysis: AnalysisReturn['handleRunAnalysis'];
  onUploadFile: ProjectReturn['handleUploadFile'];
  onRefreshRefs: ProjectReturn['refreshRefs'];
}

export default function WorkspaceStageRouter(props: Props) {
  const { cards } = useStoryAgent();

  const hasData = props.references.length > 0 || cards.length > 0;

  const workspaceStage = useMemo(() => {
    if (props.workspaceStageSticky) return 'workspace' as const;
    if (hasData) return 'workspace' as const;
    return 'guided' as const;
  }, [props.workspaceStageSticky, hasData]);

  useEffect(() => {
    if (workspaceStage === 'workspace' && !props.workspaceStageSticky) {
      props.setWorkspaceStageSticky(true);
    }
  }, [workspaceStage, props.workspaceStageSticky, props.setWorkspaceStageSticky]);

  if (workspaceStage === 'guided') {
    return (
      <GuidedLanding
        onSelectMaterial={() => {
          props.setActiveInputTab('material');
          props.setWorkspaceStageSticky(true);
        }}
        onSelectStory={() => {
          props.setActiveInputTab('story');
          props.setWorkspaceStageSticky(true);
        }}
      />
    );
  }

  return (
    <WorkspaceLayout
      activeInputTab={props.activeInputTab}
      onTabChange={props.setActiveInputTab}
      projectId={props.currentProjectId}
      onAnalysisComplete={props.handleAnalysisComplete}
      onRunAnalysis={props.handleRunAnalysis}
      isAnalyzing={props.analysisRunMut.isPending}
      onUploadFile={props.onUploadFile}
      onRefreshRefs={props.onRefreshRefs}
      analysisActive={props.analysisActive}
      analysis={props.analysisQuery.data ?? null}
      refsCount={props.references.length}
    />
  );
}
