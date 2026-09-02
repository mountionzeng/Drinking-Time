import {
  resolvePublishingActiveVersion,
  type PublishingDraftState,
  type PublishingPlatformId,
} from "@shared/publishingDraft";
import type { PublishingTrendPlatformId } from "@shared/publishingPlatformContext";

export type PublishingOperationScope = {
  storyId: number;
  versionId: string;
  platform: PublishingPlatformId;
  containerRevision: number;
  versionRevision: number;
  coreRevision: number;
  draftRevision: number;
  intentRevision: number;
  contextRevision: number;
};

export function publishingOperationScope(input: {
  storyId: number;
  publishing: PublishingDraftState;
  platform?: PublishingPlatformId;
}): PublishingOperationScope {
  const version = resolvePublishingActiveVersion(input.publishing);
  const platform = input.platform ?? version.activePlatform;
  return {
    storyId: input.storyId,
    versionId: version.versionId,
    platform,
    containerRevision:
      input.publishing.containerRevision ?? input.publishing.revision,
    versionRevision: version.versionRevision,
    coreRevision: version.core?.revision ?? 0,
    draftRevision: version.drafts[platform]?.revision ?? 0,
    intentRevision: version.intentSnapshot?.revision ?? 0,
    contextRevision:
      version.platformContexts?.[platform as PublishingTrendPlatformId]
        ?.revision ?? 0,
  };
}

export function publishingOperationScopeMatches(
  expected: PublishingOperationScope,
  input: {
    storyId: number | null;
    publishing: PublishingDraftState;
  }
): boolean {
  if (input.storyId !== expected.storyId) return false;
  const current = publishingOperationScope({
    storyId: expected.storyId,
    publishing: input.publishing,
    platform: expected.platform,
  });
  return (
    current.versionId === expected.versionId &&
    current.containerRevision === expected.containerRevision &&
    current.versionRevision === expected.versionRevision &&
    current.coreRevision === expected.coreRevision &&
    current.draftRevision === expected.draftRevision &&
    current.intentRevision === expected.intentRevision &&
    current.contextRevision === expected.contextRevision
  );
}

export function publishingTrendWriteScope(scope: PublishingOperationScope) {
  return {
    versionId: scope.versionId,
    platform: scope.platform as PublishingTrendPlatformId,
    baseContainerRevision: scope.containerRevision,
    baseVersionRevision: scope.versionRevision,
    baseContextRevision: scope.contextRevision,
    baseSourceRevision: scope.draftRevision,
  };
}
