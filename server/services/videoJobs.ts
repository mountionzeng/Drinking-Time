import { createHash } from "node:crypto";
import {
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  getVideoTakeById,
  updateVideoTake,
} from "../db";
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
    asset.availability === "missing"
  ) {
    return null;
  }
  return asset;
}

function videoReferenceLabel(asset: ImageAsset): string {
  const shotLabel = asset.canonicalShotNo ?? asset.shotIdentity ?? "UNKNOWN";
  const prompt = asset.prompt?.trim();
  const publicUrl = /^https?:\/\//i.test(asset.imageUrl)
    ? `；公网图：${asset.imageUrl}`
    : "";
  return `${shotLabel} image #${asset.id}${publicUrl}${prompt ? `；画面提示：${prompt}` : ""}`;
}

function promptWithVideoReferences(params: {
  prompt: string;
  previousReference: ImageAsset | null;
  nextReference: ImageAsset | null;
}): string {
  const lines = [params.prompt.trim()];
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
    motion: providerStatus.motion,
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
  imageId: number;
  previousReferenceImageId?: number | null;
  nextReferenceImageId?: number | null;
  prompt: string;
  subtitle?: string;
  durationSec?: number;
  aspectRatio?: string;
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

  const durationSec = input.durationSec ?? 5;
  const aspectRatio = input.aspectRatio ?? "16:9";
  const providerStatus = getShotVideoProviderStatus();
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
  const videoPrompt = promptWithVideoReferences({
    prompt: input.prompt,
    previousReference,
    nextReference,
  });
  const idempotencyKey = hashParts(
    input.storyId,
    stableShotId,
    input.imageId,
    videoPrompt,
    input.subtitle,
    durationSec,
    aspectRatio,
    providerStatus.model,
    providerStatus.submitPath,
    providerStatus.motion,
    previousReference?.id,
    nextReference?.id
  );
  const existing = await findVideoTakeByIdempotencyKey(
    input.storyId,
    userId,
    idempotencyKey
  );
  if (existing) return { status: "ok", take: existing };

  const take = await createVideoTake({
    storyId: input.storyId,
    userId,
    stableShotId,
    sourceImageId: input.imageId,
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
    }),
    idempotencyKey,
    extractionCapability: "unavailable",
  });

  const sourceImage = await materializeImageInput(asset.imageUrl);
  const submitted = await submitShotVideo({
    prompt: videoPrompt,
    sourceImage,
    subtitle: input.subtitle,
    durationSec,
    aspectRatio,
  });

  if (submitted.status !== "ok") {
    const failed = await updateVideoTake(take.id, userId, {
      status: "failed",
      errorMessage: submitted.message,
      taskId: submitted.taskId ?? null,
    });
    return { status: "error", error: submitted.message, take: failed ?? take };
  }

  const updated = await updateVideoTake(take.id, userId, {
    status: submitted.videoUrl ? "available" : "processing",
    taskId: submitted.taskId ?? null,
    videoUrl: submitted.videoUrl ?? null,
    parameterSnapshot: snapshot({
      submitUrl: submitted.submitUrl,
      submittedParameters: submitted.submittedParameters,
      sourceImageId: input.imageId,
      previousReference,
      nextReference,
      durationSec,
      aspectRatio,
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
    const updated = await updateVideoTake(take.id, userId, {
      status: "available",
      videoUrl: refreshed.videoUrl,
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
    errorMessage: refreshed.message,
  });
  return { status: "ok", take: updated ?? take };
}
