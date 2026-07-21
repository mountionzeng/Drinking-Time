import { createHash } from "node:crypto";
import path from "node:path";

import type { VideoTake } from "../../drizzle/schema";
import type { ImageAsset } from "../../shared/imageAsset";
import {
  isStartEndVideoTakeSnapshot,
  parseStartEndVideoConfig,
  type StartEndShotVideoEstimate,
} from "../../shared/startEndVideo";
import { displayShotCode } from "../../shared/shotIdentity";
import {
  VIDEO_VISUAL_FIDELITY_POLICY_VERSION,
  withVideoVisualFidelity,
} from "../../shared/videoMotionPolicy";
import {
  claimStartEndShotSubmission,
  createVideoTakeIdempotently,
  findVideoTakeByIdempotencyKey,
  getStoryById,
  getVideoTakeById,
  updateVideoTake,
} from "../db";
import { prepareStoryImagePairForVidu } from "./editingTransitionWorkflow";
import { getStoryImageAssets } from "./imageAssets";
import { localVideoDir, materializeVideoUrl } from "./videoMedia";
import { probeVideoFileMetadata } from "./videoConform";
import { directVideoPrompt } from "./videoPromptDirector";
import { storyVideoContext } from "./videoShotContext";
import {
  estimateViduQ2TransitionCny,
  refreshViduTransition,
  submitViduTransition,
  uploadFileToVidu,
  ViduSubmissionError,
} from "./videoTransition302";

type RecordValue = Record<string, unknown>;

type ResolvedStartEndShot = {
  storyId: number;
  stableShotId: string;
  shotNo: number;
  cueCode: string;
  prompt: string;
  subtitle: string | null;
  storyTitle: string;
  storyBody: unknown;
  config: NonNullable<ReturnType<typeof parseStartEndVideoConfig>>;
  firstFrame: ImageAsset;
  lastFrame: ImageAsset;
};

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function storyShots(body: unknown): RecordValue[] {
  const shots = record(body).shots;
  return Array.isArray(shots)
    ? shots.filter((shot): shot is RecordValue =>
        Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function stableShotIdOf(shot: RecordValue): string {
  return (
    text(shot.stableShotId) || text(shot.shotIdentity) || text(shot.shotKey)
  );
}

function snapshot(take: VideoTake): RecordValue {
  return record(take.parameterSnapshot);
}

function hashParts(...parts: Array<string | number | null | undefined>) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

function assetBelongsToShot(asset: ImageAsset, stableShotId: string) {
  return (
    asset.assignment === "shot" &&
    asset.availability !== "missing" &&
    (!asset.shotIdentity || asset.shotIdentity === stableShotId)
  );
}

async function resolveStartEndShot(
  storyId: number,
  stableShotId: string,
  userId: number
): Promise<ResolvedStartEndShot> {
  const [story, assets] = await Promise.all([
    getStoryById(storyId, userId),
    getStoryImageAssets(storyId, userId),
  ]);
  if (!story) throw new Error("故事不存在或无权操作");
  const shots = storyShots(story.body);
  const shotIndex = shots.findIndex(
    candidate => stableShotIdOf(candidate) === stableShotId
  );
  const shot = shots[shotIndex];
  if (!shot) throw new Error("当前镜头已经不存在，请刷新故事版");
  const shotNo =
    typeof shot.shotNo === "number" && Number.isFinite(shot.shotNo)
      ? Math.max(1, Math.round(shot.shotNo))
      : shotIndex + 1;
  const fallbackDurationSec =
    typeof shot.durationMs === "number" && Number.isFinite(shot.durationMs)
      ? shot.durationMs / 1_000
      : 5;
  const config = parseStartEndVideoConfig(
    shot.generationParams,
    fallbackDurationSec
  );
  if (!config) {
    throw new Error("当前镜头还没有有效的首帧、尾帧生成配置");
  }
  const firstFrame = assets.find(
    asset => asset.id === config.firstFrameImageId
  );
  const lastFrame = assets.find(asset => asset.id === config.lastFrameImageId);
  if (
    !firstFrame ||
    !lastFrame ||
    !assetBelongsToShot(firstFrame, stableShotId) ||
    !assetBelongsToShot(lastFrame, stableShotId)
  ) {
    throw new Error("首帧或尾帧不存在，或不属于当前镜头");
  }
  const basePrompt = text(shot.videoPrompt);
  if (!basePrompt) throw new Error("请先填写这一镜的视频提示词");
  const negativePrompt = text(shot.negativePrompt);
  const prompt = [basePrompt, negativePrompt ? `避免：${negativePrompt}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5_000);
  return {
    storyId,
    stableShotId,
    shotNo,
    cueCode: text(shot.cueCode) || displayShotCode(shot),
    prompt,
    subtitle: text(shot.dialogue) || null,
    storyTitle: story.title,
    storyBody: story.body,
    config,
    firstFrame,
    lastFrame,
  };
}

function estimateForResolved(
  resolved: ResolvedStartEndShot
): StartEndShotVideoEstimate {
  const cost = estimateViduQ2TransitionCny({
    durationSec: resolved.config.durationSec,
    resolution: resolved.config.resolution,
    uploadCount: 2,
  });
  return {
    ...cost,
    stableShotId: resolved.stableShotId,
    cueCode: resolved.cueCode,
    durationSec: resolved.config.durationSec,
    requestedDurationSec: resolved.config.requestedDurationSec,
    resolution: resolved.config.resolution,
    aspectRatio: "1:1",
    movementAmplitude: resolved.config.movementAmplitude,
    model: resolved.config.model,
    firstFrame: {
      imageId: resolved.firstFrame.id,
      imageUrl: resolved.firstFrame.imageUrl,
      label: `首帧 · image #${resolved.firstFrame.id}`,
    },
    lastFrame: {
      imageId: resolved.lastFrame.id,
      imageUrl: resolved.lastFrame.imageUrl,
      label: `尾帧 · image #${resolved.lastFrame.id}`,
    },
  };
}

export async function estimateStartEndShotVideo(
  input: { storyId: number; stableShotId: string },
  userId: number
): Promise<StartEndShotVideoEstimate> {
  return estimateForResolved(
    await resolveStartEndShot(input.storyId, input.stableShotId, userId)
  );
}

async function patchTake(
  take: VideoTake,
  userId: number,
  patch: Parameters<typeof updateVideoTake>[2],
  snapshotPatch?: RecordValue
): Promise<VideoTake> {
  const updated = await updateVideoTake(take.id, userId, {
    ...patch,
    ...(snapshotPatch
      ? {
          parameterSnapshot: {
            ...snapshot(take),
            ...snapshotPatch,
          },
        }
      : {}),
  });
  if (!updated) throw new Error("首尾帧视频任务状态保存失败");
  return updated;
}

function idempotencyKey(
  resolved: ResolvedStartEndShot,
  rerenderRequestId?: string
) {
  return `shot-start-end:${hashParts(
    VIDEO_VISUAL_FIDELITY_POLICY_VERSION,
    resolved.storyId,
    resolved.stableShotId,
    resolved.config.firstFrameImageId,
    resolved.config.lastFrameImageId,
    resolved.prompt,
    resolved.config.durationSec,
    resolved.config.resolution,
    resolved.config.movementAmplitude,
    resolved.config.model,
    rerenderRequestId
  )}`;
}

export async function startEndShotVideoJob(
  input: {
    storyId: number;
    stableShotId: string;
    rerenderRequestId?: string;
    confirmedEstimatedCny: number;
  },
  userId: number
): Promise<
  | {
      status: "ok";
      take: VideoTake;
      estimate: StartEndShotVideoEstimate;
    }
  | {
      status: "error";
      error: string;
      take?: VideoTake;
      estimate?: StartEndShotVideoEstimate;
    }
> {
  const resolved = await resolveStartEndShot(
    input.storyId,
    input.stableShotId,
    userId
  );
  const estimate = estimateForResolved(resolved);
  const safeguardedPrompt = withVideoVisualFidelity(resolved.prompt);
  if (Math.abs(input.confirmedEstimatedCny - estimate.estimatedCny) > 0.001) {
    return {
      status: "error",
      error: `费用预估已变化，请重新确认预计 ¥${estimate.estimatedCny.toFixed(2)}`,
      estimate,
    };
  }

  const key = idempotencyKey(resolved, input.rerenderRequestId);
  let take = await findVideoTakeByIdempotencyKey(input.storyId, userId, key);
  if (!take) {
    const reserved = await createVideoTakeIdempotently({
      storyId: input.storyId,
      userId,
      stableShotId: resolved.stableShotId,
      sourceImageId: resolved.firstFrame.id,
      promptCompilationId: null,
      status: "submitted",
      taskId: null,
      provider: "302",
      model: resolved.config.model,
      prompt: safeguardedPrompt,
      subtitle: resolved.subtitle,
      durationSec: resolved.config.durationSec,
      aspectRatio: "1:1",
      videoKey: null,
      videoUrl: null,
      errorMessage: null,
      parameterSnapshot: {
        kind: "shot-start-end",
        version: 1,
        stableShotId: resolved.stableShotId,
        cueCode: resolved.cueCode,
        model: resolved.config.model,
        frameMode: resolved.config.frameMode,
        firstFrameImageId: resolved.firstFrame.id,
        lastFrameImageId: resolved.lastFrame.id,
        requestedDurationSec: resolved.config.requestedDurationSec,
        durationSec: resolved.config.durationSec,
        resolution: resolved.config.resolution,
        aspectRatio: "1:1",
        movementAmplitude: resolved.config.movementAmplitude,
        rerenderRequestId: input.rerenderRequestId,
        estimatedCny: estimate.estimatedCny,
        visualFidelityPolicyVersion: VIDEO_VISUAL_FIDELITY_POLICY_VERSION,
        submissionState: "not_started",
        appliedToTimeline: false,
      },
      idempotencyKey: key,
      extractionCapability: "unavailable",
    });
    take = reserved.take;
  }

  if (take.status === "available" || take.taskId) {
    return { status: "ok", take, estimate };
  }
  const existingState = snapshot(take).submissionState;
  if (
    existingState === "unknown" ||
    existingState === "accepted" ||
    take.status === "unfollowable"
  ) {
    return {
      status: "error",
      error:
        take.errorMessage ?? "这次付费提交的状态无法安全重试，请继续查询原任务",
      take,
      estimate,
    };
  }

  const claim = await claimStartEndShotSubmission({
    takeId: take.id,
    storyId: input.storyId,
    userId,
  });
  take = claim.take;
  if (!claim.claimed) {
    return { status: "ok", take, estimate };
  }

  let frames: Awaited<ReturnType<typeof prepareStoryImagePairForVidu>> | null =
    null;
  let taskId: string | null = null;
  try {
    const size =
      resolved.config.resolution === "540p"
        ? 540
        : resolved.config.resolution === "720p"
          ? 720
          : 1080;
    frames = await prepareStoryImagePairForVidu({
      storyId: input.storyId,
      userId,
      firstImageId: resolved.firstFrame.id,
      lastImageId: resolved.lastFrame.id,
      size,
    });
    const frameDataUrl = (bytes: Uint8Array) =>
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    const context = storyVideoContext(
      resolved.storyBody,
      resolved.stableShotId,
      resolved.shotNo
    );
    const [promptDirector, firstImageUrl, lastImageUrl] = await Promise.all([
      directVideoPrompt({
        imageInput: frameDataUrl(frames.firstFrame.bytes),
        endImageInput: frameDataUrl(frames.lastFrame.bytes),
        fallbackPrompt: safeguardedPrompt,
        shotNo: resolved.shotNo,
        cueCode: resolved.cueCode,
        draftPrompt: resolved.prompt,
        subtitle: resolved.subtitle ?? undefined,
        storyTitle: resolved.storyTitle,
        ...context,
      }),
      uploadFileToVidu(frames.firstFrame),
      uploadFileToVidu(frames.lastFrame),
    ]);
    const providerPrompt = promptDirector.prompt;
    take = await patchTake(
      take,
      userId,
      { status: "submitted", prompt: providerPrompt, errorMessage: null },
      {
        submissionState: "submitting",
        framesUploaded: true,
        promptDirector: {
          source: promptDirector.source,
          model: promptDirector.model,
          analysis: promptDirector.analysis,
          fallbackReason: promptDirector.fallbackReason,
        },
      }
    );
    const submitted = await submitViduTransition({
      prompt: providerPrompt,
      firstImageUrl,
      lastImageUrl,
      durationSec: resolved.config.durationSec,
      resolution: resolved.config.resolution,
      movementAmplitude: resolved.config.movementAmplitude,
      model: resolved.config.model,
    });
    taskId = submitted.taskId;
    take = await patchTake(
      take,
      userId,
      { status: "processing", taskId, errorMessage: null },
      {
        submissionState: "accepted",
        taskId,
        submittedAt: new Date().toISOString(),
      }
    );
    return { status: "ok", take, estimate };
  } catch (error) {
    if (taskId) {
      take = await patchTake(
        take,
        userId,
        { status: "processing", taskId, errorMessage: null },
        { submissionState: "accepted", taskId }
      );
      return { status: "ok", take, estimate };
    }
    const unknown =
      error instanceof ViduSubmissionError &&
      error.submissionState === "unknown";
    const message =
      error instanceof Error ? error.message : "首尾帧视频提交失败";
    take = await patchTake(
      take,
      userId,
      {
        status: unknown ? "unfollowable" : "failed",
        errorMessage: unknown
          ? `${message}；为避免重复扣费已禁止自动重提。`
          : message,
      },
      { submissionState: unknown ? "unknown" : "not_submitted" }
    );
    return {
      status: "error",
      error: take.errorMessage ?? message,
      take,
      estimate,
    };
  } finally {
    await frames?.cleanup().catch(() => undefined);
  }
}

export function isStartEndShotVideoTake(take: VideoTake): boolean {
  return isStartEndVideoTakeSnapshot(take.parameterSnapshot);
}

export async function refreshStartEndShotVideoTake(
  take: VideoTake,
  userId: number
): Promise<
  { status: "ok"; take: VideoTake } | { status: "error"; error: string }
> {
  const current = await getVideoTakeById(take.id, userId);
  if (!current || !isStartEndShotVideoTake(current)) {
    return { status: "error", error: "首尾帧视频任务不存在或无权操作" };
  }
  if (current.status === "available") return { status: "ok", take: current };
  if (!current.taskId) {
    const state = snapshot(current).submissionState;
    if (state === "submitting") return { status: "ok", take: current };
    return {
      status: "error",
      error: current.errorMessage ?? "首尾帧视频任务没有 taskId，无法继续查询",
    };
  }

  const refreshed = await refreshViduTransition(current.taskId);
  if (refreshed.status === "available") {
    const managed = await materializeVideoUrl(refreshed.videoUrl, current.id);
    if (managed.status !== "ok") {
      const failed = await patchTake(
        current,
        userId,
        { status: "failed", errorMessage: managed.message },
        {
          providerVideoUrl: refreshed.videoUrl,
          generationState: "download_failed",
        }
      );
      return { status: "ok", take: failed };
    }
    const metadata = await probeVideoFileMetadata(
      path.join(localVideoDir(), managed.videoKey)
    );
    if (Math.abs(metadata.width - metadata.height) > 2) {
      const failed = await patchTake(
        current,
        userId,
        { status: "failed", errorMessage: "生成结果不是 1:1，未加入候选 Take" },
        {
          providerVideoUrl: refreshed.videoUrl,
          generationState: "invalid_aspect_ratio",
        }
      );
      return { status: "ok", take: failed };
    }
    const ready = await patchTake(
      current,
      userId,
      {
        status: "available",
        videoKey: managed.videoKey,
        videoUrl: managed.videoUrl,
        durationSec: metadata.durationSec ?? current.durationSec,
        aspectRatio: "1:1",
        extractionCapability: "available",
        errorMessage: null,
      },
      {
        providerVideoUrl: refreshed.videoUrl,
        generationState: "available",
        appliedToTimeline: false,
      }
    );
    return { status: "ok", take: ready };
  }
  if (refreshed.status === "processing" || refreshed.status === "retryable") {
    const processing = await patchTake(
      current,
      userId,
      { status: "processing", errorMessage: null },
      {
        generationState: "processing",
        lastQueryMessage:
          refreshed.status === "retryable" ? refreshed.message : null,
      }
    );
    return { status: "ok", take: processing };
  }
  const failed = await patchTake(
    current,
    userId,
    { status: "failed", errorMessage: refreshed.message },
    { generationState: refreshed.status }
  );
  return { status: "ok", take: failed };
}
