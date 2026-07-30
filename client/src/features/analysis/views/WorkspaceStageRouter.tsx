/**
 * WorkspaceStageRouter — Keeps the analysis route inside the real workspace.
 * Lives inside StoryAgentProvider so saved stories can select the story tab.
 */
import { useEffect } from "react";
import { useHasStoryWorkspaceData } from "@/features/storyAgent/spine/selectors";
import WorkspaceLayout from "./WorkspaceLayout";
import type { InputTab } from "./WorkspaceLayout";

interface Props {
  activeInputTab: InputTab;
  setActiveInputTab: (tab: InputTab) => void;
}

export default function WorkspaceStageRouter(props: Props) {
  const hasStoryData = useHasStoryWorkspaceData();

  useEffect(() => {
    if (
      hasStoryData &&
      props.activeInputTab !== "story"
    ) {
      props.setActiveInputTab("story");
    }
  }, [
    hasStoryData,
    props.activeInputTab,
    props.setActiveInputTab,
  ]);

  return <WorkspaceLayout activeInputTab={props.activeInputTab} />;
}
