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
  type StoryConversationTurn,
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
  storyConversationTurns,
  storyConversations,
  storyMessageReferences,
  storyPromptStates,
} from "../../drizzle/schema";
import {
  getDb,
  getLocalPromptLineageState,
  getLocalPromptLineageStateForStory,
  getLocalPromptCompilationHeadsForStory,
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

export class PromptLineageIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptLineageIdempotencyConflictError";
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

type ReserveConversationTurnInput = {
  clientTurnId: string;
  requestHash: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
  claimToken: string;
  now: string;
  retryFailed?: boolean;
  staleAfterMs: number;
};

type ConversationTurnLookupInput = {
  clientTurnId: string;
  requestHash: string;
  now: string;
  staleAfterMs: number;
};

type ConversationTurnClaimResult = {
  turn: StoryConversationTurn;
  claimed: boolean;
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

let persistentLocalConversationQueue: Promise<void> = Promise.resolve();

/** Serialize local conversation snapshots so concurrent callers cannot overwrite each other. */
export async function withPersistentLocalConversationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const prior = persistentLocalConversationQueue;
  let release!: () => void;
  persistentLocalConversationQueue = new Promise<void>(resolve => {
    release = resolve;
  });
  await prior;
  try {
    return await operation();
  } finally {
    release();
  }
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
      turns: state.turns.filter(item => ownerMatches(item, owner)),
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
    async reserveConversationTurn(
      owner: PromptLineageOwner,
      input: ReserveConversationTurnInput,
    ): Promise<ConversationTurnClaimResult> {
      findOwnedStoryState(owner);
      const draft = structuredClone(state);
      const clientTurnId = input.clientTurnId.trim();
      const requestHash = input.requestHash.trim();
      const userClientMessageId = input.userClientMessageId.trim();
      const assistantClientMessageId = input.assistantClientMessageId.trim();
      const userContent = input.userContent.trim();
      if (
        !clientTurnId ||
        !requestHash ||
        !userClientMessageId ||
        !assistantClientMessageId ||
        !userContent
      ) {
        throw new PromptLineageValidationError("对话轮参数不能为空");
      }
      if (userClientMessageId === assistantClientMessageId) {
        throw new PromptLineageIdempotencyConflictError(
          "同一轮的用户消息和助手消息必须使用不同标识",
        );
      }

      const existing = draft.turns.find(
        item => ownerMatches(item, owner) && item.clientTurnId === clientTurnId,
      );
      if (existing) {
        if (
          existing.requestHash !== requestHash ||
          existing.userClientMessageId !== userClientMessageId ||
          existing.assistantClientMessageId !== assistantClientMessageId ||
          existing.userContent !== userContent
        ) {
          throw new PromptLineageIdempotencyConflictError(
            "对话轮标识已被另一组内容使用",
          );
        }
        let changed = false;
        const age = Date.parse(input.now) - Date.parse(existing.claimedAt);
        if (
          existing.generationStatus === "pending" &&
          Number.isFinite(age) &&
          age >= input.staleAfterMs
        ) {
          existing.generationStatus = "unknown";
          existing.claimToken = null;
          existing.failureMessage = "生成结果未知，请复制内容后新建一轮";
          existing.updatedAt = input.now;
          changed = true;
        } else if (
          existing.generationStatus === "failed" &&
          input.retryFailed
        ) {
          existing.generationStatus = "pending";
          existing.generationAttempt += 1;
          existing.claimToken = input.claimToken;
          existing.failureMessage = null;
          existing.claimedAt = input.now;
          existing.updatedAt = input.now;
          changed = true;
          await storeOptions.onCommit?.(structuredClone(draft));
          state = draft;
          return structuredClone({ turn: existing, claimed: true });
        }
        if (changed) {
          await storeOptions.onCommit?.(structuredClone(draft));
          state = draft;
        }
        return structuredClone({ turn: existing, claimed: false });
      }

      const identityCollision = draft.turns.some(
        item =>
          ownerMatches(item, owner) &&
          (item.userClientMessageId === userClientMessageId ||
            item.assistantClientMessageId === assistantClientMessageId ||
            item.userClientMessageId === assistantClientMessageId ||
            item.assistantClientMessageId === userClientMessageId),
      );
      const legacyMessageCollision = draft.messages.some(
        item =>
          ownerMatches(item, owner) &&
          (item.clientMessageId === userClientMessageId ||
            item.clientMessageId === assistantClientMessageId),
      );
      if (identityCollision || legacyMessageCollision) {
        throw new PromptLineageIdempotencyConflictError(
          "对话消息标识已被另一轮内容使用",
        );
      }

      let conversation = draft.conversations.find(item =>
        ownerMatches(item, owner),
      );
      if (!conversation) {
        conversation = {
          id: draft.nextIds.conversation++,
          ...owner,
          createdAt: input.now,
          updatedAt: input.now,
        };
        draft.conversations.push(conversation);
      }
      const contextMessageId = draft.messages
        .filter(item => ownerMatches(item, owner))
        .reduce<number | null>(
          (latest, item) => (latest == null || item.id > latest ? item.id : latest),
          null,
        );
      const turn: StoryConversationTurn = {
        id: draft.nextIds.turn++,
        ...owner,
        conversationId: conversation.id,
        clientTurnId,
        requestHash,
        userClientMessageId,
        assistantClientMessageId,
        userContent,
        assistantContent: null,
        generationStatus: "pending",
        appendStatus: "pending",
        generationAttempt: 1,
        contextMessageId,
        claimToken: input.claimToken,
        failureMessage: null,
        claimedAt: input.now,
        updatedAt: input.now,
        completedAt: null,
        appendedAt: null,
      };
      draft.turns.push(turn);
      await storeOptions.onCommit?.(structuredClone(draft));
      state = draft;
      return structuredClone({ turn, claimed: true });
    },
    async getConversationTurn(
      owner: PromptLineageOwner,
      input: ConversationTurnLookupInput,
    ): Promise<StoryConversationTurn | null> {
      findOwnedStoryState(owner);
      const draft = structuredClone(state);
      const turn = draft.turns.find(
        item =>
          ownerMatches(item, owner) &&
          item.clientTurnId === input.clientTurnId.trim(),
      );
      if (!turn) return null;
      if (turn.requestHash !== input.requestHash.trim()) {
        throw new PromptLineageIdempotencyConflictError(
          "对话轮标识已被另一组内容使用",
        );
      }
      const age = Date.parse(input.now) - Date.parse(turn.claimedAt);
      if (
        turn.generationStatus === "pending" &&
        Number.isFinite(age) &&
        age >= input.staleAfterMs
      ) {
        turn.generationStatus = "unknown";
        turn.claimToken = null;
        turn.failureMessage = "生成结果未知，请复制内容后新建一轮";
        turn.updatedAt = input.now;
        await storeOptions.onCommit?.(structuredClone(draft));
        state = draft;
      }
      return structuredClone(turn);
    },
    async completeConversationTurn(
      owner: PromptLineageOwner,
      input: {
        clientTurnId: string;
        requestHash: string;
        claimToken: string;
        assistantContent: string;
        now: string;
      },
    ): Promise<StoryConversationTurn> {
      findOwnedStoryState(owner);
      const draft = structuredClone(state);
      const turn = draft.turns.find(
        item =>
          ownerMatches(item, owner) &&
          item.clientTurnId === input.clientTurnId.trim(),
      );
      if (!turn || turn.requestHash !== input.requestHash.trim()) {
        throw new PromptLineageIdempotencyConflictError(
          "对话轮标识与生成结果不匹配",
        );
      }
      if (
        turn.generationStatus === "pending" &&
        turn.claimToken === input.claimToken
      ) {
        turn.assistantContent = input.assistantContent;
        turn.generationStatus = "completed";
        turn.claimToken = null;
        turn.failureMessage = null;
        turn.completedAt = input.now;
        turn.updatedAt = input.now;
        await storeOptions.onCommit?.(structuredClone(draft));
        state = draft;
      }
      return structuredClone(turn);
    },
    async failConversationTurn(
      owner: PromptLineageOwner,
      input: {
        clientTurnId: string;
        requestHash: string;
        claimToken: string;
        failureMessage: string;
        now: string;
      },
    ): Promise<StoryConversationTurn> {
      findOwnedStoryState(owner);
      const draft = structuredClone(state);
      const turn = draft.turns.find(
        item =>
          ownerMatches(item, owner) &&
          item.clientTurnId === input.clientTurnId.trim(),
      );
      if (!turn || turn.requestHash !== input.requestHash.trim()) {
        throw new PromptLineageIdempotencyConflictError(
          "对话轮标识与失败结果不匹配",
        );
      }
      if (
        turn.generationStatus === "pending" &&
        turn.claimToken === input.claimToken
      ) {
        turn.generationStatus = "failed";
        turn.claimToken = null;
        turn.failureMessage = input.failureMessage;
        turn.updatedAt = input.now;
        await storeOptions.onCommit?.(structuredClone(draft));
        state = draft;
      }
      return structuredClone(turn);
    },
    async appendReservedConversationTurn(
      owner: PromptLineageOwner,
      input: {
        clientTurnId: string;
        requestHash: string;
        now: string;
      },
    ): Promise<StoryConversationTurn> {
      findOwnedStoryState(owner);
      const draft = structuredClone(state);
      const turn = draft.turns.find(
        item =>
          ownerMatches(item, owner) &&
          item.clientTurnId === input.clientTurnId.trim(),
      );
      if (!turn || turn.requestHash !== input.requestHash.trim()) {
        throw new PromptLineageIdempotencyConflictError(
          "对话轮标识与追加请求不匹配",
        );
      }
      if (turn.generationStatus !== "completed" || !turn.assistantContent) {
        throw new PromptLineageValidationError("模型回答尚未完成，不能追加对话");
      }
      if (turn.appendStatus === "appended") return structuredClone(turn);

      const existing = [
        draft.messages.find(
          item =>
            ownerMatches(item, owner) &&
            item.clientMessageId === turn.userClientMessageId,
        ),
        draft.messages.find(
          item =>
            ownerMatches(item, owner) &&
            item.clientMessageId === turn.assistantClientMessageId,
        ),
      ];
      if (existing.some(Boolean)) {
        const exact =
          existing.every(Boolean) &&
          existing[0]!.turnId === turn.id &&
          existing[0]!.role === "user" &&
          existing[0]!.content === turn.userContent &&
          existing[1]!.turnId === turn.id &&
          existing[1]!.role === "assistant" &&
          existing[1]!.content === turn.assistantContent;
        if (!exact) {
          throw new PromptLineageIdempotencyConflictError(
            "检测到不完整或冲突的历史对话轮",
          );
        }
      } else {
        const messageBase = {
          ...owner,
          conversationId: turn.conversationId,
          source: "mobile-story-agent",
          candidateRevisionId: null,
          turnId: turn.id,
          createdAt: input.now,
        };
        draft.messages.push(
          {
            id: draft.nextIds.message++,
            ...messageBase,
            role: "user",
            content: turn.userContent,
            clientMessageId: turn.userClientMessageId,
          },
          {
            id: draft.nextIds.message++,
            ...messageBase,
            role: "assistant",
            content: turn.assistantContent,
            clientMessageId: turn.assistantClientMessageId,
          },
        );
      }
      const conversation = draft.conversations.find(
        item => item.id === turn.conversationId && ownerMatches(item, owner),
      );
      if (conversation) conversation.updatedAt = input.now;
      turn.appendStatus = "appended";
      turn.appendedAt = input.now;
      turn.updatedAt = input.now;
      await storeOptions.onCommit?.(structuredClone(draft));
      state = draft;
      return structuredClone(turn);
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
      next.turns = next.turns.filter(item => !ownerMatches(item, owner));
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
    // 只读一个 Story：先按 storyId 从内存态筛出切片再 clone（见
    // getLocalPromptLineageStateForStory），不走
    // createPersistentLocalPromptLineageStore() 那条为写入准备的
    // 「clone 整库 + 挂 onCommit 写回」路径——读聚合不需要能写回，也不该
    // 为了读一个 Story 就把其它 Story 的提示词一起搬一遍。
    const slice = await getLocalPromptLineageStateForStory(owner.storyId);
    if (!slice) {
      throw new Error(
        "Persistent local prompt lineage store is unavailable in MySQL mode",
      );
    }
    const store = createPromptLineageMemoryStore(slice);
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
    turnRows,
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
      .from(storyConversationTurns)
      .where(
        and(
          eq(storyConversationTurns.storyId, owner.storyId),
          eq(storyConversationTurns.userId, owner.userId),
        ),
      )
      .orderBy(asc(storyConversationTurns.id)),
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
    turns: turnRows.map(row => ({
      ...row,
      claimedAt: iso(row.claimedAt),
      updatedAt: iso(row.updatedAt),
      completedAt: row.completedAt ? iso(row.completedAt) : null,
      appendedAt: row.appendedAt ? iso(row.appendedAt) : null,
    })),
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

/**
 * 只取 compilationHeads（stableShotId + modality + currentCompilationId 的
 * 当前指针），不展开 nodes/revisions/messages 等大字段。
 * storyMaterials.getStoryMaterialState 只用这张表拼时间线投影的 lookup，
 * 之前却要先取回整个 loadStoryPromptAggregate（本地模式还等于先复制一遍
 * 提示词仓库），是最重的确定性热点。
 *
 * 所有权校验：本地模式沿用 getStoryAggregate 那条「故事存在但不属于这个
 * user 就抛错」的路径；SQL 模式的 WHERE 已经把 storyId 和 userId 都收在
 * 查询条件里，跟 loadStoryPromptAggregate 的 storyPromptStates 查询同一个
 * 口径——查不到就是空数组，不是这个函数的职责去区分「不存在」和「不属于
 * 你」。
 */
export async function loadStoryPromptCompilationHeads(
  owner: PromptLineageOwner,
): Promise<PromptCompilationHead[]> {
  const db = await getDb();
  if (!db) {
    const heads = await getLocalPromptCompilationHeadsForStory(owner.storyId);
    if (heads.some(head => head.userId !== owner.userId)) {
      throw new PromptLineageOwnershipError(
        `Story ${owner.storyId} is not owned by user ${owner.userId}`,
      );
    }
    return heads;
  }

  const headRows = await db
    .select()
    .from(promptCompilationHeads)
    .where(
      and(
        eq(promptCompilationHeads.storyId, owner.storyId),
        eq(promptCompilationHeads.userId, owner.userId),
      ),
    );
  return headRows.map(row => ({ ...row, updatedAt: iso(row.updatedAt) }));
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
      .delete(storyConversationTurns)
      .where(
        and(
          eq(storyConversationTurns.storyId, owner.storyId),
          eq(storyConversationTurns.userId, owner.userId),
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
