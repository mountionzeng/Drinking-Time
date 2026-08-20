import type {
  PublishingCoverReference,
  PublishingCoverRound,
  PublishingDraftState,
} from "@shared/publishingDraft";

export type PublishingStoryboardCoverSource = {
  versionId: string;
  cover: PublishingCoverReference | null;
  coverRounds: PublishingCoverRound[];
};

/**
 * Resolve cover material from the version that owns the active video storyboard.
 * Legacy stories may have created the storyboard in a child version while their
 * only paid cover round remains on an ancestor, so the browsed publishing version
 * is not a reliable source.
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
  let nearestCandidateSource: PublishingStoryboardCoverSource | null = null;
  const visited = new Set<string>();

  while (current && !visited.has(current.versionId)) {
    visited.add(current.versionId);
    if (current.cover) {
      return {
        versionId: current.versionId,
        cover: current.cover,
        coverRounds: [],
      };
    }
    if (!nearestCandidateSource && current.coverRounds.length > 0) {
      nearestCandidateSource = {
        versionId: current.versionId,
        cover: null,
        coverRounds: current.coverRounds,
      };
    }
    current = current.parentId ? versionsById.get(current.parentId) : undefined;
  }

  if (nearestCandidateSource) return nearestCandidateSource;

  return {
    versionId: startVersionId,
    cover: publishing.cover,
    coverRounds: publishing.coverRounds,
  };
}
