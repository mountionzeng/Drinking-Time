import { createHash } from "node:crypto";
import {
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  getStoryById,
  getVideoTakeById,
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
import { materializeVideoUrl } from "./videoMedia";
import {
  directVideoPrompt,
  type VideoPromptDirectorResult,
  type VideoPromptShotContext,
} from "./videoPromptDirector";
import {
  PromptLineageValidationError,
  resolveGenerationPromptCompilation,
} from "./promptLineage";

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

function storyVideoContext(
  body: unknown,
  stableShotId: string,
  shotNo: number
): {
  currentShot?: VideoPromptShotContext;
  previousShot?: VideoPromptShotContext;
  nextShot?: VideoPromptShotContext;
} {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(record.shots)
    ? record.shots.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  const index = shots.findIndex((shot, candidateIndex) => {
    const identity =
      normalizeShotIdentity(shot.stableShotId) ??
      normalizeShotIdentity(shot.shotIdentity) ??
      normalizeShotIdentity(shot.shotKey);
    if (identity) return identity === stableShotId;
    const canonical = canonicalizeShotNo(
      shot.shotNo as string | number | null | undefined
    );
    return canonical === `SH${String(shotNo).padStart(2, "0")}` ||
      (!canonical && candidateIndex + 1 === shotNo);
  });
  if (index < 0) return {};

  const context = (
    shot: Record<string, unknown> | undefined
  ): VideoPromptShotContext | undefined => {
    if (!shot) return undefined;
    const value = (key: string) =>
      typeof shot[key] === "string" ? String(shot[key]).trim() : "";
    return {
      intent: value("intent"),
      subject: value("subject"),
      action: value("action"),
      cameraMove: value("cameraMove"),
      videoStart: value("videoStart"),
      videoEnd: value("videoEnd"),
      mood: value("mood") || value("emotion"),
      dialogue: value("dialogue"),
      transitionIn: value("transitionIn"),
      transitionOut: value("transitionOut"),
    };
  };

  return {
    currentShot: context(shots[index]),
    previousShot: context(shots[index - 1]),
    nextShot: context(shots[index + 1]),
  };
}

/**
 * 清洗 prompt 使其适合 MJ-Video API。
 * 首帧已经定义主体和美术风格，视频端只需要运动相关信息。把整份镜头设计、
 * 台词和负面词一并提交，会增加 MJ 参数校验和内容审核误判的概率。
 */
export function sanitizeVideoPrompt(raw: string): string {
  const motionLabels = new Set([
    "核心视频提示",
    "动作",
    "相机运动",
    "起始画面",
    "结束状态",
    "接上一镜",
    "接下一镜",
  ]);
  const motionLines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const match = line.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
      if (!match || !motionLabels.has(match[1].trim())) return [];
      return [match[2].trim()];
    });
  const source = motionLines.length > 0 ? motionLines.join(", ") : raw;
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
    .replace(/[{]/g, "(").replace(/[}]/g, ")") // 花括号 -> 圆括号
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
    lines.push("连续性参考：当前 image 字段只使用本镜已选首帧；以下相邻镜头只用于运动和接镜参考。");
  }
  if (params.previousReference) {
    lines.push(`前一镜参考图：${videoReferenceLabel(params.previousReference)}`);
  }
  if (params.nextReference) {
    lines.push(`后一镜参考图：${videoReferenceLabel(params.nextReference)}`);
  }
  return lines.filter(Boolean).join("\n");
}

function snapshot(input: {
  submitUrl?: string;
  submittedParameters?: Record<string, unknown>;
  sourceImageId: number;
  previousReference?: ImageAsset | null;
  nextReference?: ImageAsset | null;
  durationSec: number;
  aspectRatio: string;
  motion: "low" | "high";
  taskId?: string | null;
  promptDirector: VideoPromptDirectorResult;
}) {
  const providerStatus = getShotVideoProviderStatus();
  return {
    provider: "302",
    model: providerStatus.model,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio,
    sourceImageId: input.sourceImageId,
    previousReferenceImageId: input.previousReference?.id,
    previousReferenceShotNo: input.previousReference?.canonicalShotNo,
    nextReferenceImageId: input.nextReference?.id,
    nextReferenceShotNo: input.nextReference?.canonicalShotNo,
    submitPath: providerStatus.submitPath,
    pollPath: providerStatus.pollPath || undefined,
    imageField: providerStatus.imageField,
    motion: input.motion,
    promptDirector: {
      source: input.promptDirector.source,
      model: input.promptDirector.model,
      analysis: input.promptDirector.analysis,
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
  previousReferenceImageId?: number | null;
  nextReferenceImageId?: number | null;
  prompt: string;
  subtitle?: string;
  durationSec?: number;
  aspectRatio?: string;
  motion?: "low" | "high";
};

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
  const aspectRatio = input.aspectRatio ?? "16:9";
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
  const deterministicPrompt = promptWithVideoReferences({
    prompt: input.prompt,
    previousReference,
    nextReference,
    forMjVideo: /\/mj\/submit\/video/.test(providerStatus.submitPath),
  });
  const idempotencyKey = hashParts(
    input.storyId,
    stableShotId,
    input.imageId,
    deterministicPrompt,
    input.subtitle,
    durationSec,
    aspectRatio,
    providerStatus.model,
    providerStatus.submitPath,
    motion,
    ENV.videoPrompt302Model,
    previousReference?.id,
    nextReference?.id
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
  const story = await getStoryById(input.storyId, userId);
  const context = storyVideoContext(
    story?.body,
    stableShotId,
    input.shotNo
  );
  const promptDirector = /\/mj\/submit\/video/.test(providerStatus.submitPath)
    ? await directVideoPrompt({
        imageInput: sourceImage,
        fallbackPrompt: deterministicPrompt,
        shotNo: input.shotNo,
        draftPrompt: input.prompt,
        subtitle: input.subtitle,
        storyTitle: story?.title,
        ...context,
      })
    : {
        prompt: deterministicPrompt,
        source: "deterministic-fallback" as const,
        model: "",
        analysis: null,
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
      durationSec,
      aspectRatio,
      motion,
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
    const failed = await updateVideoTake(take.id, userId, {
      status: "failed",
      errorMessage: error,
      taskId: submitted.taskId ?? null,
    });
    return { status: "error", error, take: failed ?? take };
  }

  const managed = submitted.videoUrl
    ? await materializeVideoUrl(submitted.videoUrl, take.id)
    : null;
  const updated = await updateVideoTake(take.id, userId, {
    status: submitted.videoUrl ? "available" : "processing",
    taskId: submitted.taskId ?? null,
    videoUrl:
      managed?.status === "ok"
        ? managed.videoUrl
        : submitted.videoUrl ?? null,
    videoKey: managed?.status === "ok" ? managed.videoKey : null,
    extractionCapability:
      managed?.status === "ok" ? "available" : "unavailable",
    parameterSnapshot: snapshot({
      submitUrl: submitted.submitUrl,
      submittedParameters: submitted.submittedParameters,
      sourceImageId: input.imageId,
      previousReference,
      nextReference,
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
  if (!take.taskId) {
    if (take.status === "available") return { status: "ok", take };
    const updated = await updateVideoTake(take.id, userId, {
      status: "unfollowable",
      errorMessage: "视频任务没有返回 taskId，无法继续查询。",
    });
    return { status: "ok", take: updated ?? take };
  }

  const refreshed = await refreshShotVideoTask(take.taskId);
  if (refreshed.status === "available") {
    const managed = await materializeVideoUrl(refreshed.videoUrl, take.id);
    const updated = await updateVideoTake(take.id, userId, {
      status: "available",
      videoUrl:
        managed.status === "ok" ? managed.videoUrl : refreshed.videoUrl,
      videoKey: managed.status === "ok" ? managed.videoKey : null,
      extractionCapability:
        managed.status === "ok" ? "available" : "unavailable",
      errorMessage: null,
    });
    return { status: "ok", take: updated ?? take };
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
