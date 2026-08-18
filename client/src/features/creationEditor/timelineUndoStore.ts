import type { StoryTimelineItem } from "@shared/storyMaterial";

const MAX_UNDO_STEPS = 40;
const undoByStory = new Map<number, StoryTimelineItem[][]>();
const undoExecutorByStory = new Map<number, () => Promise<boolean>>();

function cloneTimelineItems(
  items: readonly StoryTimelineItem[]
): StoryTimelineItem[] {
  return items.map(item => ({
    ...item,
    transform: { ...item.transform },
    primaryVideoEdit: item.primaryVideoEdit
      ? {
          ...item.primaryVideoEdit,
          effects: { ...item.primaryVideoEdit.effects },
        }
      : undefined,
    visualClips: item.visualClips?.map(clip => ({
      ...clip,
      effects: clip.effects ? { ...clip.effects } : undefined,
      transform: clip.transform ? { ...clip.transform } : undefined,
    })),
    anchors: item.anchors?.map(anchor => ({ ...anchor })),
  }));
}

function sameTimeline(
  left: readonly StoryTimelineItem[],
  right: readonly StoryTimelineItem[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function recordTimelineUndoSnapshot(
  storyId: number,
  items: readonly StoryTimelineItem[]
): void {
  const stack = undoByStory.get(storyId) ?? [];
  const snapshot = cloneTimelineItems(items);
  if (stack.length > 0 && sameTimeline(stack[stack.length - 1], snapshot)) {
    return;
  }
  stack.push(snapshot);
  if (stack.length > MAX_UNDO_STEPS) {
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  }
  undoByStory.set(storyId, stack);
}

export function takeTimelineUndoSnapshot(
  storyId: number
): StoryTimelineItem[] | null {
  const stack = undoByStory.get(storyId);
  const snapshot = stack?.pop() ?? null;
  if (stack?.length === 0) undoByStory.delete(storyId);
  return snapshot ? cloneTimelineItems(snapshot) : null;
}

export function registerTimelineUndoExecutor(
  storyId: number,
  executor: () => Promise<boolean>
): () => void {
  undoExecutorByStory.set(storyId, executor);
  return () => {
    if (undoExecutorByStory.get(storyId) === executor) {
      undoExecutorByStory.delete(storyId);
    }
  };
}

export async function executeTimelineUndo(
  storyId: number
): Promise<"undone" | "empty" | "unavailable"> {
  const executor = undoExecutorByStory.get(storyId);
  if (!executor) return "unavailable";
  return (await executor()) ? "undone" : "empty";
}

export function clearTimelineUndoForTesting(): void {
  undoByStory.clear();
  undoExecutorByStory.clear();
}
