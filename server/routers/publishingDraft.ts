import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PUBLISHING_PLATFORM_IDS,
  getPublishingContentError,
  isRecoverablePublishingCoverGeneration,
  normalizePublishingNarrativeIntent,
  type PublishingCoverRound,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformId,
  type PublishingStoryCoreContent,
} from "../../shared/publishingDraft";
import {
  PUBLISHING_COVER_SHOT_IDENTITY,
  PUBLISHING_COVER_SHOT_NO,
} from "../../shared/imageAsset";
import {
  estimatePublishingCoverCost,
  PUBLISHING_COVER_PROFILE,
} from "../../shared/imageRenderCost";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createGeneratedImage,
  getGeneratedImageById,
  getStoryById,
  promoteStoryImageToCurrent,
} from "../db";
import {
  editImage,
  generateImage,
  resume302MidjourneyTask,
} from "../services/imageGen";
import {
  PublishingDraftConflictError,
  PublishingDraftOwnershipError,
  getPublishingDraftState,
  writePublishingDraftState,
} from "../services/publishingPersistence";
import {
  PublishingDraftModelOutputError,
  classifyPublishingDraftEdit,
  convertPublishingDraft,
  generatePublishingDraft,
  revisePublishingDraft,
} from "../services/publishingDraft";
import { listStoryConversation } from "../services/storyConversation";
import {
  confirmPublishingVideoStoryboard,
  generateAndConfirmPublishingVideoStoryboard,
  generateAndPersistPublishingVideoPreview,
  PublishingVideoStoryboardConfirmationError,
  PublishingVideoStoryboardEligibilityError,
  PublishingVideoStoryboardOperationConflictError,
} from "../services/publishingVideoStoryboardPersistence";
import { PublishingVideoStoryboardModelOutputError } from "../services/publishingVideoStoryboard";

const platformSchema = z.enum(PUBLISHING_PLATFORM_IDS);
const contentSchema = z.object({
  title: z.string().max(160),
  body: z.string().max(20_000),
  tags: z.array(z.string().max(80)).max(12),
});
const coreSchema = z.object({
  facts: z.array(z.string().max(2_000)).max(20),
  thesis: z.string().min(1).max(2_000),
  emotion: z.string().max(500),
  voiceTraits: z.array(z.string().max(200)).max(12),
  visualConcept: z.string().max(2_000),
});
const narrativeIntentSchema = z.object({
  primaryPurpose: z.enum(["preserve", "gift", "share", "persuade", "create"]),
  secondaryPurposes: z
    .array(z.enum(["preserve", "gift", "share", "persuade", "create"]))
    .max(4),
  coreAudience: z.string().trim().min(1).max(80),
  secondaryAudiences: z.array(z.string().trim().min(1).max(80)).max(5),
  status: z.enum(["provisional", "confirmed"]),
  updatedAt: z.number().int().nonnegative(),
});

function assertPublishingContentFitsPlatform(
  platform: PublishingPlatformId,
  content: PublishingDraftContent
): void {
  const error = getPublishingContentError(platform, content);
  if (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error });
  }
}

function isTitleOnlyPublishingEdit(
  baseline: PublishingDraftContent,
  next: PublishingDraftContent
): boolean {
  return (
    baseline.title !== next.title &&
    baseline.body === next.body &&
    baseline.tags.length === next.tags.length &&
    baseline.tags.every((tag, index) => tag === next.tags[index])
  );
}

function throwPublishingError(error: unknown): never {
  if (error instanceof PublishingDraftOwnershipError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  }
  if (error instanceof PublishingDraftConflictError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "这份发布稿已经在别处更新，请刷新后再应用",
      cause: error,
    });
  }
  if (error instanceof PublishingDraftModelOutputError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "发布稿生成结果不完整，自动修复一次后仍未通过，请重试",
      cause: error,
    });
  }
  if (error instanceof PublishingVideoStoryboardEligibilityError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof PublishingVideoStoryboardOperationConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof PublishingVideoStoryboardConfirmationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof PublishingVideoStoryboardModelOutputError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "剧本转写结果不完整，自动修复后仍未通过，请重试",
      cause: error,
    });
  }
  throw error;
}

function normalizeConversationMessage(
  value: unknown
): { role: "user" | "assistant"; content: string } | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const role =
    obj.role === "user" || obj.role === "assistant" ? obj.role : null;
  const content = typeof obj.content === "string" ? obj.content.trim() : "";
  return role && content ? { role, content } : null;
}

function mergePublishingConversation(
  bodyMessages: unknown,
  durableMessages: unknown
): Array<{ role: "user" | "assistant"; content: string }> {
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  const known = new Set<string>();
  for (const source of [bodyMessages, durableMessages]) {
    if (!Array.isArray(source)) continue;
    for (const raw of source) {
      const message = normalizeConversationMessage(raw);
      if (!message) continue;
      const key = `${message.role}\u0000${message.content}`;
      if (known.has(key)) continue;
      known.add(key);
      merged.push(message);
    }
  }
  return merged.slice(-20);
}

function legacyPublishingStoryMaterial(
  story: { title?: unknown; logline?: unknown },
  body: Record<string, unknown>
): string | null {
  const sections: string[] = [];
  let hasSubstantiveMaterial = false;
  const addSection = (
    label: string,
    value: unknown,
    options?: { substantive?: boolean }
  ) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return;
    sections.push(`${label}：${text.slice(0, 2_000)}`);
    if (options?.substantive !== false) hasSubstantiveMaterial = true;
  };

  addSection("故事标题", story.title, { substantive: false });
  addSection("一句话故事", story.logline);
  addSection("主题", body.theme);
  addSection("故事弧", body.arc);
  addSection("故事摘要", body.summary);

  const cards = Array.isArray(body.cards) ? body.cards.slice(0, 12) : [];
  cards.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return;
    const card = candidate as Record<string, unknown>;
    const title = typeof card.title === "string" ? card.title.trim() : "";
    const fragments = [
      card.sourceQuote,
      card.rawText,
      card.content,
      card.dialogue,
    ]
      .filter((value): value is string => typeof value === "string")
      .map(value => value.trim())
      .filter(Boolean)
      .filter(
        (value, fragmentIndex, values) =>
          values.indexOf(value) === fragmentIndex
      )
      .map(value => value.slice(0, 1_500));
    if (fragments.length === 0) return;
    hasSubstantiveMaterial = true;
    sections.push(
      [`故事卡 ${index + 1}${title ? `「${title}」` : ""}`, ...fragments]
        .join("\n")
        .slice(0, 4_000)
    );
  });

  if (!hasSubstantiveMaterial) return null;
  return [
    "以下是这个历史故事已经保存的素材。请基于这些素材整理发布稿，不要补写素材之外的新事实。",
    ...sections,
  ]
    .join("\n\n")
    .slice(0, 16_000);
}

async function loadOwnedPublishingConversation(
  storyId: number,
  userId: number
) {
  const story = await getStoryById(storyId, userId);
  if (!story) {
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  }
  const body =
    story.body && typeof story.body === "object" && !Array.isArray(story.body)
      ? (story.body as Record<string, unknown>)
      : {};
  let durableMessages: unknown[] = [];
  try {
    const durable = await listStoryConversation({ storyId, userId });
    durableMessages = Array.isArray(durable.messages) ? durable.messages : [];
  } catch {
    // A new Story may not have a prompt-lineage aggregate yet. Its normalized
    // body messages still close the first-generation gap without another call.
  }
  const conversation = mergePublishingConversation(
    body.messages,
    durableMessages
  );
  if (conversation.some(message => message.role === "user")) {
    return conversation;
  }
  const legacyMaterial = legacyPublishingStoryMaterial(story, body);
  return legacyMaterial
    ? [...conversation, { role: "user" as const, content: legacyMaterial }]
    : conversation;
}

async function loadOwnedPublishingNarrativeIntent(
  storyId: number,
  userId: number
) {
  const story = await getStoryById(storyId, userId);
  if (!story) {
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  }
  const body =
    story.body && typeof story.body === "object" && !Array.isArray(story.body)
      ? (story.body as Record<string, unknown>)
      : {};
  return normalizePublishingNarrativeIntent(body.confirmedIntent);
}

type PublishingCoverAsset = {
  id: number;
  imageUrl: string;
  imageKey: string | null;
  shotIdentity: string | null;
  createdAt: Date;
};

type PublishingCoverRoundView = PublishingCoverRound & {
  candidates: PublishingCoverAsset[];
};

const PUBLISHING_COVER_OPENING_SHOT_IDENTITY =
  "publishing-cover-opening" as const;

function isPublishingCoverIdentity(identity: string | null): boolean {
  return (
    identity === PUBLISHING_COVER_SHOT_IDENTITY ||
    identity === PUBLISHING_COVER_OPENING_SHOT_IDENTITY
  );
}

async function loadPublishingCoverAsset(params: {
  assetId: number | null | undefined;
  storyId: number;
  userId: number;
}): Promise<PublishingCoverAsset | null> {
  if (!params.assetId) return null;
  const image = await getGeneratedImageById(params.assetId);
  if (
    !image ||
    image.storyId !== params.storyId ||
    image.userId !== params.userId ||
    !isPublishingCoverIdentity(image.shotIdentity)
  ) {
    return null;
  }
  return {
    id: image.id,
    imageUrl: image.imageUrl,
    imageKey: image.imageKey,
    shotIdentity: image.shotIdentity,
    createdAt: image.createdAt,
  };
}

async function loadPublishingCoverRounds(params: {
  publishing: PublishingDraftState;
  storyId: number;
  userId: number;
}): Promise<PublishingCoverRoundView[]> {
  return Promise.all(
    params.publishing.coverRounds.map(async round => {
      const candidates = await Promise.all(
        round.assetIds.map(assetId =>
          loadPublishingCoverAsset({
            assetId,
            storyId: params.storyId,
            userId: params.userId,
          })
        )
      );
      return {
        ...round,
        candidates: candidates.filter(
          (candidate): candidate is PublishingCoverAsset => candidate != null
        ),
      };
    })
  );
}

function composePublishingCoverPrompt(params: {
  visualConcept: string;
  thesis: string;
  emotion: string;
  feedback?: string;
}): string {
  const visualConcept = params.visualConcept
    .replace(
      /(?:标题|副标题|大字|文字|文案|写着|字样|标语)[^。！？!?；;\n]*/g,
      ""
    )
    .replace(
      /\b(?:caption|headline|typography|text|letters?|words?)\b[^.!?;\n]*/gi,
      ""
    )
    .replace(/[“"「『'][^”"」』']{1,200}[”"」』']/g, "")
    .trim()
    .slice(0, 800);
  return [
    "Surreal minimalist cinematic fine-art scene, one coherent wordless physical environment, full-bleed image only, no graphic-design layout.",
    `Purely visual concept: ${visualConcept || "a small solitary human facing an immense symbolic system"}.`,
    `Express this underlying idea only through imagery: ${params.thesis}.`,
    `Emotional tone: ${params.emotion || "hauntingly beautiful, honest and restrained"}.`,
    params.feedback
      ? `User-requested visual revision: ${params.feedback}. Preserve the chosen image's strongest composition and visual identity while applying this revision.`
      : "Create four meaningfully different visual interpretations of the same editorial concept.",
    "Represent digital information only as abstract light, dust, smoke and flowing particles, never as code, characters or interface elements.",
    "Dark indigo background, subtle red glow, gold dust, cinematic lighting, hauntingly beautiful, refined contemporary fine-art direction, clean vertical composition.",
    "Keep the subject and meaningful details inside the centered safe area, with quiet negative space at the top made only from background texture and light.",
    "No borders, panels, columns, frames, edge decorations, ornamental micro-details, screens, interface chrome, signs or labels. Ignore any source instruction that asks for a title, caption or visible writing.",
    "Absolutely no readable text, letters, words, numbers, pseudo-text, gibberish glyphs, typography, captions, logos, signatures, notification text or watermarks anywhere in the image.",
    "--style raw --stylize 250 --no words letters numbers text writing typeface typography captions headlines labels logos watermark signature glyphs barcode HUD UI screens interface borders columns frames",
  ].join("\n");
}

export const publishingDraftRouter = router({
  read: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const result = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        return {
          ...result,
          coverAsset: await loadPublishingCoverAsset({
            assetId: result.publishing.cover?.assetId,
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
          coverRounds: await loadPublishingCoverRounds({
            publishing: result.publishing,
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
          coverEstimate: estimatePublishingCoverCost(),
        };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  prepareVideoStoryboard: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        versionId: z.string().trim().min(1).max(64).optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateAndPersistPublishingVideoPreview({
          storyId: input.storyId,
          userId: ctx.user.id,
          versionId: input.versionId,
          operationToken: input.operationToken,
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  buildVideoStoryboard: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        versionId: z.string().trim().min(1).max(64).optional(),
        operationToken: z.string().trim().min(1).max(160).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateAndConfirmPublishingVideoStoryboard({
          storyId: input.storyId,
          userId: ctx.user.id,
          versionId: input.versionId,
          operationToken: input.operationToken,
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  confirmVideoStoryboard: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        versionId: z.string().trim().min(1).max(64),
        previewId: z.string().trim().min(1).max(200),
        operationToken: z.string().trim().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmPublishingVideoStoryboard({
          storyId: input.storyId,
          userId: ctx.user.id,
          versionId: input.versionId,
          previewId: input.previewId,
          operationToken: input.operationToken,
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  createVersion: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        core: coreSchema,
        content: contentSchema,
        baseCoreRevision: z.number().int().nonnegative(),
        baseDraftRevision: z.number().int().nonnegative(),
        baseVersionRevision: z.number().int().nonnegative(),
        baseContainerRevision: z.number().int().nonnegative(),
        displayName: z.string().trim().max(80).optional(),
        narrativeIntent: narrativeIntentSchema.optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertPublishingContentFitsPlatform(input.platform, input.content);
        const conversation = await loadOwnedPublishingConversation(
          input.storyId,
          ctx.user.id
        );
        const saved = await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operationToken: input.operationToken,
          operation: {
            type: "create_version",
            platform: input.platform,
            core: input.core as PublishingStoryCoreContent,
            content: input.content,
            baseCoreRevision: input.baseCoreRevision,
            baseDraftRevision: input.baseDraftRevision,
            baseVersionRevision: input.baseVersionRevision,
            baseContainerRevision: input.baseContainerRevision,
            displayName: input.displayName,
            narrativeIntent: input.narrativeIntent,
            conversationSnapshot: {
              messages: conversation,
              updatedAt: Date.now(),
            },
          },
        });
        return saved;
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  selectVersion: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        versionId: z.string().trim().min(1).max(64),
        baseContainerRevision: z.number().int().nonnegative(),
        baseVersionRevision: z.number().int().nonnegative(),
        operationToken: z.string().trim().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operationToken: input.operationToken,
          operation: {
            type: "select_version",
            versionId: input.versionId,
            baseContainerRevision: input.baseContainerRevision,
            baseVersionRevision: input.baseVersionRevision,
          },
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  renameVersion: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        versionId: z.string().trim().min(1).max(64),
        displayName: z.string().trim().min(1).max(80),
        baseContainerRevision: z.number().int().nonnegative(),
        baseVersionRevision: z.number().int().nonnegative(),
        operationToken: z.string().trim().min(1).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operationToken: input.operationToken,
          operation: {
            type: "rename_version",
            versionId: input.versionId,
            displayName: input.displayName,
            baseContainerRevision: input.baseContainerRevision,
            baseVersionRevision: input.baseVersionRevision,
          },
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  generate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        activePlatform: platformSchema,
        selectedPlatforms: z.array(platformSchema).min(1).max(6),
        basePublishingRevision: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const conversation = await loadOwnedPublishingConversation(
          input.storyId,
          ctx.user.id
        );
        const narrativeIntent = await loadOwnedPublishingNarrativeIntent(
          input.storyId,
          ctx.user.id
        );
        if (!conversation.some(message => message.role === "user")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "先在左侧说说你的想法，再生成发布稿",
          });
        }
        const generated = await generatePublishingDraft({
          platform: input.activePlatform,
          conversation,
          narrativeIntent,
        });
        const saved = await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "initialize",
            activePlatform: input.activePlatform,
            selectedPlatforms: input.selectedPlatforms,
            core: generated.core,
            content: generated.content,
            narrativeIntent,
            basePublishingRevision: input.basePublishingRevision,
          },
        });
        return { ...saved, modelLabel: generated.modelLabel };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  convert: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        sourcePlatform: platformSchema,
        targetPlatform: platformSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const current = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        const existing = current.publishing.drafts[input.targetPlatform];
        if (existing) return { ...current, status: "existing" as const };
        const core = current.publishing.core;
        const source = current.publishing.drafts[input.sourcePlatform];
        if (!core || !source) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请先生成来源平台的发布稿",
          });
        }
        const converted = await convertPublishingDraft({
          core,
          sourceDraft: source,
          targetPlatform: input.targetPlatform,
        });
        const saved = await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "upsert_draft",
            platform: input.targetPlatform,
            content: converted.content,
            baseDraftRevision: 0,
            activate: true,
          },
        });
        return {
          ...saved,
          status: "created" as const,
          modelLabel: converted.modelLabel,
        };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  rewrite: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        instruction: z.string().trim().min(1).max(2_000),
        content: contentSchema,
        baseDraftRevision: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertPublishingContentFitsPlatform(input.platform, input.content);
        const current = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        const core = current.publishing.core;
        const draft = current.publishing.drafts[input.platform];
        if (!core || !draft) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "当前平台还没有可改写的发布稿",
          });
        }
        if (draft.revision !== input.baseDraftRevision) {
          throw new PublishingDraftConflictError(
            input.platform,
            input.baseDraftRevision,
            draft.revision
          );
        }
        const revised = await revisePublishingDraft({
          core,
          current: input.content,
          platform: input.platform,
          instruction: input.instruction,
        });
        return {
          status: "preview" as const,
          content: revised.content,
          baseDraftRevision: draft.revision,
          modelLabel: revised.modelLabel,
        };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  applyEdit: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        content: contentSchema,
        baseDraftRevision: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertPublishingContentFitsPlatform(input.platform, input.content);
        const current = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        const core = current.publishing.core;
        const draft = current.publishing.drafts[input.platform];
        if (!core || !draft) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "当前平台还没有可修改的发布稿",
          });
        }
        const classification = isTitleOnlyPublishingEdit(
          draft.appliedBaseline,
          input.content as PublishingDraftContent
        )
          ? {
              assessment: {
                outcome: "wording_only" as const,
                reason: "仅修改当前平台标题",
              },
              proposedCore: null,
              usedModel: false,
              modelLabel: "本地判断",
            }
          : await classifyPublishingDraftEdit({
              baseline: draft.appliedBaseline,
              next: input.content as PublishingDraftContent,
              core,
              platform: input.platform,
            });
        if (classification.assessment.outcome === "wording_only") {
          const saved = await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "apply_wording",
              platform: input.platform,
              content: input.content,
              baseDraftRevision: input.baseDraftRevision,
            },
          });
          return {
            ...classification,
            ...saved,
            status: "applied" as const,
          };
        }
        return {
          ...classification,
          ...current,
          status: "confirmation_required" as const,
        };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  confirmCoreChange: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        content: contentSchema,
        core: coreSchema,
        baseCoreRevision: z.number().int().nonnegative(),
        baseDraftRevision: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertPublishingContentFitsPlatform(input.platform, input.content);
        return await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "confirm_core_change",
            platform: input.platform,
            core: input.core as PublishingStoryCoreContent,
            content: input.content,
            baseCoreRevision: input.baseCoreRevision,
            baseDraftRevision: input.baseDraftRevision,
          },
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  confirmWordingChange: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        content: contentSchema,
        baseDraftRevision: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertPublishingContentFitsPlatform(input.platform, input.content);
        return await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "apply_wording",
            platform: input.platform,
            content: input.content,
            baseDraftRevision: input.baseDraftRevision,
          },
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  generateCover: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        basePublishingRevision: z.number().int().nonnegative(),
        referenceAssetId: z.number().int().positive().optional(),
        feedback: z.string().trim().max(2_000).optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
        costConfirmation: z
          .object({
            accepted: z.literal(true),
            estimatedCny: z.number().nonnegative(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const current = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        const operationToken = input.operationToken ?? `cover-${randomUUID()}`;
        const persistedGeneration = current.publishing.coverGeneration;
        const matchingOperation =
          persistedGeneration?.operationToken === operationToken;
        const recoveringAcceptedTask =
          matchingOperation &&
          persistedGeneration.status !== "pending" &&
          isRecoverablePublishingCoverGeneration(persistedGeneration);
        const resuming =
          matchingOperation &&
          (persistedGeneration.status === "pending" || recoveringAcceptedTask);
        if (
          !matchingOperation &&
          current.publishing.revision !== input.basePublishingRevision
        ) {
          throw new PublishingDraftConflictError(
            "publishing",
            input.basePublishingRevision,
            current.publishing.revision
          );
        }
        const estimate = estimatePublishingCoverCost();
        const confirmationIsCurrent =
          input.costConfirmation?.accepted === true &&
          Math.abs(
            (input.costConfirmation?.estimatedCny ?? -1) - estimate.estimatedCny
          ) <= 0.001;
        if (!matchingOperation && !confirmationIsCurrent) {
          return {
            status: "confirmation_required" as const,
            estimate,
            publishing: current.publishing,
            coverAsset: await loadPublishingCoverAsset({
              assetId: current.publishing.cover?.assetId,
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        }

        const core = current.publishing.core;
        const draft = current.publishing.drafts[input.platform];
        if (!core || !draft) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请先完成当前平台的发布稿，再生成封面",
          });
        }
        const prompt = resuming
          ? persistedGeneration!.prompt
          : composePublishingCoverPrompt({
              visualConcept: core.visualConcept,
              thesis: core.thesis,
              emotion: core.emotion,
              feedback: input.feedback,
            });
        const referenceAssetId = resuming
          ? persistedGeneration!.referenceAssetId
          : (input.referenceAssetId ?? null);
        let referenceAsset: PublishingCoverAsset | null = null;
        if (referenceAssetId != null) {
          const belongsToRound = current.publishing.coverRounds.some(round =>
            round.assetIds.includes(referenceAssetId)
          );
          if (!belongsToRound) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "选择的候选图不属于当前故事",
            });
          }
          referenceAsset = await loadPublishingCoverAsset({
            assetId: referenceAssetId,
            storyId: input.storyId,
            userId: ctx.user.id,
          });
          if (!referenceAsset) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "选择的候选图已不可用，请换一张再试",
            });
          }
        }
        let generation = persistedGeneration;
        if (persistedGeneration?.operationToken === operationToken) {
          if (persistedGeneration.status === "completed") {
            const coverRounds = await loadPublishingCoverRounds({
              publishing: current.publishing,
              storyId: input.storyId,
              userId: ctx.user.id,
            });
            const coverRound = coverRounds.find(
              round => round.id === persistedGeneration.roundId
            );
            if (!coverRound) {
              throw new Error("封面候选已完成但结果轮次不可用");
            }
            return {
              status: "ok" as const,
              estimate,
              ...current,
              coverAsset: await loadPublishingCoverAsset({
                assetId: current.publishing.cover?.assetId,
                storyId: input.storyId,
                userId: ctx.user.id,
              }),
              coverRounds,
              coverRound,
            };
          }
          if (!resuming) {
            return {
              status: "error" as const,
              error: persistedGeneration.error || "上一轮封面生成未完成",
              estimate,
              ...current,
              coverAsset: await loadPublishingCoverAsset({
                assetId: current.publishing.cover?.assetId,
                storyId: input.storyId,
                userId: ctx.user.id,
              }),
              coverRounds: await loadPublishingCoverRounds({
                publishing: current.publishing,
                storyId: input.storyId,
                userId: ctx.user.id,
              }),
            };
          }
          if (recoveringAcceptedTask) {
            const recovered = await writePublishingDraftState({
              storyId: input.storyId,
              userId: ctx.user.id,
              operation: {
                type: "update_cover_generation",
                operationToken,
                status: "pending",
                error: "",
                expiresAt: Date.now() + PUBLISHING_COVER_PROFILE.mjTimeoutMs,
              },
            });
            generation = recovered.publishing.coverGeneration;
          }
        }

        if (!resuming) {
          const claimedAt = Date.now();
          const claimed = await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "claim_cover_generation",
              basePublishingRevision: current.publishing.revision,
              generation: {
                operationToken,
                versionId: current.publishing.activeVersionId ?? "v1",
                status: "pending",
                platform: input.platform,
                referenceAssetId,
                feedback: input.feedback?.trim() ?? "",
                prompt,
                roundId: randomUUID(),
                taskId: null,
                claimedAt,
                updatedAt: claimedAt,
                expiresAt: claimedAt + PUBLISHING_COVER_PROFILE.mjTimeoutMs,
              },
            },
          });
          generation = claimed.publishing.coverGeneration;
        }
        if (!generation) throw new Error("封面生成操作没有保存成功");
        if (!generation.taskId && resuming) {
          const unknown = await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "update_cover_generation",
              operationToken,
              status: "unknown",
              error:
                "这次提交没有留下可恢复的 302 任务编号；系统不会自动重新提交，以免重复扣费。",
            },
          });
          return {
            status: "error" as const,
            error:
              unknown.publishing.coverGeneration?.error ?? "封面任务状态未知",
            estimate,
            ...unknown,
            coverAsset: await loadPublishingCoverAsset({
              assetId: unknown.publishing.cover?.assetId,
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
            coverRounds: await loadPublishingCoverRounds({
              publishing: unknown.publishing,
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        }
        const persistTaskId = async (taskId: string) => {
          await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "update_cover_generation",
              operationToken,
              taskId,
              expiresAt: Date.now() + PUBLISHING_COVER_PROFILE.mjTimeoutMs,
            },
          });
        };
        const imageOptions = {
          provider: PUBLISHING_COVER_PROFILE.provider,
          aspectRatio: PUBLISHING_COVER_PROFILE.aspectRatio,
          mjTimeoutMs: PUBLISHING_COVER_PROFILE.mjTimeoutMs,
          onMidjourneyTaskAccepted: persistTaskId,
        } as const;
        const generated = generation.taskId
          ? await resume302MidjourneyTask(generation.taskId, imageOptions)
          : referenceAsset
            ? await editImage(referenceAsset.imageUrl, prompt, {
                ...imageOptions,
                requireInputImage: true,
                imageWeight: 1.4,
              })
            : await generateImage(prompt, {
                ...imageOptions,
              });
        const generatedCandidates = generated.candidates?.slice(0, 4) ?? [];
        if (generated.status !== "ok" || generatedCandidates.length !== 4) {
          const failed = await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "update_cover_generation",
              operationToken,
              status: "failed",
              error:
                generated.message ||
                `本轮只收到 ${generatedCandidates.length} 张可用候选`,
            },
          });
          return {
            status: "error" as const,
            error:
              generated.message ||
              `本轮只收到 ${generatedCandidates.length} 张可用候选，没有写入正式封面，请重试`,
            estimate,
            ...failed,
            coverAsset: await loadPublishingCoverAsset({
              assetId: failed.publishing.cover?.assetId,
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
            coverRounds: await loadPublishingCoverRounds({
              publishing: failed.publishing,
              storyId: input.storyId,
              userId: ctx.user.id,
            }),
          };
        }

        const images = await Promise.all(
          generatedCandidates.map(candidate =>
            createGeneratedImage({
              projectId: null,
              storyId: input.storyId,
              userId: ctx.user.id,
              shotNo: PUBLISHING_COVER_SHOT_NO,
              shotIdentity: PUBLISHING_COVER_SHOT_IDENTITY,
              imageKey: candidate.imageKey ?? null,
              imageUrl: candidate.imageUrl,
              prompt,
              promptCompilationId: null,
              generationType: "initial",
              parentImageId: referenceAsset?.id ?? null,
              isCurrent: false,
              maskKey: null,
            })
          )
        );
        const createdAt = Date.now();
        const round: PublishingCoverRound = {
          id: generation.roundId,
          platform: input.platform,
          sourceCoreRevision: core.revision,
          parentAssetId: referenceAsset?.id ?? null,
          feedback: input.feedback?.trim() ?? "",
          assetIds: [
            images[0]!.id,
            images[1]!.id,
            images[2]!.id,
            images[3]!.id,
          ],
          createdAt,
        };
        const saved = await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "complete_cover_generation",
            operationToken,
            round,
          },
        });
        const coverRounds = await loadPublishingCoverRounds({
          publishing: saved.publishing,
          storyId: input.storyId,
          userId: ctx.user.id,
        });
        return {
          status: "ok" as const,
          estimate,
          ...saved,
          coverAsset: await loadPublishingCoverAsset({
            assetId: saved.publishing.cover?.assetId,
            storyId: input.storyId,
            userId: ctx.user.id,
          }),
          coverRounds,
          coverRound: coverRounds.find(candidate => candidate.id === round.id)!,
        };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  adoptCoverCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        assetId: z.number().int().positive(),
        basePublishingRevision: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const current = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        if (current.publishing.revision !== input.basePublishingRevision) {
          throw new PublishingDraftConflictError(
            "publishing",
            input.basePublishingRevision,
            current.publishing.revision
          );
        }
        const sourceRound = current.publishing.coverRounds.find(round =>
          round.assetIds.includes(input.assetId)
        );
        if (!sourceRound) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "这张图片不是当前故事的封面候选",
          });
        }
        const candidate = await loadPublishingCoverAsset({
          assetId: input.assetId,
          storyId: input.storyId,
          userId: ctx.user.id,
        });
        if (!candidate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "这张候选图已不可用，请选择其他图片",
          });
        }
        const saved = await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "set_cover",
            cover: {
              assetId: candidate.id,
              sourceCoreRevision: sourceRound.sourceCoreRevision,
              createdAt: Date.now(),
            },
            basePublishingRevision: input.basePublishingRevision,
          },
        });
        const promoted = await promoteStoryImageToCurrent({
          imageId: candidate.id,
          storyId: input.storyId,
          userId: ctx.user.id,
          metadata: { source: "publishing_cover" },
        });
        if (!promoted) {
          await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "set_cover",
              cover: current.publishing.cover,
              basePublishingRevision: saved.publishing.revision,
            },
          });
          throw new Error("封面采用失败，原封面仍然保留");
        }
        return {
          status: "ok" as const,
          ...saved,
          coverAsset: {
            id: promoted.image.id,
            imageUrl: promoted.image.imageUrl,
            imageKey: promoted.image.imageKey,
            shotIdentity: promoted.image.shotIdentity,
            createdAt: promoted.image.createdAt,
          } satisfies PublishingCoverAsset,
        };
      } catch (error) {
        throwPublishingError(error);
      }
    }),

  selectPlatforms: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        activePlatform: platformSchema,
        selectedPlatforms: z.array(platformSchema).min(1).max(6),
        basePublishingRevision: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "set_selection",
            activePlatform: input.activePlatform,
            selectedPlatforms: input.selectedPlatforms,
            basePublishingRevision: input.basePublishingRevision,
          },
        });
      } catch (error) {
        throwPublishingError(error);
      }
    }),
});
