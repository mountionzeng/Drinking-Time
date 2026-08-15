import {
  computePublishingDraftContentHash,
  computePublishingSimpleVersionRequestHash,
  computePublishingVersionRequestHash,
  publishingDraftBufferKey,
  resolvePublishingActiveVersion,
  type PublishingBufferDisposition,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingNarrativeIntent,
  type PublishingPlatformId,
  type PublishingStoryCoreContent,
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

export function publishingVersionTransitionIdentity(input: {
  scope: PublishingOperationScope;
  core: PublishingStoryCoreContent;
  content: PublishingDraftContent;
  narrativeIntent?: PublishingNarrativeIntent;
  bufferDisposition: Exclude<PublishingBufferDisposition, "cancel">;
}): {
  operationToken: string;
  requestHash: string;
  sourceVersionId: string;
  bufferDisposition: Exclude<PublishingBufferDisposition, "cancel">;
  sourceBufferKey?: string;
  sourceBufferHash?: string;
} {
  const sourceBufferKey = input.bufferDisposition === "carry"
    ? publishingDraftBufferKey(
        input.scope.storyId,
        input.scope.platform,
        input.scope.versionId
      )
    : undefined;
  const sourceBufferHash = input.bufferDisposition === "carry"
    ? computePublishingDraftContentHash(input.content)
    : undefined;
  const requestHash = computePublishingVersionRequestHash({
    storyId: input.scope.storyId,
    sourceVersionId: input.scope.versionId,
    platform: input.scope.platform,
    baseContainerRevision: input.scope.containerRevision,
    baseVersionRevision: input.scope.versionRevision,
    baseCoreRevision: input.scope.coreRevision,
    baseDraftRevision: input.scope.draftRevision,
    core: input.core,
    content: input.content,
    narrativeIntent: input.narrativeIntent,
    bufferDisposition: input.bufferDisposition,
    sourceBufferKey,
    sourceBufferHash,
  });
  return {
    operationToken: `create:${requestHash}`,
    requestHash,
    sourceVersionId: input.scope.versionId,
    bufferDisposition: input.bufferDisposition,
    ...(sourceBufferKey ? { sourceBufferKey } : {}),
    ...(sourceBufferHash ? { sourceBufferHash } : {}),
  };
}

export function publishingSimpleVersionIdentity(input: {
  type: "select_version" | "rename_version";
  storyId: number;
  versionId: string;
  displayName?: string;
  baseContainerRevision: number;
  baseVersionRevision: number;
}) {
  const requestHash = computePublishingSimpleVersionRequestHash(input);
  return {
    operationToken: `${input.type}:${requestHash}`,
    requestHash,
  };
}
