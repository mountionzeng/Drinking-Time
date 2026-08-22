import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "@shared/storyMaterial";

const MAX_UNDO_STEPS = 40;
export type DeletedStoryShotUndoEntry = {
  kind: "deleted-story-shot";
  deletedShot: Record<string, unknown>;
  deletedIndex: number;
  deletedStableShotId: string;
  expectedRevision: number;
  afterDeleteBody: Record<string, unknown>;
};

export type SplitStoryShotUndoEntry = {
  kind: "split-story-shot";
  splitStableShotId: string;
  beforeStoryBody: Record<string, unknown>;
  beforeTimelineItems: StoryTimelineItem[];
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  restoreShotNo: number;
};

/**
 * 一次时间线撤销要还原的全部东西。只存 items 不够：图层顺序、图层数量和显隐
 * 都在 `visualLayerState` 里，遗留 overlay 的兼容层在 `overlays` 里，
 * 少存一样就会出现「Cmd+Z 之后素材回来了、图层还留在改过的状态」。
 */
export type TimelineUndoSnapshot = {
  items: StoryTimelineItem[];
  visualLayerState?: StoryTimelineVisualLayerState;
  overlays?: StoryTimelineOverlay[];
};

export type CreationEditorUndoEntry =
  | ({ kind: "timeline" } & TimelineUndoSnapshot)
  | DeletedStoryShotUndoEntry
  | SplitStoryShotUndoEntry;

const undoByStory = new Map<number, CreationEditorUndoEntry[]>();
const undoExecutorByStory = new Map<number, () => Promise<boolean>>();
const pendingOperationsByStory = new Map<number, Set<Promise<unknown>>>();

function cloneTimelineItems(
  items: readonly StoryTimelineItem[]
): StoryTimelineItem[] {
  return items.map(item => ({
    ...item,
    transform: { ...item.transform },
    imageTransforms: item.imageTransforms
      ? Object.fromEntries(
          Object.entries(item.imageTransforms).map(([imageId, transform]) => [
            imageId,
            { ...transform },
          ])
        )
      : undefined,
    imageTextOverlays: item.imageTextOverlays
      ? structuredClone(item.imageTextOverlays)
      : undefined,
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
    imageClips: item.imageClips?.map(clip => ({
      ...clip,
      transform: clip.transform ? { ...clip.transform } : undefined,
    })),
    anchors: item.anchors?.map(anchor => ({ ...anchor })),
  }));
}

function cloneTimelineOverlays(
  overlays: readonly StoryTimelineOverlay[]
): StoryTimelineOverlay[] {
  return overlays.map(overlay => ({
    ...overlay,
    transform: { ...overlay.transform },
    effects: overlay.effects ? { ...overlay.effects } : undefined,
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
  items: readonly StoryTimelineItem[],
  extra: {
    visualLayerState?: StoryTimelineVisualLayerState | null;
    overlays?: readonly StoryTimelineOverlay[] | null;
  } = {}
): void {
  const stack = undoByStory.get(storyId) ?? [];
  const snapshot = cloneTimelineItems(items);
  const visualLayerState = extra.visualLayerState
    ? {
        count: extra.visualLayerState.count,
        hidden: [...extra.visualLayerState.hidden],
      }
    : undefined;
  const overlays = extra.overlays
    ? cloneTimelineOverlays(extra.overlays)
    : undefined;
  const latest = stack[stack.length - 1];
  if (
    latest?.kind === "timeline" &&
    sameTimeline(latest.items, snapshot) &&
    JSON.stringify(latest.visualLayerState) === JSON.stringify(visualLayerState) &&
    JSON.stringify(latest.overlays) === JSON.stringify(overlays)
  ) {
    return;
  }
  stack.push({ kind: "timeline", items: snapshot, visualLayerState, overlays });
  if (stack.length > MAX_UNDO_STEPS) {
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  }
  undoByStory.set(storyId, stack);
}

export function recordDeletedStoryShotUndo(
  storyId: number,
  entry: Omit<DeletedStoryShotUndoEntry, "kind">
): void {
  const stack = undoByStory.get(storyId) ?? [];
  stack.push({
    kind: "deleted-story-shot",
    ...entry,
    deletedShot: structuredClone(entry.deletedShot),
    afterDeleteBody: structuredClone(entry.afterDeleteBody),
  });
  if (stack.length > MAX_UNDO_STEPS) {
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  }
  undoByStory.set(storyId, stack);
}

export function recordSplitStoryShotUndo(
  storyId: number,
  entry: Omit<SplitStoryShotUndoEntry, "kind">
): void {
  const stack = undoByStory.get(storyId) ?? [];
  stack.push({
    kind: "split-story-shot",
    ...entry,
    beforeStoryBody: structuredClone(entry.beforeStoryBody),
    beforeTimelineItems: cloneTimelineItems(entry.beforeTimelineItems),
  });
  if (stack.length > MAX_UNDO_STEPS) {
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  }
  undoByStory.set(storyId, stack);
}

export function takeCreationEditorUndoEntry(
  storyId: number
): CreationEditorUndoEntry | null {
  const stack = undoByStory.get(storyId);
  const entry = stack?.pop() ?? null;
  if (stack?.length === 0) undoByStory.delete(storyId);
  if (!entry) return null;
  if (entry.kind === "timeline") {
    return {
      kind: "timeline",
      items: cloneTimelineItems(entry.items),
      visualLayerState: entry.visualLayerState
        ? {
            count: entry.visualLayerState.count,
            hidden: [...entry.visualLayerState.hidden],
          }
        : undefined,
      overlays: entry.overlays
        ? cloneTimelineOverlays(entry.overlays)
        : undefined,
    };
  }
  if (entry.kind === "deleted-story-shot") {
    return {
      ...entry,
      deletedShot: structuredClone(entry.deletedShot),
      afterDeleteBody: structuredClone(entry.afterDeleteBody),
    };
  }
  return {
    ...entry,
    beforeStoryBody: structuredClone(entry.beforeStoryBody),
    beforeTimelineItems: cloneTimelineItems(entry.beforeTimelineItems),
  };
}

export function takeTimelineUndoSnapshot(
  storyId: number
): StoryTimelineItem[] | null {
  const stack = undoByStory.get(storyId);
  const latest = stack?.[stack.length - 1];
  if (latest?.kind !== "timeline") return null;
  const snapshot = stack?.pop();
  if (stack?.length === 0) undoByStory.delete(storyId);
  return snapshot?.kind === "timeline"
    ? cloneTimelineItems(snapshot.items)
    : null;
}

export function shouldHandleCreationEditorUndoShortcut(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  targetIsEditable: boolean;
  repeat: boolean;
}): boolean {
  return (
    !input.defaultPrevented &&
    !input.repeat &&
    !input.shiftKey &&
    !input.altKey &&
    (input.ctrlKey || input.metaKey) &&
    input.key.toLowerCase() === "z" &&
    !input.targetIsEditable
  );
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

export function trackCreationEditorOperation<T>(
  storyId: number,
  operation: Promise<T>
): Promise<T> {
  const pending = pendingOperationsByStory.get(storyId) ?? new Set();
  pending.add(operation);
  pendingOperationsByStory.set(storyId, pending);
  const cleanup = () => {
    pending.delete(operation);
    if (pending.size === 0) pendingOperationsByStory.delete(storyId);
  };
  void operation.then(cleanup, cleanup);
  return operation;
}

export async function waitForCreationEditorOperations(
  storyId: number
): Promise<void> {
  while (pendingOperationsByStory.get(storyId)?.size) {
    await Promise.allSettled(
      Array.from(pendingOperationsByStory.get(storyId)!)
    );
  }
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
  pendingOperationsByStory.clear();
}
