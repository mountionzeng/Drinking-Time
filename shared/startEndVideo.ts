export const START_END_VIDEO_RESOLUTIONS = ["540p", "720p", "1080p"] as const;

export type StartEndVideoResolution =
  (typeof START_END_VIDEO_RESOLUTIONS)[number];

export const START_END_VIDEO_MOVEMENT_AMPLITUDES = [
  "auto",
  "small",
  "medium",
  "large",
] as const;

export const START_END_NEIGHBOR_FRAME_POLICY_VERSION =
  "neighbor-boundary-frames/v1" as const;

export type StartEndFrameSource =
  | "current"
  | "previous-last"
  | "next-first";

export type StartEndVideoMovementAmplitude =
  (typeof START_END_VIDEO_MOVEMENT_AMPLITUDES)[number];

export type StartEndVideoConfig = {
  frameMode: "start_end";
  firstFrameImageId: number;
  lastFrameImageId: number;
  requestedDurationSec: number;
  durationSec: number;
  resolution: StartEndVideoResolution;
  movementAmplitude: StartEndVideoMovementAmplitude;
  model: "viduq2-turbo";
};

export type StartEndShotVideoEstimate = {
  currency: "CNY";
  estimatedCny: number;
  stableShotId: string;
  cueCode: string;
  durationSec: number;
  requestedDurationSec: number;
  resolution: StartEndVideoResolution;
  aspectRatio: "1:1";
  movementAmplitude: StartEndVideoMovementAmplitude;
  model: "viduq2-turbo";
  renderStrategy: VideoRenderDecision["strategy"];
  renderReason: string;
  matchingFrameTakeId?: number;
  frameConstraintWarning?: string;
  localMotion: LocalCameraMotion | null;
  firstFrame: {
    imageId: number;
    imageUrl: string;
    label: string;
    source?: StartEndFrameSource;
    sourceStableShotId?: string;
    sourceCueCode?: string;
  };
  lastFrame: {
    imageId: number;
    imageUrl: string;
    label: string;
    source?: StartEndFrameSource;
    sourceStableShotId?: string;
    sourceCueCode?: string;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parseGenerationParams(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return record(value);
  const text = value.trim();
  if (!text) return {};
  try {
    return record(JSON.parse(text));
  } catch {
    return {};
  }
}

export function parseStartEndVideoConfig(
  generationParams: unknown,
  fallbackDurationSec = 5
): StartEndVideoConfig | null {
  const params = parseGenerationParams(generationParams);
  if (params.frameMode !== "start_end") return null;
  const firstFrameImageId = positiveInteger(params.firstFrameImageId);
  const lastFrameImageId = positiveInteger(params.lastFrameImageId);
  if (
    firstFrameImageId == null ||
    lastFrameImageId == null ||
    firstFrameImageId === lastFrameImageId
  ) {
    return null;
  }

  const requestedDurationSec =
    finitePositive(params.durationSec) ??
    Math.max(1, Number.isFinite(fallbackDurationSec) ? fallbackDurationSec : 5);
  const durationSec = Math.max(
    1,
    Math.min(8, Math.round(requestedDurationSec))
  );
  const resolution = START_END_VIDEO_RESOLUTIONS.includes(
    params.resolution as StartEndVideoResolution
  )
    ? (params.resolution as StartEndVideoResolution)
    : "1080p";
  const configuredAmplitude = START_END_VIDEO_MOVEMENT_AMPLITUDES.includes(
    params.movementAmplitude as StartEndVideoMovementAmplitude
  )
    ? (params.movementAmplitude as StartEndVideoMovementAmplitude)
    : null;
  const explicitAmplitude =
    configuredAmplitude === "auto" &&
    (params.motion === "high" || params.motion === "low")
      ? null
      : configuredAmplitude;
  const movementAmplitude =
    explicitAmplitude ??
    (params.motion === "high"
      ? "large"
      : params.motion === "low"
        ? "small"
        : "auto");

  return {
    frameMode: "start_end",
    firstFrameImageId,
    lastFrameImageId,
    requestedDurationSec,
    durationSec,
    resolution,
    movementAmplitude,
    model: "viduq2-turbo",
  };
}

export function isStartEndVideoTakeSnapshot(value: unknown): boolean {
  return record(value).kind === "shot-start-end";
}
import type {
  LocalCameraMotion,
  VideoRenderDecision,
} from "./videoMotionPolicy";
