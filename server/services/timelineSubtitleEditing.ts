/**
 * The single server writer for the formal subtitle track (U3).
 *
 * Every command runs the same loop: hold the shared timeline edit lock, check
 * the editor session epoch, dedupe by operation id + canonical payload, load
 * the full latest timeline for `storyId + userId`, run a pure planner from
 * `shared/timelineSubtitleModel`, and — only when the planner actually changed
 * something — persist the subtitle slice with one CAS that carries every
 * visual slice through untouched, then record one media undo entry.
 *
 * The client sends object identity + intent only: no `expectedVersion`, no full
 * `subtitleTracks`, no next Story body. The version lives here.
 */
import { createHash, randomUUID } from "node:crypto";
import type { VisualEditOperationRef } from "../../shared/visualEditReceipt";
import type { VisualEditReceipt } from "../../shared/visualEditReceipt";
import {
  deleteSubtitleCue,
  editSubtitleText,
  initializeSubtitleCues,
  mergeSubtitleCue,
  moveSubtitleCue,
  normalizeSubtitleState,
  splitSubtitleCue,
  trimSubtitleCueEnd,
  trimSubtitleCueStart,
  type SubtitleCandidate,
  type SubtitleMergeDirection,
  type SubtitlePlannerResult,
  type TimelineSubtitleState,
} from "../../shared/timelineSubtitleModel";
import {
  loadOwnedStoryTimelineEnvelope,
  saveStoryTimelineExtensionCas,
} from "../persistence/storyVisualPersistence";
import {
  consumeTimelineMediaEditUndo,
  findTimelineMediaEditUndo,
  latestAvailableTimelineMediaEditUndo,
  publicTimelineMediaEditReceipt,
  rebaseLatestTimelineMediaEditUndoAfterVersion,
  recordTimelineMediaEditUndo,
} from "./visualEditUndoJournal";
import { withVisualEditServiceLock } from "./visualClipEditing";
import { isVisualEditSessionEpochAllowed } from "./visualEditSessionRegistry";

const SUBTITLE_SLICE_KEY = "subtitleTracks";
const CONFLICT_RETRY_LIMIT = 1;

export type TimelineMediaCommandResult =
  | {
      status: "ok";
      timelineVersion: number;
      changed: boolean;
      receipt?: VisualEditReceipt;
    }
  | { status: "error"; error: string; errorKind: "conflict" | "invalid" };

function isVersionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /时间轴版本已更新|时间轴已经更新|故事已经更新/.test(message);
}

function subtitleStateFromExtensions(
  extensions: Record<string, unknown>
): TimelineSubtitleState {
  return normalizeSubtitleState(extensions[SUBTITLE_SLICE_KEY]);
}

type SubtitlePlanner = (
  state: TimelineSubtitleState,
  ids: { next: () => string }
) => SubtitlePlannerResult;

async function runSubtitleCommand(
  input: {
    storyId: number;
    userId: number;
    operation: VisualEditOperationRef;
    commandPayload: unknown;
  },
  planner: SubtitlePlanner
): Promise<TimelineMediaCommandResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, async () => {
    if (
      !isVisualEditSessionEpochAllowed({
        storyId: input.storyId,
        userId: input.userId,
        editorSessionEpoch: input.operation.editorSessionEpoch,
      })
    ) {
      return {
        status: "error",
        error: "这个剪辑会话已经失效，请刷新后重试",
        errorKind: "invalid",
      };
    }

    const commandDigest = createHash("sha256")
      .update(JSON.stringify(input.commandPayload))
      .digest("hex");
    const replay = findTimelineMediaEditUndo({
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
    });
    if (replay) {
      if (replay.commandDigest !== commandDigest) {
        return {
          status: "error",
          error: "操作标识已用于另一条命令",
          errorKind: "invalid",
        };
      }
      if (replay.status !== "available") {
        return {
          status: "error",
          error: "这条操作已经撤销，不能再次重放",
          errorKind: "invalid",
        };
      }
      return {
        status: "ok",
        timelineVersion: replay.afterTimelineVersion,
        changed: true,
        ...("replayOnly" in replay
          ? {}
          : { receipt: publicTimelineMediaEditReceipt(replay) }),
      };
    }

    for (let attempt = 0; ; attempt += 1) {
      const envelope = await loadOwnedStoryTimelineEnvelope({
        storyId: input.storyId,
        userId: input.userId,
      });
      if (!envelope) {
        return {
          status: "error",
          error: "故事或时间线不存在，无法编辑字幕",
          errorKind: "invalid",
        };
      }
      const beforeState = subtitleStateFromExtensions(envelope.extensions);
      const result = planner(beforeState, { next: () => randomUUID() });
      if (result.status === "error") {
        return { status: "error", error: result.message, errorKind: "invalid" };
      }
      if (!result.changed) {
        return {
          status: "ok",
          timelineVersion: envelope.version,
          changed: false,
        };
      }

      try {
        const saved = await saveStoryTimelineExtensionCas({
          storyId: input.storyId,
          userId: input.userId,
          expectedVersion: envelope.version,
          currentItems: envelope.items,
          extensions: { [SUBTITLE_SLICE_KEY]: result.state },
        });
        const receipt = recordTimelineMediaEditUndo({
          storyId: input.storyId,
          userId: input.userId,
          operation: input.operation,
          beforeExtensions: envelope.extensions,
          beforeItems: envelope.items,
          beforeTimelineVersion: envelope.version,
          afterTimelineVersion: saved.version,
          commandDigest,
        });
        return {
          status: "ok",
          timelineVersion: saved.version,
          changed: true,
          receipt: publicTimelineMediaEditReceipt(receipt),
        };
      } catch (error) {
        if (isVersionConflict(error) && attempt < CONFLICT_RETRY_LIMIT) {
          continue;
        }
        if (isVersionConflict(error)) {
          return {
            status: "error",
            error: "别处刚刚也在改这条时间线，请刷新后重试",
            errorKind: "conflict",
          };
        }
        return {
          status: "error",
          error: error instanceof Error ? error.message : "字幕保存失败",
          errorKind: "invalid",
        };
      }
    }
  });
}

// ── Public commands ──────────────────────────────────────────────────────

export function initializeSubtitlesForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  candidates: SubtitleCandidate[];
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "initialize",
        candidates: input.candidates,
      },
    },
    (state, ids) =>
      initializeSubtitleCues(state, {
        candidates: input.candidates.map(candidate => ({
          ...candidate,
          id: ids.next(),
        })),
      })
  );
}

export function editSubtitleTextForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  cueId: string;
  text: string;
  expectedTextRevision: number;
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "edit-text",
        cueId: input.cueId,
        text: input.text,
        expectedTextRevision: input.expectedTextRevision,
      },
    },
    state =>
      editSubtitleText(state, {
        cueId: input.cueId,
        text: input.text,
        expectedTextRevision: input.expectedTextRevision,
      })
  );
}

export function moveSubtitleCueForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  cueId: string;
  toStartFrame: number;
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "move",
        cueId: input.cueId,
        toStartFrame: input.toStartFrame,
      },
    },
    state =>
      moveSubtitleCue(state, {
        cueId: input.cueId,
        toStartFrame: input.toStartFrame,
      })
  );
}

export function trimSubtitleCueForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  cueId: string;
  edge: "start" | "end";
  toFrame: number;
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "trim",
        cueId: input.cueId,
        edge: input.edge,
        toFrame: input.toFrame,
      },
    },
    state =>
      input.edge === "start"
        ? trimSubtitleCueStart(state, {
            cueId: input.cueId,
            toStartFrame: input.toFrame,
          })
        : trimSubtitleCueEnd(state, {
            cueId: input.cueId,
            toEndFrame: input.toFrame,
          })
  );
}

export function splitSubtitleCueForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  cueId: string;
  splitFrame: number;
  caretIndex: number;
  expectedTextRevision: number;
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "split",
        cueId: input.cueId,
        splitFrame: input.splitFrame,
        caretIndex: input.caretIndex,
        expectedTextRevision: input.expectedTextRevision,
      },
    },
    (state, ids) =>
      splitSubtitleCue(state, {
        cueId: input.cueId,
        splitFrame: input.splitFrame,
        caretIndex: input.caretIndex,
        expectedTextRevision: input.expectedTextRevision,
        newCueId: ids.next(),
      })
  );
}

export function mergeSubtitleCueForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  cueId: string;
  direction: SubtitleMergeDirection;
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "merge",
        cueId: input.cueId,
        direction: input.direction,
      },
    },
    state =>
      mergeSubtitleCue(state, {
        cueId: input.cueId,
        direction: input.direction,
      })
  );
}

export function deleteSubtitleCueForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  cueId: string;
}): Promise<TimelineMediaCommandResult> {
  return runSubtitleCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: { kind: "delete", cueId: input.cueId },
    },
    state => deleteSubtitleCue(state, { cueId: input.cueId })
  );
}

/**
 * Undo the newest timeline-media command in this editor session. The client is
 * responsible for global Cmd+Z ordering across visual and media commands; this
 * only restores the media entry it is handed.
 */
export async function undoLatestTimelineMediaEditForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
}): Promise<TimelineMediaCommandResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, async () => {
    if (
      !isVisualEditSessionEpochAllowed({
        storyId: input.storyId,
        userId: input.userId,
        editorSessionEpoch: input.operation.editorSessionEpoch,
      })
    ) {
      return {
        status: "error",
        error: "这个剪辑会话已经失效，不能撤销其中的操作",
        errorKind: "invalid",
      };
    }
    const found = findTimelineMediaEditUndo({
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
    });
    const entry =
      found ??
      latestAvailableTimelineMediaEditUndo({
        storyId: input.storyId,
        userId: input.userId,
        editorSessionEpoch: input.operation.editorSessionEpoch,
      });
    if (!entry) {
      return {
        status: "error",
        error: "没有可撤销的字幕操作",
        errorKind: "invalid",
      };
    }
    if (
      entry.status === "consumed" &&
      entry.undoResultTimelineVersion !== undefined
    ) {
      return {
        status: "ok",
        timelineVersion: entry.undoResultTimelineVersion,
        changed: true,
      };
    }
    if ("replayOnly" in entry) {
      return {
        status: "error",
        error: "这条操作已超出可撤销范围",
        errorKind: "invalid",
      };
    }
    const latest = latestAvailableTimelineMediaEditUndo({
      storyId: input.storyId,
      userId: input.userId,
      editorSessionEpoch: entry.editorSessionEpoch,
    });
    if (entry.status !== "available" || latest !== entry) {
      return {
        status: "error",
        error: "只能撤销当前最新的字幕操作",
        errorKind: "invalid",
      };
    }
    const envelope = await loadOwnedStoryTimelineEnvelope({
      storyId: input.storyId,
      userId: input.userId,
    });
    if (!envelope || envelope.version !== entry.afterTimelineVersion) {
      return {
        status: "error",
        error: "时间线已变化，无法撤销这条字幕操作",
        errorKind: "conflict",
      };
    }
    try {
      const restoredSlices: Record<string, unknown> = {
        [SUBTITLE_SLICE_KEY]:
          entry.beforeExtensions[SUBTITLE_SLICE_KEY] ?? undefined,
      };
      const saved = await saveStoryTimelineExtensionCas({
        storyId: input.storyId,
        userId: input.userId,
        expectedVersion: entry.afterTimelineVersion,
        currentItems: envelope.items,
        extensions: restoredSlices,
      });
      consumeTimelineMediaEditUndo(entry, saved.version);
      rebaseLatestTimelineMediaEditUndoAfterVersion({
        storyId: input.storyId,
        userId: input.userId,
        editorSessionEpoch: entry.editorSessionEpoch,
        afterTimelineVersion: saved.version,
      });
      return { status: "ok", timelineVersion: saved.version, changed: true };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : "撤销失败",
        errorKind: "conflict",
      };
    }
  });
}
