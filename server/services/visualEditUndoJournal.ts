import type { VisualEditDocument } from "../../shared/visualClipModel";
import type {
  VisualEditOperationRef,
  VisualEditReceipt,
} from "../../shared/visualEditReceipt";

export type VisualEditUndoEntry = Omit<
  VisualEditReceipt,
  "status" | "afterTimelineVersion"
> & {
  status: "available" | "consumed";
  afterTimelineVersion: number;
  userId: number;
  before: VisualEditDocument;
  commandDigest: string;
  undoResultTimelineVersion?: number;
};
const MAX_UNDO_STEPS = 40;
const journalByScope = new Map<string, VisualEditUndoEntry[]>();
const scopeKey = (storyId: number, userId: number, epoch: string) =>
  `${userId}:${storyId}:${epoch}`;

export function findVisualEditUndo(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
}): VisualEditUndoEntry | null {
  return (
    journalByScope
      .get(
        scopeKey(
          input.storyId,
          input.userId,
          input.operation.editorSessionEpoch
        )
      )
      ?.find(entry => entry.operationId === input.operation.operationId) ?? null
  );
}
export function recordVisualEditUndo(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  before: VisualEditDocument;
  beforeTimelineVersion: number;
  afterTimelineVersion: number;
  commandDigest: string;
}): VisualEditUndoEntry {
  const key = scopeKey(
    input.storyId,
    input.userId,
    input.operation.editorSessionEpoch
  );
  const stack = journalByScope.get(key) ?? [];
  const nextOrder = (stack.at(-1)?.order ?? 0) + 1;
  const entry: VisualEditUndoEntry = {
    ...input.operation,
    storyId: input.storyId,
    userId: input.userId,
    before: structuredClone(input.before) as VisualEditDocument,
    beforeTimelineVersion: input.beforeTimelineVersion,
    afterTimelineVersion: input.afterTimelineVersion,
    commandDigest: input.commandDigest,
    status: "available",
    order: nextOrder,
  };
  stack.push(entry);
  if (stack.length > MAX_UNDO_STEPS)
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  journalByScope.set(key, stack);
  return entry;
}
export function latestAvailableVisualEditUndo(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
}): VisualEditUndoEntry | null {
  const stack =
    journalByScope.get(
      scopeKey(input.storyId, input.userId, input.editorSessionEpoch)
    ) ?? [];
  return (
    [...stack].reverse().find(entry => entry.status === "available") ?? null
  );
}
export function consumeVisualEditUndo(
  entry: VisualEditUndoEntry,
  undoResultTimelineVersion: number
): void {
  entry.status = "consumed";
  entry.undoResultTimelineVersion = undoResultTimelineVersion;
}
export function rebaseLatestVisualEditUndoAfterVersion(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
  afterTimelineVersion: number;
}): void {
  const latest = latestAvailableVisualEditUndo(input);
  if (latest) latest.afterTimelineVersion = input.afterTimelineVersion;
}
export function visualEditUndoDepth(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch?: string;
}): number {
  if (input.editorSessionEpoch)
    return (
      journalByScope.get(
        scopeKey(input.storyId, input.userId, input.editorSessionEpoch)
      ) ?? []
    ).filter(e => e.status === "available").length;
  let count = 0;
  for (const [key, entries] of journalByScope)
    if (key.startsWith(`${input.userId}:${input.storyId}:`))
      count += entries.filter(e => e.status === "available").length;
  return count;
}
export function clearVisualEditUndoForTesting(): void {
  journalByScope.clear();
}
