import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PUBLISHING_PLATFORM_IDS,
  computePublishingTextOperationRequestHash,
  getPublishingContentError,
  isRecoverablePublishingCoverGeneration,
  normalizePublishingNarrativeIntent,
  resolvePublishingActiveVersion,
  type PublishingCoverArtReference,
  type PublishingCoverRound,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformId,
  type PublishingStoryCoreContent,
  type PublishingTextOperationKind,
  type PublishingTextOperationReceipt,
  type PublishingTextOperationScope,
} from "../../shared/publishingDraft";
import {
  PUBLISHING_COVER_SHOT_IDENTITY,
  PUBLISHING_COVER_SHOT_NO,
} from "../../shared/imageAsset";
import {
  estimatePublishingCoverCost,
  estimatePublishingCoverFallbackCost,
  PUBLISHING_COVER_PROFILE,
} from "../../shared/imageRenderCost";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeAgent } from "../_core/agentChannel";
import {
  createGeneratedImage,
  getGeneratedImageById,
  getStoryById,
  promoteStoryImageToCurrent,
} from "../db";
import {
  editImage,
  generateDraftImage,
  generateImage,
  resume302GptImageTask,
  resume302MidjourneyTask,
} from "../services/imageGen";
import { engineerImagePrompt } from "../services/renderGate";
import { inspectStaticImageCandidates } from "../services/staticImageQualityGate";
import { storyArtRecipe } from "./_storyShared";
import type { ArtRecipeDNA } from "../../shared/artDirection";
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
  repairPublishingDraftFormatting,
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
const textOperationScopeSchema = z.object({
  storyId: z.number().int().positive(),
  versionId: z.string().trim().min(1).max(64),
  platform: platformSchema,
  sourcePlatform: platformSchema.optional(),
  containerRevision: z.number().int().nonnegative(),
  versionRevision: z.number().int().nonnegative(),
  coreRevision: z.number().int().nonnegative(),
  draftRevision: z.number().int().nonnegative(),
  sourceDraftRevision: z.number().int().nonnegative().optional(),
  intentRevision: z.number().int().nonnegative(),
  contextRevision: z.number().int().nonnegative(),
});
const artReferenceStringListSchema = z
  .array(z.string().trim().min(1).max(300))
  .max(12);
const publishingCoverArtReferenceSchema = z.object({
  label: z.string().trim().min(1).max(160),
  imageUrl: z.string().trim().max(2_000).optional(),
  style: artReferenceStringListSchema,
  palette: artReferenceStringListSchema,
  light: artReferenceStringListSchema,
  composition: artReferenceStringListSchema,
  material: artReferenceStringListSchema,
  mood: artReferenceStringListSchema,
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

function currentPublishingTextScope(params: {
  storyId: number;
  publishing: PublishingDraftState;
  platform: PublishingPlatformId;
  sourcePlatform?: PublishingPlatformId;
}): PublishingTextOperationScope {
  const version = resolvePublishingActiveVersion(params.publishing);
  return {
    storyId: params.storyId,
    versionId: version.versionId,
    platform: params.platform,
    ...(params.sourcePlatform ? { sourcePlatform: params.sourcePlatform } : {}),
    containerRevision: params.publishing.containerRevision ?? params.publishing.revision,
    versionRevision: version.versionRevision,
    coreRevision: version.core?.revision ?? 0,
    draftRevision: version.drafts[params.platform]?.revision ?? 0,
    ...(params.sourcePlatform
      ? { sourceDraftRevision: version.drafts[params.sourcePlatform]?.revision ?? 0 }
      : {}),
    intentRevision: version.intentSnapshot?.revision ?? 0,
    contextRevision: 0,
  };
}

function assertPublishingTextScope(
  requested: PublishingTextOperationScope | undefined,
  actual: PublishingTextOperationScope
): PublishingTextOperationScope {
  if (!requested) return actual;
  const requestedHash = computePublishingTextOperationRequestHash({
    kind: "format_repair",
    scope: requested,
    payload: null,
  });
  const actualHash = computePublishingTextOperationRequestHash({
    kind: "format_repair",
    scope: actual,
    payload: null,
  });
  if (requestedHash !== actualHash) {
    throw new PublishingDraftConflictError(
      "publishing",
      requested.containerRevision,
      actual.containerRevision
    );
  }
  return actual;
}

function assertPublishingTextScopeIdentity(
  requested: PublishingTextOperationScope,
  actual: PublishingTextOperationScope
): void {
  if (
    requested.storyId !== actual.storyId ||
    requested.versionId !== actual.versionId ||
    requested.platform !== actual.platform ||
    requested.sourcePlatform !== actual.sourcePlatform
  ) {
    throw new PublishingDraftConflictError(
      "publishing",
      requested.containerRevision,
      actual.containerRevision
    );
  }
}

type ClaimedPublishingTextOperation = {
  operationToken: string;
  requestHash: string;
  scope: PublishingTextOperationScope;
  receipt: PublishingTextOperationReceipt;
  storyRevision: number;
  publishing: PublishingDraftState;
  replayed: boolean;
};

async function claimPublishingTextOperation(params: {
  storyId: number;
  userId: number;
  current: { storyRevision: number; publishing: PublishingDraftState };
  kind: PublishingTextOperationKind;
  scope: PublishingTextOperationScope;
  actualScope: PublishingTextOperationScope;
  payload: unknown;
  operationToken?: string;
  requestHash?: string;
}): Promise<ClaimedPublishingTextOperation> {
  const operationToken = params.operationToken?.trim() || randomUUID();
  const requestHash = computePublishingTextOperationRequestHash({
    kind: params.kind,
    scope: params.scope,
    payload: params.payload,
  });
  if (params.requestHash && params.requestHash !== requestHash) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "操作校验值与当前请求不一致" });
  }
  const version = params.current.publishing.versions?.find(
    candidate => candidate.versionId === params.scope.versionId
  );
  const existing = version?.textOperations?.[operationToken];
  if (existing) {
    // A durable receipt may belong to a version that is no longer active.
    // Replaying or reclaiming it must never redirect work into the current
    // projection merely because the token still exists in versions[].
    assertPublishingTextScopeIdentity(params.scope, params.actualScope);
    if (existing.requestHash !== requestHash) {
      throw new TRPCError({ code: "CONFLICT", message: "这个操作编号已经用于不同的请求" });
    }
    if (existing.status === "completed") {
      return {
        operationToken,
        requestHash,
        scope: params.scope,
        receipt: existing,
        storyRevision: params.current.storyRevision,
        publishing: params.current.publishing,
        replayed: true,
      };
    }
    if (existing.status === "failed") {
      throw new TRPCError({ code: "BAD_REQUEST", message: existing.error || "上次操作失败，请重新发起" });
    }
    if (existing.expiresAt > Date.now()) {
      throw new TRPCError({ code: "CONFLICT", message: "同一文字操作仍在执行，请稍后查看结果" });
    }
  } else {
    assertPublishingTextScope(params.scope, params.actualScope);
  }
  const now = Date.now();
  const pending: PublishingTextOperationReceipt = {
    status: "pending",
    kind: params.kind,
    operationToken,
    requestHash,
    scope: structuredClone(params.scope),
    claimedAt: now,
    updatedAt: now,
    expiresAt: now + 2 * 60_000,
  };
  const claimed = await writePublishingDraftState({
    storyId: params.storyId,
    userId: params.userId,
    operation: {
      type: "claim_text_operation",
      receipt: pending,
      baseContainerRevision: params.actualScope.containerRevision,
      baseVersionRevision: params.actualScope.versionRevision,
    },
  });
  return {
    operationToken,
    requestHash,
    scope: params.scope,
    receipt: claimed.textOperationReceipt ?? pending,
    storyRevision: claimed.storyRevision,
    publishing: claimed.publishing,
    replayed: claimed.textOperationReceipt?.status === "completed",
  };
}

function completedPublishingTextReceipt(
  claim: ClaimedPublishingTextOperation,
  result: NonNullable<PublishingTextOperationReceipt["result"]>
): PublishingTextOperationReceipt {
  return {
    ...claim.receipt,
    status: "completed",
    updatedAt: Date.now(),
    result,
  };
}

async function failPublishingTextOperation(
  claim: ClaimedPublishingTextOperation,
  userId: number,
  error: unknown
): Promise<void> {
  if (claim.replayed) return;
  const version = claim.publishing.versions?.find(candidate => candidate.versionId === claim.scope.versionId);
  const failed: PublishingTextOperationReceipt = {
    ...claim.receipt,
    status: "failed",
    updatedAt: Date.now(),
    error: error instanceof Error ? error.message.slice(0, 500) : "文字操作失败",
  };
  try {
    await writePublishingDraftState({
      storyId: claim.scope.storyId,
      userId,
      operation: {
        type: "settle_text_operation",
        receipt: failed,
        baseContainerRevision: claim.publishing.containerRevision ?? claim.publishing.revision,
        baseVersionRevision: version?.versionRevision ?? 0,
      },
    });
  } catch {
    // The original failure is more useful. A concurrent writer leaves the
    // durable pending claim to expire and be reclaimed safely.
  }
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

/**
 * Midjourney `--iw` (0–3) weighs the reference image against the prompt. At the
 * old 1.4 the reference always won, so "按意见修改这张" could adjust mood but
 * could not honour the very instructions users actually write — remove the
 * lettering, make the subject a woman — because the reference kept feeding both
 * back in. Below 1 the prompt leads and the reference still carries composition,
 * palette and lighting, which is what this button promises.
 */
const PUBLISHING_COVER_REVISE_IMAGE_WEIGHT = 0.5;

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

function cleanCoverVisualConcept(value: string): string {
  const cleaned = value
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
  if (
    /(?:极简[^。！？\n]{0,40}(?:照片|摄影)|photoreal|photograph|product\s*photo|时钟|闹钟|怀表|钟表|沙漏|灯泡|棋子|道路|梯子|拼图|发光大脑)/i.test(
      cleaned
    )
  ) {
    return "";
  }
  return cleaned;
}

/** 这里只整理内容事实；色调、光线、风格和创造力全部交给唯一提示词工程。 */
function composePublishingCoverContentBrief(params: {
  facts: string[];
  visualConcept: string;
  thesis: string;
  emotion: string;
}): string {
  const visualConcept = cleanCoverVisualConcept(params.visualConcept);
  return [
    "【封面内容简报】",
    params.facts.length ? `已经确认的事实：${params.facts.join("；")}` : "",
    visualConcept ? `原始视觉联想（可推翻，不是事实）：${visualConcept}` : "",
    `核心表达：${params.thesis}`,
    params.emotion ? `内容情绪：${params.emotion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function coverInstructions(
  instructions: string[] | undefined,
  feedback: string | undefined
): string[] {
  const normalized = [...(instructions ?? []), feedback ?? ""]
    .map(value => value.trim())
    .filter(Boolean);
  return normalized
    .filter((value, index) => normalized.lastIndexOf(value) === index)
    .slice(-20);
}

function coverArtRecipe(
  storyRecipe: ArtRecipeDNA | undefined,
  reference: PublishingCoverArtReference | null | undefined
): ArtRecipeDNA | undefined {
  if (!reference) return storyRecipe;
  const choose = (referenceValues: string[], storyValues?: string[]) =>
    referenceValues.length > 0 ? referenceValues : (storyValues ?? []);
  return {
    style: choose(reference.style, storyRecipe?.style),
    palette: choose(reference.palette, storyRecipe?.palette),
    light: choose(reference.light, storyRecipe?.light),
    composition: choose(reference.composition, storyRecipe?.composition),
    material: choose(reference.material, storyRecipe?.material),
    negative: storyRecipe?.negative ?? [],
  };
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
          coverFallbackEstimate: estimatePublishingCoverFallbackCost(),
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
        requestHash: z.string().trim().min(8).max(128).optional(),
        sourceVersionId: z.string().trim().min(1).max(64).optional(),
        bufferDisposition: z.enum(["leave", "carry", "cancel"]).optional(),
        sourceBufferKey: z.string().trim().max(300).optional(),
        sourceBufferHash: z.string().trim().max(128).optional(),
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
            requestHash: input.requestHash,
            sourceVersionId: input.sourceVersionId,
            bufferDisposition: input.bufferDisposition,
            sourceBufferKey: input.sourceBufferKey,
            sourceBufferHash: input.sourceBufferHash,
            storyId: input.storyId,
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
        requestHash: z.string().trim().min(8).max(128).optional(),
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
            ...(input.requestHash ? { requestHash: input.requestHash } : {}),
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
        requestHash: z.string().trim().min(8).max(128).optional(),
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
            ...(input.requestHash ? { requestHash: input.requestHash } : {}),
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
        scope: textOperationScopeSchema.optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
        requestHash: z.string().trim().min(8).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let claim: ClaimedPublishingTextOperation | null = null;
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
        const current = await getPublishingDraftState(input.storyId, ctx.user.id);
        if (!input.scope && current.publishing.revision !== input.basePublishingRevision) {
          throw new PublishingDraftConflictError(
            "publishing",
            input.basePublishingRevision,
            current.publishing.revision
          );
        }
        const actualScope = currentPublishingTextScope({
          storyId: input.storyId,
          publishing: current.publishing,
          platform: input.activePlatform,
        });
        const scope = input.scope ?? actualScope;
        claim = await claimPublishingTextOperation({
          storyId: input.storyId,
          userId: ctx.user.id,
          current,
          kind: "generate",
          scope,
          actualScope,
          payload: {
            activePlatform: input.activePlatform,
            selectedPlatforms: input.selectedPlatforms,
          },
          operationToken: input.operationToken,
          requestHash: input.requestHash,
        });
        if (claim.replayed && claim.receipt.result) {
          return {
            storyId: input.storyId,
            storyRevision: claim.storyRevision,
            publishing: claim.publishing,
            modelLabel: claim.receipt.result.modelLabel,
            operationScope: scope,
            operationToken: claim.operationToken,
            requestHash: claim.requestHash,
            replayed: true,
          };
        }
        const generated = await generatePublishingDraft({
          platform: input.activePlatform,
          conversation,
          narrativeIntent,
        });
        const completed = completedPublishingTextReceipt(claim, {
          status: "created",
          core: generated.core,
          content: generated.content,
          modelLabel: generated.modelLabel,
          draftRevision: 1,
        });
        const claimedVersion = claim.publishing.versions?.find(
          version => version.versionId === scope.versionId
        );
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
            basePublishingRevision: claim.publishing.revision,
            baseContainerRevision: claim.publishing.containerRevision ?? claim.publishing.revision,
            baseVersionRevision: claimedVersion?.versionRevision ?? 0,
            textOperationReceipt: completed,
          },
        });
        return {
          ...saved,
          modelLabel: generated.modelLabel,
          operationScope: scope,
          operationToken: claim.operationToken,
          requestHash: claim.requestHash,
          replayed: false,
        };
      } catch (error) {
        if (claim) await failPublishingTextOperation(claim, ctx.user.id, error);
        throwPublishingError(error);
      }
    }),

  convert: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        sourcePlatform: platformSchema,
        targetPlatform: platformSchema,
        scope: textOperationScopeSchema.optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
        requestHash: z.string().trim().min(8).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let claim: ClaimedPublishingTextOperation | null = null;
      try {
        const current = await getPublishingDraftState(
          input.storyId,
          ctx.user.id
        );
        const actualScope = currentPublishingTextScope({
          storyId: input.storyId,
          publishing: current.publishing,
          platform: input.targetPlatform,
          sourcePlatform: input.sourcePlatform,
        });
        const scope = input.scope ?? actualScope;
        const existing = current.publishing.drafts[input.targetPlatform];
        const core = current.publishing.core;
        const source = current.publishing.drafts[input.sourcePlatform];
        if (!core || !source) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请先生成来源平台的发布稿",
          });
        }
        claim = await claimPublishingTextOperation({
          storyId: input.storyId,
          userId: ctx.user.id,
          current,
          kind: "convert",
          scope,
          actualScope,
          payload: {
            sourcePlatform: input.sourcePlatform,
            targetPlatform: input.targetPlatform,
          },
          operationToken: input.operationToken,
          requestHash: input.requestHash,
        });
        if (claim.replayed && claim.receipt.result) {
          return {
            storyId: input.storyId,
            storyRevision: claim.storyRevision,
            publishing: claim.publishing,
            status: claim.receipt.result.status === "candidate" ? "candidate" as const : "created" as const,
            content: claim.receipt.result.content,
            modelLabel: claim.receipt.result.modelLabel,
            operationScope: scope,
            operationToken: claim.operationToken,
            requestHash: claim.requestHash,
            replayed: true,
          };
        }
        const converted = await convertPublishingDraft({
          core,
          sourceDraft: source,
          targetPlatform: input.targetPlatform,
          ...(existing ? { currentTarget: existing.content } : {}),
        });
        const completed = completedPublishingTextReceipt(claim, {
          status: existing ? "candidate" : "created",
          content: converted.content,
          modelLabel: converted.modelLabel,
          ...(!existing ? { draftRevision: 1 } : {}),
        });
        const claimedVersion = claim.publishing.versions?.find(
          version => version.versionId === scope.versionId
        );
        const saved = existing
          ? await writePublishingDraftState({
              storyId: input.storyId,
              userId: ctx.user.id,
              operation: {
                type: "settle_text_operation",
                receipt: completed,
                baseContainerRevision: claim.publishing.containerRevision ?? claim.publishing.revision,
                baseVersionRevision: claimedVersion?.versionRevision ?? 0,
              },
            })
          : await writePublishingDraftState({
              storyId: input.storyId,
              userId: ctx.user.id,
              operation: {
                type: "upsert_draft",
                platform: input.targetPlatform,
                content: converted.content,
                baseDraftRevision: 0,
                activate: true,
                baseContainerRevision: claim.publishing.containerRevision ?? claim.publishing.revision,
                baseVersionRevision: claimedVersion?.versionRevision ?? 0,
                textOperationReceipt: completed,
              },
            });
        return {
          ...saved,
          status: existing ? "candidate" as const : "created" as const,
          content: converted.content,
          modelLabel: converted.modelLabel,
          operationScope: scope,
          operationToken: claim.operationToken,
          requestHash: claim.requestHash,
          replayed: false,
        };
      } catch (error) {
        if (claim) await failPublishingTextOperation(claim, ctx.user.id, error);
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
        scope: textOperationScopeSchema.optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
        requestHash: z.string().trim().min(8).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let claim: ClaimedPublishingTextOperation | null = null;
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
        const actualScope = currentPublishingTextScope({
          storyId: input.storyId,
          publishing: current.publishing,
          platform: input.platform,
        });
        const scope = input.scope ?? actualScope;
        claim = await claimPublishingTextOperation({
          storyId: input.storyId,
          userId: ctx.user.id,
          current,
          kind: "rewrite",
          scope,
          actualScope,
          payload: {
            instruction: input.instruction,
            content: input.content,
          },
          operationToken: input.operationToken,
          requestHash: input.requestHash,
        });
        if (claim.replayed && claim.receipt.result) {
          return {
            status: "preview" as const,
            content: claim.receipt.result.content,
            baseDraftRevision: draft.revision,
            modelLabel: claim.receipt.result.modelLabel,
            operationScope: scope,
            operationToken: claim.operationToken,
            requestHash: claim.requestHash,
            replayed: true,
          };
        }
        const revised = await revisePublishingDraft({
          core,
          current: input.content,
          platform: input.platform,
          instruction: input.instruction,
        });
        const completed = completedPublishingTextReceipt(claim, {
          status: "preview",
          content: revised.content,
          modelLabel: revised.modelLabel,
          draftRevision: draft.revision,
        });
        const claimedVersion = claim.publishing.versions?.find(
          version => version.versionId === scope.versionId
        );
        await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "settle_text_operation",
            receipt: completed,
            baseContainerRevision: claim.publishing.containerRevision ?? claim.publishing.revision,
            baseVersionRevision: claimedVersion?.versionRevision ?? 0,
          },
        });
        return {
          status: "preview" as const,
          content: revised.content,
          baseDraftRevision: draft.revision,
          modelLabel: revised.modelLabel,
          operationScope: scope,
          operationToken: claim.operationToken,
          requestHash: claim.requestHash,
          replayed: false,
        };
      } catch (error) {
        if (claim) await failPublishingTextOperation(claim, ctx.user.id, error);
        throwPublishingError(error);
      }
    }),

  repairFormatting: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        platform: platformSchema,
        content: contentSchema,
        baseDraftRevision: z.number().int().positive(),
        scope: textOperationScopeSchema.optional(),
        operationToken: z.string().trim().min(1).max(200).optional(),
        requestHash: z.string().trim().min(8).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let claim: ClaimedPublishingTextOperation | null = null;
      try {
        assertPublishingContentFitsPlatform(input.platform, input.content);
        const current = await getPublishingDraftState(input.storyId, ctx.user.id);
        const draft = current.publishing.drafts[input.platform];
        if (!draft) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "当前平台还没有可修复格式的发布稿" });
        }
        if (draft.revision !== input.baseDraftRevision) {
          throw new PublishingDraftConflictError(
            input.platform,
            input.baseDraftRevision,
            draft.revision
          );
        }
        const actualScope = currentPublishingTextScope({
          storyId: input.storyId,
          publishing: current.publishing,
          platform: input.platform,
        });
        const scope = input.scope ?? actualScope;
        claim = await claimPublishingTextOperation({
          storyId: input.storyId,
          userId: ctx.user.id,
          current,
          kind: "format_repair",
          scope,
          actualScope,
          payload: { content: input.content },
          operationToken: input.operationToken,
          requestHash: input.requestHash,
        });
        if (claim.replayed && claim.receipt.result) {
          return {
            status: "repaired" as const,
            content: claim.receipt.result.content,
            baseDraftRevision: draft.revision,
            modelLabel: claim.receipt.result.modelLabel,
            operationScope: scope,
            operationToken: claim.operationToken,
            requestHash: claim.requestHash,
            replayed: true,
          };
        }
        const content = repairPublishingDraftFormatting({
          platform: input.platform,
          content: input.content,
        });
        const completed = completedPublishingTextReceipt(claim, {
          status: "repaired",
          content,
          modelLabel: "本地格式修复",
          draftRevision: draft.revision,
        });
        const claimedVersion = claim.publishing.versions?.find(
          version => version.versionId === scope.versionId
        );
        await writePublishingDraftState({
          storyId: input.storyId,
          userId: ctx.user.id,
          operation: {
            type: "settle_text_operation",
            receipt: completed,
            baseContainerRevision: claim.publishing.containerRevision ?? claim.publishing.revision,
            baseVersionRevision: claimedVersion?.versionRevision ?? 0,
          },
        });
        return {
          status: "repaired" as const,
          content,
          baseDraftRevision: draft.revision,
          modelLabel: "本地格式修复",
          operationScope: scope,
          operationToken: claim.operationToken,
          requestHash: claim.requestHash,
          replayed: false,
        };
      } catch (error) {
        if (claim) await failPublishingTextOperation(claim, ctx.user.id, error);
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
        const current = await getPublishingDraftState(input.storyId, ctx.user.id);
        const active = current.publishing.versions?.find(
          version => version.versionId === current.publishing.activeVersionId
        );
        const actualCoreRevision = active?.core?.revision ?? 0;
        const actualDraftRevision = active?.drafts[input.platform]?.revision ?? 0;
        if (actualCoreRevision !== input.baseCoreRevision) {
          throw new PublishingDraftConflictError("core", input.baseCoreRevision, actualCoreRevision);
        }
        if (actualDraftRevision !== input.baseDraftRevision) {
          throw new PublishingDraftConflictError(input.platform, input.baseDraftRevision, actualDraftRevision);
        }
        return {
          ...current,
          status: "version_transition_required" as const,
          transition: {
            storyId: input.storyId,
            sourceVersionId: active?.versionId ?? "v1",
            platform: input.platform,
            baseContainerRevision: current.publishing.containerRevision ?? 0,
            baseVersionRevision: active?.versionRevision ?? 0,
            baseCoreRevision: input.baseCoreRevision,
            baseDraftRevision: input.baseDraftRevision,
            core: input.core as PublishingStoryCoreContent,
            content: input.content,
          },
        };
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
        provider: z
          .enum(["midjourney", "gpt-image", "flux-schnell"])
          .optional(),
        basePublishingRevision: z.number().int().nonnegative(),
        referenceAssetId: z.number().int().positive().optional(),
        feedback: z.string().trim().max(2_000).optional(),
        instructions: z
          .array(z.string().trim().min(1).max(2_000))
          .max(20)
          .optional(),
        artReference: publishingCoverArtReferenceSchema.nullable().optional(),
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
        const persistedGeneration = current.publishing.coverGeneration;
        /**
         * A fresh click mints a new operation token, which used to skip the
         * resume branch entirely and overwrite an outstanding provider task id
         * — silently abandoning a round the user already paid for. When a paid
         * receipt is still owed a recovery, adopt its token so this call
         * recovers that round instead of buying another one.
         */
        const outstandingPaidReceipt =
          !input.operationToken &&
          isRecoverablePublishingCoverGeneration(persistedGeneration)
            ? persistedGeneration
            : null;
        const operationToken =
          outstandingPaidReceipt?.operationToken ??
          input.operationToken ??
          `cover-${randomUUID()}`;
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
        const coverProvider = matchingOperation
          ? (persistedGeneration?.provider ?? "midjourney")
          : (input.provider ?? "midjourney");
        const estimate =
          coverProvider === "midjourney"
            ? estimatePublishingCoverCost()
            : estimatePublishingCoverFallbackCost();
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
        const instructions = resuming
          ? coverInstructions(
              persistedGeneration!.instructions,
              persistedGeneration!.feedback
            )
          : coverInstructions(input.instructions, input.feedback);
        const artReference = resuming
          ? (persistedGeneration!.artReference ?? null)
          : (input.artReference ?? null);
        const explorationRound = current.publishing.coverRounds.length + 1;
        const discardPreviousRound =
          referenceAssetId == null && current.publishing.coverRounds.length > 0;
        let prompt = persistedGeneration?.prompt ?? "";
        if (!resuming) {
          const story = await getStoryById(input.storyId, ctx.user.id);
          if (!story) {
            throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
          }
          const referenceMoodInstruction = artReference?.mood.length
            ? [`参考图的情绪语言：${artReference.mood.join("、")}`]
            : [];
          prompt = await engineerImagePrompt({
            prompt: composePublishingCoverContentBrief({
              facts: core.facts,
              visualConcept: discardPreviousRound ? "" : core.visualConcept,
              thesis: core.thesis,
              emotion: core.emotion,
            }),
            storyId: input.storyId,
            projectId: story.projectId ?? undefined,
            emotion: core.emotion,
            userInstructions: [...instructions, ...referenceMoodInstruction],
            artDirection: coverArtRecipe(storyArtRecipe(story), artReference),
            outputPurpose: "publishing-cover",
            referencePolicy: referenceAssetId
              ? "preserve-composition"
              : artReference
                ? "style-only"
                : "none",
            fourCandidateExploration: true,
            discardPreviousRound,
            explorationRound,
          });
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
                provider: coverProvider,
                referenceAssetId,
                feedback: input.feedback?.trim() ?? "",
                instructions,
                artReference,
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
          provider:
            coverProvider === "flux-schnell" ? "gpt-image" : coverProvider,
          aspectRatio: PUBLISHING_COVER_PROFILE.aspectRatio,
          fidelity: coverProvider === "gpt-image" ? "draft" : "final",
          mjTimeoutMs: PUBLISHING_COVER_PROFILE.mjTimeoutMs,
          // Exploration rounds run in MJ v7 Draft Mode: same art lineage, about
          // ten times faster and half the price, so changing direction is cheap.
          ...(coverProvider === "midjourney"
            ? { mjDraft: PUBLISHING_COVER_PROFILE.mjDraft }
            : {}),
          onMidjourneyTaskAccepted: persistTaskId,
          onProviderTaskAccepted: persistTaskId,
        } as const;
        /**
         * `prompt` is the full Chinese art brief: the record of intent, and
         * what GPT-image reads well. Midjourney and Flux do not — a multi-page
         * Chinese brief dilutes the subject and actively raises the odds of
         * lettering and signatures appearing in the pixels. They get a short
         * English scene compiled from that same brief instead.
         */
        let renderPrompt = prompt;
        if (!generation.taskId && coverProvider !== "gpt-image") {
          const compiled = await invokeAgent(
            [
              {
                role: "system",
                content:
                  // Diffusion models have no "not". Every forbidden noun that
                  // reaches the positive prompt is an instruction to draw it —
                  // "no newspapers" is how a man ends up buried in newspapers.
                  // So the compiler must produce a purely affirmative scene and
                  // never name the thing being avoided; suppression is the
                  // --no parameter's job, not this text's.
                  "Compile the supplied Chinese art brief into ONE English visual prompt describing a single vertical painted scene. Keep the confirmed story facts: who is present, how they relate, the setting, and what is happening. HIGHEST PRIORITY: the 【用户持续要求】 block is the user's own binding art direction — carry EVERY concrete detail in it through literally (subject gender, age, hair, clothing, season, palette, light, mood), even when compressing. Appearance the source text never states is NOT a story fact; it is the user's to decide, so never soften or drop such a direction on the grounds that it might alter the story — obey it. If a direction says the two people are women, both figures are unambiguously women. Losing one of these details is a failure; sacrifice background description instead. Drop only section headers, policy sentences, and rules — describe what is visibly in the picture. Write purely affirmative description: state what IS there, never what is absent, forbidden or avoided. This is a standalone painting, NOT a cover, poster, magazine, layout or publication — never use those words. Never write the words text, letters, words, writing, title, headline, sign, label, logo, watermark, signature, book, newspaper, screen, or clock, not even to forbid them, and never describe any surface that would carry writing. Do not quote or transliterate source words. Output English only, one paragraph, under 140 words.",
              },
              { role: "user", content: prompt },
            ],
            400
          );
          const compiledText = compiled.text.trim();
          if (compiledText) {
            renderPrompt = `${compiledText} Handcrafted tempera and gouache painting, visible paper grain and brush marks, one continuous vertical scene, quiet empty space near the top, plain unmarked surfaces throughout.`;
          }
        }
        const generated = generation.taskId
          ? coverProvider === "gpt-image"
            ? await resume302GptImageTask(generation.taskId, imageOptions)
            : await resume302MidjourneyTask(generation.taskId, imageOptions)
          : coverProvider === "flux-schnell"
            ? await generateDraftImage(renderPrompt, imageOptions)
            : referenceAsset
              ? await editImage(referenceAsset.imageUrl, renderPrompt, {
                  ...imageOptions,
                  requireInputImage: true,
                  imageWeight: PUBLISHING_COVER_REVISE_IMAGE_WEIGHT,
                })
              : await generateImage(renderPrompt, {
                  ...imageOptions,
                });
        const expectedCandidateCount = coverProvider === "midjourney" ? 4 : 1;
        const generatedCandidates =
          generated.candidates?.slice(0, expectedCandidateCount) ??
          (generated.imageUrl
            ? [
                {
                  imageUrl: generated.imageUrl,
                  imageKey: generated.imageKey,
                },
              ]
            : []);
        // A partial delivery is still a paid delivery: only a round that
        // produced nothing usable counts as a failure.
        if (generated.status !== "ok" || generatedCandidates.length === 0) {
          const acceptedTaskId = generated.providerTaskId?.trim() || "";
          const submissionUncertain =
            generated.submissionUncertain === true &&
            !generation.taskId &&
            !acceptedTaskId;
          const acceptedButReceiptWriteFailed =
            Boolean(acceptedTaskId) && !generation.taskId;
          const generationError = acceptedButReceiptWriteFailed
            ? `302 已受理封面任务 ${acceptedTaskId}，但本地保存任务编号时暂时失败（${generated.message || "本地状态写入异常"}）。系统只会恢复同一个任务，不会重新提交或重复扣费。`
            : submissionUncertain
              ? `提交封面任务时连接中断，未拿到 302 任务编号，无法确认上游是否已经受理（${generated.message || "网络连接异常"}）。系统不会自动重新提交，以免重复扣费；请先在 302 后台确认本轮记录，再决定是否开启新一轮。`
              : generated.message ||
                `本轮只收到 ${generatedCandidates.length} 张可用候选`;
          const failed = await writePublishingDraftState({
            storyId: input.storyId,
            userId: ctx.user.id,
            operation: {
              type: "update_cover_generation",
              operationToken,
              status: submissionUncertain ? "unknown" : "failed",
              ...(acceptedButReceiptWriteFailed
                ? { taskId: acceptedTaskId }
                : {}),
              error: generationError,
            },
          });
          return {
            status: "error" as const,
            error:
              submissionUncertain || acceptedButReceiptWriteFailed
                ? generationError
                : generated.message ||
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

        /**
         * Pixel QA advises, it never discards. The round is already paid for,
         * so every candidate reaches the user; risky ones are merely labelled
         * and the user decides whether a mark is acceptable. QA being down is
         * likewise not a reason to withhold images the provider delivered.
         */
        let flaggedIndexes = new Set<number>();
        let qualityCheckUnavailable = false;
        try {
          const qualityInspection = await inspectStaticImageCandidates({
            candidates: generatedCandidates,
          });
          flaggedIndexes = new Set(
            qualityInspection.rejected.map(candidate => candidate.originalIndex)
          );
        } catch (error) {
          // Swallowing this made a crashed inspection indistinguishable from a
          // clean one, so obviously text-covered candidates were presented as
          // if they had passed. Deliver them anyway — they are paid for — but
          // say plainly that nothing checked them.
          qualityCheckUnavailable = true;
          console.warn(
            "[publishingDraft] 像素质检不可用，本轮候选未经检查：",
            error instanceof Error ? error.message : error
          );
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
          feedback: generation.feedback || input.feedback?.trim() || "",
          instructions: generation.instructions ?? instructions,
          artReference: generation.artReference ?? artReference,
          assetIds: images.map(image => image.id),
          ...(flaggedIndexes.size > 0
            ? {
                qualityFlaggedAssetIds: images
                  .filter((_image, index) => flaggedIndexes.has(index + 1))
                  .map(image => image.id),
                qualityCheckedAt: createdAt,
              }
            : {}),
          ...(qualityCheckUnavailable
            ? { qualityCheckUnavailable: true, qualityCheckedAt: createdAt }
            : {}),
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
