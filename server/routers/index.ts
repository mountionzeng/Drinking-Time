import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
import { getSessionCookieOptions } from "../_core/cookies";
import { systemRouter } from "../_core/systemRouter";
import {
  adminProcedure,
  publicProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import { assertProjectOwner } from "./_projectAccess";
import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";
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
  updateShot,
  batchUpdateShots,
  createAnalysisResult,
  getProjectAnalysis,
  getEmotionAnalysisProfile,
  upsertEmotionAnalysisProfile,
  listEmotionDailyLetters,
  getAccessOverview,
  getInviteOverview,
  recordAccessHeartbeat,
} from "../db";
import { saveSnapshot, getRecentAnnotations } from "../services/editContext";
import { getAlmanacDay } from "../services/almanac";
import {
  chinaDateString,
  personalizeEmotionDailyReference302,
} from "../services/emotionDailyReference302";
import { getFreshEmotionAnalysisProfile } from "../services/emotionProfileDailyRefresh";
import {
  EmotionDailyLetterConflictError,
  EmotionDailyLetterNotFoundError,
  rewriteEmotionDailyLetter,
  saveDailyLetterFromProfile,
} from "../services/emotionDailyLetters";
import { calculateBirthPillarsLabel } from "@shared/bazi";
import { consumeGuestEmotionAllowance } from "../services/guestEmotionRateLimit";
import type { ProjectState } from "../_core/editDiff";
import { nanoid } from "nanoid";
import { transcribeAudioBytes } from "../_core/voiceTranscription";
import { analyzeArtReference, createArtRiff } from "../services/artAgent";
import {
  artPromptLibraryRouter,
  promptLineageRouter,
  storyConversationRouter,
} from "./promptLineage";
import { storyAgentRouter } from "./storyAgent";
import { creationAgentRouter } from "./creationAgent";
import { personalMemoryRouter } from "./personalMemory";
import { publishingDraftRouter } from "./publishingDraft";
import { visualAssetsRouter } from "./visualAssets";

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
const emotionProfileTransferSchema = z.object({
  guestId: z.string().regex(/^guest-[a-zA-Z0-9-]{8,80}$/),
  birthDate: birthDateSchema,
  dailyReference: emotionAnalysisPayloadSchema,
  analysisSeed: emotionAnalysisPayloadSchema,
  consentAccepted: z.literal(true),
  consentText: z.string().max(1000),
});

function assertGuestEmotionPayloadBounds(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 64 * 1024) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "访客回信内容过大" });
  }
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 2_000 || depth > 8) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "访客回信结构过深" });
    }
    if (typeof node === "string" && node.length > 4_000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "访客回信文本过长" });
    }
    if (Array.isArray(node)) {
      if (node.length > 200) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "访客回信条目过多",
        });
      }
      node.forEach(item => visit(item, depth + 1));
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(item => visit(item, depth + 1));
    }
  };
  visit(value, 0);
}

type EmotionPayload = Record<string, unknown>;

function emotionPayload(value: unknown): EmotionPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as EmotionPayload)
    : {};
}

function mergeEmotionMessageHistory(
  accountSeed: EmotionPayload,
  guestSeed: EmotionPayload
) {
  const rows = [
    ...(Array.isArray(accountSeed.messageHistory)
      ? accountSeed.messageHistory
      : []),
    ...(Array.isArray(guestSeed.messageHistory)
      ? guestSeed.messageHistory
      : []),
  ];
  const seen = new Set<string>();
  return rows
    .filter(
      row =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        typeof (row as EmotionPayload).text === "string" &&
        typeof (row as EmotionPayload).saidAt === "string"
    )
    .filter(row => {
      const item = row as EmotionPayload;
      const key = `${String(item.saidAt)}:${String(item.text)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-30);
}

function mergeGuestAnalysisSeed({
  accountSeed,
  guestSeed,
  sameBirthDate,
}: {
  accountSeed: EmotionPayload;
  guestSeed: EmotionPayload;
  sameBirthDate: boolean;
}) {
  const messageHistory = mergeEmotionMessageHistory(accountSeed, guestSeed);
  const guestMessage =
    typeof guestSeed.userMessage === "string"
      ? guestSeed.userMessage.trim().slice(0, 800)
      : "";
  const birthTime =
    typeof accountSeed.birthTime === "string" && accountSeed.birthTime.trim()
      ? accountSeed.birthTime
      : sameBirthDate && typeof guestSeed.birthTime === "string"
        ? guestSeed.birthTime
        : undefined;
  return {
    ...accountSeed,
    ...(!accountSeed.birthPlace && sameBirthDate && guestSeed.birthPlace
      ? { birthPlace: guestSeed.birthPlace }
      : {}),
    ...(!accountSeed.currentLocation && guestSeed.currentLocation
      ? { currentLocation: guestSeed.currentLocation }
      : {}),
    ...(birthTime ? { birthTime } : {}),
    ...(messageHistory.length ? { messageHistory } : {}),
    ...(guestMessage
      ? {
          userMessage: guestMessage,
          conversationMode:
            guestSeed.conversationMode === "history" ? "history" : "today",
        }
      : {}),
    importedFromLocalAt: new Date().toISOString(),
  };
}
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

  accessAnalytics: router({
    heartbeat: protectedProcedure
      .input(
        z.object({
          visitId: z.string().min(8).max(64),
          siteHost: z.string().min(1).max(255),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const session = await recordAccessHeartbeat({
          userId: ctx.user.id,
          visitId: input.visitId,
          siteHost: input.siteHost.trim().toLowerCase(),
        });
        return {
          lastSeenAt: session.lastSeenAt,
          durationSeconds: session.durationSeconds,
        };
      }),
    overview: adminProcedure
      .input(
        z.object({
          siteHost: z.string().min(1).max(255),
        })
      )
      .query(async ({ input }) => ({
        generatedAt: new Date(),
        users: await getAccessOverview(input.siteHost.trim().toLowerCase()),
      })),
    invites: adminProcedure.query(async () => {
      const generatedAt = new Date();
      return {
        generatedAt,
        invites: await getInviteOverview(generatedAt),
      };
    }),
  }),

  personalMemory: personalMemoryRouter,

  promptLineage: promptLineageRouter,

  artPromptLibrary: artPromptLibraryRouter,

  storyConversation: storyConversationRouter,

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
        await assertProjectOwner(input.projectId, ctx.user.id);
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
      .query(async ({ ctx, input }) => {
        await assertProjectOwner(input.projectId, ctx.user.id);
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
        await assertProjectOwner(input.projectId, ctx.user.id);
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
      .query(async ({ ctx, input }) => {
        await assertProjectOwner(input.projectId, ctx.user.id);
        return getProjectAnalysis(input.projectId);
      }),
  }),

  // ─── Emotion Analysis（长期情绪画像底盘）───────────────────────────────
  emotionAnalysis: router({
    guestReply: publicProcedure
      .input(emotionProfileTransferSchema)
      .mutation(async ({ ctx, input }) => {
        const allowance = consumeGuestEmotionAllowance({
          ip: ctx.req.ip || ctx.req.socket?.remoteAddress || "unknown",
          guestId: input.guestId,
        });
        if (!allowance.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `今天先聊到这里，约 ${Math.ceil(
              allowance.retryAfterSeconds / 60
            )} 分钟后可以继续。`,
          });
        }
        assertGuestEmotionPayloadBounds(input);

        const today = chinaDateString();
        const almanac = await getAlmanacDay(today);
        const birthTime =
          typeof input.analysisSeed.birthTime === "string"
            ? input.analysisSeed.birthTime.trim()
            : "";
        const birthBazi = calculateBirthPillarsLabel(
          input.birthDate,
          birthTime
        );
        const analysisSeed = {
          ...input.analysisSeed,
          birthDate: input.birthDate,
          ...(birthBazi ? { birthBazi } : {}),
        };
        const personalized = await personalizeEmotionDailyReference302({
          date: today,
          almanac,
          baseDailyReference: input.dailyReference,
          analysisSeed,
          generationIntent: "conversation-reply",
          computeUseCase: "login-guest",
        });

        // 访客回信只返回浏览器；这里不写画像表，也不写每日信件表。
        return {
          birthDate: input.birthDate,
          dailyReference: personalized.dailyReference,
          analysisSeed,
          consentVersion: "emotion-analysis-v1",
          consentText: input.consentText,
          savedAt: new Date().toISOString(),
          source: "local" as const,
          computeSource: personalized.source,
          computeModel: personalized.model,
        };
      }),

    getProfile: protectedProcedure.query(async ({ ctx }) => {
      return getFreshEmotionAnalysisProfile(ctx.user.id);
    }),

    listDailyLetters: protectedProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(365).default(90),
          })
          .default({ limit: 90 })
      )
      .query(async ({ ctx, input }) => {
        return listEmotionDailyLetters(ctx.user.id, input.limit);
      }),

    rewriteDailyLetter: protectedProcedure
      .input(
        z.object({
          letterDate: birthDateSchema,
          userMessage: z.string().max(800),
          expectedRevision: z.number().int().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await rewriteEmotionDailyLetter({
            userId: ctx.user.id,
            letterDate: input.letterDate,
            userMessage: input.userMessage,
            expectedRevision: input.expectedRevision,
          });
        } catch (error) {
          if (error instanceof EmotionDailyLetterNotFoundError) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: error.message,
            });
          }
          if (error instanceof EmotionDailyLetterConflictError) {
            throw new TRPCError({
              code: "CONFLICT",
              message: error.message,
            });
          }
          throw error;
        }
      }),

    importGuestProfile: protectedProcedure
      .input(emotionProfileTransferSchema)
      .mutation(async ({ ctx, input }) => {
        const existing = await getEmotionAnalysisProfile(ctx.user.id);
        const guestSeed = emotionPayload(input.analysisSeed);
        const accountSeed = emotionPayload(existing?.analysisSeed);
        const birthDate = existing?.birthDate ?? input.birthDate;
        const sameBirthDate = birthDate === input.birthDate;
        const mergedSeed = existing
          ? mergeGuestAnalysisSeed({
              accountSeed,
              guestSeed,
              sameBirthDate,
            })
          : guestSeed;
        const birthTime =
          typeof mergedSeed.birthTime === "string"
            ? mergedSeed.birthTime.trim()
            : "";
        const birthBazi = calculateBirthPillarsLabel(birthDate, birthTime);
        const analysisSeed = {
          ...mergedSeed,
          birthDate,
          ...(birthBazi ? { birthBazi } : {}),
        };
        const today = chinaDateString();
        const almanac = await getAlmanacDay(today);
        const personalized = await personalizeEmotionDailyReference302({
          date: today,
          almanac,
          baseDailyReference:
            existing?.dailyReference &&
            typeof existing.dailyReference === "object"
              ? emotionPayload(existing.dailyReference)
              : input.dailyReference,
          analysisSeed,
          generationIntent: "conversation-reply",
        });
        const saved = await upsertEmotionAnalysisProfile({
          userId: ctx.user.id,
          projectId: existing?.projectId ?? null,
          birthDate,
          consentVersion: "emotion-analysis-v1",
          consentText: input.consentText,
          dailyReference: personalized.dailyReference,
          analysisSeed,
        });
        await saveDailyLetterFromProfile(saved);
        return saved;
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
        const today = chinaDateString();
        const almanac = await getAlmanacDay(today);
        const birthTime =
          typeof input.analysisSeed.birthTime === "string"
            ? input.analysisSeed.birthTime.trim()
            : "";
        const birthBazi = calculateBirthPillarsLabel(
          input.birthDate,
          birthTime
        );
        const analysisSeed = birthBazi
          ? { ...input.analysisSeed, birthBazi }
          : input.analysisSeed;
        const personalized = await personalizeEmotionDailyReference302({
          date: today,
          almanac,
          baseDailyReference: input.dailyReference,
          analysisSeed,
          generationIntent: "conversation-reply",
        });
        const saved = await upsertEmotionAnalysisProfile({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          birthDate: input.birthDate,
          consentVersion: "emotion-analysis-v1",
          consentText: input.consentText,
          dailyReference: personalized.dailyReference,
          analysisSeed,
        });
        await saveDailyLetterFromProfile(saved);
        return saved;
      }),
  }),

  // ─── Story Guide Agent ──────────────────────────────────────────────
  // Wraps archive/storyAgent functions as tRPC procedures.
  // Chat, classify (shot list synthesis), summarize, and story CRUD.
  storyAgent: storyAgentRouter,
  publishingDraft: publishingDraftRouter,
  visualAssets: visualAssetsRouter,

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
        await assertProjectOwner(input.projectId, ctx.user.id);
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
      .query(async ({ ctx, input }) => {
        await assertProjectOwner(input.projectId, ctx.user.id);
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
  creationAgent: creationAgentRouter,
});

export type AppRouter = typeof appRouter;
