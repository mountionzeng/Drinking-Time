import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "@shared/storyMaterial";
import type { VisualEditReceipt } from "@shared/visualEditReceipt";

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

export type InsertedStoryShotUndoEntry = {
  kind: "inserted-story-shot";
  insertedStableShotId: string;
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

/**
 * 走服务端命令的编辑只记服务端 receipt，不保存文档副本。尚未迁移的旧命令
 * 仍允许一个无身份占位，由旧的服务端 LIFO 撤销兜底。
 *
 * 回退内容住在服务端的撤销日志里（visualEditUndoJournal），客户端不再持有
 * 也不再写回任何 items 数组——那本来就是一个整份写入口。
 * 之所以还要占这一格，是为了让它和 deleted-story-shot 这类还没迁走的撤销项
 * 保持同一个先后顺序：用户按 Cmd+Z 的顺序必须和他操作的顺序一致。
 */
export type TimelineCommandUndoEntry = {
  kind: "timeline-command";
  receipt?: VisualEditReceipt;
};

export type CreationEditorUndoEntry =
  | ({ kind: "timeline" } & TimelineUndoSnapshot)
  | TimelineCommandUndoEntry
  | DeletedStoryShotUndoEntry
  | InsertedStoryShotUndoEntry
  | SplitStoryShotUndoEntry;

const undoByStory = new Map<number, CreationEditorUndoEntry[]>();
const activeUndoEpochByStory = new Map<number, string>();
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
    JSON.stringify(latest.visualLayerState) ===
      JSON.stringify(visualLayerState) &&
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

/** 记一格服务端命令；真正的回退内容在服务端。 */
export function recordTimelineCommandUndo(
  storyId: number,
  receipt?: VisualEditReceipt
): void {
  if (
    receipt &&
    receipt.editorSessionEpoch !== "legacy" &&
    activeUndoEpochByStory.get(storyId) !== receipt.editorSessionEpoch
  )
    return;
  const stack = undoByStory.get(storyId) ?? [];
  if (receipt?.status !== undefined && receipt.status !== "available") return;
  if (
    receipt &&
    stack.some(
      entry =>
        entry.kind === "timeline-command" &&
        entry.receipt?.editorSessionEpoch === receipt.editorSessionEpoch &&
        entry.receipt.operationId === receipt.operationId
    )
  )
    return;
  stack.push({
    kind: "timeline-command",
    ...(receipt ? { receipt: { ...receipt } } : {}),
  });
  if (stack.length > MAX_UNDO_STEPS) {
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  }
  undoByStory.set(storyId, stack);
}

/** A newly committed Story session never inherits undo history from an older tab/session. */
export function clearTimelineUndoForStory(storyId: number): void {
  undoByStory.delete(storyId);
}

export function activateTimelineUndoSession(
  storyId: number,
  editorSessionEpoch: string
): void {
  if (activeUndoEpochByStory.get(storyId) === editorSessionEpoch) return;
  undoByStory.delete(storyId);
  activeUndoEpochByStory.set(storyId, editorSessionEpoch);
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

export function recordInsertedStoryShotUndo(
  storyId: number,
  insertedStableShotId: string
): void {
  const stack = undoByStory.get(storyId) ?? [];
  stack.push({ kind: "inserted-story-shot", insertedStableShotId });
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
  if (entry.kind === "timeline-command") {
    return {
      kind: "timeline-command",
      ...(entry.receipt ? { receipt: { ...entry.receipt } } : {}),
    };
  }
  if (entry.kind === "inserted-story-shot") return { ...entry };
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
  activeUndoEpochByStory.clear();
  undoExecutorByStory.clear();
  pendingOperationsByStory.clear();
}
