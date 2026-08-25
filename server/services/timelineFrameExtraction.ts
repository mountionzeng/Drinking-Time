import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  GeneratedImage,
  TimelineFrameExtractionOperation,
} from "../../drizzle/schema";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import {
  STORY_TIMELINE_FPS,
  timelineFramesToMs,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import {
  overlayVisualLayer,
  resolveTimelineVisualFrame,
} from "../../shared/timelineLayout";
import {
  resolveTimelineItemSource,
  resolveTimelineSource,
  timelineSourceCandidateForOverlay,
  type TimelineSourceCandidate,
} from "../../shared/timelineSource";
import { normalizeVisualLayer } from "../../shared/timelineVisualPriority";
import {
  claimTimelineFrameExtractionOperation,
  failTimelineFrameExtractionOperation,
  getGeneratedImageById,
  getStoryGeneratedImages,
  getTimelineFrameExtractionOperation,
  markTimelineFrameExtractionSucceeded,
  recordTimelineFrameExtractionDescriptor,
  releaseTimelineFrameExtractionClaim,
  settleTimelineFrameExtractionAsset,
  TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR,
} from "../db";
import { storeImageBytes } from "./imageGen";
import { getStoryMaterialState } from "./storyMaterials";
import { renderTransitionVideoFrame } from "./videoEndpointFrames";
import { placeExtractedFrameForStory } from "./visualClipEditing";
import {
  consumeTimelineFrameExtractionAllowance,
  consumeTimelineFrameExtractionCallAllowance,
  preflightTimelineFrameExtractionStorage,
  runTimelineFrameCapture,
  TimelineFrameCaptureBusyError,
  storeTimelineFrameExtractionBytes,
  TimelineFrameExtractionStorageQuotaError,
  TIMELINE_EXTRACTION_STORAGE_QUOTA_MESSAGE,
} from "./timelineFrameExtractionLimits";

export type TimelineFrameExtractionDocument = {
  items: readonly StoryTimelineItem[];
  overlays?: readonly StoryTimelineOverlay[];
};

export type CurrentTimelineVideo = {
  takeId: number;
  durationSec: number | null;
  rangeId?: number | null;
  sourceStartSec?: number;
  sourceEndSec?: number;
  effects?: TimelineVideoEffects | null;
};

export type TimelineImageExtractionDescriptor = {
  kind: "image";
  timelineFrame: number;
  visualLayer: number;
  winnerIdentity: string;
  clipId: string;
  ownerStableShotId: string;
  imageId: number;
  imageUrl: string;
};

export type TimelineVideoExtractionDescriptor = {
  kind: "video";
  timelineFrame: number;
  visualLayer: number;
  winnerIdentity: string;
  ownerStableShotId: string;
  takeId: number;
  rangeId: number | null;
  sourceStableShotId: string;
  sourceClipId: string | null;
  atSec: number;
};

export type TimelineFrameExtractionDescriptor =
  | TimelineImageExtractionDescriptor
  | TimelineVideoExtractionDescriptor;

export type TimelineFrameExtractionResult =
  | { status: "ok"; descriptor: TimelineFrameExtractionDescriptor }
  | { status: "error"; error: "gap" | "media-unavailable" };

function currentVideoCandidate(
  item: StoryTimelineItem,
  durationFrames: number,
  current: CurrentTimelineVideo | undefined
): TimelineSourceCandidate | null {
  if (!current || !Number.isInteger(current.takeId) || current.takeId <= 0) {
    return null;
  }
  const sourceStartSec = Math.max(0, current.sourceStartSec ?? 0);
  const sourceEndSec = current.sourceEndSec ?? current.durationSec;
  if (
    sourceEndSec == null ||
    !Number.isFinite(sourceEndSec) ||
    sourceEndSec <= sourceStartSec
  ) {
    return null;
  }
  return {
    sourceType: "primary-video",
    sourceId: `current-take-${current.takeId}`,
    offsetFrame: 0,
    durationFrames,
    sourceStartSec,
    sourceEndSec,
    effects: current.effects ?? null,
    transform: item.transform,
  };
}

function finiteSourceTime(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Convert the single authoritative visual winner into a capture descriptor.
 *
 * This function deliberately calls `resolveTimelineVisualFrame` exactly once.
 * Once a story row wins, resolving its owned/primary media is an intra-row
 * lookup and must never perform another cross-layer winner election.
 */
export function resolveTimelineFrameExtraction(input: {
  document: TimelineFrameExtractionDocument;
  timelineFrame: number;
  hiddenVisualLayers?: readonly number[];
  currentVideosByShot?: ReadonlyMap<string, CurrentTimelineVideo>;
}): TimelineFrameExtractionResult {
  const timelineFrame = Math.max(0, Math.round(input.timelineFrame));
  const winner = resolveTimelineVisualFrame({
    items: input.document.items,
    overlays: input.document.overlays,
    hiddenVisualLayers: input.hiddenVisualLayers,
    frame: timelineFrame,
  });

  if (winner.kind === "gap") {
    return { status: "error", error: "gap" };
  }

  if (winner.kind === "image") {
    const { clip, stableShotId } = winner.placement;
    return {
      status: "ok",
      descriptor: {
        kind: "image",
        timelineFrame,
        visualLayer: normalizeVisualLayer(clip.visualLayer),
        winnerIdentity: `image-clip:${clip.id}`,
        clipId: clip.id,
        ownerStableShotId: stableShotId,
        imageId: clip.imageId,
        imageUrl: clip.imageUrl,
      },
    };
  }

  if (winner.kind === "overlay") {
    const source = resolveTimelineSource({
      item: {
        stableShotId: winner.overlay.sourceStableShotId,
        included: true,
        position: 0,
        plannedDurationMs:
          ((winner.overlay.mediaEndFrame - winner.overlay.startFrame) * 1_000) /
          STORY_TIMELINE_FPS,
        transform: winner.overlay.transform,
      },
      localFrame: winner.localFrame,
      primary: timelineSourceCandidateForOverlay(winner.overlay),
    });
    const atSec =
      source.kind === "source" ? finiteSourceTime(source.sourceTimeSec) : null;
    if (atSec == null) {
      return { status: "error", error: "media-unavailable" };
    }
    return {
      status: "ok",
      descriptor: {
        kind: "video",
        timelineFrame,
        visualLayer: overlayVisualLayer(winner.overlay),
        winnerIdentity: `legacy-overlay:${winner.overlay.id}`,
        ownerStableShotId: winner.overlay.sourceStableShotId,
        takeId: winner.overlay.takeId,
        rangeId: null,
        sourceStableShotId: winner.overlay.sourceStableShotId,
        sourceClipId: winner.overlay.id,
        atSec,
      },
    };
  }

  const { item } = winner.row;
  const currentVideo = input.currentVideosByShot?.get(item.stableShotId);
  const source = resolveTimelineItemSource({
    item,
    localFrame: winner.localFrame,
    durationFrames: winner.row.durationFrames,
    fallback: currentVideoCandidate(
      item,
      winner.row.durationFrames,
      currentVideo
    ),
  });
  if (source.kind === "gap") {
    return { status: "error", error: "media-unavailable" };
  }
  const atSec = finiteSourceTime(source.sourceTimeSec);
  if (atSec == null) {
    return { status: "error", error: "media-unavailable" };
  }

  if (source.sourceType === "visual-clip") {
    const clip = item.visualClips?.find(
      candidate => candidate.id === source.sourceId
    );
    if (!clip) {
      return { status: "error", error: "media-unavailable" };
    }
    return {
      status: "ok",
      descriptor: {
        kind: "video",
        timelineFrame,
        visualLayer: normalizeVisualLayer(clip.visualLayer ?? item.visualLayer),
        winnerIdentity: `owned-video-clip:${item.stableShotId}:${clip.id}`,
        ownerStableShotId: item.stableShotId,
        takeId: clip.takeId,
        rangeId: clip.rangeId,
        sourceStableShotId: clip.sourceStableShotId,
        sourceClipId: clip.id,
        atSec,
      },
    };
  }

  if (source.sourceType !== "primary-video") {
    return { status: "error", error: "media-unavailable" };
  }
  const takeId = item.primaryVideoEdit?.takeId ?? currentVideo?.takeId;
  if (takeId == null || !Number.isInteger(takeId) || takeId <= 0) {
    return { status: "error", error: "media-unavailable" };
  }
  return {
    status: "ok",
    descriptor: {
      kind: "video",
      timelineFrame,
      visualLayer: normalizeVisualLayer(item.visualLayer),
      winnerIdentity: `story-shot:${item.stableShotId}:primary`,
      ownerStableShotId: item.stableShotId,
      takeId,
      rangeId: item.primaryVideoEdit ? null : (currentVideo?.rangeId ?? null),
      sourceStableShotId: item.stableShotId,
      sourceClipId: null,
      atSec,
    },
  };
}

export type ExtractTimelineFrameForStoryResult =
  | {
      status: "ok";
      requestId: string;
      imageId: number;
      imageUrl: string;
      clipId: string;
      timelineVersion: number;
      targetLayer?: number;
      replayed: boolean;
    }
  | { status: "pending"; requestId: string; message: string }
  | {
      status: "error";
      requestId: string;
      errorCode: string;
      error: string;
      errorKind: "invalid" | "retryable";
      /** Whether retrying may reuse this receipt or must start a new intent. */
      requestDisposition: "continue" | "replace";
    };

type TimelineFrameExtractionWorkflowDependencies = {
  claimOperation: typeof claimTimelineFrameExtractionOperation;
  recordDescriptor: typeof recordTimelineFrameExtractionDescriptor;
  releaseClaim: typeof releaseTimelineFrameExtractionClaim;
  failOperation: typeof failTimelineFrameExtractionOperation;
  settleAsset: typeof settleTimelineFrameExtractionAsset;
  markSucceeded: typeof markTimelineFrameExtractionSucceeded;
  getImageById: typeof getGeneratedImageById;
  getStoryImages: typeof getStoryGeneratedImages;
  getOperation: typeof getTimelineFrameExtractionOperation;
  getMaterialState: typeof getStoryMaterialState;
  renderVideoFrame: typeof renderTransitionVideoFrame;
  storeBytes: typeof storeImageBytes;
  readFrameFile: (path: string) => Promise<Uint8Array>;
  preflightStorage: typeof preflightTimelineFrameExtractionStorage;
  placeFrame: typeof placeExtractedFrameForStory;
};

const defaultWorkflowDependencies: TimelineFrameExtractionWorkflowDependencies =
  {
    claimOperation: claimTimelineFrameExtractionOperation,
    recordDescriptor: recordTimelineFrameExtractionDescriptor,
    releaseClaim: releaseTimelineFrameExtractionClaim,
    failOperation: failTimelineFrameExtractionOperation,
    settleAsset: settleTimelineFrameExtractionAsset,
    markSucceeded: markTimelineFrameExtractionSucceeded,
    getImageById: getGeneratedImageById,
    getStoryImages: getStoryGeneratedImages,
    getOperation: getTimelineFrameExtractionOperation,
    getMaterialState: getStoryMaterialState,
    renderVideoFrame: renderTransitionVideoFrame,
    storeBytes: storeImageBytes,
    readFrameFile: path => readFile(path),
    preflightStorage: preflightTimelineFrameExtractionStorage,
    placeFrame: placeExtractedFrameForStory,
  };

function extractionInputHash(input: {
  storyId: number;
  userId: number;
  timelineFrame: number;
  operationLayer: number;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonStringify({
        storyId: input.storyId,
        userId: input.userId,
        timelineFrame: input.timelineFrame,
        operationLayer: input.operationLayer,
      })
    )
    .digest("hex");
}

function extractionDigest(input: {
  storyId: number;
  userId: number;
  requestId: string;
}): string {
  return createHash("sha256")
    .update(`${input.userId}:${input.storyId}:${input.requestId}`)
    .digest("hex")
    .slice(0, 40);
}

export function extractedTimelineFrameClipId(input: {
  storyId: number;
  userId: number;
  requestId: string;
}): string {
  return `extracted-frame-${extractionDigest(input)}`;
}

/**
 * One authoritative video source frame has one warehouse object per Story.
 * Request ids deliberately do not participate: receipts identify operations,
 * while this key identifies the durable visual asset those operations share.
 */
export function extractedTimelineFrameSourceStorageKey(input: {
  storyId: number;
  userId: number;
  takeId: number;
  rangeId: number | null;
  atSec: number;
}): string {
  const digest = createHash("sha256")
    .update(
      canonicalJsonStringify({
        storyId: input.storyId,
        userId: input.userId,
        takeId: input.takeId,
        rangeId: input.rangeId,
        atSec: input.atSec,
      })
    )
    .digest("hex")
    .slice(0, 40);
  return `generated/timeline-extractions/source-${digest}.png`;
}

function isExtractionDescriptor(
  value: unknown
): value is TimelineFrameExtractionDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Partial<TimelineFrameExtractionDescriptor>;
  if (
    (descriptor.kind !== "image" && descriptor.kind !== "video") ||
    !Number.isInteger(descriptor.timelineFrame) ||
    descriptor.timelineFrame! < 0 ||
    !Number.isInteger(descriptor.visualLayer) ||
    descriptor.visualLayer! < 0 ||
    typeof descriptor.winnerIdentity !== "string" ||
    !descriptor.winnerIdentity ||
    typeof descriptor.ownerStableShotId !== "string" ||
    !descriptor.ownerStableShotId
  ) {
    return false;
  }
  if (descriptor.kind === "image") {
    const image = descriptor as Partial<TimelineImageExtractionDescriptor>;
    return (
      typeof image.clipId === "string" &&
      Boolean(image.clipId) &&
      Number.isInteger(image.imageId) &&
      image.imageId! > 0 &&
      typeof image.imageUrl === "string" &&
      Boolean(image.imageUrl)
    );
  }
  const video = descriptor as Partial<TimelineVideoExtractionDescriptor>;
  return (
    Number.isInteger(video.takeId) &&
    video.takeId! > 0 &&
    (video.rangeId == null ||
      (Number.isInteger(video.rangeId) && video.rangeId! > 0)) &&
    typeof video.sourceStableShotId === "string" &&
    Boolean(video.sourceStableShotId) &&
    (video.sourceClipId == null || typeof video.sourceClipId === "string") &&
    typeof video.atSec === "number" &&
    Number.isFinite(video.atSec) &&
    video.atSec >= 0
  );
}

const extractionFailureMessages: Record<string, string> = {
  gap: "当前帧没有可提取的图片或视频",
  "media-unavailable": "当前帧的素材不可解码，请检查素材后重试",
  "descriptor-invalid": "抽帧记录已损坏，请重新发起抽帧",
  "capture-failed": "服务器无法提取当前视频帧，请重试",
  "warehouse-failed": "静帧已经生成，但保存到图片仓库失败，请重试",
};

const extractionErrorsRequiringNewRequest = new Set([
  "invalid-input",
  "request-conflict",
  "story-unavailable",
  "descriptor-invalid",
  "gap",
  "media-unavailable",
  "receipt-asset-missing",
  "receipt-incomplete",
  "receipt-state-invalid",
  "capture-failed",
  "warehouse-failed",
  "placement-failed",
]);

const extractionInvalidTerminalErrors = new Set([
  "gap",
  "media-unavailable",
  "descriptor-invalid",
  "story-unavailable",
]);

function extractionError(
  requestId: string,
  errorCode: string,
  errorKind: "invalid" | "retryable",
  fallback?: string,
  requestDisposition:
    | "continue"
    | "replace" = extractionErrorsRequiringNewRequest.has(errorCode)
    ? "replace"
    : "continue"
): ExtractTimelineFrameForStoryResult {
  return {
    status: "error",
    requestId,
    errorCode,
    error:
      fallback ??
      extractionFailureMessages[errorCode] ??
      "抽帧没有完成，请重试",
    errorKind,
    requestDisposition,
  };
}

function reportExtractionInternalError(stage: string, error: unknown): void {
  if (process.env.NODE_ENV === "test") return;
  console.error(`[TimelineFrameExtraction] ${stage}`, error);
}

function imageBelongsToStory(
  image: GeneratedImage | null,
  storyId: number,
  userId: number
): image is GeneratedImage {
  return Boolean(
    image &&
      image.storyId === storyId &&
      (image.userId == null || image.userId === userId)
  );
}

async function failClaimedExtraction(
  dependencies: TimelineFrameExtractionWorkflowDependencies,
  input: {
    storyId: number;
    userId: number;
    requestId: string;
    claimToken: string;
    errorCode: string;
  }
): Promise<boolean> {
  try {
    await dependencies.failOperation(input);
    return true;
  } catch {
    // If the terminal receipt could not be written, keep this request
    // replayable. Releasing is token-guarded; if the failure actually committed
    // before the throw, the release safely becomes a no-op.
    await releaseExtractionForRetry(dependencies, input);
    return false;
  }
}

async function releaseExtractionForRetry(
  dependencies: TimelineFrameExtractionWorkflowDependencies,
  input: {
    storyId: number;
    userId: number;
    requestId: string;
    claimToken: string;
  }
) {
  try {
    await dependencies.releaseClaim(input);
  } catch {
    // A newer worker may already own the claim, or settle may already have
    // advanced it to asset_ready. Neither case should be overwritten here.
  }
}

function replayedSuccess(
  requestId: string,
  operation: TimelineFrameExtractionOperation,
  image: GeneratedImage
): ExtractTimelineFrameForStoryResult {
  if (
    operation.status !== "succeeded" ||
    !operation.clipId ||
    operation.timelineVersion == null
  ) {
    return extractionError(
      requestId,
      "receipt-incomplete",
      "retryable",
      "抽帧回执不完整，请重试"
    );
  }
  return {
    status: "ok",
    requestId,
    imageId: image.id,
    imageUrl: image.imageUrl,
    clipId: operation.clipId,
    timelineVersion: operation.timelineVersion,
    replayed: true,
  };
}

/**
 * Durable server-owned extraction workflow. The client supplies only the
 * operation position; winner selection, source authorization, frame capture,
 * warehouse registration, layer planning and placement all happen here.
 */
export async function extractTimelineFrameForStory(
  input: {
    storyId: number;
    userId: number;
    requestId: string;
    timelineFrame: number;
    operationLayer: number;
  },
  dependencyOverrides: Partial<TimelineFrameExtractionWorkflowDependencies> = {}
): Promise<ExtractTimelineFrameForStoryResult> {
  const dependencies = {
    ...defaultWorkflowDependencies,
    ...dependencyOverrides,
  };
  const requestId = input.requestId.trim();
  if (
    !requestId ||
    requestId.length > 160 ||
    !Number.isSafeInteger(input.storyId) ||
    input.storyId <= 0 ||
    !Number.isSafeInteger(input.userId) ||
    input.userId <= 0 ||
    !Number.isSafeInteger(input.timelineFrame) ||
    input.timelineFrame < 0 ||
    !Number.isSafeInteger(input.operationLayer) ||
    input.operationLayer < 0
  ) {
    return extractionError(
      requestId,
      "invalid-input",
      "invalid",
      "抽帧位置或请求标识无效"
    );
  }

  const owner = {
    storyId: input.storyId,
    userId: input.userId,
    requestId,
  };
  const callAllowance = consumeTimelineFrameExtractionCallAllowance(owner);
  if (!callAllowance.allowed) {
    return extractionError(
      requestId,
      "rate-limited",
      "retryable",
      `抽帧请求太频繁，请在 ${callAllowance.retryAfterSeconds} 秒后重试`,
      "continue"
    );
  }
  // Durable receipts are free replays even after the process-local allowance
  // forgets their request id. This check must precede rate limiting so polling
  // claimed/asset_ready operations and replaying succeeded operations cannot
  // be blocked by unrelated new intents in a later window.
  let existingOperation: TimelineFrameExtractionOperation | null;
  try {
    existingOperation = await dependencies.getOperation(owner);
  } catch (error) {
    reportExtractionInternalError("receipt-preflight", error);
    return extractionError(
      requestId,
      "receipt-load-failed",
      "retryable",
      "抽帧回执读取失败，请重试"
    );
  }
  if (
    !existingOperation ||
    !["claimed", "asset_ready", "succeeded"].includes(
      existingOperation.status
    ) ||
    (existingOperation.status === "claimed" &&
      existingOperation.leaseUntil.getTime() <= Date.now())
  ) {
    const allowance = consumeTimelineFrameExtractionAllowance(owner);
    if (!allowance.allowed) {
      return extractionError(
        requestId,
        "rate-limited",
        "retryable",
        `抽帧请求太频繁，请在 ${allowance.retryAfterSeconds} 秒后重试`,
        "continue"
      );
    }
  }
  let claim: Awaited<ReturnType<typeof claimTimelineFrameExtractionOperation>>;
  try {
    claim = await dependencies.claimOperation({
      ...owner,
      inputHash: extractionInputHash({ ...owner, ...input }),
      timelineFrame: input.timelineFrame,
      operationLayer: input.operationLayer,
    });
  } catch (error) {
    reportExtractionInternalError("claim", error);
    const internalMessage = error instanceof Error ? error.message : "";
    const claimConflict = internalMessage.includes("claim conflict");
    const storyUnavailable =
      internalMessage.includes("Story 不存在") ||
      internalMessage.includes("不属于当前用户");
    const quotaExceeded = internalMessage.includes(
      TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR
    );
    let publicMessage = "抽帧请求登记失败，请重试";
    if (claimConflict) {
      publicMessage = "这个抽帧请求标识已绑定其他位置，请重新发起";
    } else if (storyUnavailable) {
      publicMessage = "故事不存在或无权操作";
    } else if (quotaExceeded) {
      publicMessage = "抽帧记录已达到保存上限，请整理项目后再试";
    }
    return extractionError(
      requestId,
      claimConflict
        ? "request-conflict"
        : storyUnavailable
          ? "story-unavailable"
          : quotaExceeded
            ? "extraction-quota-exceeded"
            : "claim-failed",
      claimConflict || storyUnavailable || quotaExceeded
        ? "invalid"
        : "retryable",
      publicMessage
    );
  }

  let operation = claim.operation;
  if (operation.status === "failed") {
    const invalidFailure = extractionInvalidTerminalErrors.has(
      operation.errorCode ?? ""
    );
    return extractionError(
      requestId,
      operation.errorCode ?? "extraction-failed",
      invalidFailure ? "invalid" : "retryable",
      undefined,
      "replace"
    );
  }
  if (operation.status === "succeeded") {
    let image: GeneratedImage | null = null;
    try {
      image =
        operation.imageId == null
          ? null
          : await dependencies.getImageById(operation.imageId);
    } catch (error) {
      reportExtractionInternalError("replay-image-load", error);
      return extractionError(
        requestId,
        "receipt-asset-load-failed",
        "retryable",
        "抽帧图片读取失败，请重试"
      );
    }
    return imageBelongsToStory(image, input.storyId, input.userId)
      ? replayedSuccess(requestId, operation, image)
      : extractionError(
          requestId,
          "receipt-asset-missing",
          "retryable",
          "抽帧图片已不在仓库中，请重新抽帧"
        );
  }
  if (operation.status === "claimed" && !claim.acquired) {
    return {
      status: "pending",
      requestId,
      message: "同一次抽帧正在处理中，请稍候",
    };
  }

  let material: Awaited<ReturnType<typeof getStoryMaterialState>> | null = null;
  const loadMaterial = async () => {
    if (material === null) {
      material = await dependencies.getMaterialState(
        input.storyId,
        input.userId
      );
    }
    return material;
  };

  let descriptor: TimelineFrameExtractionDescriptor | null = null;
  if (operation.status === "claimed") {
    if (operation.descriptor != null) {
      if (!isExtractionDescriptor(operation.descriptor)) {
        const terminal = await failClaimedExtraction(dependencies, {
          ...owner,
          claimToken: operation.claimToken,
          errorCode: "descriptor-invalid",
        });
        return extractionError(
          requestId,
          "descriptor-invalid",
          "invalid",
          undefined,
          terminal ? "replace" : "continue"
        );
      }
      descriptor = operation.descriptor;
    } else {
      let state: Awaited<ReturnType<typeof getStoryMaterialState>>;
      try {
        state = await loadMaterial();
      } catch (error) {
        reportExtractionInternalError("material-load", error);
        await releaseExtractionForRetry(dependencies, {
          ...owner,
          claimToken: operation.claimToken,
        });
        return extractionError(
          requestId,
          "material-load-failed",
          "retryable",
          "时间线素材读取失败，请重试"
        );
      }
      if (!state) {
        const terminal = await failClaimedExtraction(dependencies, {
          ...owner,
          claimToken: operation.claimToken,
          errorCode: "story-unavailable",
        });
        return extractionError(
          requestId,
          "story-unavailable",
          "invalid",
          "故事不存在或无权操作",
          terminal ? "replace" : "continue"
        );
      }
      const currentVideosByShot = new Map<string, CurrentTimelineVideo>();
      for (const shot of state.shots) {
        const video = shot.currentVideo;
        if (!video) continue;
        const range =
          video.selectedRangeId == null
            ? null
            : (video.ranges.find(
                candidate => candidate.id === video.selectedRangeId
              ) ?? null);
        currentVideosByShot.set(shot.stableShotId, {
          takeId: video.id,
          durationSec: video.durationSec,
          rangeId: range?.id ?? null,
          sourceStartSec: range?.startSec ?? 0,
          sourceEndSec: range?.endSec ?? video.durationSec ?? undefined,
        });
      }
      const resolution = resolveTimelineFrameExtraction({
        document: state.timeline,
        timelineFrame: input.timelineFrame,
        hiddenVisualLayers: state.timeline.visualLayerState?.hidden,
        currentVideosByShot,
      });
      if (resolution.status === "error") {
        const terminal = await failClaimedExtraction(dependencies, {
          ...owner,
          claimToken: operation.claimToken,
          errorCode: resolution.error,
        });
        return extractionError(
          requestId,
          resolution.error,
          "invalid",
          undefined,
          terminal ? "replace" : "continue"
        );
      }
      descriptor = resolution.descriptor;
      try {
        const recorded = await dependencies.recordDescriptor({
          ...owner,
          claimToken: operation.claimToken,
          winnerIdentity: descriptor.winnerIdentity,
          descriptor,
        });
        if (!recorded) {
          return extractionError(
            requestId,
            "receipt-missing",
            "retryable",
            "抽帧回执丢失，请重试"
          );
        }
        operation = recorded;
      } catch (error) {
        reportExtractionInternalError("descriptor-save", error);
        await releaseExtractionForRetry(dependencies, {
          ...owner,
          claimToken: operation.claimToken,
        });
        return extractionError(
          requestId,
          "descriptor-save-failed",
          "retryable",
          "抽帧来源保存失败，请重试"
        );
      }
    }
  }

  let image: GeneratedImage;
  if (operation.status === "asset_ready") {
    let settledImage: GeneratedImage | null = null;
    try {
      settledImage =
        operation.imageId == null
          ? null
          : await dependencies.getImageById(operation.imageId);
    } catch (error) {
      reportExtractionInternalError("asset-ready-image-load", error);
      return extractionError(
        requestId,
        "receipt-asset-load-failed",
        "retryable",
        "抽帧图片读取失败，请重试"
      );
    }
    if (!imageBelongsToStory(settledImage, input.storyId, input.userId)) {
      return extractionError(
        requestId,
        "receipt-asset-missing",
        "retryable",
        "已保存的抽帧图片无法读取，请重试"
      );
    }
    image = settledImage;
  } else {
    if (!descriptor || operation.status !== "claimed") {
      return extractionError(
        requestId,
        "receipt-state-invalid",
        "retryable",
        "抽帧回执状态异常，请重试"
      );
    }
    try {
      if (descriptor.kind === "image") {
        const settled = await dependencies.settleAsset({
          ...owner,
          claimToken: operation.claimToken,
          existingImageId: descriptor.imageId,
        });
        operation = settled.operation;
        image = settled.image;
      } else {
        const sourceStorageKey = extractedTimelineFrameSourceStorageKey({
          storyId: input.storyId,
          userId: input.userId,
          takeId: descriptor.takeId,
          rangeId: descriptor.rangeId,
          atSec: descriptor.atSec,
        });
        const reusableImage = (
          await dependencies.getStoryImages(input.storyId, input.userId)
        ).find(candidate => candidate.imageKey === sourceStorageKey);
        if (reusableImage) {
          const settled = await dependencies.settleAsset({
            ...owner,
            claimToken: operation.claimToken,
            existingImageId: reusableImage.id,
          });
          operation = settled.operation;
          image = settled.image;
        } else {
          try {
            await dependencies.preflightStorage({
              storageKey: sourceStorageKey,
            });
          } catch (error) {
            const quotaExceeded =
              error instanceof TimelineFrameExtractionStorageQuotaError;
            const terminal = await failClaimedExtraction(dependencies, {
              ...owner,
              claimToken: operation.claimToken,
              errorCode: quotaExceeded
                ? "warehouse-quota-exceeded"
                : "warehouse-failed",
            });
            return extractionError(
              requestId,
              quotaExceeded ? "warehouse-quota-exceeded" : "warehouse-failed",
              "retryable",
              quotaExceeded
                ? TIMELINE_EXTRACTION_STORAGE_QUOTA_MESSAGE
                : undefined,
              terminal ? "replace" : "continue"
            );
          }
          let bytes: Uint8Array;
          try {
            bytes = await runTimelineFrameCapture({
              userId: input.userId,
              takeId: descriptor.takeId,
              rangeId: descriptor.rangeId,
              atSec: descriptor.atSec,
              capture: async () => {
                const temporaryDirectory = await mkdtemp(
                  path.join(tmpdir(), "timeline-frame-extraction-")
                );
                const outputPath = path.join(temporaryDirectory, "frame.png");
                try {
                  await dependencies.renderVideoFrame({
                    takeId: descriptor.takeId,
                    userId: input.userId,
                    rangeId: descriptor.rangeId,
                    atSec: descriptor.atSec,
                    outputPath,
                  });
                  return await dependencies.readFrameFile(outputPath);
                } finally {
                  await rm(temporaryDirectory, {
                    recursive: true,
                    force: true,
                  });
                }
              },
            });
          } catch (error) {
            if (error instanceof TimelineFrameCaptureBusyError) {
              await releaseExtractionForRetry(dependencies, {
                ...owner,
                claimToken: operation.claimToken,
              });
              return extractionError(
                requestId,
                "capture-busy",
                "retryable",
                "同时抽帧过多，请稍后重试",
                "continue"
              );
            }
            const terminal = await failClaimedExtraction(dependencies, {
              ...owner,
              claimToken: operation.claimToken,
              errorCode: "capture-failed",
            });
            return extractionError(
              requestId,
              "capture-failed",
              "retryable",
              undefined,
              terminal ? "replace" : "continue"
            );
          }
          let stored: Awaited<ReturnType<typeof storeImageBytes>>;
          try {
            stored = await storeTimelineFrameExtractionBytes({
              bytes,
              storageKey: sourceStorageKey,
              store: () =>
                dependencies.storeBytes(bytes, "image/png", {
                  storageKey: sourceStorageKey,
                  requireLocal: true,
                }),
            });
          } catch (error) {
            if (error instanceof TimelineFrameExtractionStorageQuotaError) {
              const terminal = await failClaimedExtraction(dependencies, {
                ...owner,
                claimToken: operation.claimToken,
                errorCode: "warehouse-quota-exceeded",
              });
              return extractionError(
                requestId,
                "warehouse-quota-exceeded",
                "retryable",
                TIMELINE_EXTRACTION_STORAGE_QUOTA_MESSAGE,
                terminal ? "replace" : "continue"
              );
            }
            const terminal = await failClaimedExtraction(dependencies, {
              ...owner,
              claimToken: operation.claimToken,
              errorCode: "warehouse-failed",
            });
            return extractionError(
              requestId,
              "warehouse-failed",
              "retryable",
              undefined,
              terminal ? "replace" : "continue"
            );
          }
          if (stored.status !== "ok" || !stored.imageUrl) {
            const terminal = await failClaimedExtraction(dependencies, {
              ...owner,
              claimToken: operation.claimToken,
              errorCode: "warehouse-failed",
            });
            return extractionError(
              requestId,
              "warehouse-failed",
              "retryable",
              stored.message,
              terminal ? "replace" : "continue"
            );
          }
          const state = await loadMaterial();
          const ownerShot = state?.shots.find(
            shot => shot.stableShotId === descriptor.ownerStableShotId
          );
          const settled = await dependencies.settleAsset({
            ...owner,
            claimToken: operation.claimToken,
            image: {
              projectId: null,
              storyId: input.storyId,
              userId: input.userId,
              shotNo: canonicalizeShotNo(ownerShot?.shotNo),
              shotIdentity: descriptor.ownerStableShotId,
              imageKey: stored.imageKey ?? null,
              imageUrl: stored.imageUrl,
              prompt: `时间线抽帧 · ${timelineFramesToMs(input.timelineFrame)}ms · 来源 Take ${descriptor.takeId}`,
              promptCompilationId: null,
              parentImageId: null,
              generationType: "initial",
              maskKey: null,
            },
          });
          operation = settled.operation;
          image = settled.image;
        }
      }
    } catch (error) {
      reportExtractionInternalError("asset-settle", error);
      await releaseExtractionForRetry(dependencies, {
        ...owner,
        claimToken: operation.claimToken,
      });
      return extractionError(
        requestId,
        "asset-settle-failed",
        "retryable",
        "抽帧图片登记失败，请重试"
      );
    }
  }

  const clipId = extractedTimelineFrameClipId(owner);
  let placement: Awaited<ReturnType<typeof placeExtractedFrameForStory>>;
  try {
    placement = await dependencies.placeFrame({
      ...owner,
      clipId,
      imageId: image.id,
      imageUrl: image.imageUrl,
      label: `抽帧 ${timelineFramesToMs(input.timelineFrame)}ms`,
      timelineFrame: input.timelineFrame,
      operationLayer: input.operationLayer,
    });
  } catch (error) {
    reportExtractionInternalError("placement", error);
    return extractionError(
      requestId,
      "placement-write-failed",
      "retryable",
      "抽帧图片放置失败，请重试"
    );
  }
  if (placement.status === "error") {
    return extractionError(
      requestId,
      placement.errorKind === "conflict"
        ? "timeline-conflict"
        : "placement-failed",
      placement.errorKind === "conflict" ? "retryable" : "invalid",
      placement.errorKind === "conflict"
        ? "时间线刚刚发生变化，请重试"
        : "抽帧图片放置失败，请重试"
    );
  }

  try {
    const succeeded = await dependencies.markSucceeded({
      ...owner,
      clipId,
      timelineVersion: placement.timelineVersion,
    });
    if (!succeeded) {
      return extractionError(
        requestId,
        "receipt-missing",
        "retryable",
        "抽帧已经放置，但回执保存失败；重试不会重复创建"
      );
    }
  } catch (error) {
    reportExtractionInternalError("receipt-finalize", error);
    return extractionError(
      requestId,
      "receipt-finalize-failed",
      "retryable",
      "抽帧已经放置，但回执保存失败；重试不会重复创建"
    );
  }

  return {
    status: "ok",
    requestId,
    imageId: image.id,
    imageUrl: image.imageUrl,
    clipId,
    timelineVersion: placement.timelineVersion,
    targetLayer: placement.targetLayer,
    replayed: placement.changed === false || claim.created === false,
  };
}
