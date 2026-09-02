import type {
  PublishingCoverReference,
  PublishingDraftState,
} from "@shared/publishingDraft";

export type PublishingStoryboardCoverSource = {
  versionId: string;
  cover: PublishingCoverReference | null;
};

/**
 * Resolve cover material from the version that owns the active video storyboard.
 * A child storyboard can inherit only a formally adopted cover from its version
 * ancestry. Paid candidates are not a version until the user adopts one.
 */
export function resolvePublishingStoryboardCoverSource(
  publishing: PublishingDraftState
): PublishingStoryboardCoverSource {
  const versions = publishing.versions ?? [];
  const versionsById = new Map(
    versions.map(version => [version.versionId, version] as const)
  );
  const startVersionId =
    publishing.activeVideoStoryboardVersionId ??
    publishing.activeVersionId ??
    versions[0]?.versionId ??
    "v1";
  let current = versionsById.get(startVersionId);
  const visited = new Set<string>();

  while (current && !visited.has(current.versionId)) {
    visited.add(current.versionId);
    if (current.cover) {
      return {
        versionId: current.versionId,
        cover: current.cover,
      };
    }
    current = current.parentId ? versionsById.get(current.parentId) : undefined;
  }

  return {
    versionId: startVersionId,
    cover: publishing.cover,
  };
}
