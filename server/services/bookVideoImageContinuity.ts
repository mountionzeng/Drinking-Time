import type { BookVideoRecord } from "../../shared/bookVideoCreation";
import {
  buildPublishingArticleVideoPreview,
  publishingArticleVideoRows,
} from "../../shared/publishingArticleVideo";
import { matchBookVideoShots } from "./bookVideoShotContinuity";
import type { PublishingVideoConfirmedSnapshot } from "../../shared/publishingVideoStoryboard";

/** Read-only inventory; the same matcher is used by atomic storyboard adoption. */
export function bookVideoImageContinuity(
  records: BookVideoRecord[],
  images: Array<{
    id: number;
    shotIdentity?: string | null;
    availability?: string;
    status?: string;
  }>,
  previous?: PublishingVideoConfirmedSnapshot | null
) {
  const result: Record<
    string,
    { byShot: Record<string, number[]>; unmatchedImageIds: number[] }
  > = {};
  if (!previous) return result;
  const assets = images.filter(
    image => image.availability !== "missing" && image.status !== "rejected"
  );
  for (const record of records) {
    if (!record.bookSource || record.status === "adopted") continue;
    let shots = record.preview?.shots;
    try {
      shots ??= buildPublishingArticleVideoPreview({
        rows: publishingArticleVideoRows(record.layout),
        requirements: new Map(),
        now: 0,
      }).shots;
    } catch {
      continue;
    } // A stale historical layout must not hide the other records.
    const matches = matchBookVideoShots(shots, previous.shots);
    const byShot: Record<string, number[]> = {};
    for (const [id, old] of matches)
      byShot[id] = assets
        .filter(
          asset => old.stableShotId && asset.shotIdentity === old.stableShotId
        )
        .map(asset => asset.id);
    const inherited = new Set(Object.values(byShot).flat());
    const previousIds = new Set(
      previous.shots.map(shot => shot.stableShotId).filter(Boolean)
    );
    result[record.id] = {
      byShot,
      unmatchedImageIds: assets
        .filter(
          asset =>
            asset.shotIdentity &&
            previousIds.has(asset.shotIdentity) &&
            !inherited.has(asset.id)
        )
        .map(asset => asset.id),
    };
  }
  return result;
}
