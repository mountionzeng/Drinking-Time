import { z } from "zod";
import { nanoid } from "nanoid";
import { isDeepStrictEqual } from "node:util";
import { intentProposalId } from "@shared/storyIntentProfile";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
import { canonicalizeShotNo } from "@shared/imageAsset";
import { extractedFrameTimeMs } from "@shared/extractedFrameTransition";
import { normalizeSuggestedStoryTitle } from "@shared/storyTitle";
import { protectedProcedure, router } from "../_core/trpc";
import { assertOptionalProjectOwner } from "./_projectAccess";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";
import {
  replaceDirectorShotsForStory,
  listUserStories,
  getStoryById,
  createStory,
  writeStoryTitle,
  deleteStory,
  createGeneratedImage,
  getGeneratedImageById,
  createImageSignal,
  promoteStoryImageToCurrent,
  deleteGeneratedImage,
  insertTransitionShotAtomic,
  restoreSplitStoryShotAtomic,
} from "../db";
import {
  replyFromStoryAgent,
  deriveMobileImagePrompt,
  recognizeStoryIntent,
  synthesizeShotList,
  summarizeHistory,
  handleSelectionEdit,
  type SimilarStoryCardPayload,
  type ShotDraft,
  type StoryCardContextPayload,
  type StoryIntentPayload,
  type VisualAnchorPayload,
} from "../archive/storyAgent";
import {
  editImage as editMobileImage,
  generateDraftImage,
  generateImage as generateMobileImage,
} from "../services/imageGen";
import { renderViaGate } from "../services/renderGate";
import {
  getStoryImageAssets,
  materializeImageInput,
} from "../services/imageAssets";
import { getStoryVideoAssets } from "../services/videoAssets";
import { getStoryMaterialState } from "../services/storyMaterials";
import { buildScriptResonanceContextForUser } from "../services/scriptAgent";
import { composeScenePrompt } from "../services/composeScenePrompt";
import { withCharacterContinuityPrompt } from "../services/characterContinuity";
import {
  deriveInjection,
  deriveStoryboardReferenceInjection,
} from "../services/imageInjection";
import { synthesizeShotPrompt } from "../services/synthesizeShotPrompt";
import { directImagePrompt } from "../services/imagePromptDirector";
import { planImageGenerationReferences } from "../services/imageGenerationReference";
import { resolveVisualAssetGenerationContext } from "../services/visualAssetGenerationContext";
import { runStoryTimelineCommand } from "../services/storyTimelineEditing";
import {
  applyPublishingCoverArtDirection,
  resolvePublishingCoverArtDirection,
} from "../services/publishingCoverArtDirection";
import { compilePublishingCoverStoryboardPrompt } from "../services/publishingCoverStoryboardPrompt";
import {
  normalizeStoryArtDirection,
  characterReferenceOf,
} from "../../shared/artDirection";
import {
  getStoryRevision,
  mergeStaleStoryBody,
  prepareStoryBody,
} from "../services/storySync";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "../services/storyBodyPersistence";
import {
  deleteStoryShotAtIndex,
  insertStoryShotAfter,
  restoreStoryShotAtIndex,
  splitStoryShotAtIndex,
} from "../../shared/storyShotEditing";
import { splitTimelineItem } from "../../shared/timelineEditing";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  timelineMsToFrames,
} from "../../shared/storyMaterial";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import {
  initializeStoryboardFieldVersions,
  recordStoryboardFieldVersions,
  restoreStoryboardFieldVersion,
  STORYBOARD_VERSIONED_FIELDS,
} from "../../shared/storyboardFieldVersions";
import {
  estimateStoryboardImageCost,
  estimateStoryboardMaskedEditCost,
} from "../../shared/imageRenderCost";
import {
  generateStoryVoice302,
  type StoryVoice302Result,
} from "../services/storyVoice302";
import { getActiveStyles } from "../services/styleLibrary";
import { sceneAnalysisSchema } from "../../shared/sceneAnalysis";
import {
  persistedStoryIdSchema,
  stableShotIdSchema,
  storyShotUpdateCommandSchema,
} from "../../shared/storyContract";
import {
  type PromptContext,
  buildUnifiedPrompt,
} from "../../shared/promptContext";
import { migrateStoryPromptLineage } from "../services/promptLineageMigration";
import { applyStoryShotFieldPatch } from "../services/storyShotFieldPatch";
import {
  attachChatCutXmlToStory,
  importChatCutXmlStory,
  MAX_CHATCUT_XML_BYTES,
  parseChatCutXml,
  summarizeChatCutImport,
} from "../services/chatCutXml";
import {
  artRecipeFromStyleHint,
  buildConfirmedIntentLine,
  composeStoryWorkspace,
  resolveStoryImageCompilationId,
  selectionContextSchema,
  shotIdentityForStoryShot,
  storyArtRecipe,
  storyArtReferenceImages,
  storyPromptLineageBody,
  storyShotToDbRow,
  writeCharacterAnchor,
} from "./_storyShared";

const inFlightStoryVoiceGenerations = new Map<
  string,
  Promise<StoryVoice302Result>
>();
const recentStoryVoiceGenerations = new Map<
  string,
  { result: StoryVoice302Result; expiresAt: number }
>();
const STORY_VOICE_RETRY_CACHE_MS = 5 * 60_000;
let lastStoryVoiceRequestStartedAt = 0;

function nextStoryVoiceRequestStartedAt(): number {
  lastStoryVoiceRequestStartedAt = Math.max(
    Date.now(),
    lastStoryVoiceRequestStartedAt + 1
  );
  return lastStoryVoiceRequestStartedAt;
}

function storyVoiceGenerationKey(input: {
  userId: number;
  storyId: number;
  stableShotId: string;
  text: string;
  provider: string;
  voice: string;
}): string {
  return JSON.stringify(input);
}

function generateStoryVoiceOnce(input: {
  key: string;
  text: string;
  provider?: string;
  voice?: string;
}): Promise<StoryVoice302Result> {
  const cached = recentStoryVoiceGenerations.get(input.key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }
  if (cached) recentStoryVoiceGenerations.delete(input.key);
  const existing = inFlightStoryVoiceGenerations.get(input.key);
  if (existing) return existing;
  const pending = generateStoryVoice302({
    text: input.text,
    provider: input.provider,
    voice: input.voice,
  })
    .then(result => {
      recentStoryVoiceGenerations.set(input.key, {
        result,
        expiresAt: Date.now() + STORY_VOICE_RETRY_CACHE_MS,
      });
      return result;
    })
    .finally(() => {
      if (inFlightStoryVoiceGenerations.get(input.key) === pending) {
        inFlightStoryVoiceGenerations.delete(input.key);
      }
    });
  inFlightStoryVoiceGenerations.set(input.key, pending);
  return pending;
}

async function syncStoryPromptLineageAfterMutation(input: {
  storyId: number;
  userId: number;
  body: ReturnType<typeof storyPromptLineageBody>;
  warningLabel: string;
}): Promise<void> {
  try {
    await migrateStoryPromptLineage({
      storyId: input.storyId,
      userId: input.userId,
      body: input.body,
    });
  } catch (error) {
    console.warn(`${input.warningLabel} prompt lineage sync failed`, error);
  }
}

function canUndoSplitAfterRevisionOnlyResave(input: {
  currentBody: unknown;
  beforeBody: Record<string, unknown>;
  splitStableShotId: string;
}): boolean {
  const currentBody =
    input.currentBody &&
    typeof input.currentBody === "object" &&
    !Array.isArray(input.currentBody)
      ? (input.currentBody as Record<string, unknown>)
      : {};
  const currentShots = Array.isArray(currentBody.shots)
    ? currentBody.shots.filter((shot): shot is Record<string, unknown> =>
        Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
  const beforeShots = Array.isArray(input.beforeBody.shots)
    ? input.beforeBody.shots.filter((shot): shot is Record<string, unknown> =>
        Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
  const rightIndex = currentShots.findIndex(
    (shot, index) =>
      shotIdentityFromShot(shot, index) === input.splitStableShotId
  );
  if (rightIndex <= 0 || currentShots.length !== beforeShots.length + 1) {
    return false;
  }
  const leftDurationMs = Number(currentShots[rightIndex - 1]?.durationMs);
  const rightDurationMs = Number(currentShots[rightIndex]?.durationMs);
  if (!Number.isFinite(leftDurationMs) || !Number.isFinite(rightDurationMs)) {
    return false;
  }
  const expectedSplit = splitStoryShotAtIndex({
    shots: beforeShots,
    index: rightIndex - 1,
    rightStableShotId: input.splitStableShotId,
    leftDurationMs,
    rightDurationMs,
  });
  if (!expectedSplit) return false;
  const expectedBody = prepareStoryBody(
    { ...input.beforeBody, shots: expectedSplit.shots },
    getStoryRevision(currentBody),
    currentBody
  );
  const withoutDisplayShotKeys = (body: Record<string, unknown>) => ({
    ...body,
    shots: Array.isArray(body.shots)
      ? body.shots.map(shot => {
          if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
            return shot;
          }
          const { shotKey: _shotKey, ...rest } = shot as Record<
            string,
            unknown
          >;
          return rest;
        })
      : body.shots,
  });
  return isDeepStrictEqual(
    withoutDisplayShotKeys(expectedBody),
    withoutDisplayShotKeys(currentBody)
  );
}

function canRestoreDeletedAfterRevisionOnlyResave(input: {
  currentBody: unknown;
  afterDeleteBody: Record<string, unknown>;
}): boolean {
  const currentBody =
    input.currentBody &&
    typeof input.currentBody === "object" &&
    !Array.isArray(input.currentBody)
      ? (input.currentBody as Record<string, unknown>)
      : {};
  const expectedBody = prepareStoryBody(
    input.afterDeleteBody,
    getStoryRevision(currentBody),
    currentBody
  );
  const withoutDisplayShotKeys = (body: Record<string, unknown>) => ({
    ...body,
    shots: Array.isArray(body.shots)
      ? body.shots.map(shot => {
          if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
            return shot;
          }
          const { shotKey: _shotKey, ...rest } = shot as Record<
            string,
            unknown
          >;
          return rest;
        })
      : body.shots,
  });
  return isDeepStrictEqual(
    withoutDisplayShotKeys(expectedBody),
    withoutDisplayShotKeys(currentBody)
  );
}

export const storyAgentRouter = router({
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
              stableShotId: z.string().optional(),
              cueCode: z.string().optional(),
              actNo: z.string().optional(),
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
              intent: z.string().optional(),
              videoStart: z.string().optional(),
              videoEnd: z.string().optional(),
              transitionIn: z.string().optional(),
              transitionOut: z.string().optional(),
              videoPrompt: z.string().optional(),
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
        interactionMode: z.enum(["story", "publishing"]).optional(),
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
      // projectId 会被用来捞该项目的编辑标注/重复修正信号喂给模型——是访问键，
      // 不是标签。不校验归属就能把别人项目的编辑上下文读进自己的对话里。
      await assertOptionalProjectOwner(input.projectId, ctx.user.id);
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
        interactionMode: input.interactionMode,
      });
    }),

  /** Inline selection edit — modify only the selected portion */
  selectionEdit: protectedProcedure
    .input(
      z.object({
        fullText: z.string().min(1),
        selectedText: z.string().min(1),
        instruction: z.string().min(1),
        promptRewrite: z.boolean().optional(),
        selectionContext: selectionContextSchema.optional(),
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
        promptRewrite: input.promptRewrite,
        selectionContext: input.selectionContext,
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
            dialogue: z.string().optional(),
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
        generationProfile: z
          .object({
            scriptStyle: z
              .object({
                id: z.string().optional(),
                label: z.string().optional(),
                logline: z.string().optional(),
                arc: z.string().optional(),
                treatment: z.string().optional(),
              })
              .nullish(),
            artStyle: z
              .object({
                id: z.string().optional(),
                source: z.enum(["preset", "library"]).optional(),
                title: z.string().optional(),
                description: z.string().nullable().optional(),
                libraryVersionId: z
                  .number()
                  .int()
                  .positive()
                  .nullable()
                  .optional(),
                recipe: z
                  .object({
                    style: z.array(z.string()).optional(),
                    palette: z.array(z.string()).optional(),
                    light: z.array(z.string()).optional(),
                    composition: z.array(z.string()).optional(),
                    material: z.array(z.string()).optional(),
                    negative: z.array(z.string()).optional(),
                  })
                  .nullable()
                  .optional(),
                items: z
                  .array(
                    z.object({
                      dimension: z.string().optional(),
                      content: z.string().optional(),
                      negativeContent: z.string().nullable().optional(),
                    })
                  )
                  .optional(),
              })
              .nullish(),
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
        visualAnchors: input.visualAnchors as VisualAnchorPayload[] | undefined,
        confirmedIntent: input.confirmedIntent ?? undefined,
        generationProfile: input.generationProfile ?? undefined,
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
        sourceScope: z
          .object({
            storyId: z.number().int(),
            versionId: z.string().min(1).nullable(),
            intentRevision: z.number().int().nonnegative(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const turns = input.history.filter(t => t.content.trim());
      const message = turns.length ? turns[turns.length - 1].content : "";
      const recognized = await recognizeStoryIntent({
        message,
        history: turns.slice(0, -1),
        existingIntent:
          (input.existingIntent as StoryIntentPayload | null | undefined) ??
          null,
      });
      if (!input.sourceScope) return recognized;
      return {
        ...recognized,
        proposal: {
          id: intentProposalId({
            source: input.sourceScope,
            candidate: recognized,
          }),
          status: "pending" as const,
          source: {
            kind: "recognition" as const,
            ...input.sourceScope,
          },
          evidence: recognized.evidence ?? [],
        },
      };
    }),

  /** 读取 ChatCut / Premiere XMEML，只返回导入预览，不写故事。 */
  inspectChatCutXml: protectedProcedure
    .input(
      z.object({
        xml: z
          .string()
          .min(1, "XML 文件为空")
          .max(MAX_CHATCUT_XML_BYTES, "XML 文件过大，请控制在 2MB 以内"),
      })
    )
    .mutation(async ({ input }) => {
      return summarizeChatCutImport(parseChatCutXml(input.xml));
    }),

  /**
   * ChatCut XML → 独立聊聊故事。主剪辑轨转换为线性镜头时间轴，
   * 多轨、音频、入出点、变换与变速保存在故事导入清单里，供后续重关联。
   */
  importChatCutXml: protectedProcedure
    .input(
      z.object({
        xml: z
          .string()
          .min(1, "XML 文件为空")
          .max(MAX_CHATCUT_XML_BYTES, "XML 文件过大，请控制在 2MB 以内"),
        title: z.string().trim().min(1).max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const imported = await importChatCutXmlStory({
        xml: input.xml,
        userId: ctx.user.id,
        title: input.title,
      });
      return {
        status: "ok" as const,
        storyId: imported.story.id,
        title: imported.story.title,
        summary: imported.summary,
      };
    }),

  /** Attach ChatCut timing and audio manifests to the current semantic story. */
  attachChatCutXml: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        xml: z
          .string()
          .min(1, "XML 文件为空")
          .max(MAX_CHATCUT_XML_BYTES, "XML 文件过大，请控制在 2MB 以内"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const attached = await attachChatCutXmlToStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        xml: input.xml,
      });
      return {
        status: "ok" as const,
        storyId: attached.story.id,
        title: attached.story.title,
        summary: attached.summary,
      };
    }),

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
        preserveTitle: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const existing = await getStoryById(input.id, ctx.user.id);
        if (existing) {
          const currentRevision = getStoryRevision(existing.body);
          // 不带 baseRevision 的整包保存（老代码标签页/未知客户端）没有资格全量
          // 替换 body——曾经把刚插入的手动镜头几秒内抹掉。按过期冲突走保守合并。
          const syncConflict =
            input.baseRevision !== undefined
              ? input.baseRevision !== currentRevision
              : input.body !== undefined && currentRevision > 0;
          const nextRevision = currentRevision + 1;
          const title =
            !input.preserveTitle && !syncConflict && input.title !== undefined
              ? input.title.trim().slice(0, 255) || existing.title
              : existing.title;
          const nextBody =
            input.body === undefined
              ? prepareStoryBody(existing.body, nextRevision)
              : syncConflict
                ? mergeStaleStoryBody(existing.body, input.body, nextRevision)
                : prepareStoryBody(input.body, nextRevision, existing.body);
          let saved;
          try {
            saved = await persistPreparedStoryBody({
              storyId: input.id,
              userId: ctx.user.id,
              expectedRevision: currentRevision,
              body: nextBody,
              data: {
                title,
                logline: syncConflict ? undefined : input.logline,
                theme: syncConflict ? undefined : input.theme,
                arc: syncConflict ? undefined : input.arc,
                summary: syncConflict ? undefined : input.summary,
                projectId: syncConflict ? undefined : input.projectId,
              },
            });
          } catch (error) {
            if (error instanceof StoryBodyRevisionConflictError) {
              return composeStoryWorkspace(
                error.latestStory,
                ctx.user.id,
                true
              );
            }
            throw error;
          }
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
        console.warn(
          `[storySave] story ${input.id} not found for user ${ctx.user.id}, ` +
            "falling through to CREATE — 如果日志里频繁出现这行，说明有客户端拿着" +
            "错误的故事 id 在自动保存，会不断复制出新故事"
        );
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

  /** Rename only story metadata; never replace the story body blob. */
  storyRename: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().trim().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const title = input.title.trim();
      const updated = await writeStoryTitle({
        id: input.id,
        userId: ctx.user.id,
        title,
      });
      if (!updated) {
        return { status: "error" as const, error: "故事不存在" };
      }
      return {
        status: "ok" as const,
        storyId: input.id,
        title,
      };
    }),

  /** Apply a generated title only if the persisted title is still a placeholder. */
  storyAutoRename: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        suggestedTitle: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const title = normalizeSuggestedStoryTitle(input.suggestedTitle);
      if (!title) {
        return { status: "error" as const, error: "未生成有效名称" };
      }
      const updated = await writeStoryTitle({
        id: input.id,
        userId: ctx.user.id,
        title,
        onlyIfUntitled: true,
      });
      if (updated) {
        return {
          status: "ok" as const,
          storyId: input.id,
          title,
        };
      }
      const existing = await getStoryById(input.id, ctx.user.id);
      if (!existing) {
        return { status: "error" as const, error: "故事不存在" };
      }
      return {
        status: "skipped" as const,
        storyId: input.id,
        title: existing.title,
      };
    }),

  /**
   * 职责：按 stableShotId 原子提交镜头字段和编辑元数据，不接收整条镜头或 Story body。
   * 调用方：CreationEditorContext 的镜头字段、时长和提示词保存函数。
   * 下游：`persistPreparedStoryBody` 以 revision CAS 落库，再同步 prompt lineage。
   */
  updateStoryShotFields: protectedProcedure
    .input(storyShotUpdateCommandSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await applyStoryShotFieldPatch({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        patch: input.patch,
        metadata: input.metadata,
      });
      if (result.status === "error") {
        return { status: "error" as const, error: result.error };
      }
      const saved = result.story;
      await syncStoryPromptLineageAfterMutation({
        storyId: saved.id,
        userId: ctx.user.id,
        body: storyPromptLineageBody(saved),
        warningLabel: "updateStoryShotFields",
      });
      return {
        status: "ok" as const,
        story: await composeStoryWorkspace(saved, ctx.user.id),
      };
    }),

  /** 先校验故事归属与镜头身份，再调用付费 TTS，并把音频绑定到最新镜头快照。 */
  generateStoryShotVoice: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        stableShotId: stableShotIdSchema,
        text: z.string().trim().min(1).max(5_000),
        provider: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[\w.-]+$/i)
          .optional(),
        voice: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[\w.-]+$/i)
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ownedStory = await getStoryById(input.storyId, ctx.user.id);
      if (!ownedStory) {
        return { status: "error" as const, error: "故事不存在" };
      }
      const ownedBody =
        ownedStory.body &&
        typeof ownedStory.body === "object" &&
        !Array.isArray(ownedStory.body)
          ? (ownedStory.body as Record<string, unknown>)
          : {};
      const ownedShots = Array.isArray(ownedBody.shots) ? ownedBody.shots : [];
      const ownedTargetShot = ownedShots.find(
        (raw, index) =>
          Boolean(raw && typeof raw === "object" && !Array.isArray(raw)) &&
          shotIdentityFromShot(raw, index) === input.stableShotId
      ) as Record<string, unknown> | undefined;
      if (!ownedTargetShot) {
        return { status: "error" as const, error: "镜头不存在或已经更新" };
      }
      const dialogueBeforeGeneration =
        typeof ownedTargetShot.dialogue === "string"
          ? ownedTargetShot.dialogue
          : "";
      const requestStartedAt = nextStoryVoiceRequestStartedAt();
      const requestedProvider = (input.provider ?? ENV.tts302Provider).trim();
      const requestedVoice = (input.voice ?? ENV.tts302Voice).trim();
      const cachedAudioUrl =
        typeof ownedTargetShot.voiceAudioUrl === "string"
          ? ownedTargetShot.voiceAudioUrl.trim()
          : "";
      if (
        cachedAudioUrl &&
        ownedTargetShot.voiceAudioText === input.text &&
        ownedTargetShot.voiceAudioProvider === requestedProvider &&
        ownedTargetShot.voiceAudioVoice === requestedVoice
      ) {
        return {
          status: "ok" as const,
          audioUrl: cachedAudioUrl,
          provider: requestedProvider,
          voice: requestedVoice,
          story: await composeStoryWorkspace(ownedStory, ctx.user.id),
        };
      }

      const voice = await generateStoryVoiceOnce({
        key: storyVoiceGenerationKey({
          userId: ctx.user.id,
          storyId: input.storyId,
          stableShotId: input.stableShotId,
          text: input.text,
          provider: requestedProvider,
          voice: requestedVoice,
        }),
        text: input.text,
        provider: input.provider,
        voice: input.voice,
      });

      // TTS 可能耗时；付费调用只做一次，CAS 冲突时基于最新 Story 重新合并音频字段。
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const latestStory = await getStoryById(input.storyId, ctx.user.id);
        if (!latestStory) {
          return { status: "error" as const, error: "故事不存在" };
        }
        const body =
          latestStory.body &&
          typeof latestStory.body === "object" &&
          !Array.isArray(latestStory.body)
            ? (latestStory.body as Record<string, unknown>)
            : {};
        const shots = Array.isArray(body.shots) ? body.shots : [];
        let found = false;
        let alreadyBound = false;
        let supersededByNewerRequest = false;
        let newerVoice:
          | { audioUrl: string; provider: string; voice: string }
          | undefined;
        const generatedAt = Date.now();
        const nextShots = shots.map((raw, index) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
          if (shotIdentityFromShot(raw, index) !== input.stableShotId)
            return raw;
          found = true;
          const latest = raw as Record<string, unknown>;
          alreadyBound =
            latest.voiceAudioUrl === voice.audioUrl &&
            latest.voiceAudioText === input.text &&
            latest.voiceAudioProvider === voice.provider &&
            latest.voiceAudioVoice === voice.voice;
          const latestDialogue =
            typeof latest.dialogue === "string" ? latest.dialogue : "";
          const latestRequestStartedAt =
            typeof latest.voiceAudioRequestStartedAt === "number"
              ? latest.voiceAudioRequestStartedAt
              : 0;
          const hasCurrentAudioForLatestDialogue =
            latestDialogue !== input.text &&
            typeof latest.voiceAudioUrl === "string" &&
            latest.voiceAudioText === latestDialogue;
          if (
            (latestRequestStartedAt > requestStartedAt ||
              hasCurrentAudioForLatestDialogue) &&
            !alreadyBound
          ) {
            supersededByNewerRequest = true;
            if (
              typeof latest.voiceAudioUrl === "string" &&
              typeof latest.voiceAudioProvider === "string" &&
              typeof latest.voiceAudioVoice === "string"
            ) {
              newerVoice = {
                audioUrl: latest.voiceAudioUrl,
                provider: latest.voiceAudioProvider,
                voice: latest.voiceAudioVoice,
              };
            }
            return raw;
          }
          return {
            ...latest,
            // 生成期间若用户已修改同一格旁白，保留新文字；旧音频会在前端显示为陈旧。
            dialogue:
              latestDialogue === dialogueBeforeGeneration
                ? input.text
                : latestDialogue,
            voiceAudioUrl: voice.audioUrl,
            voiceAudioText: input.text,
            voiceAudioProvider: voice.provider,
            voiceAudioVoice: voice.voice,
            voiceAudioGeneratedAt:
              typeof latest.voiceAudioGeneratedAt === "number" && alreadyBound
                ? latest.voiceAudioGeneratedAt
                : generatedAt,
            voiceAudioRequestStartedAt: alreadyBound
              ? latestRequestStartedAt || requestStartedAt
              : requestStartedAt,
          };
        });
        if (!found) {
          return {
            status: "error" as const,
            error: "镜头不存在或已经更新",
          };
        }
        if (alreadyBound) {
          return {
            status: "ok" as const,
            audioUrl: voice.audioUrl,
            provider: voice.provider,
            voice: voice.voice,
            story: await composeStoryWorkspace(latestStory, ctx.user.id),
          };
        }
        if (supersededByNewerRequest && newerVoice) {
          return {
            status: "ok" as const,
            ...newerVoice,
            story: await composeStoryWorkspace(latestStory, ctx.user.id),
          };
        }

        const recordShots = (items: unknown[]) =>
          items.filter((shot): shot is Record<string, unknown> =>
            Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
          );
        const initializedFieldVersions = initializeStoryboardFieldVersions(
          body.storyboardFieldVersions,
          recordShots(shots),
          generatedAt,
          "edited"
        );
        const storyboardFieldVersions = recordStoryboardFieldVersions({
          state: initializedFieldVersions,
          beforeShots: recordShots(shots),
          afterShots: recordShots(nextShots),
          fields: ["dialogue"],
          now: generatedAt,
          source: "edited",
        });
        const nextBody = prepareStoryBody(
          { ...body, shots: nextShots, storyboardFieldVersions },
          getStoryRevision(latestStory.body) + 1,
          latestStory.body
        );
        try {
          const saved = await persistPreparedStoryBody({
            storyId: latestStory.id,
            userId: ctx.user.id,
            expectedRevision: getStoryRevision(latestStory.body),
            body: nextBody,
          });
          return {
            status: "ok" as const,
            audioUrl: voice.audioUrl,
            provider: voice.provider,
            voice: voice.voice,
            story: saved
              ? await composeStoryWorkspace(saved, ctx.user.id)
              : null,
          };
        } catch (error) {
          if (!(error instanceof StoryBodyRevisionConflictError)) throw error;
        }
      }
      return {
        status: "error" as const,
        error:
          "镜头持续被更新，旁白已生成但暂未绑定；请尽快重试。当前服务会短期复用本次结果，重启或缓存过期后可能再次计费。",
      };
    }),

  restoreStoryShotFieldVersion: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        field: z.enum(STORYBOARD_VERSIONED_FIELDS),
        revision: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在" };
      }
      const body =
        story.body &&
        typeof story.body === "object" &&
        !Array.isArray(story.body)
          ? (story.body as Record<string, unknown>)
          : {};
      const shots = (Array.isArray(body.shots) ? body.shots : []).filter(
        (shot): shot is Record<string, unknown> =>
          Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      );
      let restored;
      try {
        restored = restoreStoryboardFieldVersion({
          state: body.storyboardFieldVersions,
          shots,
          field: input.field,
          revision: input.revision,
          now: Date.now(),
        });
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "版本不存在",
        };
      }
      const nextBody = prepareStoryBody(
        {
          ...body,
          shots: restored.shots,
          storyboardFieldVersions: restored.state,
        },
        getStoryRevision(story.body) + 1,
        story.body
      );
      let saved;
      try {
        saved = await persistPreparedStoryBody({
          storyId: story.id,
          userId: ctx.user.id,
          expectedRevision: getStoryRevision(story.body),
          body: nextBody,
        });
      } catch (error) {
        if (error instanceof StoryBodyRevisionConflictError) {
          return {
            status: "error" as const,
            error: "故事版已在别处更新，请刷新后重试",
          };
        }
        throw error;
      }
      if (saved) {
        await syncStoryPromptLineageAfterMutation({
          storyId: saved.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved),
          warningLabel: "restoreStoryShotFieldVersion",
        });
      }
      return {
        status: "ok" as const,
        story: saved ? await composeStoryWorkspace(saved, ctx.user.id) : null,
      };
    }),

  /**
   * 职责：在稳定镜头身份之后插入新镜头，并保持其余镜头与素材身份不变。
   * 调用方：CreationEditorContext 的 `insertPersistedShotAfter`。
   * 下游：调用 `insertStoryShotAfter` 生成镜头，再以 revision CAS 落库。
   */
  insertStoryShotAfter: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        stableShotId: stableShotIdSchema,
        dialogue: z.string().optional(),
        timelineFrame: z.number().int().min(0).optional(),
        visualLayer: z.number().int().min(0).optional(),
        referencedImageId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, material] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getStoryMaterialState(input.storyId, ctx.user.id),
      ]);
      if (!story || !material) {
        return { status: "error" as const, error: "故事不存在" };
      }
      const body =
        story.body &&
        typeof story.body === "object" &&
        !Array.isArray(story.body)
          ? (story.body as Record<string, unknown>)
          : {};
      const shots = Array.isArray(body.shots)
        ? body.shots.filter((shot): shot is Record<string, unknown> =>
            Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
          )
        : [];
      const anchorIndex = shots.findIndex((shot, index) => {
        return shotIdentityFromShot(shot, index) === input.stableShotId;
      });
      const anchor = anchorIndex >= 0 ? shots[anchorIndex] : null;
      const anchorShotNo =
        typeof anchor?.shotNo === "number" ? anchor.shotNo : anchorIndex + 1;
      if (!anchor || anchorShotNo == null) {
        return { status: "error" as const, error: "镜头不存在或已经更新" };
      }
      const inserted = insertStoryShotAfter(
        shots,
        anchorShotNo,
        input.stableShotId
      );
      if (!inserted) {
        return { status: "error" as const, error: "镜头不存在或已经更新" };
      }
      const nextShots = input.dialogue?.trim()
        ? inserted.shots.map(shot =>
            shot.shotNo === inserted.insertedShotNo
              ? { ...shot, dialogue: input.dialogue!.trim() }
              : shot
          )
        : inserted.shots;
      const nextBody = prepareStoryBody(
        { ...body, shots: nextShots },
        getStoryRevision(story.body) + 1,
        story.body
      );
      const timelineIndex = material.timeline.items.findIndex(
        item => item.stableShotId === input.stableShotId
      );
      if (timelineIndex < 0) {
        return { status: "error" as const, error: "镜头不在时间轴中" };
      }
      const insertedShot = nextShots[inserted.insertedShotNo - 1] as
        | Record<string, unknown>
        | undefined;
      const durationMs = Math.max(
        100,
        typeof insertedShot?.durationMs === "number" &&
          Number.isFinite(insertedShot.durationMs)
          ? insertedShot.durationMs
          : typeof insertedShot?.durationSec === "number" &&
              Number.isFinite(insertedShot.durationSec)
            ? insertedShot.durationSec * 1000
            : 3_000
      );
      const anchorTimelineItem = material.timeline.items[timelineIndex];
      const anchorStartFrame = Math.max(
        0,
        anchorTimelineItem.timelineStartFrame ?? 0
      );
      const anchorDurationFrames = Math.max(
        1,
        anchorTimelineItem.durationFrames ??
          timelineMsToFrames(anchorTimelineItem.plannedDurationMs)
      );
      const stackOrder =
        Math.max(
          -1,
          ...material.timeline.items.map(item => item.stackOrder ?? -1)
        ) + 1;
      const insertedTimelineItem = {
        stableShotId: inserted.insertedStableShotId,
        included: true,
        position: timelineIndex + 1,
        plannedDurationMs: durationMs,
        durationFrames: timelineMsToFrames(durationMs),
        timelineStartFrame:
          input.timelineFrame ?? anchorStartFrame + anchorDurationFrames,
        stackOrder,
        ...(input.visualLayer == null
          ? {}
          : { visualLayer: input.visualLayer }),
        ...(input.referencedImageId == null
          ? {}
          : { referencedImageId: input.referencedImageId }),
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      };
      const nextTimelineItems = [
        ...material.timeline.items.slice(0, timelineIndex + 1),
        insertedTimelineItem,
        ...material.timeline.items.slice(timelineIndex + 1),
      ].map((item, position) => ({ ...item, position }));
      let saved;
      try {
        saved = await insertTransitionShotAtomic({
          storyId: story.id,
          userId: ctx.user.id,
          stableShotId: inserted.insertedStableShotId,
          expectedStoryRevision: getStoryRevision(story.body),
          expectedTimelineVersion: material.timeline.version,
          nextStoryBody: nextBody,
          nextTimelineItems,
        });
      } catch (error) {
        return {
          status: "error" as const,
          error:
            error instanceof Error
              ? error.message
              : "镜头已在别处更新，请刷新后重试",
        };
      }
      if (saved) {
        await syncStoryPromptLineageAfterMutation({
          storyId: saved.story.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved.story),
          warningLabel: "insertStoryShotAfter",
        });
      }
      return {
        status: "ok" as const,
        insertedShotNo: inserted.insertedShotNo,
        insertedStableShotId: inserted.insertedStableShotId,
        timelineVersion: saved.timeline.version,
        story: await composeStoryWorkspace(saved.story, ctx.user.id),
      };
    }),

  /**
   * 职责：按稳定镜头身份删除单镜，且强制故事至少保留一个镜头。
   * 调用方：CreationEditorContext 的 `deletePersistedShot`。
   * 下游：调用 `deleteStoryShotAtIndex` 重排镜头，再以 revision CAS 落库。
   */
  splitStoryShot: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        stableShotId: stableShotIdSchema,
        cutFrame: z.number().int().nonnegative(),
        expectedStoryRevision: z.number().int().nonnegative(),
        expectedTimelineVersion: z.number().int().nonnegative(),
        legacyOverlay: z
          .object({
            overlayId: z.string().trim().min(1),
            sourceStableShotId: stableShotIdSchema,
            expectedVideoUrl: z.string().trim().min(1),
          })
          .strict()
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const splitStableShotId = `split-${nanoid(16)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}`;
      const command = await runStoryTimelineCommand(
        {
          storyId: input.storyId,
          userId: ctx.user.id,
          failureMessage: "镜头拆分失败",
          ...(input.legacyOverlay
            ? { legacyOverlay: input.legacyOverlay }
            : {}),
        },
        context => {
          if (
            input.legacyOverlay &&
            input.legacyOverlay.sourceStableShotId !== input.stableShotId
          ) {
            return {
              status: "error" as const,
              message: "历史覆盖视频与待切割镜头不匹配",
            };
          }
          if (context.storyRevision !== input.expectedStoryRevision) {
            return {
              status: "error" as const,
              message: "故事已经更新，请刷新后重试",
            };
          }
          if (context.timelineVersion !== input.expectedTimelineVersion) {
            return {
              status: "error" as const,
              message: "时间线已经更新，请刷新后重试",
            };
          }
          const shots = Array.isArray(context.storyBody.shots)
            ? context.storyBody.shots.filter(
                (shot): shot is Record<string, unknown> =>
                  Boolean(
                    shot && typeof shot === "object" && !Array.isArray(shot)
                  )
              )
            : [];
          const targetIndex = shots.findIndex(
            (shot, index) =>
              shotIdentityFromShot(shot, index) === input.stableShotId
          );
          const timelineIndex = context.document.items.findIndex(
            item => item.stableShotId === input.stableShotId
          );
          const timelineRow = buildTimelineLayout(context.document.items).find(
            row => row.item.stableShotId === input.stableShotId
          );
          if (targetIndex < 0 || timelineIndex < 0 || !timelineRow) {
            return {
              status: "error" as const,
              message: "镜头不存在或已经更新",
            };
          }
          const timelineSplit = splitTimelineItem({
            item: context.document.items[timelineIndex],
            startFrame: timelineRow.startFrame,
            cutFrame: input.cutFrame,
            leftStableShotId: input.stableShotId,
            rightStableShotId: splitStableShotId,
          });
          if (timelineSplit.kind === "blocked") {
            return { status: "error" as const, message: timelineSplit.reason };
          }
          const storySplit = splitStoryShotAtIndex({
            shots,
            index: targetIndex,
            rightStableShotId: splitStableShotId,
            leftDurationMs: timelineSplit.left.plannedDurationMs,
            rightDurationMs: timelineSplit.right.plannedDurationMs,
          });
          if (!storySplit) {
            return {
              status: "error" as const,
              message: "镜头拆分失败，请刷新后重试",
            };
          }
          const expandedTimeline = [
            ...context.document.items.slice(0, timelineIndex),
            timelineSplit.left,
            timelineSplit.right,
            ...context.document.items.slice(timelineIndex + 1),
          ];
          const storyPosition = new Map(
            storySplit.shots.map((shot, index) => [
              shotIdentityFromShot(shot, index),
              index,
            ])
          );
          return {
            status: "ok" as const,
            value: { rightShotNo: storySplit.rightShotNo },
            storyBody: { ...context.storyBody, shots: storySplit.shots },
            document: {
              ...context.document,
              items: expandedTimeline.map((item, index) => ({
                ...item,
                position: storyPosition.get(item.stableShotId) ?? index,
              })),
            },
          };
        }
      );
      if (command.status !== "ok") {
        return {
          status: "error" as const,
          error: command.error,
        };
      }
      const savedStory = await getStoryById(input.storyId, ctx.user.id);
      if (!savedStory) return { status: "error" as const, error: "故事不存在" };
      await syncStoryPromptLineageAfterMutation({
        storyId: savedStory.id,
        userId: ctx.user.id,
        body: storyPromptLineageBody(savedStory),
        warningLabel: "splitStoryShot",
      });
      return {
        status: "ok" as const,
        splitStableShotId,
        rightShotNo: command.value.rightShotNo,
        beforeStoryBody: command.facts.before.storyBody,
        beforeTimelineItems: command.facts.before.document.items,
        expectedStoryRevision: command.storyRevision,
        expectedTimelineVersion: command.timelineVersion,
        story: await composeStoryWorkspace(savedStory, ctx.user.id),
      };
    }),

  undoSplitStoryShot: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        splitStableShotId: stableShotIdSchema,
        beforeStoryBody: z.record(z.string(), z.unknown()),
        beforeTimelineItems: z.array(z.record(z.string(), z.unknown())),
        expectedStoryRevision: z.number().int().nonnegative(),
        expectedTimelineVersion: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) return { status: "error" as const, error: "故事不存在" };
      const currentRevision = getStoryRevision(story.body);
      if (
        currentRevision !== input.expectedStoryRevision &&
        !canUndoSplitAfterRevisionOnlyResave({
          currentBody: story.body,
          beforeBody: input.beforeStoryBody,
          splitStableShotId: input.splitStableShotId,
        })
      ) {
        return {
          status: "error" as const,
          error: "故事已在切割后继续编辑，无法安全撤销",
        };
      }
      const nextBody = prepareStoryBody(
        input.beforeStoryBody,
        currentRevision + 1,
        story.body
      );
      try {
        const saved = await restoreSplitStoryShotAtomic({
          storyId: story.id,
          userId: ctx.user.id,
          splitStableShotId: input.splitStableShotId,
          expectedStoryRevision: currentRevision,
          expectedTimelineVersion: input.expectedTimelineVersion,
          nextStoryBody: nextBody,
          nextTimelineItems: input.beforeTimelineItems,
        });
        await syncStoryPromptLineageAfterMutation({
          storyId: saved.story.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved.story),
          warningLabel: "undoSplitStoryShot",
        });
        return {
          status: "ok" as const,
          story: await composeStoryWorkspace(saved.story, ctx.user.id),
          timelineVersion: saved.timeline.version,
        };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "撤销镜头拆分失败",
        };
      }
    }),

  deleteStoryShot: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        stableShotId: stableShotIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在" };
      }
      const body =
        story.body &&
        typeof story.body === "object" &&
        !Array.isArray(story.body)
          ? (story.body as Record<string, unknown>)
          : {};
      const shots = Array.isArray(body.shots)
        ? body.shots.filter((shot): shot is Record<string, unknown> =>
            Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
          )
        : [];
      if (shots.length <= 1) {
        return { status: "error" as const, error: "至少保留一个镜头" };
      }
      const targetIndex = shots.findIndex((shot, index) => {
        return shotIdentityFromShot(shot, index) === input.stableShotId;
      });
      const deleted = deleteStoryShotAtIndex(shots, targetIndex);
      if (!deleted) {
        return { status: "error" as const, error: "镜头不存在或已经更新" };
      }
      const nextBody = prepareStoryBody(
        { ...body, shots: deleted.shots },
        getStoryRevision(story.body) + 1,
        story.body
      );
      let saved;
      try {
        saved = await persistPreparedStoryBody({
          storyId: story.id,
          userId: ctx.user.id,
          expectedRevision: getStoryRevision(story.body),
          body: nextBody,
        });
      } catch (error) {
        if (error instanceof StoryBodyRevisionConflictError) {
          return {
            status: "error" as const,
            error: "镜头已在别处更新，请刷新后重试",
          };
        }
        throw error;
      }
      if (saved) {
        await syncStoryPromptLineageAfterMutation({
          storyId: saved.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved),
          warningLabel: "deleteStoryShot",
        });
      }
      return {
        status: "ok" as const,
        deletedShot: deleted.deletedShot,
        deletedIndex: deleted.deletedIndex,
        deletedAtRevision: getStoryRevision(nextBody),
        afterDeleteBody: structuredClone(nextBody),
        deletedShotNo: deleted.deletedShotNo,
        deletedStableShotId: deleted.deletedStableShotId,
        nextSelectedShotNo: deleted.nextSelectedShotNo,
        story: saved ? await composeStoryWorkspace(saved, ctx.user.id) : null,
      };
    }),

  /**
   * 职责：用删除命令返回的完整镜头快照撤销一次删除。
   * 安全边界：仅允许故事仍停在删除后的 revision 时恢复，避免覆盖后续编辑。
   */
  restoreDeletedStoryShot: protectedProcedure
    .input(
      z.object({
        storyId: persistedStoryIdSchema,
        deletedShot: z.record(z.string(), z.unknown()),
        deletedIndex: z.number().int().nonnegative(),
        deletedStableShotId: stableShotIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        afterDeleteBody: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在" };
      }
      const currentRevision = getStoryRevision(story.body);
      if (
        currentRevision !== input.expectedRevision &&
        !canRestoreDeletedAfterRevisionOnlyResave({
          currentBody: story.body,
          afterDeleteBody: input.afterDeleteBody,
        })
      ) {
        return {
          status: "error" as const,
          error: "故事已在删除后继续编辑，无法安全撤销",
        };
      }
      const body =
        story.body &&
        typeof story.body === "object" &&
        !Array.isArray(story.body)
          ? (story.body as Record<string, unknown>)
          : {};
      const shots = Array.isArray(body.shots)
        ? body.shots.filter((shot): shot is Record<string, unknown> =>
            Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
          )
        : [];
      if (
        shotIdentityFromShot(input.deletedShot, input.deletedIndex) !==
        input.deletedStableShotId
      ) {
        return { status: "error" as const, error: "撤销镜头身份校验失败" };
      }
      if (
        shots.some(
          (shot, index) =>
            shotIdentityFromShot(shot, index) === input.deletedStableShotId
        )
      ) {
        return {
          status: "error" as const,
          error: "镜头已经恢复，无需重复撤销",
        };
      }
      const restored = restoreStoryShotAtIndex(
        shots,
        input.deletedShot,
        input.deletedIndex
      );
      const nextBody = prepareStoryBody(
        { ...body, shots: restored.shots },
        currentRevision + 1,
        story.body
      );
      let saved;
      try {
        saved = await persistPreparedStoryBody({
          storyId: story.id,
          userId: ctx.user.id,
          expectedRevision: currentRevision,
          body: nextBody,
        });
      } catch (error) {
        if (error instanceof StoryBodyRevisionConflictError) {
          return {
            status: "error" as const,
            error: "故事已在删除后继续编辑，无法安全撤销",
          };
        }
        throw error;
      }
      if (saved) {
        await syncStoryPromptLineageAfterMutation({
          storyId: saved.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved),
          warningLabel: "restoreDeletedStoryShot",
        });
      }
      return {
        status: "ok" as const,
        restoredShotNo: restored.restoredShotNo,
        restoredStableShotId: input.deletedStableShotId,
        story: saved ? await composeStoryWorkspace(saved, ctx.user.id) : null,
      };
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
      try {
        await persistPreparedStoryBody({
          storyId: story.id,
          userId: ctx.user.id,
          expectedRevision: getStoryRevision(story.body),
          body: prepareStoryBody(
            nextBody,
            getStoryRevision(story.body) + 1,
            story.body
          ),
        });
      } catch (error) {
        if (error instanceof StoryBodyRevisionConflictError) {
          return {
            status: "error" as const,
            error: "故事已更新，请刷新后重试",
          };
        }
        throw error;
      }
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
              stableShotId: z.string().optional(),
              cueCode: z.string().optional(),
              actNo: z.string().optional(),
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
              intent: z.string().optional(),
              videoStart: z.string().optional(),
              videoEnd: z.string().optional(),
              transitionIn: z.string().optional(),
              transitionOut: z.string().optional(),
              videoPrompt: z.string().optional(),
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
      // projectId 会被用来捞该项目的编辑标注/重复修正信号喂给模型——是访问键，
      // 不是标签。不校验归属就能把别人项目的编辑上下文读进自己的对话里。
      await assertOptionalProjectOwner(input.projectId, ctx.user.id);
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
        explicitInstruction: z.string().trim().min(1).max(2_000).optional(),
        costConfirmation: z
          .object({
            accepted: z.literal(true),
            estimatedCny: z.number().nonnegative(),
          })
          .optional(),
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
        referenceImageUrl: z.string().optional(), // FLUX Kontext 参考图 URL，跨镜头保角色/场景一致
        referenceIdentityImageUrl: z.string().optional(), // 人物身份锚点图，优先用来提取五官/脸型
        referenceContextImageUrls: z.array(z.string()).max(3).optional(), // 当前故事的相邻镜头画面，仅用于视觉连续性
        // 精确改图：用户选中某一帧、只改点名的内容。此时画面事实来自那张图本身，
        // 不能再让美术库按故事设定重新描述一遍场景。
        exactFrameEdit: z.boolean().optional(),
        // 多图重组（对话框图生图）：用户在聊天里选了几张图，逐张说明取什么。
        // 图号职责已经由客户端清单写死并与发送顺序对齐，服务端不得再重写画面描述。
        remixEdit: z.boolean().optional(),
        storyStyleReferenceImageUrl: z.string().optional(), // 正式封面：只继承色板、材质、光线与情绪
        editMaskImageUrl: z
          .string()
          .startsWith("data:image/png;base64,")
          .max(2_500_000)
          .optional(), // GPT-image 透明遮罩：alpha=0 是唯一允许修改的区域
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
        if (input.editMaskImageUrl && !input.explicitInstruction?.trim()) {
          return {
            status: "error" as const,
            error: "遮罩局部重绘必须包含用户的原始修改要求",
          };
        }
        if (input.editMaskImageUrl && !input.referenceImageUrl?.trim()) {
          return {
            status: "error" as const,
            error: "遮罩局部重绘必须包含当前选中图片作为视觉基底",
          };
        }
        if (input.editMaskImageUrl && input.mode === "draft") {
          return {
            status: "error" as const,
            error: "遮罩局部重绘只允许使用已确认费用的正式编辑链路",
          };
        }
        // 多图重组的提示词全靠「图1＝…图2＝…」清单和用户原话立住。少了底图，
        // 图号就对不上实际发送顺序；少了原话，模型没有取舍依据，只会照抄图1。
        // 两种情况都会烧掉一次付费任务却产出废图，所以在提交前挡住。
        if (input.remixEdit && !input.referenceImageUrl?.trim()) {
          return {
            status: "error" as const,
            error: "多图重组必须包含作为底图的第一张参考图",
          };
        }
        if (input.remixEdit && !input.explicitInstruction?.trim()) {
          return {
            status: "error" as const,
            error: "多图重组必须包含用户说明要从每张图里取什么",
          };
        }
        if (input.remixEdit && input.editMaskImageUrl) {
          // 遮罩要和唯一底图逐像素对齐，带遮罩时 imageGen 会丢掉全部上下文图。
          return {
            status: "error" as const,
            error: "多图重组不能同时使用遮罩局部重绘",
          };
        }
        if (input.explicitInstruction || input.editMaskImageUrl) {
          const estimate =
            input.editMaskImageUrl || input.imageProvider === "gpt-image"
              ? estimateStoryboardMaskedEditCost()
              : estimateStoryboardImageCost();
          if (!input.costConfirmation?.accepted) {
            return {
              status: "error" as const,
              error: `请先确认预计人民币 ¥${estimate.estimatedCny.toFixed(2)}`,
            };
          }
          if (
            Math.abs(
              input.costConfirmation.estimatedCny - estimate.estimatedCny
            ) > 0.001
          ) {
            return {
              status: "error" as const,
              error: `费用预估已变化，请重新确认预计人民币 ¥${estimate.estimatedCny.toFixed(2)}`,
            };
          }
        }

        const storyBody =
          story.body && typeof story.body === "object"
            ? (story.body as Record<string, unknown>)
            : {};
        const coverArtDirection = await resolvePublishingCoverArtDirection({
          storyId: input.storyId,
          storyBody,
          loadImage: getGeneratedImageById,
        });

        // ── prompt 构建阶段 ──
        // 三条路径的初始 prompt：
        //   Path 1/3: 客户端已构建结构化 prompt，传入 input.prompt
        //   Path 2A:  LLM 写好的 imagePrompt，传入 input.prompt
        //   Path 2B:  没有 prompt，服务端从对话现编
        let prompt = input.prompt?.trim() ?? "";
        // 一致性闸门只能看用户自己写的话。prompt 后面会被 synthesizeShotPrompt
        // 整个替换成机器合成的画面描述，而合成器的职责就是描述「白色长裙」这类外观，
        // 还会用「不要…」做否定约束 —— 两者一凑就命中闸门的冲突词，
        // 结果是任何绑了锁定资产又走合成的镜头都会被自己挡住（2026-08-22 实测）。
        const userAuthoredPrompt = prompt;
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
        const artDirection = normalizeStoryArtDirection(storyBody.artDirection);
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
          | import("../../shared/promptContext").PromptShotMeta
          | null = input.sceneAnalysis
          ? {
              shotNo: input.shotNo ?? 0,
              cueCode:
                typeof storyShot?.cueCode === "string"
                  ? storyShot.cueCode
                  : undefined,
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
                cueCode:
                  typeof storyShot.cueCode === "string"
                    ? storyShot.cueCode
                    : undefined,
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
                recipe: input.referenceImageUrl
                  ? undefined
                  : (artDirection.recipe ?? undefined),
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

        const promptBeforeLegacyStyleHint = prompt;
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

        // 资产绑定以稳定镜头身份解析。失败必须发生在任何供应商调用之前。
        const shotIdentity = shotIdentityForStoryShot(story, input.shotNo);
        const visualAssetContext = shotIdentity
          ? await resolveVisualAssetGenerationContext({
              storyId: input.storyId,
              userId: ctx.user.id,
              stableShotId: shotIdentity,
              shotText: [userAuthoredPrompt, input.explicitInstruction]
                .filter(Boolean)
                .join("\n"),
              provider:
                input.mode === "draft"
                  ? "draft"
                  : (input.imageProvider ?? "midjourney"),
            })
          : ({ status: "disabled" } as const);
        if (visualAssetContext.status === "blocked") {
          return {
            status: "error" as const,
            error: visualAssetContext.issues
              .map(issue => issue.message)
              .join("；"),
          };
        }
        const lockedAssets =
          visualAssetContext.status === "ready"
            ? visualAssetContext.snapshot
            : undefined;
        if (lockedAssets?.dimensions.style) {
          // 旧镜头 styleHint 只是兼容字段；新风格资产已锁定时不能再把它叠进提示词。
          prompt = promptBeforeLegacyStyleHint;
        }

        // 出图统一经美术网关。资产镜头不再读取旧故事参考池或旧人物锚点。
        const storyReferences = lockedAssets
          ? []
          : storyArtReferenceImages(story);
        const rawCharacterRef = lockedAssets
          ? undefined
          : characterReferenceOf(artDirection);
        const referencePlan = planImageGenerationReferences({
          shotReferenceImageUrl: input.referenceImageUrl,
          shotContextImageUrls: input.referenceContextImageUrls,
          originalImageUrl: input.originalImageUrl,
          characterReferenceImageUrl: rawCharacterRef,
          storyReferenceImageUrls: storyReferences,
          storyStyleReferenceImageUrl: lockedAssets
            ? undefined
            : input.storyStyleReferenceImageUrl,
        });
        if (!lockedAssets)
          prompt = withCharacterContinuityPrompt(prompt, storyBody, {
            hasCharacterReference: Boolean(
              referencePlan.usesStoryboardFrames
                ? (input.referenceIdentityImageUrl ??
                    referencePlan.primaryImage)
                : rawCharacterRef
            ),
            sceneAnalysis: input.sceneAnalysis,
          });
        const referenceImage =
          referencePlan.primaryImage ?? lockedAssets?.sceneRef;
        let referenceImageInput: string | undefined;
        if (referenceImage) {
          try {
            referenceImageInput = await materializeImageInput(referenceImage);
          } catch (error) {
            if (referencePlan.usesStoryboardFrames) {
              return {
                status: "error" as const,
                error:
                  "当前镜头或相邻镜头的连续性参考图已经丢失或无法读取，本次未提交付费生成。请重新拖入参考画面后再试。",
              };
            }
            console.warn(
              "[generateForMobile] reference image unavailable, using existing prompt:",
              error instanceof Error ? error.message : error
            );
          }
        }
        const injection = lockedAssets
          ? {
              ...(lockedAssets.characterRef
                ? {
                    characterRef: lockedAssets.characterRef,
                    characterWeight: 100,
                  }
                : {}),
              ...(lockedAssets.styleRef
                ? { styleRef: lockedAssets.styleRef }
                : {}),
            }
          : referencePlan.usesStoryboardFrames ||
              referencePlan.usesStoryStyleReference
            ? await deriveStoryboardReferenceInjection(story, {
                identityImageUrl: input.referenceIdentityImageUrl,
                sceneImageUrl: referencePlan.primaryImage,
                styleImageUrl: input.storyStyleReferenceImageUrl,
                analysis: input.sceneAnalysis,
                allowSceneIdentity:
                  referencePlan.referencePurpose !== "scene-style",
              })
            : await deriveInjection(story, input.sceneAnalysis);
        if (input.remixEdit) {
          // 多图重组时，客户端已经把「图1＝…图2＝…」的清单和用户原话拼成 prompt，
          // 图号和实际发送顺序严格对齐。这里不能再走 directImagePrompt：它只看
          // 底图一张，会把「取图2的那件外套」重写成对图1的整体画面描述，跨图指令
          // 当场消失。也不能套精确改图那句「keep all of it」——用户要的正是改构图。
          prompt = [
            "Compose one new image from the supplied reference images.",
            "图1 is the base: its aspect ratio and overall composition carry over unless the user asks otherwise.",
            "Take from each reference only what the user names below; do not borrow anything else from them.",
            "",
            prompt,
          ].join("\n");
        } else if (input.exactFrameEdit) {
          // 精确改图时，选中的那张图就是场景本身。美术库改写出来的场景段落会
          // 在提示词开头重述一个「应该长什么样」的画面（配色、姿势全都写死），
          // 于是模型照着它重画，用户的原图当场被换掉。这里换成一句短引导。
          prompt =
            `Edit the supplied base image (图1) for shot ${input.shotNo ?? ""}. ` +
            "The base image defines the scene, location, background content, lighting, camera and composition; keep all of it. " +
            "Apply only the user's named changes below.";
        } else if (referenceImageInput) {
          try {
            const directed = await directImagePrompt({
              imageInput: referenceImageInput,
              fallbackPrompt: prompt,
              narrativePrompt: prompt,
              referencePurpose: referencePlan.referencePurpose,
              shotNo: input.shotNo,
              cueCode:
                typeof storyShot?.cueCode === "string"
                  ? storyShot.cueCode
                  : undefined,
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
        if (!lockedAssets) {
          prompt = applyPublishingCoverArtDirection(prompt, coverArtDirection);
        }
        if (coverArtDirection && !lockedAssets) {
          prompt = await compilePublishingCoverStoryboardPrompt({
            prompt,
            provider: input.imageProvider ?? "midjourney",
          });
        }
        const gateContext = {
          prompt,
          userInstructions: input.explicitInstruction
            ? [input.explicitInstruction]
            : undefined,
          // gpt-image 没有 MJ 的 3500 字上限；不放开的话，参考图清单加连续性规格
          // 会把用户要求挤过 1800 字预算，后半段被整段切掉。
          longPrompt:
            input.imageProvider === "gpt-image" ||
            Boolean(input.editMaskImageUrl),
          referenceImages: lockedAssets
            ? Array.from(
                new Set([
                  ...(referencePlan.gateReferenceImages ?? []),
                  ...Object.values(lockedAssets.dimensions).flatMap(
                    dimension =>
                      dimension
                        ? dimension.views.map(view => view.materializedUrl)
                        : []
                  ),
                ])
              )
            : referencePlan.gateReferenceImages,
          shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
          projectId: story.projectId ?? undefined,
          storyId: story.id,
          preservePrompt: Boolean(coverArtDirection),
          outputPurpose: "story-frame" as const,
          lockedVisualAssets: lockedAssets
            ? {
                fingerprint: lockedAssets.fingerprint,
                kinds: Object.keys(lockedAssets.dimensions) as Array<
                  "character" | "scene" | "style"
                >,
                promptContract: lockedAssets.promptContract,
              }
            : undefined,
          referencePolicy: referenceImage
            ? referencePlan.referencePurpose === "character"
              ? ("preserve-identity" as const)
              : referencePlan.referencePurpose === "scene-style"
                ? ("style-only" as const)
                : ("preserve-composition" as const)
            : ("none" as const),
          storyboardReferenceTruth: referencePlan.usesStoryboardFrames,
          // 用户逐字写了这一镜的图片要求，而且有故事板参考帧在手：美术已经由他定了。
          // 这时再叠加流派、策展库、手作与「艺术跃迁」只会稀释他的要求——0307 那轮
          // 编译出来 2615 字，用户的 400 字只占 14.1%，八次重渲全被拉回同一个平均值。
          authoredBrief:
            Boolean(input.explicitInstruction?.trim()) &&
            referencePlan.usesStoryboardFrames,
          artDirection: lockedAssets
            ? undefined
            : referencePlan.usesStoryboardFrames
              ? explicitStyleRecipe
              : (storyArtRecipe(story) ?? explicitStyleRecipe),
          styleIndex:
            typeof storyBody.styleIndex === "number"
              ? (storyBody.styleIndex as number)
              : undefined,
        };

        const imageWeight =
          input.sceneWeight ?? (referencePlan.usesStoryboardFrames ? 2 : 0.5);
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
            return generateDraftImage(renderedDraftPrompt);
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
            `[generateForMobile] final prompt after gate: ${renderedFinalPrompt.length} chars`
          );
          console.log(
            `[generateForMobile] reference image: ${
              input.referenceImageUrl
                ? input.referenceImageUrl.startsWith("data:")
                  ? "data-url"
                  : "url"
                : "none"
            }`
          );
          return referenceImage
            ? editMobileImage(referenceImage, renderedFinalPrompt, {
                provider: input.imageProvider ?? "midjourney",
                ...injection,
                imageWeight,
                referenceImageUrl: input.referenceImageUrl,
                referenceIdentityImageUrl: input.referenceIdentityImageUrl,
                referenceContextImageUrls: Array.from(
                  new Set([
                    ...(input.referenceContextImageUrls ?? []),
                    ...(lockedAssets?.sceneRef &&
                    lockedAssets.sceneRef !== referenceImage
                      ? [lockedAssets.sceneRef]
                      : []),
                  ])
                ).slice(0, 3),
                editMaskImageUrl: input.editMaskImageUrl,
                primaryReferenceLock:
                  referencePlan.usesStoryboardFrames && !lockedAssets,
                requireInputImage:
                  referencePlan.usesStoryboardFrames || Boolean(lockedAssets),
              })
            : generateMobileImage(renderedFinalPrompt, {
                provider: input.imageProvider ?? "midjourney",
                ...injection,
                referenceImageUrl: input.referenceImageUrl,
                referenceIdentityImageUrl: input.referenceIdentityImageUrl,
                referenceContextImageUrls: input.referenceContextImageUrls,
              });
        });
        if (result.status === "error" || !result.imageUrl) {
          const providerTaskId = result.providerTaskId?.trim() || "";
          const submissionUncertain =
            result.submissionUncertain === true && !providerTaskId;
          const error = providerTaskId
            ? `图片任务已被 302 受理（任务号 ${providerTaskId}），但结果回传失败（${result.message ?? "暂时无法取得图片"}）。请勿重复提交，稍后恢复或查询该任务。`
            : submissionUncertain
              ? `图片提交过程中连接中断，未拿到 302 任务号，无法确认上游是否已受理（${result.message ?? "网络连接异常"}）。请先检查候选或服务商后台，再决定是否重试，避免重复付费。`
              : (result.message ?? "图片生成返回空结果");
          return {
            status: "error" as const,
            error,
            ...(providerTaskId ? { providerTaskId } : {}),
            ...(submissionUncertain ? { submissionUncertain: true } : {}),
          };
        }
        // 写入 generatedImages 表（shotNo 转为字符串，统一表结构）。
        //
        // 一个 MJ turbo 任务原生返回 2×2 四宫格，供应商层已经把四张都下载落盘并放进
        // result.candidates。这里以前只取 result.imageUrl 建一条记录，另外三张就此蒸发：
        // 界面写着「渲染 4 张」、按一个 MJ 任务的价钱收了费，最后只看得到一张。
        // 付过钱的候选必须全部入库。
        const providerCandidates =
          result.candidates && result.candidates.length > 0
            ? result.candidates
            : [
                {
                  imageUrl: result.imageUrl,
                  ...(result.imageKey ? { imageKey: result.imageKey } : {}),
                },
              ];
        const storedImages = [];
        for (const candidate of providerCandidates) {
          storedImages.push(
            await createGeneratedImage({
              projectId: story.projectId ?? null,
              storyId: input.storyId,
              userId: ctx.user.id,
              shotNo: canonicalizeShotNo(input.shotNo),
              shotIdentity,
              imageKey: candidate.imageKey ?? null,
              imageUrl: candidate.imageUrl,
              prompt: renderedFinalPrompt,
              promptCompilationId,
              generationType: referencePlan.usesStoryboardFrames
                ? "inpaint"
                : "initial",
              parentImageId: input.draftImageId ?? null, // 由草稿确认而来时，链回草稿
              isCurrent: false,
            })
          );
        }
        const image = storedImages[0]!;
        // 重渲链路明确要求 autoSelect 时，新图要成为当前版本；旧图仍保留在历史中。
        // 之前这里只保存了新资产但没有执行 promote，导致“生成成功却仍停在旧图”。
        if (input.autoSelect) {
          await promoteStoryImageToCurrent({
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: image.id,
            metadata: {
              source: "generate_for_mobile_auto_select",
              shotNo: input.shotNo,
            },
          });
        }
        return {
          status: "ok" as const,
          imageUrl: result.imageUrl,
          imageId: image.id,
          // 这一次任务产出的全部候选（含首张）。调用方据此展示真实张数，
          // 不用再把一张图克隆成四个假候选，也不会把付过钱的三张丢掉。
          candidates: storedImages.map(stored => ({
            imageId: stored.id,
            imageUrl: stored.imageUrl,
          })),
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
            outputPurpose: "image-edit",
            referencePolicy: "preserve-composition",
            artDirection: storyArtRecipe(story),
            styleIndex:
              typeof (story.body as Record<string, unknown>)?.styleIndex ===
              "number"
                ? ((story.body as Record<string, unknown>).styleIndex as number)
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
        try {
          await persistPreparedStoryBody({
            storyId: story.id,
            userId: ctx.user.id,
            expectedRevision: getStoryRevision(story.body),
            body: prepareStoryBody(
              { ...body, shots, mobileImages },
              getStoryRevision(story.body) + 1,
              story.body
            ),
          });
        } catch (error) {
          if (!(error instanceof StoryBodyRevisionConflictError)) throw error;
        }
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

  // 抽帧轨只允许删除由时间线抽帧流程持久化的图片。单独设入口，避免前端
  // 菜单或被篡改的请求把普通镜头主图当成抽帧删除。
  deleteExtractedFrame: protectedProcedure
    .input(
      z.object({ imageId: z.number().int().positive(), storyId: z.number() })
    )
    .mutation(async ({ ctx, input }) => {
      const [image, story] = await Promise.all([
        getGeneratedImageById(input.imageId),
        getStoryById(input.storyId, ctx.user.id),
      ]);
      if (
        !image ||
        !story ||
        image.storyId !== input.storyId ||
        image.userId !== ctx.user.id
      ) {
        return { status: "error" as const, error: "抽帧不存在或无权操作" };
      }
      if (extractedFrameTimeMs(image.prompt) == null) {
        return { status: "error" as const, error: "这张图片不是时间线抽帧" };
      }

      await deleteGeneratedImage(input.imageId, ctx.user.id);
      return { status: "ok" as const, imageId: input.imageId };
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
});
