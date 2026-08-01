export type FrameCandidateSource = {
  imageId?: number;
  imageUrl: string;
  label?: string;
};

export type FrameCandidateAsset = {
  id: number;
  imageUrl: string;
  prompt?: string | null;
  generationType?: "generate" | "initial" | "inpaint";
  parentImageId?: number | null;
};

function hasGeneratedCandidatePrompt(image: FrameCandidateAsset): boolean {
  const prompt = image.prompt ?? "";
  return (
    prompt.includes("USER DIRECT EDIT INSTRUCTION") ||
    prompt.includes("Single-frame rule:")
  );
}

export function isFrameCandidateSheet(
  image: FrameCandidateAsset,
  promptRunImageId?: number
): boolean {
  if (image.parentImageId != null) return false;

  const legacyFinalMjSheet =
    image.generationType === "generate" &&
    image.prompt?.includes("Rerender only") &&
    image.prompt.includes("Create exactly one single cinematic still frame");
  const generatedSheet =
    image.generationType === "initial" ||
    image.generationType === "inpaint" ||
    legacyFinalMjSheet;
  if (!generatedSheet) return false;
  if (legacyFinalMjSheet) return true;

  // The prompt run is authoritative. Storyboard-reference MJ renders are
  // persisted as inpaint even though the provider returns one four-up sheet.
  if (image.id === promptRunImageId) return true;

  if (
    image.prompt?.includes(
      "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH"
    )
  ) {
    return (
      image.prompt.includes("图片要求（最高优先级）") &&
      !image.prompt.includes("本次对话修改（最高优先级") &&
      !image.prompt.includes("单帧参考编辑保护")
    );
  }
  return hasGeneratedCandidatePrompt(image);
}

export function latestFrameCandidateSheet(
  images: readonly FrameCandidateAsset[],
  promptRunImageId?: number
): FrameCandidateSource | null {
  const sheets = images
    .filter(image => isFrameCandidateSheet(image, promptRunImageId))
    .sort((left, right) => left.id - right.id);
  const latest = sheets.at(-1);
  if (!latest) return null;
  return {
    imageId: latest.id,
    imageUrl: latest.imageUrl,
    label: `候选版本 V${sheets.length}`,
  };
}
