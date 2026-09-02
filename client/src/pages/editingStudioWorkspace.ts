import type { StoryIntent } from "@/features/storyAgent/intentTypes";
import { STORY_PANELS, type StoryPanel } from "@/features/analysis/storyPanels";

export type StudioWorkspace = "publishing" | StoryPanel | "editing";
export type StudioInteractionMode = "publishing" | "story";

export const STUDIO_WORKSPACE_OPTIONS: ReadonlyArray<{
  id: StudioWorkspace;
  label: string;
}> = [
  { id: "publishing", label: "文字" },
  { id: "editing", label: "图像和声音" },
];

export function isStoryPanelWorkspace(
  workspace: StudioWorkspace
): workspace is StoryPanel {
  return STORY_PANELS.some(panel => panel.id === workspace);
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

/**
 * 剪辑指令必须跟随当前页面已经解析出的故事。
 * spine store 在工作区切换/热更新期间可能短暂还原为空，不能让这段瞬态状态
 * 把本来有效的选区又放回普通聊天。
 */
export function resolveTimelineCommandStoryId(
  requestedStoryId: number | null | undefined,
  activeStoryId: number | null,
  spineStoryId: number | null
): number | null {
  return requestedStoryId ?? activeStoryId ?? spineStoryId;
}
