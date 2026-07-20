import type {
  ChatMessage,
  PromptCandidateStatus,
  SelectionQuote,
} from "./types";
import {
  compactChatMessages,
  isOpeningChatMessage,
} from "./types";

type ServerMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  clientMessageId: string | null;
  candidateRevisionId: number | null;
  createdAt: string;
};

type ServerReference = {
  messageId: number;
  selection: unknown;
};

type ServerCandidate = {
  messageId: number;
  revisionId: number;
  nodeId: number;
  expectedVersion: number;
  label: string;
  status: PromptCandidateStatus;
};

function selectionQuote(value: unknown): SelectionQuote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sourceType !== "string" ||
    typeof candidate.sourceId !== "string" ||
    typeof candidate.selectedText !== "string"
  ) {
    return undefined;
  }
  return value as SelectionQuote;
}

export function mergeStoryConversationMessages(input: {
  current: readonly ChatMessage[];
  messages: readonly ServerMessage[];
  references: readonly ServerReference[];
  candidates: readonly ServerCandidate[];
}): ChatMessage[] {
  const compactedCurrent = compactChatMessages(input.current);
  const referenceByMessage = new Map(
    input.references.map(reference => [
      reference.messageId,
      selectionQuote(reference.selection),
    ]),
  );
  const candidateByMessage = new Map(
    input.candidates.map(candidate => [candidate.messageId, candidate]),
  );
  const projectedTurns = input.messages.filter(message => message.role !== "system");
  const legacyCorruptProjection =
    projectedTurns.length >= 3 &&
    projectedTurns.filter(message => message.role === "user").length /
      projectedTurns.length >
      0.9 &&
    projectedTurns.filter(message =>
      isOpeningChatMessage({
        id: message.clientMessageId ?? `story-conversation:${message.id}`,
        content: message.content,
      }),
    ).length > 1;
  const projectedClientIds = new Set(
    projectedTurns.flatMap(message =>
      message.clientMessageId ? [message.clientMessageId] : [],
    ),
  );
  const projectedContent = new Set(
    projectedTurns.map(message => message.content.trim()),
  );
  const current = legacyCorruptProjection
    ? compactedCurrent
    : compactedCurrent.filter(
        message =>
          !projectedContent.has(message.content.trim()) ||
          projectedClientIds.has(message.id),
      );
  const merged = new Map(current.map(message => [message.id, message]));
  const localByContent = new Map(
    current.map(message => [message.content.trim(), message]),
  );

  for (const message of input.messages) {
    if (message.role === "system") continue;
    const projectedId =
      message.clientMessageId || `story-conversation:${message.id}`;
    const directLocal = merged.get(projectedId);
    const contentLocal = legacyCorruptProjection
      ? localByContent.get(message.content.trim())
      : undefined;
    if (
      legacyCorruptProjection &&
      isOpeningChatMessage({
        id: projectedId,
        content: message.content,
      }) &&
      current.some(isOpeningChatMessage)
    ) {
      continue;
    }
    const local = directLocal ?? contentLocal;
    const id = local?.id ?? projectedId;
    const candidate = candidateByMessage.get(message.id);
    merged.set(id, {
      ...local,
      id,
      role: legacyCorruptProjection
        ? local?.role ?? message.role
        : message.role,
      content: message.content,
      timestamp:
        local?.timestamp ?? (Date.parse(message.createdAt) || Date.now()),
      selectionQuote:
        referenceByMessage.get(message.id) ?? local?.selectionQuote,
      promptCandidate: candidate
        ? {
            revisionId: candidate.revisionId,
            nodeId: candidate.nodeId,
            expectedVersion: candidate.expectedVersion,
            label: candidate.label,
            status: candidate.status,
          }
        : local?.promptCandidate,
    });
    if (!localByContent.has(message.content.trim())) {
      localByContent.set(message.content.trim(), merged.get(id)!);
    }
  }
  return compactChatMessages(
    Array.from(merged.values()).sort(
      (left, right) => left.timestamp - right.timestamp,
    ),
  );
}

const DRAFT_PREFIX = "dt:storyConversationDraft:";

export function storyConversationDraftKey(storyId: number): string {
  return `${DRAFT_PREFIX}${storyId}`;
}

export function loadStoryConversationDraft(storyId: number): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storyConversationDraftKey(storyId)) ?? "";
}

export function saveStoryConversationDraft(
  storyId: number,
  draft: string,
): void {
  if (typeof window === "undefined") return;
  const key = storyConversationDraftKey(storyId);
  if (draft.trim()) window.localStorage.setItem(key, draft);
  else window.localStorage.removeItem(key);
}
