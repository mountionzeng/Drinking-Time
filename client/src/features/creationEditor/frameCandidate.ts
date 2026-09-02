export type FrameCandidateSource = {
  imageId?: number;
  imageUrl: string;
  label?: string;
};

export type FrameCandidateAsset = {
  id: number;
  imageUrl: string;
  prompt?: string | null;
  promptCompilationId?: number | null;
  generationType?: "generate" | "initial" | "inpaint";
  parentImageId?: number | null;
  /** Persisted/display contract. A complete image is never inferred to be a sheet from its prompt. */
  candidateLayout?: "single" | "four-up-sheet";
};

export function isFrameCandidateSheet(
  image: FrameCandidateAsset,
  _promptRunImageId?: number
): boolean {
  if (image.parentImageId != null) return false;
  return image.candidateLayout === "four-up-sheet";
}

/**
 * Split only an asset carrying the explicit four-up display contract. Prompt
 * wording, generation type and prompt-run ids describe how an image was made;
 * none of them prove that its pixels contain a 2x2 sheet.
 */
export function frameCandidateSheetIds(
  images: readonly FrameCandidateAsset[],
  promptRunImageId?: number
): Set<number> {
  const compilationCounts = new Map<number, number>();
  for (const image of images) {
    if (image.promptCompilationId == null || image.parentImageId != null) {
      continue;
    }
    compilationCounts.set(
      image.promptCompilationId,
      (compilationCounts.get(image.promptCompilationId) ?? 0) + 1
    );
  }
  return new Set(
    images
      .filter(
        image =>
          !(
            image.promptCompilationId != null &&
            (compilationCounts.get(image.promptCompilationId) ?? 0) > 1
          ) && isFrameCandidateSheet(image, promptRunImageId)
      )
      .map(image => image.id)
  );
}

export function latestFrameCandidateSheet(
  images: readonly FrameCandidateAsset[],
  promptRunImageId?: number
): FrameCandidateSource | null {
  const sheetIds = frameCandidateSheetIds(images, promptRunImageId);
  const sheets = images
    .filter(image => sheetIds.has(image.id))
    .sort((left, right) => left.id - right.id);
  const latest = sheets.at(-1);
  if (!latest) return null;
  return {
    imageId: latest.id,
    imageUrl: latest.imageUrl,
    label: `候选版本 V${sheets.length}`,
  };
}
