import type { StoryIntent } from "@/features/storyAgent/intentTypes";
import { STORY_PANELS, type StoryPanel } from "@/features/analysis/storyPanels";

export type StudioWorkspace = "publishing" | StoryPanel | "editing";
export type StudioInteractionMode = "publishing" | "story";

export const STUDIO_WORKSPACE_OPTIONS: ReadonlyArray<{
  id: StudioWorkspace;
  label: string;
}> = [
  { id: "publishing", label: "发布稿" },
  ...STORY_PANELS,
  { id: "editing", label: "剪辑台" },
];

export function isStoryPanelWorkspace(
  workspace: StudioWorkspace
): workspace is StoryPanel {
  return STORY_PANELS.some(panel => panel.id === workspace);
}

export function shouldShowPublishingHandoff(
  workspace: StudioWorkspace
): boolean {
  return workspace !== "publishing";
}

export function resolveStudioInteractionMode(
  workspace: StudioWorkspace,
  confirmedIntent: StoryIntent | null
): StudioInteractionMode {
  return workspace === "publishing" &&
    confirmedIntent?.purpose === "social_post"
    ? "publishing"
    : "story";
}
