export const VIDEO_TAKE_STATUSES = [
  "submitted",
  "processing",
  "available",
  "failed",
  "timeout",
  "unfollowable",
] as const;

export type VideoTakeStatus = (typeof VIDEO_TAKE_STATUSES)[number];

export type VideoTakeRange = {
  id: number;
  takeId: number;
  storyId: number;
  userId: number;
  stableShotId: string;
  startSec: number;
  endSec: number;
  label: string | null;
  source: "manual" | "extracted";
  createdAt: string;
  updatedAt: string;
};

export type VideoTimelineSelection = {
  id: number;
  storyId: number;
  userId: number;
  stableShotId: string;
  takeId: number;
  rangeId: number | null;
  selectionType: "full_take" | "range";
  createdAt: string;
  updatedAt: string;
};

export type VideoTakeAsset = {
  id: number;
  storyId: number;
  userId: number;
  stableShotId: string;
  sourceImageId: number | null;
  promptCompilationId: number | null;
  promptFreshness: "current" | "stale" | "legacy";
  status: VideoTakeStatus;
  taskId: string | null;
  provider: string;
  model: string;
  prompt: string;
  subtitle: string | null;
  durationSec: number | null;
  aspectRatio: string;
  videoKey: string | null;
  videoUrl: string | null;
  errorMessage: string | null;
  parameterSnapshot: Record<string, unknown> | null;
  extractionCapability: "available" | "unavailable";
  createdAt: string;
  updatedAt: string;
  ranges: VideoTakeRange[];
  selectedRangeId: number | null;
  selectedSelectionType: VideoTimelineSelection["selectionType"] | null;
  isTimelineSelected: boolean;
  isStale?: boolean;
  staleReasons?: Array<"source_image" | "prompt">;
};

export type ShotVideoProviderStatus = {
  provider: "302";
  ready: boolean;
  missing: string[];
  warnings: string[];
  baseUrl: string;
  model: string;
  submitPath: string;
  pollPath: string;
  imageField: string;
  motion: "low" | "high";
  promptDirectorModel: string;
  promptDirectorReady: boolean;
};

export function isVideoTakeStatus(value: unknown): value is VideoTakeStatus {
  return (
    typeof value === "string" &&
    VIDEO_TAKE_STATUSES.includes(value as VideoTakeStatus)
  );
}

export function normalizeVideoTakeStatus(value: unknown): VideoTakeStatus {
  return isVideoTakeStatus(value) ? value : "submitted";
}

export function isVideoTakePlayable(status: VideoTakeStatus): boolean {
  return status === "available";
}

export function isVideoTakeTerminal(status: VideoTakeStatus): boolean {
  return ["available", "failed", "timeout", "unfollowable"].includes(status);
}

export function sanitizeVideoError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, 500);
}
