/**
 * The single client entry point for subtitle (U3) and, later, audio (U9)
 * timeline-media commands.
 *
 * It owns selection, a pending/error surface, operation tracking and query
 * invalidation — never a copy of the document. Every command sends object
 * identity + intent with a fresh `operationId`; the server owns the version and
 * the CAS. On a real change it records one client undo slot (tagged `media`) so
 * a single Cmd+Z stack interleaves visual and media edits in operation order.
 */
import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  normalizeSubtitleState as normalizeSubtitleStateModel,
  resolveSubtitleCuesAtFrame as resolveSubtitleCuesAtFrameModel,
  type SubtitleCandidate as SubtitleCandidateModel,
  type SubtitleCue as SubtitleCueModel,
  type SubtitleMergeDirection as SubtitleMergeDirectionModel,
  type TimelineSubtitleState as TimelineSubtitleStateModel,
} from "@shared/timelineSubtitleModel";
import {
  normalizeAudioState as normalizeAudioStateModel,
  resolveAudioClipsAtFrame as resolveAudioClipsAtFrameModel,
  type ActiveAudioClip as ActiveAudioClipModel,
  type AudioTrackKind as AudioTrackKindModel,
  type TimelineAudioState as TimelineAudioStateModel,
} from "@shared/timelineAudioModel";
import { recordTimelineCommandUndo, trackCreationEditorOperation } from "../timelineUndoStore";

export type MediaCommandResult =
  | { status: "ok"; changed: boolean; timelineVersion: number; receipt?: unknown }
  | { status: "error"; error: string; errorKind: "conflict" | "invalid" };

/**
 * Pure reducer for a timeline-media command result. Kept out of the hook so it
 * can be unit-tested without a React renderer: a real change records exactly
 * one client undo slot tagged `media` and triggers a refetch; a no-op records
 * nothing; an error is surfaced and nothing is recorded.
 */
export async function handleMediaCommandResult(
  storyId: number,
  result: MediaCommandResult,
  deps: {
    recordUndo: (storyId: number, receipt: unknown) => void;
    onChanged: () => Promise<unknown> | unknown;
    setError: (message: string) => void;
  }
): Promise<{ recorded: boolean; refetched: boolean; error: string | null }> {
  if (result.status !== "ok") {
    deps.setError(result.error);
    return { recorded: false, refetched: false, error: result.error };
  }
  if (!result.changed) {
    return { recorded: false, refetched: false, error: null };
  }
  deps.recordUndo(storyId, result.receipt);
  await deps.onChanged();
  return { recorded: true, refetched: true, error: null };
}

export type TimelineMediaControllerInput = {
  storyId: number | null;
  editorSessionEpoch: string;
  /** Raw `timeline.extensions` from the story material query. */
  extensions: Record<string, unknown> | undefined;
  /** Called after any command that actually changed the document. */
  onChanged: () => Promise<unknown> | unknown;
};

export type TimelineMediaController = {
  subtitleState: TimelineSubtitleStateModel;
  cues: SubtitleCueModel[];
  selectedCueId: string | null;
  selectCue: (cueId: string | null) => void;
  activeCuesAtFrame: (frame: number) => SubtitleCueModel[];
  pending: boolean;
  lastError: string | null;
  clearError: () => void;
  initializeSubtitles: (candidates: SubtitleCandidateModel[]) => Promise<void>;
  editSubtitleText: (input: {
    cueId: string;
    text: string;
    expectedTextRevision: number;
  }) => Promise<void>;
  moveSubtitleCue: (input: { cueId: string; toStartFrame: number }) => Promise<void>;
  trimSubtitleCue: (input: {
    cueId: string;
    edge: "start" | "end";
    toFrame: number;
  }) => Promise<void>;
  splitSubtitleCue: (input: {
    cueId: string;
    splitFrame: number;
    caretIndex: number;
    expectedTextRevision: number;
  }) => Promise<void>;
  mergeSubtitleCue: (input: {
    cueId: string;
    direction: SubtitleMergeDirectionModel;
  }) => Promise<void>;
  deleteSubtitleCue: (cueId: string) => Promise<void>;

  // ── Audio (U9) ──────────────────────────────────────────────────────
  audioState: TimelineAudioStateModel;
  selectedAudioClipId: string | null;
  selectAudioClip: (clipId: string | null) => void;
  activeAudioAtFrame: (frame: number) => ActiveAudioClipModel[];
  insertAudioClip: (input: {
    kind: AudioTrackKindModel;
    assetId: number;
    timelineStartFrame: number;
    sourceInFrame?: number;
    sourceOutFrame?: number;
    gain?: number;
    linkedVisualSourceId?: string;
  }) => Promise<void>;
  moveAudioClip: (input: { clipId: string; toStartFrame: number }) => Promise<void>;
  trimAudioClip: (input: {
    clipId: string;
    edge: "start" | "end";
    deltaFrames: number;
  }) => Promise<void>;
  deleteAudioClip: (clipId: string) => Promise<void>;
  reclassifyAudioClip: (input: {
    clipId: string;
    toKind: AudioTrackKindModel;
  }) => Promise<void>;
  setAudioClipGain: (input: { clipId: string; gain: number }) => Promise<void>;
  setAudioClipMuted: (input: { clipId: string; muted: boolean }) => Promise<void>;
  setAudioClipFade: (input: {
    clipId: string;
    fadeInFrames?: number;
    fadeOutFrames?: number;
  }) => Promise<void>;
  setAudioTrackMuted: (input: {
    kind: AudioTrackKindModel;
    muted: boolean;
  }) => Promise<void>;
  setAudioTrackGain: (input: {
    kind: AudioTrackKindModel;
    gain: number;
  }) => Promise<void>;
  bindSpeech: (input: {
    subtitleCueId: string;
    narrationClipId: string;
  }) => Promise<void>;
  unbindSpeech: (bindingId: string) => Promise<void>;
  moveBoundSpeech: (input: {
    bindingId: string;
    deltaFrames: number;
  }) => Promise<void>;
};

function newOperationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useTimelineMediaController(
  input: TimelineMediaControllerInput
): TimelineMediaController {
  const { storyId, editorSessionEpoch, extensions, onChanged } = input;

  const subtitleState = useMemo<TimelineSubtitleStateModel>(
    () => normalizeSubtitleStateModel(extensions?.subtitleTracks),
    [extensions]
  );
  const cues = useMemo(() => subtitleState.tracks[0]?.cues ?? [], [subtitleState]);
  const audioState = useMemo<TimelineAudioStateModel>(
    () => normalizeAudioStateModel(extensions?.audioTracks),
    [extensions]
  );

  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(
    null
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const initMut = trpc.timelineMedia.initializeSubtitles.useMutation();
  const editMut = trpc.timelineMedia.editSubtitleText.useMutation();
  const moveMut = trpc.timelineMedia.moveSubtitleCue.useMutation();
  const trimMut = trpc.timelineMedia.trimSubtitleCue.useMutation();
  const splitMut = trpc.timelineMedia.splitSubtitleCue.useMutation();
  const mergeMut = trpc.timelineMedia.mergeSubtitleCue.useMutation();
  const deleteMut = trpc.timelineMedia.deleteSubtitleCue.useMutation();
  const audioInsertMut = trpc.timelineMedia.insertAudioClip.useMutation();
  const audioMoveMut = trpc.timelineMedia.moveAudioClip.useMutation();
  const audioTrimMut = trpc.timelineMedia.trimAudioClip.useMutation();
  const audioDeleteMut = trpc.timelineMedia.deleteAudioClip.useMutation();
  const audioReclassifyMut = trpc.timelineMedia.reclassifyAudioClip.useMutation();
  const audioGainMut = trpc.timelineMedia.setAudioClipGain.useMutation();
  const audioMutedMut = trpc.timelineMedia.setAudioClipMuted.useMutation();
  const audioFadeMut = trpc.timelineMedia.setAudioClipFade.useMutation();
  const audioTrackMutedMut = trpc.timelineMedia.setAudioTrackMuted.useMutation();
  const audioTrackGainMut = trpc.timelineMedia.setAudioTrackGain.useMutation();
  const bindSpeechMut = trpc.timelineMedia.bindSpeech.useMutation();
  const unbindSpeechMut = trpc.timelineMedia.unbindSpeech.useMutation();
  const moveBoundSpeechMut = trpc.timelineMedia.moveBoundSpeech.useMutation();

  const run = useCallback(
    async (call: () => Promise<MediaCommandResult>): Promise<void> => {
      if (storyId == null) {
        setLastError("故事尚未加载，无法编辑字幕");
        return;
      }
      setPendingCount(count => count + 1);
      setLastError(null);
      try {
        const result = await trackCreationEditorOperation(storyId, call());
        await handleMediaCommandResult(storyId, result, {
          recordUndo: (id, receipt) =>
            recordTimelineCommandUndo(
              id,
              receipt as Parameters<typeof recordTimelineCommandUndo>[1],
              "media"
            ),
          onChanged,
          setError: setLastError,
        });
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "字幕操作失败");
      } finally {
        setPendingCount(count => Math.max(0, count - 1));
      }
    },
    [storyId, onChanged]
  );

  const operation = useCallback(
    () => ({ editorSessionEpoch, operationId: newOperationId() }),
    [editorSessionEpoch]
  );

  return {
    subtitleState,
    cues,
    selectedCueId,
    selectCue: setSelectedCueId,
    activeCuesAtFrame: useCallback(
      (frame: number) => resolveSubtitleCuesAtFrameModel(subtitleState, frame),
      [subtitleState]
    ),
    pending: pendingCount > 0,
    lastError,
    clearError: useCallback(() => setLastError(null), []),
    initializeSubtitles: useCallback(
      (candidates: SubtitleCandidateModel[]) =>
        run(() =>
          initMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            candidates,
          })
        ),
      [run, initMut, storyId, operation]
    ),
    editSubtitleText: useCallback(
      inputArgs =>
        run(() =>
          editMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, editMut, storyId, operation]
    ),
    moveSubtitleCue: useCallback(
      inputArgs =>
        run(() =>
          moveMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, moveMut, storyId, operation]
    ),
    trimSubtitleCue: useCallback(
      inputArgs =>
        run(() =>
          trimMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, trimMut, storyId, operation]
    ),
    splitSubtitleCue: useCallback(
      inputArgs =>
        run(() =>
          splitMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, splitMut, storyId, operation]
    ),
    mergeSubtitleCue: useCallback(
      inputArgs =>
        run(() =>
          mergeMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, mergeMut, storyId, operation]
    ),
    deleteSubtitleCue: useCallback(
      (cueId: string) =>
        run(() =>
          deleteMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            cueId,
          })
        ),
      [run, deleteMut, storyId, operation]
    ),

    audioState,
    selectedAudioClipId,
    selectAudioClip: setSelectedAudioClipId,
    activeAudioAtFrame: useCallback(
      (frame: number) => resolveAudioClipsAtFrameModel(audioState, frame),
      [audioState]
    ),
    insertAudioClip: useCallback(
      inputArgs =>
        run(() =>
          audioInsertMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioInsertMut, storyId, operation]
    ),
    moveAudioClip: useCallback(
      inputArgs =>
        run(() =>
          audioMoveMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioMoveMut, storyId, operation]
    ),
    trimAudioClip: useCallback(
      inputArgs =>
        run(() =>
          audioTrimMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioTrimMut, storyId, operation]
    ),
    deleteAudioClip: useCallback(
      (clipId: string) =>
        run(() =>
          audioDeleteMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            clipId,
          })
        ),
      [run, audioDeleteMut, storyId, operation]
    ),
    reclassifyAudioClip: useCallback(
      inputArgs =>
        run(() =>
          audioReclassifyMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioReclassifyMut, storyId, operation]
    ),
    setAudioClipGain: useCallback(
      inputArgs =>
        run(() =>
          audioGainMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioGainMut, storyId, operation]
    ),
    setAudioClipMuted: useCallback(
      inputArgs =>
        run(() =>
          audioMutedMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioMutedMut, storyId, operation]
    ),
    setAudioClipFade: useCallback(
      inputArgs =>
        run(() =>
          audioFadeMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioFadeMut, storyId, operation]
    ),
    setAudioTrackMuted: useCallback(
      inputArgs =>
        run(() =>
          audioTrackMutedMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioTrackMutedMut, storyId, operation]
    ),
    setAudioTrackGain: useCallback(
      inputArgs =>
        run(() =>
          audioTrackGainMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, audioTrackGainMut, storyId, operation]
    ),
    bindSpeech: useCallback(
      inputArgs =>
        run(() =>
          bindSpeechMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, bindSpeechMut, storyId, operation]
    ),
    unbindSpeech: useCallback(
      (bindingId: string) =>
        run(() =>
          unbindSpeechMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            bindingId,
          })
        ),
      [run, unbindSpeechMut, storyId, operation]
    ),
    moveBoundSpeech: useCallback(
      inputArgs =>
        run(() =>
          moveBoundSpeechMut.mutateAsync({
            storyId: storyId as number,
            operation: operation(),
            ...inputArgs,
          })
        ),
      [run, moveBoundSpeechMut, storyId, operation]
    ),
  };
}
