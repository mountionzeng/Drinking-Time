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

const operationInput = z.object({
  editorSessionEpoch: z.string().min(1).max(80),
  operationId: z.string().min(1).max(160),
});

const storyId = z.number().int().positive();
const cueId = z.string().min(1).max(200);
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
