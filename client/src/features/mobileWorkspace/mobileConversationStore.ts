import { computeStoryConversationTurnRequestHash } from "@shared/promptLineage";

export type MobileConversationTurnStatus =
  | "replying"
  | "generation-failed"
  | "generation-unknown"
  | "persisting"
  | "synced"
  | "persistence-failed";

export type MobileConversationRecoveryTurn = {
  userId: number;
  storyId: number;
  clientTurnId: string;
  requestHash: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
  assistantContent: string | null;
  status: MobileConversationTurnStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MobileConversationServerMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  clientMessageId: string | null;
  createdAt: string;
};

export type MobileConversationViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  source: "server" | "recovery";
  turnStatus?: MobileConversationTurnStatus;
};

export type MobileConversationTurnEvent =
  | { type: "generation_started"; now: number }
  | {
      type: "generation_completed";
      assistantContent: string;
      now: number;
    }
  | { type: "generation_failed"; error: string; now: number }
  | { type: "generation_unknown"; error: string; now: number }
  | { type: "append_started"; now: number }
  | { type: "append_failed"; error: string; now: number }
  | { type: "synced"; now: number };

export type MobileConversationStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const RECOVERY_PREFIX = "dt:mobile:conversation:v1:";
const TURN_STATUSES = new Set<MobileConversationTurnStatus>([
  "replying",
  "generation-failed",
  "generation-unknown",
  "persisting",
  "synced",
  "persistence-failed",
]);

export function mobileConversationRecoveryKey(
  userId: number,
  storyId: number
): string {
  return `${RECOVERY_PREFIX}${userId}:${storyId}`;
}

function defaultIdFactory(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createMobileConversationRecoveryTurn(input: {
  userId: number;
  storyId: number;
  userContent: string;
  idFactory?: () => string;
  now?: number;
}): MobileConversationRecoveryTurn {
  const userContent = input.userContent.trim();
  if (!userContent) throw new Error("聊天内容不能为空");
  const suffix = (input.idFactory ?? defaultIdFactory)();
  const clientTurnId = `turn-${suffix}`;
  const userClientMessageId = `user-${suffix}`;
  const assistantClientMessageId = `assistant-${suffix}`;
  const requestHash = computeStoryConversationTurnRequestHash({
    storyId: input.storyId,
    clientTurnId,
    userClientMessageId,
    assistantClientMessageId,
    userContent,
  });
  const timestamp = input.now ?? Date.now();
  return {
    userId: input.userId,
    storyId: input.storyId,
    clientTurnId,
    requestHash,
    userClientMessageId,
    assistantClientMessageId,
    userContent,
    assistantContent: null,
    status: "replying",
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function applyMobileConversationTurnEvent(
  turn: MobileConversationRecoveryTurn,
  event: MobileConversationTurnEvent
): MobileConversationRecoveryTurn {
  switch (event.type) {
    case "generation_started":
      return {
        ...turn,
        assistantContent: null,
        status: "replying",
        error: null,
        updatedAt: event.now,
      };
    case "generation_completed": {
      const assistantContent = event.assistantContent.trim();
      if (!assistantContent) throw new Error("模型回答不能为空");
      return {
        ...turn,
        assistantContent,
        status: "persisting",
        error: null,
        updatedAt: event.now,
      };
    }
    case "generation_failed":
      return {
        ...turn,
        assistantContent: null,
        status: "generation-failed",
        error: event.error,
        updatedAt: event.now,
      };
    case "generation_unknown":
      return {
        ...turn,
        status: "generation-unknown",
        error: event.error,
        updatedAt: event.now,
      };
    case "append_started":
      if (!turn.assistantContent) return turn;
      return {
        ...turn,
        status: "persisting",
        error: null,
        updatedAt: event.now,
      };
    case "append_failed":
      return {
        ...turn,
        status: "persistence-failed",
        error: event.error,
        updatedAt: event.now,
      };
    case "synced":
      return {
        ...turn,
        status: "synced",
        error: null,
        updatedAt: event.now,
      };
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeRecoveryTurn(
  value: unknown,
  userId: number,
  storyId: number
): MobileConversationRecoveryTurn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const turn = value as Partial<MobileConversationRecoveryTurn>;
  if (
    turn.userId !== userId ||
    turn.storyId !== storyId ||
    !isPositiveInteger(turn.userId) ||
    !isPositiveInteger(turn.storyId) ||
    typeof turn.clientTurnId !== "string" ||
    typeof turn.requestHash !== "string" ||
    typeof turn.userClientMessageId !== "string" ||
    typeof turn.assistantClientMessageId !== "string" ||
    typeof turn.userContent !== "string" ||
    !turn.userContent.trim() ||
    turn.userContent.length > 20_000 ||
    (turn.assistantContent !== null &&
      typeof turn.assistantContent !== "string") ||
    typeof turn.status !== "string" ||
    !TURN_STATUSES.has(turn.status as MobileConversationTurnStatus) ||
    typeof turn.createdAt !== "number" ||
    !Number.isFinite(turn.createdAt) ||
    typeof turn.updatedAt !== "number" ||
    !Number.isFinite(turn.updatedAt)
  ) {
    return null;
  }
  const normalized = {
    userId,
    storyId,
    clientTurnId: turn.clientTurnId.trim(),
    requestHash: turn.requestHash.trim(),
    userClientMessageId: turn.userClientMessageId.trim(),
    assistantClientMessageId: turn.assistantClientMessageId.trim(),
    userContent: turn.userContent,
    assistantContent: turn.assistantContent,
    status: turn.status as MobileConversationTurnStatus,
    error: typeof turn.error === "string" ? turn.error : null,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
  };
  if (
    !normalized.clientTurnId ||
    !normalized.requestHash ||
    !normalized.userClientMessageId ||
    !normalized.assistantClientMessageId ||
    normalized.requestHash !==
      computeStoryConversationTurnRequestHash({
        storyId,
        clientTurnId: normalized.clientTurnId,
        userClientMessageId: normalized.userClientMessageId,
        assistantClientMessageId: normalized.assistantClientMessageId,
        userContent: normalized.userContent,
      })
  ) {
    return null;
  }
  return normalized;
}

export function loadMobileConversationRecovery(
  storage: Pick<MobileConversationStorage, "getItem">,
  userId: number,
  storyId: number
): MobileConversationRecoveryTurn[] {
  try {
    const raw = storage.getItem(mobileConversationRecoveryKey(userId, storyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(value => {
      const normalized = normalizeRecoveryTurn(value, userId, storyId);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export function saveMobileConversationRecovery(
  storage: Pick<MobileConversationStorage, "setItem" | "removeItem">,
  userId: number,
  storyId: number,
  turns: readonly MobileConversationRecoveryTurn[]
): void {
  const scoped = turns.flatMap(value => {
    const normalized = normalizeRecoveryTurn(value, userId, storyId);
    return normalized ? [normalized] : [];
  });
  const key = mobileConversationRecoveryKey(userId, storyId);
  if (scoped.length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(scoped));
}

export function mergeMobileConversationProjection(input: {
  serverMessages: readonly MobileConversationServerMessage[];
  recoveryTurns: readonly MobileConversationRecoveryTurn[];
}): {
  messages: MobileConversationViewMessage[];
  remainingRecoveryTurns: MobileConversationRecoveryTurn[];
} {
  const messages: MobileConversationViewMessage[] = input.serverMessages
    .filter(
      (
        message
      ): message is MobileConversationServerMessage & {
        role: "user" | "assistant";
      } => message.role === "user" || message.role === "assistant"
    )
    .map(message => ({
      id: message.clientMessageId ?? `server-message:${message.id}`,
      role: message.role,
      content: message.content,
      timestamp: Date.parse(message.createdAt) || message.id,
      source: "server" as const,
    }));
  const serverIds = new Set(messages.map(message => message.id));
  const remainingRecoveryTurns: MobileConversationRecoveryTurn[] = [];
  for (const turn of input.recoveryTurns) {
    const hasUser = serverIds.has(turn.userClientMessageId);
    const hasAssistant = serverIds.has(turn.assistantClientMessageId);
    if (hasUser && hasAssistant) continue;
    remainingRecoveryTurns.push(turn);
    if (!hasUser) {
      messages.push({
        id: turn.userClientMessageId,
        role: "user",
        content: turn.userContent,
        timestamp: turn.createdAt,
        source: "recovery",
        turnStatus: turn.status,
      });
      serverIds.add(turn.userClientMessageId);
    }
    if (!hasAssistant && turn.assistantContent) {
      messages.push({
        id: turn.assistantClientMessageId,
        role: "assistant",
        content: turn.assistantContent,
        timestamp: turn.updatedAt,
        source: "recovery",
        turnStatus: turn.status,
      });
      serverIds.add(turn.assistantClientMessageId);
    }
  }
  messages.sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id)
  );
  return { messages, remainingRecoveryTurns };
}
