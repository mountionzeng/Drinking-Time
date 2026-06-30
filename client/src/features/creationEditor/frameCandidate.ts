export type FrameCandidateSource = {
  imageId?: number;
  imageUrl: string;
  label?: string;
};

export type FrameCandidateAsset = {
  id: number;
  imageUrl: string;
  generationType?: "generate" | "initial" | "inpaint";
  parentImageId?: number | null;
};

export function isFrameCandidateSheet(image: FrameCandidateAsset): boolean {
  return image.generationType === "initial" && image.parentImageId == null;
}

export function latestFrameCandidateSheet(
  images: readonly FrameCandidateAsset[]
): FrameCandidateSource | null {
  const sheets = images
    .filter(isFrameCandidateSheet)
    .sort((left, right) => left.id - right.id);
  const latest = sheets.at(-1);
  if (!latest) return null;
  return {
    imageId: latest.id,
    imageUrl: latest.imageUrl,
    label: `候选版本 V${sheets.length}`,
  };
}
