import { RECOVERY_TTL_MS } from "./recoveryState";
import type { ConversationServerMessage, RecoveryScope } from "./types";

/**
 * 「聊聊」的整轮状态机。
 *
 * 与手机 Web 的 `client/src/features/mobileWorkspace/mobileConversationStore.ts`
 * 是同一份产品合同，但这里是纯 TypeScript：不引 React、不引 DOM、不引 `@shared`。
 * requestHash 算法逐字复刻 `shared/promptLineage.ts` 的
 * `computeStoryConversationTurnRequestHash`，这样 U6 接真实服务端时
 * 客户端算出的幂等键与服务端一致，不需要再翻译一次。
 */

export type ConversationTurnStatus =
  | "replying"
  | "generation-failed"
  | "generation-unknown"
  | "persisting"
  | "synced"
  | "persistence-failed";

export type ConversationRecoveryTurn = {
  scope: RecoveryScope;
  storyId: number;
  clientTurnId: string;
  requestHash: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
  assistantContent: string | null;
  status: ConversationTurnStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type ConversationViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  source: "server" | "recovery";
  turnStatus?: ConversationTurnStatus;
};

export type ConversationTurnEvent =
  | { type: "generation_started"; now: number }
  | { type: "generation_completed"; assistantContent: string; now: number }
  | { type: "generation_failed"; error: string; now: number }
  | { type: "generation_unknown"; error: string; now: number }
  | { type: "append_started"; now: number }
  | { type: "append_failed"; error: string; now: number }
  | { type: "synced"; now: number };

const TURN_STATUSES: readonly ConversationTurnStatus[] = [
  "replying",
  "generation-failed",
  "generation-unknown",
  "persisting",
  "synced",
  "persistence-failed",
];

export const MAX_TURN_CONTENT_LENGTH = 20_000;

// ---------------------------------------------------------------------------
// requestHash：与 shared/promptLineage.ts 同算法，改这里必须同步改那里。
// ---------------------------------------------------------------------------

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

export function computeTurnRequestHash(input: {
  storyId: number;
  clientTurnId: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
}): string {
  return `sct1-${turnFingerprint128(
    canonicalTurnHashJson({
      storyId: input.storyId,
      clientTurnId: input.clientTurnId.trim(),
      userClientMessageId: input.userClientMessageId.trim(),
      assistantClientMessageId: input.assistantClientMessageId.trim(),
      userContent: input.userContent.trim(),
    }),
  )}`;
}

// ---------------------------------------------------------------------------

function defaultIdFactory(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 发送前先生成稳定身份：turn id、两条 message id 和 requestHash 都在这里定下来，
 * 之后无论重试、查询还是进程恢复，用的都是同一套 id —— 这是「不重复生成、不重复扣费」的地基。
 */
export function createConversationTurn(input: {
  scope: RecoveryScope;
  storyId: number;
  userContent: string;
  idFactory?: () => string;
  now?: number;
}): ConversationRecoveryTurn {
  const userContent = input.userContent.trim();
  if (!userContent) throw new Error("聊天内容不能为空");
  const suffix = (input.idFactory ?? defaultIdFactory)();
  const clientTurnId = `turn-${suffix}`;
  const userClientMessageId = `user-${suffix}`;
  const assistantClientMessageId = `assistant-${suffix}`;
  const now = input.now ?? Date.now();
  return {
    scope: input.scope,
    storyId: input.storyId,
    clientTurnId,
    requestHash: computeTurnRequestHash({
      storyId: input.storyId,
      clientTurnId,
      userClientMessageId,
      assistantClientMessageId,
      userContent,
    }),
    userClientMessageId,
    assistantClientMessageId,
    userContent,
    assistantContent: null,
    status: "replying",
    error: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + RECOVERY_TTL_MS,
  };
}

export function applyConversationTurnEvent(
  turn: ConversationRecoveryTurn,
  event: ConversationTurnEvent,
): ConversationRecoveryTurn {
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
      // 关键：保留原 turn 身份和已有内容。未知结果只能去查，不能重跑。
      return {
        ...turn,
        status: "generation-unknown",
        error: event.error,
        updatedAt: event.now,
      };
    case "append_started":
      if (!turn.assistantContent) return turn;
      return { ...turn, status: "persisting", error: null, updatedAt: event.now };
    case "append_failed":
      return {
        ...turn,
        status: "persistence-failed",
        error: event.error,
        updatedAt: event.now,
      };
    case "synced":
      return { ...turn, status: "synced", error: null, updatedAt: event.now };
  }
}

/** 正在占用一次生成额度的轮次：此时不允许再发新消息。 */
export function hasPendingTurn(
  turns: readonly ConversationRecoveryTurn[],
): boolean {
  return turns.some(
    turn => turn.status === "replying" || turn.status === "persisting",
  );
}

/** 结果未知的轮次：必须先查询，不能靠再发一次来「碰运气」。 */
export function findUnknownTurn(
  turns: readonly ConversationRecoveryTurn[],
): ConversationRecoveryTurn | null {
  return turns.find(turn => turn.status === "generation-unknown") ?? null;
}

export function normalizeConversationTurn(
  value: unknown,
  scope: RecoveryScope,
  storyId: number,
): ConversationRecoveryTurn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const turn = value as Partial<ConversationRecoveryTurn>;
  if (
    turn.scope !== scope ||
    turn.storyId !== storyId ||
    !Number.isSafeInteger(turn.storyId) ||
    (turn.storyId ?? 0) <= 0 ||
    typeof turn.clientTurnId !== "string" ||
    typeof turn.requestHash !== "string" ||
    typeof turn.userClientMessageId !== "string" ||
    typeof turn.assistantClientMessageId !== "string" ||
    typeof turn.userContent !== "string" ||
    !turn.userContent.trim() ||
    turn.userContent.length > MAX_TURN_CONTENT_LENGTH ||
    (turn.assistantContent !== null && typeof turn.assistantContent !== "string") ||
    typeof turn.status !== "string" ||
    !TURN_STATUSES.includes(turn.status as ConversationTurnStatus) ||
    typeof turn.createdAt !== "number" ||
    !Number.isFinite(turn.createdAt) ||
    typeof turn.updatedAt !== "number" ||
    !Number.isFinite(turn.updatedAt) ||
    typeof turn.expiresAt !== "number" ||
    !Number.isFinite(turn.expiresAt)
  ) {
    return null;
  }
  const normalized: ConversationRecoveryTurn = {
    scope,
    storyId,
    clientTurnId: turn.clientTurnId.trim(),
    requestHash: turn.requestHash.trim(),
    userClientMessageId: turn.userClientMessageId.trim(),
    assistantClientMessageId: turn.assistantClientMessageId.trim(),
    userContent: turn.userContent,
    assistantContent: turn.assistantContent ?? null,
    status: turn.status as ConversationTurnStatus,
    error: typeof turn.error === "string" ? turn.error : null,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
    expiresAt: turn.expiresAt,
  };
  // 幂等键必须自洽：被改过的恢复记录不能拿去当作「同一轮」再提交。
  if (
    !normalized.clientTurnId ||
    !normalized.userClientMessageId ||
    !normalized.assistantClientMessageId ||
    normalized.requestHash !==
      computeTurnRequestHash({
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

export function mergeConversationProjection(input: {
  serverMessages: readonly ConversationServerMessage[];
  recoveryTurns: readonly ConversationRecoveryTurn[];
}): {
  messages: ConversationViewMessage[];
  remainingRecoveryTurns: ConversationRecoveryTurn[];
} {
  // 排序用「时间戳 + 插入顺序」，不用 id 字典序：
  // mock/极快的回答会让一轮里 user 与 assistant 的时间戳相同，
  // 按 id 排会把 "assistant-x" 排到 "user-x" 前面，看起来像先答后问。
  let sequence = 0;
  const ordered: Array<{ message: ConversationViewMessage; sequence: number }> = [];
  const push = (message: ConversationViewMessage): void => {
    ordered.push({ message, sequence: (sequence += 1) });
  };

  input.serverMessages
    .filter(
      (
        message,
      ): message is ConversationServerMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .forEach(message => {
      push({
        id: message.clientMessageId ?? `server-message:${message.id}`,
        role: message.role,
        content: message.content,
        timestamp: Date.parse(message.createdAt) || message.id,
        source: "server" as const,
      });
    });
  const seen = new Set(ordered.map(entry => entry.message.id));
  const remainingRecoveryTurns: ConversationRecoveryTurn[] = [];
  for (const turn of input.recoveryTurns) {
    const hasUser = seen.has(turn.userClientMessageId);
    const hasAssistant = seen.has(turn.assistantClientMessageId);
    if (hasUser && hasAssistant) continue;
    remainingRecoveryTurns.push(turn);
    if (!hasUser) {
      push({
        id: turn.userClientMessageId,
        role: "user",
        content: turn.userContent,
        timestamp: turn.createdAt,
        source: "recovery",
        turnStatus: turn.status,
      });
      seen.add(turn.userClientMessageId);
    }
    if (!hasAssistant && turn.assistantContent) {
      push({
        id: turn.assistantClientMessageId,
        role: "assistant",
        content: turn.assistantContent,
        timestamp: turn.updatedAt,
        source: "recovery",
        turnStatus: turn.status,
      });
      seen.add(turn.assistantClientMessageId);
    }
  }
  ordered.sort(
    (left, right) =>
      left.message.timestamp - right.message.timestamp ||
      left.sequence - right.sequence,
  );
  return {
    messages: ordered.map(entry => entry.message),
    remainingRecoveryTurns,
  };
}
