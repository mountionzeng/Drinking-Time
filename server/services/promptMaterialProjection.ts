import type { PromptAssetFreshness } from "../../shared/imageAsset";

export function resolvePromptAssetFreshness(
  assetCompilationId: number | null,
  currentCompilationId: number | null
): PromptAssetFreshness {
  if (assetCompilationId == null || currentCompilationId == null) {
    return "legacy";
  }
  return assetCompilationId === currentCompilationId ? "current" : "stale";
}

export function resolveVideoStaleReasons(input: {
  sourceImageId: number | null;
  currentImageId: number | null;
  promptFreshness: PromptAssetFreshness;
}): Array<"source_image" | "prompt"> {
  const reasons: Array<"source_image" | "prompt"> = [];
  if (
    input.currentImageId != null &&
    input.sourceImageId != null &&
    input.sourceImageId !== input.currentImageId
  ) {
    reasons.push("source_image");
  }
  if (input.promptFreshness === "stale") {
    reasons.push("prompt");
  }
  return reasons;
}
