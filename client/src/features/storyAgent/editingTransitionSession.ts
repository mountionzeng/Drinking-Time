import type {
  ChatMessage,
  EditingTransitionCandidateReference,
  StoryShot,
} from "./types";

export function applyTransitionStoryResult(
  result: { storyRevision: number; storyShots: unknown },
  setters: {
    setServerRevision: (revision: number) => void;
    setStoryShots: (shots: StoryShot[]) => void;
  }
) {
  setters.setServerRevision(result.storyRevision);
  setters.setStoryShots(result.storyShots as StoryShot[]);
}

export function storyScopeMatches(
  expectedStoryId: number | null,
  currentStoryId: number | null
): boolean {
  return expectedStoryId === currentStoryId;
}

export type StorySessionToken = {
  storyId: number | null;
  scopeEpoch: number;
};

/** Story ID alone cannot distinguish the original A session from A -> B -> A. */
export function storySessionTokenMatches(
  expected: StorySessionToken,
  current: StorySessionToken
): boolean {
  return (
    expected.storyId === current.storyId &&
    expected.scopeEpoch === current.scopeEpoch
  );
}

export function canPersistStoryToActiveScope(
  persistedStoryId: number | null | undefined,
  activeStoryId: number | null
): boolean {
  if (activeStoryId === null) return false;
  if (persistedStoryId == null) return activeStoryId < 0;
  return activeStoryId === persistedStoryId;
}

export function canPersistStorySnapshot(input: {
  snapshotScopeEpoch: number;
  currentScopeEpoch: number;
  persistedStoryId: number | null | undefined;
  activeStoryId: number | null;
}): boolean {
  return (
    input.snapshotScopeEpoch === input.currentScopeEpoch &&
    canPersistStoryToActiveScope(input.persistedStoryId, input.activeStoryId)
  );
}

export function patchEditingTransitionMessages(
  messages: readonly ChatMessage[],
  messageId: string,
  patch: Partial<EditingTransitionCandidateReference>,
  replySuffix?: string
): ChatMessage[] {
  return messages.map(message => {
    if (message.id !== messageId || !message.editingTransitionCandidate) {
      return message;
    }
    const suffix = replySuffix?.trim();
    return {
      ...message,
      content:
        suffix && !message.content.includes(suffix)
          ? `${message.content}\n\n${suffix}`
          : message.content,
      editingTransitionCandidate: {
        ...message.editingTransitionCandidate,
        ...patch,
      },
    };
  });
}

export function editingTransitionAppliedToast(
  placement: EditingTransitionCandidateReference["placement"]
): string {
  if (placement?.kind === "story-shot") {
    return "视频已作为普通镜头放到来源图片上层";
  }
  if (placement?.kind === "timeline-overlay") {
    return "旧版覆盖视频已恢复到时间线";
  }
  return "衔接视频已插入两镜之间";
}
