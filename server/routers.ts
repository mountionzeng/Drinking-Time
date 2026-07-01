import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
import { canonicalizeShotNo } from "@shared/imageAsset";
import { shotIdentityFromShot } from "@shared/shotIdentity";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import {
  createProject,
  getOrCreateUserDefaultProject,
  getUserProjects,
  getProjectById,
  createReference,
  getProjectReferences,
  updateReference,
  createShots,
  getStoryShots,
  replaceDirectorShotsForStory,
  updateShot,
  batchUpdateShots,
  createAnalysisResult,
  getProjectAnalysis,
  getEmotionAnalysisProfile,
  upsertEmotionAnalysisProfile,
  listUserStories,
  getStoryById,
  createStory,
  updateStory,
  deleteStory,
  createGeneratedImage,
  getGeneratedImageById,
  createImageSignal,
  promoteStoryImageToCurrent,
  reassignImage,
  deleteGeneratedImage,
  updateStoryTimeline as persistStoryTimeline,
} from "./db";
import { saveSnapshot, getRecentAnnotations } from "./services/editContext";
import { getAlmanacDay } from "./services/almanac";
import type { ProjectState } from "./_core/editDiff";
import { nanoid } from "nanoid";
import {
  replyFromStoryAgent,
  deriveMobileImagePrompt,
  recognizeStoryIntent,
  synthesizeShotList,
  summarizeHistory,
  handleSelectionEdit,
  type SimilarStoryCardPayload,
  type ShotDraft,
  type ShotEntry,
  type StoryCardContextPayload,
  type StoryIntentPayload,
  type VisualAnchorPayload,
} from "./archive/storyAgent";
import {
  replyFromCreationAgent,
  generateNextImage,
  type CreateCharacterFromPhotoToolCall,
  type SetCharacterAnchorToolCall,
  type ShotContext,
} from "./services/creationAgent";
import {
  CREATION_GOALS,
  goalGuidance,
  detectGoalFromText,
} from "./services/creationGoal";
import { segmentAtPoint } from "./services/segmentation";
import {
  editImage as editMobileImage,
  generateDraftImage,
  generateImage as generateMobileImage,
  inpaintImage,
  storeImageBytes,
  toPublicImageUrl,
} from "./services/imageGen";
import { renderViaGate } from "./services/renderGate";
import {
  getProjectImageAssets,
  getStoryImageAssets,
  materializeImageInput,
} from "./services/imageAssets";
import { getStoryVideoAssets } from "./services/videoAssets";
import { getStoryMaterialState } from "./services/storyMaterials";
import {
  analyzeDerivationDraft,
  confirmDerivedShot,
  createDerivationDraft,
  generateDerivedCandidates,
  undoDerivedShot,
} from "./services/shotDerivation";
import {
  refreshVideoTakeStatus,
  startShotVideoJob,
} from "./services/videoJobs";
import { getShotVideoProviderStatus } from "./services/videoGen";
import {
  clearVideoTimelineSegment,
  createUsableVideoRange,
  selectVideoTimelineSegment,
  adoptVideoTake,
} from "./services/videoTimeline";
import { buildScriptResonanceContextForUser } from "./services/scriptAgent";
import { composeScenePrompt } from "./services/composeScenePrompt";
import { withCharacterContinuityPrompt } from "./services/characterContinuity";
import { deriveInjection } from "./services/imageInjection";
import { synthesizeShotPrompt } from "./services/synthesizeShotPrompt";
import { directImagePrompt } from "./services/imagePromptDirector";
import { transcribeAudioBytes } from "./_core/voiceTranscription";
import { analyzeArtReference, createArtRiff } from "./services/artAgent";
import {
  normalizeStoryArtDirection,
  characterReferenceOf,
  defaultArtRecipe,
  type ArtRecipeDNA,
} from "../shared/artDirection";
import {
  getStoryRevision,
  mergeStaleStoryBody,
  prepareStoryBody,
} from "./services/storySync";
import { getActiveStyles } from "./services/styleLibrary";
import { sceneAnalysisSchema } from "../shared/sceneAnalysis";
import {
  type PromptContext,
  buildUnifiedPrompt,
  promptHasStyleRef,
} from "../shared/promptContext";
import { migrateStoryPromptLineage } from "./services/promptLineageMigration";
import {
  confirmPromptCandidateForStory,
  createPromptCandidateForStory,
  getStoryPromptProjection,
  previewPromptCandidateForStory,
  rejectPromptCandidateForStory,
  resolveGenerationPromptCompilation,
  restorePromptRevisionForStory,
} from "./services/promptLineage";
import {
  PromptLineageConflictError,
  PromptLineageOwnershipError,
  PromptLineageValidationError,
} from "./services/promptLineageStore";
import {
  appendStoryConversationTurn,
  listStoryConversation,
} from "./services/storyConversation";
import type { SelectionContext } from "../shared/selectionContext";

type StoryRow = NonNullable<Awaited<ReturnType<typeof getStoryById>>>;

function storyPromptLineageBody(
  story: Pick<StoryRow, "title" | "theme" | "arc" | "body">
): Record<string, unknown> {
  const body =
    story.body && typeof story.body === "object"
      ? { ...(story.body as Record<string, unknown>) }
      : {};
  return {
    ...body,
    title: story.title,
    theme: story.theme,
    arc: story.arc,
  };
}

function shotIdentityForStoryShot(
  story: Pick<StoryRow, "body">,
  shotNo: string | number | null | undefined
): string | null {
  const canonical = canonicalizeShotNo(shotNo);
  if (!canonical) return null;
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    if (!shot || typeof shot !== "object") continue;
    const obj = shot as Record<string, unknown>;
    if (
      canonicalizeShotNo(obj.shotNo as string | number | null | undefined) ===
      canonical
    ) {
      return shotIdentityFromShot(obj, index);
    }
  }
  return null;
}

async function resolveStoryImageCompilationId(params: {
  story: Pick<StoryRow, "id" | "title" | "theme" | "arc" | "body">;
  storyId: number;
  userId: number;
  shotIdentity: string | null;
}): Promise<number | null> {
  if (!params.shotIdentity) return null;
  await migrateStoryPromptLineage({
    storyId: params.story.id,
    userId: params.userId,
    body: storyPromptLineageBody(params.story),
  });
  const resolved = await resolveGenerationPromptCompilation({
    storyId: params.storyId,
    userId: params.userId,
    stableShotId: params.shotIdentity,
    modality: "image",
  });
  return resolved.compilationId;
}

export type ConfirmedScriptIntent = {
  purpose: string;
  audience: string;
  platform: string;
  tone?: string | null;
  desiredEffect?: string | null;
  targetRole?: string | null;
  channel?: string | null;
};

function cleanIntentText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildConfirmedIntentLine(
  confirmedIntent: ConfirmedScriptIntent | null | undefined
): string {
  if (!confirmedIntent) return "";

  const desiredEffect = cleanIntentText(confirmedIntent.desiredEffect);
  const targetRole = cleanIntentText(confirmedIntent.targetRole);
  const channel = cleanIntentText(confirmedIntent.channel);
  const jobDetails =
    confirmedIntent.purpose === "linkedin_job_search" && (targetRole || channel)
      ? [
          targetRole ? `目标岗位=${targetRole}` : "",
          channel ? `投放=${channel}` : "",
          `剧本优先服务${targetRole ? "这个岗位的竞争力" : "求职竞争力"}与${channel ? "该平台的时长/正式度" : "招聘者的阅读效率"}`,
        ].filter(Boolean)
      : [];

  return `【用户已确认意图】用途=${confirmedIntent.purpose}；给谁看=${confirmedIntent.audience}；平台=${confirmedIntent.platform}；调性=${cleanIntentText(confirmedIntent.tone)}${desiredEffect ? `；想要的效果=${desiredEffect}` : ""}${jobDetails.length ? `；${jobDetails.join("；")}` : ""}。剧本的叙事方式、节奏、精致度都严格贴合这个意图。`;
}

function mobileShotNo(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^(?:SH)?0*(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

async function composeStoryWorkspace(
  story: StoryRow,
  userId: number,
  syncConflict = false
) {
  const revision = getStoryRevision(story.body);
  try {
    const assets = await getStoryImageAssets(story.id, userId);
    const mobileImages = assets
      .filter(asset => asset.kind === "story_frame")
      .filter(asset => asset.assignment === "shot")
      .filter(asset => asset.isPrimary)
      .filter(asset => asset.status !== "rejected")
      .filter(asset => asset.availability !== "missing")
      .filter(asset => asset.imageUrl)
      .filter(image => image.imageUrl)
      .map(image => ({
        id: image.id,
        imageUrl: image.imageUrl,
        prompt: image.prompt || "画面",
        shotNo: mobileShotNo(image.canonicalShotNo ?? image.rawShotNo),
        storyId: image.storyId,
        status: "ready" as const,
      }));
    const body =
      story.body && typeof story.body === "object"
        ? (story.body as Record<string, unknown>)
        : {};
    return {
      ...story,
      revision,
      syncConflict,
      body: mobileImages.length > 0 ? { ...body, mobileImages } : body,
    };
  } catch (err) {
    console.warn(
      "[story workspace] 读取 generatedImages 失败，按正文返回：",
      err
    );
    return { ...story, revision, syncConflict };
  }
}

function storyArtRecipe(story: { body: unknown }): ArtRecipeDNA | undefined {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  return direction.phase === "locked" ? direction.recipe : undefined;
}

function artRecipeFromStyleHint(
  styleHint: string | null | undefined
): ArtRecipeDNA | undefined {
  const style = Array.from(
    new Set(
      (styleHint ?? "")
        .split(/[,，;；、\n]/)
        .map(part => part.trim())
        .filter(Boolean)
    )
  ).slice(0, 12);
  if (style.length === 0) return undefined;
  return {
    style,
    palette: [],
    light: [],
    composition: [],
    material: [],
    negative: [],
  };
}

function storyArtReferenceImages(story: { body: unknown }): string[] {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  const selected = direction.references
    .filter(
      reference =>
        reference.selected &&
        reference.imageUrl &&
        (reference.purpose === "fact" || reference.purpose === "both")
    )
    .map(reference => reference.imageUrl!);
  const canvas = Array.isArray(body.visualCanvasItems)
    ? body.visualCanvasItems.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const imageUrl =
          typeof record.originalImageUrl === "string"
            ? record.originalImageUrl
            : typeof record.imageUrl === "string"
              ? record.imageUrl
              : "";
        return imageUrl ? [imageUrl] : [];
      })
    : [];
  return Array.from(new Set([...selected, ...canvas])).slice(0, 4);
}

async function writeCharacterAnchor(
  story: StoryRow,
  userId: number,
  imageUrl: string
) {
  const publicUrl = await toPublicImageUrl(imageUrl);
  if (!publicUrl) {
    return {
      status: "error" as const,
      error: "这张图还不能作为人物锚点：需要可公开访问的图片 URL。",
    };
  }

  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  const now = Date.now();
  const nextDirection = {
    ...direction,
    phase:
      direction.phase === "empty" ? ("references" as const) : direction.phase,
    references: [
      ...direction.references.filter(
        reference => reference.role !== "character"
      ),
      {
        id: `character-${now}`,
        label: "人物锚点",
        source: "visual-anchor" as const,
        purpose: "fact" as const,
        selected: true,
        role: "character" as const,
        imageUrl: publicUrl,
      },
    ],
    updatedAt: now,
  };
  const nextBody = prepareStoryBody(
    {
      ...body,
      artDirection: nextDirection,
    },
    getStoryRevision(story.body) + 1,
    story.body
  );

  await updateStory(story.id, userId, { body: nextBody });
  const saved = await getStoryById(story.id, userId);
  return {
    status: "ok" as const,
    publicUrl,
    story: await composeStoryWorkspace(
      saved ?? { ...story, body: nextBody },
      userId
    ),
  };
}

function artRecipePrompt(recipe: ArtRecipeDNA | undefined): string {
  if (!recipe) return "";
  return [
    recipe.style.length ? `style: ${recipe.style.join(", ")}` : "",
    recipe.palette.length ? `palette: ${recipe.palette.join(", ")}` : "",
    recipe.light.length ? `lighting: ${recipe.light.join(", ")}` : "",
    recipe.composition.length
      ? `composition: ${recipe.composition.join(", ")}`
      : "",
    recipe.material.length ? `materials: ${recipe.material.join(", ")}` : "",
    recipe.negative.length ? `avoid: ${recipe.negative.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function shotStatusFromBeat(beat: string) {
  if (beat === "收束") return "production_ready" as const;
  if (beat === "转折") return "structured" as const;
  return "idea_pool" as const;
}

function shotPriorityFromBeat(beat: string) {
  return beat === "转折" ? ("high" as const) : ("medium" as const);
}

function storyShotToDbRow(params: {
  projectId: number;
  storyId: number;
  userId: number;
  shot: ShotEntry;
  index: number;
}) {
  const { projectId, storyId, userId, shot, index } = params;
  const shotNo = `SH${String(shot.shotNo || index + 1).padStart(2, "0")}`;
  const sceneNo = `SC${String(Math.ceil((index + 1) / 6)).padStart(2, "0")}`;
  const filledFields = [
    shot.subject,
    shot.action,
    shot.dialogue,
    shot.shotType,
    shot.location,
    shot.timeLight,
    shot.mood,
    shot.styleRef,
    shot.promptDraft,
  ].filter(
    value => typeof value === "string" && value.trim().length > 0
  ).length;

  return {
    projectId,
    storyId,
    userId,
    sceneNo,
    shotNo,
    sourceSummary: [shot.beat, shot.sourceCardContent || shot.subject]
      .filter(Boolean)
      .join(" · "),
    intentType: "director_note" as const,
    status: shotStatusFromBeat(shot.beat),
    readinessScore: Math.min(0.95, 0.35 + filledFields * 0.055),
    priority: shotPriorityFromBeat(shot.beat),
    autoRender: false,
    blockingIssues: null,
    nextAction: shot.note || null,
    sceneType: shot.location || shot.beat || null,
    timeOfDay: shot.timeLight || null,
    weather: null,
    lighting: shot.timeLight || null,
    cameraFocalLength: shot.shotType || null,
    cameraMovement: shot.cameraMove || null,
    spatialLayers: shot.cameraAngle || null,
    mood:
      [shot.mood, shot.emotion, shot.emotionDelta]
        .filter(Boolean)
        .join(" / ") || null,
    colorPalette:
      [shot.styleRef, shot.visualAnchorText].filter(Boolean).join(" / ") ||
      null,
    promptDraft:
      shot.promptDraft ||
      [
        shot.subject,
        shot.action,
        shot.location ? `场景：${shot.location}` : "",
        shot.mood ? `情绪：${shot.mood}` : "",
      ]
        .filter(Boolean)
        .join("，"),
    negativePrompt: shot.negativePrompt || "",
  };
}

// ─── Nayin Five Element calculation (server-side) ─────────────────────────

const STEMS = [
  "甲",
  "乙",
  "丙",
  "丁",
  "戊",
  "己",
  "庚",
  "辛",
  "壬",
  "癸",
] as const;
const BRANCHES = [
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
] as const;
type NayinElement = "metal" | "wood" | "water" | "fire" | "earth";
// Traditional 纳音 order for 60 Jiazi (one value per pair, total 30 pairs).
const NAYIN_PAIR_ELEMENTS: NayinElement[] = [
  "metal",
  "fire",
  "wood",
  "earth",
  "metal",
  "fire",
  "water",
  "earth",
  "metal",
  "wood",
  "water",
  "earth",
  "fire",
  "wood",
  "water",
  "metal",
  "fire",
  "wood",
  "earth",
  "metal",
  "fire",
  "water",
  "earth",
  "metal",
  "wood",
  "water",
  "earth",
  "fire",
  "wood",
  "water",
];

function getDayStemBranch(date: Date) {
  // Use UTC-based calculation to avoid timezone issues
  // Reference: 2000-01-07 is 甲子日 (index 0 in the 60-day cycle)
  const refUtc = Date.UTC(2000, 0, 7);
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((dateUtc - refUtc) / 86400000);
  let idx = diffDays % 60;
  if (idx < 0) idx += 60;
  return {
    stem: STEMS[idx % 10],
    branch: BRANCHES[idx % 12],
    ganzhiIndex: idx,
  };
}

function calcNayinByGanzhiIndex(ganzhiIndex: number): NayinElement {
  return NAYIN_PAIR_ELEMENTS[Math.floor(ganzhiIndex / 2)];
}

const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const emotionAnalysisPayloadSchema = z.record(z.string(), z.unknown());

async function ensureStoryPromptLineage(storyId: number, userId: number) {
  const story = await getStoryById(storyId, userId);
  if (!story) {
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  }
  await migrateStoryPromptLineage({
    storyId,
    userId,
    body: storyPromptLineageBody(story),
  });
}

function throwPromptLineageError(error: unknown): never {
  if (error instanceof PromptLineageConflictError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: error.message,
      cause: { currentVersion: error.currentVersion },
    });
  }
  if (
    error instanceof PromptLineageValidationError ||
    error instanceof PromptLineageOwnershipError
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

const selectionRegionSchema = z.union([
  z
    .object({
      kind: z.literal("text"),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .refine(value => value.end >= value.start, {
      message: "文字选区结束位置不能早于开始位置",
    }),
  z
    .object({
      kind: z.literal("rect"),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .refine(value => value.x + value.width <= 1, {
      message: "图片选区不能超出画面宽度",
    })
    .refine(value => value.y + value.height <= 1, {
      message: "图片选区不能超出画面高度",
    }),
  z
    .object({
      kind: z.literal("time"),
      startSec: z.number().nonnegative(),
      endSec: z.number().positive(),
    })
    .refine(value => value.endSec > value.startSec, {
      message: "视频选区结束时间必须晚于开始时间",
    }),
]);

const selectionMaterialStatusSchema = z.enum([
  "current-image",
  "candidate-image",
  "current-video",
  "failed-video",
  "unadopted-video",
  "stale-video",
  "timeline-range",
  "timeline-material",
  "derivation-draft",
  "fallback-image",
  "unknown",
]);

// ─── Router ──────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  promptLineage: router({
    getStoryProjection: protectedProcedure
      .input(z.object({ storyId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
        }
        await migrateStoryPromptLineage({
          storyId: input.storyId,
          userId: ctx.user.id,
          body: storyPromptLineageBody(story),
        });
        const refreshedProjection = await getStoryPromptProjection({
          storyId: input.storyId,
          userId: ctx.user.id,
        });
        return refreshedProjection
          ? { mode: "lineage" as const, projection: refreshedProjection }
          : {
              mode: "legacy" as const,
              projection: null,
              legacyBody: story.body,
            };
      }),

    createCandidate: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          nodeId: z.number().int().positive(),
          targetStableShotId: z.string().trim().min(1).nullable().optional(),
          content: z.string().trim().min(1),
          weight: z.number().min(0).max(1).optional(),
          reason: z.string().trim().nullable().optional(),
          authorType: z.enum(["user", "agent"]).default("user"),
          expectedVersion: z.number().int().nonnegative(),
          operationKey: z.string().trim().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await ensureStoryPromptLineage(input.storyId, ctx.user.id);
          const result = await createPromptCandidateForStory({
            ...input,
            userId: ctx.user.id,
            operationKey: input.operationKey ?? nanoid(),
          });
          return {
            ...result,
            projection: await getStoryPromptProjection({
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        } catch (error) {
          throwPromptLineageError(error);
        }
      }),

    previewCandidate: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          candidateRevisionId: z.number().int().positive(),
        })
      )
      .query(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
        }
        try {
          return await previewPromptCandidateForStory({
            ...input,
            userId: ctx.user.id,
          });
        } catch (error) {
          throwPromptLineageError(error);
        }
      }),

    confirmCandidate: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          candidateRevisionId: z.number().int().positive(),
          expectedVersion: z.number().int().nonnegative(),
          operationKey: z.string().trim().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await confirmPromptCandidateForStory({
            ...input,
            userId: ctx.user.id,
            operationKey: input.operationKey ?? nanoid(),
          });
          return {
            ...result,
            projection: await getStoryPromptProjection({
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        } catch (error) {
          throwPromptLineageError(error);
        }
      }),

    rejectCandidate: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          candidateRevisionId: z.number().int().positive(),
          expectedVersion: z.number().int().nonnegative(),
          operationKey: z.string().trim().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await rejectPromptCandidateForStory({
            ...input,
            userId: ctx.user.id,
            operationKey: input.operationKey ?? nanoid(),
          });
          return {
            ...result,
            projection: await getStoryPromptProjection({
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        } catch (error) {
          throwPromptLineageError(error);
        }
      }),

    restoreRevision: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          revisionId: z.number().int().positive(),
          expectedVersion: z.number().int().nonnegative(),
          operationKey: z.string().trim().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await restorePromptRevisionForStory({
            ...input,
            userId: ctx.user.id,
            operationKey: input.operationKey ?? nanoid(),
          });
          return {
            ...result,
            projection: await getStoryPromptProjection({
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        } catch (error) {
          throwPromptLineageError(error);
        }
      }),

    listRevisionHistory: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          nodeId: z.number().int().positive(),
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const projection = await getStoryPromptProjection({
          storyId: input.storyId,
          userId: ctx.user.id,
        });
        if (!projection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "故事提示词尚未迁移",
          });
        }
        if (!projection.nodes.some(node => node.id === input.nodeId)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "提示词节点不存在",
          });
        }
        const items = projection.revisions
          .filter(
            revision =>
              revision.nodeId === input.nodeId &&
              (input.cursor == null || revision.id < input.cursor)
          )
          .sort((left, right) => right.id - left.id)
          .slice(0, input.limit);
        return {
          items,
          nextCursor:
            items.length === input.limit
              ? (items[items.length - 1]?.id ?? null)
              : null,
        };
      }),
  }),

  storyConversation: router({
    list: protectedProcedure
      .input(z.object({ storyId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
        }
        if (
          !(await getStoryPromptProjection({
            storyId: input.storyId,
            userId: ctx.user.id,
          }))
        ) {
          await ensureStoryPromptLineage(input.storyId, ctx.user.id);
        }
        return listStoryConversation({
          storyId: input.storyId,
          userId: ctx.user.id,
        });
      }),

    appendTurn: protectedProcedure
      .input(
        z.object({
          storyId: z.number().int().positive(),
          userMessage: z.object({
            clientMessageId: z.string().trim().min(1),
            content: z.string().trim().min(1),
            selection: z
              .object({
                sourceType: z.enum([
                  "card",
                  "script-scene",
                  "script-meta",
                  "shot",
                  "storyboard-image",
                  "animatic-video",
                  "timeline-range",
                  "chat",
                ]),
                sourceId: z.string().trim().min(1),
                selectedText: z.string().trim().min(1),
                fullText: z.string(),
                objectVersion: z.string().nullable().optional(),
                selection: selectionRegionSchema.nullable().optional(),
                materialStatus: selectionMaterialStatusSchema.optional(),
                storyId: z.number().int().positive().nullable().optional(),
                stableShotId: z.string().nullable().optional(),
                shotNo: z.number().int().positive().nullable().optional(),
                imageId: z.number().int().positive().nullable().optional(),
                videoTakeId: z.number().int().positive().nullable().optional(),
                rangeId: z.number().int().positive().nullable().optional(),
              })
              .nullable()
              .optional(),
          }),
          assistantMessage: z.object({
            clientMessageId: z.string().trim().min(1),
            content: z.string().trim().min(1),
            candidateRevisionId: z.number().int().positive().nullable().optional(),
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
        }
        if (
          !(await getStoryPromptProjection({
            storyId: input.storyId,
            userId: ctx.user.id,
          }))
        ) {
          await ensureStoryPromptLineage(input.storyId, ctx.user.id);
        }
        try {
          return await appendStoryConversationTurn({
            ...input,
            userId: ctx.user.id,
            userMessage: {
              ...input.userMessage,
              selection:
                (input.userMessage.selection as SelectionContext | null) ??
                null,
            },
          });
        } catch (error) {
          throwPromptLineageError(error);
        }
      }),
  }),

  voice: router({
    transcribe: protectedProcedure
      .input(
        z.object({
          audioBase64: z.string(),
          mimeType: z.string(),
          language: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await transcribeAudioBytes({
          audioBase64: input.audioBase64,
          mimeType: input.mimeType,
          language: input.language ?? "zh",
        });

        if ("error" in result) {
          throw new Error(result.details || result.error);
        }

        return { text: result.text };
      }),
  }),

  // ─── Art Agent / 视觉锚画布 ───────────────────────────────────────
  artAgent: router({
    analyzeReference: protectedProcedure
      .input(
        z.object({
          imageBase64: z.string().min(1),
          mimeType: z.string().optional(),
          fileName: z.string().optional(),
          instruction: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => analyzeArtReference(input)),

    riff: protectedProcedure
      .input(
        z
          .object({
            imageBase64: z.string().optional(),
            imageUrl: z.string().optional(),
            mimeType: z.string().optional(),
            fileName: z.string().optional(),
            instruction: z.string().optional(),
            projectPreference: z.string().optional(),
            previousPrompt: z.string().optional(),
            previousAnalysis: z.record(z.string(), z.unknown()).optional(),
            imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(),
          })
          .refine(value => Boolean(value.imageBase64 || value.imageUrl), {
            message: "imageBase64 or imageUrl is required",
          })
      )
      .mutation(async ({ input }) => {
        return createArtRiff({
          imageBase64: input.imageBase64,
          imageUrl: input.imageUrl,
          mimeType: input.mimeType,
          fileName: input.fileName,
          instruction: input.instruction,
          projectPreference: input.projectPreference,
          previousPrompt: input.previousPrompt,
          previousAnalysis: input.previousAnalysis,
          imageProvider: input.imageProvider,
        });
      }),
  }),

  // ─── Daily Almanac / 老黄历 ─────────────────────────────────────────
  almanac: router({
    today: publicProcedure
      .input(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
      )
      .query(async ({ input }) => {
        return getAlmanacDay(input.date);
      }),
  }),

  // ─── Nayin Five Element ─────────────────────────────────────────────
  nayin: router({
    today: publicProcedure
      .input(z.object({ date: z.string().optional() }).optional())
      .query(({ input }) => {
        const d = input?.date ? new Date(input.date) : new Date();
        const localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const { stem, branch, ganzhiIndex } = getDayStemBranch(localDate);
        const element = calcNayinByGanzhiIndex(ganzhiIndex);
        return { element, ganzhi: `${stem}${branch}`, stem, branch };
      }),
  }),

  // ─── Project ────────────────────────────────────────────────────────
  project: router({
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          deadline: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return createProject({
          userId: ctx.user.id,
          name: input.name,
          deadline: input.deadline,
        });
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserProjects(ctx.user.id);
    }),

    getOrCreateDefault: protectedProcedure.query(async ({ ctx }) => {
      return getOrCreateUserDefaultProject(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        return getProjectById(input.id, ctx.user.id);
      }),
  }),

  // ─── Reference (file upload) ────────────────────────────────────────
  reference: router({
    upload: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          fileName: z.string(),
          mimeType: z.string(),
          fileBase64: z.string(),
          sourceType: z.enum([
            "image",
            "video",
            "script",
            "storyboard",
            "brief",
            "note",
            "pdf",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const storageKey = `refs/${ctx.user.id}/${input.projectId}/${nanoid()}-${input.fileName}`;
        let fileKey = storageKey;
        let fileUrl: string | null = null;

        try {
          const { url } = await storagePut(storageKey, buffer, input.mimeType);
          fileUrl = url;
        } catch (error) {
          // Local fallback: if external storage is unavailable, keep file inline as data URL.
          fileKey = `inline/${ctx.user.id}/${input.projectId}/${nanoid()}-${input.fileName}`;
          fileUrl = `data:${input.mimeType};base64,${input.fileBase64}`;
        }

        const ref = await createReference({
          projectId: input.projectId,
          userId: ctx.user.id,
          title: input.fileName,
          sourceType: input.sourceType,
          fileUrl,
          fileKey,
          mimeType: input.mimeType,
          fileSize: buffer.length,
        });

        return { id: ref.id, fileUrl, fileKey };
      }),

    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectReferences(input.projectId);
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          dateBucket: z.string().optional(),
          importance: z.number().min(1).max(5).optional(),
          pinned: z.boolean().optional(),
          excluded: z.boolean().optional(),
          sortOrder: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateReference(id, ctx.user.id, data);
        return { success: true };
      }),
  }),

  // ─── Analysis（分析 Agent：把素材拆解成镜头） ──────────────────────────────
  // 用户上传素材后，调用大模型进行 NLP 分析
  // 输入：项目的所有参考素材（图片、脚本、brief 等）
  // 输出：拆解出的镜头列表 + 整体环境/氛围分析
  // 结果会存入数据库（shots 表 + analysis 表）
  analysis: router({
    /** Run NLP analysis on project references to decompose into shots */
    run: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // Gather all references for the project
        const refs = await getProjectReferences(input.projectId);
        if (refs.length === 0) {
          return {
            error: "No references found. Please upload materials first.",
          };
        }

        // Build multimodal context from references
        const userContent: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string; detail: "auto" } }
        > = [
          {
            type: "text",
            text: "Here are the project reference materials. Please decompose these into individual shots and provide an overall analysis.",
          },
        ];

        refs.forEach((r, i) => {
          let desc = `[${i + 1}] ${r.title} (${r.sourceType})`;
          if (r.extractedText) desc += `\nContent: ${r.extractedText}`;
          userContent.push({ type: "text", text: desc });

          if (
            ENV.llmSupportsImage &&
            r.fileUrl &&
            (r.sourceType === "image" || r.sourceType === "storyboard")
          ) {
            userContent.push({
              type: "image_url",
              image_url: { url: r.fileUrl, detail: "auto" },
            });
          } else if (
            r.sourceType === "image" ||
            r.sourceType === "storyboard"
          ) {
            const fileHint =
              r.fileUrl && !r.fileUrl.startsWith("data:")
                ? `\nImage URL: ${r.fileUrl}`
                : "";
            userContent.push({
              type: "text",
              text:
                `[Image Note] ${r.title} is an image reference.${fileHint}\n` +
                "Current model is in text-only mode, so infer visual intent from filename and context.",
            });
          }
        });

        const systemPrompt = `You are a professional film production analyst. Given reference materials (images, scripts, briefs, storyboards, notes), decompose them into individual scene/shot production rows.

For each shot, extract:
- sceneNo: Scene number (e.g. "S01")
- shotNo: Shot number (e.g. "A001")
- sourceSummary: Brief description of what this shot depicts
- intentType: "idea" | "client_requirement" | "director_note"
- status: "idea_pool" | "requirement_pool" | "structured" | "production_ready"
- readinessScore: 0-1 float indicating production readiness
- priority: "low" | "medium" | "high" | "urgent"
- blockingIssues: array of strings describing what's missing
- nextAction: suggested next step
- sceneType: e.g. "interior", "exterior", "aerial"
- timeOfDay: e.g. "night", "golden_hour", "overcast_day"
- weather: e.g. "foggy", "rainy", "clear"
- lighting: description of lighting setup
- cameraFocalLength: e.g. "35mm", "85mm"
- cameraMovement: e.g. "slow push-in", "static", "handheld"
- mood: emotional tone keywords
- colorPalette: color description
- promptDraft: a production-ready prompt for image/video generation
- negativePrompt: what to avoid

Also generate an overall analysis summary with:
- mood: overall mood analysis
- lighting: overall lighting analysis
- spatialStructure: spatial composition analysis
- cameraLanguage: camera language analysis
- colorPalette: color palette analysis
- atmosphereKeywords: array of atmosphere keywords
- promptDraft: overall environment prompt
- negativePrompt: overall negative prompt
- summary: one-paragraph summary

Return pure JSON only with { shots: [...], analysis: {...} }`;

        const invokeParams: Parameters<typeof invokeLLM>[0] = {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        };

        if (ENV.llmSupportsResponseFormat) {
          invokeParams.response_format = {
            type: "json_schema",
            json_schema: {
              name: "shot_decomposition",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  shots: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        sceneNo: { type: "string" },
                        shotNo: { type: "string" },
                        sourceSummary: { type: "string" },
                        intentType: {
                          type: "string",
                          enum: ["idea", "client_requirement", "director_note"],
                        },
                        status: {
                          type: "string",
                          enum: [
                            "idea_pool",
                            "requirement_pool",
                            "structured",
                            "production_ready",
                          ],
                        },
                        readinessScore: { type: "number" },
                        priority: {
                          type: "string",
                          enum: ["low", "medium", "high", "urgent"],
                        },
                        blockingIssues: {
                          type: "array",
                          items: { type: "string" },
                        },
                        nextAction: { type: "string" },
                        sceneType: { type: "string" },
                        timeOfDay: { type: "string" },
                        weather: { type: "string" },
                        lighting: { type: "string" },
                        cameraFocalLength: { type: "string" },
                        cameraMovement: { type: "string" },
                        mood: { type: "string" },
                        colorPalette: { type: "string" },
                        promptDraft: { type: "string" },
                        negativePrompt: { type: "string" },
                      },
                      required: [
                        "sceneNo",
                        "shotNo",
                        "sourceSummary",
                        "intentType",
                        "status",
                        "readinessScore",
                        "priority",
                        "blockingIssues",
                        "nextAction",
                        "sceneType",
                        "timeOfDay",
                        "weather",
                        "lighting",
                        "cameraFocalLength",
                        "cameraMovement",
                        "mood",
                        "colorPalette",
                        "promptDraft",
                        "negativePrompt",
                      ],
                      additionalProperties: false,
                    },
                  },
                  analysis: {
                    type: "object",
                    properties: {
                      mood: { type: "string" },
                      lighting: { type: "string" },
                      spatialStructure: { type: "string" },
                      cameraLanguage: { type: "string" },
                      colorPalette: { type: "string" },
                      atmosphereKeywords: {
                        type: "array",
                        items: { type: "string" },
                      },
                      promptDraft: { type: "string" },
                      negativePrompt: { type: "string" },
                      summary: { type: "string" },
                    },
                    required: [
                      "mood",
                      "lighting",
                      "spatialStructure",
                      "cameraLanguage",
                      "colorPalette",
                      "atmosphereKeywords",
                      "promptDraft",
                      "negativePrompt",
                      "summary",
                    ],
                    additionalProperties: false,
                  },
                },
                required: ["shots", "analysis"],
                additionalProperties: false,
              },
            },
          };
        }

        // Call LLM for structured shot decomposition
        const llmResult = await invokeLLM(invokeParams);

        const content = llmResult.choices[0]?.message?.content;
        let contentText = "";
        if (typeof content === "string") {
          contentText = content;
        } else if (Array.isArray(content)) {
          contentText = content
            .map(item => (item.type === "text" ? item.text : ""))
            .filter(Boolean)
            .join("\n");
        }

        if (!contentText) {
          return { error: "LLM returned empty response" };
        }

        const normalizedText = contentText
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/, "")
          .trim();

        const parseJsonFromLLM = <T>(raw: string): T => {
          try {
            return JSON.parse(raw) as T;
          } catch {
            const firstBrace = raw.indexOf("{");
            const lastBrace = raw.lastIndexOf("}");
            if (firstBrace === -1 || lastBrace <= firstBrace) {
              throw new Error("LLM returned non-JSON response");
            }
            return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T;
          }
        };

        const parsed = parseJsonFromLLM<{
          shots: Array<{
            sceneNo: string;
            shotNo: string;
            sourceSummary: string;
            intentType: "idea" | "client_requirement" | "director_note";
            status:
              | "idea_pool"
              | "requirement_pool"
              | "structured"
              | "production_ready";
            readinessScore: number;
            priority: "low" | "medium" | "high" | "urgent";
            blockingIssues: string[];
            nextAction: string;
            sceneType: string;
            timeOfDay: string;
            weather: string;
            lighting: string;
            cameraFocalLength: string;
            cameraMovement: string;
            mood: string;
            colorPalette: string;
            promptDraft: string;
            negativePrompt: string;
          }>;
          analysis: {
            mood: string;
            lighting: string;
            spatialStructure: string;
            cameraLanguage: string;
            colorPalette: string;
            atmosphereKeywords: string[];
            promptDraft: string;
            negativePrompt: string;
            summary: string;
          };
        }>(normalizedText);

        // Save shots to database
        const shotRows = parsed.shots.map(s => ({
          projectId: input.projectId,
          userId: ctx.user.id,
          sceneNo: s.sceneNo,
          shotNo: s.shotNo,
          sourceSummary: s.sourceSummary,
          intentType: s.intentType,
          status: s.status,
          readinessScore: s.readinessScore,
          priority: s.priority,
          autoRender: false,
          blockingIssues: s.blockingIssues,
          nextAction: s.nextAction,
          sceneType: s.sceneType,
          timeOfDay: s.timeOfDay,
          weather: s.weather,
          lighting: s.lighting,
          cameraFocalLength: s.cameraFocalLength,
          cameraMovement: s.cameraMovement,
          mood: s.mood,
          colorPalette: s.colorPalette,
          promptDraft: s.promptDraft,
          negativePrompt: s.negativePrompt,
        }));

        await createShots(shotRows);

        // Save analysis result
        const a = parsed.analysis;
        await createAnalysisResult({
          projectId: input.projectId,
          userId: ctx.user.id,
          mood: a.mood,
          lighting: a.lighting,
          spatialStructure: a.spatialStructure,
          cameraLanguage: a.cameraLanguage,
          colorPalette: a.colorPalette,
          atmosphereKeywords: a.atmosphereKeywords,
          promptDraft: a.promptDraft,
          negativePrompt: a.negativePrompt,
          summary: a.summary,
        });

        return {
          shotsCount: parsed.shots.length,
          analysis: parsed.analysis,
        };
      }),

    /** Get the latest analysis result for a project */
    get: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectAnalysis(input.projectId);
      }),
  }),

  // ─── Emotion Analysis（长期情绪画像底盘）───────────────────────────────
  emotionAnalysis: router({
    getProfile: protectedProcedure.query(async ({ ctx }) => {
      return getEmotionAnalysisProfile(ctx.user.id);
    }),

    saveBirthProfile: protectedProcedure
      .input(
        z.object({
          projectId: z.number().optional(),
          birthDate: birthDateSchema,
          dailyReference: emotionAnalysisPayloadSchema,
          analysisSeed: emotionAnalysisPayloadSchema,
          consentAccepted: z.literal(true),
          consentText: z.string().max(1000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return upsertEmotionAnalysisProfile({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          birthDate: input.birthDate,
          consentVersion: "emotion-analysis-v1",
          consentText: input.consentText,
          dailyReference: input.dailyReference,
          analysisSeed: input.analysisSeed,
        });
      }),
  }),

  // ─── Story Guide Agent ──────────────────────────────────────────────
  // Wraps archive/storyAgent functions as tRPC procedures.
  // Chat, classify (shot list synthesis), summarize, and story CRUD.
  storyAgent: router({
    /** Conversational chat with the story agent */
    chat: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
          history: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
          existingCardCount: z.number().optional(),
          summary: z.string().optional(),
          currentShots: z
            .array(
              z.object({
                shotNo: z.number(),
                subject: z.string(),
                action: z.string(),
                dialogue: z.string(),
                shotType: z.string(),
                cameraAngle: z.string(),
                cameraMove: z.string(),
                location: z.string(),
                timeLight: z.string(),
                mood: z.string(),
                sound: z.string(),
                styleRef: z.string(),
              })
            )
            .optional(),
          similarCards: z
            .array(
              z.object({
                content: z.string(),
                rawText: z.string().optional(),
                emotion: z.string().optional(),
                emotionBlend: z.array(z.string()).optional(),
                retrievalQuery: z.string().optional(),
                themeHints: z.array(z.string()).optional(),
                personalTrace: z.string().optional(),
                score: z.number().optional(),
              })
            )
            .optional(),
          storyCards: z
            .array(
              z.object({
                title: z.string().optional(),
                content: z.string(),
                sourceQuote: z.string().optional(),
                emotion: z.string().optional(),
                emotionOptions: z.array(z.string()).optional(),
                emotionBlend: z.array(z.string()).optional(),
                intensity: z.number().optional(),
                direction: z.string().optional(),
                complexity: z.string().optional(),
                trigger: z.string().optional(),
                dramaticFunction: z.string().optional(),
                personalTrace: z.string().optional(),
                retrievalQuery: z.string().optional(),
                themeHints: z.array(z.string()).optional(),
                outlierSignal: z.string().optional(),
                softMembership: z.array(z.string()).optional(),
              })
            )
            .optional(),
          projectId: z.number().optional(),
          photoUrl: z.string().optional(), // 用户上传的照片 URL，传给 LLM 做多模态理解
          confirmedIntent: z
            .object({
              purpose: z.string(),
              audience: z.string().optional(),
              platform: z.string().optional(),
              tone: z.string().optional(),
              desiredEffect: z.string().optional(),
              targetRole: z.string().optional(),
              channel: z.string().optional(),
            })
            .nullish(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        return replyFromStoryAgent({
          message: input.message,
          history: input.history,
          existingCardCount: input.existingCardCount,
          summary: input.summary,
          currentShots: input.currentShots as ShotDraft[] | undefined,
          similarCards: input.similarCards as
            | SimilarStoryCardPayload[]
            | undefined,
          storyCards: input.storyCards as StoryCardContextPayload[] | undefined,
          projectId: input.projectId,
          userId: ctx.user.id,
          photoUrl: input.photoUrl,
          confirmedIntent: input.confirmedIntent ?? undefined,
        });
      }),

    /** Inline selection edit — modify only the selected portion */
    selectionEdit: protectedProcedure
      .input(
        z.object({
          fullText: z.string().min(1),
          selectedText: z.string().min(1),
          instruction: z.string().min(1),
          projectId: z.number().optional(),
          history: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
        })
      )
      .mutation(async ({ input }) => {
        return handleSelectionEdit({
          fullText: input.fullText,
          selectedText: input.selectedText,
          instruction: input.instruction,
          projectId: input.projectId,
          history: input.history,
        });
      }),

    /** Synthesize story cards into a shot list */
    classify: protectedProcedure
      .input(
        z.object({
          projectId: z.number().optional(),
          // 镜头按 storyId 归属（U3）：合成出的镜头写到这个故事名下
          storyId: z.number().optional(),
          cards: z.array(
            z.object({
              title: z.string().optional(),
              content: z.string(),
              rawText: z.string().optional(),
              sourceQuote: z.string().optional(),
              emotion: z.string().optional(),
              emotionOptions: z.array(z.string()).optional(),
              emotionBlend: z.array(z.string()).optional(),
              intensity: z.number().optional(),
              direction: z.string().optional(),
              complexity: z.string().optional(),
              trigger: z.string().optional(),
              dramaticFunction: z.string().optional(),
              personalTrace: z.string().optional(),
              retrievalQuery: z.string().optional(),
              themeHints: z.array(z.string()).optional(),
              outlierSignal: z.string().optional(),
              softMembership: z.array(z.string()).optional(),
            })
          ),
          characterHint: z.string().optional(),
          visualAnchors: z
            .array(
              z.object({
                title: z.string(),
                imageUrl: z.string().optional(),
                objective: z.string().optional(),
                aesthetic: z.string().optional(),
                prompt: z.string().optional(),
                visualStyle: z.array(z.string()).optional(),
                mood: z.array(z.string()).optional(),
                colorPalette: z.array(z.string()).optional(),
              })
            )
            .optional(),
          // 意图确认关：用户确认/改过的意图，置顶喂进剧本上下文（最高优先级）。
          confirmedIntent: z
            .object({
              purpose: z.string(),
              audience: z.string(),
              platform: z.string(),
              tone: z.string(),
              desiredEffect: z.string(),
              targetRole: z.string().nullish(),
              channel: z.string().nullish(),
            })
            .nullish(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const resonanceContext =
          input.cards.length > 0
            ? await buildScriptResonanceContextForUser(
                ctx.user.id,
                input.cards
                  .map(card => card.emotion)
                  .filter((emotion): emotion is string => Boolean(emotion))
              )
            : "";
        // 用户已确认的意图最高优先级，置顶进剧本上下文，让剧本严格贴合"给谁看/为什么拍/调性"。
        const confirmedIntentLine = buildConfirmedIntentLine(
          input.confirmedIntent
        );
        const scriptContext = [confirmedIntentLine, resonanceContext]
          .filter(Boolean)
          .join("\n\n");
        // 可观测：把注入剧本的共鸣上下文打到日志，方便测试时确认「意图+情绪+文学声音」是否生效
        if (scriptContext) {
          console.log(
            `\n[共鸣·剧本] user=${ctx.user.id} ✅ 已注入（${input.cards.length} 张卡片）：\n${scriptContext}\n`
          );
        } else {
          console.log(
            `[共鸣·剧本] user=${ctx.user.id} ⚪ 未注入（卡片无情绪 + 无长期情绪画像 → 共鸣信号为空，剧本行为与接入前一致）`
          );
        }
        const result = await synthesizeShotList({
          cards: input.cards,
          characterHint: input.characterHint,
          visualAnchors: input.visualAnchors as
            | VisualAnchorPayload[]
            | undefined,
          confirmedIntent: input.confirmedIntent ?? undefined,
          ...(scriptContext ? { resonanceContext: scriptContext } : {}),
        });
        // 镜头按 storyId 归属（U3）：必须有 storyId 且归属当前用户才写入；
        // 验归属（getStoryById 带 userId）防向他人故事写镜头。
        if (!("error" in result) && input.projectId && input.storyId) {
          const ownedStory = await getStoryById(input.storyId, ctx.user.id);
          if (ownedStory) {
            await replaceDirectorShotsForStory(
              input.storyId,
              ctx.user.id,
              result.shots.map((shot, index) =>
                storyShotToDbRow({
                  projectId: input.projectId!,
                  storyId: input.storyId!,
                  userId: ctx.user.id,
                  shot,
                  index,
                })
              )
            );
          }
        }
        return result;
      }),

    /** Compress old chat turns into a summary note */
    summarize: protectedProcedure
      .input(
        z.object({
          priorSummary: z.string().optional(),
          turnsToAbsorb: z.array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        return summarizeHistory({
          priorSummary: input.priorSummary,
          turnsToAbsorb: input.turnsToAbsorb,
        });
      }),

    /** List all stories for the current user */
    storyList: protectedProcedure.query(async ({ ctx }) => {
      const items = await listUserStories(ctx.user.id);
      return { stories: items };
    }),

    /** Get a single story by ID */
    storyGet: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const story = await getStoryById(input.id, ctx.user.id);
        if (!story) return null;
        return composeStoryWorkspace(story, ctx.user.id);
      }),

    /** Set or replace the single character anchor for this story. */
    setCharacterAnchor: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          imageUrl: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          return {
            status: "error" as const,
            error: "故事不存在或无权访问",
          };
        }
        return writeCharacterAnchor(story, ctx.user.id, input.imageUrl);
      }),

    /**
     * 意图确认关：对当前对话跑 recognizeStoryIntent，返回识别到的意图
     * （purpose/audience/platform/tone + evidence/confidence/missingQuestion），
     * 供"生成剧本"前的确认 UI 展示。意图大脑一直在，这里把它接到客户端。
     */
    recognizeIntent: protectedProcedure
      .input(
        z.object({
          history: z.array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          ),
          existingIntent: z.record(z.string(), z.unknown()).nullish(),
        })
      )
      .mutation(async ({ input }) => {
        const turns = input.history.filter(t => t.content.trim());
        const message = turns.length ? turns[turns.length - 1].content : "";
        return recognizeStoryIntent({
          message,
          history: turns.slice(0, -1),
          existingIntent:
            (input.existingIntent as StoryIntentPayload | null | undefined) ??
            null,
        });
      }),

    /** Create or update a story */
    storyUpsert: protectedProcedure
      .input(
        z.object({
          id: z.number().optional(),
          title: z.string().optional(),
          logline: z.string().nullable().optional(),
          theme: z.string().nullable().optional(),
          arc: z.string().nullable().optional(),
          summary: z.string().nullable().optional(),
          projectId: z.number().nullable().optional(),
          body: z.record(z.string(), z.unknown()).optional(),
          baseRevision: z.number().int().nonnegative().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.id) {
          const existing = await getStoryById(input.id, ctx.user.id);
          if (existing) {
            const currentRevision = getStoryRevision(existing.body);
            const syncConflict =
              input.baseRevision !== undefined &&
              input.baseRevision !== currentRevision;
            const nextRevision = currentRevision + 1;
            const title =
              !syncConflict && input.title !== undefined
                ? input.title.trim().slice(0, 255) || existing.title
                : existing.title;
            const nextBody =
              input.body === undefined
                ? prepareStoryBody(existing.body, nextRevision)
                : syncConflict
                  ? mergeStaleStoryBody(existing.body, input.body, nextRevision)
                  : prepareStoryBody(input.body, nextRevision, existing.body);
            await updateStory(input.id, ctx.user.id, {
              title,
              logline: syncConflict ? undefined : input.logline,
              theme: syncConflict ? undefined : input.theme,
              arc: syncConflict ? undefined : input.arc,
              summary: syncConflict ? undefined : input.summary,
              projectId: syncConflict ? undefined : input.projectId,
              body: nextBody,
            });
            const saved = await getStoryById(input.id, ctx.user.id);
            if (saved) {
              await migrateStoryPromptLineage({
                storyId: saved.id,
                userId: ctx.user.id,
                body: storyPromptLineageBody(saved),
              });
            }
            return saved
              ? composeStoryWorkspace(saved, ctx.user.id, syncConflict)
              : null;
          }
          // Story not found (e.g. after server restart cleared in-memory state).
          // Fall through to create a new story rather than failing silently.
        }

        const title = input.title?.trim().slice(0, 255) || "未命名";
        const revision = 1;
        const { id: newId } = await createStory({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          title,
          logline: input.logline ?? null,
          theme: input.theme ?? null,
          arc: input.arc ?? null,
          summary: input.summary ?? null,
          body: prepareStoryBody(
            input.body ?? {
              cards: [],
              characters: [],
              shots: [],
            },
            revision
          ),
        });
        try {
          await migrateStoryPromptLineage({
            storyId: newId,
            userId: ctx.user.id,
            source: "initial",
            body: {
              ...(input.body ?? {
                cards: [],
                characters: [],
                shots: [],
              }),
              title,
              theme: input.theme ?? null,
              arc: input.arc ?? null,
            },
          });
        } catch (error) {
          await deleteStory(newId, ctx.user.id);
          throw error;
        }
        const saved = await getStoryById(newId, ctx.user.id);
        return saved ? composeStoryWorkspace(saved, ctx.user.id) : null;
      }),

    /** Delete a story */
    storyDelete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteStory(input.id, ctx.user.id);
        return { ok: true };
      }),

    /** Cycle the art style for a story (advance styleIndex by 1) */
    cycleStyle: protectedProcedure
      .input(z.object({ storyId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          return { status: "error" as const, error: "故事不存在" };
        }
        const styles = getActiveStyles();
        if (styles.length === 0) {
          return { status: "error" as const, error: "没有可用风格" };
        }
        const body = (story.body ?? {}) as Record<string, unknown>;
        const current =
          typeof body.styleIndex === "number" ? body.styleIndex : -1;
        const next = (current + 1) % styles.length;
        const nextBody = { ...body, styleIndex: next };
        await updateStory(story.id, ctx.user.id, {
          body: prepareStoryBody(
            nextBody,
            getStoryRevision(story.body) + 1,
            story.body
          ),
        });
        return {
          status: "ok" as const,
          styleIndex: next,
          styleName: styles[next].name,
        };
      }),

    // ─── 手机端聊天出图端点 ──────────────────────────────────────────
    // mobileChat: 带出图能力的聊天（enableImageGen=true）
    mobileChat: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
          history: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
          existingCardCount: z.number().optional(),
          summary: z.string().optional(),
          currentShots: z
            .array(
              z.object({
                shotNo: z.number(),
                subject: z.string(),
                action: z.string(),
                dialogue: z.string(),
                shotType: z.string(),
                cameraAngle: z.string(),
                cameraMove: z.string(),
                location: z.string(),
                timeLight: z.string(),
                mood: z.string(),
                sound: z.string(),
                styleRef: z.string(),
              })
            )
            .optional(),
          similarCards: z
            .array(
              z.object({
                content: z.string(),
                rawText: z.string().optional(),
                emotion: z.string().optional(),
                emotionBlend: z.array(z.string()).optional(),
                retrievalQuery: z.string().optional(),
                themeHints: z.array(z.string()).optional(),
                personalTrace: z.string().optional(),
                score: z.number().optional(),
              })
            )
            .optional(),
          projectId: z.number().optional(),
          photoUrl: z.string().optional(), // 用户上传的照片 URL，传给 LLM 做多模态理解
        })
      )
      .mutation(async ({ input, ctx }) => {
        return replyFromStoryAgent({
          message: input.message,
          history: input.history,
          existingCardCount: input.existingCardCount,
          summary: input.summary,
          currentShots: input.currentShots as ShotDraft[] | undefined,
          similarCards: input.similarCards as
            | SimilarStoryCardPayload[]
            | undefined,
          projectId: input.projectId,
          userId: ctx.user.id,
          enableImageGen: true, // 手机端开启出图能力
          photoUrl: input.photoUrl,
        });
      }),

    // uploadPhoto: 用户上传手机照片（base64 → storage）
    uploadPhoto: protectedProcedure
      .input(
        z.object({
          base64: z.string().min(1),
          mimeType: z.string().default("image/jpeg"),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const inlineUrl = `data:${input.mimeType};base64,${input.base64}`;
        const ext =
          input.mimeType === "image/png"
            ? "png"
            : input.mimeType === "image/webp"
              ? "webp"
              : input.mimeType === "image/gif"
                ? "gif"
                : "jpg";

        try {
          const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
          const { url } = await storagePut(key, buffer, input.mimeType);
          return { status: "ok" as const, url: inlineUrl, storedUrl: url };
        } catch (err) {
          // Storage can fail locally or during 302 proxy hiccups. Keep the
          // multimodal path alive by passing the already-optimized image inline.
          console.warn(
            "[uploadPhoto] storage upload failed, using inline image fallback:",
            err
          );
          return {
            status: "ok" as const,
            url: inlineUrl,
            fallback: "inline" as const,
          };
        }
      }),

    // generateForMobile: 用户确认后触发图片生成（可选传入用户照片作为基底）
    generateForMobile: protectedProcedure
      .input(
        z.object({
          prompt: z.string().optional(), // 可选：缺失时由服务端从对话现编（手动「画出来」）
          storyId: z.number(),
          shotNo: z.number().optional(),
          originalImageUrl: z.string().optional(), // 用户照片 URL，用于 image-to-image
          history: z // 手动「画出来」时传最近对话，供现编英文出图 prompt
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
          // 双轨出图：draft = 秒级小样（flux-schnell，确认构图用）；
          // final / 缺省 = MJ 正式版。draft 轨必须快，失败时快速返回，避免偷偷拖到正式轨。
          mode: z.enum(["draft", "final"]).optional(),
          // 镜头设计表重渲成功后直接成为该镜头当前版本。
          autoSelect: z.boolean().optional(),
          draftImageId: z.number().optional(), // 确认出正式版时关联草稿图，落库 parentImageId
          // 镜头内容提示：选中卡片的具体内容（content + 感官细节），作为画面主体来源。
          // 缺失时退回从对话历史猜（旧行为）。这是「画对镜头内容」的关键入口。
          cardHint: z.string().optional(),
          // 美术风格锁：用户锁定的画风（如「油画，印象派」），每次生成稳定附加，不漂移。
          styleHint: z.string().optional(),
          // 场景一致强度（MJ --iw 图像权重 0-3）：越高越贴近主角图的场景，越低越自由。
          // 前端滑块传入；缺省走默认 0.5（场景可变不卡死）。
          sceneWeight: z.number().min(0).max(3).optional(),
          sceneAnalysis: sceneAnalysisSchema.optional(),
          imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(), // 图片生成器选择，透传给 generateImage/editImage
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const story = await getStoryById(input.storyId, ctx.user.id);
          if (!story) {
            return {
              status: "error" as const,
              error: "找不到故事，无法保存图片",
            };
          }

          const storyBody =
            story.body && typeof story.body === "object"
              ? (story.body as Record<string, unknown>)
              : {};

          // ── prompt 构建阶段 ──
          // 三条路径的初始 prompt：
          //   Path 1/3: 客户端已构建结构化 prompt，传入 input.prompt
          //   Path 2A:  LLM 写好的 imagePrompt，传入 input.prompt
          //   Path 2B:  没有 prompt，服务端从对话现编
          let prompt = input.prompt?.trim() ?? "";
          let styleHintApplied = false;
          let sceneIntent: string | undefined;
          let sceneRationale: string | undefined;

          if (!prompt && input.sceneAnalysis) {
            const scenePrompt = composeScenePrompt(input.sceneAnalysis, {
              styleHint: input.styleHint,
            });
            prompt = scenePrompt.prompt;
            sceneIntent = scenePrompt.intent;
            sceneRationale = scenePrompt.rationale;
            styleHintApplied = Boolean(input.styleHint?.trim());
          }

          // Path 2B: 没有结构化镜头信息时才从对话现编
          if (!prompt) {
            const storyTitle =
              typeof storyBody.title === "string" ? storyBody.title : undefined;
            const artDirection = normalizeStoryArtDirection(
              storyBody.artDirection
            );
            const artStyleTokens = artDirection.recipe?.style?.join(", ");
            prompt = await deriveMobileImagePrompt({
              history: input.history,
              cardHint: input.cardHint,
              storyTheme: storyTitle,
              artStyle: input.styleHint?.trim() || artStyleTokens,
            });
          }

          if (!prompt) {
            return {
              status: "error" as const,
              error: "还没聊到能画的内容，多说两句再点「画出来」？",
            };
          }

          // ── LLM 理解阶段：消化镜头意图，重写为有画面感的 prompt ──
          // 有 sceneAnalysis（Path 2）或有 shotNo + story shots（Path 1/3）时，
          // 用 LLM 理解镜头意图后重写 prompt。不是字段拼接，是让 AI 理解
          // "这个镜头要交代什么、用户想表达什么"后输出画面描述。
          const artDirection = normalizeStoryArtDirection(
            storyBody.artDirection
          );
          const characters = Array.isArray(storyBody.characters)
            ? (
                storyBody.characters as Array<{
                  name?: string;
                  description?: string;
                  oneLiner?: string;
                  role?: string;
                }>
              )
                .slice(0, 3)
                .map(c => ({
                  name: c.name ?? "",
                  description: c.description ?? c.oneLiner ?? c.role,
                }))
            : undefined;

          // 尝试从 story body 的 shots 数组中找到当前镜头的结构化数据
          const storyShots = Array.isArray(storyBody.shots)
            ? storyBody.shots
            : [];
          const storyShot =
            input.shotNo != null
              ? (storyShots.find(
                  (s: Record<string, unknown>) => s.shotNo === input.shotNo
                ) as Record<string, unknown> | undefined)
              : undefined;

          // 构建 synthesize 输入：优先 sceneAnalysis > storyShot > 原始 prompt
          const synthesizeCtx:
            | import("../shared/promptContext").PromptShotMeta
            | null = input.sceneAnalysis
            ? {
                shotNo: input.shotNo ?? 0,
                subject: input.sceneAnalysis.subjectDescription,
                action: input.sceneAnalysis.action,
                mood: input.sceneAnalysis.emotion,
                styleRef: input.styleHint?.trim(),
                intent: input.sceneAnalysis.intent ?? undefined,
                rationale: input.sceneAnalysis.rationale ?? undefined,
                sourceCardContent: input.cardHint,
              }
            : storyShot
              ? {
                  shotNo: input.shotNo ?? 0,
                  subject:
                    typeof storyShot.subject === "string"
                      ? storyShot.subject
                      : undefined,
                  action:
                    typeof storyShot.action === "string"
                      ? storyShot.action
                      : undefined,
                  location:
                    typeof storyShot.location === "string"
                      ? storyShot.location
                      : undefined,
                  timeLight:
                    typeof storyShot.timeLight === "string"
                      ? storyShot.timeLight
                      : undefined,
                  mood:
                    typeof storyShot.mood === "string"
                      ? storyShot.mood
                      : undefined,
                  styleRef:
                    input.styleHint?.trim() ||
                    (typeof storyShot.styleRef === "string"
                      ? storyShot.styleRef
                      : undefined),
                  shotType:
                    typeof storyShot.shotType === "string"
                      ? storyShot.shotType
                      : undefined,
                  cameraAngle:
                    typeof storyShot.cameraAngle === "string"
                      ? storyShot.cameraAngle
                      : undefined,
                  cameraMove:
                    typeof storyShot.cameraMove === "string"
                      ? storyShot.cameraMove
                      : undefined,
                  beat:
                    typeof storyShot.beat === "string"
                      ? storyShot.beat
                      : undefined,
                  intent:
                    typeof storyShot.intent === "string"
                      ? storyShot.intent
                      : undefined,
                  rationale:
                    typeof storyShot.rationale === "string"
                      ? storyShot.rationale
                      : undefined,
                  sourceCardContent:
                    typeof storyShot.sourceCardContent === "string"
                      ? storyShot.sourceCardContent
                      : undefined,
                  promptDraft:
                    typeof storyShot.promptDraft === "string"
                      ? storyShot.promptDraft
                      : undefined,
                }
              : null;

          const promptShotForCompile = synthesizeCtx
            ? input.sceneAnalysis
              ? {
                  ...synthesizeCtx,
                  intent: undefined,
                  rationale: undefined,
                }
              : synthesizeCtx
            : null;
          const promptContext: PromptContext | null = promptShotForCompile
            ? {
                shot: promptShotForCompile,
                story: {
                  storyId: input.storyId,
                  storyTitle:
                    typeof storyBody.title === "string"
                      ? storyBody.title
                      : undefined,
                },
                artDirection: {
                  recipe: artDirection.recipe ?? undefined,
                },
                characters,
                freeTextPrompt: prompt,
                mode: input.mode,
              }
            : null;

          if (
            promptContext &&
            ENV.forgeApiKey &&
            !process.env.VITEST &&
            process.env.NODE_ENV !== "test"
          ) {
            try {
              const synthesized = await synthesizeShotPrompt({
                ctx: promptContext,
                history: input.history,
                initialPrompt: prompt,
                previousPrompt: undefined,
              });
              if (synthesized && synthesized.length > 30) {
                prompt = buildUnifiedPrompt({
                  ...promptContext,
                  freeTextPrompt: synthesized,
                });
                console.log(
                  `[generateForMobile] LLM synthesized prompt: ${synthesized.length} chars`
                );
              }
            } catch (err) {
              console.warn(
                "[synthesizeShotPrompt] failed, using original prompt:",
                err instanceof Error ? err.message : err
              );
            }
          } else if (promptContext) {
            prompt = buildUnifiedPrompt(promptContext);
          }

          // 风格锁：如果 prompt 里还没有风格描述，追加 styleHint
          if (input.styleHint?.trim() && !styleHintApplied) {
            const hasStyle =
              prompt.includes("Shared visual framework") ||
              prompt.includes("Art style") ||
              prompt.includes("art style") ||
              prompt.includes("visual style") ||
              prompt.includes("Style reference");
            if (!hasStyle) {
              prompt = `${prompt}\nArt style: ${input.styleHint.trim()}`;
            }
          }

          // 出图统一经美术网关
          const storyReferences = storyArtReferenceImages(story);
          const direction = normalizeStoryArtDirection(storyBody.artDirection);
          const rawCharacterRef = characterReferenceOf(direction);
          prompt = withCharacterContinuityPrompt(prompt, storyBody, {
            hasCharacterReference: Boolean(rawCharacterRef),
            sceneAnalysis: input.sceneAnalysis,
          });
          const injection = await deriveInjection(story, input.sceneAnalysis);
          // 垫图基底（场景一致）：优先主角图原图（readImageInput 可直读本地），其次用户照片/故事参考。
          const referenceImage =
            input.originalImageUrl || rawCharacterRef || storyReferences[0];
          if (referenceImage) {
            try {
              const referencePurpose = input.originalImageUrl
                ? "current-frame"
                : rawCharacterRef
                  ? "character"
                  : "scene-style";
              const imageInput = await materializeImageInput(referenceImage);
              const directed = await directImagePrompt({
                imageInput,
                fallbackPrompt: prompt,
                narrativePrompt: prompt,
                referencePurpose,
                shotNo: input.shotNo,
                storyTitle:
                  typeof storyBody.title === "string"
                    ? storyBody.title
                    : undefined,
              });
              prompt = directed.prompt;
            } catch (error) {
              console.warn(
                "[generateForMobile] image prompt director failed, using existing prompt:",
                error instanceof Error ? error.message : error
              );
            }
          }
          const explicitStyleRecipe = artRecipeFromStyleHint(input.styleHint);
          const gateContext = {
            prompt,
            referenceImages: referenceImage
              ? Array.from(new Set([referenceImage, ...storyReferences]))
              : undefined,
            shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
            projectId: story.projectId ?? undefined,
            storyId: story.id,
            artDirection: storyArtRecipe(story) ?? explicitStyleRecipe,
            styleIndex:
              typeof storyBody.styleIndex === "number"
                ? (storyBody.styleIndex as number)
                : undefined,
          };

          const imageWeight = input.sceneWeight ?? 0.5;
          const shotIdentity = shotIdentityForStoryShot(story, input.shotNo);
          const promptCompilationId = await resolveStoryImageCompilationId({
            story,
            storyId: input.storyId,
            userId: ctx.user.id,
            shotIdentity,
          });

          console.log(
            `[generateForMobile] prompt length: ${prompt.length} chars, mode: ${input.mode ?? "final"}`
          );

          // 快轨：复制旧版 7b7d9bf 的 flux-schnell 草稿小样，先让弹窗快速返回单张图。
          // 失败（额度/网络/网关不支持）自动回落到下面的 MJ 正式轨，用户无感知。
          if (input.mode === "draft") {
            let renderedDraftPrompt = prompt;
            const draft = await renderViaGate(gateContext, renderedPrompt => {
              renderedDraftPrompt = renderedPrompt;
              return generateDraftImage(renderedPrompt);
            });
            if (draft.status === "ok" && draft.imageUrl) {
              const image = await createGeneratedImage({
                projectId: story.projectId ?? null,
                storyId: input.storyId,
                userId: ctx.user.id,
                shotNo: canonicalizeShotNo(input.shotNo),
                shotIdentity,
                imageKey: draft.imageKey ?? null,
                imageUrl: draft.imageUrl,
                prompt: renderedDraftPrompt,
                promptCompilationId,
                generationType: "generate", // 草稿小样；确认后由 final 轨出 MJ 正式版
                isCurrent: false,
              });
              return {
                status: "ok" as const,
                imageUrl: draft.imageUrl,
                imageId: image.id,
                prompt: renderedDraftPrompt,
                intent: sceneIntent,
                rationale: sceneRationale,
                mode: "draft" as const,
              };
            }
            return {
              status: "error" as const,
              error: draft.message ?? "草稿图生成失败",
              mode: "draft" as const,
            };
          }

          // 慢轨正式版：全质量 MJ turbo。人物锁(--oref/--ow 100)跨镜头锁脸/发/衣；
          // 场景一致经垫图(--iw)，默认 0.5（可变不卡死），前端可经 sceneWeight 调。
          let renderedFinalPrompt = prompt;
          const result = await renderViaGate(gateContext, renderedPrompt => {
            renderedFinalPrompt = renderedPrompt;
            console.log(
              `[generateForMobile] final prompt after gate: ${renderedPrompt.length} chars`
            );
            return referenceImage
              ? editMobileImage(referenceImage, renderedPrompt, {
                  provider: input.imageProvider,
                  ...injection,
                  imageWeight,
                })
              : generateMobileImage(renderedPrompt, {
                  provider: input.imageProvider,
                  ...injection,
                });
          });
          if (result.status === "error" || !result.imageUrl) {
            return {
              status: "error" as const,
              error: result.message ?? "图片生成返回空结果",
            };
          }
          // 写入 generatedImages 表（shotNo 转为字符串，统一表结构）
          const image = await createGeneratedImage({
            projectId: story.projectId ?? null,
            storyId: input.storyId,
            userId: ctx.user.id,
            shotNo: canonicalizeShotNo(input.shotNo),
            shotIdentity,
            imageKey: result.imageKey ?? null,
            imageUrl: result.imageUrl,
            prompt: renderedFinalPrompt,
            promptCompilationId,
            generationType: "initial",
            parentImageId: input.draftImageId ?? null, // 由草稿确认而来时，链回草稿
            isCurrent: false,
          });
          return {
            status: "ok" as const,
            imageUrl: result.imageUrl,
            imageId: image.id,
            prompt: renderedFinalPrompt,
            intent: sceneIntent,
            rationale: sceneRationale,
            mode: "final" as const,
          };
        } catch (err) {
          console.error("[generateForMobile] 图片生成失败:", err);
          return {
            status: "error" as const,
            error: err instanceof Error ? err.message : "图片生成失败",
          };
        }
      }),

    // mobileInpaint: 局部修复（基于原图改画；MJ 模式内部自带「图生图失败→文生图」兜底）
    mobileInpaint: protectedProcedure
      .input(
        z.object({
          prompt: z.string().min(1),
          originalImageUrl: z.string(),
          storyId: z.number(),
          shotNo: z.number().optional(),
          parentImageId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const story = await getStoryById(input.storyId, ctx.user.id);
          if (!story) {
            return {
              status: "error" as const,
              error: "找不到故事，无法保存图片",
            };
          }

          // 局部修复同样经美术网关：带上故事的美术 DNA 和参考图
          const storyReferences = storyArtReferenceImages(story);
          const result = await renderViaGate(
            {
              prompt: input.prompt,
              referenceImages: Array.from(
                new Set([input.originalImageUrl, ...storyReferences])
              ),
              shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
              projectId: story.projectId ?? undefined,
              artDirection: storyArtRecipe(story),
              styleIndex:
                typeof (story.body as Record<string, unknown>)?.styleIndex ===
                "number"
                  ? ((story.body as Record<string, unknown>)
                      .styleIndex as number)
                  : undefined,
            },
            renderedPrompt =>
              editMobileImage(input.originalImageUrl, renderedPrompt)
          );
          if (result.status === "error" || !result.imageUrl) {
            return {
              status: "error" as const,
              error: result.message ?? "局部修复返回空结果",
            };
          }
          // shotNo 转为字符串
          const shotIdentity = shotIdentityForStoryShot(story, input.shotNo);
          const promptCompilationId = await resolveStoryImageCompilationId({
            story,
            storyId: input.storyId,
            userId: ctx.user.id,
            shotIdentity,
          });
          const image = await createGeneratedImage({
            projectId: story.projectId ?? null,
            storyId: input.storyId,
            userId: ctx.user.id,
            shotNo: canonicalizeShotNo(input.shotNo),
            shotIdentity,
            imageKey: result.imageKey ?? null,
            imageUrl: result.imageUrl,
            prompt: input.prompt,
            promptCompilationId,
            generationType: "inpaint",
            parentImageId: input.parentImageId ?? null,
            isCurrent: false,
          });
          return {
            status: "ok" as const,
            imageUrl: result.imageUrl,
            imageId: image.id,
          };
        } catch (err) {
          console.error("[mobileInpaint] 局部修复失败:", err);
          return {
            status: "error" as const,
            error: err instanceof Error ? err.message : "局部修复失败",
          };
        }
      }),

    // recordSignal: 记录用户交互信号（左划/右划/编辑等）
    recordSignal: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          imageId: z.number().optional(),
          action: z.enum([
            "swipe_left",
            "swipe_right",
            "edit_start",
            "edit_complete",
          ]),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.imageId != null) {
          const image = await getGeneratedImageById(input.imageId);
          if (
            !image ||
            image.storyId !== input.storyId ||
            (image.userId != null && image.userId !== ctx.user.id)
          ) {
            return { status: "error" as const, error: "图片不存在或无权操作" };
          }
        }
        if (input.action === "swipe_right" && input.imageId != null) {
          const promoted = await promoteStoryImageToCurrent({
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: input.imageId,
            metadata: input.metadata ?? null,
          });
          if (!promoted) {
            return { status: "error" as const, error: "图片不存在或无权操作" };
          }
          return { id: promoted.signal.id };
        }
        const signal = await createImageSignal({
          userId: ctx.user.id,
          storyId: input.storyId,
          imageId: input.imageId ?? null,
          action: input.action,
          metadata: input.metadata ?? null,
        });
        return { id: signal.id };
      }),

    // storyImages: 获取某个 story 的所有当前图片
    storyImages: protectedProcedure
      .input(z.object({ storyId: z.number() }))
      .query(async ({ ctx, input }) => {
        const assets = await getStoryImageAssets(input.storyId, ctx.user.id);
        return assets
          .filter(asset => asset.kind === "story_frame")
          .filter(asset => asset.assignment === "shot")
          .filter(asset => asset.isPrimary)
          .filter(asset => asset.status !== "rejected")
          .filter(asset => asset.availability !== "missing")
          .map(asset => ({
            id: asset.id,
            projectId: asset.projectId,
            storyId: asset.storyId,
            userId: asset.userId,
            shotNo: asset.canonicalShotNo ?? asset.rawShotNo,
            shotIdentity: asset.shotIdentity,
            imageKey: asset.imageKey,
            imageUrl: asset.imageUrl,
            prompt: asset.prompt,
            parentImageId: asset.parentImageId,
            isCurrent: asset.isCurrent,
            isPrimary: asset.isPrimary,
            selectionSource: asset.selectionSource,
            status: asset.status,
            generationType: asset.generationType,
            maskKey: asset.maskKey,
            createdAt: new Date(asset.createdAt),
          }));
      }),

    // deleteShotImage: 删除某张图片，释放 primary 给下一张
    deleteShotImage: protectedProcedure
      .input(z.object({ imageId: z.number(), storyId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const [image, story] = await Promise.all([
          getGeneratedImageById(input.imageId),
          getStoryById(input.storyId, ctx.user.id),
        ]);
        if (
          !image ||
          !story ||
          image.storyId !== input.storyId ||
          (image.userId != null && image.userId !== ctx.user.id)
        ) {
          return { status: "error" as const, error: "图片不存在或无权操作" };
        }
        await deleteGeneratedImage(input.imageId, ctx.user.id);

        const body =
          story.body && typeof story.body === "object"
            ? (story.body as Record<string, unknown>)
            : {};
        let removedPromptRunReference = false;
        const shots = Array.isArray(body.shots)
          ? body.shots.map(rawShot => {
              if (!rawShot || typeof rawShot !== "object") return rawShot;
              const shot = rawShot as Record<string, unknown>;
              if (
                !shot.promptRun ||
                typeof shot.promptRun !== "object" ||
                Array.isArray(shot.promptRun)
              ) {
                return rawShot;
              }
              const promptRun = shot.promptRun as Record<string, unknown>;
              if (promptRun.imageId !== input.imageId) return rawShot;
              const {
                imageId: _imageId,
                imageUrl: _imageUrl,
                ...rest
              } = promptRun;
              removedPromptRunReference = true;
              return { ...shot, promptRun: rest };
            })
          : [];
        const previousMobileImages = Array.isArray(body.mobileImages)
          ? body.mobileImages
          : null;
        const mobileImages = previousMobileImages
          ? previousMobileImages.filter(rawImage => {
              if (!rawImage || typeof rawImage !== "object") return true;
              return (rawImage as Record<string, unknown>).id !== input.imageId;
            })
          : body.mobileImages;
        const removedMobileImage =
          previousMobileImages != null &&
          Array.isArray(mobileImages) &&
          mobileImages.length !== previousMobileImages.length;
        if (removedPromptRunReference || removedMobileImage) {
          await updateStory(story.id, ctx.user.id, {
            body: prepareStoryBody(
              { ...body, shots, mobileImages },
              getStoryRevision(story.body) + 1,
              story.body
            ),
          });
        }

        const assets = await getStoryImageAssets(input.storyId, ctx.user.id);
        return {
          status: "ok" as const,
          images: assets
            .filter(a => a.kind === "story_frame" && a.assignment === "shot")
            .map(a => ({
              id: a.id,
              imageUrl: a.imageUrl,
              prompt: a.prompt,
              shotNo: a.canonicalShotNo ?? a.rawShotNo,
              isPrimary: a.isPrimary,
              status: a.status,
              createdAt: new Date(a.createdAt),
            })),
        };
      }),

    storyVideoAssets: protectedProcedure
      .input(z.object({ storyId: z.number() }))
      .query(async ({ ctx, input }) => {
        return getStoryVideoAssets(input.storyId, ctx.user.id);
      }),

    storyMaterialState: protectedProcedure
      .input(z.object({ storyId: z.number() }))
      .query(async ({ ctx, input }) => {
        return getStoryMaterialState(input.storyId, ctx.user.id);
      }),
  }),

  // ─── Shot management ────────────────────────────────────────────────
  shot: router({
    list: protectedProcedure
      .input(z.object({ storyId: z.number() }))
      .query(async ({ ctx, input }) => {
        // 按 storyId 取镜头，并强制 userId——防"猜 storyId 取他人镜头"（U3）
        return getStoryShots(input.storyId, ctx.user.id);
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          status: z
            .enum([
              "idea_pool",
              "requirement_pool",
              "structured",
              "production_ready",
              "queued",
              "rendered",
              "blocked",
            ])
            .optional(),
          readinessScore: z.number().min(0).max(1).optional(),
          deadline: z.string().optional(),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          autoRender: z.boolean().optional(),
          blockingIssues: z.array(z.string()).optional(),
          nextAction: z.string().optional(),
          sourceSummary: z.string().optional(),
          sceneType: z.string().optional(),
          timeOfDay: z.string().optional(),
          weather: z.string().optional(),
          lighting: z.string().optional(),
          cameraFocalLength: z.string().optional(),
          cameraMovement: z.string().optional(),
          spatialLayers: z.string().optional(),
          mood: z.string().optional(),
          colorPalette: z.string().optional(),
          promptDraft: z.string().optional(),
          negativePrompt: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateShot(id, ctx.user.id, data);
        return { success: true };
      }),

    batchUpdate: protectedProcedure
      .input(
        z.object({
          ids: z.array(z.number()),
          status: z
            .enum([
              "idea_pool",
              "requirement_pool",
              "structured",
              "production_ready",
              "queued",
              "rendered",
              "blocked",
            ])
            .optional(),
          deadline: z.string().optional(),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          autoRender: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ids, ...data } = input;
        await batchUpdateShots(ids, ctx.user.id, data);
        return { success: true, count: ids.length };
      }),
  }),

  // ─── Edit Context (Snapshot & Annotations) ──────────────────────────
  editContext: router({
    saveSnapshot: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          sessionId: z.string(),
          state: z.object({
            cards: z.array(z.record(z.string(), z.unknown())).optional(),
            script: z.array(z.record(z.string(), z.unknown())).optional(),
            shots: z.array(z.record(z.string(), z.unknown())).optional(),
            visualCanvasItems: z
              .array(z.record(z.string(), z.unknown()))
              .optional(),
            visualPreference: z.string().optional(),
            artDirection: z.record(z.string(), z.unknown()).optional(),
          }),
          autoSave: z.boolean().optional(),
          inlineCorrection: z
            .object({
              originalText: z.string(),
              modifiedText: z.string(),
              instruction: z.string(),
              sourceType: z.string(),
            })
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await saveSnapshot({
            projectId: input.projectId,
            sessionId: input.sessionId,
            state: input.state as ProjectState,
            autoSave: input.autoSave,
            inlineCorrection: input.inlineCorrection,
          });
          return result;
        } catch (error) {
          console.error("[editContext.saveSnapshot] Error:", error);
          throw new Error("Failed to save snapshot");
        }
      }),

    getRecentAnnotations: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          limit: z.number().min(1).max(20).optional().default(5),
        })
      )
      .query(async ({ input }) => {
        try {
          const annotations = await getRecentAnnotations(
            input.projectId,
            input.limit
          );
          return annotations;
        } catch (error) {
          console.error("[editContext.getRecentAnnotations] Error:", error);
          return [];
        }
      }),
  }),

  // ─── Creation Agent ─────────────────────────────────────────────────
  // Creation Engine: chat with image generation + focus tracking.
  creationAgent: router({
    shotVideoProviderStatus: protectedProcedure.query(() =>
      getShotVideoProviderStatus()
    ),

    /** Conversational chat with the creation agent */
    chat: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
          projectId: z.number(),
          history: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
          cards: z
            .array(
              z.object({
                content: z.string(),
                emotion: z.string().optional(),
              })
            )
            .optional(),
          currentScript: z.string().optional(),
          shots: z
            .array(
              z.object({
                shotNo: z.string(),
                subject: z.string(),
                action: z.string(),
                dialogue: z.string(),
                shotType: z.string(),
                mood: z.string(),
                promptDraft: z.string().optional(),
              })
            )
            .optional(),
          currentFocusShotNo: z.string().optional(),
          imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(),
          goal: z.enum(CREATION_GOALS).optional(),
          storyId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 故事来源改为传入的当前故事（U3），getStoryById 带 userId 验归属。
        // assets：图片资产层（codex 合并）按 projectId 取，与镜头(storyId)正交。
        const [story, assets] = await Promise.all([
          input.storyId
            ? getStoryById(input.storyId, ctx.user.id)
            : Promise.resolve(null),
          // 图片按当前故事独立：有 storyId 取该故事的图，无则空（故事间不共享）
          input.storyId
            ? getStoryImageAssets(input.storyId, ctx.user.id)
            : Promise.resolve([]),
        ]);
        // 自动识别意图：用户没手动选目标时，从这句话+最近用户消息自动认出求职/社媒/记录。
        const effectiveGoal =
          input.goal && input.goal !== "unset"
            ? input.goal
            : detectGoalFromText(
                [
                  input.message,
                  ...(input.history ?? [])
                    .filter(t => t.role === "user")
                    .slice(-4)
                    .map(t => t.content ?? ""),
                ].join("\n")
              );
        const result = await replyFromCreationAgent({
          message: input.message,
          projectId: input.projectId,
          history: input.history,
          cards: input.cards,
          currentScript: input.currentScript,
          shots: input.shots as ShotContext[] | undefined,
          currentFocusShotNo: input.currentFocusShotNo,
          imageProvider: input.imageProvider,
          goal: effectiveGoal,
          storyId: story?.id ?? null,
          userId: ctx.user.id,
          assets,
          artDirection: story ? storyArtRecipe(story) : undefined,
          referenceImages: story ? storyArtReferenceImages(story) : undefined,
          story,
        });

        let characterAnchorChanged = false;
        const anchorCall = result.toolCalls.find(
          (toolCall): toolCall is SetCharacterAnchorToolCall =>
            toolCall.tool === "setCharacterAnchor"
        );
        if (anchorCall) {
          const anchorUrl =
            typeof anchorCall.imageUrl === "string" &&
            anchorCall.imageUrl.trim()
              ? anchorCall.imageUrl.trim()
              : typeof anchorCall.imageId === "number"
                ? assets.find(
                    asset =>
                      asset.id === anchorCall.imageId &&
                      asset.kind === "story_frame" &&
                      asset.availability !== "missing"
                  )?.imageUrl
                : undefined;
          if (!story) {
            result.reply = [
              result.reply,
              "还没有可写入锚点的故事，先保存故事后我再设人物锚点。",
            ]
              .filter(Boolean)
              .join("\n\n");
          } else if (!anchorUrl) {
            result.reply = [
              result.reply,
              "我没有找到这张可用图片，暂时不能设为人物锚点。",
            ]
              .filter(Boolean)
              .join("\n\n");
          } else {
            const anchorResult = await writeCharacterAnchor(
              story,
              ctx.user.id,
              anchorUrl
            );
            if (anchorResult.status === "ok") {
              characterAnchorChanged = true;
              result.reply = [
                result.reply,
                "已把这张图设为人物锚点，后续人物镜头会优先按这张脸和整体画风延续。",
              ]
                .filter(Boolean)
                .join("\n\n");
            } else {
              result.reply = [result.reply, anchorResult.error]
                .filter(Boolean)
                .join("\n\n");
            }
          }
        }
        const photoCall = result.toolCalls.find(
          (toolCall): toolCall is CreateCharacterFromPhotoToolCall =>
            toolCall.tool === "createCharacterFromPhoto"
        );
        if (photoCall) {
          if (!story) {
            result.reply = [
              result.reply,
              "还没有可写入锚点的故事，先保存故事后我再把照片重绘成锚点。",
            ]
              .filter(Boolean)
              .join("\n\n");
          } else if (!photoCall.photoUrl?.trim()) {
            result.reply = [
              result.reply,
              "我没有拿到可用照片，暂时不能创建人物锚点。",
            ]
              .filter(Boolean)
              .join("\n\n");
          } else {
            const recipePrompt = artRecipePrompt(
              storyArtRecipe(story) ?? defaultArtRecipe()
            );
            const stylized = await editMobileImage(
              photoCall.photoUrl.trim(),
              [
                "Stylize the provided person photo into this story's visual style.",
                "Preserve the person's recognizable face, hairstyle, clothing color, clothing material, and overall identity.",
                "Create a clean character reference portrait suitable for future story frames.",
                recipePrompt,
              ]
                .filter(Boolean)
                .join(" "),
              {
                provider: input.imageProvider,
                requireInputImage: true,
              }
            );
            if (stylized.status !== "ok" || !stylized.imageUrl) {
              result.reply = [
                result.reply,
                `这次没能基于照片重绘人物锚点：${stylized.message ?? "图片服务没有返回结果"}。我不会把无关文生图或原始照片设为锚点。`,
              ]
                .filter(Boolean)
                .join("\n\n");
            } else {
              const anchorResult = await writeCharacterAnchor(
                story,
                ctx.user.id,
                stylized.imageUrl
              );
              if (anchorResult.status === "ok") {
                characterAnchorChanged = true;
                result.reply = [
                  result.reply,
                  "已把照片重绘成风格化人物图，并设为人物锚点；后续人物镜头会按这张锚点延续。",
                ]
                  .filter(Boolean)
                  .join("\n\n");
              } else {
                result.reply = [result.reply, anchorResult.error]
                  .filter(Boolean)
                  .join("\n\n");
              }
            }
          }
        }

        // buildShotList：小酌请求铺整张镜头表 → 用现成 synthesizeShotList 合成、
        // 按 goal 注入求职等目标、写到当前故事（按 storyId 归属，story 已验归属）。
        let builtShotCount = 0;
        if (result.shotBuild && story && input.storyId) {
          const resonanceContext = goalGuidance(effectiveGoal) || undefined;
          const synth = await synthesizeShotList({
            cards: [{ content: result.shotBuild.storyDigest }],
            ...(resonanceContext ? { resonanceContext } : {}),
          });
          if (!("error" in synth)) {
            await replaceDirectorShotsForStory(
              input.storyId,
              ctx.user.id,
              synth.shots.map((shot, index) =>
                storyShotToDbRow({
                  projectId: input.projectId,
                  storyId: input.storyId!,
                  userId: ctx.user.id,
                  shot,
                  index,
                })
              )
            );
            builtShotCount = synth.shots.length;
          }
        }

        return { ...result, builtShotCount, characterAnchorChanged };
      }),

    /** Unified project image assets, including history and selection state. */
    getProjectAssets: protectedProcedure
      // 图片按当前故事独立（故事为唯一单位）：显示层用 storyId 取，故事间不共享图片。
      .input(z.object({ storyId: z.number() }))
      .query(async ({ ctx, input }) => {
        return getStoryImageAssets(input.storyId, ctx.user.id);
      }),

    /** Confirm or restore an image as the selected primary for its shot. */
    selectImage: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          imageId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await getProjectById(input.projectId, ctx.user.id);
        if (!project)
          return {
            success: false as const,
            reason: "project_not_found" as const,
          };
        const assets = await getProjectImageAssets(
          input.projectId,
          ctx.user.id
        );
        const asset = assets.find(candidate => candidate.id === input.imageId);
        if (
          !asset ||
          asset.kind !== "story_frame" ||
          asset.availability === "missing"
        ) {
          return {
            success: false as const,
            reason: "image_not_found" as const,
          };
        }
        // 故事为唯一单位后弃用 getLatestStoryForProject：图片信号的 storyId 取该资产自身归属
        if (asset.storyId == null) {
          return {
            success: false as const,
            reason: "image_not_found" as const,
          };
        }
        const promoted = await promoteStoryImageToCurrent({
          userId: ctx.user.id,
          storyId: asset.storyId,
          imageId: asset.id,
          metadata: {
            source: "creation",
            projectId: input.projectId,
            shotNo: asset.canonicalShotNo,
          },
        });
        return promoted
          ? { success: true as const }
          : { success: false as const, reason: "image_not_found" as const };
      }),

    /**
     * 把前端从四宫格候选图里裁出的单张画面，提升为该镜头的正式首帧。
     * 裁切发生在浏览器 canvas；后端只负责鉴权、稳定存图、入库并标记为主图。
     */
    promoteFrameCrop: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          shotNo: z.number(),
          imageBase64: z.string().min(1),
          mimeType: z
            .enum(["image/png", "image/jpeg", "image/webp"])
            .default("image/png"),
          parentImageId: z.number().optional(),
          quadrant: z
            .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          return { status: "error" as const, error: "故事不存在或无权操作" };
        }

        if (input.parentImageId != null) {
          const parent = await getGeneratedImageById(input.parentImageId);
          if (
            !parent ||
            parent.storyId !== input.storyId ||
            (parent.userId != null && parent.userId !== ctx.user.id)
          ) {
            return { status: "error" as const, error: "原图不存在或无权操作" };
          }
        }

        const buffer = Buffer.from(input.imageBase64, "base64");
        if (buffer.byteLength === 0) {
          return { status: "error" as const, error: "裁切图片为空" };
        }
        if (buffer.byteLength > 12 * 1024 * 1024) {
          return {
            status: "error" as const,
            error: "裁切图片过大，请先压缩或重渲单张首帧",
          };
        }

        const stored = await storeImageBytes(buffer, input.mimeType);
        if (stored.status !== "ok" || !stored.imageUrl) {
          return {
            status: "error" as const,
            error: stored.message ?? "首帧保存失败",
          };
        }

        const shotNo = canonicalizeShotNo(input.shotNo);
        const shotIdentity = shotIdentityForStoryShot(story, input.shotNo);
        const image = await createGeneratedImage({
          projectId: story.projectId ?? null,
          storyId: input.storyId,
          userId: ctx.user.id,
          shotNo,
          shotIdentity,
          imageKey: stored.imageKey ?? null,
          imageUrl: stored.imageUrl,
          prompt: `从四宫格候选图裁出单张首帧${input.quadrant ? `（${input.quadrant}）` : ""}`,
          parentImageId: input.parentImageId ?? null,
          generationType: "initial",
          isCurrent: false,
        });

        const promoted = await promoteStoryImageToCurrent({
          userId: ctx.user.id,
          storyId: input.storyId,
          imageId: image.id,
          metadata: {
            source: "frame_crop",
            projectId: story.projectId,
            shotNo,
            shotIdentity,
            parentImageId: input.parentImageId ?? null,
            quadrant: input.quadrant ?? null,
          },
        });
        if (!promoted) {
          return {
            status: "error" as const,
            error: "候选首帧保存成功，但设为当前主图失败",
          };
        }

        return {
          status: "ok" as const,
          imageId: image.id,
          imageUrl: image.imageUrl,
          imageKey: image.imageKey,
          image: {
            id: image.id,
            projectId: image.projectId,
            storyId: image.storyId,
            userId: image.userId,
            shotNo,
            shotIdentity,
            imageKey: image.imageKey,
            imageUrl: image.imageUrl,
            prompt: image.prompt,
            parentImageId: image.parentImageId,
            isCurrent: true,
            isPrimary: true,
            selectionSource: "explicit" as const,
            status: "selected" as const,
            generationType: image.generationType,
            maskKey: image.maskKey,
            createdAt: image.createdAt,
          },
        };
      }),

    promoteStoryImage: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          imageId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const promoted = await promoteStoryImageToCurrent({
          storyId: input.storyId,
          userId: ctx.user.id,
          imageId: input.imageId,
          metadata: { source: "material_drawer" },
        });
        if (!promoted) {
          return { status: "error" as const, error: "图片不存在或无权操作" };
        }
        return { status: "ok" as const, imageId: promoted.image.id };
      }),

    /**
     * 单镜头图生视频：只吃已经确认的首帧图 + 镜头设计表编译出来的视频包。
     * 不在视频里烧字幕；subtitle 只作为模型语义提示和后续合成层输入。
     */
    generateShotVideo: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          shotNo: z.number(),
          stableShotId: z.string().optional(),
          promptCompilationId: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional(),
          imageId: z.number(),
          previousReferenceImageId: z.number().optional(),
          nextReferenceImageId: z.number().optional(),
          prompt: z.string().min(1),
          subtitle: z.string().optional(),
          durationSec: z.number().min(3).max(10).optional(),
          motion: z.enum(["low", "high"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await startShotVideoJob(
          {
            storyId: input.storyId,
            shotNo: input.shotNo,
            stableShotId: input.stableShotId ?? null,
            promptCompilationId: input.promptCompilationId ?? null,
            imageId: input.imageId,
            previousReferenceImageId: input.previousReferenceImageId,
            nextReferenceImageId: input.nextReferenceImageId,
            prompt: input.prompt,
            subtitle: input.subtitle,
            durationSec: input.durationSec ?? 5,
            aspectRatio: "16:9",
            motion: input.motion,
          },
          ctx.user.id
        );

        if (result.status !== "ok") {
          return {
            status: "error" as const,
            error: result.error,
            take: result.take ?? null,
            takeId: result.take?.id,
            taskId: result.take?.taskId ?? undefined,
          };
        }

        return {
          status: "ok" as const,
          take: result.take,
          takeId: result.take.id,
          videoStatus: result.take.status,
          videoUrl: result.take.videoUrl ?? undefined,
          taskId: result.take.taskId ?? undefined,
          prompt: result.take.prompt,
        };
      }),

    adoptVideoTake: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          stableShotId: z.string().min(1),
          takeId: z.number(),
          plannedDurationSec: z.number().min(0.1).max(30),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await adoptVideoTake(input, ctx.user.id);
          return { status: "ok" as const, ...result };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "视频采用失败",
          };
        }
      }),

    updateStoryTimeline: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          expectedVersion: z.number().int().min(0),
          items: z.array(
            z.object({
              stableShotId: z.string().min(1),
              included: z.boolean(),
              position: z.number().int().min(0),
              plannedDurationMs: z.number().min(100),
              transform: z.object({
                cropX: z.number().min(0).max(1),
                cropY: z.number().min(0).max(1),
                cropWidth: z.number().min(0.01).max(1),
                cropHeight: z.number().min(0.01).max(1),
                zoom: z.number().min(1).max(8),
                panX: z.number().min(-1).max(1),
                panY: z.number().min(-1).max(1),
              }),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) {
          return { status: "error" as const, error: "故事不存在或无权操作" };
        }
        try {
          const timeline = await persistStoryTimeline({
            storyId: input.storyId,
            userId: ctx.user.id,
            expectedVersion: input.expectedVersion,
            items: [...input.items]
              .sort((left, right) => left.position - right.position)
              .map((item, position) => ({ ...item, position })),
          });
          return { status: "ok" as const, timeline };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "时间轴保存失败",
          };
        }
      }),

    createDerivationDraft: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          sourceStableShotId: z.string().min(1),
          sourceTakeId: z.number(),
          sourceTimeSec: z.number().min(0),
          crop: z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0.01).max(1),
            height: z.number().min(0.01).max(1),
          }),
          fullFrameBase64: z.string().min(1),
          cropBase64: z.string().min(1),
          mimeType: z
            .enum(["image/png", "image/jpeg", "image/webp"])
            .default("image/png"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const draft = await createDerivationDraft(input, ctx.user.id);
          return { status: "ok" as const, draft };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "派生草稿保存失败",
          };
        }
      }),

    analyzeDerivationDraft: protectedProcedure
      .input(
        z.object({
          draftId: z.number(),
          instruction: z.string().optional(),
          referenceRole: z
            .enum(["person", "scene", "object", "composition"])
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const draft = await analyzeDerivationDraft(input, ctx.user.id);
          return { status: "ok" as const, draft };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "派生分析失败",
          };
        }
      }),

    generateDerivedCandidates: protectedProcedure
      .input(z.object({ draftId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const images = await generateDerivedCandidates(
            input.draftId,
            ctx.user.id
          );
          return {
            status: "ok" as const,
            images: images.map(image => ({
              id: image.id,
              imageUrl: image.imageUrl,
            })),
          };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "派生候选生成失败",
          };
        }
      }),

    confirmDerivedShot: protectedProcedure
      .input(
        z.object({
          draftId: z.number(),
          selectedImageId: z.number(),
          expectedStoryRevision: z.number().int().min(0),
          expectedTimelineVersion: z.number().int().min(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await confirmDerivedShot(input, ctx.user.id);
          return {
            status: "ok" as const,
            operationId: result.operation.id,
          };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "派生镜头确认失败",
          };
        }
      }),

    undoStoryOperation: protectedProcedure
      .input(z.object({ operationId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await undoDerivedShot(input.operationId, ctx.user.id);
          return { status: "ok" as const };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "撤销失败",
          };
        }
      }),

    refreshShotVideoStatus: protectedProcedure
      .input(
        z.object({
          takeId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await refreshVideoTakeStatus(input.takeId, ctx.user.id);
        if (result.status !== "ok") {
          return { status: "error" as const, error: result.error };
        }
        return {
          status: "ok" as const,
          take: result.take,
          takeId: result.take.id,
          videoStatus: result.take.status,
          videoUrl: result.take.videoUrl ?? undefined,
          taskId: result.take.taskId ?? undefined,
          prompt: result.take.prompt,
        };
      }),

    createVideoTakeRange: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          stableShotId: z.string().min(1),
          takeId: z.number(),
          startSec: z.number().min(0),
          endSec: z.number().min(0),
          label: z.string().optional(),
          useOnTimeline: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await createUsableVideoRange(
            {
              storyId: input.storyId,
              stableShotId: input.stableShotId,
              takeId: input.takeId,
              startSec: input.startSec,
              endSec: input.endSec,
              label: input.label,
              useOnTimeline: input.useOnTimeline,
            },
            ctx.user.id
          );
          return {
            status: "ok" as const,
            range: result.range,
            selection: result.selection,
          };
        } catch (error) {
          return {
            status: "error" as const,
            error: error instanceof Error ? error.message : "片段保存失败",
          };
        }
      }),

    selectVideoTimelineSegment: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          stableShotId: z.string().min(1),
          takeId: z.number(),
          rangeId: z.number().nullable().optional(),
          selectionType: z.enum(["full_take", "range"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const selection = await selectVideoTimelineSegment(
            {
              storyId: input.storyId,
              stableShotId: input.stableShotId,
              takeId: input.takeId,
              rangeId: input.rangeId ?? null,
              selectionType: input.selectionType,
            },
            ctx.user.id
          );
          return { status: "ok" as const, selection };
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error ? error.message : "时间轴选择保存失败",
          };
        }
      }),

    clearVideoTimelineSegment: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          stableShotId: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await clearVideoTimelineSegment(
            {
              storyId: input.storyId,
              stableShotId: input.stableShotId,
            },
            ctx.user.id
          );
          return { status: "ok" as const };
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error ? error.message : "时间轴选择清除失败",
          };
        }
      }),

    /**
     * 确定性单图出图：「画出来 / 再来一张」循环的发动机，不经 LLM。
     * rejectImageId 存在时先对该图记 swipe_left（淘汰、进历史），再为焦点镜头出下一张。
     * 配方 = 故事锁定配方，未锁定则零点击默认；失败只返回 error，不动已有资产。
     */
    generateNextImage: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          storyId: z.number(),
          shotNo: z.string(),
          prompt: z.string().min(1),
          rejectImageId: z.number().optional(),
          promptCompilationId: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional(),
          imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [story, assets] = await Promise.all([
          getStoryById(input.storyId, ctx.user.id),
          getStoryImageAssets(input.storyId, ctx.user.id),
        ]);
        if (!story) {
          return { status: "error" as const, message: "故事不存在或无权访问" };
        }

        // 「再来一张」：先淘汰当前这张（记 swipe_left），校验该图属于本人本故事。
        if (input.rejectImageId != null) {
          const rejected = assets.find(
            candidate => candidate.id === input.rejectImageId
          );
          if (rejected && rejected.kind === "story_frame") {
            await createImageSignal({
              userId: ctx.user.id,
              storyId: rejected.storyId ?? input.storyId,
              imageId: rejected.id,
              action: "swipe_left",
              metadata: {
                source: "creation",
                projectId: input.projectId,
                shotNo: rejected.canonicalShotNo,
                rejectedRecipe: storyArtRecipe(story) ?? null,
              },
            });
          }
        }

        const result = await generateNextImage({
          prompt: input.prompt,
          shotNo: input.shotNo,
          projectId: input.projectId,
          storyId: input.storyId,
          userId: ctx.user.id,
          promptCompilationId: input.promptCompilationId ?? null,
          imageProvider: input.imageProvider,
          // 锁定配方优先，未锁定用零点击默认，保证单张也够漂亮、风格一致。
          artDirection: storyArtRecipe(story) ?? defaultArtRecipe(),
          referenceImages: storyArtReferenceImages(story),
          story,
          assets,
        });
        return result;
      }),

    /** Reassign an image to a different shot */
    reassignImage: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          imageId: z.number(),
          newShotNo: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const assets = await getProjectImageAssets(
          input.projectId,
          ctx.user.id
        );
        if (!assets.some(asset => asset.id === input.imageId)) {
          return { success: false as const };
        }
        await reassignImage(input.imageId, input.newShotNo);
        return { success: true };
      }),

    /** SAM 2 segmentation — click a point on an image to get a mask */
    segment: protectedProcedure
      .input(
        z.object({
          imageUrl: z.string().url(),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        })
      )
      .mutation(async ({ input }) => {
        return segmentAtPoint(input.imageUrl, input.x, input.y);
      }),

    /** Inpaint — replace a masked region with a new generation */
    inpaint: protectedProcedure
      .input(
        z.object({
          imageUrl: z.string().url(),
          maskUrl: z.string().url(),
          prompt: z.string().min(1),
          shotNo: z.string(),
          projectId: z.number(),
          // 美术风格跟随当前故事（U3）：取该故事的 artReferences；getStoryById 带 userId 验归属
          storyId: z.number().optional(),
          parentImageId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const story = input.storyId
          ? await getStoryById(input.storyId, ctx.user.id)
          : null;
        const storyReferences = story ? storyArtReferenceImages(story) : [];
        const result = await renderViaGate(
          {
            prompt: input.prompt,
            referenceImages: Array.from(
              new Set([input.imageUrl, ...storyReferences])
            ),
            shotNo: input.shotNo,
            projectId: input.projectId,
            artDirection: story ? storyArtRecipe(story) : undefined,
            styleIndex:
              story &&
              typeof (story.body as Record<string, unknown>)?.styleIndex ===
                "number"
                ? ((story.body as Record<string, unknown>).styleIndex as number)
                : undefined,
          },
          prompt => inpaintImage(input.imageUrl, input.maskUrl, prompt)
        );
        if (result.status === "error" || !result.imageUrl) {
          return {
            status: "error" as const,
            message: result.message ?? "No image returned",
          };
        }
        // Save the inpainted image to DB
        const shotIdentity = story
          ? shotIdentityForStoryShot(story, input.shotNo)
          : null;
        const promptCompilationId =
          story && story.id
            ? await resolveStoryImageCompilationId({
                story,
                storyId: story.id,
                userId: ctx.user.id,
                shotIdentity,
              })
            : null;
        const saved = await createGeneratedImage({
          projectId: input.projectId,
          storyId: story?.id ?? null,
          userId: ctx.user.id,
          shotNo: canonicalizeShotNo(input.shotNo),
          shotIdentity,
          imageKey: `inpaint-${Date.now()}`,
          imageUrl: result.imageUrl,
          prompt: input.prompt,
          promptCompilationId,
          parentImageId: input.parentImageId ?? null,
          generationType: "inpaint",
          maskKey: input.maskUrl,
        });
        return {
          status: "ok" as const,
          image: saved,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
