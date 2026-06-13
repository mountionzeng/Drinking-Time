import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
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
  getStoryImages,
  createImageSignal,
  getImagesByShotNo,
  getCurrentImageForShot,
  getProjectCurrentImages,
  reassignImage,
} from "./db";
import { saveSnapshot, getRecentAnnotations } from "./services/editContext";
import { getAlmanacDay } from "./services/almanac";
import type { ProjectState } from "./_core/editDiff";
import { nanoid } from "nanoid";
import {
  replyFromStoryAgent,
  deriveMobileImagePrompt,
  synthesizeShotList,
  summarizeHistory,
  handleSelectionEdit,
  type SimilarStoryCardPayload,
  type ShotDraft,
  type ShotEntry,
  type VisualAnchorPayload,
} from "./archive/storyAgent";
import {
  replyFromCreationAgent,
  type ShotContext,
} from "./services/creationAgent";
import { CREATION_GOALS, goalGuidance, detectGoalFromText } from "./services/creationGoal";
import { segmentAtPoint } from "./services/segmentation";
import {
  editImage as editMobileImage,
  generateImage as generateMobileImage,
  generateDraftImage,
  inpaintImage,
} from "./services/imageGen";
import { renderViaGate } from "./services/renderGate";
import { buildScriptResonanceContextForUser } from "./services/scriptAgent";
import { transcribeAudioBytes } from "./_core/voiceTranscription";
import {
  analyzeArtReference,
  createArtRiff,
} from "./services/artAgent";
import { generateArtDirectionCandidates } from "./services/artDirection";
import {
  normalizeStoryArtDirection,
  type ArtRecipeDNA,
} from "../shared/artDirection";
import {
  getStoryRevision,
  mergeStaleStoryBody,
  prepareStoryBody,
} from "./services/storySync";

type StoryRow = NonNullable<Awaited<ReturnType<typeof getStoryById>>>;

function mobileShotNo(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^(?:SH)?0*(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

async function composeStoryWorkspace(
  story: StoryRow,
  syncConflict = false
) {
  const revision = getStoryRevision(story.body);
  try {
    const tableImages = await getStoryImages(story.id);
    const mobileImages = tableImages
      .filter((image) => image.imageUrl)
      .map((image) => ({
        id: image.id,
        imageUrl: image.imageUrl,
        prompt: image.prompt || "画面",
        shotNo: mobileShotNo(image.shotNo),
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
    console.warn("[story workspace] 读取 generatedImages 失败，按正文返回：", err);
    return { ...story, revision, syncConflict };
  }
}

const artRecipeDnaSchema = z.object({
  style: z.array(z.string()),
  palette: z.array(z.string()),
  light: z.array(z.string()),
  composition: z.array(z.string()),
  material: z.array(z.string()),
  negative: z.array(z.string()),
});

const artReferenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.enum(["message-photo", "visual-anchor", "story-card"]),
  purpose: z.enum(["fact", "aesthetic", "both"]),
  selected: z.boolean(),
  imageUrl: z.string().optional(),
  text: z.string().optional(),
  visualStyle: z.array(z.string()).optional(),
  colorPalette: z.array(z.string()).optional(),
  lighting: z.string().optional(),
  composition: z.string().optional(),
  material: z.array(z.string()).optional(),
  confidence: z.number().optional(),
});

function storyArtRecipe(story: { body: unknown }): ArtRecipeDNA | undefined {
  const body =
    story.body && typeof story.body === "object"
      ? story.body as Record<string, unknown>
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  return direction.phase === "locked" ? direction.recipe : undefined;
}

function storyArtReferenceImages(story: { body: unknown }): string[] {
  const body =
    story.body && typeof story.body === "object"
      ? story.body as Record<string, unknown>
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  const selected = direction.references
    .filter(
      reference =>
        reference.selected &&
        reference.imageUrl &&
        (reference.purpose === "fact" || reference.purpose === "both"),
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
        }),
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

    generateCandidates: protectedProcedure
      .input(
        z.object({
          storyId: z.number(),
          targetContent: z.string().min(1),
          references: z.array(artReferenceSchema),
          round: z.number().int().min(1),
          mode: z.enum(["explore", "converge"]).optional(),
          likedRecipes: z.array(artRecipeDnaSchema).optional(),
          imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const story = await getStoryById(input.storyId, ctx.user.id);
        if (!story) throw new Error("找不到故事，无法开始美术定调。");
        const candidates = await generateArtDirectionCandidates({
          targetContent: input.targetContent,
          references: input.references,
          round: input.round,
          mode: input.mode,
          likedRecipes: input.likedRecipes,
          imageProvider: input.imageProvider,
        });
        return Promise.all(
          candidates.map(async (candidate, index) => {
            const image = await createGeneratedImage({
              projectId: story.projectId ?? null,
              storyId: story.id,
              userId: ctx.user.id,
              shotNo: `ART-R${input.round}-${index + 1}`,
              imageUrl: candidate.imageUrl,
              prompt: candidate.prompt,
              generationType: "generate",
              isCurrent: true,
            });
            return { ...candidate, imageId: image.id };
          }),
        );
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
          projectId: z.number().optional(),
          photoUrl: z.string().optional(), // 用户上传的照片 URL，传给 LLM 做多模态理解
        })
      )
      .mutation(async ({ input }) => {
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
          photoUrl: input.photoUrl,
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
        // 可观测：把注入剧本的共鸣上下文打到日志，方便测试时确认「意图+情绪+文学声音」是否生效
        if (resonanceContext) {
          console.log(
            `\n[共鸣·剧本] user=${ctx.user.id} ✅ 已注入（${input.cards.length} 张卡片）：\n${resonanceContext}\n`,
          );
        } else {
          console.log(
            `[共鸣·剧本] user=${ctx.user.id} ⚪ 未注入（卡片无情绪 + 无长期情绪画像 → 共鸣信号为空，剧本行为与接入前一致）`,
          );
        }
        const result = await synthesizeShotList({
          cards: input.cards,
          characterHint: input.characterHint,
          visualAnchors: input.visualAnchors as
            | VisualAnchorPayload[]
            | undefined,
          ...(resonanceContext ? { resonanceContext } : {}),
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
        return composeStoryWorkspace(story);
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
                  ? mergeStaleStoryBody(
                      existing.body,
                      input.body,
                      nextRevision
                    )
                  : prepareStoryBody(input.body, nextRevision);
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
            return saved ? composeStoryWorkspace(saved, syncConflict) : null;
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
        const saved = await getStoryById(newId, ctx.user.id);
        return saved ? composeStoryWorkspace(saved) : null;
      }),

    /** Delete a story */
    storyDelete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteStory(input.id, ctx.user.id);
        return { ok: true };
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
      .mutation(async ({ input }) => {
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
          // final / 缺省 = MJ 正式版。草稿轨不可用时服务端自动回落 MJ。
          mode: z.enum(["draft", "final"]).optional(),
          draftImageId: z.number().optional(), // 确认出正式版时关联草稿图，落库 parentImageId
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const story = await getStoryById(input.storyId, ctx.user.id);
          if (!story) {
            return { status: "error" as const, error: "找不到故事，无法保存图片" };
          }

          // prompt 缺失（手动「画出来」按钮）→ 用最近对话现编一条英文出图 prompt
          let prompt = input.prompt?.trim() ?? "";
          if (!prompt) {
            prompt = await deriveMobileImagePrompt({ history: input.history });
          }
          if (!prompt) {
            return {
              status: "error" as const,
              error: "还没聊到能画的内容，多说两句再点「画出来」？",
            };
          }

          // 出图统一经美术网关：故事锁定的美术 DNA（artDirection）+ 参考图一起喂给
          // artJudge；用户照片优先做 image-to-image 基底，没有就用故事的美术参考图。
          const storyReferences = storyArtReferenceImages(story);
          const referenceImage = input.originalImageUrl || storyReferences[0];
          const gateContext = {
            prompt,
            referenceImages: referenceImage
              ? Array.from(new Set([referenceImage, ...storyReferences]))
              : undefined,
            shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
            projectId: story.projectId ?? undefined,
            artDirection: storyArtRecipe(story),
          };

          // 快轨：秒级草稿小样（flux-schnell，确认构图用），美术 DNA 与慢轨完全同源。
          // 失败（未充值/网络）自动回落到下面的 MJ 慢轨，用户无感知。
          if (input.mode === "draft") {
            const draft = await renderViaGate(gateContext, renderedPrompt =>
              generateDraftImage(renderedPrompt),
            );
            if (draft.status === "ok" && draft.imageUrl) {
              const image = await createGeneratedImage({
                projectId: story.projectId ?? null,
                storyId: input.storyId,
                userId: ctx.user.id,
                shotNo: input.shotNo != null ? String(input.shotNo) : null,
                imageKey: draft.imageKey ?? null,
                imageUrl: draft.imageUrl,
                prompt,
                generationType: "generate", // 草稿小样；确认后由 final 轨出 MJ 正式版
                isCurrent: true,
              });
              return {
                status: "ok" as const,
                imageUrl: draft.imageUrl,
                imageId: image.id,
                prompt,
                mode: "draft" as const,
              };
            }
            console.warn(
              "[generateForMobile] 草稿轨不可用，自动回落 MJ：",
              draft.message,
            );
          }

          // 慢轨正式版：全质量 MJ turbo（双轨已成立，确认后这一版要美术最佳，不降质）
          const result = await renderViaGate(gateContext, renderedPrompt =>
            referenceImage
              ? editMobileImage(referenceImage, renderedPrompt)
              : generateMobileImage(renderedPrompt),
          );
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
            shotNo: input.shotNo != null ? String(input.shotNo) : null,
            imageKey: result.imageKey ?? null,
            imageUrl: result.imageUrl,
            prompt,
            generationType: "initial",
            parentImageId: input.draftImageId ?? null, // 由草稿确认而来时，链回草稿
            isCurrent: true,
          });
          return {
            status: "ok" as const,
            imageUrl: result.imageUrl,
            imageId: image.id,
            prompt,
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
            return { status: "error" as const, error: "找不到故事，无法保存图片" };
          }

          // 局部修复同样经美术网关：带上故事的美术 DNA 和参考图
          const storyReferences = storyArtReferenceImages(story);
          const result = await renderViaGate(
            {
              prompt: input.prompt,
              referenceImages: Array.from(
                new Set([input.originalImageUrl, ...storyReferences]),
              ),
              shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
              projectId: story.projectId ?? undefined,
              artDirection: storyArtRecipe(story),
            },
            renderedPrompt =>
              editMobileImage(input.originalImageUrl, renderedPrompt),
          );
          if (result.status === "error" || !result.imageUrl) {
            return {
              status: "error" as const,
              error: result.message ?? "局部修复返回空结果",
            };
          }
          // shotNo 转为字符串
          const image = await createGeneratedImage({
            projectId: story.projectId ?? null,
            storyId: input.storyId,
            userId: ctx.user.id,
            shotNo: input.shotNo != null ? String(input.shotNo) : null,
            imageKey: result.imageKey ?? null,
            imageUrl: result.imageUrl,
            prompt: input.prompt,
            generationType: "inpaint",
            parentImageId: input.parentImageId ?? null,
            isCurrent: true,
          });
          return { status: "ok" as const, imageUrl: result.imageUrl, imageId: image.id };
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
      .query(async ({ input }) => {
        return getStoryImages(input.storyId);
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
        // 故事来源改为传入的当前故事（U3），getStoryById 带 userId 验归属，
        // 防"猜 storyId 让 agent 以他人故事作上下文/写镜头"。无 storyId 则无故事上下文。
        const story = input.storyId
          ? await getStoryById(input.storyId, ctx.user.id)
          : null;
        // 自动识别意图（U·自动意图）：用户没手动选目标时，从这句话+最近几条用户消息
        // 自动认出求职/社媒/记录；手动选了就以手动为准。
        const effectiveGoal =
          input.goal && input.goal !== "unset"
            ? input.goal
            : detectGoalFromText(
                [
                  input.message,
                  ...(input.history ?? [])
                    .filter((t) => t.role === "user")
                    .slice(-4)
                    .map((t) => t.content ?? ""),
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
          artDirection: story ? storyArtRecipe(story) : undefined,
          referenceImages: story ? storyArtReferenceImages(story) : undefined,
        });

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

        return { ...result, builtShotCount };
      }),

    /** Get all images for a shot */
    getShotImages: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          shotNo: z.string(),
        })
      )
      .query(async ({ input }) => {
        return getImagesByShotNo(input.projectId, input.shotNo);
      }),

    /** Get the current (main) image for a shot */
    getCurrentImage: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          shotNo: z.string(),
        })
      )
      .query(async ({ input }) => {
        return getCurrentImageForShot(input.projectId, input.shotNo);
      }),

    /** Get all current images for a project */
    getProjectImages: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectCurrentImages(input.projectId);
      }),

    /** Reassign an image to a different shot */
    reassignImage: protectedProcedure
      .input(
        z.object({
          imageId: z.number(),
          newShotNo: z.string(),
        })
      )
      .mutation(async ({ input }) => {
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
              new Set([input.imageUrl, ...storyReferences]),
            ),
            shotNo: input.shotNo,
            projectId: input.projectId,
            artDirection: story ? storyArtRecipe(story) : undefined,
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
        const saved = await createGeneratedImage({
          projectId: input.projectId,
          shotNo: input.shotNo,
          imageKey: `inpaint-${Date.now()}`,
          imageUrl: result.imageUrl,
          prompt: input.prompt,
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
