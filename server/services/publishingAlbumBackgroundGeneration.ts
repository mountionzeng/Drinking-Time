import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { GeneratedImage } from "../../drizzle/schema";
import {
  estimatePublishingCoverCost,
  estimatePublishingCoverFallbackCost,
  PUBLISHING_COVER_PROFILE,
} from "../../shared/imageRenderCost";
import type {
  PublishingAlbumBackgroundGeneration,
  PublishingAlbumBackgroundRound,
} from "../../shared/publishingAlbum";
import {
  PUBLISHING_ALBUM_MAX_CANDIDATES_PER_ROUND,
  PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE,
} from "../../shared/publishingAlbum";
import { ENV } from "../_core/env";
import {
  createGeneratedImage,
  getGeneratedImageById,
  getStoryById,
} from "../db";
import {
  generateImage,
  resume302GptImageTask,
  resume302MidjourneyTask,
  type ImageGenCandidate,
  type ImageGenResult,
} from "./imageGen";
import {
  adoptPublishingAlbumBackground,
  claimPublishingAlbumBackground,
  completePublishingAlbumBackground,
  updatePublishingAlbumBackground,
} from "./publishingAlbumPersistence";
import {
  PUBLISHING_ALBUM_ASPECT_RATIO,
  PUBLISHING_ALBUM_PROMPT_COMPILER_VERSION,
  compilePublishingAlbumBackgroundPrompt,
  publishingAlbumArtReferenceFromCoverPrompt,
  publishingAlbumBackgroundHash,
} from "./publishingAlbumBackgroundPrompt";
import { getPublishingDraftState } from "./publishingPersistence";
import { inspectStaticImageCandidates } from "./staticImageQualityGate";

export type PublishingAlbumBackgroundProvider = "midjourney" | "gpt-image";

export type PublishingAlbumBackgroundQuote = {
  quoteId: string;
  storyId: number;
  versionId: string;
  pageId: string;
  provider: PublishingAlbumBackgroundProvider;
  inputHash: string;
  currency: "CNY";
  estimatedCny: number;
  candidateCount: number;
  expiresAt: number;
};

type AlbumBackgroundDependencies = {
  now: () => number;
  getState: typeof getPublishingDraftState;
  getStory: typeof getStoryById;
  getImage: typeof getGeneratedImageById;
  createImage: typeof createGeneratedImage;
  generate: typeof generateImage;
  resumeMidjourney: typeof resume302MidjourneyTask;
  resumeGptImage: typeof resume302GptImageTask;
  inspect: typeof inspectStaticImageCandidates;
};

const defaultDependencies: AlbumBackgroundDependencies = {
  now: Date.now,
  getState: getPublishingDraftState,
  getStory: getStoryById,
  getImage: getGeneratedImageById,
  createImage: createGeneratedImage,
  generate: generateImage,
  resumeMidjourney: resume302MidjourneyTask,
  resumeGptImage: resume302GptImageTask,
  inspect: inspectStaticImageCandidates,
};

function quoteSigningKey(): string {
  const key = ENV.cookieSecret || ENV.api302Key;
  if (!key && ENV.isProduction) throw new Error("服务器未配置画册报价签名密钥");
  return key || "local-publishing-album-quote-key";
}

function quotePayload(quote: Omit<PublishingAlbumBackgroundQuote, "quoteId">): string {
  return publishingAlbumBackgroundHash(quote);
}

function signQuote(quote: Omit<PublishingAlbumBackgroundQuote, "quoteId">): string {
  return createHmac("sha256", quoteSigningKey()).update(quotePayload(quote)).digest("hex");
}

function validQuoteSignature(quote: PublishingAlbumBackgroundQuote): boolean {
  const { quoteId: _quoteId, ...unsigned } = quote;
  const expected = Buffer.from(signQuote(unsigned), "hex");
  const actual = Buffer.from(quote.quoteId, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function costFor(provider: PublishingAlbumBackgroundProvider) {
  return provider === "midjourney"
    ? estimatePublishingCoverCost()
    : estimatePublishingCoverFallbackCost();
}

async function resolveGenerationInput(input: {
  storyId: number;
  userId: number;
  versionId: string;
  pageId: string;
  provider: PublishingAlbumBackgroundProvider;
  feedback?: string;
  dependencies: AlbumBackgroundDependencies;
}) {
  const current = await input.dependencies.getState(input.storyId, input.userId);
  const version = current.publishing.versions?.find(candidate => candidate.versionId === input.versionId);
  if (!version?.album) throw new Error("当前发布版本还没有静态画册");
  const page = version.album.pages.find(candidate => candidate.pageId === input.pageId);
  if (!page) throw new Error("画册页面不存在或已经更新");
  if (!version.cover?.assetId) throw new Error("请先为当前发布版本正式采用一张封面");
  const cover = await input.dependencies.getImage(version.cover.assetId);
  if (
    !cover || cover.storyId !== input.storyId || cover.userId !== input.userId ||
    cover.id !== version.cover.assetId
  ) throw new Error("当前版本采用的封面不属于这个故事或已经不可用");
  const story = await input.dependencies.getStory(input.storyId, input.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const compiled = await compilePublishingAlbumBackgroundPrompt({
    pageText: page.text,
    pageOrdinal: page.ordinal,
    pageCount: version.album.pages.length,
    coverPrompt: cover.prompt ?? "",
    feedback: input.feedback,
    storyId: input.storyId,
  });
  const inputSnapshot = {
    pageTextHash: publishingAlbumBackgroundHash(page.text),
    pageRevision: page.revision,
    coverAssetId: cover.id,
    coverSourceCoreRevision: version.cover.sourceCoreRevision,
    artDirectionHash: compiled.artDirectionHash,
    artReference: publishingAlbumArtReferenceFromCoverPrompt(cover.prompt ?? ""),
    promptCompilerVersion: PUBLISHING_ALBUM_PROMPT_COMPILER_VERSION,
    prompt: compiled.prompt,
    aspectRatio: PUBLISHING_ALBUM_ASPECT_RATIO,
  };
  const requestHash = publishingAlbumBackgroundHash({
    storyId: input.storyId,
    userId: input.userId,
    versionId: input.versionId,
    pageId: input.pageId,
    provider: input.provider,
    feedback: input.feedback?.trim() ?? "",
    inputSnapshot,
  });
  return { current, version, page, cover, story, inputSnapshot, requestHash };
}

export async function quotePublishingAlbumBackground(input: {
  storyId: number;
  userId: number;
  versionId: string;
  pageId: string;
  provider?: PublishingAlbumBackgroundProvider;
  feedback?: string;
  dependencies?: Partial<AlbumBackgroundDependencies>;
}): Promise<PublishingAlbumBackgroundQuote> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const provider = input.provider ?? "midjourney";
  const resolved = await resolveGenerationInput({ ...input, provider, dependencies });
  const estimate = costFor(provider);
  const unsigned = {
    storyId: input.storyId,
    versionId: input.versionId,
    pageId: input.pageId,
    provider,
    inputHash: resolved.requestHash,
    currency: estimate.currency,
    estimatedCny: estimate.estimatedCny,
    candidateCount: estimate.candidateCount,
    expiresAt: dependencies.now() + 10 * 60 * 1_000,
  };
  return { ...unsigned, quoteId: signQuote(unsigned) };
}

function candidatesFrom(result: ImageGenResult): ImageGenCandidate[] {
  if (result.candidates?.length) return result.candidates;
  return result.status === "ok" && result.imageUrl
    ? [{ imageUrl: result.imageUrl, ...(result.imageKey ? { imageKey: result.imageKey } : {}) }]
    : [];
}

export async function generatePublishingAlbumBackground(input: {
  storyId: number;
  userId: number;
  versionId: string;
  pageId: string;
  provider?: PublishingAlbumBackgroundProvider;
  feedback?: string;
  operationToken?: string;
  confirmation?: PublishingAlbumBackgroundQuote;
  dependencies?: Partial<AlbumBackgroundDependencies>;
}): Promise<
  | { status: "confirmation_required"; quote: PublishingAlbumBackgroundQuote }
  | { status: "ok"; assetIds: number[]; stale: boolean; operationToken: string }
  | { status: "error"; error: string; operationToken: string }
> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const initial = await dependencies.getState(input.storyId, input.userId);
  const initialPage = initial.publishing.versions
    ?.find(version => version.versionId === input.versionId)?.album?.pages
    .find(page => page.pageId === input.pageId);
  const outstanding = initialPage?.backgroundGeneration;
  if (
    outstanding?.status === "completed" &&
    input.operationToken?.trim() === outstanding.operationToken
  ) {
    const completedRound = initialPage?.backgroundRounds.find(
      round => round.requestHash === outstanding.requestHash
    );
    if (!completedRound) throw new Error("底图任务已完成，但候选轮次不可用");
    return {
      status: "ok",
      assetIds: completedRound.assetIds,
      stale: completedRound.stale,
      operationToken: outstanding.operationToken,
    };
  }
  const recoverable = outstanding &&
    outstanding.status !== "completed" &&
    (outstanding.status === "pending" || outstanding.status === "unknown" || Boolean(outstanding.taskId));
  const operationToken = recoverable
    ? outstanding.operationToken
    : input.operationToken?.trim() || `album-background-${randomUUID()}`;
  const provider = recoverable ? outstanding.provider as PublishingAlbumBackgroundProvider : input.provider ?? "midjourney";

  let generation: PublishingAlbumBackgroundGeneration;
  if (recoverable) {
    generation = outstanding;
  } else {
    const resolved = await resolveGenerationInput({ ...input, provider, dependencies });
    if (resolved.page.backgroundRounds.length >= PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE) {
      throw new Error(`单页最多保留 ${PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE} 轮底图候选`);
    }
    const quote = await quotePublishingAlbumBackground({ ...input, provider, dependencies });
    const confirmation = input.confirmation;
    if (!confirmation) return { status: "confirmation_required", quote };
    const quoteMatches =
      validQuoteSignature(confirmation) &&
      confirmation.expiresAt >= dependencies.now() &&
      confirmation.storyId === quote.storyId &&
      confirmation.versionId === quote.versionId &&
      confirmation.pageId === quote.pageId &&
      confirmation.provider === quote.provider &&
      confirmation.inputHash === quote.inputHash &&
      confirmation.currency === quote.currency &&
      confirmation.estimatedCny === quote.estimatedCny &&
      confirmation.candidateCount === quote.candidateCount;
    if (!quoteMatches) throw new Error("画册底图报价已过期或与当前页面不匹配，请重新确认");
    const now = dependencies.now();
    generation = {
      operationToken,
      requestHash: resolved.requestHash,
      versionId: input.versionId,
      pageId: input.pageId,
      status: "pending",
      provider,
      taskId: null,
      inputSnapshot: resolved.inputSnapshot,
      feedback: input.feedback?.trim() ?? "",
      claimedAt: now,
      updatedAt: now,
      expiresAt: now + PUBLISHING_COVER_PROFILE.mjTimeoutMs,
    };
    const claimed = await claimPublishingAlbumBackground({
      storyId: input.storyId, userId: input.userId, versionId: input.versionId,
      pageId: input.pageId, generation,
      baseBackgroundRevision: resolved.page.backgroundRevision, now,
    });
    generation = claimed.publishing.versions
      ?.find(version => version.versionId === input.versionId)?.album?.pages
      .find(page => page.pageId === input.pageId)?.backgroundGeneration ?? generation;
  }

  if (recoverable && !generation.taskId) {
    await updatePublishingAlbumBackground({
      storyId: input.storyId, userId: input.userId, versionId: input.versionId,
      pageId: input.pageId, operationToken, status: "unknown",
      error: "付费提交没有留下可恢复任务编号；系统不会自动重提，以免重复扣费。",
      now: dependencies.now(),
    });
    return { status: "error", error: "任务状态未知，未自动重复提交", operationToken };
  }

  const persistTaskId = async (taskId: string) => {
    await updatePublishingAlbumBackground({
      storyId: input.storyId, userId: input.userId, versionId: input.versionId,
      pageId: input.pageId, operationToken, taskId,
      expiresAt: dependencies.now() + PUBLISHING_COVER_PROFILE.mjTimeoutMs,
    });
  };
  const options = {
    provider,
    aspectRatio: generation.inputSnapshot.aspectRatio,
    fidelity: provider === "gpt-image" ? "draft" as const : "final" as const,
    mjTimeoutMs: PUBLISHING_COVER_PROFILE.mjTimeoutMs,
    ...(provider === "midjourney" ? { mjDraft: PUBLISHING_COVER_PROFILE.mjDraft } : {}),
    onMidjourneyTaskAccepted: persistTaskId,
    onProviderTaskAccepted: persistTaskId,
  };
  const generated = recoverable
    ? provider === "midjourney"
      ? await dependencies.resumeMidjourney(generation.taskId!, options)
      : await dependencies.resumeGptImage(generation.taskId!, options)
    : await dependencies.generate(generation.inputSnapshot.prompt, options);
  const candidates = candidatesFrom(generated);
  if (candidates.length === 0) {
    const acceptedTaskId = generated.providerTaskId ?? generation.taskId;
    await updatePublishingAlbumBackground({
      storyId: input.storyId, userId: input.userId, versionId: input.versionId,
      pageId: input.pageId, operationToken,
      ...(acceptedTaskId ? { taskId: acceptedTaskId } : {}),
      status: generated.submissionUncertain || acceptedTaskId ? "unknown" : "failed",
      error: generated.message ?? "底图生成没有返回候选",
      now: dependencies.now(),
    });
    return { status: "error", error: generated.message ?? "底图生成没有返回候选", operationToken };
  }
  if (candidates.length > PUBLISHING_ALBUM_MAX_CANDIDATES_PER_ROUND) {
    await updatePublishingAlbumBackground({
      storyId: input.storyId, userId: input.userId, versionId: input.versionId,
      pageId: input.pageId, operationToken, status: "unknown",
      error: `供应商返回 ${candidates.length} 张候选，超过单轮安全上限；结果已保留在供应商任务 ${generation.taskId ?? "（无编号）"}，系统不会自动重提。`,
      now: dependencies.now(),
    });
    return { status: "error", error: "供应商返回的候选数量超过安全上限", operationToken };
  }

  let flaggedIndexes = new Set<number>();
  let qualityCheckUnavailable = false;
  try {
    const inspection = await dependencies.inspect({ candidates });
    flaggedIndexes = new Set(inspection.rejected.map(candidate => candidate.originalIndex));
  } catch {
    qualityCheckUnavailable = true;
  }
  const assets = await Promise.all(candidates.map(candidate => dependencies.createImage({
    projectId: null,
    storyId: input.storyId,
    userId: input.userId,
    shotNo: `ALBUM:${input.versionId}:${input.pageId}`,
    shotIdentity: `publishing-album:${input.versionId}:${input.pageId}`,
    imageKey: candidate.imageKey ?? null,
    imageUrl: candidate.imageUrl,
    prompt: generation.inputSnapshot.prompt,
    promptCompilationId: null,
    generationType: "initial",
    parentImageId: generation.inputSnapshot.coverAssetId,
    isCurrent: false,
    maskKey: null,
  })));
  const now = dependencies.now();
  const round: PublishingAlbumBackgroundRound = {
    roundId: randomUUID(),
    requestHash: generation.requestHash,
    sourcePageRevision: generation.inputSnapshot.pageRevision,
    sourceCoverAssetId: generation.inputSnapshot.coverAssetId,
    feedback: generation.feedback,
    assetIds: assets.map(asset => asset.id),
    qualityFlaggedAssetIds: assets
      .filter((_asset, index) => flaggedIndexes.has(index + 1))
      .map(asset => asset.id),
    qualityCheckUnavailable,
    stale: false,
    createdAt: now,
  };
  const completed = await completePublishingAlbumBackground({
    storyId: input.storyId, userId: input.userId, versionId: input.versionId,
    pageId: input.pageId, operationToken, round, now,
  });
  const savedRound = completed.publishing.versions
    ?.find(version => version.versionId === input.versionId)?.album?.pages
    .find(page => page.pageId === input.pageId)?.backgroundRounds.at(-1);
  return { status: "ok", assetIds: round.assetIds, stale: savedRound?.stale ?? true, operationToken };
}

export async function adoptPublishingAlbumBackgroundCandidate(input: {
  storyId: number;
  userId: number;
  versionId: string;
  pageId: string;
  assetId: number;
  baseBackgroundRevision: number;
  operationToken: string;
  dependencies?: Pick<Partial<AlbumBackgroundDependencies>, "getImage">;
}) {
  const getImage = input.dependencies?.getImage ?? getGeneratedImageById;
  const image = await getImage(input.assetId);
  if (!image || image.storyId !== input.storyId || image.userId !== input.userId || image.isCurrent) {
    throw new Error("选择的底图候选不存在或不属于这个故事");
  }
  return adoptPublishingAlbumBackground(input);
}

export type PublishingAlbumGeneratedImage = GeneratedImage;
