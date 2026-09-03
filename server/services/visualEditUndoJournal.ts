import type { VisualEditDocument } from "../../shared/visualClipModel";
import type {
  VisualEditOperationRef,
  VisualEditReceipt,
} from "../../shared/visualEditReceipt";

/**
 * This journal snapshots the VISUAL document only. Subtitle (U3) and audio
 * (U9) edits get their own entries in this same unified stack. When a visual
 * undo replays its `before` document through the aggregate/timeline CAS, the
 * canonical codec preserves whatever non-visual slices are stored at that
 * moment (see server/persistence/storyTimelinePersistence.ts) — a visual undo
 * never reverts, and never drops, a subtitle or audio slice.
 */

type JournalFields = {
  editorSessionEpoch: string;
  operationId: string;
  storyId: number;
  userId: number;
  status: "available" | "consumed";
  order: number;
  commandDigest: string;
  identityFingerprint: string;
  beforeTimelineVersion: number;
  afterTimelineVersion: number;
  undoResultTimelineVersion?: number;
  undoResultStoryRevision?: number;
  undoEvicted?: boolean;
};
export type TimelineVisualEditUndoEntry = JournalFields & {
  kind: "timeline";
  before: VisualEditDocument;
};
export type AggregateVisualEditUndoEntry = JournalFields & {
  kind: "aggregate";
  beforeStoryBody: unknown;
  before: VisualEditDocument;
  beforeStoryRevision: number;
  afterStoryRevision: number;
  commandResult?: Readonly<Record<string, string>>;
};
export type VisualEditUndoEntry =
  | TimelineVisualEditUndoEntry
  | AggregateVisualEditUndoEntry;

type TimelineVisualEditReplayEntry = Omit<
  TimelineVisualEditUndoEntry,
  "before"
> & { replayOnly: true; undoEvicted: true };
type AggregateVisualEditReplayEntry = Omit<
  AggregateVisualEditUndoEntry,
  "before" | "beforeStoryBody"
> & { replayOnly: true; undoEvicted: true };
export type VisualEditOperationEntry =
  | VisualEditUndoEntry
  | TimelineVisualEditReplayEntry
  | AggregateVisualEditReplayEntry;

const MAX_UNDO_STEPS = 40;
const journalByScope = new Map<string, VisualEditUndoEntry[]>();
const operationIndexByScope = new Map<
  string,
  Map<string, VisualEditOperationEntry>
>();
const scopeKey = (storyId: number, userId: number, epoch: string) =>
  `${userId}:${storyId}:${epoch}`;
const stackFor = (input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
}) =>
  journalByScope.get(
    scopeKey(input.storyId, input.userId, input.editorSessionEpoch)
  ) ?? [];

export function findVisualEditUndo(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
}): VisualEditOperationEntry | null {
  return (
    operationIndexByScope
      .get(
        scopeKey(
          input.storyId,
          input.userId,
          input.operation.editorSessionEpoch
        )
      )
      ?.get(input.operation.operationId) ?? null
  );
}

function replayEntry(entry: VisualEditUndoEntry): VisualEditOperationEntry {
  if (entry.kind === "timeline") {
    const { before: _before, ...withoutTimelineSnapshot } = entry;
    return {
      ...withoutTimelineSnapshot,
      replayOnly: true,
      undoEvicted: true,
    };
  }
  const {
    before: _before,
    beforeStoryBody: _beforeStoryBody,
    ...withoutSnapshots
  } = entry;
  return {
    ...withoutSnapshots,
    replayOnly: true,
    undoEvicted: true,
  };
}

function appendEntry<T extends VisualEditUndoEntry>(
  entry: Omit<T, "order" | "status">
): T {
  const key = scopeKey(entry.storyId, entry.userId, entry.editorSessionEpoch);
  const stack = journalByScope.get(key) ?? [];
  const recorded = {
    ...entry,
    status: "available",
    order: (stack.at(-1)?.order ?? 0) + 1,
  } as T;
  stack.push(recorded);
  if (stack.length > MAX_UNDO_STEPS) {
    for (const evicted of stack.splice(0, stack.length - MAX_UNDO_STEPS)) {
      operationIndexByScope
        .get(key)
        ?.set(evicted.operationId, replayEntry(evicted));
    }
  }
  journalByScope.set(key, stack);
  const index = operationIndexByScope.get(key) ?? new Map();
  index.set(recorded.operationId, recorded);
  operationIndexByScope.set(key, index);
  return recorded;
}

export function recordVisualEditUndo(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  before: VisualEditDocument;
  beforeTimelineVersion: number;
  afterTimelineVersion: number;
  commandDigest: string;
  identityFingerprint?: string;
}): TimelineVisualEditUndoEntry {
  return appendEntry<TimelineVisualEditUndoEntry>({
    kind: "timeline",
    ...input.operation,
    storyId: input.storyId,
    userId: input.userId,
    before: structuredClone(input.before) as VisualEditDocument,
    beforeTimelineVersion: input.beforeTimelineVersion,
    afterTimelineVersion: input.afterTimelineVersion,
    commandDigest: input.commandDigest,
    identityFingerprint: input.identityFingerprint ?? "",
  });
}

export function recordAggregateVisualEditUndo(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  beforeStoryBody: unknown;
  before: VisualEditDocument;
  beforeStoryRevision: number;
  afterStoryRevision: number;
  beforeTimelineVersion: number;
  afterTimelineVersion: number;
  commandDigest: string;
  identityFingerprint: string;
  commandResult?: Readonly<Record<string, string>>;
}): AggregateVisualEditUndoEntry {
  return appendEntry<AggregateVisualEditUndoEntry>({
    kind: "aggregate",
    ...input.operation,
    storyId: input.storyId,
    userId: input.userId,
    beforeStoryBody: structuredClone(input.beforeStoryBody),
    before: structuredClone(input.before) as VisualEditDocument,
    beforeStoryRevision: input.beforeStoryRevision,
    afterStoryRevision: input.afterStoryRevision,
    beforeTimelineVersion: input.beforeTimelineVersion,
    afterTimelineVersion: input.afterTimelineVersion,
    commandDigest: input.commandDigest,
    identityFingerprint: input.identityFingerprint,
    ...(input.commandResult
      ? { commandResult: structuredClone(input.commandResult) }
      : {}),
  });
}

export function latestAvailableVisualEditUndo(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
}): VisualEditUndoEntry | null {
  return (
    [...stackFor(input)]
      .reverse()
      .find(entry => entry.status === "available") ?? null
  );
}

export function publicVisualEditReceipt(
  entry: VisualEditOperationEntry
): VisualEditReceipt {
  const base = {
    editorSessionEpoch: entry.editorSessionEpoch,
    operationId: entry.operationId,
    storyId: entry.storyId,
    beforeTimelineVersion: entry.beforeTimelineVersion,
    afterTimelineVersion: entry.afterTimelineVersion,
    status: entry.status,
    order: entry.order,
  };
  return entry.kind === "aggregate"
    ? {
        ...base,
        kind: "aggregate",
        beforeStoryRevision: entry.beforeStoryRevision,
        afterStoryRevision: entry.afterStoryRevision,
      }
    : { ...base, kind: "timeline" };
}

export function consumeVisualEditUndo(
  entry: VisualEditUndoEntry,
  result: number | { timelineVersion: number; storyRevision?: number }
): void {
  entry.status = "consumed";
  entry.undoResultTimelineVersion =
    typeof result === "number" ? result : result.timelineVersion;
  if (typeof result !== "number" && result.storyRevision !== undefined)
    entry.undoResultStoryRevision = result.storyRevision;
}

export function rebaseLatestVisualEditUndoAfterVersions(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
  afterTimelineVersion: number;
  afterStoryRevision?: number;
}): void {
  const latest = latestAvailableVisualEditUndo(input);
  if (!latest) return;
  latest.afterTimelineVersion = input.afterTimelineVersion;
  if (latest.kind === "aggregate" && input.afterStoryRevision !== undefined)
    latest.afterStoryRevision = input.afterStoryRevision;
}

/** Compatibility wrapper for timeline-only callers. */
export function rebaseLatestVisualEditUndoAfterVersion(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
  afterTimelineVersion: number;
}): void {
  rebaseLatestVisualEditUndoAfterVersions(input);
}

export function visualEditUndoDepth(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch?: string;
}): number {
  if (input.editorSessionEpoch)
    return stackFor({
      ...input,
      editorSessionEpoch: input.editorSessionEpoch,
    }).filter(e => e.status === "available").length;
  let count = 0;
  for (const [key, entries] of journalByScope)
    if (key.startsWith(`${input.userId}:${input.storyId}:`))
      count += entries.filter(e => e.status === "available").length;
  return count;
}

export function retireVisualEditUndoScope(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
}): void {
  const key = scopeKey(input.storyId, input.userId, input.editorSessionEpoch);
  journalByScope.delete(key);
  operationIndexByScope.delete(key);
}

export function clearVisualEditUndoForTesting(): void {
  journalByScope.clear();
  operationIndexByScope.clear();
}
