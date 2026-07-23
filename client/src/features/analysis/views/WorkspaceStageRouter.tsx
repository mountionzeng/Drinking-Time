/**
 * WorkspaceStageRouter — Keeps the analysis route inside the real workspace.
 * Lives inside StoryAgentProvider so saved stories can select the story tab.
 */
import { useEffect } from "react";
import { useStoryAgent } from "@/features/storyAgent/StoryAgentContext";
import WorkspaceLayout from "./WorkspaceLayout";
import type { InputTab } from "./WorkspaceLayout";
import type { useAnalysisOrchestration } from "@/features/analysis/hooks/useAnalysisOrchestration";
import type { useProjectData } from "@/features/analysis/hooks/useProjectData";

type AnalysisReturn = ReturnType<typeof useAnalysisOrchestration>;
type ProjectReturn = ReturnType<typeof useProjectData>;

interface Props {
  references: ProjectReturn["references"];
  currentProjectId: ProjectReturn["currentProjectId"];
  activeInputTab: InputTab;
  setActiveInputTab: (tab: InputTab) => void;
  analysisActive: AnalysisReturn["analysisActive"];
  analysisQuery: AnalysisReturn["analysisQuery"];
  analysisRunMut: AnalysisReturn["analysisRunMut"];
  handleAnalysisComplete: AnalysisReturn["handleAnalysisComplete"];
  handleRunAnalysis: AnalysisReturn["handleRunAnalysis"];
  onUploadFile: ProjectReturn["handleUploadFile"];
  onRefreshRefs: ProjectReturn["refreshRefs"];
}

export default function WorkspaceStageRouter(props: Props) {
  const { activeStoryId, cards, storyList } = useStoryAgent();

  const hasStoryData =
    activeStoryId !== null || cards.length > 0 || storyList.length > 0;

  useEffect(() => {
    if (
      hasStoryData &&
      props.references.length === 0 &&
      props.activeInputTab !== "story"
    ) {
      props.setActiveInputTab("story");
    }
  }, [
    hasStoryData,
    props.activeInputTab,
    props.references.length,
    props.setActiveInputTab,
  ]);

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
