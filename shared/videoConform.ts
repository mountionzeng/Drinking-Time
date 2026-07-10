export const VIDEO_TARGET_ASPECT_RATIOS = ["1:1", "16:9", "9:16"] as const;

export type VideoTargetAspectRatio =
  (typeof VIDEO_TARGET_ASPECT_RATIOS)[number];

export const VIDEO_CONFORM_MODES = ["crop", "blur_pad", "ai_expand"] as const;

export type VideoConformMode = (typeof VIDEO_CONFORM_MODES)[number];

export const VIDEO_TARGET_DIMENSIONS: Record<
  VideoTargetAspectRatio,
  { width: number; height: number }
> = {
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};
