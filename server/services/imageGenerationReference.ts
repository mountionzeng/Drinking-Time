export type ImageGenerationReferencePurpose =
  | "current-frame"
  | "character"
  | "scene-style";

export type ImageGenerationReferencePlan = {
  primaryImage: string | undefined;
  referencePurpose: ImageGenerationReferencePurpose;
  gateReferenceImages: string[] | undefined;
  usesStoryboardFrames: boolean;
  usesStoryStyleReference: boolean;
};

function cleanUrl(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function uniqueUrls(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(values.map(cleanUrl).filter((url): url is string => Boolean(url)))
  );
}

export function planImageGenerationReferences(input: {
  shotReferenceImageUrl?: string | null;
  shotContextImageUrls?: readonly string[] | null;
  originalImageUrl?: string | null;
  characterReferenceImageUrl?: string | null;
  storyReferenceImageUrls?: readonly string[] | null;
  storyStyleReferenceImageUrl?: string | null;
}): ImageGenerationReferencePlan {
  const storyStyleReference = cleanUrl(input.storyStyleReferenceImageUrl);
  const storyboardFrames = uniqueUrls([
    input.shotReferenceImageUrl,
    ...(input.shotContextImageUrls ?? []),
  ]);
  if (storyboardFrames.length > 0) {
    return {
      primaryImage: storyboardFrames[0],
      referencePurpose: "current-frame",
      gateReferenceImages: uniqueUrls([
        ...storyboardFrames,
        storyStyleReference,
      ]),
      usesStoryboardFrames: true,
      usesStoryStyleReference: Boolean(storyStyleReference),
    };
  }

  const originalImage = cleanUrl(input.originalImageUrl);
  const characterReference = cleanUrl(input.characterReferenceImageUrl);
  const storyReferences = uniqueUrls(input.storyReferenceImageUrls ?? []);
  const primaryImage =
    originalImage ??
    characterReference ??
    storyStyleReference ??
    storyReferences[0];
  const referencePurpose = originalImage
    ? "current-frame"
    : characterReference
      ? "character"
      : "scene-style";
  const gateReferenceImages = primaryImage
    ? uniqueUrls([primaryImage, storyStyleReference, ...storyReferences])
    : undefined;
  return {
    primaryImage,
    referencePurpose,
    gateReferenceImages,
    usesStoryboardFrames: false,
    usesStoryStyleReference: Boolean(storyStyleReference),
  };
}
