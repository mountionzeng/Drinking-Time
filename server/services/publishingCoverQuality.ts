import type { ImageGenCandidate } from "./imageGen";
import { inspectStaticImageCandidates } from "./staticImageQualityGate";
import { writePublishingDraftState } from "./publishingPersistence";

/** Advisory QA settles only the original round, even after the user changes versions. */
export async function checkPublishingCoverQuality(input: {
  storyId: number;
  userId: number;
  versionId: string;
  roundId: string;
  assets: (ImageGenCandidate & { id: number })[];
}): Promise<void> {
  let flaggedAssetIds: number[] = [];
  let unavailable = false;
  try {
    const result = await inspectStaticImageCandidates({ candidates: input.assets });
    flaggedAssetIds = result.rejected.flatMap(candidate => {
      const asset = input.assets[candidate.originalIndex - 1];
      return asset ? [asset.id] : [];
    });
  } catch {
    unavailable = true;
  }
  await writePublishingDraftState({
    storyId: input.storyId,
    userId: input.userId,
    operation: {
      type: "set_cover_quality",
      versionId: input.versionId,
      roundId: input.roundId,
      assetIds: input.assets.map(asset => asset.id),
      flaggedAssetIds,
      unavailable,
    },
  });
}
