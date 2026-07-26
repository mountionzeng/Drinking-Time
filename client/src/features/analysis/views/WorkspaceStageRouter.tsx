/**
 * WorkspaceStageRouter — Determines whether to show GuidedLanding or WorkspaceLayout.
 * Lives inside StoryAgentProvider so it can access story cards for stage derivation.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useHasStoryWorkspaceData } from "@/features/storyAgent/spine/selectors";
import { trpc } from "@/lib/trpc";
import {
  normalizeEmotionAnalysisProfile,
  type SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";
import GuidedLanding from "./GuidedLanding";
import WorkspaceLayout from "./WorkspaceLayout";
import type { InputTab } from "./WorkspaceLayout";
import type { BackendReference } from "@/features/analysis/types";

interface Props {
  references: BackendReference[];
  currentProjectId: number | null;
  activeInputTab: InputTab;
  setActiveInputTab: (tab: InputTab) => void;
  workspaceStageSticky: boolean;
  setWorkspaceStageSticky: (sticky: boolean) => void;
}

export default function WorkspaceStageRouter(props: Props) {
  const hasStoryData = useHasStoryWorkspaceData();
  const utils = trpc.useUtils();
  const emotionProfileQuery = trpc.emotionAnalysis.getProfile.useQuery(
    undefined,
    {
      retry: false,
    }
  );
  const saveEmotionProfileMut =
    trpc.emotionAnalysis.saveBirthProfile.useMutation();

  const hasData = props.references.length > 0 || hasStoryData;

  const workspaceStage = useMemo(() => {
    if (props.workspaceStageSticky) return "workspace" as const;
    if (hasData) return "workspace" as const;
    return "guided" as const;
  }, [props.workspaceStageSticky, hasData]);

  useEffect(() => {
    if (workspaceStage === "workspace" && !props.workspaceStageSticky) {
      props.setWorkspaceStageSticky(true);
    }
  }, [
    workspaceStage,
    props.workspaceStageSticky,
    props.setWorkspaceStageSticky,
  ]);

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

  const emotionProfile = useMemo(
    () => normalizeEmotionAnalysisProfile(emotionProfileQuery.data, "server"),
    [emotionProfileQuery.data]
  );

  const handleSaveEmotionProfile = useCallback(
    async (input: SaveEmotionAnalysisProfileInput) => {
      const saved = await saveEmotionProfileMut.mutateAsync({
        ...input,
        projectId: props.currentProjectId ?? undefined,
      });
      await utils.emotionAnalysis.getProfile.invalidate();
      return normalizeEmotionAnalysisProfile(saved, "server") ?? undefined;
    },
    [
      props.currentProjectId,
      saveEmotionProfileMut,
      utils.emotionAnalysis.getProfile,
    ]
  );

  if (workspaceStage === "guided") {
    return (
      <GuidedLanding
        onSelectMaterial={() => {
          props.setActiveInputTab("material");
          props.setWorkspaceStageSticky(true);
        }}
        onSelectStory={() => {
          props.setActiveInputTab("story");
          props.setWorkspaceStageSticky(true);
        }}
        emotionProfile={emotionProfile}
        emotionProfileLoading={emotionProfileQuery.isLoading}
        onSaveEmotionProfile={handleSaveEmotionProfile}
      />
    );
  }

  return (
    <WorkspaceLayout activeInputTab={props.activeInputTab} />
  );
}
