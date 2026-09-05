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
  MAX_LOCAL_AUDIO_BYTES,
  acquireLocalAudioImportPermit,
  importAudioBytes,
} from "../services/storyAudioImport";
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
import {
  adoptStoryNarrationCandidate,
  discardStoryNarrationCandidate,
  generateStoryNarrationCandidate,
  listStoryNarrationCandidates,
  quoteStoryNarration,
} from "../services/storyNarration";
import {
  generateStorySceneAudio,
  quoteStorySceneAudio,
} from "../services/storyAudioGeneration";
import { isVisualEditSessionEpochAllowed } from "../services/visualEditSessionRegistry";

const operationInput = z.object({
  editorSessionEpoch: z.string().min(1).max(80),
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
});

const storyId = z.number().int().positive();
const audioKind = z.enum(AUDIO_TRACK_KINDS);
const gainInput = z.number().min(0).max(4);
const frameDelta = z.number().int();
const cueId = z.string().min(1).max(200);
const clipId = z.string().min(1).max(240);
const frame = z.number().int().min(0);
const generatedAudioKind = z.enum(["music", "ambience", "sfx"]);

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

  /**
   * Import local audio bytes into a managed `ready` asset (U2 staged import).
   * base64 is capped well under the Express body limit; the client never sends
   * a path or URL. Returns the asset id for a follow-up insertAudioClip.
   */
  importLocalAudio: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        fileName: z.string().min(1).max(200),
        mimeType: z.string().max(120).optional(),
        // Base64 is capped to a 16MB source before Buffer allocation.
        fileBase64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_LOCAL_AUDIO_BYTES * 4) / 3) + 4),
        mediaKind: z.enum(["music", "ambience", "sfx"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !isVisualEditSessionEpochAllowed({
          storyId: input.storyId,
          userId: ctx.user.id,
          editorSessionEpoch: input.operation.editorSessionEpoch,
        })
      ) {
        return {
          status: "error" as const,
          error: "这个剪辑会话已经失效，请刷新后重试",
          failureCode: "invalid-session",
        };
      }
      const release = acquireLocalAudioImportPermit(ctx.user.id);
      if (!release) {
        return {
          status: "error" as const,
          error: "当前音频导入较多，请稍后重试",
          failureCode: "import-busy",
        };
      }
      try {
        const bytes = Buffer.from(input.fileBase64, "base64");
        const result = await importAudioBytes({
          scope: { storyId: input.storyId, userId: ctx.user.id },
          operationId: input.operation.operationId,
          sourceKind: "local-upload",
          displayName: input.fileName,
          bytes,
          mediaKind: input.mediaKind ?? "unknown",
          provenance: {
            fileName: input.fileName,
            mimeType: input.mimeType ?? null,
          },
        });
        return result.status === "ready"
          ? {
              status: "ok" as const,
              assetId: result.asset.id,
              durationFrames: result.asset.durationFrames,
              reused: result.reused,
            }
          : {
              status: "error" as const,
              error: result.reason,
              failureCode: result.failureCode,
            };
      } finally {
        release();
      }
    }),

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

  // ── Shot-aware 302 music / ambience / SFX generation ────────────────
  quoteSceneAudio: protectedProcedure
    .input(
      z.object({
        storyId,
        kind: generatedAudioKind,
        targetFrame: frame,
        intent: z.string().trim().max(800).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteStorySceneAudio({
        storyId: input.storyId,
        userId: ctx.user.id,
        kind: input.kind,
        targetFrame: input.targetFrame,
        intent: input.intent,
      })
    ),

  generateSceneAudio: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        quoteToken: z.string().min(40).max(16_000),
      })
    )
    .mutation(({ ctx, input }) => {
      if (
        !isVisualEditSessionEpochAllowed({
          storyId: input.storyId,
          userId: ctx.user.id,
          editorSessionEpoch: input.operation.editorSessionEpoch,
        })
      ) {
        return {
          status: "error" as const,
          message: "这个剪辑会话已经失效，请刷新后重试",
        };
      }
      return generateStorySceneAudio({
        storyId: input.storyId,
        userId: ctx.user.id,
        operation: input.operation,
        quoteToken: input.quoteToken,
      });
    }),

  // ── Narration generation/candidates (U5) ─────────────────────────────
  quoteNarration: protectedProcedure
    .input(z.object({ storyId, subtitleCueId: cueId }))
    .mutation(({ ctx, input }) =>
      quoteStoryNarration({
        storyId: input.storyId,
        userId: ctx.user.id,
        subtitleCueId: input.subtitleCueId,
      })
    ),

  generateNarrationCandidate: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        subtitleCueId: cueId,
        quoteToken: z.string().min(40).max(4096),
      })
    )
    .mutation(({ ctx, input }) => {
      if (
        !isVisualEditSessionEpochAllowed({
          storyId: input.storyId,
          userId: ctx.user.id,
          editorSessionEpoch: input.operation.editorSessionEpoch,
        })
      ) {
        return {
          status: "error" as const,
          message: "这个剪辑会话已经失效，请刷新后重试",
        };
      }
      return generateStoryNarrationCandidate({
        storyId: input.storyId,
        userId: ctx.user.id,
        subtitleCueId: input.subtitleCueId,
        operationId: input.operation.operationId,
        quoteToken: input.quoteToken,
      });
    }),

  narrationCandidates: protectedProcedure
    .input(z.object({ storyId, subtitleCueId: cueId.optional() }))
    .query(({ ctx, input }) =>
      listStoryNarrationCandidates({
        storyId: input.storyId,
        userId: ctx.user.id,
        ...(input.subtitleCueId ? { subtitleCueId: input.subtitleCueId } : {}),
      })
    ),

  adoptNarrationCandidate: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        subtitleCueId: cueId,
        candidateAssetId: z.number().int().positive(),
        expectedTextRevision: z.number().int().min(0),
      })
    )
    .mutation(({ ctx, input }) =>
      adoptStoryNarrationCandidate({
        storyId: input.storyId,
        userId: ctx.user.id,
        subtitleCueId: input.subtitleCueId,
        candidateAssetId: input.candidateAssetId,
        expectedTextRevision: input.expectedTextRevision,
        operation: input.operation,
      })
    ),

  discardNarrationCandidate: protectedProcedure
    .input(
      z.object({
        storyId,
        operation: operationInput,
        candidateAssetId: z.number().int().positive(),
      })
    )
    .mutation(({ ctx, input }) =>
      discardStoryNarrationCandidate({
        storyId: input.storyId,
        userId: ctx.user.id,
        candidateAssetId: input.candidateAssetId,
        operation: input.operation,
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
