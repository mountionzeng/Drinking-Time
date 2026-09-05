import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleMediaCommandResult,
  type MediaCommandResult,
} from "./useTimelineMediaController";
import {
  clearTimelineUndoForTesting,
  activateTimelineUndoSession,
  recordTimelineCommandUndo,
  takeCreationEditorUndoEntry,
} from "../timelineUndoStore";

const RECEIPT = {
  editorSessionEpoch: "tab-a",
  operationId: "op-1",
  storyId: 7,
  beforeTimelineVersion: 3,
  afterTimelineVersion: 4,
  status: "available" as const,
  order: 1,
  kind: "timeline" as const,
};

beforeEach(clearTimelineUndoForTesting);

describe("handleMediaCommandResult", () => {
  function deps() {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    return {
      onChanged,
      recordUndo: (storyId: number, receipt: unknown) => {
        // route through the real store so the media tag is exercised
        recordTimelineCommandUndo(
          storyId,
          receipt as Parameters<typeof recordTimelineCommandUndo>[1],
          "media"
        );
      },
      setError: vi.fn(),
    };
  }

  it("records exactly one media-tagged undo slot and refetches on a real change", async () => {
    activateTimelineUndoSession(7, "tab-a");
    const d = deps();
    const result: MediaCommandResult = {
      status: "ok",
      changed: true,
      timelineVersion: 4,
      receipt: RECEIPT,
    };

    const outcome = await handleMediaCommandResult(7, result, d);

    expect(outcome).toMatchObject({
      recorded: true,
      refetched: true,
      error: null,
    });
    expect(d.onChanged).toHaveBeenCalledTimes(1);
    expect(d.setError).not.toHaveBeenCalled();
    const entry = takeCreationEditorUndoEntry(7);
    expect(entry).toMatchObject({ kind: "timeline-command", domain: "media" });
  });

  it("records nothing and does not refetch on a no-op", async () => {
    activateTimelineUndoSession(7, "tab-a");
    const d = deps();
    const outcome = await handleMediaCommandResult(
      7,
      {
        status: "ok",
        changed: false,
        timelineVersion: 4,
      },
      d
    );

    expect(outcome).toMatchObject({ recorded: false, refetched: false });
    expect(d.onChanged).not.toHaveBeenCalled();
    expect(takeCreationEditorUndoEntry(7)).toBeNull();
  });

  it("surfaces an error and records nothing", async () => {
    activateTimelineUndoSession(7, "tab-a");
    const d = deps();
    const outcome = await handleMediaCommandResult(
      7,
      {
        status: "error",
        error: "字幕文字已被改动，请重新加载后再编辑",
        errorKind: "invalid",
      },
      d
    );

    expect(outcome.error).toBe("字幕文字已被改动，请重新加载后再编辑");
    expect(d.setError).toHaveBeenCalledWith(
      "字幕文字已被改动，请重新加载后再编辑"
    );
    expect(d.onChanged).not.toHaveBeenCalled();
    expect(takeCreationEditorUndoEntry(7)).toBeNull();
  });

  it("does not invent an undo entry when a changed response lacks its receipt", async () => {
    activateTimelineUndoSession(7, "tab-a");
    const d = deps();
    const outcome = await handleMediaCommandResult(
      7,
      { status: "ok", changed: true, timelineVersion: 4 },
      d
    );
    expect(outcome).toMatchObject({ recorded: false, refetched: true });
    expect(outcome.error).toContain("回执");
    expect(takeCreationEditorUndoEntry(7)).toBeNull();
  });
});
