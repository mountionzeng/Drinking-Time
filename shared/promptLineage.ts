import {
  normalizePromptWeight,
  promptDimensionWeight,
} from "./promptDimensionWeights";

export type PromptScope = "story" | "shot" | "modality";
export type PromptModality = "shared" | "dialogue" | "image" | "video";
export type PromptRevisionStatus = "candidate" | "confirmed" | "rejected";
export type PromptRevisionAuthor = "user" | "agent" | "system" | "migration";
export type PromptMigrationStatus = "legacy" | "migrating" | "migrated";
export type PromptLibraryKind = "system" | "user";
export type PromptLibraryVersionStatus = "draft" | "published";
export type ConversationMessageRole = "user" | "assistant" | "system";

export type PromptLineageOwner = {
  storyId: number;
  userId: number;
};

export type StoryPromptState = PromptLineageOwner & {
  id: number;
  version: number;
  migrationStatus: PromptMigrationStatus;
  migratedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PromptNode = PromptLineageOwner & {
  id: number;
  stableShotId: string | null;
  scope: PromptScope;
  modality: PromptModality;
  dimension: string;
  currentRevisionId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PromptRevision = PromptLineageOwner & {
  id: number;
  nodeId: number;
  parentRevisionId: number | null;
  content: string;
  weight: number;
  authorType: PromptRevisionAuthor;
  authorUserId: number | null;
  reason: string | null;
  source: string | null;
  status: PromptRevisionStatus;
  createdAt: string;
  decidedAt: string | null;
};

export type PromptNodeBinding = PromptLineageOwner & {
  id: number;
  nodeId: number;
  stableShotId: string | null;
  modality: PromptModality;
  sortOrder: number;
  createdAt: string;
};

export type PromptCompilation = PromptLineageOwner & {
  id: number;
  stableShotId: string;
  modality: Exclude<PromptModality, "shared">;
  finalText: string;
  inputFingerprint: string;
  createdAt: string;
};

export type PromptCompilationInput = {
  id: number;
  compilationId: number;
  revisionId: number;
  position: number;
};

export type PromptCompilationHead = PromptLineageOwner & {
  id: number;
  stableShotId: string;
  modality: Exclude<PromptModality, "shared">;
  currentCompilationId: number;
  updatedAt: string;
};

export type StoryConversation = PromptLineageOwner & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export type StoryConversationMessage = PromptLineageOwner & {
  id: number;
  conversationId: number;
  role: ConversationMessageRole;
  content: string;
  source: string | null;
  clientMessageId: string | null;
  candidateRevisionId: number | null;
  /** Null for legacy/desktop messages created before logical turns. */
  turnId?: number | null;
  createdAt: string;
};

export type StoryConversationTurnGenerationStatus =
  | "pending"
  | "completed"
  | "failed"
  | "unknown";

export type StoryConversationTurnAppendStatus = "pending" | "appended";

export type StoryConversationTurn = PromptLineageOwner & {
  id: number;
  conversationId: number;
  clientTurnId: string;
  requestHash: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
  assistantContent: string | null;
  generationStatus: StoryConversationTurnGenerationStatus;
  appendStatus: StoryConversationTurnAppendStatus;
  generationAttempt: number;
  contextMessageId: number | null;
  claimToken: string | null;
  failureMessage: string | null;
  claimedAt: string;
  updatedAt: string;
  completedAt: string | null;
  appendedAt: string | null;
};

export type StoryConversationTurnRequestHashInput = {
  storyId: number;
  clientTurnId: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
};

function canonicalTurnHashJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalTurnHashJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalTurnHashJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function turnFingerprint128(value: string): string {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  return [h1, h2, h3, h4]
    .map(hash => (hash >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

export function computeStoryConversationTurnRequestHash(
  input: StoryConversationTurnRequestHashInput,
): string {
  return `sct1-${turnFingerprint128(canonicalTurnHashJson({
    storyId: input.storyId,
    clientTurnId: input.clientTurnId.trim(),
    userClientMessageId: input.userClientMessageId.trim(),
    assistantClientMessageId: input.assistantClientMessageId.trim(),
    userContent: input.userContent.trim(),
  }))}`;
}

export type StoryMessageReference = PromptLineageOwner & {
  id: number;
  messageId: number;
  objectType: string;
  objectId: string;
  objectVersion: string | null;
  selection: unknown;
  createdAt: string;
};

export type ArtPromptLibrary = {
  id: number;
  kind: PromptLibraryKind;
  ownerUserId: number | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArtPromptLibraryVersion = {
  id: number;
  libraryId: number;
  version: number;
  status: PromptLibraryVersionStatus;
  contentFingerprint: string;
  source: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type ArtPromptLibraryItem = {
  id: number;
  libraryVersionId: number;
  dimension: string;
  content: string;
  negativeContent: string | null;
  sourceRevisionId: number | null;
  sortOrder: number;
};

export type StoryArtPromptBinding = PromptLineageOwner & {
  id: number;
  libraryVersionId: number;
  createdAt: string;
  updatedAt: string;
};

export type PromptOperationReceipt = PromptLineageOwner & {
  id: number;
  operationKey: string;
  committedVersion: number;
  result: unknown;
  createdAt: string;
};

export type PromptLineageLocalState = {
  storyStates: StoryPromptState[];
  nodes: PromptNode[];
  revisions: PromptRevision[];
  bindings: PromptNodeBinding[];
  compilations: PromptCompilation[];
  compilationInputs: PromptCompilationInput[];
  compilationHeads: PromptCompilationHead[];
  conversations: StoryConversation[];
  turns: StoryConversationTurn[];
  messages: StoryConversationMessage[];
  messageReferences: StoryMessageReference[];
  artLibraries: ArtPromptLibrary[];
  artLibraryVersions: ArtPromptLibraryVersion[];
  artLibraryItems: ArtPromptLibraryItem[];
  storyArtBindings: StoryArtPromptBinding[];
  operationReceipts: PromptOperationReceipt[];
  nextIds: {
    storyState: number;
    node: number;
    revision: number;
    binding: number;
    compilation: number;
    compilationInput: number;
    compilationHead: number;
    conversation: number;
    turn: number;
    message: number;
    messageReference: number;
    artLibrary: number;
    artLibraryVersion: number;
    artLibraryItem: number;
    storyArtBinding: number;
    operationReceipt: number;
  };
};

export type StoryPromptAggregate = {
  state: StoryPromptState;
  nodes: PromptNode[];
  revisions: PromptRevision[];
  bindings: PromptNodeBinding[];
  compilations: PromptCompilation[];
  compilationInputs: PromptCompilationInput[];
  compilationHeads: PromptCompilationHead[];
  conversation: StoryConversation | null;
  /** Present in persisted aggregates; optional only for legacy/test fixtures. */
  turns?: StoryConversationTurn[];
  messages: StoryConversationMessage[];
  messageReferences: StoryMessageReference[];
  artBinding: StoryArtPromptBinding | null;
};

export function createEmptyPromptLineageLocalState(): PromptLineageLocalState {
  return {
    storyStates: [],
    nodes: [],
    revisions: [],
    bindings: [],
    compilations: [],
    compilationInputs: [],
    compilationHeads: [],
    conversations: [],
    turns: [],
    messages: [],
    messageReferences: [],
    artLibraries: [],
    artLibraryVersions: [],
    artLibraryItems: [],
    storyArtBindings: [],
    operationReceipts: [],
    nextIds: {
      storyState: 1,
      node: 1,
      revision: 1,
      binding: 1,
      compilation: 1,
      compilationInput: 1,
      compilationHead: 1,
      conversation: 1,
      turn: 1,
      message: 1,
      messageReference: 1,
      artLibrary: 1,
      artLibraryVersion: 1,
      artLibraryItem: 1,
      storyArtBinding: 1,
      operationReceipt: 1,
    },
  };
}

function nextId(rows: Array<{ id: number }>): number {
  return rows.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1;
}

export function normalizePromptLineageLocalState(
  raw?: Partial<PromptLineageLocalState> | null,
): PromptLineageLocalState {
  const empty = createEmptyPromptLineageLocalState();
  const nodes = raw?.nodes ?? [];
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const normalized: PromptLineageLocalState = {
    storyStates: raw?.storyStates ?? [],
    nodes,
    revisions: (raw?.revisions ?? []).map(revision => ({
      ...revision,
      weight: normalizePromptWeight(
        revision.weight,
        promptDimensionWeight(nodeById.get(revision.nodeId)?.dimension ?? ""),
      ),
    })),
    bindings: raw?.bindings ?? [],
    compilations: raw?.compilations ?? [],
    compilationInputs: raw?.compilationInputs ?? [],
    compilationHeads: raw?.compilationHeads ?? [],
    conversations: raw?.conversations ?? [],
    turns: raw?.turns ?? [],
    messages: raw?.messages ?? [],
    messageReferences: raw?.messageReferences ?? [],
    artLibraries: raw?.artLibraries ?? [],
    artLibraryVersions: raw?.artLibraryVersions ?? [],
    artLibraryItems: raw?.artLibraryItems ?? [],
    storyArtBindings: raw?.storyArtBindings ?? [],
    operationReceipts: raw?.operationReceipts ?? [],
    nextIds: { ...empty.nextIds, ...(raw?.nextIds ?? {}) },
  };
  normalized.nextIds = {
    storyState: Math.max(
      normalized.nextIds.storyState,
      nextId(normalized.storyStates),
    ),
    node: Math.max(normalized.nextIds.node, nextId(normalized.nodes)),
    revision: Math.max(
      normalized.nextIds.revision,
      nextId(normalized.revisions),
    ),
    binding: Math.max(normalized.nextIds.binding, nextId(normalized.bindings)),
    compilation: Math.max(
      normalized.nextIds.compilation,
      nextId(normalized.compilations),
    ),
    compilationInput: Math.max(
      normalized.nextIds.compilationInput,
      nextId(normalized.compilationInputs),
    ),
    compilationHead: Math.max(
      normalized.nextIds.compilationHead,
      nextId(normalized.compilationHeads),
    ),
    conversation: Math.max(
      normalized.nextIds.conversation,
      nextId(normalized.conversations),
    ),
    turn: Math.max(normalized.nextIds.turn, nextId(normalized.turns)),
    message: Math.max(normalized.nextIds.message, nextId(normalized.messages)),
    messageReference: Math.max(
      normalized.nextIds.messageReference,
      nextId(normalized.messageReferences),
    ),
    artLibrary: Math.max(
      normalized.nextIds.artLibrary,
      nextId(normalized.artLibraries),
    ),
    artLibraryVersion: Math.max(
      normalized.nextIds.artLibraryVersion,
      nextId(normalized.artLibraryVersions),
    ),
    artLibraryItem: Math.max(
      normalized.nextIds.artLibraryItem,
      nextId(normalized.artLibraryItems),
    ),
    storyArtBinding: Math.max(
      normalized.nextIds.storyArtBinding,
      nextId(normalized.storyArtBindings),
    ),
    operationReceipt: Math.max(
      normalized.nextIds.operationReceipt,
      nextId(normalized.operationReceipts),
    ),
  };
  return normalized;
}
