/**
 * Narrow domain commands for non-visual timeline media (subtitles in U3, audio
 * in U9). Each procedure takes object identity + intent only: no
 * `expectedVersion`, no full `subtitleTracks`/`items` array, no next Story
 * body. `userId` is injected from the session; the service owns the version,
 * the CAS, and the undo receipt.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  MIN_SUBTITLE_CUE_FRAMES,
  type SubtitleProvenance,
} from "../../shared/timelineSubtitleModel";
import {
  deleteSubtitleCueForStory,
  editSubtitleTextForStory,
  initializeSubtitlesForStory,
  mergeSubtitleCueForStory,
  moveSubtitleCueForStory,
  splitSubtitleCueForStory,
  trimSubtitleCueForStory,
  undoLatestTimelineMediaEditForStory,
} from "../services/timelineSubtitleEditing";
import { AUDIO_TRACK_KINDS } from "../../shared/timelineAudioModel";
import {
  bindSpeechForStory,
  deleteAudioClipForStory,
  insertAudioClipForStory,
  moveAudioClipForStory,
  moveBoundSpeechForStory,
  reclassifyAudioClipForStory,
  setAudioClipFadeForStory,
  setAudioClipGainForStory,
  setAudioClipMutedForStory,
  setAudioTrackGainForStory,
  setAudioTrackMutedForStory,
  trimAudioClipForStory,
  unbindSpeechForStory,
} from "../services/timelineAudioEditing";

const operationInput = z.object({
  editorSessionEpoch: z.string().min(1).max(80),
  operationId: z.string().min(1).max(160),
});

const storyId = z.number().int().positive();
const audioKind = z.enum(AUDIO_TRACK_KINDS);
const gainInput = z.number().min(0).max(4);
const frameDelta = z.number().int();
const cueId = z.string().min(1).max(200);
const clipId = z.string().min(1).max(240);
const frame = z.number().int().min(0);

const subtitleProvenanceInput: z.ZodType<SubtitleProvenance> = z.union([
  z.object({
    kind: z.literal("shot-dialogue"),
    stableShotId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("chatcut-cue"),
    cueCode: z.string().min(1).max(200),
  }),
  z.object({ kind: z.literal("manual") }),
]);

const subtitleCandidateInput = z.object({
  startFrame: frame,
  durationFrames: z.number().int().min(MIN_SUBTITLE_CUE_FRAMES),
  text: z.string().max(2000),
  provenance: subtitleProvenanceInput,
  sourceTextRevision: z.number().int().min(0),
});

export const timelineMediaRouter = router({
  /** Seed the subtitle track from upstream candidates. No-op once cues exist. */
  initializeSubtitles: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        candidates: z.array(subtitleCandidateInput).max(500),
      })
    )
    .mutation(({ ctx, input }) =>
      initializeSubtitlesForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        candidates: input.candidates,
      })
    ),

  editSubtitleText: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        cueId,
        text: z.string().max(2000),
        expectedTextRevision: z.number().int().min(0),
      })
    )
    .mutation(({ ctx, input }) =>
      editSubtitleTextForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        cueId: input.cueId,
        text: input.text,
        expectedTextRevision: input.expectedTextRevision,
      })
    ),

  moveSubtitleCue: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        cueId,
        toStartFrame: frame,
      })
    )
    .mutation(({ ctx, input }) =>
      moveSubtitleCueForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        cueId: input.cueId,
        toStartFrame: input.toStartFrame,
      })
    ),

  trimSubtitleCue: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        cueId,
        edge: z.enum(["start", "end"]),
        toFrame: frame,
      })
    )
    .mutation(({ ctx, input }) =>
      trimSubtitleCueForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        cueId: input.cueId,
        edge: input.edge,
        toFrame: input.toFrame,
      })
    ),

  splitSubtitleCue: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        cueId,
        splitFrame: frame,
        caretIndex: z.number().int().min(0),
        expectedTextRevision: z.number().int().min(0),
      })
    )
    .mutation(({ ctx, input }) =>
      splitSubtitleCueForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        cueId: input.cueId,
        splitFrame: input.splitFrame,
        caretIndex: input.caretIndex,
        expectedTextRevision: input.expectedTextRevision,
      })
    ),

  mergeSubtitleCue: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        cueId,
        direction: z.enum(["previous", "next"]),
      })
    )
    .mutation(({ ctx, input }) =>
      mergeSubtitleCueForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        cueId: input.cueId,
        direction: input.direction,
      })
    ),

  deleteSubtitleCue: protectedProcedure
    .input(z.object({ storyId, operation: operationInput, cueId }))
    .mutation(({ ctx, input }) =>
      deleteSubtitleCueForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        cueId: input.cueId,
      })
    ),

  // ── Audio (U9) ────────────────────────────────────────────────────────
  insertAudioClip: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        kind: audioKind,
        assetId: z.number().int().positive(),
        timelineStartFrame: frame,
        sourceInFrame: frame.optional(),
        sourceOutFrame: z.number().int().min(1).optional(),
        gain: gainInput.optional(),
        linkedVisualSourceId: z.string().min(1).max(200).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      insertAudioClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        kind: input.kind,
        assetId: input.assetId,
        timelineStartFrame: input.timelineStartFrame,
        ...(input.sourceInFrame === undefined
          ? {}
          : { sourceInFrame: input.sourceInFrame }),
        ...(input.sourceOutFrame === undefined
          ? {}
          : { sourceOutFrame: input.sourceOutFrame }),
        ...(input.gain === undefined ? {} : { gain: input.gain }),
        ...(input.linkedVisualSourceId === undefined
          ? {}
          : { linkedVisualSourceId: input.linkedVisualSourceId }),
      })
    ),

  moveAudioClip: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        clipId,
        toStartFrame: frame,
      })
    )
    .mutation(({ ctx, input }) =>
      moveAudioClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
        toStartFrame: input.toStartFrame,
      })
    ),

  trimAudioClip: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        clipId,
        edge: z.enum(["start", "end"]),
        deltaFrames: frameDelta,
      })
    )
    .mutation(({ ctx, input }) =>
      trimAudioClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
        edge: input.edge,
        deltaFrames: input.deltaFrames,
      })
    ),

  deleteAudioClip: protectedProcedure
    .input(z.object({ storyId, operation: operationInput, clipId }))
    .mutation(({ ctx, input }) =>
      deleteAudioClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
      })
    ),

  reclassifyAudioClip: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        clipId,
        toKind: audioKind,
      })
    )
    .mutation(({ ctx, input }) =>
      reclassifyAudioClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
        toKind: input.toKind,
      })
    ),

  setAudioClipGain: protectedProcedure
    .input(
      z.object({ storyId, operation: operationInput, clipId, gain: gainInput })
    )
    .mutation(({ ctx, input }) =>
      setAudioClipGainForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
        gain: input.gain,
      })
    ),

  setAudioClipMuted: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        clipId,
        muted: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      setAudioClipMutedForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
        muted: input.muted,
      })
    ),

  setAudioClipFade: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        clipId,
        fadeInFrames: z.number().int().min(0).optional(),
        fadeOutFrames: z.number().int().min(0).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      setAudioClipFadeForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        clipId: input.clipId,
        ...(input.fadeInFrames === undefined
          ? {}
          : { fadeInFrames: input.fadeInFrames }),
        ...(input.fadeOutFrames === undefined
          ? {}
          : { fadeOutFrames: input.fadeOutFrames }),
      })
    ),

  setAudioTrackMuted: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        kind: audioKind,
        muted: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      setAudioTrackMutedForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        kind: input.kind,
        muted: input.muted,
      })
    ),

  setAudioTrackGain: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        kind: audioKind,
        gain: gainInput,
      })
    )
    .mutation(({ ctx, input }) =>
      setAudioTrackGainForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        kind: input.kind,
        gain: input.gain,
      })
    ),

  // ── Speech binding (U9) ───────────────────────────────────────────────
  bindSpeech: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        subtitleCueId: cueId,
        narrationClipId: clipId,
      })
    )
    .mutation(({ ctx, input }) =>
      bindSpeechForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        subtitleCueId: input.subtitleCueId,
        narrationClipId: input.narrationClipId,
      })
    ),

  unbindSpeech: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        bindingId: z.string().min(1).max(200),
      })
    )
    .mutation(({ ctx, input }) =>
      unbindSpeechForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        bindingId: input.bindingId,
      })
    ),

  moveBoundSpeech: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        bindingId: z.string().min(1).max(200),
        deltaFrames: frameDelta,
      })
    )
    .mutation(({ ctx, input }) =>
      moveBoundSpeechForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        bindingId: input.bindingId,
        deltaFrames: input.deltaFrames,
      })
    ),

  /** Undo the newest timeline-media command in this editor session. */
  undoLatestMediaEdit: protectedProcedure
    .input(z.object({ storyId, operation: operationInput }))
    .mutation(({ ctx, input }) =>
      undoLatestTimelineMediaEditForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
      })
    ),
});
