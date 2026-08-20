export type RecentStoryEntry = {
  storyId: number;
  workspace: "publishing" | "editing";
};

type StoryEntryCandidate = {
  id: number;
  shotCount?: number;
};

export async function refreshRecentStoryListWithRetry(
  refreshStoryList: () => Promise<boolean>,
  isCancelled: () => boolean
): Promise<boolean> {
  for (let attempt = 0; attempt < 2 && !isCancelled(); attempt += 1) {
    if (await refreshStoryList()) return true;
  }
  return false;
}

export function workspaceForStoryStage(
  shotCount: number | undefined
): RecentStoryEntry["workspace"] {
  return (shotCount ?? 0) > 0 ? "editing" : "publishing";
}

export function shouldRouteWorkspaceForStoryTransition(
  previousStoryId: number | null,
  activeStoryId: number | null
): boolean {
  if (activeStoryId === null || previousStoryId === activeStoryId) return false;
  // The first server save replaces the local draft id without changing stories.
  if (previousStoryId === -1 && activeStoryId > 0) return false;
  return true;
}

/**
 * storyList is ordered by updatedAt descending by listUserStories, so its
 * first item is the user's most recently changed story.
 */
export function resolveRecentStoryEntry(
  storyList: readonly StoryEntryCandidate[],
  activeStoryId: number | null
): RecentStoryEntry | null {
  if (activeStoryId !== null) return null;
  const recentStory = storyList[0];
  if (!recentStory) return null;
  return {
    storyId: recentStory.id,
    workspace: workspaceForStoryStage(recentStory.shotCount),
  };
}
