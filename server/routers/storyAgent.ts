import { z } from "zod";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
import { canonicalizeShotNo } from "@shared/imageAsset";
import { normalizeSuggestedStoryTitle } from "@shared/storyTitle";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";
import {
  replaceDirectorShotsForStory,
  listUserStories,
  getStoryById,
  createStory,
  updateStoryTitle,
  updateStoryTitleIfUntitled,
  deleteStory,
  createGeneratedImage,
  getGeneratedImageById,
  createImageSignal,
  promoteStoryImageToCurrent,
  deleteGeneratedImage,
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
import {
  applyExplicitImageRenderInstruction,
  applyStoryFrameVisualTruth,
} from "../services/imageRenderInstruction";
import { planImageGenerationReferences } from "../services/imageGenerationReference";
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
} from "../../shared/storyShotEditing";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import {
  estimateStoryboardImageCost,
  estimateStoryboardMaskedEditCost,
} from "../../shared/imageRenderCost";
import { getActiveStyles } from "../services/styleLibrary";
import { sceneAnalysisSchema } from "../../shared/sceneAnalysis";
import {
  applyStoryShotUpdate,
  persistedStoryIdSchema,
  stableShotIdSchema,
  storyShotUpdateCommandSchema,
} from "../../shared/storyContract";
import {
  type PromptContext,
  buildUnifiedPrompt,
} from "../../shared/promptContext";
import { migrateStoryPromptLineage } from "../services/promptLineageMigration";
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
      const updated = await updateStoryTitle(input.id, ctx.user.id, title);
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
      const updated = await updateStoryTitleIfUntitled(
        input.id,
        ctx.user.id,
        title
      );
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
      const shots = Array.isArray(body.shots) ? body.shots : [];
      const targetStableShotId = input.stableShotId;
      let found = false;
      const nextShots = shots.map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const shot = raw as Record<string, unknown>;
        if (shotIdentityFromShot(shot, index) !== targetStableShotId) {
          return raw;
        }
        found = true;
        return applyStoryShotUpdate(shot, input);
      });
      if (!found) {
        return { status: "error" as const, error: "镜头不存在或已经更新" };
      }

      const nextBody = prepareStoryBody(
        { ...body, shots: nextShots },
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
        void migrateStoryPromptLineage({
          storyId: saved.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved),
        }).catch(error => {
          console.warn(
            "updateStoryShotFields prompt lineage sync failed",
            error
          );
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
        void migrateStoryPromptLineage({
          storyId: saved.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved),
        }).catch(error => {
          console.warn(
            "insertStoryShotAfter prompt lineage sync failed",
            error
          );
        });
      }
      return {
        status: "ok" as const,
        insertedShotNo: inserted.insertedShotNo,
        insertedStableShotId: inserted.insertedStableShotId,
        story: saved ? await composeStoryWorkspace(saved, ctx.user.id) : null,
      };
    }),

  /**
   * 职责：按稳定镜头身份删除单镜，且强制故事至少保留一个镜头。
   * 调用方：CreationEditorContext 的 `deletePersistedShot`。
   * 下游：调用 `deleteStoryShotAtIndex` 重排镜头，再以 revision CAS 落库。
   */
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
        void migrateStoryPromptLineage({
          storyId: saved.id,
          userId: ctx.user.id,
          body: storyPromptLineageBody(saved),
        }).catch(error => {
          console.warn("deleteStoryShot prompt lineage sync failed", error);
        });
      }
      return {
        status: "ok" as const,
        deletedShotNo: deleted.deletedShotNo,
        deletedStableShotId: deleted.deletedStableShotId,
        nextSelectedShotNo: deleted.nextSelectedShotNo,
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
        if (input.explicitInstruction || input.editMaskImageUrl) {
          const estimate = input.editMaskImageUrl
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
        const rawCharacterRef = characterReferenceOf(artDirection);
        const referencePlan = planImageGenerationReferences({
          shotReferenceImageUrl: input.referenceImageUrl,
          shotContextImageUrls: input.referenceContextImageUrls,
          originalImageUrl: input.originalImageUrl,
          characterReferenceImageUrl: rawCharacterRef,
          storyReferenceImageUrls: storyReferences,
        });
        prompt = withCharacterContinuityPrompt(prompt, storyBody, {
          hasCharacterReference: Boolean(
            referencePlan.usesStoryboardFrames
              ? (input.referenceIdentityImageUrl ?? referencePlan.primaryImage)
              : rawCharacterRef
          ),
          sceneAnalysis: input.sceneAnalysis,
        });
        const referenceImage = referencePlan.primaryImage;
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
        const injection = referencePlan.usesStoryboardFrames
          ? await deriveStoryboardReferenceInjection(story, {
              identityImageUrl:
                input.referenceIdentityImageUrl ?? referencePlan.primaryImage,
              sceneImageUrl: referencePlan.primaryImage,
              analysis: input.sceneAnalysis,
            })
          : await deriveInjection(story, input.sceneAnalysis);
        if (referenceImageInput) {
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
        const gateContext = {
          prompt,
          referenceImages: referencePlan.gateReferenceImages,
          shotNo: input.shotNo != null ? String(input.shotNo) : undefined,
          projectId: story.projectId ?? undefined,
          storyId: story.id,
          artDirection: referencePlan.usesStoryboardFrames
            ? explicitStyleRecipe
            : (storyArtRecipe(story) ?? explicitStyleRecipe),
          styleIndex:
            typeof storyBody.styleIndex === "number"
              ? (storyBody.styleIndex as number)
              : undefined,
        };

        const imageWeight =
          input.sceneWeight ?? (referencePlan.usesStoryboardFrames ? 2 : 0.5);
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
            renderedDraftPrompt = applyExplicitImageRenderInstruction(
              renderedPrompt,
              input.explicitInstruction
            );
            if (referencePlan.usesStoryboardFrames) {
              renderedDraftPrompt =
                applyStoryFrameVisualTruth(renderedDraftPrompt);
            }
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
          renderedFinalPrompt = applyExplicitImageRenderInstruction(
            renderedPrompt,
            input.explicitInstruction
          );
          if (referencePlan.usesStoryboardFrames) {
            renderedFinalPrompt =
              applyStoryFrameVisualTruth(renderedFinalPrompt);
          }
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
                referenceContextImageUrls: input.referenceContextImageUrls,
                editMaskImageUrl: input.editMaskImageUrl,
                primaryReferenceLock: referencePlan.usesStoryboardFrames,
                requireInputImage: referencePlan.usesStoryboardFrames,
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
          generationType: referencePlan.usesStoryboardFrames
            ? "inpaint"
            : "initial",
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
