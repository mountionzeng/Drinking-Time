import { and, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import type { SelectionContext } from "../../shared/selectionContext";
import {
  computeStoryConversationTurnRequestHash,
  type StoryConversationTurn,
} from "../../shared/promptLineage";
import {
  storyConversationMessages,
  storyConversationTurns,
  storyConversations,
  storyMessageReferences,
  type StoryBody,
} from "../../drizzle/schema";
import {
  getStoryById,
  getStoryVideoTakeRanges,
  getVideoTakeById,
  getGeneratedImageById,
} from "../db";
import { getDb } from "../db";
import {
  createPersistentLocalPromptLineageStore,
  loadStoryPromptAggregate,
  PromptLineageIdempotencyConflictError,
  PromptLineageOwnershipError,
  PromptLineageValidationError,
  withPersistentLocalConversationLock,
} from "./promptLineageStore";
import {
  replyFromStoryAgent,
  type ShotDraft,
  type StoryCardContextPayload,
} from "../archive/storyAgent";

type ConversationOwner = {
  storyId: number;
  userId: number;
};

export type AppendStoryConversationTurnInput = ConversationOwner & {
  userMessage: {
    clientMessageId: string;
    content: string;
    selection?: SelectionContext | null;
  };
  assistantMessage: {
    clientMessageId: string;
    content: string;
    candidateRevisionId?: number | null;
  };
};

export class StoryConversationIdempotencyConflictError extends Error {
  constructor(message = "对话消息标识已被另一轮内容使用") {
    super(message);
    this.name = "StoryConversationIdempotencyConflictError";
  }
}

const MOBILE_TURN_UNKNOWN_AFTER_MS = 5 * 60_000;

type MobileTurnIdentity = ConversationOwner & {
  clientTurnId: string;
  requestHash: string;
};

export type GenerateMobileStoryConversationTurnInput = MobileTurnIdentity & {
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
  retryFailed?: boolean;
  /** Deterministic clock override for tests. */
  now?: number;
};

type MobileReplyInput = ConversationOwner & {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  summary: string;
  currentShots: ShotDraft[];
  storyCards: StoryCardContextPayload[];
  existingCardCount: number;
};

type MobileReplyResult = {
  reply: string;
  modelLabel?: string;
};

type MobileTurnGenerationResult = {
  status: StoryConversationTurn["generationStatus"];
  turn: StoryConversationTurn;
  staleContext: boolean;
};

type MobileTurnStatusResult =
  | MobileTurnGenerationResult
  | { status: "missing"; turn: null; staleContext: false };

function translateIdempotencyError(error: unknown): never {
  if (error instanceof PromptLineageIdempotencyConflictError) {
    throw new StoryConversationIdempotencyConflictError(error.message);
  }
  throw error;
}

function inputNow(value?: number): { date: Date; iso: string } {
  const date = new Date(value ?? Date.now());
  return { date, iso: date.toISOString() };
}

function normalizeMobileTurnInput(
  input: GenerateMobileStoryConversationTurnInput,
): GenerateMobileStoryConversationTurnInput {
  const normalized = {
    ...input,
    clientTurnId: input.clientTurnId.trim(),
    requestHash: input.requestHash.trim(),
    userClientMessageId: input.userClientMessageId.trim(),
    assistantClientMessageId: input.assistantClientMessageId.trim(),
    userContent: input.userContent.trim(),
  };
  if (
    !normalized.clientTurnId ||
    !normalized.requestHash ||
    !normalized.userClientMessageId ||
    !normalized.assistantClientMessageId ||
    !normalized.userContent
  ) {
    throw new PromptLineageValidationError("对话轮参数不能为空");
  }
  const expectedHash = computeStoryConversationTurnRequestHash(normalized);
  if (normalized.requestHash !== expectedHash) {
    throw new StoryConversationIdempotencyConflictError(
      "对话轮请求哈希与内容不匹配",
    );
  }
  if (
    normalized.userClientMessageId === normalized.assistantClientMessageId
  ) {
    throw new StoryConversationIdempotencyConflictError(
      "同一轮的用户消息和助手消息必须使用不同标识",
    );
  }
  return normalized;
}

function turnFromDbRow(
  row: typeof storyConversationTurns.$inferSelect,
): StoryConversationTurn {
  const iso = (value: Date | string) =>
    value instanceof Date ? value.toISOString() : value;
  return {
    ...row,
    claimedAt: iso(row.claimedAt),
    updatedAt: iso(row.updatedAt),
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    appendedAt: row.appendedAt ? iso(row.appendedAt) : null,
  };
}

function assertExactTurnIdentity(
  turn: StoryConversationTurn,
  input: GenerateMobileStoryConversationTurnInput,
): void {
  if (
    turn.requestHash !== input.requestHash ||
    turn.userClientMessageId !== input.userClientMessageId ||
    turn.assistantClientMessageId !== input.assistantClientMessageId ||
    turn.userContent !== input.userContent
  ) {
    throw new StoryConversationIdempotencyConflictError(
      "对话轮标识已被另一组内容使用",
    );
  }
}

async function assertOwnedConversationAggregate(owner: ConversationOwner) {
  const story = await getStoryById(owner.storyId, owner.userId);
  if (!story) {
    throw new PromptLineageOwnershipError("故事不存在或不属于当前用户");
  }
  const aggregate = await loadStoryPromptAggregate(owner);
  if (!aggregate) {
    throw new PromptLineageValidationError("故事提示词尚未迁移");
  }
  return { story, aggregate };
}

function mobileReplyStoryContext(
  story: NonNullable<Awaited<ReturnType<typeof getStoryById>>>,
): Pick<
  MobileReplyInput,
  "summary" | "currentShots" | "storyCards" | "existingCardCount"
> {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Partial<StoryBody>)
      : {};
  const cards = Array.isArray(body.cards) ? body.cards : [];
  const shots = Array.isArray(body.shots) ? body.shots : [];
  const storyCards: StoryCardContextPayload[] = cards.flatMap(card =>
    typeof card?.content === "string"
      ? [
          {
            content: card.content,
            sourceQuote: card.sourceQuote,
            emotion: card.emotion,
            emotionOptions: card.emotionOptions,
            emotionBlend: card.emotionBlend,
            intensity: card.intensity,
            direction: card.direction,
            complexity: card.complexity,
            trigger: card.trigger,
            dramaticFunction: card.dramaticFunction,
            personalTrace: card.personalTrace,
            retrievalQuery: card.retrievalQuery,
            themeHints: card.themeHints,
            outlierSignal: card.outlierSignal,
            softMembership: card.softMembership,
          },
        ]
      : [],
  );
  const currentShots: ShotDraft[] = shots.map((shot, index) => ({
    shotNo: Number.isFinite(shot.shotNo) ? shot.shotNo : index + 1,
    stableShotId: shot.stableShotId ?? shot.shotIdentity,
    subject: shot.subject ?? "",
    action: shot.action ?? "",
    dialogue: shot.dialogue ?? "",
    shotType: shot.shotType ?? "",
    cameraAngle: shot.cameraAngle ?? "",
    cameraMove: shot.cameraMove ?? "",
    location: shot.location ?? "",
    timeLight: shot.timeLight ?? "",
    mood: shot.mood ?? shot.emotion ?? "",
    sound: shot.sound ?? "",
    styleRef: shot.styleRef ?? "",
    intent: shot.intent ?? undefined,
  }));
  const summary = [
    story.title?.trim() ? `当前故事：${story.title.trim()}` : "",
    story.logline?.trim() ? `一句话：${story.logline.trim()}` : "",
    story.theme?.trim() ? `主题：${story.theme.trim()}` : "",
    story.arc?.trim() ? `情绪弧线：${story.arc.trim()}` : "",
    story.summary?.trim() ? `摘要：${story.summary.trim()}` : "",
    currentShots.length > 0 ? `当前共 ${currentShots.length} 个镜头。` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    summary,
    currentShots,
    storyCards,
    existingCardCount: storyCards.length,
  };
}

async function isTurnContextStale(
  owner: ConversationOwner,
  turn: StoryConversationTurn,
): Promise<boolean> {
  const aggregate = await loadStoryPromptAggregate(owner);
  const latestOtherMessageId = (aggregate?.messages ?? [])
    .filter(message => message.turnId !== turn.id)
    .reduce<number | null>(
      (latest, message) =>
        latest == null || message.id > latest ? message.id : latest,
      null,
    );
  return latestOtherMessageId !== turn.contextMessageId;
}

async function mobileTurnResult(
  owner: ConversationOwner,
  turn: StoryConversationTurn,
): Promise<MobileTurnGenerationResult> {
  return {
    status: turn.generationStatus,
    turn,
    staleContext: await isTurnContextStale(owner, turn),
  };
}

type StoryDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function findDbTurn(
  db: StoryDb,
  owner: ConversationOwner,
  clientTurnId: string,
) {
  const [row] = await db
    .select()
    .from(storyConversationTurns)
    .where(
      and(
        eq(storyConversationTurns.storyId, owner.storyId),
        eq(storyConversationTurns.userId, owner.userId),
        eq(storyConversationTurns.clientTurnId, clientTurnId),
      ),
    )
    .limit(1);
  return row ? turnFromDbRow(row) : null;
}

async function claimDbMobileTurn(
  db: StoryDb,
  input: GenerateMobileStoryConversationTurnInput,
  claimToken: string,
  now: { date: Date; iso: string },
): Promise<{ turn: StoryConversationTurn; claimed: boolean }> {
  const owner = { storyId: input.storyId, userId: input.userId };
  await db
    .insert(storyConversations)
    .values({ ...owner, createdAt: now.date, updatedAt: now.date })
    .onDuplicateKeyUpdate({ set: { updatedAt: now.date } });
  const [conversation] = await db
    .select()
    .from(storyConversations)
    .where(
      and(
        eq(storyConversations.storyId, owner.storyId),
        eq(storyConversations.userId, owner.userId),
      ),
    )
    .limit(1);
  if (!conversation) {
    throw new PromptLineageValidationError("无法创建故事会话");
  }

  let existing = await findDbTurn(db, owner, input.clientTurnId);
  if (existing) {
    assertExactTurnIdentity(existing, input);
    if (existing.generationStatus === "failed" && input.retryFailed) {
      const [updated] = await db
        .update(storyConversationTurns)
        .set({
          generationStatus: "pending",
          generationAttempt: sql`${storyConversationTurns.generationAttempt} + 1`,
          claimToken,
          failureMessage: null,
          claimedAt: now.date,
          updatedAt: now.date,
        })
        .where(
          and(
            eq(storyConversationTurns.id, existing.id),
            eq(storyConversationTurns.generationStatus, "failed"),
          ),
        );
      existing = (await findDbTurn(db, owner, input.clientTurnId))!;
      return { turn: existing, claimed: updated.affectedRows === 1 };
    }
    if (existing.generationStatus === "pending") {
      const staleBefore = new Date(
        now.date.getTime() - MOBILE_TURN_UNKNOWN_AFTER_MS,
      );
      await db
        .update(storyConversationTurns)
        .set({
          generationStatus: "unknown",
          claimToken: null,
          failureMessage: "生成结果未知，请复制内容后新建一轮",
          updatedAt: now.date,
        })
        .where(
          and(
            eq(storyConversationTurns.id, existing.id),
            eq(storyConversationTurns.generationStatus, "pending"),
            lt(storyConversationTurns.claimedAt, staleBefore),
          ),
        );
      existing = (await findDbTurn(db, owner, input.clientTurnId))!;
    }
    return { turn: existing, claimed: false };
  }

  const [turnIdentityCollision] = await db
    .select({ id: storyConversationTurns.id })
    .from(storyConversationTurns)
    .where(
      and(
        eq(storyConversationTurns.storyId, owner.storyId),
        eq(storyConversationTurns.userId, owner.userId),
        or(
          eq(
            storyConversationTurns.userClientMessageId,
            input.userClientMessageId,
          ),
          eq(
            storyConversationTurns.assistantClientMessageId,
            input.assistantClientMessageId,
          ),
          eq(
            storyConversationTurns.userClientMessageId,
            input.assistantClientMessageId,
          ),
          eq(
            storyConversationTurns.assistantClientMessageId,
            input.userClientMessageId,
          ),
        ),
      ),
    )
    .limit(1);
  const [legacyMessageCollision] = await db
    .select({ id: storyConversationMessages.id })
    .from(storyConversationMessages)
    .where(
      and(
        eq(storyConversationMessages.storyId, owner.storyId),
        eq(storyConversationMessages.userId, owner.userId),
        or(
          eq(
            storyConversationMessages.clientMessageId,
            input.userClientMessageId,
          ),
          eq(
            storyConversationMessages.clientMessageId,
            input.assistantClientMessageId,
          ),
        ),
      ),
    )
    .limit(1);
  if (turnIdentityCollision || legacyMessageCollision) {
    throw new StoryConversationIdempotencyConflictError();
  }

  const aggregate = await loadStoryPromptAggregate(owner);
  const contextMessageId = (aggregate?.messages ?? []).reduce<number | null>(
    (latest, message) =>
      latest == null || message.id > latest ? message.id : latest,
    null,
  );
  try {
    const [inserted] = await db.insert(storyConversationTurns).values({
      ...owner,
      conversationId: conversation.id,
      clientTurnId: input.clientTurnId,
      requestHash: input.requestHash,
      userClientMessageId: input.userClientMessageId,
      assistantClientMessageId: input.assistantClientMessageId,
      userContent: input.userContent,
      assistantContent: null,
      generationStatus: "pending",
      appendStatus: "pending",
      generationAttempt: 1,
      contextMessageId,
      claimToken,
      failureMessage: null,
      claimedAt: now.date,
      updatedAt: now.date,
      completedAt: null,
      appendedAt: null,
    });
    const [created] = await db
      .select()
      .from(storyConversationTurns)
      .where(eq(storyConversationTurns.id, inserted.insertId))
      .limit(1);
    if (!created) throw new PromptLineageValidationError("无法创建对话轮");
    return { turn: turnFromDbRow(created), claimed: true };
  } catch (error) {
    const raced = await findDbTurn(db, owner, input.clientTurnId);
    if (raced) {
      assertExactTurnIdentity(raced, input);
      return { turn: raced, claimed: false };
    }
    const [collision] = await db
      .select({ id: storyConversationTurns.id })
      .from(storyConversationTurns)
      .where(
        and(
          eq(storyConversationTurns.storyId, owner.storyId),
          eq(storyConversationTurns.userId, owner.userId),
          or(
            eq(
              storyConversationTurns.userClientMessageId,
              input.userClientMessageId,
            ),
            eq(
              storyConversationTurns.assistantClientMessageId,
              input.assistantClientMessageId,
            ),
          ),
        ),
      )
      .limit(1);
    if (collision) throw new StoryConversationIdempotencyConflictError();
    throw error;
  }
}

async function claimMobileTurn(
  input: GenerateMobileStoryConversationTurnInput,
  claimToken: string,
  now: { date: Date; iso: string },
) {
  const db = await getDb();
  if (db) return claimDbMobileTurn(db, input, claimToken, now);
  try {
    return await withPersistentLocalConversationLock(async () => {
      const store = await createPersistentLocalPromptLineageStore();
      return store.reserveConversationTurn(
        { storyId: input.storyId, userId: input.userId },
        {
          ...input,
          claimToken,
          now: now.iso,
          staleAfterMs: MOBILE_TURN_UNKNOWN_AFTER_MS,
        },
      );
    });
  } catch (error) {
    translateIdempotencyError(error);
  }
}

async function readMobileTurn(
  input: MobileTurnIdentity & { now?: number },
): Promise<StoryConversationTurn | null> {
  const now = inputNow(input.now);
  const owner = { storyId: input.storyId, userId: input.userId };
  const db = await getDb();
  if (!db) {
    try {
      return await withPersistentLocalConversationLock(async () => {
        const store = await createPersistentLocalPromptLineageStore();
        return store.getConversationTurn(owner, {
          clientTurnId: input.clientTurnId,
          requestHash: input.requestHash,
          now: now.iso,
          staleAfterMs: MOBILE_TURN_UNKNOWN_AFTER_MS,
        });
      });
    } catch (error) {
      translateIdempotencyError(error);
    }
  }
  let turn = await findDbTurn(db, owner, input.clientTurnId.trim());
  if (!turn) return null;
  if (turn.requestHash !== input.requestHash.trim()) {
    throw new StoryConversationIdempotencyConflictError(
      "对话轮标识已被另一组内容使用",
    );
  }
  if (turn.generationStatus === "pending") {
    await db
      .update(storyConversationTurns)
      .set({
        generationStatus: "unknown",
        claimToken: null,
        failureMessage: "生成结果未知，请复制内容后新建一轮",
        updatedAt: now.date,
      })
      .where(
        and(
          eq(storyConversationTurns.id, turn.id),
          eq(storyConversationTurns.generationStatus, "pending"),
          lt(
            storyConversationTurns.claimedAt,
            new Date(now.date.getTime() - MOBILE_TURN_UNKNOWN_AFTER_MS),
          ),
        ),
      );
    turn = (await findDbTurn(db, owner, input.clientTurnId.trim()))!;
  }
  return turn;
}

async function settleMobileTurn(
  input: MobileTurnIdentity & {
    claimToken: string;
    assistantContent?: string;
    failureMessage?: string;
    now: { date: Date; iso: string };
  },
): Promise<StoryConversationTurn> {
  const owner = { storyId: input.storyId, userId: input.userId };
  const db = await getDb();
  if (!db) {
    try {
      return await withPersistentLocalConversationLock(async () => {
        const store = await createPersistentLocalPromptLineageStore();
        if (input.assistantContent != null) {
          return store.completeConversationTurn(owner, {
            clientTurnId: input.clientTurnId,
            requestHash: input.requestHash,
            claimToken: input.claimToken,
            assistantContent: input.assistantContent!,
            now: input.now.iso,
          });
        }
        return store.failConversationTurn(owner, {
          clientTurnId: input.clientTurnId,
          requestHash: input.requestHash,
          claimToken: input.claimToken,
          failureMessage: input.failureMessage ?? "模型生成失败",
          now: input.now.iso,
        });
      });
    } catch (error) {
      translateIdempotencyError(error);
    }
  }
  if (input.assistantContent != null) {
    await db
      .update(storyConversationTurns)
      .set({
        assistantContent: input.assistantContent,
        generationStatus: "completed",
        claimToken: null,
        failureMessage: null,
        completedAt: input.now.date,
        updatedAt: input.now.date,
      })
      .where(
        and(
          eq(storyConversationTurns.storyId, owner.storyId),
          eq(storyConversationTurns.userId, owner.userId),
          eq(storyConversationTurns.clientTurnId, input.clientTurnId),
          eq(storyConversationTurns.requestHash, input.requestHash),
          eq(storyConversationTurns.generationStatus, "pending"),
          eq(storyConversationTurns.claimToken, input.claimToken),
        ),
      );
  } else {
    await db
      .update(storyConversationTurns)
      .set({
        generationStatus: "failed",
        claimToken: null,
        failureMessage: input.failureMessage ?? "模型生成失败",
        updatedAt: input.now.date,
      })
      .where(
        and(
          eq(storyConversationTurns.storyId, owner.storyId),
          eq(storyConversationTurns.userId, owner.userId),
          eq(storyConversationTurns.clientTurnId, input.clientTurnId),
          eq(storyConversationTurns.requestHash, input.requestHash),
          eq(storyConversationTurns.generationStatus, "pending"),
          eq(storyConversationTurns.claimToken, input.claimToken),
        ),
      );
  }
  const turn = await findDbTurn(db, owner, input.clientTurnId);
  if (!turn) {
    throw new StoryConversationIdempotencyConflictError(
      "对话轮在生成过程中消失",
    );
  }
  return turn;
}

export async function generateMobileStoryConversationTurn(
  rawInput: GenerateMobileStoryConversationTurnInput,
  dependencies: {
    generateReply?: (input: MobileReplyInput) => Promise<MobileReplyResult>;
  } = {},
): Promise<MobileTurnGenerationResult> {
  const input = normalizeMobileTurnInput(rawInput);
  const owner = { storyId: input.storyId, userId: input.userId };
  const { story } = await assertOwnedConversationAggregate(owner);
  const now = inputNow(input.now);
  const claimToken = nanoid();
  const claim = await claimMobileTurn(input, claimToken, now);
  if (!claim.claimed) return mobileTurnResult(owner, claim.turn);

  const aggregate = await loadStoryPromptAggregate(owner);
  const history = (aggregate?.messages ?? [])
    .filter(
      message =>
        (message.role === "user" || message.role === "assistant") &&
        (claim.turn.contextMessageId == null ||
          message.id <= claim.turn.contextMessageId),
    )
    .map(message => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
  const generateReply =
    dependencies.generateReply ??
    (async (replyInput: MobileReplyInput) =>
      replyFromStoryAgent({
        message: replyInput.message,
        history: replyInput.history,
        summary: replyInput.summary,
        currentShots: replyInput.currentShots,
        storyCards: replyInput.storyCards,
        existingCardCount: replyInput.existingCardCount,
        userId: replyInput.userId,
      }));
  let generated: MobileReplyResult;
  try {
    generated = await generateReply({
      ...owner,
      message: input.userContent,
      history,
      ...mobileReplyStoryContext(story),
    });
    const assistantContent = generated.reply?.trim();
    if (!assistantContent || generated.modelLabel === "请求失败") {
      throw new Error(assistantContent || "模型没有返回有效回答");
    }
  } catch (error) {
    const turn = await settleMobileTurn({
      ...owner,
      clientTurnId: input.clientTurnId,
      requestHash: input.requestHash,
      claimToken,
      failureMessage:
        error instanceof Error ? error.message : "模型生成失败",
      now: inputNow(input.now),
    });
    return mobileTurnResult(owner, turn);
  }
  const turn = await settleMobileTurn({
    ...owner,
    clientTurnId: input.clientTurnId,
    requestHash: input.requestHash,
    claimToken,
    assistantContent: generated.reply.trim(),
    now: inputNow(input.now),
  });
  return mobileTurnResult(owner, turn);
}

export async function getMobileStoryConversationTurnStatus(
  input: MobileTurnIdentity & { now?: number },
): Promise<MobileTurnStatusResult> {
  const owner = { storyId: input.storyId, userId: input.userId };
  await assertOwnedConversationAggregate(owner);
  const turn = await readMobileTurn(input);
  if (!turn) return { status: "missing", turn: null, staleContext: false };
  return mobileTurnResult(owner, turn);
}

export async function appendMobileStoryConversationTurn(
  input: MobileTurnIdentity & { now?: number },
): Promise<{
  status: "appended";
  turn: StoryConversationTurn;
  staleContext: boolean;
}> {
  const owner = { storyId: input.storyId, userId: input.userId };
  await assertOwnedConversationAggregate(owner);
  const now = inputNow(input.now);
  const db = await getDb();
  let turn: StoryConversationTurn;
  if (!db) {
    try {
      turn = await withPersistentLocalConversationLock(async () => {
        const store = await createPersistentLocalPromptLineageStore();
        return store.appendReservedConversationTurn(owner, {
          clientTurnId: input.clientTurnId,
          requestHash: input.requestHash,
          now: now.iso,
        });
      });
    } catch (error) {
      translateIdempotencyError(error);
    }
  } else {
    turn = await db.transaction(async tx => {
      const [conversation] = await tx
        .select()
        .from(storyConversations)
        .where(
          and(
            eq(storyConversations.storyId, owner.storyId),
            eq(storyConversations.userId, owner.userId),
          ),
        )
        .limit(1)
        .for("update");
      if (!conversation) {
        throw new PromptLineageValidationError("故事会话不存在");
      }
      const [row] = await tx
        .select()
        .from(storyConversationTurns)
        .where(
          and(
            eq(storyConversationTurns.storyId, owner.storyId),
            eq(storyConversationTurns.userId, owner.userId),
            eq(storyConversationTurns.clientTurnId, input.clientTurnId.trim()),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !row ||
        row.conversationId !== conversation.id ||
        row.requestHash !== input.requestHash.trim()
      ) {
        throw new StoryConversationIdempotencyConflictError(
          "对话轮标识与追加请求不匹配",
        );
      }
      const current = turnFromDbRow(row);
      if (
        current.generationStatus !== "completed" ||
        !current.assistantContent
      ) {
        throw new PromptLineageValidationError("模型回答尚未完成，不能追加对话");
      }
      if (current.appendStatus === "appended") return current;

      const existing = await tx
        .select()
        .from(storyConversationMessages)
        .where(
          and(
            eq(storyConversationMessages.storyId, owner.storyId),
            eq(storyConversationMessages.userId, owner.userId),
            or(
              eq(
                storyConversationMessages.clientMessageId,
                current.userClientMessageId,
              ),
              eq(
                storyConversationMessages.clientMessageId,
                current.assistantClientMessageId,
              ),
            ),
          ),
        );
      if (existing.length > 0) {
        const userMessage = existing.find(
          message => message.clientMessageId === current.userClientMessageId,
        );
        const assistantMessage = existing.find(
          message =>
            message.clientMessageId === current.assistantClientMessageId,
        );
        const exact =
          existing.length === 2 &&
          userMessage?.turnId === current.id &&
          userMessage.role === "user" &&
          userMessage.content === current.userContent &&
          assistantMessage?.turnId === current.id &&
          assistantMessage.role === "assistant" &&
          assistantMessage.content === current.assistantContent;
        if (!exact) {
          throw new StoryConversationIdempotencyConflictError(
            "检测到不完整或冲突的历史对话轮",
          );
        }
      } else {
        await tx.insert(storyConversationMessages).values([
          {
            ...owner,
            conversationId: current.conversationId,
            turnId: current.id,
            role: "user",
            content: current.userContent,
            source: "mobile-story-agent",
            clientMessageId: current.userClientMessageId,
            candidateRevisionId: null,
            createdAt: now.date,
          },
          {
            ...owner,
            conversationId: current.conversationId,
            turnId: current.id,
            role: "assistant",
            content: current.assistantContent,
            source: "mobile-story-agent",
            clientMessageId: current.assistantClientMessageId,
            candidateRevisionId: null,
            createdAt: now.date,
          },
        ]);
      }
      await tx
        .update(storyConversationTurns)
        .set({ appendStatus: "appended", appendedAt: now.date, updatedAt: now.date })
        .where(eq(storyConversationTurns.id, current.id));
      await tx
        .update(storyConversations)
        .set({ updatedAt: now.date })
        .where(eq(storyConversations.id, current.conversationId));
      return {
        ...current,
        appendStatus: "appended" as const,
        appendedAt: now.iso,
        updatedAt: now.iso,
      };
    });
  }
  return {
    status: "appended",
    turn,
    staleContext: await isTurnContextStale(owner, turn),
  };
}

function referenceObjectId(selection: SelectionContext): string {
  if (selection.rangeId != null) return String(selection.rangeId);
  if (selection.imageId != null) return String(selection.imageId);
  if (selection.videoTakeId != null) return String(selection.videoTakeId);
  return selection.stableShotId?.trim() || selection.sourceId;
}

export async function validateStorySelectionContext(
  owner: ConversationOwner,
  selection: SelectionContext,
): Promise<SelectionContext> {
  if (selection.storyId != null && selection.storyId !== owner.storyId) {
    throw new PromptLineageOwnershipError("选择引用不属于当前故事");
  }
  const aggregate = await loadStoryPromptAggregate(owner);
  if (!aggregate) {
    throw new PromptLineageValidationError("故事提示词尚未迁移");
  }
  let stableShotId = selection.stableShotId?.trim() || null;
  let imageId = selection.imageId ?? null;
  let videoTakeId = selection.videoTakeId ?? null;
  let rangeId = selection.rangeId ?? null;
  if (selection.imageId != null) {
    const image = await getGeneratedImageById(selection.imageId);
    if (
      !image ||
      image.storyId !== owner.storyId ||
      image.userId !== owner.userId ||
      (selection.stableShotId != null &&
        image.shotIdentity != null &&
        image.shotIdentity !== selection.stableShotId)
    ) {
      throw new PromptLineageOwnershipError("图片引用不属于当前故事");
    }
    stableShotId = stableShotId ?? image.shotIdentity;
    imageId = image.id;
  }
  if (selection.rangeId != null) {
    const ranges = await getStoryVideoTakeRanges(owner.storyId, owner.userId);
    const range = ranges.find(candidate => candidate.id === selection.rangeId);
    if (
      !range ||
      (videoTakeId != null && range.takeId !== videoTakeId) ||
      (stableShotId != null && range.stableShotId !== stableShotId)
    ) {
      throw new PromptLineageOwnershipError("时间范围不属于当前故事");
    }
    stableShotId = stableShotId ?? range.stableShotId;
    videoTakeId = videoTakeId ?? range.takeId;
    rangeId = range.id;
  }
  if (videoTakeId != null) {
    const take = await getVideoTakeById(videoTakeId, owner.userId);
    if (
      !take ||
      take.storyId !== owner.storyId ||
      (stableShotId != null && take.stableShotId !== stableShotId)
    ) {
      throw new PromptLineageOwnershipError("视频引用不属于当前故事");
    }
    stableShotId = stableShotId ?? take.stableShotId;
    videoTakeId = take.id;
  }
  if (
    stableShotId &&
    !aggregate.nodes.some(node => node.stableShotId === stableShotId)
  ) {
    throw new PromptLineageOwnershipError("镜头引用不属于当前故事");
  }
  const objectVersion =
    imageId != null
      ? `image:${imageId}`
      : videoTakeId != null
        ? `video:${videoTakeId}`
        : (selection.objectVersion ?? null);
  const sourceId =
    rangeId != null
      ? String(rangeId)
      : imageId != null
        ? String(imageId)
        : videoTakeId != null
          ? String(videoTakeId)
          : selection.sourceId;
  return {
    ...selection,
    sourceId,
    objectVersion,
    storyId: owner.storyId,
    stableShotId,
    imageId,
    videoTakeId,
    rangeId,
  };
}

export async function listStoryConversation(owner: ConversationOwner) {
  const aggregate = await loadStoryPromptAggregate(owner);
  if (!aggregate) {
    throw new PromptLineageValidationError("故事提示词尚未迁移");
  }
  return {
    conversation: aggregate.conversation,
    messages: aggregate.messages,
    references: aggregate.messageReferences,
    candidates: aggregate.messages.flatMap(message => {
      if (message.candidateRevisionId == null) return [];
      const revision = aggregate.revisions.find(
        item => item.id === message.candidateRevisionId,
      );
      const node = revision
        ? aggregate.nodes.find(item => item.id === revision.nodeId)
        : null;
      if (!revision || !node) return [];
      return [
        {
          messageId: message.id,
          revisionId: revision.id,
          nodeId: node.id,
          expectedVersion: aggregate.state.version,
          label: node.dimension,
          status:
            revision.status === "candidate"
              ? ("pending" as const)
              : revision.status,
        },
      ];
    }),
  };
}

export async function appendStoryConversationTurn(
  input: AppendStoryConversationTurnInput,
) {
  const owner = { storyId: input.storyId, userId: input.userId };
  const userContent = input.userMessage.content.trim();
  const assistantContent = input.assistantMessage.content.trim();
  if (!userContent || !assistantContent) {
    throw new PromptLineageValidationError("对话消息不能为空");
  }
  const selection = input.userMessage.selection
    ? await validateStorySelectionContext(owner, input.userMessage.selection)
    : null;
  if (input.assistantMessage.candidateRevisionId != null) {
    const aggregate = await loadStoryPromptAggregate(owner);
    if (
      !aggregate?.revisions.some(
        revision =>
          revision.id === input.assistantMessage.candidateRevisionId,
      )
    ) {
      throw new PromptLineageOwnershipError(
        "候选提示词引用不属于当前故事",
      );
    }
  }

  if (
    input.userMessage.clientMessageId.trim() ===
    input.assistantMessage.clientMessageId.trim()
  ) {
    throw new StoryConversationIdempotencyConflictError(
      "同一轮的用户消息和助手消息必须使用不同标识",
    );
  }
  const existingAggregate = await loadStoryPromptAggregate(owner);
  const intended = [
    {
      role: "user" as const,
      clientMessageId: input.userMessage.clientMessageId.trim(),
      content: userContent,
      candidateRevisionId: null,
    },
    {
      role: "assistant" as const,
      clientMessageId: input.assistantMessage.clientMessageId.trim(),
      content: assistantContent,
      candidateRevisionId: input.assistantMessage.candidateRevisionId ?? null,
    },
  ];
  const existing = intended.map(item =>
    existingAggregate?.messages.find(
      message => message.clientMessageId === item.clientMessageId,
    ),
  );
  if (existing.some(Boolean)) {
    if (!existing.every(Boolean)) {
      throw new StoryConversationIdempotencyConflictError(
        "检测到不完整的历史对话轮，拒绝拼接新的消息",
      );
    }
    intended.forEach((item, index) => {
      const message = existing[index]!;
      if (
        message.role !== item.role ||
        message.content !== item.content ||
        message.candidateRevisionId !== item.candidateRevisionId
      ) {
        throw new StoryConversationIdempotencyConflictError();
      }
    });
    const existingReference = existingAggregate?.messageReferences.find(
      reference => reference.messageId === existing[0]!.id,
    );
    if (
      canonicalJsonStringify(existingReference?.selection ?? null) !==
      canonicalJsonStringify(selection)
    ) {
      throw new StoryConversationIdempotencyConflictError(
        "对话消息标识已绑定到不同选区",
      );
    }
    return listStoryConversation(owner);
  }

  const reservedTurn = (existingAggregate?.turns ?? []).find(turn =>
    intended.some(
      message =>
        turn.userClientMessageId === message.clientMessageId ||
        turn.assistantClientMessageId === message.clientMessageId,
    ),
  );
  if (reservedTurn) {
    throw new StoryConversationIdempotencyConflictError(
      "对话消息标识已由另一条逻辑轮预留",
    );
  }

  const db = await getDb();
  if (!db) {
    await withPersistentLocalConversationLock(async () => {
      const latestAggregate = await loadStoryPromptAggregate(owner);
      const latestExisting = intended.map(item =>
        latestAggregate?.messages.find(
          message => message.clientMessageId === item.clientMessageId,
        ),
      );
      if (latestExisting.some(Boolean)) {
        const exact =
          latestExisting.every(Boolean) &&
          intended.every((item, index) => {
            const message = latestExisting[index]!;
            return (
              message.role === item.role &&
              message.content === item.content &&
              message.candidateRevisionId === item.candidateRevisionId
            );
          });
        if (!exact) {
          throw new StoryConversationIdempotencyConflictError(
            "检测到不完整或冲突的历史对话轮",
          );
        }
        return;
      }
      const latestReserved = (latestAggregate?.turns ?? []).some(turn =>
        intended.some(
          message =>
            turn.userClientMessageId === message.clientMessageId ||
            turn.assistantClientMessageId === message.clientMessageId,
        ),
      );
      if (latestReserved) {
        throw new StoryConversationIdempotencyConflictError(
          "对话消息标识已由另一条逻辑轮预留",
        );
      }
      const store = await createPersistentLocalPromptLineageStore();
      await store.appendConversationTurn(owner, {
        messages: [
          {
            role: "user",
            content: userContent,
            source: "story-agent",
            clientMessageId: input.userMessage.clientMessageId,
            reference: selection
              ? {
                  objectType: selection.sourceType,
                  objectId: referenceObjectId(selection),
                  objectVersion: selection.objectVersion ?? null,
                  selection,
                }
              : null,
          },
          {
            role: "assistant",
            content: assistantContent,
            source: "story-agent",
            clientMessageId: input.assistantMessage.clientMessageId,
            candidateRevisionId:
              input.assistantMessage.candidateRevisionId ?? null,
          },
        ],
      });
    });
    return listStoryConversation(owner);
  }

  await db.transaction(async tx => {
    await tx
      .insert(storyConversations)
      .values(owner)
      .onDuplicateKeyUpdate({
        set: { updatedAt: new Date() },
      });
    const [conversation] = await tx
      .select()
      .from(storyConversations)
      .where(
        and(
          eq(storyConversations.storyId, input.storyId),
          eq(storyConversations.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update");
    if (!conversation) {
      throw new PromptLineageValidationError("无法创建故事会话");
    }

    const append = async (message: {
      role: "user" | "assistant";
      content: string;
      clientMessageId: string;
      candidateRevisionId?: number | null;
      selection?: SelectionContext | null;
    }) => {
      const [existing] = await tx
        .select()
        .from(storyConversationMessages)
        .where(
          and(
            eq(storyConversationMessages.conversationId, conversation.id),
            eq(
              storyConversationMessages.clientMessageId,
              message.clientMessageId,
            ),
          ),
        )
        .limit(1);
      if (existing) return;
      const [inserted] = await tx.insert(storyConversationMessages).values({
        ...owner,
        conversationId: conversation.id,
        role: message.role,
        content: message.content,
        source: "story-agent",
        clientMessageId: message.clientMessageId,
        candidateRevisionId: message.candidateRevisionId ?? null,
      });
      if (message.selection) {
        await tx.insert(storyMessageReferences).values({
          ...owner,
          messageId: inserted.insertId,
          objectType: message.selection.sourceType,
          objectId: referenceObjectId(message.selection),
          objectVersion: message.selection.objectVersion ?? null,
          selection: message.selection,
        });
      }
    };

    await append({
      role: "user",
      content: userContent,
      clientMessageId: input.userMessage.clientMessageId,
      selection,
    });
    await append({
      role: "assistant",
      content: assistantContent,
      clientMessageId: input.assistantMessage.clientMessageId,
      candidateRevisionId: input.assistantMessage.candidateRevisionId,
    });
    await tx
      .update(storyConversations)
      .set({ updatedAt: new Date() })
      .where(eq(storyConversations.id, conversation.id));
  });

  return listStoryConversation(owner);
}
