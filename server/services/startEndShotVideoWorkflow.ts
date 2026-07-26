import { createHash } from "node:crypto";
import path from "node:path";

import type { VideoTake } from "../../drizzle/schema";
import {
  canonicalizeShotNo,
  type ImageAsset,
} from "../../shared/imageAsset";
import {
  START_END_NEIGHBOR_FRAME_POLICY_VERSION,
  isStartEndVideoTakeSnapshot,
  parseStartEndVideoConfig,
  type StartEndFrameSource,
  type StartEndShotVideoEstimate,
} from "../../shared/startEndVideo";
import { displayShotCode } from "../../shared/shotIdentity";
import {
  decideVideoRenderStrategy,
  VIDEO_VISUAL_FIDELITY_POLICY_VERSION,
  type VideoRenderDecision,
  withVideoVisualFidelity,
} from "../../shared/videoMotionPolicy";
import {
  claimStartEndShotSubmission,
  createVideoTakeIdempotently,
  findVideoTakeByIdempotencyKey,
  getStoryById,
  getStoryVideoTakes,
  getVideoTakeById,
  updateVideoTake,
} from "../db";
import { prepareStoryImagePairForVidu } from "./editingTransitionWorkflow";
import {
  getStoryImageAssets,
  materializeImageInput,
} from "./imageAssets";
import { localVideoDir, materializeVideoUrl } from "./videoMedia";
import { probeVideoFileMetadata } from "./videoConform";
import { directVideoPrompt } from "./videoPromptDirector";
import { VIDEO_PROMPT_ENGINEERING_VERSION } from "./videoPromptEngineering";
import { storyVideoContext } from "./videoShotContext";
import { createLocalMotionVideoTake } from "./localMotionVideo";
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
  referenceFrame: ImageAsset | null;
  characterReferenceImageUrl: string | null;
  firstFrameOrigin: ResolvedFrameOrigin;
  lastFrameOrigin: ResolvedFrameOrigin;
  renderDecision: VideoRenderDecision;
};

type ResolvedFrameOrigin = {
  source: StartEndFrameSource;
  stableShotId: string;
  cueCode: string;
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

function snapshotReferenceUrl(value: string | null): string | null {
  return value?.startsWith("data:") ? "inline-image" : value;
}

function generationParams(value: unknown): RecordValue {
  if (typeof value !== "string") return record(value);
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return record(JSON.parse(trimmed));
  } catch {
    return {};
  }
}

function positiveImageId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function positiveImageIds(value: unknown): number[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.map(positiveImageId).filter((id): id is number => id != null)
        )
      )
    : [];
}

function configuredFrameId(shot: RecordValue, boundary: "first" | "last") {
  const params = generationParams(shot.generationParams);
  const roles = record(params.storyboardFrameRoles);
  return positiveImageId(
    boundary === "first"
      ? (roles.firstImageId ?? params.firstFrameImageId)
      : (roles.lastImageId ?? params.lastFrameImageId)
  );
}

function frameReferenceIds(shot: RecordValue): number[] {
  const params = generationParams(shot.generationParams);
  const roles = record(params.storyboardFrameRoles);
  return positiveImageIds(
    roles.referenceImageIds ?? params.referenceFrameImageIds
  );
}

function characterReferenceImageUrl(shot: RecordValue): string | null {
  const continuity = record(
    generationParams(shot.generationParams).characterContinuity
  );
  return text(continuity.imageUrl) || null;
}

function expectsStartEndFramePair(shot: RecordValue): boolean {
  const params = generationParams(shot.generationParams);
  return (
    params.frameMode === "start_end" ||
    params.providerIntent === "vidu-start-end" ||
    Boolean(params.firstFrameFile) ||
    Boolean(params.lastFrameFile)
  );
}

export function composeStartEndShotEditorDraft(shot: RecordValue): string {
  const directorEntries = [
    ["用户当前画面动作（最高优先级）", text(shot.action)],
    ["当前表演", text(shot.performance)],
    ["当前环境变化", text(shot.environmentMotion)],
    ["当前相机运动", text(shot.cameraMove)],
    ["当前相机路径", text(shot.cameraPath)],
    ["当前主体路径", text(shot.subjectPath)],
    ["当前开始画面", text(shot.videoStart)],
    ["当前结束画面", text(shot.videoEnd)],
    ["承接上一镜", text(shot.transitionIn)],
    ["进入下一镜", text(shot.transitionOut)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const lines = directorEntries.map(
    ([label, value]) => `${label}：${value}`
  );
  if (text(shot.action)) {
    lines.splice(
      1,
      0,
      "冲突处理：若其他字段与画面动作冲突，必须以画面动作为准。"
    );
  }
  const dialogue = text(shot.dialogue);
  if (dialogue) lines.push(`旁白语义：${dialogue}`);
  const existingPrompt = text(shot.videoPrompt);
  if (existingPrompt && directorEntries.length === 0) {
    lines.push(`既有视频方案：${existingPrompt}`);
  }
  if (lines.length === 0) return "";
  const negativePrompt = text(shot.negativePrompt);
  if (negativePrompt) lines.push(`避免：${negativePrompt}`);
  return lines.join("\n").slice(0, 5_000);
}

function stableShotIdOf(shot: RecordValue): string {
  return (
    text(shot.stableShotId) || text(shot.shotIdentity) || text(shot.shotKey)
  );
}

function snapshot(take: VideoTake): RecordValue {
  return record(take.parameterSnapshot);
}

export function findMatchingStartEndFrameTake(
  takes: readonly Pick<
    VideoTake,
    "id" | "stableShotId" | "status" | "parameterSnapshot"
  >[],
  input: {
    stableShotId: string;
    firstFrameImageId: number;
    lastFrameImageId: number;
  }
) {
  return (
    takes.find(take => {
      if (
        take.stableShotId !== input.stableShotId ||
        take.status === "failed" ||
        take.status === "timeout" ||
        take.status === "unfollowable"
      ) {
        return false;
      }
      const params = record(take.parameterSnapshot);
      return (
        isStartEndVideoTakeSnapshot(params) &&
        params.firstFrameImageId === input.firstFrameImageId &&
        params.lastFrameImageId === input.lastFrameImageId
      );
    }) ?? null
  );
}

function hashParts(...parts: Array<string | number | null | undefined>) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

function assetBelongsToShot(
  asset: ImageAsset,
  stableShotId: string,
  shot?: RecordValue
) {
  if (asset.assignment !== "shot" || asset.availability === "missing") {
    return false;
  }
  if (asset.shotIdentity) return asset.shotIdentity === stableShotId;
  const canonicalShotNo = shot
    ? canonicalizeShotNo(text(shot.cueCode ?? shot.shotNo ?? shot.shotKey))
    : null;
  return canonicalShotNo
    ? asset.canonicalShotNo === canonicalShotNo
    : Boolean(stableShotId);
}

function frameForShotBoundary(
  shot: RecordValue | undefined,
  stableShotId: string,
  boundary: "first" | "last",
  assets: readonly ImageAsset[]
): ImageAsset | null {
  if (!shot || !stableShotId) return null;
  const candidates = assets
    .filter(asset => assetBelongsToShot(asset, stableShotId, shot))
    .sort((left, right) => left.id - right.id);
  const configuredId = configuredFrameId(shot, boundary);
  return (
    candidates.find(asset => asset.id === configuredId) ??
    (boundary === "first" ? candidates[0] : candidates.at(-1)) ??
    null
  );
}

function frameOrigin(
  asset: ImageAsset,
  current: ResolvedFrameOrigin,
  currentAssetIds: ReadonlySet<number>,
  inherited: ResolvedFrameOrigin,
  inheritedAsset: ImageAsset | null,
  hasReferenceFrame: boolean
): ResolvedFrameOrigin | null {
  if (currentAssetIds.has(asset.id)) return current;
  if (hasReferenceFrame && inheritedAsset?.id === asset.id) return inherited;
  return null;
}

function frameLabel(
  boundary: "first" | "last",
  asset: ImageAsset,
  origin: ResolvedFrameOrigin
): string {
  if (origin.source === "previous-last") {
    return `借用上一镜 ${origin.cueCode} 尾帧 · image #${asset.id}`;
  }
  if (origin.source === "next-first") {
    return `借用下一镜 ${origin.cueCode} 首帧 · image #${asset.id}`;
  }
  return `${boundary === "first" ? "首帧" : "尾帧"} · image #${asset.id}`;
}

function sameVisualSource(first: ImageAsset, last: ImageAsset): boolean {
  return (
    first.imageUrl === last.imageUrl ||
    Boolean(first.imageKey && first.imageKey === last.imageKey)
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
  const cueCode = text(shot.cueCode) || displayShotCode(shot);
  const previousShot = shots[shotIndex - 1];
  const nextShot = shots[shotIndex + 1];
  const previousStableShotId = previousShot
    ? stableShotIdOf(previousShot)
    : "";
  const nextStableShotId = nextShot ? stableShotIdOf(nextShot) : "";
  const previousLastFrame = frameForShotBoundary(
    previousShot,
    previousStableShotId,
    "last",
    assets
  );
  const nextFirstFrame = frameForShotBoundary(
    nextShot,
    nextStableShotId,
    "first",
    assets
  );
  const currentAssets = assets.filter(asset =>
    assetBelongsToShot(asset, stableShotId, shot)
  );
  const currentAssetIds = new Set(currentAssets.map(asset => asset.id));
  const referenceFrame = frameReferenceIds(shot)
    .map(imageId => currentAssets.find(asset => asset.id === imageId) ?? null)
    .find((asset): asset is ImageAsset => Boolean(asset)) ?? null;
  const currentOrigin: ResolvedFrameOrigin = {
    source: "current",
    stableShotId,
    cueCode,
  };
  const previousOrigin: ResolvedFrameOrigin = {
    source: "previous-last",
    stableShotId: previousStableShotId,
    cueCode: previousShot
      ? text(previousShot.cueCode) || displayShotCode(previousShot)
      : "上一镜",
  };
  const nextOrigin: ResolvedFrameOrigin = {
    source: "next-first",
    stableShotId: nextStableShotId,
    cueCode: nextShot
      ? text(nextShot.cueCode) || displayShotCode(nextShot)
      : "下一镜",
  };

  let config = parseStartEndVideoConfig(
    shot.generationParams,
    fallbackDurationSec
  );
  if (!config && expectsStartEndFramePair(shot) && referenceFrame) {
    const missingBoundaries = [
      !previousLastFrame ? "上一镜尾帧" : "",
      !nextFirstFrame ? "下一镜首帧" : "",
    ].filter(Boolean);
    if (missingBoundaries.length > 0) {
      throw new Error(
        `当前镜头只有中间参考图，但${missingBoundaries.join("和")}不可用，无法自动组成连续首尾帧`
      );
    }
    config = parseStartEndVideoConfig(
      {
        ...generationParams(shot.generationParams),
        frameMode: "start_end",
        firstFrameImageId: previousLastFrame?.id,
        lastFrameImageId: nextFirstFrame?.id,
      },
      fallbackDurationSec
    );
  }
  if (!config) {
    throw new Error("当前镜头还没有有效的首帧、尾帧生成配置");
  }
  const firstFrame = assets.find(
    asset => asset.id === config.firstFrameImageId
  );
  const lastFrame = assets.find(asset => asset.id === config.lastFrameImageId);
  if (!firstFrame || !lastFrame) {
    throw new Error("首帧或尾帧文件不存在");
  }
  const firstFrameOrigin = frameOrigin(
    firstFrame,
    currentOrigin,
    currentAssetIds,
    previousOrigin,
    previousLastFrame,
    Boolean(referenceFrame)
  );
  const lastFrameOrigin = frameOrigin(
    lastFrame,
    currentOrigin,
    currentAssetIds,
    nextOrigin,
    nextFirstFrame,
    Boolean(referenceFrame)
  );
  if (!firstFrameOrigin || !lastFrameOrigin) {
    throw new Error(
      referenceFrame
        ? "自动继承的首尾帧与相邻镜头不一致，请刷新故事版后重试"
        : "首帧或尾帧不存在，或不属于当前镜头"
    );
  }
  const prompt = composeStartEndShotEditorDraft(shot);
  if (!prompt) throw new Error("请先填写这一镜的动作或运镜");
  const requestedDecision = decideVideoRenderStrategy({
    action: text(shot.action),
    performance: text(shot.performance),
    environmentMotion: text(shot.environmentMotion),
    cameraMove: text(shot.cameraMove),
    cameraPath: text(shot.cameraPath),
    subjectPath: text(shot.subjectPath),
    videoStart: text(shot.videoStart),
    videoEnd: text(shot.videoEnd),
    videoPrompt: prompt,
  });
  const renderDecision: VideoRenderDecision =
    requestedDecision.strategy === "local-transform" &&
    !sameVisualSource(firstFrame, lastFrame)
      ? {
          strategy: "paid-302",
          reason:
            "首帧和尾帧是不同画面，本地缩放平移不能可靠补出两帧之间的新像素。",
          localMotion: null,
        }
      : requestedDecision;
  return {
    storyId,
    stableShotId,
    shotNo,
    cueCode,
    prompt,
    subtitle: text(shot.dialogue) || null,
    storyTitle: story.title,
    storyBody: story.body,
    config,
    firstFrame,
    lastFrame,
    referenceFrame,
    characterReferenceImageUrl: characterReferenceImageUrl(shot),
    firstFrameOrigin,
    lastFrameOrigin,
    renderDecision,
  };
}

function estimateForResolved(
  resolved: ResolvedStartEndShot,
  matchingFrameTakeId?: number
): StartEndShotVideoEstimate {
  const cost = estimateViduQ2TransitionCny({
    durationSec: resolved.config.durationSec,
    resolution: resolved.config.resolution,
    uploadCount: 2,
  });
  return {
    ...cost,
    estimatedCny:
      resolved.renderDecision.strategy === "local-transform"
        ? 0
        : cost.estimatedCny,
    stableShotId: resolved.stableShotId,
    cueCode: resolved.cueCode,
    durationSec: resolved.config.durationSec,
    requestedDurationSec: resolved.config.requestedDurationSec,
    resolution: resolved.config.resolution,
    aspectRatio: "1:1",
    movementAmplitude: resolved.config.movementAmplitude,
    model: resolved.config.model,
    renderStrategy: resolved.renderDecision.strategy,
    renderReason: resolved.renderDecision.reason,
    ...(matchingFrameTakeId
      ? {
          matchingFrameTakeId,
          frameConstraintWarning: `本次仍锁定与 Take #${matchingFrameTakeId} 相同的首尾帧。文字只能改变两帧之间的动作与速度，不能重画首帧或尾帧；若新意图改变开场或结尾画面，请先更换对应帧。`,
        }
      : {}),
    localMotion: resolved.renderDecision.localMotion,
    firstFrame: {
      imageId: resolved.firstFrame.id,
      imageUrl: resolved.firstFrame.imageUrl,
      label: frameLabel(
        "first",
        resolved.firstFrame,
        resolved.firstFrameOrigin
      ),
      source: resolved.firstFrameOrigin.source,
      sourceStableShotId: resolved.firstFrameOrigin.stableShotId,
      sourceCueCode: resolved.firstFrameOrigin.cueCode,
    },
    lastFrame: {
      imageId: resolved.lastFrame.id,
      imageUrl: resolved.lastFrame.imageUrl,
      label: frameLabel(
        "last",
        resolved.lastFrame,
        resolved.lastFrameOrigin
      ),
      source: resolved.lastFrameOrigin.source,
      sourceStableShotId: resolved.lastFrameOrigin.stableShotId,
      sourceCueCode: resolved.lastFrameOrigin.cueCode,
    },
  };
}

export async function estimateStartEndShotVideo(
  input: { storyId: number; stableShotId: string },
  userId: number
): Promise<StartEndShotVideoEstimate> {
  const [resolved, takes] = await Promise.all([
    resolveStartEndShot(input.storyId, input.stableShotId, userId),
    getStoryVideoTakes(input.storyId, userId),
  ]);
  const matching = findMatchingStartEndFrameTake(takes, {
    stableShotId: resolved.stableShotId,
    firstFrameImageId: resolved.firstFrame.id,
    lastFrameImageId: resolved.lastFrame.id,
  });
  return estimateForResolved(resolved, matching?.id);
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
    VIDEO_PROMPT_ENGINEERING_VERSION,
    START_END_NEIGHBOR_FRAME_POLICY_VERSION,
    resolved.storyId,
    resolved.stableShotId,
    resolved.config.firstFrameImageId,
    resolved.config.lastFrameImageId,
    resolved.referenceFrame?.id,
    resolved.characterReferenceImageUrl,
    resolved.firstFrameOrigin.source,
    resolved.lastFrameOrigin.source,
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

  if (resolved.renderDecision.strategy === "local-transform") {
    const local = await createLocalMotionVideoTake({
      storyId: input.storyId,
      userId,
      stableShotId: resolved.stableShotId,
      sourceImage: resolved.firstFrame,
      promptCompilationId: null,
      prompt: resolved.prompt,
      subtitle: resolved.subtitle,
      durationSec: resolved.config.durationSec,
      decision: resolved.renderDecision,
      rerenderRequestId: input.rerenderRequestId,
    });
    return local.status === "ok"
      ? { status: "ok", take: local.take, estimate }
      : {
          status: "error",
          error: local.error,
          take: local.take,
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
        referenceFrameImageId: resolved.referenceFrame?.id ?? null,
        characterReferenceImageUrl: snapshotReferenceUrl(
          resolved.characterReferenceImageUrl
        ),
        frameSources: {
          policyVersion: START_END_NEIGHBOR_FRAME_POLICY_VERSION,
          first: resolved.firstFrameOrigin,
          last: resolved.lastFrameOrigin,
        },
        requestedDurationSec: resolved.config.requestedDurationSec,
        durationSec: resolved.config.durationSec,
        resolution: resolved.config.resolution,
        aspectRatio: "1:1",
        movementAmplitude: resolved.config.movementAmplitude,
        rerenderRequestId: input.rerenderRequestId,
        estimatedCny: estimate.estimatedCny,
        visualFidelityPolicyVersion: VIDEO_VISUAL_FIDELITY_POLICY_VERSION,
        promptEngineeringVersion: VIDEO_PROMPT_ENGINEERING_VERSION,
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
    const middleImageInput = resolved.referenceFrame
      ? await materializeImageInput(resolved.referenceFrame.imageUrl)
      : undefined;
    const identityImageInput = resolved.characterReferenceImageUrl
      ? await materializeImageInput(resolved.characterReferenceImageUrl)
      : undefined;
    const [promptDirector, firstImageUrl, lastImageUrl] = await Promise.all([
      directVideoPrompt({
        imageInput: frameDataUrl(frames.firstFrame.bytes),
        endImageInput: frameDataUrl(frames.lastFrame.bytes),
        middleImageInput,
        identityImageInput,
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
          engineering: promptDirector.engineering,
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
