import type { ImageAsset } from "../../shared/imageAsset";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { artRecipePrompt, type ArtRecipeDNA } from "../../shared/artDirection";

function isUsableCurrentImage(asset: ImageAsset): boolean {
  return (
    asset.kind === "story_frame" &&
    asset.assignment === "shot" &&
    asset.availability !== "missing" &&
    Boolean(asset.imageUrl) &&
    (asset.isPrimary ||
      asset.selectionSource === "explicit" ||
      asset.selectionSource === "legacy" ||
      asset.status === "selected")
  );
}

function shotNumber(asset: ImageAsset): number | null {
  const canonical = canonicalizeShotNo(asset.canonicalShotNo ?? asset.rawShotNo);
  if (!canonical) return null;
  return Number(canonical.slice(2));
}

function uniqueImages(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))
  );
}

export type ShotImageReferencePlan = {
  editSource: ImageAsset | null;
  referenceImages: string[];
  coldStartPrompt: string;
};

export function collectShotImageReferences(params: {
  targetShotNo: string;
  assets: readonly ImageAsset[];
  storyReferenceImages?: readonly string[];
  artDirection?: ArtRecipeDNA;
}): ShotImageReferencePlan {
  const canonicalTarget = canonicalizeShotNo(params.targetShotNo);
  const targetNumber = canonicalTarget ? Number(canonicalTarget.slice(2)) : null;
  const currentImages = params.assets.filter(isUsableCurrentImage);
  const editSource =
    currentImages.find(asset => asset.canonicalShotNo === canonicalTarget) ??
    null;
  const numbered = currentImages
    .map(asset => ({ asset, number: shotNumber(asset) }))
    .filter((entry): entry is { asset: ImageAsset; number: number } =>
      Number.isFinite(entry.number)
    );
  const previous =
    targetNumber == null
      ? null
      : [...numbered]
          .filter(entry => entry.number < targetNumber)
          .sort((left, right) => right.number - left.number)[0]?.asset ?? null;
  const next =
    targetNumber == null
      ? null
      : [...numbered]
          .filter(entry => entry.number > targetNumber)
          .sort((left, right) => left.number - right.number)[0]?.asset ?? null;
  const referenceImages = uniqueImages([
    editSource?.imageUrl,
    previous?.imageUrl,
    next?.imageUrl,
    ...(params.storyReferenceImages ?? []),
  ]);
  return {
    editSource,
    referenceImages,
    coldStartPrompt:
      referenceImages.length === 0 ? artRecipePrompt(params.artDirection) : "",
  };
}
