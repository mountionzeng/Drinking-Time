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
  getProjectShots,
  replaceDirectorShotsForProject,
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
import { generateImage } from "./_core/imageGeneration";
import { saveSnapshot, getRecentAnnotations } from "./services/editContext";
import { getAlmanacDay } from "./services/almanac";
import type { ProjectState } from "./_core/editDiff";
import { nanoid } from "nanoid";
import {
  replyFromStoryAgent,
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
import { segmentAtPoint } from "./services/segmentation";
import { inpaintImage } from "./services/imageGen";
import { renderViaGate } from "./services/renderGate";
import { buildScriptResonanceContextForUser } from "./services/scriptAgent";
import { transcribeAudioBytes } from "./_core/voiceTranscription";
import { createArtRiff } from "./services/artAgent";

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
  userId: number;
  shot: ShotEntry;
  index: number;
}) {
  const { projectId, userId, shot, index } = params;
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
        // 取用户长期情绪画像 + 当前卡片情绪 → 共鸣上下文（意图 / 情绪 + 文学声音）接进剧本
        const resonanceContext = await buildScriptResonanceContextForUser(
          ctx.user.id,
          input.cards
            .map((c) => c.emotion)
            .filter((e): e is string => Boolean(e)),
        );
        const result = await synthesizeShotList({
          cards: input.cards,
          characterHint: input.characterHint,
          visualAnchors: input.visualAnchors as
            | VisualAnchorPayload[]
            | undefined,
          ...(resonanceContext ? { resonanceContext } : {}),
        });
        if (!("error" in result) && input.projectId) {
          await replaceDirectorShotsForProject(
            input.projectId,
            ctx.user.id,
            result.shots.map((shot, index) =>
              storyShotToDbRow({
                projectId: input.projectId!,
                userId: ctx.user.id,
                shot,
                index,
              })
            )
          );
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
        return story;
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
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.id) {
          const existing = await getStoryById(input.id, ctx.user.id);
          if (existing) {
            const title =
              input.title !== undefined
                ? input.title.trim().slice(0, 255) || existing.title
                : existing.title;
            await updateStory(input.id, ctx.user.id, {
              title,
              logline: input.logline,
              theme: input.theme,
              arc: input.arc,
              summary: input.summary,
              projectId: input.projectId,
              body: input.body as object | undefined,
            });
            return await getStoryById(input.id, ctx.user.id);
          }
          // Story not found (e.g. after server restart cleared in-memory state).
          // Fall through to create a new story rather than failing silently.
        }

        const title = input.title?.trim().slice(0, 255) || "未命名";
        const { id: newId } = await createStory({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          title,
          logline: input.logline ?? null,
          theme: input.theme ?? null,
          arc: input.arc ?? null,
          summary: input.summary ?? null,
          body: (input.body ?? {
            cards: [],
            characters: [],
            shots: [],
          }) as object,
        });
        return await getStoryById(newId, ctx.user.id);
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
          prompt: z.string().min(1),
          storyId: z.number(),
          shotNo: z.number().optional(),
          originalImageUrl: z.string().optional(), // 用户照片 URL，用于 image-to-image
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { url } = await renderViaGate(
            {
              prompt: input.prompt,
              // 用户照片既是 image-to-image 基底，也是未来美术判断的参照
              referenceImages: input.originalImageUrl
                ? [input.originalImageUrl]
                : undefined,
              shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
            },
            (prompt) =>
              generateImage({
                prompt,
                // 如果用户提供了照片，作为 originalImages 基底
                ...(input.originalImageUrl
                  ? { originalImages: [{ url: input.originalImageUrl }] }
                  : {}),
              }),
          );
          if (!url) {
            return { status: "error" as const, error: "图片生成返回空结果" };
          }
          // 写入 generatedImages 表（shotNo 转为字符串，统一表结构）
          const image = await createGeneratedImage({
            storyId: input.storyId,
            userId: ctx.user.id,
            shotNo: input.shotNo != null ? String(input.shotNo) : null,
            imageUrl: url,
            prompt: input.prompt,
            generationType: "initial",
            isCurrent: true,
          });
          return { status: "ok" as const, imageUrl: url, imageId: image.id };
        } catch (err) {
          console.error("[generateForMobile] 图片生成失败:", err);
          return {
            status: "error" as const,
            error: err instanceof Error ? err.message : "图片生成失败",
          };
        }
      }),

    // mobileInpaint: 局部修复（用 Forge API 的 originalImages 参数）
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
          const { url } = await renderViaGate(
            {
              prompt: input.prompt,
              referenceImages: [input.originalImageUrl],
              shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
            },
            (prompt) =>
              generateImage({
                prompt,
                originalImages: [{ url: input.originalImageUrl }],
              }),
          );
          if (!url) {
            return { status: "error" as const, error: "局部修复返回空结果" };
          }
          // shotNo 转为字符串
          const image = await createGeneratedImage({
            storyId: input.storyId,
            userId: ctx.user.id,
            shotNo: input.shotNo != null ? String(input.shotNo) : null,
            imageUrl: url,
            prompt: input.prompt,
            generationType: "inpaint",
            parentImageId: input.parentImageId ?? null,
            isCurrent: true,
          });
          return { status: "ok" as const, imageUrl: url, imageId: image.id };
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
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectShots(input.projectId);
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
        })
      )
      .mutation(async ({ input }) => {
        return replyFromCreationAgent({
          message: input.message,
          projectId: input.projectId,
          history: input.history,
          cards: input.cards,
          currentScript: input.currentScript,
          shots: input.shots as ShotContext[] | undefined,
          currentFocusShotNo: input.currentFocusShotNo,
          imageProvider: input.imageProvider,
        });
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
          parentImageId: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await renderViaGate(
          {
            prompt: input.prompt,
            referenceImages: [input.imageUrl],
            shotNo: input.shotNo,
            projectId: input.projectId,
          },
          (prompt) => inpaintImage(input.imageUrl, input.maskUrl, prompt),
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
