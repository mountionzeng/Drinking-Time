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
  type PublishingStoryCoreContent,
  hasPersistedPublishingVersion,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";
import { createHash } from "node:crypto";
import { storyIntentProfileFromLegacy } from "../../shared/storyIntentProfile";
import { getStoryById } from "../db";
import { derivePublishingVersionDisplayName } from "../../shared/textTitle";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { getStoryRevision, prepareStoryBody } from "./storySync";

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
};

type UpsertDraftOperation = {
  type: "upsert_draft";
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  baseDraftRevision: number;
  activate?: boolean;
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
};
export type SelectPublishingVersionOperation = {
  type: "select_version";
  versionId: string;
  baseContainerRevision: number;
  baseVersionRevision?: number;
};
export type RenamePublishingVersionOperation = {
  type: "rename_version";
  versionId: string;
  displayName: string;
  baseContainerRevision: number;
  baseVersionRevision?: number;
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function publishingProjectionHash(state: PublishingDraftState): string {
  const active = resolvePublishingActiveVersion(state);
  return `sha256:${createHash("sha256").update(stableJson({
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
  return stableJson({
    core: state.core, drafts: state.drafts, activePlatform: state.activePlatform,
    selectedPlatforms: state.selectedPlatforms, cover: state.cover, coverRounds: state.coverRounds,
    coverGeneration: state.coverGeneration ?? null,
  }) === stableJson({
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
    return {
      ...projectVersion(state, op.versionId),
      revision: state.revision + 1,
      containerRevision: (state.containerRevision ?? 0) + 1,
      updatedAt: now,
    };
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
    return {
      ...state,
      versions: versions.map(v =>
        v.versionId === op.versionId
          ? { ...v, displayName: op.displayName.trim() || v.displayName }
          : v
      ),
      containerRevision: (state.containerRevision ?? 0) + 1,
      revision: state.revision + 1,
      updatedAt: now,
    };
  }
  assertRevision("core", op.baseCoreRevision, state.core?.revision ?? 0);
  assertRevision(
    op.platform,
    op.baseDraftRevision,
    state.drafts[op.platform]?.revision ?? 0
  );
  const parent = resolvePublishingActiveVersion(state);
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
    conversationSnapshot: op.conversationSnapshot
      ? structuredClone(op.conversationSnapshot)
      : parent.conversationSnapshot
        ? structuredClone(parent.conversationSnapshot)
        : null,
    videoStoryboard: null,
    narrativeIntent: op.narrativeIntent
      ? structuredClone(op.narrativeIntent)
      : structuredClone(parent.narrativeIntent),
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
      ? {
          ...(state.versionOperationReceipts ?? {}),
          [operationToken]: versionId,
        }
      : state.versionOperationReceipts,
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

function applyOperation(
  current: PublishingDraftState,
  operation: PublishingDraftWriteOperation,
  now: number,
  operationToken?: string,
  preVersionIntent?: unknown
): PublishingDraftState {
  switch (operation.type) {
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
      return {
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
    }
    case "upsert_draft": {
      assertRevision(
        operation.platform,
        operation.baseDraftRevision,
        current.drafts[operation.platform]?.revision ?? 0
      );
      return upsertPublishingPlatformDraft(current, {
        platform: operation.platform,
        content: operation.content,
        activate: operation.activate ?? true,
        now,
      });
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
      assertRevision(
        "core",
        operation.baseCoreRevision,
        current.core?.revision ?? 0
      );
      assertRevision(
        operation.platform,
        operation.baseDraftRevision,
        current.drafts[operation.platform]?.revision ?? 0
      );
      return confirmPublishingCoreChange(current, {
        platform: operation.platform,
        nextCore: operation.core,
        activeDraftContent: operation.content,
        now,
      });
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
    const receiptVersionId = params.operationToken
      ? current.versionOperationReceipts?.[params.operationToken]
      : undefined;
    if (
      receiptVersionId &&
      current.versions?.some(version => version.versionId === receiptVersionId)
    ) {
      return {
        storyId: params.storyId,
        storyRevision: getStoryRevision(body),
        publishing: current,
      };
    }
    const now = params.now ?? Date.now();
    const publishing = canonicalize(
      applyOperation(current, params.operation, now, params.operationToken, body.confirmedIntent)
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
    return { storyId: params.storyId, storyRevision, publishing };
  });
}

export const getActivePublishingVersion = resolvePublishingActiveVersion;
