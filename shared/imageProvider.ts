export const IMAGE_PROVIDER_VALUES = ["fal", "gpt-image", "midjourney"] as const;

export type ImageProvider = (typeof IMAGE_PROVIDER_VALUES)[number];

export type ImageProviderStatus = {
  ready: boolean;
  reason: string | null;
  retryAt: string | null;
  lastFailure: {
    provider: ImageProvider;
    message: string;
    failedAt: string;
  } | null;
};

export const IMAGE_PROVIDER_LABELS: Record<ImageProvider, string> = {
  fal: "fal",
  "gpt-image": "GPT-image",
  midjourney: "Midjourney",
};

export function isImageProvider(value: string | undefined): value is ImageProvider {
  return IMAGE_PROVIDER_VALUES.includes(value as ImageProvider);
}

export function normalizeImageProvider(
  value: string | undefined,
  fallback: ImageProvider = "fal",
): ImageProvider {
  return isImageProvider(value) ? value : fallback;
}
