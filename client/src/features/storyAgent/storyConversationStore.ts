import type {
  ChatMessage,
  PromptCandidateStatus,
  SelectionQuote,
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
  const merged = new Map(input.current.map(message => [message.id, message]));
  const referenceByMessage = new Map(
    input.references.map(reference => [
      reference.messageId,
      selectionQuote(reference.selection),
    ]),
  );
  const candidateByMessage = new Map(
    input.candidates.map(candidate => [candidate.messageId, candidate]),
  );
  for (const message of input.messages) {
    if (message.role === "system") continue;
    const id = message.clientMessageId || `story-conversation:${message.id}`;
    const candidate = candidateByMessage.get(message.id);
    merged.set(id, {
      id,
      role: message.role,
      content: message.content,
      timestamp: Date.parse(message.createdAt) || Date.now(),
      selectionQuote: referenceByMessage.get(message.id),
      promptCandidate: candidate
        ? {
            revisionId: candidate.revisionId,
            nodeId: candidate.nodeId,
            expectedVersion: candidate.expectedVersion,
            label: candidate.label,
            status: candidate.status,
          }
        : undefined,
    });
  }
  return Array.from(merged.values()).sort(
    (left, right) => left.timestamp - right.timestamp,
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
