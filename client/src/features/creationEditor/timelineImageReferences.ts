import type { StoryTimelineItem } from "@shared/storyMaterial";
import { creationTimelineShotId } from "./timelineShotIdentity";
import type { CreationEditorShot, CreationEditorImage } from "./types";

/** Apply non-owning image references without mutating asset ownership. */
export function applyTimelineImageReferences(
  shots: readonly CreationEditorShot[],
  images: readonly CreationEditorImage[],
  items: readonly StoryTimelineItem[]
): CreationEditorShot[] {
  const imageById = new Map(images.map(image => [image.id, image]));
  const itemByShotId = new Map(items.map(item => [item.stableShotId, item]));
  return shots.map(shot => {
    const referencedImageId =
      itemByShotId.get(creationTimelineShotId(shot))?.referencedImageId ??
      (shot.imageId == null
        ? shot.publishingVideo?.referenceImageId
        : undefined);
    const image =
      referencedImageId == null ? null : imageById.get(referencedImageId);
    if (!image || image.status === "rejected" || !image.imageUrl) return shot;
    return {
      ...shot,
      imageId: image.id,
      imageUrl: image.imageUrl,
      imagePrompt: image.prompt,
      imageSelectionSource: image.selectionSource,
      imageIsPrimary: image.isPrimary,
      imageVersions: Array.from(
        new Map(
          [...(shot.imageVersions ?? []), image].map(candidate => [
            candidate.id,
            candidate,
          ])
        ).values()
      ),
    };
  });
}
