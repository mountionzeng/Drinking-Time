import { beforeEach, describe, expect, it } from "vitest";
import {
  clearVisualEditUndoForTesting,
  recordVisualEditUndo,
} from "./visualEditUndoJournal";

const document = { items: [] };

beforeEach(clearVisualEditUndoForTesting);

describe("visual edit receipt ordering", () => {
  it("starts order independently in every user/Story/session scope", () => {
    const record = (userId: number, storyId: number, epoch: string, operationId: string) =>
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
});
