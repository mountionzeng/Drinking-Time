import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryTimelineItem,
} from "@shared/storyMaterial";
import {
  clearTimelineUndoForTesting,
  executeTimelineUndo,
  recordTimelineUndoSnapshot,
  registerTimelineUndoExecutor,
  takeTimelineUndoSnapshot,
} from "./timelineUndoStore";

function timeline(durationMs: number): StoryTimelineItem[] {
  return [
    {
      stableShotId: "shot-a",
      included: true,
      position: 0,
      plannedDurationMs: durationMs,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    },
  ];
}

beforeEach(clearTimelineUndoForTesting);

describe("timelineUndoStore", () => {
  it("returns snapshots in reverse operation order", () => {
    recordTimelineUndoSnapshot(7, timeline(1_000));
    recordTimelineUndoSnapshot(7, timeline(2_000));

    expect(takeTimelineUndoSnapshot(7)?.[0].plannedDurationMs).toBe(2_000);
    expect(takeTimelineUndoSnapshot(7)?.[0].plannedDurationMs).toBe(1_000);
    expect(takeTimelineUndoSnapshot(7)).toBeNull();
  });

  it("clones nested edits so later mutations cannot corrupt undo", () => {
    const source = timeline(1_000);
    recordTimelineUndoSnapshot(7, source);
    source[0].transform.rotationDeg = 180;

    expect(takeTimelineUndoSnapshot(7)?.[0].transform.rotationDeg).toBe(0);
  });

  it("lets chat call the same registered undo executor as the editor", async () => {
    const unregister = registerTimelineUndoExecutor(7, async () => true);

    await expect(executeTimelineUndo(7)).resolves.toBe("undone");
    unregister();
    await expect(executeTimelineUndo(7)).resolves.toBe("unavailable");
  });

  it("reports an empty history without pretending an edit was reverted", async () => {
    registerTimelineUndoExecutor(7, async () => false);

    await expect(executeTimelineUndo(7)).resolves.toBe("empty");
  });
});
