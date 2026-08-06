import {
  confirmPublishingCoreChange,
  isPublishingPlatformId,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
  applyPublishingWordingEdit,
  appendPublishingCoverRound,
  type PublishingCoverReference,
  type PublishingCoverRound,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformId,
  type PublishingConversationSnapshot,
  type PublishingStoryCoreContent,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";
import { getStoryById, updateStory } from "../db";
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

export type PublishingDraftWriteOperation =
  | InitializeOperation
  | UpsertDraftOperation
  | ApplyWordingOperation
  | ConfirmCoreOperation
  | SetSelectionOperation
  | AppendCoverRoundOperation
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

function canonicalize(state: PublishingDraftState): PublishingDraftState {
  const versions = state.versions ?? [];
  const active = resolvePublishingActiveVersion(state);
  return {
    ...state,
    activeVersionId: active.versionId,
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
  };
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
    displayName: op.displayName?.trim() || `V${nextSequence}`,
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
    conversationSnapshot: op.conversationSnapshot
      ? structuredClone(op.conversationSnapshot)
      : parent.conversationSnapshot
        ? structuredClone(parent.conversationSnapshot)
        : null,
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
  operationToken?: string
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
      return {
        ...next,
        selectedPlatforms: normalizeSelection(
          operation.activePlatform,
          operation.selectedPlatforms
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
    publishing: normalizePublishingDraftState(body.publishing),
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
    const current = normalizePublishingDraftState(body.publishing);
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
      applyOperation(current, params.operation, now, params.operationToken)
    );
    const storyRevision = getStoryRevision(body) + 1;
    // prepareStoryBody protects publishing as a server-owned field. Supplying
    // the updated body on both sides marks this dedicated operation as the one
    // authoritative writer while retaining every other Story field.
    const bodyWithPublishing = { ...body, publishing };
    const nextBody = prepareStoryBody(
      bodyWithPublishing,
      storyRevision,
      bodyWithPublishing
    );
    await updateStory(params.storyId, params.userId, { body: nextBody });
    return { storyId: params.storyId, storyRevision, publishing };
  });
}

export const getActivePublishingVersion = resolvePublishingActiveVersion;
