import {
  confirmPublishingCoreChange,
  isPublishingPlatformId,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
  applyPublishingWordingEdit,
  appendPublishingCoverRound,
  type PublishingCoverReference,
  type PublishingCoverGeneration,
  type PublishingCoverRound,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformId,
  type PublishingConversationSnapshot,
  type PublishingNarrativeIntent,
  type PublishingBufferDisposition,
  type PublishingVersionOperationReceipt,
  computePublishingDraftContentHash,
  computePublishingSimpleVersionRequestHash,
  computePublishingVersionRequestHash,
  publishingDraftBufferKey,
  type PublishingStoryCoreContent,
  type PublishingTextOperationReceipt,
  hasPersistedPublishingVersion,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";
import {
  appendPublishingPlatformContextSnapshot,
  emptyPublishingPlatformContextState,
  isPersistablePublishingContextSnapshot,
  selectPublishingPlatformContextTags,
  type PublishingPlatformContextSnapshot,
  type PublishingTrendPlatformId,
} from "../../shared/publishingPlatformContext";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import { storyIntentProfileFromLegacy } from "../../shared/storyIntentProfile";
import { getStoryById } from "../db";
import { derivePublishingVersionDisplayName } from "../../shared/textTitle";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  PUBLISHING_ALBUM_MAX_OPERATION_RECEIPTS,
  PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS,
  PUBLISHING_ALBUM_MAX_CANDIDATES_PER_ROUND,
  PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE,
  normalizePublishingAlbumAggregate,
  normalizePublishingAlbumTypographyLayout,
  publishingAlbumCodePointCount,
  type PublishingAlbumAggregate,
  type PublishingAlbumBackgroundGeneration,
  type PublishingAlbumBackgroundRound,
  type PublishingAlbumTypographyLayout,
} from "../../shared/publishingAlbum";

export class PublishingDraftOwnershipError extends Error {
  constructor(storyId: number) {
    super(`Publishing Story ${storyId} was not found for this user`);
    this.name = "PublishingDraftOwnershipError";
  }
}

export class PublishingDraftConflictError extends Error {
  constructor(
    public readonly scope: "publishing" | "core" | PublishingPlatformId,
    public readonly expectedRevision: number,
    public readonly actualRevision: number
  ) {
    super(
      `Publishing conflict for ${scope}: expected revision ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "PublishingDraftConflictError";
  }
}

type InitializeOperation = {
  type: "initialize";
  activePlatform: PublishingPlatformId;
  selectedPlatforms: PublishingPlatformId[];
  core: PublishingStoryCoreContent;
  content: PublishingDraftContent;
  narrativeIntent?: PublishingNarrativeIntent;
  basePublishingRevision: number;
  baseContainerRevision?: number;
  baseVersionRevision?: number;
  textOperationReceipt?: PublishingTextOperationReceipt;
  storyId?: number;
};

type UpsertDraftOperation = {
  type: "upsert_draft";
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  baseDraftRevision: number;
  activate?: boolean;
  baseContainerRevision?: number;
  baseVersionRevision?: number;
  textOperationReceipt?: PublishingTextOperationReceipt;
  storyId?: number;
};

type ApplyWordingOperation = {
  type: "apply_wording";
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  baseDraftRevision: number;
};

type ConfirmCoreOperation = {
  type: "confirm_core_change";
  platform: PublishingPlatformId;
  core: PublishingStoryCoreContent;
  content: PublishingDraftContent;
  baseCoreRevision: number;
  baseDraftRevision: number;
};

type ClaimTextOperation = {
  type: "claim_text_operation";
  receipt: PublishingTextOperationReceipt;
  baseContainerRevision: number;
  baseVersionRevision: number;
  storyId?: number;
};

type SettleTextOperation = {
  type: "settle_text_operation";
  receipt: PublishingTextOperationReceipt;
  baseContainerRevision: number;
  baseVersionRevision: number;
  storyId?: number;
};

type AppendPlatformContextSnapshotOperation = {
  type: "append_platform_context_snapshot";
  versionId: string;
  platform: PublishingTrendPlatformId;
  snapshot: PublishingPlatformContextSnapshot;
  baseContainerRevision: number;
  baseVersionRevision: number;
  baseContextRevision: number;
  baseSourceRevision: number;
  storyId?: number;
};

type SelectPlatformContextTagsOperation = {
  type: "select_platform_context_tags";
  versionId: string;
  platform: PublishingTrendPlatformId;
  snapshotId: string | null;
  candidateIds: string[];
  contentTags: string[];
  baseContainerRevision: number;
  baseVersionRevision: number;
  baseContextRevision: number;
  baseSourceRevision: number;
  storyId?: number;
};

type SetSelectionOperation = {
  type: "set_selection";
  activePlatform: PublishingPlatformId;
  selectedPlatforms: PublishingPlatformId[];
  basePublishingRevision: number;
};

type SetCoverOperation = {
  type: "set_cover";
  cover: PublishingCoverReference | null;
  basePublishingRevision: number;
};

export type CreatePublishingVersionOperation = {
  type: "create_version";
  platform: PublishingPlatformId;
  core: PublishingStoryCoreContent;
  content: PublishingDraftContent;
  baseCoreRevision: number;
  baseDraftRevision: number;
  baseVersionRevision?: number;
  displayName?: string;
  narrativeIntent?: PublishingNarrativeIntent;
  baseContainerRevision: number;
  conversationSnapshot?: PublishingConversationSnapshot | null;
  requestHash?: string;
  sourceVersionId?: string;
  bufferDisposition?: PublishingBufferDisposition;
  sourceBufferKey?: string;
  sourceBufferHash?: string;
  storyId?: number;
};
export type SelectPublishingVersionOperation = {
  type: "select_version";
  versionId: string;
  baseContainerRevision: number;
  baseVersionRevision?: number;
  storyId?: number;
  requestHash?: string;
};
export type RenamePublishingVersionOperation = {
  type: "rename_version";
  versionId: string;
  displayName: string;
  baseContainerRevision: number;
  baseVersionRevision?: number;
  storyId?: number;
  requestHash?: string;
};

type AppendCoverRoundOperation = {
  type: "append_cover_round";
  round: PublishingCoverRound;
  basePublishingRevision: number;
};

type ClaimCoverGenerationOperation = {
  type: "claim_cover_generation";
  generation: PublishingCoverGeneration;
  basePublishingRevision: number;
};

type UpdateCoverGenerationOperation = {
  type: "update_cover_generation";
  operationToken: string;
  taskId?: string | null;
  status?: PublishingCoverGeneration["status"];
  error?: string;
  expiresAt?: number;
};

type CompleteCoverGenerationOperation = {
  type: "complete_cover_generation";
  operationToken: string;
  round: PublishingCoverRound;
};

export type InitializePublishingAlbumOperation = {
  type: "initialize_album";
  versionId: string;
  album: PublishingAlbumAggregate;
  requestHash: string;
  baseContainerRevision: number;
  baseVersionRevision: number;
  storyId?: number;
};

export type UpdatePublishingAlbumPageTextOperation = {
  type: "update_album_page_text";
  versionId: string;
  pageId: string;
  text: string;
  requestHash: string;
  baseTextRevision: number;
  storyId?: number;
};

export type UpdatePublishingAlbumPageTypographyOperation = {
  type: "update_album_page_typography";
  versionId: string;
  pageId: string;
  typography: PublishingAlbumTypographyLayout;
  requestHash: string;
  baseTextRevision: number;
  baseTypographyRevision: number;
  storyId?: number;
};

export type ClaimPublishingAlbumBackgroundOperation = {
  type: "claim_album_background";
  versionId: string;
  pageId: string;
  generation: PublishingAlbumBackgroundGeneration;
  baseBackgroundRevision: number;
  storyId?: number;
};

export type UpdatePublishingAlbumBackgroundOperation = {
  type: "update_album_background";
  versionId: string;
  pageId: string;
  operationToken: string;
  taskId?: string | null;
  status?: PublishingAlbumBackgroundGeneration["status"];
  error?: string;
  expiresAt?: number;
  storyId?: number;
};

export type CompletePublishingAlbumBackgroundOperation = {
  type: "complete_album_background";
  versionId: string;
  pageId: string;
  operationToken: string;
  round: PublishingAlbumBackgroundRound;
  storyId?: number;
};

export type AdoptPublishingAlbumBackgroundOperation = {
  type: "adopt_album_background";
  versionId: string;
  pageId: string;
  assetId: number;
  requestHash: string;
  baseBackgroundRevision: number;
  storyId?: number;
};

export type PublishingDraftWriteOperation =
  | InitializeOperation
  | UpsertDraftOperation
  | ApplyWordingOperation
  | ConfirmCoreOperation
  | SetSelectionOperation
  | AppendCoverRoundOperation
  | ClaimCoverGenerationOperation
  | UpdateCoverGenerationOperation
  | CompleteCoverGenerationOperation
  | ClaimTextOperation
  | SettleTextOperation
  | AppendPlatformContextSnapshotOperation
  | SelectPlatformContextTagsOperation
  | InitializePublishingAlbumOperation
  | UpdatePublishingAlbumPageTextOperation
  | UpdatePublishingAlbumPageTypographyOperation
  | ClaimPublishingAlbumBackgroundOperation
  | UpdatePublishingAlbumBackgroundOperation
  | CompletePublishingAlbumBackgroundOperation
  | AdoptPublishingAlbumBackgroundOperation
  | SetCoverOperation
  | CreatePublishingVersionOperation
  | SelectPublishingVersionOperation
  | RenamePublishingVersionOperation;

export type PublishingVersionOperation =
  | CreatePublishingVersionOperation
  | SelectPublishingVersionOperation
  | RenamePublishingVersionOperation;

export type PublishingDraftPersistenceResult = {
  storyId: number;
  storyRevision: number;
  publishing: PublishingDraftState;
  committedReceipt?: PublishingVersionOperationReceipt;
  textOperationReceipt?: PublishingTextOperationReceipt;
};

export const MAX_PUBLISHING_STATE_BYTES = 2 * 1024 * 1024;
export const MAX_STORY_BODY_BYTES = 4 * 1024 * 1024;

export class PublishingCapacityError extends Error {
  constructor(public readonly scope: "publishing" | "story", public readonly bytes: number, public readonly limit: number) {
    super(`Publishing ${scope} 容量超过限制：${bytes} > ${limit}`);
    this.name = "PublishingCapacityError";
  }
}
export class PublishingLegacyFallbackDisabledError extends Error {
  constructor() {
    super("Publishing legacy fallback reader is disabled; migration is required before writing");
    this.name = "PublishingLegacyFallbackDisabledError";
  }
}

let migrationMetrics = { fallbackReads: 0, legacyWrites: 0, projectionMismatches: 0 };
let legacyReaderEnabled = true;

export function getPublishingMigrationMetrics() {
  return { ...migrationMetrics, legacyReaderEnabled };
}

export function resetPublishingMigrationMetricsForTest(): void {
  migrationMetrics = { fallbackReads: 0, legacyWrites: 0, projectionMismatches: 0 };
  legacyReaderEnabled = true;
}

export function setPublishingLegacyReaderEnabled(enabled: boolean): void {
  legacyReaderEnabled = enabled;
}

export function publishingProjectionHash(state: PublishingDraftState): string {
  const active = resolvePublishingActiveVersion(state);
  return `sha256:${createHash("sha256").update(canonicalJsonStringify({
    core: active.core, drafts: active.drafts, activePlatform: active.activePlatform,
    selectedPlatforms: active.selectedPlatforms, cover: active.cover, coverRounds: active.coverRounds,
    coverGeneration: active.coverGeneration ?? null,
  })).digest("hex")}`;
}

function assertPublishingCapacity(publishing: PublishingDraftState): void {
  const publishingBytes = Buffer.byteLength(JSON.stringify(publishing), "utf8");
  if (publishingBytes > MAX_PUBLISHING_STATE_BYTES) {
    throw new PublishingCapacityError("publishing", publishingBytes, MAX_PUBLISHING_STATE_BYTES);
  }
}

function publishingAlbumValueHash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

function assertStoryCapacity(body: Record<string, unknown>): void {
  const storyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (storyBytes > MAX_STORY_BODY_BYTES) throw new PublishingCapacityError("story", storyBytes, MAX_STORY_BODY_BYTES);
}

function normalizeStoredPublishing(raw: unknown): PublishingDraftState {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  const needsFallback = Boolean(
    value &&
      (value.canonicalAuthority !== "versions" ||
        !Array.isArray(value.versions) ||
        value.versions.length === 0)
  );
  if (needsFallback) migrationMetrics.fallbackReads += 1;
  if (needsFallback && !legacyReaderEnabled) {
    throw new PublishingLegacyFallbackDisabledError();
  }
  return normalizePublishingDraftState(raw);
}

function projectionEquivalent(state: PublishingDraftState): boolean {
  const active = resolvePublishingActiveVersion(state);
  return canonicalJsonStringify({
    core: state.core, drafts: state.drafts, activePlatform: state.activePlatform,
    selectedPlatforms: state.selectedPlatforms, cover: state.cover, coverRounds: state.coverRounds,
    coverGeneration: state.coverGeneration ?? null,
  }) === canonicalJsonStringify({
    core: active.core, drafts: active.drafts, activePlatform: active.activePlatform,
    selectedPlatforms: active.selectedPlatforms, cover: active.cover, coverRounds: active.coverRounds,
    coverGeneration: active.coverGeneration ?? null,
  });
}

export function inspectPublishingProjection(state: PublishingDraftState): { equivalent: boolean; hash: string } {
  const equivalent = projectionEquivalent(state);
  if (!equivalent) migrationMetrics.projectionMismatches += 1;
  return { equivalent, hash: publishingProjectionHash(state) };
}

export function inspectPublishingSerializedOutput(state: PublishingDraftState): boolean {
  const canonical = state.canonicalAuthority === "versions";
  if (!canonical) migrationMetrics.legacyWrites += 1;
  return canonical;
}

function canonicalize(state: PublishingDraftState): PublishingDraftState {
  const versions = state.versions ?? [];
  const active = resolvePublishingActiveVersion(state);
  return {
    ...state,
    activeVersionId: active.versionId,
    canonicalAuthority: "versions",
    versions: versions.map(v =>
      v.versionId === active.versionId
        ? {
            ...v,
            core: structuredClone(state.core),
            drafts: structuredClone(state.drafts),
            activePlatform: state.activePlatform,
            selectedPlatforms: [...state.selectedPlatforms],
            cover: state.cover ? { ...state.cover } : null,
            coverRounds: structuredClone(state.coverRounds),
            coverGeneration: state.coverGeneration
              ? structuredClone(state.coverGeneration)
              : null,
            versionRevision: Math.max(v.versionRevision, state.revision),
          }
        : v
    ),
  };
}

function projectVersion(
  state: PublishingDraftState,
  versionId: string
): PublishingDraftState {
  const version = state.versions?.find(
    candidate => candidate.versionId === versionId
  );
  if (!version) throw new Error(`Unknown publishing version: ${versionId}`);
  return {
    ...state,
    activeVersionId: version.versionId,
    core: structuredClone(version.core),
    drafts: structuredClone(version.drafts),
    activePlatform: version.activePlatform,
    selectedPlatforms: [...version.selectedPlatforms],
    cover: version.cover ? { ...version.cover } : null,
    coverRounds: structuredClone(version.coverRounds),
    coverGeneration: version.coverGeneration
      ? structuredClone(version.coverGeneration)
      : null,
  };
}

function versionDisplayNameSources(
  parent: ReturnType<typeof resolvePublishingActiveVersion>,
  op: CreatePublishingVersionOperation
): string[] {
  const sources: string[] = [];
  const thesis = op.core.thesis.trim();
  if (thesis && thesis !== parent.core?.thesis.trim()) sources.push(thesis);

  const parentFacts = new Set(parent.core?.facts.map(fact => fact.trim()));
  sources.push(
    ...op.core.facts
      .map(fact => fact.trim())
      .filter(fact => fact && !parentFacts.has(fact))
  );

  if (op.narrativeIntent) {
    const intentChanged =
      op.narrativeIntent.primaryPurpose !==
        parent.narrativeIntent.primaryPurpose ||
      op.narrativeIntent.coreAudience.trim() !==
        parent.narrativeIntent.coreAudience.trim();
    if (intentChanged) {
      const audience = op.narrativeIntent.coreAudience.trim();
      const purpose =
        op.narrativeIntent.primaryPurpose === "gift"
          ? "赠予"
          : op.narrativeIntent.primaryPurpose === "persuade"
            ? "介绍说服"
            : op.narrativeIntent.primaryPurpose === "share"
              ? "公开分享"
              : op.narrativeIntent.primaryPurpose === "create"
                ? "创作"
                : "留存";
      sources.push(audience ? `给${audience}的${purpose}` : purpose);
    }
  }

  sources.push(op.content.title, op.content.body);
  return sources;
}

function applyVersionOperation(
  state: PublishingDraftState,
  op: PublishingVersionOperation,
  now: number,
  operationToken?: string
): PublishingDraftState {
  const versions = state.versions ?? [];
  assertRevision(
    "publishing",
    op.baseContainerRevision,
    state.containerRevision ?? state.revision
  );
  if (op.type === "select_version") {
    const target = versions.find(version => version.versionId === op.versionId);
    if (!target) throw new Error(`Unknown publishing version: ${op.versionId}`);
    if (op.baseVersionRevision != null) {
      assertRevision(
        "publishing",
        op.baseVersionRevision,
        target.versionRevision
      );
    }
    const selected = {
      ...projectVersion(state, op.versionId),
      revision: state.revision + 1,
      containerRevision: (state.containerRevision ?? 0) + 1,
      updatedAt: now,
    };
    return operationToken ? withSimpleVersionReceipt(selected, op, operationToken, now, target) : selected;
  }
  if (op.type === "rename_version") {
    const target = versions.find(version => version.versionId === op.versionId);
    if (!target) throw new Error(`Unknown publishing version: ${op.versionId}`);
    if (op.baseVersionRevision != null) {
      assertRevision(
        "publishing",
        op.baseVersionRevision,
        target.versionRevision
      );
    }
    const renamed = {
      ...state,
      versions: versions.map(v =>
        v.versionId === op.versionId
          ? { ...v, displayName: op.displayName.trim() || v.displayName, displayNameSource: "manual" as const,
              versionRevision: v.versionRevision + 1 }
          : v
      ),
      containerRevision: (state.containerRevision ?? 0) + 1,
      revision: state.revision + 1,
      updatedAt: now,
    };
    const renamedTarget = renamed.versions?.find(version => version.versionId === op.versionId) ?? target;
    return operationToken ? withSimpleVersionReceipt(renamed, op, operationToken, now, renamedTarget) : renamed;
  }
  assertRevision("core", op.baseCoreRevision, state.core?.revision ?? 0);
  assertRevision(
    op.platform,
    op.baseDraftRevision,
    state.drafts[op.platform]?.revision ?? 0
  );
  const parent = resolvePublishingActiveVersion(state);
  if (op.sourceVersionId && op.sourceVersionId !== parent.versionId) {
    throw new Error("Publishing version scope changed before commit");
  }
  if (op.baseVersionRevision != null) {
    assertRevision(
      "publishing",
      op.baseVersionRevision,
      parent.versionRevision
    );
  }
  const nextSequence = Math.max(0, ...versions.map(v => v.sequence)) + 1;
  const versionId = `v${nextSequence}`;
  const nextCore = {
    revision: (parent.core?.revision ?? 0) + 1,
    facts: [...op.core.facts],
    thesis: op.core.thesis,
    emotion: op.core.emotion,
    voiceTraits: [...op.core.voiceTraits],
    visualConcept: op.core.visualConcept,
    updatedAt: now,
  };
  const narrativeChanged = Boolean(
    op.narrativeIntent &&
    (op.narrativeIntent.primaryPurpose !== parent.narrativeIntent.primaryPurpose ||
      op.narrativeIntent.coreAudience !== parent.narrativeIntent.coreAudience)
  );
  const drafts = structuredClone(parent.drafts);
  for (const [platform, draft] of Object.entries(drafts)) {
    if (platform !== op.platform && draft)
      drafts[platform as PublishingPlatformId] = {
        ...draft,
        needsReview: true,
      };
  }
  const priorDraft = drafts[op.platform];
  drafts[op.platform] = {
    platform: op.platform,
    content: structuredClone(op.content),
    appliedBaseline: structuredClone(op.content),
    sourceCoreRevision: nextCore.revision,
    revision: (priorDraft?.revision ?? 0) + 1,
    needsReview: false,
    updatedAt: now,
  };
  const next = {
    ...parent,
    versionId,
    sequence: nextSequence,
    displayName:
      op.displayName?.trim() ||
      derivePublishingVersionDisplayName(
        nextSequence,
        versionDisplayNameSources(parent, op)
      ),
    displayNameSource: op.displayName?.trim() ? "manual" as const : "automatic" as const,
    parentId: parent.versionId,
    versionRevision: parent.versionRevision + 1,
    core: nextCore,
    drafts,
    activePlatform: op.platform,
    selectedPlatforms: parent.selectedPlatforms.includes(op.platform)
      ? [...parent.selectedPlatforms]
      : [...parent.selectedPlatforms, op.platform],
    cover: parent.cover ? { ...parent.cover } : null,
    coverRounds: [],
    coverGeneration: null,
    textOperations: {},
    platformContexts: {},
    platformStatuses: Object.fromEntries(
      Array.from(new Set([...parent.selectedPlatforms, op.platform])).map(platform => [
        platform,
        platform === op.platform
          ? (op.bufferDisposition === "carry" ? "carried" : narrativeChanged ? "awaiting_generation" : "ready")
          : "inherited",
      ])
    ),
    conversationSnapshot: op.conversationSnapshot
      ? structuredClone(op.conversationSnapshot)
      : parent.conversationSnapshot
        ? structuredClone(parent.conversationSnapshot)
        : null,
    videoStoryboard: null,
    album: null,
    narrativeIntent: op.narrativeIntent
      ? structuredClone(op.narrativeIntent)
      : structuredClone(parent.narrativeIntent),
    intentSnapshot: op.narrativeIntent
      ? (() => {
          const migrated = storyIntentProfileFromLegacy(op.narrativeIntent, {
            source: "version_snapshot",
            now,
          });
          if (!migrated) return parent.intentSnapshot
            ? structuredClone(parent.intentSnapshot)
            : undefined;
          return {
            ...migrated,
            channel: parent.intentSnapshot?.channel ?? migrated.channel,
            expression: parent.intentSnapshot
              ? structuredClone(parent.intentSnapshot.expression)
              : migrated.expression,
            revision: (parent.intentSnapshot?.revision ?? migrated.revision) + 1,
            provenance: { source: "version_snapshot" as const, updatedAt: now },
          };
        })()
      : parent.intentSnapshot ? structuredClone(parent.intentSnapshot) : undefined,
  };
  return {
    ...state,
    activeVersionId: versionId,
    versions: [...versions, next],
    core: structuredClone(next.core),
    drafts: structuredClone(next.drafts),
    activePlatform: next.activePlatform,
    selectedPlatforms: [...next.selectedPlatforms],
    cover: next.cover ? { ...next.cover } : null,
    coverRounds: [],
    coverGeneration: null,
    revision: state.revision + 1,
    containerRevision: (state.containerRevision ?? 0) + 1,
    versionOperationReceipts: operationToken
      ? boundedVersionReceipts({
          ...(state.versionOperationReceipts ?? {}),
          [operationToken]: op.requestHash
            ? {
                status: "committed",
                operationKind: "create_version",
                operationToken,
                requestHash: op.requestHash,
                versionId,
                resultActiveVersionId: versionId,
                sourceVersionId: parent.versionId,
                storyId: op.storyId ?? 0,
                platform: op.platform,
                bufferDisposition: op.bufferDisposition === "carry" ? "carry" : "leave",
                sourceBufferKey: op.sourceBufferKey,
                sourceBufferHash: op.sourceBufferHash,
                committedAt: now,
                baseContainerRevision: op.baseContainerRevision,
                baseVersionRevision: op.baseVersionRevision,
              } satisfies PublishingVersionOperationReceipt
            : versionId,
        })
      : state.versionOperationReceipts,
    updatedAt: now,
  };
}

function simpleVersionRequestHash(op: SelectPublishingVersionOperation | RenamePublishingVersionOperation): string {
  if (op.storyId == null) throw new Error("Publishing version request hash requires Story scope");
  return computePublishingSimpleVersionRequestHash({
    type: op.type,
    storyId: op.storyId,
    versionId: op.versionId,
    displayName: op.type === "rename_version" ? op.displayName : undefined,
    baseContainerRevision: op.baseContainerRevision,
    baseVersionRevision: op.baseVersionRevision,
  });
}

function withSimpleVersionReceipt(
  state: PublishingDraftState,
  op: SelectPublishingVersionOperation | RenamePublishingVersionOperation,
  operationToken: string,
  now: number,
  target: ReturnType<typeof resolvePublishingActiveVersion>
): PublishingDraftState {
  const receipt: PublishingVersionOperationReceipt = {
    status: "committed", operationKind: op.type, operationToken,
    requestHash: op.requestHash ?? simpleVersionRequestHash(op),
    versionId: target.versionId, resultActiveVersionId: state.activeVersionId ?? target.versionId,
    storyId: op.storyId ?? 0, platform: target.activePlatform,
    committedAt: now, baseContainerRevision: op.baseContainerRevision,
    baseVersionRevision: op.baseVersionRevision,
  };
  return { ...state, versionOperationReceipts: boundedVersionReceipts({
    ...(state.versionOperationReceipts ?? {}), [operationToken]: receipt,
  }) };
}

function validateVersionHandshake(
  operationToken: string | undefined,
  op: CreatePublishingVersionOperation
): void {
  const hasAny = Boolean(op.requestHash || op.sourceVersionId || op.bufferDisposition || op.sourceBufferKey || op.sourceBufferHash);
  if (!hasAny) return;
  if (!operationToken || !op.requestHash || !op.sourceVersionId || !op.bufferDisposition || op.storyId == null) {
    throw new Error("Publishing version handshake requires token, hash, source version, Story and disposition");
  }
  if (op.bufferDisposition === "carry" && (!op.sourceBufferKey || !op.sourceBufferHash)) {
    throw new Error("Publishing carry handshake requires buffer key and hash");
  }
  if (
    op.bufferDisposition === "carry" &&
    op.sourceBufferKey !== publishingDraftBufferKey(op.storyId, op.platform, op.sourceVersionId)
  ) throw new Error("Publishing carry handshake buffer key does not match its Story/version/platform scope");
  if (
    op.bufferDisposition === "carry" &&
    op.sourceBufferHash !== computePublishingDraftContentHash(op.content)
  ) throw new Error("Publishing carry handshake buffer hash does not match its content");
  const expected = computePublishingVersionRequestHash({
    storyId: op.storyId, sourceVersionId: op.sourceVersionId, platform: op.platform,
    baseContainerRevision: op.baseContainerRevision, baseVersionRevision: op.baseVersionRevision,
    baseCoreRevision: op.baseCoreRevision, baseDraftRevision: op.baseDraftRevision,
    core: op.core, content: op.content, narrativeIntent: op.narrativeIntent,
    bufferDisposition: op.bufferDisposition, sourceBufferKey: op.sourceBufferKey, sourceBufferHash: op.sourceBufferHash,
  });
  if (op.requestHash !== expected) throw new Error("Publishing request hash does not match canonical payload");
}

function boundedVersionReceipts(
  receipts: PublishingDraftState["versionOperationReceipts"]
): NonNullable<PublishingDraftState["versionOperationReceipts"]> {
  const entries = Object.entries(receipts ?? {});
  const legacy = entries.filter(([, receipt]) => typeof receipt === "string");
  const completed = entries.filter(([, receipt]) => typeof receipt !== "string").slice(-128);
  return Object.fromEntries([...legacy, ...completed]);
}

export function compactPublishingTextOperations(
  operations: Record<string, PublishingTextOperationReceipt>
): Record<string, PublishingTextOperationReceipt> {
  const entries = Object.entries(operations);
  const pending = entries.filter(([, receipt]) => receipt.status === "pending");
  const terminal = entries
    .filter(([, receipt]) => receipt.status !== "pending")
    .sort(([leftToken, left], [rightToken, right]) =>
      left.updatedAt - right.updatedAt ||
      left.claimedAt - right.claimedAt ||
      leftToken.localeCompare(rightToken)
    )
    .slice(-32);
  return Object.fromEntries([...pending, ...terminal]);
}

function assertTextOperationScope(
  state: PublishingDraftState,
  receipt: PublishingTextOperationReceipt,
  baseContainerRevision: number,
  baseVersionRevision: number,
  storyId?: number
): ReturnType<typeof resolvePublishingActiveVersion> {
  if (storyId == null || receipt.scope.storyId !== storyId) {
    throw new Error("Publishing text operation Story scope does not match");
  }
  assertRevision("publishing", baseContainerRevision, state.containerRevision ?? state.revision);
  const version = state.versions?.find(candidate => candidate.versionId === receipt.scope.versionId);
  if (!version) throw new Error(`Unknown publishing version: ${receipt.scope.versionId}`);
  assertRevision("publishing", baseVersionRevision, version.versionRevision);
  assertRevision("core", receipt.scope.coreRevision, version.core?.revision ?? 0);
  assertRevision(receipt.scope.platform, receipt.scope.draftRevision, version.drafts[receipt.scope.platform]?.revision ?? 0);
  if (receipt.scope.sourcePlatform) {
    assertRevision(
      receipt.scope.sourcePlatform,
      receipt.scope.sourceDraftRevision ?? 0,
      version.drafts[receipt.scope.sourcePlatform]?.revision ?? 0
    );
  }
  assertRevision("publishing", receipt.scope.intentRevision, version.intentSnapshot?.revision ?? 0);
  const contextRevision = version.platformContexts?.[
    receipt.scope.platform as PublishingTrendPlatformId
  ]?.revision ?? 0;
  assertRevision(
    receipt.scope.platform,
    receipt.scope.contextRevision,
    contextRevision
  );
  return version;
}

function storeTextOperationReceipt(
  state: PublishingDraftState,
  versionId: string,
  receipt: PublishingTextOperationReceipt,
  now: number,
  advanceRevision: boolean
): PublishingDraftState {
  return {
    ...state,
    versions: state.versions?.map(candidate => candidate.versionId === versionId
      ? {
          ...candidate,
          versionRevision: candidate.versionRevision + 1,
          textOperations: compactPublishingTextOperations({
            ...(candidate.textOperations ?? {}),
            [receipt.operationToken]: structuredClone(receipt),
          }),
        }
      : candidate),
    revision: advanceRevision ? state.revision + 1 : state.revision,
    containerRevision: (state.containerRevision ?? 0) + 1,
    updatedAt: now,
  };
}

function attachTextOperationSettlement(
  current: PublishingDraftState,
  next: PublishingDraftState,
  receipt: PublishingTextOperationReceipt,
  baseContainerRevision: number,
  baseVersionRevision: number,
  storyId: number | undefined,
  now: number
): PublishingDraftState {
  const version = assertTextOperationScope(
    current,
    receipt,
    baseContainerRevision,
    baseVersionRevision,
    storyId
  );
  const existing = version.textOperations?.[receipt.operationToken];
  if (receipt.status === "pending") {
    throw new Error("Publishing text operation settlement must be terminal");
  }
  if (!existing || existing.status !== "pending") {
    throw new Error("Publishing text operation must have a pending claim before settlement");
  }
  if (
    existing.requestHash !== receipt.requestHash ||
    existing.kind !== receipt.kind ||
    canonicalJsonStringify(existing.scope) !== canonicalJsonStringify(receipt.scope)
  ) throw new Error("Publishing text operation settlement scope does not match its claim");
  return storeTextOperationReceipt(next, version.versionId, receipt, now, false);
}

function applyTextOperationReceipt(
  state: PublishingDraftState,
  operation: ClaimTextOperation | SettleTextOperation,
  now: number
): PublishingDraftState {
  const receipt = operation.receipt;
  const version = assertTextOperationScope(
    state,
    receipt,
    operation.baseContainerRevision,
    operation.baseVersionRevision,
    operation.storyId
  );
  const existing = version.textOperations?.[receipt.operationToken];
  if (existing && existing.requestHash !== receipt.requestHash) {
    throw new Error("Publishing text operation token was already used with a different request hash");
  }
  if (operation.type === "claim_text_operation") {
    if (receipt.status !== "pending") throw new Error("Publishing text operation claim must be pending");
    if (existing && (existing.status !== "pending" || existing.expiresAt > receipt.claimedAt)) return state;
  } else {
    return attachTextOperationSettlement(
      state,
      { ...state, revision: state.revision + 1 },
      receipt,
      operation.baseContainerRevision,
      operation.baseVersionRevision,
      operation.storyId,
      now
    );
  }
  return storeTextOperationReceipt(state, version.versionId, receipt, now, true);
}

function applyPlatformContextOperation(
  state: PublishingDraftState,
  operation: AppendPlatformContextSnapshotOperation | SelectPlatformContextTagsOperation,
  now: number
): PublishingDraftState {
  assertRevision(
    "publishing",
    operation.baseContainerRevision,
    state.containerRevision ?? state.revision
  );
  if (state.activeVersionId !== operation.versionId) {
    throw new PublishingDraftConflictError(
      "publishing",
      operation.baseContainerRevision,
      state.containerRevision ?? state.revision
    );
  }
  const version = state.versions?.find(candidate => candidate.versionId === operation.versionId);
  if (!version) throw new Error(`Unknown publishing version: ${operation.versionId}`);
  assertRevision("publishing", operation.baseVersionRevision, version.versionRevision);
  assertRevision(
    operation.platform,
    operation.baseSourceRevision,
    version.drafts[operation.platform]?.revision ?? 0
  );
  const currentContext = version.platformContexts?.[operation.platform] ??
    emptyPublishingPlatformContextState(now);
  assertRevision(
    operation.platform,
    operation.baseContextRevision,
    currentContext.revision
  );

  let nextContext;
  if (operation.type === "append_platform_context_snapshot") {
    const snapshot = operation.snapshot;
    if (!isPersistablePublishingContextSnapshot(snapshot)) {
      throw new Error("Only verified context snapshots may be persisted");
    }
    if (
      snapshot.versionId !== operation.versionId ||
      snapshot.platform !== operation.platform ||
      snapshot.sourceRevision !== operation.baseSourceRevision ||
      snapshot.revision !== currentContext.revision + 1
    ) {
      throw new Error("Publishing context snapshot scope does not match its version/platform revision");
    }
    nextContext = appendPublishingPlatformContextSnapshot(currentContext, snapshot, now);
  } else {
    nextContext = selectPublishingPlatformContextTags(currentContext, {
      snapshotId: operation.snapshotId,
      candidateIds: operation.candidateIds,
      contentTags: operation.contentTags,
      now,
    });
  }

  return {
    ...state,
    revision: state.revision + 1,
    containerRevision: (state.containerRevision ?? 0) + 1,
    versions: state.versions?.map(candidate => candidate.versionId === operation.versionId
      ? {
          ...candidate,
          versionRevision: candidate.versionRevision + 1,
          platformContexts: {
            ...(candidate.platformContexts ?? {}),
            [operation.platform]: nextContext,
          },
        }
      : candidate),
    updatedAt: now,
  };
}

const storyWriteTails = new Map<string, Promise<void>>();

async function withStoryWriteLock<T>(
  key: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = storyWriteTails.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  storyWriteTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (storyWriteTails.get(key) === tail) storyWriteTails.delete(key);
  }
}

function assertRevision(
  scope: "publishing" | "core" | PublishingPlatformId,
  expected: number,
  actual: number
): void {
  if (expected !== actual) {
    throw new PublishingDraftConflictError(scope, expected, actual);
  }
}

function normalizeSelection(
  activePlatform: PublishingPlatformId,
  selectedPlatforms: PublishingPlatformId[]
): PublishingPlatformId[] {
  if (!isPublishingPlatformId(activePlatform)) {
    throw new Error(
      `Unsupported publishing platform: ${String(activePlatform)}`
    );
  }
  const selected = Array.from(
    new Set(selectedPlatforms.filter(isPublishingPlatformId))
  );
  if (!selected.includes(activePlatform)) selected.unshift(activePlatform);
  return selected;
}

function appendAlbumReceipt(
  album: PublishingAlbumAggregate,
  input: PublishingAlbumAggregate["operationReceipts"][string]
): PublishingAlbumAggregate {
  const entries = Object.entries({
    ...album.operationReceipts,
    [input.operationToken]: input,
  }).sort((left, right) => left[1].completedAt - right[1].completedAt);
  return {
    ...album,
    operationReceipts: Object.fromEntries(
      entries.slice(-PUBLISHING_ALBUM_MAX_OPERATION_RECEIPTS)
    ),
  };
}

function applyAlbumOperation(
  current: PublishingDraftState,
  operation:
    | InitializePublishingAlbumOperation
    | UpdatePublishingAlbumPageTextOperation
    | UpdatePublishingAlbumPageTypographyOperation,
  now: number,
  operationToken?: string
): PublishingDraftState {
  const token = operationToken?.trim();
  if (!token) throw new Error("画册写入缺少幂等操作标识");
  const versions = current.versions ?? [];
  const target = versions.find(version => version.versionId === operation.versionId);
  if (!target) throw new Error("画册版本不存在或已切换");
  const existingReceipt = target.album?.operationReceipts[token];
  if (existingReceipt) {
    if (existingReceipt.requestHash !== operation.requestHash) {
      throw new Error("画册操作标识已用于不同请求");
    }
    return current;
  }

  let nextAlbum: PublishingAlbumAggregate;
  if (operation.type === "initialize_album") {
    assertRevision(
      "publishing",
      operation.baseContainerRevision,
      current.containerRevision ?? current.revision
    );
    assertRevision("publishing", operation.baseVersionRevision, target.versionRevision);
    if (target.album) {
      if (target.album.source.contentHash !== operation.album.source.contentHash) {
        throw new Error("当前版本已经有画册；正文变化请创建新发布版本");
      }
      nextAlbum = appendAlbumReceipt(target.album, {
        operationToken: token,
        requestHash: operation.requestHash,
        kind: "initialize",
        pageId: null,
        resultRevision: target.album.revision,
        completedAt: now,
      });
    } else {
      const normalized = normalizePublishingAlbumAggregate(operation.album, now);
      if (!normalized) throw new Error("画册草稿不符合持久化约束");
      nextAlbum = appendAlbumReceipt(normalized, {
        operationToken: token,
        requestHash: operation.requestHash,
        kind: "initialize",
        pageId: null,
        resultRevision: normalized.revision,
        completedAt: now,
      });
    }
  } else {
    if (!target.album) throw new Error("当前版本还没有画册草稿");
    const pageIndex = target.album.pages.findIndex(page => page.pageId === operation.pageId);
    if (pageIndex < 0) throw new Error("画册页面不存在或已经更新");
    const page = target.album.pages[pageIndex];
    let nextPage = page;
    if (operation.type === "update_album_page_text") {
      if (operation.baseTextRevision !== page.textRevision) {
        throw new PublishingDraftConflictError(
          "publishing",
          operation.baseTextRevision,
          page.textRevision
        );
      }
      if (publishingAlbumCodePointCount(operation.text) > PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS) {
        throw new Error(`单页文字不能超过 ${PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS} 个字符`);
      }
      nextPage = {
        ...page,
        revision: page.revision + 1,
        textRevision: page.textRevision + 1,
        text: operation.text,
        sourceStale: operation.text !== page.text,
        typography: null,
        typographyRevision: page.typographyRevision + (page.typography ? 1 : 0),
        updatedAt: now,
      };
    } else {
      if (operation.baseTextRevision !== page.textRevision) {
        throw new PublishingDraftConflictError(
          "publishing",
          operation.baseTextRevision,
          page.textRevision
        );
      }
      if (operation.baseTypographyRevision !== page.typographyRevision) {
        throw new PublishingDraftConflictError(
          "publishing",
          operation.baseTypographyRevision,
          page.typographyRevision
        );
      }
      const typography = normalizePublishingAlbumTypographyLayout(operation.typography);
      if (!typography) throw new Error("文字排版路径无效，请重新绘制");
      nextPage = {
        ...page,
        revision: page.revision + 1,
        typographyRevision: page.typographyRevision + 1,
        typography,
        updatedAt: now,
      };
    }
    const pages = target.album.pages.map((candidate, index) =>
      index === pageIndex ? nextPage : candidate
    );
    const baseAlbum = {
      ...target.album,
      revision: target.album.revision + 1,
      status: pages.every(candidate =>
        candidate.adoptedBackgroundAssetId != null && candidate.typography != null
      ) ? "ready" as const : "draft" as const,
      pages,
      updatedAt: now,
    };
    nextAlbum = appendAlbumReceipt(baseAlbum, {
      operationToken: token,
      requestHash: operation.requestHash,
      kind: operation.type === "update_album_page_text" ? "update_text" : "update_typography",
      pageId: operation.pageId,
      resultRevision: baseAlbum.revision,
      completedAt: now,
    });
  }

  const nextVersionRevision = target.versionRevision + 1;
  return {
    ...current,
    revision: current.revision + 1,
    containerRevision: (current.containerRevision ?? current.revision) + 1,
    versions: versions.map(version =>
      version.versionId === target.versionId
        ? { ...version, versionRevision: nextVersionRevision, album: nextAlbum }
        : version
    ),
    updatedAt: now,
  };
}

function applyAlbumBackgroundOperation(
  current: PublishingDraftState,
  operation:
    | ClaimPublishingAlbumBackgroundOperation
    | UpdatePublishingAlbumBackgroundOperation
    | CompletePublishingAlbumBackgroundOperation
    | AdoptPublishingAlbumBackgroundOperation,
  now: number,
  writeOperationToken?: string
): PublishingDraftState {
  const versions = current.versions ?? [];
  const target = versions.find(version => version.versionId === operation.versionId);
  if (!target?.album) throw new Error("当前版本还没有画册草稿");
  const pageIndex = target.album.pages.findIndex(page => page.pageId === operation.pageId);
  if (pageIndex < 0) throw new Error("画册页面不存在或已经更新");
  const page = target.album.pages[pageIndex]!;
  let nextPage = page;
  let receipt: PublishingAlbumAggregate["operationReceipts"][string] | null = null;

  if (operation.type === "claim_album_background") {
    if (page.backgroundRevision !== operation.baseBackgroundRevision) {
      throw new PublishingDraftConflictError(
        "publishing",
        operation.baseBackgroundRevision,
        page.backgroundRevision
      );
    }
    const completedReceipt = target.album.operationReceipts[operation.generation.operationToken];
    if (completedReceipt) {
      if (completedReceipt.requestHash !== operation.generation.requestHash) {
        throw new Error("画册操作标识已用于不同请求");
      }
      return current;
    }
    if (
      page.backgroundGeneration &&
      page.backgroundGeneration.status !== "completed" &&
      page.backgroundGeneration.status !== "failed"
    ) {
      if (
        page.backgroundGeneration.operationToken === operation.generation.operationToken &&
        page.backgroundGeneration.requestHash === operation.generation.requestHash
      ) return current;
      throw new Error("这一页已有未结算的底图任务，请先恢复原任务");
    }
    if (
      operation.generation.versionId !== operation.versionId ||
      operation.generation.pageId !== operation.pageId
    ) throw new Error("底图任务作用域与当前页面不一致");
    nextPage = {
      ...page,
      revision: page.revision + 1,
      backgroundRevision: page.backgroundRevision + 1,
      backgroundGeneration: operation.generation,
      updatedAt: now,
    };
  } else if (operation.type === "update_album_background") {
    const generation = page.backgroundGeneration;
    if (!generation || generation.operationToken !== operation.operationToken) {
      throw new Error("找不到可恢复的画册底图任务");
    }
    if (generation.status === "completed") {
      return current;
    }
    if (operation.taskId && generation.taskId && operation.taskId !== generation.taskId) {
      throw new Error("底图任务编号一经确认不可替换");
    }
    nextPage = {
      ...page,
      backgroundGeneration: {
        ...generation,
        ...(operation.taskId !== undefined ? { taskId: operation.taskId } : {}),
        ...(operation.status !== undefined ? { status: operation.status } : {}),
        ...(operation.error !== undefined
          ? operation.error.trim()
            ? { error: operation.error.trim().slice(0, 2_000) }
            : { error: undefined }
          : {}),
        ...(operation.expiresAt !== undefined ? { expiresAt: operation.expiresAt } : {}),
        updatedAt: now,
      },
      updatedAt: now,
    };
  } else if (operation.type === "complete_album_background") {
    const generation = page.backgroundGeneration;
    if (!generation || generation.operationToken !== operation.operationToken) {
      throw new Error("找不到待完成的画册底图任务");
    }
    if (generation.requestHash !== operation.round.requestHash) {
      throw new Error("底图候选与原付费请求不一致");
    }
    if (page.backgroundRounds.length >= PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE) {
      throw new Error(`单页底图候选轮次不能超过 ${PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE}`);
    }
    if (
      operation.round.assetIds.length < 1 ||
      operation.round.assetIds.length > PUBLISHING_ALBUM_MAX_CANDIDATES_PER_ROUND ||
      new Set(operation.round.assetIds).size !== operation.round.assetIds.length
    ) throw new Error("底图候选数量或资产编号无效");
    const round: PublishingAlbumBackgroundRound = {
      ...operation.round,
      stale:
        operation.round.stale ||
        (generation.inputSnapshot.pageRevision !== page.revision - 1 &&
          generation.inputSnapshot.pageRevision !== page.revision) ||
        generation.inputSnapshot.pageTextHash !== publishingAlbumValueHash(page.text) ||
        generation.inputSnapshot.coverAssetId !== target.cover?.assetId,
    };
    nextPage = {
      ...page,
      revision: page.revision + 1,
      backgroundRevision: page.backgroundRevision + 1,
      backgroundRounds: [...page.backgroundRounds, round],
      backgroundGeneration: { ...generation, status: "completed", updatedAt: now },
      updatedAt: now,
    };
    receipt = {
      operationToken: operation.operationToken,
      requestHash: generation.requestHash,
      kind: "background",
      pageId: page.pageId,
      resultRevision: target.album.revision + 1,
      completedAt: now,
    };
  } else {
    const token = writeOperationToken?.trim();
    if (!token) throw new Error("采用底图缺少幂等操作标识");
    const existingReceipt = target.album.operationReceipts[token];
    if (existingReceipt) {
      if (existingReceipt.requestHash !== operation.requestHash) {
        throw new Error("画册操作标识已用于不同请求");
      }
      return current;
    }
    if (page.backgroundRevision !== operation.baseBackgroundRevision) {
      throw new PublishingDraftConflictError(
        "publishing",
        operation.baseBackgroundRevision,
        page.backgroundRevision
      );
    }
    if (!page.backgroundRounds.some(round => round.assetIds.includes(operation.assetId))) {
      throw new Error("选择的底图不属于这一页的候选轮次");
    }
    nextPage = {
      ...page,
      revision: page.revision + 1,
      backgroundRevision: page.backgroundRevision + 1,
      adoptedBackgroundAssetId: operation.assetId,
      updatedAt: now,
    };
    receipt = {
      operationToken: token,
      requestHash: operation.requestHash,
      kind: "adopt_background",
      pageId: page.pageId,
      resultRevision: target.album.revision + 1,
      completedAt: now,
    };
  }

  const pages = target.album.pages.map((candidate, index) =>
    index === pageIndex ? nextPage : candidate
  );
  let nextAlbum: PublishingAlbumAggregate = {
    ...target.album,
    revision: target.album.revision + 1,
    status: pages.every(candidate =>
      candidate.adoptedBackgroundAssetId != null && candidate.typography != null
    ) ? "ready" : "draft",
    pages,
    updatedAt: now,
  };
  if (receipt) nextAlbum = appendAlbumReceipt(nextAlbum, receipt);
  return {
    ...current,
    revision: current.revision + 1,
    containerRevision: (current.containerRevision ?? current.revision) + 1,
    versions: versions.map(version =>
      version.versionId === target.versionId
        ? { ...version, versionRevision: version.versionRevision + 1, album: nextAlbum }
        : version
    ),
    updatedAt: now,
  };
}

function applyOperation(
  current: PublishingDraftState,
  operation: PublishingDraftWriteOperation,
  now: number,
  operationToken?: string,
  preVersionIntent?: unknown
): PublishingDraftState {
  switch (operation.type) {
    case "initialize_album":
    case "update_album_page_text":
    case "update_album_page_typography":
      return applyAlbumOperation(current, operation, now, operationToken);
    case "claim_album_background":
    case "update_album_background":
    case "complete_album_background":
    case "adopt_album_background":
      return applyAlbumBackgroundOperation(current, operation, now, operationToken);
    case "initialize": {
      assertRevision(
        "publishing",
        operation.basePublishingRevision,
        current.revision
      );
      const next = confirmPublishingCoreChange(current, {
        platform: operation.activePlatform,
        nextCore: operation.core,
        activeDraftContent: operation.content,
        now,
      });
      const initialized = {
        ...next,
        selectedPlatforms: normalizeSelection(
          operation.activePlatform,
          operation.selectedPlatforms
        ),
      };
      const activeVersionId = initialized.activeVersionId;
      const shouldFreezeIntent = !hasPersistedPublishingVersion(current);
      const freezeSource = preVersionIntent ?? operation.narrativeIntent;
      const withIntent = {
        ...initialized,
        versions: initialized.versions?.map(version =>
          version.versionId === activeVersionId
            ? {
                ...version,
                narrativeIntent: operation.narrativeIntent
                  ? structuredClone(operation.narrativeIntent)
                  : version.narrativeIntent,
                intentSnapshot: shouldFreezeIntent
                  ? storyIntentProfileFromLegacy(freezeSource as Record<string, unknown>, {
                      source: "version_snapshot",
                      now,
                    }) ?? version.intentSnapshot
                  : version.intentSnapshot,
              }
            : version
        ),
      };
      if (!operation.textOperationReceipt) return withIntent;
      if (operation.baseContainerRevision == null || operation.baseVersionRevision == null) {
        throw new Error("Publishing text completion requires container and version revisions");
      }
      return attachTextOperationSettlement(
        current,
        withIntent,
        operation.textOperationReceipt,
        operation.baseContainerRevision,
        operation.baseVersionRevision,
        operation.storyId,
        now
      );
    }
    case "upsert_draft": {
      assertRevision(
        operation.platform,
        operation.baseDraftRevision,
        current.drafts[operation.platform]?.revision ?? 0
      );
      const next = upsertPublishingPlatformDraft(current, {
        platform: operation.platform,
        content: operation.content,
        activate: operation.activate ?? true,
        now,
      });
      if (!operation.textOperationReceipt) return next;
      if (operation.baseContainerRevision == null || operation.baseVersionRevision == null) {
        throw new Error("Publishing text completion requires container and version revisions");
      }
      return attachTextOperationSettlement(
        current,
        next,
        operation.textOperationReceipt,
        operation.baseContainerRevision,
        operation.baseVersionRevision,
        operation.storyId,
        now
      );
    }
    case "apply_wording": {
      assertRevision(
        operation.platform,
        operation.baseDraftRevision,
        current.drafts[operation.platform]?.revision ?? 0
      );
      return applyPublishingWordingEdit(
        current,
        operation.platform,
        operation.content,
        now
      );
    }
    case "confirm_core_change": {
      throw new Error("Core changes require a version transition");
    }
    case "claim_text_operation":
    case "settle_text_operation": {
      return applyTextOperationReceipt(current, operation, now);
    }
    case "append_platform_context_snapshot":
    case "select_platform_context_tags": {
      return applyPlatformContextOperation(current, operation, now);
    }
    case "set_selection": {
      assertRevision(
        "publishing",
        operation.basePublishingRevision,
        current.revision
      );
      return {
        ...current,
        revision: current.revision + 1,
        activePlatform: operation.activePlatform,
        selectedPlatforms: normalizeSelection(
          operation.activePlatform,
          operation.selectedPlatforms
        ),
        updatedAt: now,
      };
    }
    case "append_cover_round": {
      assertRevision(
        "publishing",
        operation.basePublishingRevision,
        current.revision
      );
      return appendPublishingCoverRound(current, operation.round, now);
    }
    case "claim_cover_generation": {
      assertRevision(
        "publishing",
        operation.basePublishingRevision,
        current.revision
      );
      const existing = current.coverGeneration;
      if (existing?.operationToken === operation.generation.operationToken) {
        return current;
      }
      if (existing?.status === "pending" && existing.expiresAt > now) {
        throw new PublishingDraftConflictError(
          "publishing",
          operation.basePublishingRevision,
          current.revision
        );
      }
      if (operation.generation.versionId !== current.activeVersionId) {
        throw new Error("封面生成属于另一个文字稿版本");
      }
      return {
        ...current,
        revision: current.revision + 1,
        coverGeneration: operation.generation,
        updatedAt: now,
      };
    }
    case "update_cover_generation": {
      const existing = current.coverGeneration;
      if (!existing || existing.operationToken !== operation.operationToken) {
        throw new Error("封面生成操作不存在或已被替换");
      }
      if (existing.versionId !== current.activeVersionId) {
        throw new Error("封面生成属于另一个文字稿版本");
      }
      return {
        ...current,
        revision: current.revision + 1,
        coverGeneration: {
          ...existing,
          ...(operation.taskId !== undefined ? { taskId: operation.taskId } : {}),
          ...(operation.status ? { status: operation.status } : {}),
          ...(operation.error !== undefined ? { error: operation.error } : {}),
          ...(operation.expiresAt !== undefined
            ? { expiresAt: operation.expiresAt }
            : {}),
          updatedAt: now,
        },
        updatedAt: now,
      };
    }
    case "complete_cover_generation": {
      const existing = current.coverGeneration;
      if (!existing || existing.operationToken !== operation.operationToken) {
        throw new Error("封面生成操作不存在或已被替换");
      }
      if (existing.versionId !== current.activeVersionId) {
        throw new Error("封面生成属于另一个文字稿版本");
      }
      const withRound = current.coverRounds.some(
        round => round.id === operation.round.id
      )
        ? current
        : appendPublishingCoverRound(current, operation.round, now);
      return {
        ...withRound,
        revision:
          withRound === current ? current.revision + 1 : withRound.revision,
        coverGeneration: {
          ...existing,
          status: "completed",
          error: undefined,
          updatedAt: now,
          expiresAt: now,
        },
        updatedAt: now,
      };
    }
    case "set_cover": {
      assertRevision(
        "publishing",
        operation.basePublishingRevision,
        current.revision
      );
      return {
        ...current,
        revision: current.revision + 1,
        cover: operation.cover,
        updatedAt: now,
      };
    }
    case "create_version":
    case "select_version":
    case "rename_version":
      return applyVersionOperation(current, operation, now, operationToken);
  }
}

export async function getPublishingDraftState(
  storyId: number,
  userId: number
): Promise<PublishingDraftPersistenceResult> {
  const story = await getStoryById(storyId, userId);
  if (!story) throw new PublishingDraftOwnershipError(storyId);
  const body =
    story.body && typeof story.body === "object" && !Array.isArray(story.body)
      ? (story.body as Record<string, unknown>)
      : {};
  return {
    storyId,
    storyRevision: getStoryRevision(body),
    publishing: normalizeStoredPublishing(body.publishing),
  };
}

export async function writePublishingDraftState(params: {
  storyId: number;
  userId: number;
  operation: PublishingDraftWriteOperation | PublishingVersionOperation;
  now?: number;
  operationToken?: string;
}): Promise<PublishingDraftPersistenceResult> {
  return withStoryWriteLock(`${params.userId}:${params.storyId}`, async () => {
    const story = await getStoryById(params.storyId, params.userId);
    if (!story) throw new PublishingDraftOwnershipError(params.storyId);
    const body =
      story.body && typeof story.body === "object" && !Array.isArray(story.body)
        ? (story.body as Record<string, unknown>)
        : {};
    const rawPublishing = body.publishing;
    const normalized = normalizeStoredPublishing(rawPublishing);
    const current = projectVersion(normalized, normalized.activeVersionId ?? "v1");
    const operation = { ...params.operation, storyId: params.storyId } as PublishingDraftWriteOperation;
    const incomingTextReceipt = operation.type === "claim_text_operation" || operation.type === "settle_text_operation"
      ? operation.receipt
      : operation.type === "initialize" || operation.type === "upsert_draft"
        ? operation.textOperationReceipt
        : undefined;
    if (incomingTextReceipt && incomingTextReceipt.scope.storyId !== params.storyId) {
      throw new Error("Publishing text operation Story scope does not match");
    }
    const storedTextReceipt = incomingTextReceipt
      ? current.versions?.find(version => version.versionId === incomingTextReceipt.scope.versionId)
          ?.textOperations?.[incomingTextReceipt.operationToken]
      : undefined;
    if (operation.type === "append_platform_context_snapshot") {
      const storedSnapshot = current.versions
        ?.find(version => version.versionId === operation.versionId)
        ?.platformContexts?.[operation.platform]
        ?.snapshots.find(snapshot => snapshot.snapshotId === operation.snapshot.snapshotId);
      if (storedSnapshot) {
        if (canonicalJsonStringify(storedSnapshot) !== canonicalJsonStringify(operation.snapshot)) {
          throw new Error("Publishing platform context snapshot id already has different content");
        }
        return {
          storyId: params.storyId,
          storyRevision: getStoryRevision(body),
          publishing: current,
        };
      }
    }
    if (storedTextReceipt && storedTextReceipt.requestHash !== incomingTextReceipt?.requestHash) {
      throw new Error("Publishing text operation token was already used with a different request hash");
    }
    if (
      storedTextReceipt &&
      (((operation.type === "initialize" || operation.type === "upsert_draft") && storedTextReceipt.status !== "pending") ||
        (operation.type === "claim_text_operation" &&
        (storedTextReceipt.status !== "pending" || storedTextReceipt.expiresAt > incomingTextReceipt!.claimedAt)) ||
        (operation.type === "settle_text_operation" && storedTextReceipt.status !== "pending"))
    ) {
      return {
        storyId: params.storyId,
        storyRevision: getStoryRevision(body),
        publishing: current,
        textOperationReceipt: storedTextReceipt,
      };
    }
    if (operation.type === "create_version") validateVersionHandshake(params.operationToken, operation);
    if (operation.type === "select_version" || operation.type === "rename_version") {
      const expectedHash = simpleVersionRequestHash(operation);
      if (operation.requestHash && operation.requestHash !== expectedHash) {
        throw new Error("Publishing request hash does not match canonical payload");
      }
    }
    const incomingHash = operation.type === "create_version"
      ? operation.requestHash
      : operation.type === "select_version" || operation.type === "rename_version"
        ? operation.requestHash ?? simpleVersionRequestHash(operation)
        : undefined;
    const storedReceipt = params.operationToken
      ? current.versionOperationReceipts?.[params.operationToken]
      : undefined;
    if (storedReceipt && typeof storedReceipt === "string" && incomingHash) {
      throw new Error("Legacy publishing receipt has no request hash and cannot verify this retry");
    }
    if (
      storedReceipt && typeof storedReceipt !== "string" &&
      incomingHash && storedReceipt.requestHash !== incomingHash
    ) throw new Error("Publishing operation token was already used with a different request hash");
    const receiptVersionId = typeof storedReceipt === "string" ? storedReceipt : storedReceipt?.versionId;
    if (
      receiptVersionId &&
      current.versions?.some(version => version.versionId === receiptVersionId)
    ) {
      return {
        storyId: params.storyId,
        storyRevision: getStoryRevision(body),
        publishing: projectVersion(
          current,
          typeof storedReceipt === "string"
            ? receiptVersionId
            : storedReceipt!.resultActiveVersionId
        ),
        committedReceipt:
          typeof storedReceipt === "string" ? undefined : storedReceipt,
      };
    }
    if (operation.type === "create_version" && operation.bufferDisposition === "cancel") {
      return { storyId: params.storyId, storyRevision: getStoryRevision(body), publishing: current };
    }
    const now = params.now ?? Date.now();
    const publishing = canonicalize(
      applyOperation(current, operation, now, params.operationToken, body.confirmedIntent)
    );
    inspectPublishingSerializedOutput(publishing);
    if (!inspectPublishingProjection(publishing).equivalent) {
      throw new Error("Publishing canonical projection mismatch");
    }
    assertPublishingCapacity(publishing);
    const expectedStoryRevision = getStoryRevision(body);
    const storyRevision = expectedStoryRevision + 1;
    // prepareStoryBody protects publishing as a server-owned field. Supplying
    // the updated body on both sides marks this dedicated operation as the one
    // authoritative writer while retaining every other Story field.
    const bodyWithPublishing = { ...body, publishing };
    const nextBody = prepareStoryBody(
      bodyWithPublishing,
      storyRevision,
      bodyWithPublishing
    );
    assertStoryCapacity(nextBody);
    try {
      await persistPreparedStoryBody({
        storyId: params.storyId,
        userId: params.userId,
        expectedRevision: expectedStoryRevision,
        body: nextBody,
      });
    } catch (error) {
      if (error instanceof StoryBodyRevisionConflictError) {
        throw new PublishingDraftConflictError(
          "publishing",
          expectedStoryRevision,
          getStoryRevision(error.latestStory.body)
        );
      }
      throw error;
    }
    const committed = params.operationToken
      ? publishing.versionOperationReceipts?.[params.operationToken]
      : undefined;
    const committedTextReceipt = incomingTextReceipt
      ? publishing.versions?.find(version => version.versionId === incomingTextReceipt.scope.versionId)
          ?.textOperations?.[incomingTextReceipt.operationToken]
      : undefined;
    return {
      storyId: params.storyId,
      storyRevision,
      publishing,
      committedReceipt:
        committed && typeof committed !== "string" ? committed : undefined,
      textOperationReceipt: committedTextReceipt,
    };
  });
}

export const getActivePublishingVersion = resolvePublishingActiveVersion;
