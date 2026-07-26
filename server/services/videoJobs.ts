import { createHash } from "node:crypto";
import path from "node:path";
import {
  clearVideoTimelineSelection,
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  getStoryVideoTimelineSelections,
  getStoryById,
  getVideoTakeById,
  setVideoTimelineSelection,
  updateVideoTake,
} from "../db";
import { ENV } from "../_core/env";
import { getStoryImageAssets, materializeImageInput } from "./imageAssets";
import {
  getShotVideoProviderStatus,
  refreshShotVideoTask,
  submitShotVideo,
} from "./videoGen";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import type { VideoTakeStatus } from "../../shared/videoAsset";
import type { VideoTake } from "../../drizzle/schema";
import type { ImageAsset } from "../../shared/imageAsset";
import { VIDEO_TARGET_ASPECT_RATIOS } from "../../shared/videoConform";
import { SHOT_VIDEO_ASPECT_RATIO } from "../../shared/shotDirector";
import { decideVideoRenderStrategy } from "../../shared/videoMotionPolicy";
import { localVideoDir, materializeVideoUrl } from "./videoMedia";
import {
  finalizeExpandedVideoFile,
  isRunwayExpandTake,
  refreshRunwayVideoExpandTask,
  runwayPaidResultFailurePatch,
} from "./videoConform";
import {
  directVideoPrompt,
  mjSafeVideoPrompt,
  type VideoPromptDirectorResult,
} from "./videoPromptDirector";
import {
  compileVideoPromptEngineering,
  finalizeVideoPromptEngineering,
  VIDEO_PROMPT_ENGINEERING_VERSION,
} from "./videoPromptEngineering";
import { storyVideoContext } from "./videoShotContext";
import {
  isStartEndShotVideoTake,
  refreshStartEndShotVideoTake,
} from "./startEndShotVideoWorkflow";
import {
  createLocalMotionVideoTake,
  isLocalMotionVideoTake,
  refreshLocalMotionVideoTake,
} from "./localMotionVideo";
import {
  PromptLineageValidationError,
  resolveGenerationPromptCompilation,
} from "./promptLineage";

type VideoSubmissionPromptDirectorResult = Omit<
  VideoPromptDirectorResult,
  "source"
> & {
  source: VideoPromptDirectorResult["source"] | "editor-approved";
};

function hashParts(
  ...parts: Array<string | number | null | undefined>
): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

function safeSubmittedParameters(
  parameters: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    safe[key] = /image|url/i.test(key) ? "[source-image]" : value;
  }
  return safe;
}

function parameterSnapshotRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isMjVideoTake(take: VideoTake): boolean {
  if (take.model === "mj-video") return true;
  const parameters = parameterSnapshotRecord(take.parameterSnapshot);
  return parameters.submitPath === "/mj/submit/video";
}

async function materializeMjVideoVariants(input: {
  take: VideoTake;
  candidateVideoUrls: readonly string[];
  previewVideoUrl?: string;
  userId: number;
}): Promise<VideoTake> {
  const { take, userId } = input;
  const candidateVideoUrls = Array.from(new Set(input.candidateVideoUrls));
  const parentSnapshot = parameterSnapshotRecord(take.parameterSnapshot);
  const candidateTakeIds: number[] = [];

  for (let index = 0; index < candidateVideoUrls.length; index += 1) {
    const providerVideoUrl = candidateVideoUrls[index];
    const idempotencyKey = hashParts(
      "mj-video-variant",
      take.storyId,
      take.id,
      index,
      providerVideoUrl
    );
    let candidate = await findVideoTakeByIdempotencyKey(
      take.storyId,
      userId,
      idempotencyKey
    );
    if (!candidate) {
      candidate = await createVideoTake({
        storyId: take.storyId,
        userId,
        stableShotId: take.stableShotId,
        sourceImageId: take.sourceImageId,
        promptCompilationId: take.promptCompilationId,
        status: "processing",
        taskId: null,
        provider: take.provider,
        model: take.model,
        prompt: take.prompt,
        subtitle: take.subtitle,
        durationSec: take.durationSec,
        aspectRatio: take.aspectRatio,
        videoUrl: null,
        videoKey: null,
        errorMessage: null,
        parameterSnapshot: {
          ...parentSnapshot,
          sourceTakeId: take.id,
          providerTaskId: take.taskId,
          providerVideoUrl,
          mjVideoVariantIndex: index,
          mjVideoVariantLabel: `V${index + 1}`,
          mjVideoVariantCount: candidateVideoUrls.length,
          resultSelectionRule: "user-select-variant",
        },
        idempotencyKey,
        extractionCapability: "unavailable",
      });
    }

    if (candidate.status !== "available" || !candidate.videoUrl) {
      const managed = await materializeVideoUrl(providerVideoUrl, candidate.id);
      candidate =
        (await updateVideoTake(candidate.id, userId, {
          status: "available",
          videoUrl:
            managed.status === "ok" ? managed.videoUrl : providerVideoUrl,
          videoKey: managed.status === "ok" ? managed.videoKey : null,
          extractionCapability:
            managed.status === "ok" ? "available" : "unavailable",
          errorMessage: null,
        })) ?? candidate;
    }
    candidateTakeIds.push(candidate.id);
  }

  const selections = await getStoryVideoTimelineSelections(
    take.storyId,
    userId
  );
  if (selections.some(selection => selection.takeId === take.id)) {
    await clearVideoTimelineSelection(take.storyId, userId, take.stableShotId);
  }

  return (
    (await updateVideoTake(take.id, userId, {
      status: "unfollowable",
      videoUrl: input.previewVideoUrl ?? take.videoUrl,
      errorMessage: "四宫格仅供比较，请从 V1-V4 中选择一个版本。",
      parameterSnapshot: {
        ...parentSnapshot,
        previewVideoUrl: input.previewVideoUrl ?? take.videoUrl,
        candidateTakeIds,
        candidateVideoCount: candidateVideoUrls.length,
        resultSelectionRule: "user-select-variant",
        candidatesMaterializedAt: new Date().toISOString(),
      },
    })) ?? take
  );
}

function videoReferenceAsset(
  assets: readonly ImageAsset[],
  imageId: number | null | undefined,
  sourceImageId: number
): ImageAsset | null {
  if (imageId == null || imageId === sourceImageId) return null;
  const asset = assets.find(candidate => candidate.id === imageId);
  if (
    !asset ||
    asset.assignment !== "shot" ||
    !isCurrentImageAsset(asset) ||
    asset.availability === "missing"
  ) {
    return null;
  }
  return asset;
}

function isCurrentImageAsset(asset: ImageAsset): boolean {
  return (
    asset.isPrimary ||
    asset.selectionSource === "explicit" ||
    asset.selectionSource === "legacy" ||
    asset.status === "selected"
  );
}

function videoReferenceLabel(asset: ImageAsset): string {
  const shotLabel = asset.canonicalShotNo ?? asset.shotIdentity ?? "UNKNOWN";
  const prompt = asset.prompt?.trim();
  const publicUrl = /^https?:\/\//i.test(asset.imageUrl)
    ? `；公网图：${asset.imageUrl}`
    : "";
  return `${shotLabel} image #${asset.id}${publicUrl}${prompt ? `；画面提示：${prompt}` : ""}`;
}

/**
 * 清洗 prompt 使其适合 MJ-Video API。
 * 首帧已经定义主体和美术风格，视频端只需要运动相关信息。把整份镜头设计、
 * 台词和负面词一并提交，会增加 MJ 参数校验和内容审核误判的概率。
 */
export function sanitizeVideoPrompt(raw: string): string {
  const motionLabelPriority = new Map([
    ["动作", 0],
    ["表演", 1],
    ["环境变化", 2],
    ["相机运动", 3],
    ["主体运动路径", 4],
    ["起始画面", 5],
    ["结束状态", 6],
    ["接上一镜", 7],
    ["接下一镜", 8],
    ["核心视频提示", 9],
  ]);
  const motionLines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const match = line.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
      const label = match?.[1].trim() ?? "";
      const priority = motionLabelPriority.get(label);
      if (!match || priority == null) return [];
      return [{ value: match[2].trim(), priority }];
    })
    .sort((left, right) => left.priority - right.priority);
  const source =
    motionLines.length > 0
      ? motionLines.map(line => line.value).join(", ")
      : raw;
  let prompt = source
    .replace(/连续性参考[：:].*/g, "") // 去掉连续性参考指令行
    .replace(/前一镜参考图[：:].*/g, "") // 去掉前一镜参考
    .replace(/后一镜参考图[：:].*/g, "") // 去掉后一镜参考
    .replace(/画面提示[：:].*/g, "") // 去掉画面提示引用
    .replace(/https?:\/\/\S+/gi, "") // MJ 会单独接收 image，不在 prompt 里重复 URL
    .replace(/--[a-z][\w-]*(?:\s+\S+)?/gi, "") // 不接受用户注入 MJ 命令参数
    .replace(/[\r\n]+/g, ", ") // 换行 -> 逗号分隔
    .replace(/[，。；：！？、""''【】（）《》]/g, " ") // 中文标点 -> 空格
    .replace(/[""'']/g, " ") // 引号 -> 空格
    .replace(/[{]/g, "(")
    .replace(/[}]/g, ")") // 花括号 -> 圆括号
    .replace(/\s{2,}/g, " ") // 多个空格合并
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
  if (prompt.length > 320) {
    const head = prompt.slice(0, 320);
    const boundary = Math.max(head.lastIndexOf(","), head.lastIndexOf(" "));
    prompt = (boundary >= 240 ? head.slice(0, boundary) : head).trim();
  }
  return (
    prompt ||
    "subtle natural motion, stable camera, preserve subject and composition"
  );
}

export function explainVideoProviderError(message: string): string {
  if (
    message
      .trim()
      .toLowerCase()
      .includes("prompt parameter error or image not approved")
  ) {
    return "302/MJ 未通过视频提示词或首帧审核。请简化动作描述；若仍失败，请更换当前主图后重试。";
  }
  return message;
}

export function isUnknownVideoSubmissionFailure(message: string): boolean {
  return /timeout|timed out|fetch failed|network|aborted|socket|econnreset/i.test(
    message.trim()
  );
}

function promptWithVideoReferences(params: {
  prompt: string;
  previousReference: ImageAsset | null;
  nextReference: ImageAsset | null;
  forMjVideo?: boolean;
}): string {
  const cleaned = params.forMjVideo
    ? sanitizeVideoPrompt(params.prompt)
    : params.prompt.trim();
  if (params.forMjVideo) return cleaned;
  const lines = [cleaned];
  if (params.previousReference || params.nextReference) {
    lines.push(
      "连续性参考：当前 image 字段只使用本镜已选首帧；以下相邻镜头只用于运动和接镜参考。"
    );
  }
  if (params.previousReference) {
    lines.push(
      `前一镜参考图：${videoReferenceLabel(params.previousReference)}`
    );
  }
  if (params.nextReference) {
    lines.push(`后一镜参考图：${videoReferenceLabel(params.nextReference)}`);
  }
  return lines.filter(Boolean).join("\n");
}

function sanitizeApprovedVideoPrompt(raw: string): string {
  const prompt = mjSafeVideoPrompt(raw.trim())
    .replace(/连续性参考[：:].*/g, "")
    .replace(/前一镜参考图[：:].*/g, "")
    .replace(/后一镜参考图[：:].*/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/--[a-z][\w-]*(?:\s+\S+)?/gi, "")
    .trim();
  return (
    prompt ||
    "subtle natural motion, stable camera, preserve subject and composition"
  );
}

function snapshot(input: {
  submitUrl?: string;
  submittedParameters?: Record<string, unknown>;
  sourceImageId: number;
  characterReferenceImageUrl?: string;
  previousReference?: ImageAsset | null;
  nextReference?: ImageAsset | null;
  durationSec: number;
  aspectRatio: string;
  motion: "low" | "high";
  rerenderRequestId?: string;
  taskId?: string | null;
  promptDirector: VideoSubmissionPromptDirectorResult;
}) {
  const providerStatus = getShotVideoProviderStatus();
  const characterReferenceImageUrl = input.characterReferenceImageUrl?.startsWith(
    "data:"
  )
    ? "inline-image"
    : input.characterReferenceImageUrl;
  return {
    provider: "302",
    model: providerStatus.model,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio,
    sourceImageId: input.sourceImageId,
    characterReferenceImageUrl,
    previousReferenceImageId: input.previousReference?.id,
    previousReferenceShotNo: input.previousReference?.canonicalShotNo,
    nextReferenceImageId: input.nextReference?.id,
    nextReferenceShotNo: input.nextReference?.canonicalShotNo,
    submitPath: providerStatus.submitPath,
    pollPath: providerStatus.pollPath || undefined,
    imageField: providerStatus.imageField,
    motion: input.motion,
    rerenderRequestId: input.rerenderRequestId,
    promptDirector: {
      source: input.promptDirector.source,
      model: input.promptDirector.model,
      analysis: input.promptDirector.analysis,
      engineering: input.promptDirector.engineering,
      fallbackReason: input.promptDirector.fallbackReason,
    },
    taskId: input.taskId ?? undefined,
    generatedAt: new Date().toISOString(),
    resultSelectionRule: "first-valid-url",
    submitUrl: input.submitUrl,
    submittedParameters: input.submittedParameters
      ? safeSubmittedParameters(input.submittedParameters)
      : undefined,
  };
}

function statusForRefresh(
  status: "failed" | "timeout" | "unfollowable"
): VideoTakeStatus {
  return status;
}

export type StartShotVideoJobInput = {
  storyId: number;
  shotNo: number;
  stableShotId?: string | null;
  promptCompilationId?: number | null;
  imageId: number;
  characterReferenceImageUrl?: string;
  previousReferenceImageId?: number | null;
  nextReferenceImageId?: number | null;
  prompt: string;
  subtitle?: string;
  durationSec?: number;
  aspectRatio?: string;
  motion?: "low" | "high";
  directorPromptApproved?: boolean;
  rerenderRequestId?: string;
};

export async function resolveShotVideoRenderDecision(
  input: Pick<
    StartShotVideoJobInput,
    "storyId" | "shotNo" | "stableShotId" | "prompt"
  >,
  userId: number
) {
  const stableShotId = normalizeShotIdentity(input.stableShotId);
  const story = await getStoryById(input.storyId, userId);
  if (!story) throw new Error("故事不存在或无权操作");
  const context = stableShotId
    ? storyVideoContext(story.body, stableShotId, input.shotNo)
    : {};
  return decideVideoRenderStrategy({
    ...context.currentShot,
    videoPrompt: context.currentShot?.videoPrompt || input.prompt,
  });
}

export async function startShotVideoJob(
  input: StartShotVideoJobInput,
  userId: number
): Promise<
  | { status: "ok"; take: VideoTake }
  | { status: "error"; error: string; take?: VideoTake }
> {
  const assets = await getStoryImageAssets(input.storyId, userId);
  const asset = assets.find(candidate => candidate.id === input.imageId);
  const canonicalShotNo = canonicalizeShotNo(input.shotNo);
  const stableShotId =
    normalizeShotIdentity(input.stableShotId) ??
    normalizeShotIdentity(asset?.shotIdentity) ??
    (canonicalShotNo
      ? normalizeShotIdentity(`legacy-${canonicalShotNo}`)
      : null);

  if (
    !asset ||
    asset.assignment !== "shot" ||
    !isCurrentImageAsset(asset) ||
    asset.availability === "missing" ||
    (asset.shotIdentity &&
      stableShotId &&
      asset.shotIdentity !== stableShotId) ||
    (!asset.shotIdentity && asset.canonicalShotNo !== canonicalShotNo)
  ) {
    return { status: "error", error: "首帧图不存在或不属于当前镜头" };
  }
  if (!stableShotId) {
    return { status: "error", error: "当前镜头缺少稳定身份，无法追踪视频任务" };
  }
  let promptCompilationId = input.promptCompilationId ?? null;
  try {
    const resolved = await resolveGenerationPromptCompilation({
      storyId: input.storyId,
      userId,
      stableShotId,
      modality: "video",
      expectedCompilationId: input.promptCompilationId,
    });
    promptCompilationId = resolved.compilationId;
  } catch (error) {
    if (error instanceof PromptLineageValidationError) {
      return { status: "error", error: error.message };
    }
    throw error;
  }

  const durationSec = input.durationSec ?? 5;
  const aspectRatio = input.aspectRatio ?? SHOT_VIDEO_ASPECT_RATIO;
  const story = await getStoryById(input.storyId, userId);
  if (!story) return { status: "error", error: "故事不存在或无权操作" };
  const context = storyVideoContext(story.body, stableShotId, input.shotNo);
  const renderDecision = decideVideoRenderStrategy({
    ...context.currentShot,
    videoPrompt: context.currentShot?.videoPrompt || input.prompt,
  });
  if (renderDecision.strategy === "local-transform") {
    return createLocalMotionVideoTake({
      storyId: input.storyId,
      userId,
      stableShotId,
      sourceImage: asset,
      promptCompilationId,
      prompt: input.prompt,
      subtitle: input.subtitle,
      durationSec,
      decision: renderDecision,
      rerenderRequestId: input.rerenderRequestId,
    });
  }
  const providerStatus = getShotVideoProviderStatus();
  const motion = input.motion ?? providerStatus.motion;
  const previousReference = videoReferenceAsset(
    assets,
    input.previousReferenceImageId,
    input.imageId
  );
  const nextReference = videoReferenceAsset(
    assets,
    input.nextReferenceImageId,
    input.imageId
  );
  const isMjVideo = /\/mj\/submit\/video/.test(providerStatus.submitPath);
  const identityImageInput = input.characterReferenceImageUrl
    ? await materializeImageInput(input.characterReferenceImageUrl)
    : undefined;
  const deterministicPrompt = input.directorPromptApproved
    ? sanitizeApprovedVideoPrompt(input.prompt)
    : promptWithVideoReferences({
        prompt: input.prompt,
        previousReference,
        nextReference,
        forMjVideo: isMjVideo,
      });
  const baseEngineering = compileVideoPromptEngineering({
    fallbackPrompt: deterministicPrompt,
    shotNo: input.shotNo,
    cueCode: context.cueCode,
    draftPrompt: input.prompt,
    subtitle: input.subtitle,
    previousReferenceNote:
      !isMjVideo && previousReference
        ? `前一镜参考图：${videoReferenceLabel(previousReference)}`
        : undefined,
    nextReferenceNote:
      !isMjVideo && nextReference
        ? `后一镜参考图：${videoReferenceLabel(nextReference)}`
        : undefined,
    currentShot: context.currentShot,
    previousShot: context.previousShot,
    nextShot: context.nextShot,
  });
  const preparedEngineering = input.directorPromptApproved
    ? finalizeVideoPromptEngineering(
        baseEngineering,
        deterministicPrompt,
        "editor-approved"
      )
    : baseEngineering;
  const idempotencyKey = hashParts(
    input.storyId,
    stableShotId,
    input.imageId,
    preparedEngineering.fingerprint,
    VIDEO_PROMPT_ENGINEERING_VERSION,
    input.subtitle,
    durationSec,
    aspectRatio,
    providerStatus.model,
    providerStatus.submitPath,
    motion,
    input.directorPromptApproved ? "editor-approved" : "auto-directed",
    ENV.videoPrompt302Model,
    previousReference?.id,
    nextReference?.id,
    input.characterReferenceImageUrl,
    input.rerenderRequestId
  );
  const existing = await findVideoTakeByIdempotencyKey(
    input.storyId,
    userId,
    idempotencyKey
  );
  if (existing && existing.status !== "failed") {
    return { status: "ok", take: existing };
  }

  const sourceImage = await materializeImageInput(asset.imageUrl);
  const promptDirector: VideoSubmissionPromptDirectorResult =
    input.directorPromptApproved
      ? {
          prompt: deterministicPrompt,
          source: "editor-approved",
          model: "",
          analysis: null,
          engineering: preparedEngineering,
          fallbackReason: "用户已在故事版确认并应用导演方案",
        }
      : isMjVideo
        ? await directVideoPrompt({
            imageInput: sourceImage,
            identityImageInput,
            fallbackPrompt: deterministicPrompt,
            shotNo: input.shotNo,
            draftPrompt: input.prompt,
            subtitle: input.subtitle,
            storyTitle: story?.title,
            ...context,
          })
        : {
            prompt: preparedEngineering.finalPrompt,
            source: "deterministic-fallback",
            model: "",
            analysis: null,
            engineering: preparedEngineering,
            fallbackReason: "当前视频供应商不是 MJ-Video",
          };
  const videoPrompt = promptDirector.prompt;

  const take = await createVideoTake({
    storyId: input.storyId,
    userId,
    stableShotId,
    sourceImageId: input.imageId,
    promptCompilationId,
    status: "submitted",
    provider: "302",
    model: providerStatus.model || "unconfigured",
    prompt: videoPrompt,
    subtitle: input.subtitle ?? null,
    durationSec,
    aspectRatio,
    parameterSnapshot: snapshot({
      sourceImageId: input.imageId,
      previousReference,
      nextReference,
      characterReferenceImageUrl: input.characterReferenceImageUrl,
      durationSec,
      aspectRatio,
      motion,
      rerenderRequestId: input.rerenderRequestId,
      promptDirector,
    }),
    idempotencyKey,
    extractionCapability: "unavailable",
  });

  const submitted = await submitShotVideo({
    prompt: videoPrompt,
    sourceImage,
    subtitle: input.subtitle,
    durationSec,
    aspectRatio,
    motion,
  });

  if (submitted.status !== "ok") {
    const error = explainVideoProviderError(submitted.message);
    const unknownSubmission = isUnknownVideoSubmissionFailure(
      submitted.message
    );
    const errorMessage = unknownSubmission
      ? `${error}；付费提交结果未知，为避免重复扣费，请不要直接重试。`
      : error;
    const failed = await updateVideoTake(take.id, userId, {
      status: unknownSubmission ? "unfollowable" : "failed",
      errorMessage,
      taskId: submitted.taskId ?? null,
    });
    return { status: "error", error: errorMessage, take: failed ?? take };
  }

  const managed = submitted.videoUrl
    ? await materializeVideoUrl(submitted.videoUrl, take.id)
    : null;
  const submittedPrompt =
    typeof submitted.submittedParameters?.prompt === "string"
      ? submitted.submittedParameters.prompt
      : videoPrompt;
  const updated = await updateVideoTake(take.id, userId, {
    status: submitted.videoUrl ? "available" : "processing",
    prompt: submittedPrompt,
    taskId: submitted.taskId ?? null,
    videoUrl:
      managed?.status === "ok"
        ? managed.videoUrl
        : (submitted.videoUrl ?? null),
    videoKey: managed?.status === "ok" ? managed.videoKey : null,
    extractionCapability:
      managed?.status === "ok" ? "available" : "unavailable",
    parameterSnapshot: snapshot({
      submitUrl: submitted.submitUrl,
      submittedParameters: submitted.submittedParameters,
      sourceImageId: input.imageId,
      previousReference,
      nextReference,
      characterReferenceImageUrl: input.characterReferenceImageUrl,
      durationSec,
      aspectRatio,
      motion,
      taskId: submitted.taskId,
      promptDirector,
    }),
  });

  return { status: "ok", take: updated ?? take };
}

export async function refreshVideoTakeStatus(
  takeId: number,
  userId: number
): Promise<
  { status: "ok"; take: VideoTake } | { status: "error"; error: string }
> {
  const take = await getVideoTakeById(takeId, userId);
  if (!take) return { status: "error", error: "视频任务不存在或无权操作" };
  if (isLocalMotionVideoTake(take)) {
    return refreshLocalMotionVideoTake(take, userId);
  }
  if (isStartEndShotVideoTake(take)) {
    return refreshStartEndShotVideoTake(take, userId);
  }
  if (!take.taskId) {
    if (take.status === "available") return { status: "ok", take };
    const updated = await updateVideoTake(take.id, userId, {
      status: "unfollowable",
      errorMessage: "视频任务没有返回 taskId，无法继续查询。",
    });
    return { status: "ok", take: updated ?? take };
  }

  const refreshed = isRunwayExpandTake(take)
    ? await refreshRunwayVideoExpandTask(take.taskId)
    : await refreshShotVideoTask(take.taskId);
  if (refreshed.status === "available") {
    const mjCandidateVideoUrls =
      "candidateVideoUrls" in refreshed &&
      Array.isArray(refreshed.candidateVideoUrls)
        ? refreshed.candidateVideoUrls
        : undefined;
    if (
      isMjVideoTake(take) &&
      mjCandidateVideoUrls &&
      mjCandidateVideoUrls.length > 1
    ) {
      const parent = await materializeMjVideoVariants({
        take,
        candidateVideoUrls: mjCandidateVideoUrls,
        previewVideoUrl:
          "previewVideoUrl" in refreshed &&
          typeof refreshed.previewVideoUrl === "string"
            ? refreshed.previewVideoUrl
            : undefined,
        userId,
      });
      return { status: "ok", take: parent };
    }
    const managed = await materializeVideoUrl(refreshed.videoUrl, take.id);
    let finalVideo =
      managed.status === "ok"
        ? { videoUrl: managed.videoUrl, videoKey: managed.videoKey }
        : { videoUrl: refreshed.videoUrl, videoKey: null };
    if (isRunwayExpandTake(take)) {
      if (managed.status !== "ok") {
        const failure = runwayPaidResultFailurePatch(managed.message);
        const failed = await updateVideoTake(take.id, userId, {
          ...failure,
          parameterSnapshot: {
            ...parameterSnapshotRecord(take.parameterSnapshot),
            providerVideoUrl: refreshed.videoUrl,
            providerSubmissionAccepted: true,
          },
        });
        return { status: "ok", take: failed ?? take };
      }
      const targetAspectRatio = VIDEO_TARGET_ASPECT_RATIOS.find(
        ratio => ratio === take.aspectRatio
      );
      if (!targetAspectRatio) {
        const failure = runwayPaidResultFailurePatch(
          `不支持的目标比例：${take.aspectRatio}`
        );
        const failed = await updateVideoTake(take.id, userId, {
          ...failure,
          parameterSnapshot: {
            ...parameterSnapshotRecord(take.parameterSnapshot),
            providerVideoUrl: refreshed.videoUrl,
            providerVideoKey: managed.videoKey,
            providerSubmissionAccepted: true,
          },
        });
        return { status: "ok", take: failed ?? take };
      }
      try {
        finalVideo = await finalizeExpandedVideoFile({
          sourcePath: path.join(localVideoDir(), managed.videoKey),
          takeId: take.id,
          targetAspectRatio,
        });
      } catch (error) {
        const failure = runwayPaidResultFailurePatch(
          error instanceof Error ? error.message : "AI 外扩结果尺寸统一失败"
        );
        const failed = await updateVideoTake(take.id, userId, {
          ...failure,
          parameterSnapshot: {
            ...parameterSnapshotRecord(take.parameterSnapshot),
            providerVideoUrl: refreshed.videoUrl,
            providerVideoKey: managed.videoKey,
            providerSubmissionAccepted: true,
          },
        });
        return { status: "ok", take: failed ?? take };
      }
    }
    const updated = await updateVideoTake(take.id, userId, {
      status: "available",
      videoUrl: finalVideo.videoUrl,
      videoKey: finalVideo.videoKey,
      extractionCapability: finalVideo.videoKey ? "available" : "unavailable",
      errorMessage: null,
    });
    const ready = updated ?? take;
    if (isRunwayExpandTake(take) && ready.status === "available") {
      await setVideoTimelineSelection({
        storyId: ready.storyId,
        userId,
        stableShotId: ready.stableShotId,
        takeId: ready.id,
        rangeId: null,
        selectionType: "full_take",
      });
    }
    return { status: "ok", take: ready };
  }
  if (refreshed.status === "processing") {
    const updated = await updateVideoTake(take.id, userId, {
      status: "processing",
      errorMessage: null,
    });
    return { status: "ok", take: updated ?? take };
  }

  const updated = await updateVideoTake(take.id, userId, {
    status: statusForRefresh(refreshed.status),
    errorMessage: explainVideoProviderError(refreshed.message),
  });
  return { status: "ok", take: updated ?? take };
}
