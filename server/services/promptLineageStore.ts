import {
  compilePromptTargets,
  type CompiledPromptTarget,
} from "../../shared/promptCompiler";
import {
  createEmptyPromptLineageLocalState,
  normalizePromptLineageLocalState,
  type PromptCompilation,
  type PromptCompilationHead,
  type PromptLineageLocalState,
  type PromptLineageOwner,
  type PromptModality,
  type PromptNode,
  type PromptNodeBinding,
  type PromptRevision,
  type PromptRevisionAuthor,
  type PromptRevisionStatus,
  type PromptScope,
  type PromptMigrationStatus,
  type StoryConversation,
  type StoryConversationMessage,
  type StoryMessageReference,
  type StoryArtPromptBinding,
  type StoryPromptAggregate,
  type StoryPromptState,
} from "../../shared/promptLineage";
import {
  normalizePromptWeight,
  promptDimensionWeight,
} from "../../shared/promptDimensionWeights";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  promptCompilationHeads,
  promptCompilationInputs,
  promptCompilations,
  promptNodeBindings,
  promptNodes,
  promptOperationReceipts,
  promptRevisions,
  storyArtPromptBindings,
  storyConversationMessages,
  storyConversations,
  storyMessageReferences,
  storyPromptStates,
} from "../../drizzle/schema";
import {
  getDb,
  getLocalPromptLineageState,
  replaceLocalPromptLineageState,
} from "../db";

export class PromptLineageConflictError extends Error {
  constructor(
    message: string,
    readonly currentVersion: number,
  ) {
    super(message);
    this.name = "PromptLineageConflictError";
  }
}

export class PromptLineageOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptLineageOwnershipError";
  }
}

export class PromptLineageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptLineageValidationError";
  }
}

type TransactionOptions = PromptLineageOwner & {
  expectedVersion: number;
  operationKey: string;
};

type CreateNodeInput = {
  stableShotId?: string | null;
  scope: PromptScope;
  modality: PromptModality;
  dimension: string;
};

type CreateRevisionInput = {
  nodeId: number;
  parentRevisionId?: number | null;
  content: string;
  weight?: number;
  authorType: PromptRevisionAuthor;
  authorUserId?: number | null;
  reason?: string | null;
  source?: string | null;
  status?: PromptRevisionStatus;
};

type CreateBindingInput = {
  nodeId: number;
  stableShotId?: string | null;
  modality: PromptModality;
  sortOrder: number;
};

type CreateCompilationInput = {
  stableShotId: string;
  modality: Exclude<PromptModality, "shared">;
  finalText: string;
  inputFingerprint: string;
  revisionIds: number[];
};

export type AppendMessageInput = {
  role: StoryConversationMessage["role"];
  content: string;
  source?: string | null;
  clientMessageId?: string | null;
  candidateRevisionId?: number | null;
};

export type AddMessageReferenceInput = {
  messageId: number;
  objectType: string;
  objectId: string;
  objectVersion?: string | null;
  selection?: unknown;
};

export type AppendConversationTurnInput = {
  messages: Array<
    AppendMessageInput & {
      reference?: Omit<AddMessageReferenceInput, "messageId"> | null;
    }
  >;
};

export type AppendConversationTurnResult = {
  conversation: StoryConversation;
  messages: StoryConversationMessage[];
  references: StoryMessageReference[];
};

export type PromptLineageTransaction = {
  setMigrationStatus(status: PromptMigrationStatus): void;
  createNode(input: CreateNodeInput): PromptNode;
  createRevision(input: CreateRevisionInput): PromptRevision;
  confirmRevision(nodeId: number, revisionId: number): PromptRevision;
  rejectRevision(revisionId: number): PromptRevision;
  bindNode(input: CreateBindingInput): PromptNodeBinding;
  createCompilation(input: CreateCompilationInput): PromptCompilation;
  getOrCreateConversation(): StoryConversation;
  appendMessage(input: AppendMessageInput): StoryConversationMessage;
  addMessageReference(input: AddMessageReferenceInput): StoryMessageReference;
  upsertStoryArtBinding(libraryVersionId: number): StoryArtPromptBinding;
  compileTargets(
    stableShotId: string,
  ): Record<Exclude<PromptModality, "shared">, CompiledPromptTarget>;
};

function normalizeInitialState(
  initial?: PromptLineageLocalState | string,
): PromptLineageLocalState {
  if (!initial) return createEmptyPromptLineageLocalState();
  const parsed =
    typeof initial === "string"
      ? (JSON.parse(initial) as Partial<PromptLineageLocalState>)
      : initial;
  return normalizePromptLineageLocalState(structuredClone(parsed));
}

function ownerMatches(
  value: PromptLineageOwner,
  owner: PromptLineageOwner,
): boolean {
  return value.storyId === owner.storyId && value.userId === owner.userId;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createPromptLineageMemoryStore(
  initial?: PromptLineageLocalState | string,
  storeOptions: {
    onCommit?: (state: PromptLineageLocalState) => Promise<void> | void;
  } = {},
) {
  let state = normalizeInitialState(initial);

  function findOwnedStoryState(owner: PromptLineageOwner): StoryPromptState {
    const sameStory = state.storyStates.find(item => item.storyId === owner.storyId);
    if (!sameStory) {
      throw new PromptLineageValidationError(
        `Prompt lineage story ${owner.storyId} does not exist`,
      );
    }
    if (sameStory.userId !== owner.userId) {
      throw new PromptLineageOwnershipError(
        `Story ${owner.storyId} is not owned by user ${owner.userId}`,
      );
    }
    return sameStory;
  }

  function getStoryAggregate(owner: PromptLineageOwner): StoryPromptAggregate {
    const storyState = findOwnedStoryState(owner);
    const nodes = state.nodes.filter(item => ownerMatches(item, owner));
    const nodeIds = new Set(nodes.map(item => item.id));
    const revisions = state.revisions.filter(
      item => ownerMatches(item, owner) && nodeIds.has(item.nodeId),
    );
    const compilations = state.compilations.filter(item =>
      ownerMatches(item, owner),
    );
    const compilationIds = new Set(compilations.map(item => item.id));
    const messages = state.messages.filter(item => ownerMatches(item, owner));
    const messageIds = new Set(messages.map(item => item.id));

    return structuredClone({
      state: storyState,
      nodes,
      revisions,
      bindings: state.bindings.filter(item => ownerMatches(item, owner)),
      compilations,
      compilationInputs: state.compilationInputs.filter(item =>
        compilationIds.has(item.compilationId),
      ),
      compilationHeads: state.compilationHeads.filter(item =>
        ownerMatches(item, owner),
      ),
      conversation:
        state.conversations.find(item => ownerMatches(item, owner)) ?? null,
      messages,
      messageReferences: state.messageReferences.filter(
        item => ownerMatches(item, owner) && messageIds.has(item.messageId),
      ),
      artBinding:
        state.storyArtBindings.find(item => ownerMatches(item, owner)) ?? null,
    });
  }

  async function transact<T>(
    options: TransactionOptions,
    operation: (tx: PromptLineageTransaction) => T | Promise<T>,
  ): Promise<{ version: number; result: T }> {
    const priorReceipt = state.operationReceipts.find(
      receipt =>
        ownerMatches(receipt, options) &&
        receipt.operationKey === options.operationKey,
    );
    if (priorReceipt) {
      return {
        version: priorReceipt.committedVersion,
        result: structuredClone(priorReceipt.result) as T,
      };
    }

    const draft = structuredClone(state);
    const sameStory = draft.storyStates.find(
      item => item.storyId === options.storyId,
    );
    if (sameStory && sameStory.userId !== options.userId) {
      throw new PromptLineageOwnershipError(
        `Story ${options.storyId} is not owned by user ${options.userId}`,
      );
    }

    const currentVersion = sameStory?.version ?? 0;
    if (currentVersion !== options.expectedVersion) {
      throw new PromptLineageConflictError(
        `Expected prompt lineage version ${options.expectedVersion}, received ${currentVersion}`,
        currentVersion,
      );
    }

    const timestamp = nowIso();
    const storyState =
      sameStory ??
      (() => {
        const created: StoryPromptState = {
          id: draft.nextIds.storyState++,
          storyId: options.storyId,
          userId: options.userId,
          version: 0,
          migrationStatus: "legacy",
          migratedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        draft.storyStates.push(created);
        return created;
      })();

    const owner: PromptLineageOwner = {
      storyId: options.storyId,
      userId: options.userId,
    };

    const assertNodeOwned = (nodeId: number): PromptNode => {
      const node = draft.nodes.find(item => item.id === nodeId);
      if (!node || !ownerMatches(node, owner)) {
        throw new PromptLineageOwnershipError(
          `Prompt node ${nodeId} does not belong to story ${owner.storyId}`,
        );
      }
      return node;
    };

    const assertRevisionOwned = (revisionId: number): PromptRevision => {
      const revision = draft.revisions.find(item => item.id === revisionId);
      if (!revision || !ownerMatches(revision, owner)) {
        throw new PromptLineageOwnershipError(
          `Prompt revision ${revisionId} does not belong to story ${owner.storyId}`,
        );
      }
      assertNodeOwned(revision.nodeId);
      return revision;
    };

    const getOrCreateConversation = (): StoryConversation => {
      const existing = draft.conversations.find(item =>
        ownerMatches(item, owner),
      );
      if (existing) return existing;
      const conversation: StoryConversation = {
        id: draft.nextIds.conversation++,
        ...owner,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      draft.conversations.push(conversation);
      return conversation;
    };

    const tx: PromptLineageTransaction = {
      setMigrationStatus(status) {
        storyState.migrationStatus = status;
        storyState.migratedAt = status === "migrated" ? timestamp : null;
      },

      createNode(input) {
        const dimension = input.dimension.trim();
        if (!dimension) {
          throw new PromptLineageValidationError(
            "Prompt node dimension is required",
          );
        }
        const stableShotId = input.stableShotId?.trim() || null;
        const duplicate = draft.nodes.find(
          item =>
            ownerMatches(item, owner) &&
            item.stableShotId === stableShotId &&
            item.scope === input.scope &&
            item.modality === input.modality &&
            item.dimension === dimension,
        );
        if (duplicate) {
          throw new PromptLineageValidationError(
            `Prompt node already exists for ${input.scope}/${input.modality}/${dimension}`,
          );
        }
        const node: PromptNode = {
          id: draft.nextIds.node++,
          ...owner,
          stableShotId,
          scope: input.scope,
          modality: input.modality,
          dimension,
          currentRevisionId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        draft.nodes.push(node);
        return node;
      },

      createRevision(input) {
        const node = assertNodeOwned(input.nodeId);
        const content = input.content.trim();
        if (!content) {
          throw new PromptLineageValidationError(
            "Prompt revision content is required",
          );
        }
        const parentRevisionId = input.parentRevisionId ?? null;
        if (parentRevisionId != null) {
          const parent = assertRevisionOwned(parentRevisionId);
          if (parent.nodeId !== node.id) {
            throw new PromptLineageValidationError(
              "Parent revision must belong to the same prompt node",
            );
          }
        }
        const revision: PromptRevision = {
          id: draft.nextIds.revision++,
          ...owner,
          nodeId: node.id,
          parentRevisionId,
          content,
          weight: normalizePromptWeight(
            input.weight,
            promptDimensionWeight(node.dimension),
          ),
          authorType: input.authorType,
          authorUserId:
            input.authorUserId ??
            (input.authorType === "user" ? owner.userId : null),
          reason: input.reason?.trim() || null,
          source: input.source?.trim() || null,
          status: input.status ?? "candidate",
          createdAt: timestamp,
          decidedAt: null,
        };
        draft.revisions.push(revision);
        return revision;
      },

      confirmRevision(nodeId, revisionId) {
        const node = assertNodeOwned(nodeId);
        const revision = assertRevisionOwned(revisionId);
        if (revision.nodeId !== node.id) {
          throw new PromptLineageValidationError(
            "Current revision must belong to the target prompt node",
          );
        }
        if (revision.status === "rejected") {
          throw new PromptLineageValidationError(
            "Rejected prompt revisions cannot be confirmed",
          );
        }
        revision.status = "confirmed";
        revision.decidedAt = timestamp;
        node.currentRevisionId = revision.id;
        node.updatedAt = timestamp;
        return revision;
      },

      rejectRevision(revisionId) {
        const revision = assertRevisionOwned(revisionId);
        const node = assertNodeOwned(revision.nodeId);
        if (node.currentRevisionId === revision.id) {
          throw new PromptLineageValidationError(
            "The current prompt revision cannot be rejected",
          );
        }
        revision.status = "rejected";
        revision.decidedAt = timestamp;
        return revision;
      },

      bindNode(input) {
        const node = assertNodeOwned(input.nodeId);
        const stableShotId = input.stableShotId?.trim() || null;
        const duplicate = draft.bindings.find(
          item =>
            ownerMatches(item, owner) &&
            item.nodeId === node.id &&
            item.stableShotId === stableShotId &&
            item.modality === input.modality,
        );
        if (duplicate) return duplicate;
        const binding: PromptNodeBinding = {
          id: draft.nextIds.binding++,
          ...owner,
          nodeId: node.id,
          stableShotId,
          modality: input.modality,
          sortOrder: input.sortOrder,
          createdAt: timestamp,
        };
        draft.bindings.push(binding);
        return binding;
      },

      createCompilation(input) {
        const stableShotId = input.stableShotId.trim();
        if (!stableShotId || !input.finalText.trim()) {
          throw new PromptLineageValidationError(
            "Compilation shot identity and final text are required",
          );
        }
        const revisions = input.revisionIds.map(assertRevisionOwned);
        const compilation: PromptCompilation = {
          id: draft.nextIds.compilation++,
          ...owner,
          stableShotId,
          modality: input.modality,
          finalText: input.finalText,
          inputFingerprint: input.inputFingerprint,
          createdAt: timestamp,
        };
        draft.compilations.push(compilation);
        revisions.forEach((revision, position) => {
          draft.compilationInputs.push({
            id: draft.nextIds.compilationInput++,
            compilationId: compilation.id,
            revisionId: revision.id,
            position,
          });
        });
        const currentHead = draft.compilationHeads.find(
          item =>
            ownerMatches(item, owner) &&
            item.stableShotId === stableShotId &&
            item.modality === input.modality,
        );
        if (currentHead) {
          currentHead.currentCompilationId = compilation.id;
          currentHead.updatedAt = timestamp;
        } else {
          const head: PromptCompilationHead = {
            id: draft.nextIds.compilationHead++,
            ...owner,
            stableShotId,
            modality: input.modality,
            currentCompilationId: compilation.id,
            updatedAt: timestamp,
          };
          draft.compilationHeads.push(head);
        }
        return compilation;
      },

      getOrCreateConversation,

      appendMessage(input) {
        const conversation = getOrCreateConversation();
        if (input.candidateRevisionId != null) {
          assertRevisionOwned(input.candidateRevisionId);
        }
        const message: StoryConversationMessage = {
          id: draft.nextIds.message++,
          ...owner,
          conversationId: conversation.id,
          role: input.role,
          content: input.content,
          source: input.source?.trim() || null,
          clientMessageId: input.clientMessageId?.trim() || null,
          candidateRevisionId: input.candidateRevisionId ?? null,
          createdAt: timestamp,
        };
        draft.messages.push(message);
        conversation.updatedAt = timestamp;
        return message;
      },

      addMessageReference(input) {
        const message = draft.messages.find(
          item => item.id === input.messageId && ownerMatches(item, owner),
        );
        if (!message) {
          throw new PromptLineageOwnershipError(
            `Conversation message ${input.messageId} does not belong to story ${owner.storyId}`,
          );
        }
        const reference: StoryMessageReference = {
          id: draft.nextIds.messageReference++,
          ...owner,
          messageId: message.id,
          objectType: input.objectType,
          objectId: input.objectId,
          objectVersion: input.objectVersion ?? null,
          selection: input.selection ?? null,
          createdAt: timestamp,
        };
        draft.messageReferences.push(reference);
        return reference;
      },

      upsertStoryArtBinding(libraryVersionId) {
        if (!Number.isInteger(libraryVersionId) || libraryVersionId <= 0) {
          throw new PromptLineageValidationError(
            "Art prompt library version is required",
          );
        }
        const existing = draft.storyArtBindings.find(item =>
          ownerMatches(item, owner),
        );
        if (existing) {
          existing.libraryVersionId = libraryVersionId;
          existing.updatedAt = timestamp;
          return existing;
        }
        const binding: StoryArtPromptBinding = {
          id: draft.nextIds.storyArtBinding++,
          ...owner,
          libraryVersionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        draft.storyArtBindings.push(binding);
        return binding;
      },

      compileTargets(stableShotId) {
        return compilePromptTargets({
          stableShotId,
          nodes: draft.nodes.filter(item => ownerMatches(item, owner)),
          revisions: draft.revisions.filter(item => ownerMatches(item, owner)),
          bindings: draft.bindings.filter(item => ownerMatches(item, owner)),
        });
      },
    };

    const result = await operation(tx);
    storyState.version += 1;
    storyState.updatedAt = timestamp;
    draft.operationReceipts.push({
      id: draft.nextIds.operationReceipt++,
      ...owner,
      operationKey: options.operationKey,
      committedVersion: storyState.version,
      result: structuredClone(result),
      createdAt: timestamp,
    });
    await storeOptions.onCommit?.(structuredClone(draft));
    state = draft;
    return {
      version: storyState.version,
      result: structuredClone(result),
    };
  }

  return {
    transact,
    getStoryAggregate,
    async appendConversationTurn(
      owner: PromptLineageOwner,
      input: AppendConversationTurnInput,
    ): Promise<AppendConversationTurnResult> {
      findOwnedStoryState(owner);
      const draft = structuredClone(state);
      const timestamp = nowIso();
      let conversation = draft.conversations.find(item =>
        ownerMatches(item, owner),
      );
      if (!conversation) {
        conversation = {
          id: draft.nextIds.conversation++,
          ...owner,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        draft.conversations.push(conversation);
      }
      const appended: StoryConversationMessage[] = [];
      const references: StoryMessageReference[] = [];
      for (const item of input.messages) {
        const clientMessageId = item.clientMessageId?.trim() || null;
        const existing = clientMessageId
          ? draft.messages.find(
              message =>
                message.conversationId === conversation!.id &&
                message.clientMessageId === clientMessageId,
            )
          : undefined;
        if (existing) {
          appended.push(existing);
          references.push(
            ...draft.messageReferences.filter(
              reference => reference.messageId === existing.id,
            ),
          );
          continue;
        }
        const message: StoryConversationMessage = {
          id: draft.nextIds.message++,
          ...owner,
          conversationId: conversation.id,
          role: item.role,
          content: item.content,
          source: item.source?.trim() || null,
          clientMessageId,
          candidateRevisionId: item.candidateRevisionId ?? null,
          createdAt: timestamp,
        };
        draft.messages.push(message);
        appended.push(message);
        if (item.reference) {
          const reference: StoryMessageReference = {
            id: draft.nextIds.messageReference++,
            ...owner,
            messageId: message.id,
            objectType: item.reference.objectType,
            objectId: item.reference.objectId,
            objectVersion: item.reference.objectVersion ?? null,
            selection: item.reference.selection ?? null,
            createdAt: timestamp,
          };
          draft.messageReferences.push(reference);
          references.push(reference);
        }
      }
      conversation.updatedAt = timestamp;
      await storeOptions.onCommit?.(structuredClone(draft));
      state = draft;
      return structuredClone({ conversation, messages: appended, references });
    },
    async clearStory(owner: PromptLineageOwner) {
      const next = structuredClone(state);
      const remainingCompilations = next.compilations.filter(
        item => !ownerMatches(item, owner),
      );
      const remainingCompilationIds = new Set(
        remainingCompilations.map(item => item.id),
      );
      const remainingMessages = next.messages.filter(
        item => !ownerMatches(item, owner),
      );
      const remainingMessageIds = new Set(
        remainingMessages.map(item => item.id),
      );
      next.storyStates = next.storyStates.filter(
        item => !ownerMatches(item, owner),
      );
      next.nodes = next.nodes.filter(item => !ownerMatches(item, owner));
      next.revisions = next.revisions.filter(item => !ownerMatches(item, owner));
      next.bindings = next.bindings.filter(item => !ownerMatches(item, owner));
      next.compilations = remainingCompilations;
      next.compilationInputs = next.compilationInputs.filter(item =>
        remainingCompilationIds.has(item.compilationId),
      );
      next.compilationHeads = next.compilationHeads.filter(
        item => !ownerMatches(item, owner),
      );
      next.conversations = next.conversations.filter(
        item => !ownerMatches(item, owner),
      );
      next.messages = remainingMessages;
      next.messageReferences = next.messageReferences.filter(item =>
        remainingMessageIds.has(item.messageId),
      );
      next.storyArtBindings = next.storyArtBindings.filter(
        item => !ownerMatches(item, owner),
      );
      next.operationReceipts = next.operationReceipts.filter(
        item => !ownerMatches(item, owner),
      );
      const normalized = normalizePromptLineageLocalState(next);
      await storeOptions.onCommit?.(structuredClone(normalized));
      state = normalized;
    },
    hasStoryState(owner: PromptLineageOwner) {
      const sameStory = state.storyStates.find(
        item => item.storyId === owner.storyId,
      );
      if (!sameStory) return false;
      if (sameStory.userId !== owner.userId) {
        throw new PromptLineageOwnershipError(
          `Story ${owner.storyId} is not owned by user ${owner.userId}`,
        );
      }
      return true;
    },
    serialize() {
      return JSON.stringify(state);
    },
    snapshot() {
      return structuredClone(state);
    },
  };
}

export type PromptLineageMemoryStore = ReturnType<
  typeof createPromptLineageMemoryStore
>;

export async function createPersistentLocalPromptLineageStore(): Promise<PromptLineageMemoryStore> {
  const state = await getLocalPromptLineageState();
  if (!state) {
    throw new Error(
      "Persistent local prompt lineage store is unavailable in MySQL mode",
    );
  }
  return createPromptLineageMemoryStore(state, {
    onCommit: replaceLocalPromptLineageState,
  });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function loadStoryPromptAggregate(
  owner: PromptLineageOwner,
): Promise<StoryPromptAggregate | null> {
  const db = await getDb();
  if (!db) {
    const store = await createPersistentLocalPromptLineageStore();
    return store.hasStoryState(owner) ? store.getStoryAggregate(owner) : null;
  }

  const [stateRow] = await db
    .select()
    .from(storyPromptStates)
    .where(
      and(
        eq(storyPromptStates.storyId, owner.storyId),
        eq(storyPromptStates.userId, owner.userId),
      ),
    )
    .limit(1);
  if (!stateRow) return null;

  const [
    nodeRows,
    revisionRows,
    bindingRows,
    compilationRows,
    headRows,
    conversationRows,
    messageRows,
    referenceRows,
    artBindingRows,
  ] = await Promise.all([
    db
      .select()
      .from(promptNodes)
      .where(
        and(
          eq(promptNodes.storyId, owner.storyId),
          eq(promptNodes.userId, owner.userId),
        ),
      )
      .orderBy(asc(promptNodes.id)),
    db
      .select()
      .from(promptRevisions)
      .where(
        and(
          eq(promptRevisions.storyId, owner.storyId),
          eq(promptRevisions.userId, owner.userId),
        ),
      )
      .orderBy(asc(promptRevisions.id)),
    db
      .select()
      .from(promptNodeBindings)
      .where(
        and(
          eq(promptNodeBindings.storyId, owner.storyId),
          eq(promptNodeBindings.userId, owner.userId),
        ),
      )
      .orderBy(asc(promptNodeBindings.sortOrder)),
    db
      .select()
      .from(promptCompilations)
      .where(
        and(
          eq(promptCompilations.storyId, owner.storyId),
          eq(promptCompilations.userId, owner.userId),
        ),
      )
      .orderBy(asc(promptCompilations.id)),
    db
      .select()
      .from(promptCompilationHeads)
      .where(
        and(
          eq(promptCompilationHeads.storyId, owner.storyId),
          eq(promptCompilationHeads.userId, owner.userId),
        ),
      ),
    db
      .select()
      .from(storyConversations)
      .where(
        and(
          eq(storyConversations.storyId, owner.storyId),
          eq(storyConversations.userId, owner.userId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(storyConversationMessages)
      .where(
        and(
          eq(storyConversationMessages.storyId, owner.storyId),
          eq(storyConversationMessages.userId, owner.userId),
        ),
      )
      .orderBy(asc(storyConversationMessages.id)),
    db
      .select()
      .from(storyMessageReferences)
      .where(
        and(
          eq(storyMessageReferences.storyId, owner.storyId),
          eq(storyMessageReferences.userId, owner.userId),
        ),
      )
      .orderBy(asc(storyMessageReferences.id)),
    db
      .select()
      .from(storyArtPromptBindings)
      .where(
        and(
          eq(storyArtPromptBindings.storyId, owner.storyId),
          eq(storyArtPromptBindings.userId, owner.userId),
        ),
      )
      .limit(1),
  ]);
  const compilationIds = compilationRows.map(row => row.id);
  const allInputRows =
    compilationIds.length === 0
      ? []
      : await db
          .select()
          .from(promptCompilationInputs)
          .where(inArray(promptCompilationInputs.compilationId, compilationIds));

  return {
    state: {
      ...stateRow,
      migratedAt: stateRow.migratedAt ? iso(stateRow.migratedAt) : null,
      createdAt: iso(stateRow.createdAt),
      updatedAt: iso(stateRow.updatedAt),
    },
    nodes: nodeRows.map(row => ({
      ...row,
      stableShotId: row.stableShotId || null,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    revisions: revisionRows.map(row => ({
      ...row,
      weight: normalizePromptWeight(
        row.weight,
        promptDimensionWeight(
          nodeRows.find(node => node.id === row.nodeId)?.dimension ?? "",
        ),
      ),
      createdAt: iso(row.createdAt),
      decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
    })),
    bindings: bindingRows.map(row => ({
      ...row,
      stableShotId: row.stableShotId || null,
      createdAt: iso(row.createdAt),
    })),
    compilations: compilationRows.map(row => ({
      ...row,
      createdAt: iso(row.createdAt),
    })),
    compilationInputs: allInputRows.sort(
      (left, right) =>
        left.compilationId - right.compilationId ||
        left.position - right.position,
    ),
    compilationHeads: headRows.map(row => ({
      ...row,
      updatedAt: iso(row.updatedAt),
    })),
    conversation: conversationRows[0]
      ? {
          ...conversationRows[0],
          createdAt: iso(conversationRows[0].createdAt),
          updatedAt: iso(conversationRows[0].updatedAt),
        }
      : null,
    messages: messageRows.map(row => ({
      ...row,
      createdAt: iso(row.createdAt),
    })),
    messageReferences: referenceRows.map(row => ({
      ...row,
      createdAt: iso(row.createdAt),
    })),
    artBinding: artBindingRows[0]
      ? {
          ...artBindingRows[0],
          createdAt: iso(artBindingRows[0].createdAt),
          updatedAt: iso(artBindingRows[0].updatedAt),
        }
      : null,
  };
}

export async function clearStoryPromptLineage(
  owner: PromptLineageOwner,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const store = await createPersistentLocalPromptLineageStore();
    await store.clearStory(owner);
    return;
  }

  await db.transaction(async tx => {
    const compilationRows = await tx
      .select({ id: promptCompilations.id })
      .from(promptCompilations)
      .where(
        and(
          eq(promptCompilations.storyId, owner.storyId),
          eq(promptCompilations.userId, owner.userId),
        ),
      );
    if (compilationRows.length > 0) {
      await tx
        .delete(promptCompilationInputs)
        .where(
          inArray(
            promptCompilationInputs.compilationId,
            compilationRows.map(row => row.id),
          ),
        );
    }
    await tx
      .delete(storyMessageReferences)
      .where(
        and(
          eq(storyMessageReferences.storyId, owner.storyId),
          eq(storyMessageReferences.userId, owner.userId),
        ),
      );
    await tx
      .delete(storyConversationMessages)
      .where(
        and(
          eq(storyConversationMessages.storyId, owner.storyId),
          eq(storyConversationMessages.userId, owner.userId),
        ),
      );
    await tx
      .delete(storyConversations)
      .where(
        and(
          eq(storyConversations.storyId, owner.storyId),
          eq(storyConversations.userId, owner.userId),
        ),
      );
    await tx
      .delete(promptCompilationHeads)
      .where(
        and(
          eq(promptCompilationHeads.storyId, owner.storyId),
          eq(promptCompilationHeads.userId, owner.userId),
        ),
      );
    await tx
      .delete(promptCompilations)
      .where(
        and(
          eq(promptCompilations.storyId, owner.storyId),
          eq(promptCompilations.userId, owner.userId),
        ),
      );
    await tx
      .delete(promptNodeBindings)
      .where(
        and(
          eq(promptNodeBindings.storyId, owner.storyId),
          eq(promptNodeBindings.userId, owner.userId),
        ),
      );
    await tx
      .delete(promptRevisions)
      .where(
        and(
          eq(promptRevisions.storyId, owner.storyId),
          eq(promptRevisions.userId, owner.userId),
        ),
      );
    await tx
      .delete(promptNodes)
      .where(
        and(
          eq(promptNodes.storyId, owner.storyId),
          eq(promptNodes.userId, owner.userId),
        ),
      );
    await tx
      .delete(storyArtPromptBindings)
      .where(
        and(
          eq(storyArtPromptBindings.storyId, owner.storyId),
          eq(storyArtPromptBindings.userId, owner.userId),
        ),
      );
    await tx
      .delete(promptOperationReceipts)
      .where(
        and(
          eq(promptOperationReceipts.storyId, owner.storyId),
          eq(promptOperationReceipts.userId, owner.userId),
        ),
      );
    await tx
      .delete(storyPromptStates)
      .where(
        and(
          eq(storyPromptStates.storyId, owner.storyId),
          eq(storyPromptStates.userId, owner.userId),
        ),
      );
  });
}
