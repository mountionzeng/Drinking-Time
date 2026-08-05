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
  type PublishingStoryCoreContent,
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
  | SetCoverOperation;

export type PublishingDraftPersistenceResult = {
  storyId: number;
  storyRevision: number;
  publishing: PublishingDraftState;
};

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
  now: number
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
  operation: PublishingDraftWriteOperation;
  now?: number;
}): Promise<PublishingDraftPersistenceResult> {
  return withStoryWriteLock(`${params.userId}:${params.storyId}`, async () => {
    const story = await getStoryById(params.storyId, params.userId);
    if (!story) throw new PublishingDraftOwnershipError(params.storyId);
    const body =
      story.body && typeof story.body === "object" && !Array.isArray(story.body)
        ? (story.body as Record<string, unknown>)
        : {};
    const current = normalizePublishingDraftState(body.publishing);
    const now = params.now ?? Date.now();
    const publishing = applyOperation(current, params.operation, now);
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
