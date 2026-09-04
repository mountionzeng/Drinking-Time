/**
 * The single server writer for the five audio tracks and the subtitle ↔
 * narration speech binding (U9).
 *
 * Same loop as the subtitle writer: shared timeline edit lock, session-epoch
 * check, replay dedupe by operation id + canonical payload, load the full
 * latest timeline for `storyId + userId`, run a pure planner from
 * `shared/timelineAudioModel` / `shared/timelineSpeechBinding`, and — only on a
 * real change — persist the affected extension slices with one CAS that carries
 * every visual slice through untouched, then record one media undo entry.
 *
 * The client sends object identity + intent only: no `expectedVersion`, no full
 * `audioTracks`, no next Story body, no filename. `assetId` must resolve to a
 * `ready`, owned StoryAudioAsset before a clip can reference it.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  VisualEditOperationRef,
  VisualEditReceipt,
} from "../../shared/visualEditReceipt";
import {
  deleteAudioClip,
  insertAudioClip,
  moveAudioClip,
  normalizeAudioState,
  reclassifyAudioClip,
  setAudioClipFade,
  setAudioClipGain,
  setAudioClipMuted,
  setAudioTrackGain,
  setAudioTrackMuted,
  trimAudioClipEnd,
  trimAudioClipStart,
  type AudioPlannerResult,
  type AudioTrackKind,
  type TimelineAudioState,
} from "../../shared/timelineAudioModel";
import {
  bindSpeech,
  moveBoundSpeech,
  unbindSpeech,
  type SpeechBindingResult,
} from "../../shared/timelineSpeechBinding";
import {
  normalizeSubtitleState,
  type TimelineSubtitleState,
} from "../../shared/timelineSubtitleModel";
import {
  loadOwnedStoryTimelineEnvelope,
  saveStoryTimelineExtensionCas,
} from "../persistence/storyVisualPersistence";
import { loadReadyStoryAudioAsset } from "./storyAudioAssets";
import {
  findTimelineMediaEditUndo,
  publicTimelineMediaEditReceipt,
  recordTimelineMediaEditUndo,
} from "./visualEditUndoJournal";
import { withVisualEditServiceLock } from "./visualClipEditing";
import { isVisualEditSessionEpochAllowed } from "./visualEditSessionRegistry";

const AUDIO_SLICE_KEY = "audioTracks";
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

function audioStateOf(extensions: Record<string, unknown>): TimelineAudioState {
  return normalizeAudioState(extensions[AUDIO_SLICE_KEY]);
}
function subtitleStateOf(
  extensions: Record<string, unknown>
): TimelineSubtitleState {
  return normalizeSubtitleState(extensions[SUBTITLE_SLICE_KEY]);
}

type SessionGuard =
  | { status: "ok" }
  | { status: "error"; error: string; errorKind: "invalid" };

function guardSession(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
}): SessionGuard {
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
  return { status: "ok" };
}

/**
 * Generic media-command runner. `planner` gets the current slices + an id
 * minter and returns which slices changed. `sliceKeys` says which extension
 * keys this command is allowed to write (visual slices are always carried
 * through by the U1 codec).
 */
async function runMediaCommand(
  input: {
    storyId: number;
    userId: number;
    operation: VisualEditOperationRef;
    commandPayload: unknown;
  },
  planner: (
    slices: {
      audio: TimelineAudioState;
      subtitle: TimelineSubtitleState;
    },
    ids: { next: () => string }
  ) =>
    | {
        status: "ok";
        changed: boolean;
        nextExtensions: Record<string, unknown>;
      }
    | { status: "error"; message: string }
    | Promise<
        | {
            status: "ok";
            changed: boolean;
            nextExtensions: Record<string, unknown>;
          }
        | { status: "error"; message: string }
      >
): Promise<TimelineMediaCommandResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, async () => {
    const session = guardSession(input);
    if (session.status === "error") return session;

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
          error: "故事或时间线不存在，无法编辑音频",
          errorKind: "invalid",
        };
      }
      const planned = await planner(
        {
          audio: audioStateOf(envelope.extensions),
          subtitle: subtitleStateOf(envelope.extensions),
        },
        { next: () => randomUUID() }
      );
      if (planned.status === "error") {
        return {
          status: "error",
          error: planned.message,
          errorKind: "invalid",
        };
      }
      if (!planned.changed) {
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
          extensions: planned.nextExtensions,
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
          error: error instanceof Error ? error.message : "音频保存失败",
          errorKind: "invalid",
        };
      }
    }
  });
}

function audioOnly(result: AudioPlannerResult, base: Record<string, unknown>):
  | { status: "ok"; changed: boolean; nextExtensions: Record<string, unknown> }
  | { status: "error"; message: string } {
  if (result.status === "error") return result;
  return {
    status: "ok",
    changed: result.changed,
    nextExtensions: result.changed
      ? { ...base, [AUDIO_SLICE_KEY]: result.state }
      : base,
  };
}

function bindingResult(
  result: SpeechBindingResult,
  base: Record<string, unknown>
):
  | { status: "ok"; changed: boolean; nextExtensions: Record<string, unknown> }
  | { status: "error"; message: string } {
  if (result.status === "error") return result;
  return {
    status: "ok",
    changed: result.changed,
    nextExtensions: result.changed
      ? {
          ...base,
          [AUDIO_SLICE_KEY]: result.audioState,
          [SUBTITLE_SLICE_KEY]: result.subtitleState,
        }
      : base,
  };
}

// ── Public commands ─────────────────────────────────────────────────────

export type InsertAudioClipCommand = {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  kind: AudioTrackKind;
  assetId: number;
  timelineStartFrame: number;
  sourceInFrame?: number;
  /** Optional explicit end; defaults to the asset's real media length. */
  sourceOutFrame?: number;
  gain?: number;
  linkedVisualSourceId?: string;
};

export async function insertAudioClipForStory(
  input: InsertAudioClipCommand
): Promise<TimelineMediaCommandResult> {
  // Asset ownership + `ready` gate happens BEFORE the CAS loop; a clip can only
  // ever reference a ready asset in the same Story.
  const asset = await loadReadyStoryAudioAsset({
    scope: { storyId: input.storyId, userId: input.userId },
    assetId: input.assetId,
  });
  if (!asset) {
    return {
      status: "error",
      error: "音频资产不存在、不属于本故事，或还没准备好",
      errorKind: "invalid",
    };
  }
  const assetDurationFrames = Math.max(
    1,
    asset.durationFrames ?? 1
  );
  const sourceOutFrame = Math.min(
    assetDurationFrames,
    input.sourceOutFrame ?? assetDurationFrames
  );
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-insert",
        trackKind: input.kind,
        assetId: input.assetId,
        timelineStartFrame: input.timelineStartFrame,
        sourceInFrame: input.sourceInFrame ?? 0,
        sourceOutFrame,
        gain: input.gain ?? 1,
        linkedVisualSourceId: input.linkedVisualSourceId ?? null,
      },
    },
    ({ audio }, ids) =>
      audioOnly(
        insertAudioClip(audio, {
          id: ids.next(),
          kind: input.kind,
          assetId: input.assetId,
          timelineStartFrame: input.timelineStartFrame,
          sourceInFrame: input.sourceInFrame ?? 0,
          sourceOutFrame,
          gain: input.gain,
          ...(input.linkedVisualSourceId
            ? { linkedVisualSourceId: input.linkedVisualSourceId }
            : {}),
        }),
        {}
      )
  );
}

type ClipCommandBase = {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  clipId: string;
};

export function moveAudioClipForStory(
  input: ClipCommandBase & { toStartFrame: number }
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-move",
        clipId: input.clipId,
        toStartFrame: input.toStartFrame,
      },
    },
    ({ audio }) =>
      audioOnly(
        moveAudioClip(audio, {
          clipId: input.clipId,
          toStartFrame: input.toStartFrame,
        }),
        {}
      )
  );
}

export function trimAudioClipForStory(
  input: ClipCommandBase & { edge: "start" | "end"; deltaFrames: number }
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-trim",
        clipId: input.clipId,
        edge: input.edge,
        deltaFrames: input.deltaFrames,
      },
    },
    async ({ audio }) => {
      const result =
        input.edge === "start"
          ? trimAudioClipStart(audio, {
              clipId: input.clipId,
              deltaFrames: input.deltaFrames,
            })
          : trimAudioClipEnd(audio, {
              clipId: input.clipId,
              deltaFrames: input.deltaFrames,
            });
      if (result.status === "error" || !result.changed) {
        return audioOnly(result, {});
      }
      const nextClip = result.state.tracks
        .flatMap(track => track.clips)
        .find(clip => clip.id === input.clipId);
      if (!nextClip) return { status: "error", message: "音频片段不存在" };
      const asset = await loadReadyStoryAudioAsset({
        scope: { storyId: input.storyId, userId: input.userId },
        assetId: nextClip.assetId,
      });
      if (!asset || asset.durationFrames == null) {
        return { status: "error", message: "音频资产不存在或时长不可用" };
      }
      if (nextClip.sourceOutFrame > asset.durationFrames) {
        return { status: "error", message: "裁剪越过素材结尾" };
      }
      return audioOnly(result, {});
    }
  );
}

export function deleteAudioClipForStory(
  input: ClipCommandBase
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: { kind: "audio-delete", clipId: input.clipId },
    },
    ({ audio }) =>
      audioOnly(deleteAudioClip(audio, { clipId: input.clipId }), {})
  );
}

export function reclassifyAudioClipForStory(
  input: ClipCommandBase & { toKind: AudioTrackKind }
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-reclassify",
        clipId: input.clipId,
        toKind: input.toKind,
      },
    },
    ({ audio }) =>
      audioOnly(
        reclassifyAudioClip(audio, {
          clipId: input.clipId,
          toKind: input.toKind,
        }),
        {}
      )
  );
}

export function setAudioClipGainForStory(
  input: ClipCommandBase & { gain: number }
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-gain",
        clipId: input.clipId,
        gain: input.gain,
      },
    },
    ({ audio }) =>
      audioOnly(
        setAudioClipGain(audio, { clipId: input.clipId, gain: input.gain }),
        {}
      )
  );
}

export function setAudioClipMutedForStory(
  input: ClipCommandBase & { muted: boolean }
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-mute",
        clipId: input.clipId,
        muted: input.muted,
      },
    },
    ({ audio }) =>
      audioOnly(
        setAudioClipMuted(audio, {
          clipId: input.clipId,
          muted: input.muted,
        }),
        {}
      )
  );
}

export function setAudioClipFadeForStory(
  input: ClipCommandBase & { fadeInFrames?: number; fadeOutFrames?: number }
): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-fade",
        clipId: input.clipId,
        fadeInFrames: input.fadeInFrames ?? null,
        fadeOutFrames: input.fadeOutFrames ?? null,
      },
    },
    ({ audio }) =>
      audioOnly(
        setAudioClipFade(audio, {
          clipId: input.clipId,
          ...(input.fadeInFrames === undefined
            ? {}
            : { fadeInFrames: input.fadeInFrames }),
          ...(input.fadeOutFrames === undefined
            ? {}
            : { fadeOutFrames: input.fadeOutFrames }),
        }),
        {}
      )
  );
}

export function setAudioTrackMutedForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  kind: AudioTrackKind;
  muted: boolean;
}): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-track-mute",
        trackKind: input.kind,
        muted: input.muted,
      },
    },
    ({ audio }) =>
      audioOnly(
        setAudioTrackMuted(audio, { kind: input.kind, muted: input.muted }),
        {}
      )
  );
}

export function setAudioTrackGainForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  kind: AudioTrackKind;
  gain: number;
}): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "audio-track-gain",
        trackKind: input.kind,
        gain: input.gain,
      },
    },
    ({ audio }) =>
      audioOnly(
        setAudioTrackGain(audio, { kind: input.kind, gain: input.gain }),
        {}
      )
  );
}

// ── Speech binding (writes both slices in one CAS) ───────────────────────

export function bindSpeechForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  subtitleCueId: string;
  narrationClipId: string;
}): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "speech-bind",
        subtitleCueId: input.subtitleCueId,
        narrationClipId: input.narrationClipId,
      },
    },
    ({ audio, subtitle }, ids) =>
      bindingResult(
        bindSpeech(subtitle, audio, {
          subtitleCueId: input.subtitleCueId,
          narrationClipId: input.narrationClipId,
          bindingId: ids.next(),
        }),
        {}
      )
  );
}

export function unbindSpeechForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  bindingId: string;
}): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: { kind: "speech-unbind", bindingId: input.bindingId },
    },
    ({ audio, subtitle }) =>
      bindingResult(
        unbindSpeech(subtitle, audio, { bindingId: input.bindingId }),
        {}
      )
  );
}

export function moveBoundSpeechForStory(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  bindingId: string;
  deltaFrames: number;
}): Promise<TimelineMediaCommandResult> {
  return runMediaCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
      commandPayload: {
        kind: "speech-move",
        bindingId: input.bindingId,
        deltaFrames: input.deltaFrames,
      },
    },
    ({ audio, subtitle }) =>
      bindingResult(
        moveBoundSpeech(subtitle, audio, {
          bindingId: input.bindingId,
          deltaFrames: input.deltaFrames,
        }),
        {}
      )
  );
}

// Undo is unified: the client routes a media Cmd+Z to
// `timelineMedia.undoLatestMediaEdit` -> `undoLatestTimelineMediaEditForStory`
// in timelineSubtitleEditing.ts, which restores every media slice
// (subtitle + audio) from the pre-command snapshot.
export { undoLatestTimelineMediaEditForStory } from "./timelineSubtitleEditing";
