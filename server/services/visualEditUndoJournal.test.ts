import { beforeEach, describe, expect, it } from "vitest";
import {
  clearVisualEditUndoForTesting,
  consumeVisualEditUndo,
  findVisualEditUndo,
  latestAvailableVisualEditUndo,
  recordAggregateVisualEditUndo,
  recordVisualEditUndo,
  rebaseLatestVisualEditUndoAfterVersions,
  retireVisualEditUndoScope,
  visualEditUndoDepth,
} from "./visualEditUndoJournal";

const document = { items: [] };

beforeEach(clearVisualEditUndoForTesting);

describe("visual edit receipt ordering", () => {
  it("releases snapshots and operation receipts for a retired epoch", () => {
    const entry = recordAggregateVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "retired", operationId: "aggregate" },
      beforeStoryBody: { shots: [{ id: "large-snapshot" }] },
      before: document,
      beforeStoryRevision: 1,
      afterStoryRevision: 2,
      beforeTimelineVersion: 1,
      afterTimelineVersion: 2,
      commandDigest: "delete",
      identityFingerprint: "shot-a",
    });

    retireVisualEditUndoScope({
      storyId: 10,
      userId: 1,
      editorSessionEpoch: "retired",
    });

    expect(
      visualEditUndoDepth({
        storyId: 10,
        userId: 1,
        editorSessionEpoch: "retired",
      })
    ).toBe(0);
    expect(
      findVisualEditUndo({
        storyId: 10,
        userId: 1,
        operation: {
          editorSessionEpoch: "retired",
          operationId: entry.operationId,
        },
      })
    ).toBeNull();
  });

  it("starts order independently in every user/Story/session scope", () => {
    const record = (
      userId: number,
      storyId: number,
      epoch: string,
      operationId: string
    ) =>
      recordVisualEditUndo({
        storyId,
        userId,
        operation: { editorSessionEpoch: epoch, operationId },
        before: document,
        beforeTimelineVersion: 1,
        afterTimelineVersion: 2,
        commandDigest: operationId,
      });

    expect(record(1, 10, "a", "one").order).toBe(1);
    expect(record(1, 10, "a", "two").order).toBe(2);
    expect(record(2, 10, "a", "other-user").order).toBe(1);
    expect(record(1, 11, "a", "other-story").order).toBe(1);
    expect(record(1, 10, "b", "other-session").order).toBe(1);
  });

  it("keeps timeline and aggregate commands in one LIFO stack", () => {
    recordVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "timeline" },
      before: document,
      beforeTimelineVersion: 1,
      afterTimelineVersion: 2,
      commandDigest: "move",
    });
    const aggregate = recordAggregateVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "aggregate" },
      beforeStoryBody: { shots: [{ id: "shot-a" }] },
      before: document,
      beforeStoryRevision: 7,
      afterStoryRevision: 8,
      beforeTimelineVersion: 2,
      afterTimelineVersion: 3,
      commandDigest: "delete",
      identityFingerprint: "shot-a",
    });
    expect(aggregate.order).toBe(2);
    expect(
      latestAvailableVisualEditUndo({
        storyId: 10,
        userId: 1,
        editorSessionEpoch: "a",
      })
    ).toBe(aggregate);
  });

  it("finds a replay only inside the exact user, Story, and session scope", () => {
    const entry = recordVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "same" },
      before: document,
      beforeTimelineVersion: 1,
      afterTimelineVersion: 2,
      commandDigest: "digest-a",
    });
    expect(
      findVisualEditUndo({
        storyId: 10,
        userId: 1,
        operation: { editorSessionEpoch: "a", operationId: "same" },
      })
    ).toBe(entry);
    expect(entry.commandDigest).toBe("digest-a");
    expect(
      findVisualEditUndo({
        storyId: 10,
        userId: 1,
        operation: { editorSessionEpoch: "b", operationId: "same" },
      })
    ).toBeNull();
    expect(
      findVisualEditUndo({
        storyId: 10,
        userId: 2,
        operation: { editorSessionEpoch: "a", operationId: "same" },
      })
    ).toBeNull();
  });

  it("consumes only after success and rebases the next mixed entry", () => {
    const aggregate = recordAggregateVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "aggregate" },
      beforeStoryBody: { shots: [] },
      before: document,
      beforeStoryRevision: 4,
      afterStoryRevision: 5,
      beforeTimelineVersion: 1,
      afterTimelineVersion: 2,
      commandDigest: "aggregate",
      identityFingerprint: "shot-a",
    });
    const timeline = recordVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "timeline" },
      before: document,
      beforeTimelineVersion: 2,
      afterTimelineVersion: 3,
      commandDigest: "timeline",
    });

    // A failed undo does not call consume and leaves the same head available.
    expect(
      latestAvailableVisualEditUndo({
        storyId: 10,
        userId: 1,
        editorSessionEpoch: "a",
      })
    ).toBe(timeline);
    consumeVisualEditUndo(timeline, { timelineVersion: 4, storyRevision: 5 });
    rebaseLatestVisualEditUndoAfterVersions({
      storyId: 10,
      userId: 1,
      editorSessionEpoch: "a",
      afterTimelineVersion: 4,
      afterStoryRevision: 5,
    });
    expect(aggregate.afterTimelineVersion).toBe(4);
    expect(aggregate.afterStoryRevision).toBe(5);
    expect(
      latestAvailableVisualEditUndo({
        storyId: 10,
        userId: 1,
        editorSessionEpoch: "a",
      })
    ).toBe(aggregate);
  });

  it("deep-clones both aggregate snapshots", () => {
    const body = { shots: [{ id: "shot-a" }] };
    const before = { items: [{ id: "item-a" }] } as any;
    const entry = recordAggregateVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "aggregate" },
      beforeStoryBody: body,
      before,
      beforeStoryRevision: 1,
      afterStoryRevision: 2,
      beforeTimelineVersion: 3,
      afterTimelineVersion: 4,
      commandDigest: "x",
      identityFingerprint: "shot-a",
    });
    body.shots[0]!.id = "mutated";
    before.items[0].id = "mutated";
    expect((entry.beforeStoryBody as typeof body).shots[0]!.id).toBe("shot-a");
    expect((entry.before.items[0] as any).id).toBe("item-a");
  });

  it("keeps an operation idempotency index after its undo step is evicted", () => {
    for (let index = 0; index < 401; index += 1) {
      recordVisualEditUndo({
        storyId: 10,
        userId: 1,
        operation: {
          editorSessionEpoch: "a",
          operationId: `operation-${index}`,
        },
        before: document,
        beforeTimelineVersion: index,
        afterTimelineVersion: index + 1,
        commandDigest: `digest-${index}`,
      });
    }
    const evicted = findVisualEditUndo({
      storyId: 10,
      userId: 1,
      operation: { editorSessionEpoch: "a", operationId: "operation-0" },
    });
    expect(evicted?.commandDigest).toBe("digest-0");
    expect(evicted?.undoEvicted).toBe(true);
    expect(evicted && "replayOnly" in evicted).toBe(true);
    expect(evicted && "before" in evicted).toBe(false);
  });
});
