/** Persistence operations for memoryLetters. Local and MySQL behavior share this boundary. */
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  emotionDailyLetters,
  EmotionDailyLetter,
  personalMemoryPrivacyEpochs,
  emotionDailyLetterVersions,
  emotionDailyLetterAttempts,
} from "../../drizzle/schema";
import {
  applyPersonalMemoryCapture,
  createEmptyPersonalMemoryEventSnapshot,
  currentLetterVersion,
  projectLetterRowFromVersion,
  type PersonalMemoryCapture,
  type PersonalMemoryLetterAttemptRecord,
  type PersonalMemoryLetterAttemptState,
  type PersonalMemoryLetterEnvelope,
  type PersonalMemoryLetterPayload,
  type PersonalMemoryLetterVersionRecord,
} from "../../shared/personalMemory";
import {
  ensureLocalPromptLineageLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistLocalPromptLineageStateToDisk,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import {
  PersonalMemoryMysqlTx,
  capturePersonalMemoryEvent,
  getPersonalMemoryPrivacyEpoch,
  isDeadlockError,
  isDuplicateKeyError,
  projectPersonalMemoryOutboxIntoIndex,
} from "./memoryEvents";

// ─── 每日来信：不可变版本是唯一正文权威 ────────────────────────────────

export type AppendDailyLetterVersionInput = {
  userId: number;
  letterDate: string;
  /** 稳定动作 ID。重复提交同一次生成／重读返回同一版本，不排第二次。 */
  actionId: string;
  trigger: PersonalMemoryLetterEnvelope["trigger"];
  selectorVersion: string;
  promptVersion: string;
  modelVersion: string;
  privacyEpoch: number;
  payload: PersonalMemoryLetterPayload;
  /** 兼容投影需要的字段；日期级行不接受独立正文写入。 */
  userMessageSaidAt?: Date | null;
  userMessageEditedAt?: Date | null;
  /**
   * 条件提交：给定时，只有当天当前版本号恰好等于它才追加。
   * legacy 的 revision CAS 就是通过它继续成立的——冲突返回 null，
   * 而不是悄悄追加一版覆盖别人刚写的内容。
   */
  expectedCurrentVersionNumber?: number;
  /**
   * 条件提交的第二维（U6）：给定时，只有当前隐私 epoch 恰好等于它才追加。
   *
   * 忘记或删除来源会原子递增用户的隐私 epoch；一次生成在选材开始时固定了
   * 它，如果提交前 epoch 已经变了，说明选材依据的某条理解或来源在生成
   * 期间被撤走了——即使模型已经把结果算出来了，也不能把基于旧输入的
   * 内容提交为新版本。命中不匹配与版本号 CAS 未命中一样返回 null；
   * 调用方（`commitPersonalMemoryLetterAttempt`）事后用一次追加读区分
   * 「是版本冲突还是 epoch 冲突」，不需要在这里扩出第二种返回形状。
   */
  requiredPrivacyEpoch?: number;
  /**
   * 每日留言的经历捕获（U2）。与版本、日期级指针写在**同一个短事务**里。
   *
   * 这里不需要 outbox：留言的来源（日期级行）和统一足迹索引本来就同在
   * local-persist 聚合里，MySQL 那边也在同一个 SQL 事务里。需要 outbox 的
   * 只有跨聚合的普通聊天。
   *
   * 是否捕获由调用方（Phase 1 白名单）决定；不传就是不捕获。
   */
  personalMemoryCapture?: PersonalMemoryCapture;
  /**
   * U6 生成 attempt。传入后，版本追加与 attempt 标记 committed 必须在同一个
   * 本地 copy-on-write / MySQL 事务里完成，不能留下“版本写成了但 attempt 还
   * 是 in_flight”的断网窗口。
   */
  letterAttemptId?: number;
  /** 当前执行的所有权凭证；动作重启后旧执行不得再提交。 */
  letterAttemptClaimToken?: string;
  /** 防止生成期间新保存的留言被旧生成输入覆盖。 */
  expectedLetterRevision?: number;
  /** 成功的新版本是否同时写入统一足迹。由调用方的捕获门禁决定。 */
  captureLetterVersionEvent?: boolean;
};

export type AppendDailyLetterVersionResult = {
  version: PersonalMemoryLetterVersionRecord;
  letter: EmotionDailyLetter;
  /** false = 这次是重复提交，返回的是既有版本。 */
  created: boolean;
};

function letterVersionRowToRecord(row: {
  id: number;
  userId: number;
  letterDate: string;
  envelope: unknown;
  payload: unknown;
  privacyEpoch: number;
  actionId: string;
  createdAt: Date;
}): PersonalMemoryLetterVersionRecord {
  return {
    id: row.id,
    userId: row.userId,
    letterDate: row.letterDate,
    envelope: row.envelope as PersonalMemoryLetterEnvelope,
    payload: (row.payload as PersonalMemoryLetterPayload | null) ?? null,
    privacyEpoch: row.privacyEpoch,
    actionId: row.actionId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * **来信正文的唯一写入口。**
 *
 * 追加一个不可变版本，并在同一事务里把日期级行推进为该版本的投影 + 指针。
 * `emotion_daily_letters` 从 U1 起不再接受独立正文写入——任何绕过这里直接改
 * 日期级正文的代码路径都是必须被拒绝的 pre-U1 行为，回滚构建也不许放回去。
 */
export async function appendEmotionDailyLetterVersion(
  input: AppendDailyLetterVersionInput
): Promise<AppendDailyLetterVersionResult | null> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      const beforeLetters = memoryState.emotionDailyLetters.map(row => ({
        ...row,
      }));
      const result = appendLetterVersionToLocalState(input);
      // CAS 冲突：一行都没改，直接把 null 交回给调用方。
      if (!result || !result.created) return result;
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.personalMemory = before;
        memoryState.emotionDailyLetters = beforeLetters;
        throw error;
      }
      return result;
    });
  }

  // 有界重试：唯一索引撞车或死锁都意味着「有人抢先提交了」，
  // 重开一个事务就能看见对方的结果——要么发现这是重放，要么算出下一个版本号。
  // 不无限重试：真的持续冲突说明有别的问题，应该报出来而不是自己转圈。
  const MAX_APPEND_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await appendLetterVersionOnce(db, input);
    } catch (error) {
      const retryable = isDuplicateKeyError(error) || isDeadlockError(error);
      if (!retryable || attempt >= MAX_APPEND_ATTEMPTS) throw error;
    }
  }
}

async function appendLetterVersionOnce(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: AppendDailyLetterVersionInput
): Promise<AppendDailyLetterVersionResult | null> {
  return db.transaction(async tx => {
    const attemptRow = input.letterAttemptId
      ? await readMatchingLetterAttemptInTx(tx, input)
      : null;
    if (input.letterAttemptId && !attemptRow) {
      throw new LetterAttemptExecutionConflictError();
    }
    // 刻意**不**在这里用 SELECT ... FOR UPDATE。
    //
    // 当天还没有任何版本时，那是一段空区间；两个事务同时对空区间取锁会各拿到
    // 一个相容的间隙锁，然后都想往这个间隙插入——必然互相等成死锁
    // （2026-09-03 在真实 MySQL 上实测到 ER_LOCK_DEADLOCK）。
    //
    // 改成乐观策略：普通读算版本号 → 直接插入 → 撞唯一索引或死锁就整笔重试。
    // 唯一索引 (userId, letterDate, versionNumber) 才是真正的仲裁者，
    // 重试时是新事务、新快照，看得到对方已经提交的版本。
    const priorVersions = await tx
      .select()
      .from(emotionDailyLetterVersions)
      .where(
        and(
          eq(emotionDailyLetterVersions.userId, input.userId),
          eq(emotionDailyLetterVersions.letterDate, input.letterDate)
        )
      );
    const priorRecords = priorVersions.map(letterVersionRowToRecord);

    // 幂等：同一 action ID 已经产生过版本就原样返回，不再追加。
    const replay = priorRecords.find(
      version => version.actionId === input.actionId
    );
    if (replay) {
      const letter = await readDailyLetterRowInTx(
        tx,
        input.userId,
        input.letterDate
      );
      if (!letter) throw new Error("来信版本存在但日期级投影缺失");
      await markLetterAttemptCommittedInTx(tx, input, replay.id);
      return { version: replay, letter, created: false };
    }

    // epoch 检查放在真正新写之前、replay 判定之后：已经成功过的
    // action 重放是历史事实，不因为 epoch 后来变了而反悔；但一次
    // **新**写入必须证明它引用的隐私状态仍然成立。点查主键，不涉及
    // 范围扫描，不会重演这个文件里其他地方记录过的 gap-lock 死锁。
    if (input.requiredPrivacyEpoch !== undefined) {
      await tx
        .insert(personalMemoryPrivacyEpochs)
        .values({ userId: input.userId, epoch: 1 })
        .onDuplicateKeyUpdate({ set: { userId: input.userId } });
      const [epochRow] = await tx
        .select()
        .from(personalMemoryPrivacyEpochs)
        .where(eq(personalMemoryPrivacyEpochs.userId, input.userId))
        .limit(1)
        .for("update");
      const currentEpoch = epochRow?.epoch ?? 1;
      if (currentEpoch !== input.requiredPrivacyEpoch) return null;
    }

    if (input.expectedLetterRevision !== undefined) {
      const [row] = await tx
        .select()
        .from(emotionDailyLetters)
        .where(
          and(
            eq(emotionDailyLetters.userId, input.userId),
            eq(emotionDailyLetters.letterDate, input.letterDate)
          )
        )
        .limit(1)
        .for("update");
      if (row?.revision !== input.expectedLetterRevision) return null;
    }

    const current = currentLetterVersion(priorRecords);
    // 向前兼容：U1 之前写下的日期级行没有任何版本，但它的 revision 是真的。
    // 从它起算，否则第一次经过版本权威的写入会把 revision 从 3 打回 1，
    // 而 legacy 的 CAS 调用方正拿着 3 在等。
    const legacyRow = current
      ? null
      : await readDailyLetterRowInTx(tx, input.userId, input.letterDate);
    const currentNumber =
      current?.envelope.versionNumber ?? legacyRow?.revision ?? 0;
    if (
      input.expectedCurrentVersionNumber !== undefined &&
      input.expectedCurrentVersionNumber !== currentNumber
    ) {
      return null;
    }
    const versionNumber = currentNumber + 1;
    const envelope: PersonalMemoryLetterEnvelope = {
      versionNumber,
      generatedAt: now().toISOString(),
      trigger: input.trigger,
      selectorVersion: input.selectorVersion,
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
    };

    await tx.insert(emotionDailyLetterVersions).values({
      userId: input.userId,
      letterDate: input.letterDate,
      versionNumber,
      envelope,
      payload: input.payload,
      privacyEpoch: input.privacyEpoch,
      actionId: input.actionId,
    });
    const [inserted] = await tx
      .select()
      .from(emotionDailyLetterVersions)
      .where(
        and(
          eq(emotionDailyLetterVersions.userId, input.userId),
          eq(emotionDailyLetterVersions.letterDate, input.letterDate),
          eq(emotionDailyLetterVersions.versionNumber, versionNumber)
        )
      )
      .limit(1);
    if (!inserted) throw new Error("来信版本写入后读不回");
    const version = letterVersionRowToRecord(inserted);

    // 同一事务里推进日期级指针与兼容投影。投影完全由版本重建。
    const projected = projectLetterRowFromVersion(version);
    await tx
      .insert(emotionDailyLetters)
      .values({
        userId: projected.userId,
        letterDate: projected.letterDate,
        userMessage: projected.userMessage,
        userMessageSaidAt: input.userMessageSaidAt ?? null,
        userMessageEditedAt: input.userMessageEditedAt ?? null,
        dailyReference: projected.dailyReference,
        analysisSeed: projected.analysisSeed,
        revision: 1,
        currentVersionId: version.id,
      })
      .onDuplicateKeyUpdate({
        set: {
          userMessage: projected.userMessage,
          userMessageSaidAt: input.userMessageSaidAt ?? null,
          userMessageEditedAt: input.userMessageEditedAt ?? null,
          dailyReference: projected.dailyReference,
          analysisSeed: projected.analysisSeed,
          revision: sql`${emotionDailyLetters.revision} + 1`,
          currentVersionId: version.id,
          updatedAt: new Date(),
        },
      });
    const letter = await readDailyLetterRowInTx(
      tx,
      input.userId,
      input.letterDate
    );
    if (!letter) throw new Error("日期级投影写入后读不回");
    if (input.personalMemoryCapture) {
      await capturePersonalMemoryEvent(
        { mode: "mysql", tx },
        input.personalMemoryCapture
      );
    }
    if (input.captureLetterVersionEvent) {
      await capturePersonalMemoryEvent(
        { mode: "mysql", tx },
        letterVersionEventCapture(input, version)
      );
    }
    await markLetterAttemptCommittedInTx(tx, input, version.id);
    return { version, letter, created: true };
  });
}

async function readMatchingLetterAttemptInTx(
  tx: PersonalMemoryMysqlTx,
  input: AppendDailyLetterVersionInput
) {
  if (!input.letterAttemptId) return null;
  const [row] = await tx
    .select()
    .from(emotionDailyLetterAttempts)
    .where(
      and(
        eq(emotionDailyLetterAttempts.id, input.letterAttemptId),
        eq(emotionDailyLetterAttempts.userId, input.userId),
        eq(emotionDailyLetterAttempts.letterDate, input.letterDate),
        eq(emotionDailyLetterAttempts.actionId, input.actionId),
        eq(
          emotionDailyLetterAttempts.claimToken,
          input.letterAttemptClaimToken ?? ""
        )
      )
    )
    .limit(1);
  return row ?? null;
}

async function markLetterAttemptCommittedInTx(
  tx: PersonalMemoryMysqlTx,
  input: AppendDailyLetterVersionInput,
  committedVersionId: number
): Promise<void> {
  if (!input.letterAttemptId) return;
  const updated = await tx
    .update(emotionDailyLetterAttempts)
    .set({
      state: "committed",
      committedVersionId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emotionDailyLetterAttempts.id, input.letterAttemptId),
        eq(emotionDailyLetterAttempts.userId, input.userId),
        eq(emotionDailyLetterAttempts.letterDate, input.letterDate),
        eq(emotionDailyLetterAttempts.actionId, input.actionId),
        eq(
          emotionDailyLetterAttempts.claimToken,
          input.letterAttemptClaimToken ?? ""
        )
      )
    );
  if (updated[0].affectedRows !== 1) {
    throw new Error("来信 attempt 提交状态更新失败");
  }
}

async function readDailyLetterRowInTx(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  letterDate: string
): Promise<EmotionDailyLetter | null> {
  const [row] = await tx
    .select()
    .from(emotionDailyLetters)
    .where(
      and(
        eq(emotionDailyLetters.userId, userId),
        eq(emotionDailyLetters.letterDate, letterDate)
      )
    )
    .limit(1);
  return row ?? null;
}

/** 本地模式的版本追加。调用方已持有聚合锁，这里只改内存。 */
function appendLetterVersionToLocalState(
  input: AppendDailyLetterVersionInput
): AppendDailyLetterVersionResult | null {
  const state = memoryState.personalMemory;
  const attempt = input.letterAttemptId
    ? (state.letterAttempts.find(
        row =>
          row.id === input.letterAttemptId &&
          row.userId === input.userId &&
          row.letterDate === input.letterDate &&
          row.actionId === input.actionId &&
          row.claimToken === input.letterAttemptClaimToken
      ) ?? null)
    : null;
  if (input.letterAttemptId && !attempt) {
    throw new LetterAttemptExecutionConflictError();
  }
  const sameDay = state.letterVersions.filter(
    version =>
      version.userId === input.userId && version.letterDate === input.letterDate
  );
  const replay = sameDay.find(version => version.actionId === input.actionId);
  if (replay) {
    const letter = memoryState.emotionDailyLetters.find(
      row => row.userId === input.userId && row.letterDate === input.letterDate
    );
    if (!letter) throw new Error("来信版本存在但日期级投影缺失");
    markLetterAttemptCommittedLocally(attempt, replay.id);
    return { version: replay, letter, created: false };
  }

  // 见 MySQL 分支的同名注释：replay 是历史事实不受后来 epoch 变化影响，
  // 但新写入必须证明它引用的隐私状态仍然成立。
  if (input.requiredPrivacyEpoch !== undefined) {
    const currentEpoch =
      state.privacyEpochs.find(row => row.userId === input.userId)?.epoch ?? 1;
    if (currentEpoch !== input.requiredPrivacyEpoch) return null;
  }

  const currentVersion = currentLetterVersion(sameDay);
  if (input.expectedLetterRevision !== undefined) {
    const row = memoryState.emotionDailyLetters.find(
      item =>
        item.userId === input.userId && item.letterDate === input.letterDate
    );
    if (row?.revision !== input.expectedLetterRevision) return null;
  }
  const legacyRow = currentVersion
    ? null
    : memoryState.emotionDailyLetters.find(
        row =>
          row.userId === input.userId && row.letterDate === input.letterDate
      );
  // 见 MySQL 分支的同名注释：存量行的 revision 必须被继承，不能从 1 重来。
  const currentNumber =
    currentVersion?.envelope.versionNumber ?? legacyRow?.revision ?? 0;
  if (
    input.expectedCurrentVersionNumber !== undefined &&
    input.expectedCurrentVersionNumber !== currentNumber
  ) {
    return null;
  }
  const versionNumber = currentNumber + 1;
  const stamp = now().toISOString();
  const version: PersonalMemoryLetterVersionRecord = {
    id: state.nextIds.letterVersion,
    userId: input.userId,
    letterDate: input.letterDate,
    envelope: {
      versionNumber,
      generatedAt: stamp,
      trigger: input.trigger,
      selectorVersion: input.selectorVersion,
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
    },
    payload: input.payload,
    privacyEpoch: input.privacyEpoch,
    actionId: input.actionId,
    createdAt: stamp,
  };
  state.nextIds.letterVersion += 1;
  state.letterVersions.push(version);

  const projected = projectLetterRowFromVersion(version);
  const current = now();
  const existing = memoryState.emotionDailyLetters.find(
    row => row.userId === input.userId && row.letterDate === input.letterDate
  );
  if (existing) {
    existing.userMessage = projected.userMessage;
    existing.userMessageSaidAt = input.userMessageSaidAt ?? null;
    existing.userMessageEditedAt = input.userMessageEditedAt ?? null;
    existing.dailyReference = projected.dailyReference;
    existing.analysisSeed = projected.analysisSeed;
    existing.revision += 1;
    existing.currentVersionId = version.id;
    existing.updatedAt = current;
    captureLetterMessageLocally(input);
    captureLetterVersionLocally(input, version);
    markLetterAttemptCommittedLocally(attempt, version.id);
    return { version, letter: existing, created: true };
  }
  const letter: EmotionDailyLetter = {
    id: nextMemoryId("emotionDailyLetter"),
    userId: input.userId,
    letterDate: input.letterDate,
    userMessage: projected.userMessage,
    userMessageSaidAt: input.userMessageSaidAt ?? null,
    userMessageEditedAt: input.userMessageEditedAt ?? null,
    dailyReference: projected.dailyReference,
    analysisSeed: projected.analysisSeed,
    revision: projected.revision,
    currentVersionId: version.id,
    createdAt: current,
    updatedAt: current,
  };
  memoryState.emotionDailyLetters.push(letter);
  captureLetterMessageLocally(input);
  captureLetterVersionLocally(input, version);
  markLetterAttemptCommittedLocally(attempt, version.id);
  return { version, letter, created: true };
}

function markLetterAttemptCommittedLocally(
  attempt: PersonalMemoryLetterAttemptRecord | null,
  committedVersionId: number
): void {
  if (!attempt) return;
  attempt.state = "committed";
  attempt.committedVersionId = committedVersionId;
  attempt.updatedAt = now().toISOString();
}

/** 见 AppendDailyLetterVersionInput.personalMemoryCapture：同聚合，无需 outbox。 */
function captureLetterMessageLocally(
  input: AppendDailyLetterVersionInput
): void {
  if (!input.personalMemoryCapture) return;
  applyPersonalMemoryCapture(
    memoryState.personalMemory,
    input.personalMemoryCapture
  );
}

function captureLetterVersionLocally(
  input: AppendDailyLetterVersionInput,
  version: PersonalMemoryLetterVersionRecord
): void {
  if (!input.captureLetterVersionEvent) return;
  applyPersonalMemoryCapture(
    memoryState.personalMemory,
    letterVersionEventCapture(input, version)
  );
}

function letterVersionEventCapture(
  input: AppendDailyLetterVersionInput,
  version: PersonalMemoryLetterVersionRecord
): PersonalMemoryCapture {
  return {
    identity: {
      userId: input.userId,
      sourceType: "daily_letter_version",
      sourceKey: `daily-letter:${input.letterDate}`,
      sourceRevision: String(version.envelope.versionNumber),
      actionKind:
        input.trigger === "reread" ? "letter_reread" : "letter_generated",
      actionId: input.actionId,
    },
    occurredOn: input.letterDate,
    occurredAt: version.envelope.generatedAt,
    snapshot: {
      ...createEmptyPersonalMemoryEventSnapshot(),
      display: {
        versionNumber: version.envelope.versionNumber,
        trigger: input.trigger,
      },
    },
    storyId: null,
    job: null,
  };
}

export async function saveEmotionDailyLetterMessageIfRevision(input: {
  userId: number;
  letterDate: string;
  expectedRevision: number;
  userMessage: string | null;
  userMessageSaidAt: Date | null;
  userMessageEditedAt: Date | null;
  analysisSeed: unknown;
  personalMemoryCapture?: PersonalMemoryCapture;
}): Promise<EmotionDailyLetter | null> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      const row = memoryState.emotionDailyLetters.find(
        item =>
          item.userId === input.userId && item.letterDate === input.letterDate
      );
      if (!row || row.revision !== input.expectedRevision) return null;
      const previous = { ...row };
      row.userMessage = input.userMessage;
      row.userMessageSaidAt = input.userMessageSaidAt;
      row.userMessageEditedAt = input.userMessageEditedAt;
      row.analysisSeed = input.analysisSeed;
      row.revision += 1;
      row.updatedAt = now();
      if (input.personalMemoryCapture) {
        applyPersonalMemoryCapture(
          memoryState.personalMemory,
          input.personalMemoryCapture
        );
      }
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(row, previous);
        memoryState.personalMemory = before;
        throw error;
      }
      return row;
    });
  }
  return db.transaction(async tx => {
    const updated = await tx
      .update(emotionDailyLetters)
      .set({
        userMessage: input.userMessage,
        userMessageSaidAt: input.userMessageSaidAt,
        userMessageEditedAt: input.userMessageEditedAt,
        analysisSeed: input.analysisSeed,
        revision: input.expectedRevision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emotionDailyLetters.userId, input.userId),
          eq(emotionDailyLetters.letterDate, input.letterDate),
          eq(emotionDailyLetters.revision, input.expectedRevision)
        )
      );
    if (updated[0].affectedRows !== 1) return null;
    if (input.personalMemoryCapture) {
      await capturePersonalMemoryEvent(
        { mode: "mysql", tx },
        input.personalMemoryCapture
      );
    }
    return readDailyLetterRowInTx(tx, input.userId, input.letterDate);
  });
}

/** 列出某天的全部版本，按版本号升序。历史版本只读。 */
export async function listEmotionDailyLetterVersions(
  userId: number,
  letterDate: string
): Promise<PersonalMemoryLetterVersionRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.letterVersions
      .filter(
        version =>
          version.userId === userId && version.letterDate === letterDate
      )
      .sort(
        (left, right) =>
          left.envelope.versionNumber - right.envelope.versionNumber
      );
  }
  const rows = await db
    .select()
    .from(emotionDailyLetterVersions)
    .where(
      and(
        eq(emotionDailyLetterVersions.userId, userId),
        eq(emotionDailyLetterVersions.letterDate, letterDate)
      )
    )
    .orderBy(emotionDailyLetterVersions.versionNumber);
  return rows.map(letterVersionRowToRecord);
}

/**
 * 按 ID 批量取来信版本（仍按 userId 过滤）。
 *
 * 选材器算冷却期要看"最近 N 天各自当前版本引用了哪些理解"：`EmotionDailyLetter`
 * 每行只有 `currentVersionId`，逐天单独查版本会是 N 次往返，这里一次取回。
 */
export async function listPersonalMemoryLetterVersionsByIds(
  userId: number,
  versionIds: readonly number[]
): Promise<PersonalMemoryLetterVersionRecord[]> {
  const ids = [...new Set(versionIds)].filter(
    id => Number.isSafeInteger(id) && id > 0
  );
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.letterVersions.filter(
      version => version.userId === userId && ids.includes(version.id)
    );
  }
  const rows = await db
    .select()
    .from(emotionDailyLetterVersions)
    .where(
      and(
        eq(emotionDailyLetterVersions.userId, userId),
        inArray(emotionDailyLetterVersions.id, ids)
      )
    );
  return rows.map(letterVersionRowToRecord);
}

// ─── 来信生成 attempt 状态机（U6） ───────────────────────────────────────
//
// 表在 Phase 0（0017 迁移）就建好了，U6 才真正接线。设计目标：
//
// - 首次打开用 `profile-ensure:<date>` 这类稳定 action ID；并发标签页同时
//   首次打开只应该确认同一个 attempt、同一个 version 1。
// - 显式重读用绑定「这次点击」的稳定 action ID；重复提交（网络重试、
//   手抖连点）返回同一 attempt，不重复生成、不重复计费。
// - 失败可重试：同一个 action ID 的失败 attempt 可以被重新拉回 in_flight，
//   不会因为失败一次就永久卡死，也不会因为重试就换一个新 action ID
//   （换了就不是「重试同一次」而是「发起新一次」，语义不对）。
// - 提交是短事务里的条件写：privacyEpoch 必须仍等于开始生成时看到的那个，
//   否则视为「选材期间被忘记/删除撤走了依据」，拒绝提交旧输入。

const PERSONAL_MEMORY_LETTER_ATTEMPT_STALE_MS = 2 * 60 * 1000;

const MAX_BEGIN_ATTEMPT_RETRIES = 5;

export type BeginPersonalMemoryLetterAttemptInput = {
  userId: number;
  letterDate: string;
  actionId: string;
  now?: Date;
};

export type BeginPersonalMemoryLetterAttemptResult =
  /** 全新开始，调用方现在可以去选材、算八字/黄历、调模型。 */
  | { status: "started"; attempt: PersonalMemoryLetterAttemptRecord }
  /** 同一 action ID 已经提交成功过；重复点击直接拿旧结果，不再生成。 */
  | {
      status: "already_committed";
      attempt: PersonalMemoryLetterAttemptRecord;
      committedVersionId: number;
    }
  /** 另一个真正在跑的请求还没完成；调用方应该提示「生成中」而不是并发再跑一次。 */
  | { status: "in_flight"; attempt: PersonalMemoryLetterAttemptRecord };

function isAttemptStale(attempt: { updatedAt: string }, now: Date): boolean {
  return (
    now.getTime() - Date.parse(attempt.updatedAt) >
    PERSONAL_MEMORY_LETTER_ATTEMPT_STALE_MS
  );
}

/**
 * 开始一次来信生成（首次打开或显式重读，由调用方决定 action ID 的构造方式）。
 *
 * 幂等于 (userId, letterDate, actionId)；这是稳定动作 ID 的落点，不是
 * 版本号——两次点同一个「再读一遍」按钮如果算出同一个目标 action ID，
 * 只会有一个 attempt 真正跑起来。
 */
export async function beginPersonalMemoryLetterAttempt(
  input: BeginPersonalMemoryLetterAttemptInput
): Promise<BeginPersonalMemoryLetterAttemptResult> {
  const nowAt = input.now ?? now();
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const result = beginLetterAttemptLocally(input, nowAt);
        if (result.status === "started") await persistMemoryState();
        return result;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await beginPersonalMemoryLetterAttemptOnce(db, input, nowAt);
    } catch (error) {
      const retryable =
        isDuplicateKeyError(error) ||
        isDeadlockError(error) ||
        error instanceof LetterAttemptRestartRaceError;
      if (!retryable || attempt >= MAX_BEGIN_ATTEMPT_RETRIES) throw error;
    }
  }
}

function beginLetterAttemptLocally(
  input: BeginPersonalMemoryLetterAttemptInput,
  nowAt: Date
): BeginPersonalMemoryLetterAttemptResult {
  const state = memoryState.personalMemory;
  const epoch =
    state.privacyEpochs.find(row => row.userId === input.userId)?.epoch ?? 1;
  const existing = state.letterAttempts.find(
    row =>
      row.userId === input.userId &&
      row.letterDate === input.letterDate &&
      row.actionId === input.actionId
  );
  if (!existing) {
    const created: PersonalMemoryLetterAttemptRecord = {
      id: state.nextIds.letterAttempt,
      userId: input.userId,
      letterDate: input.letterDate,
      actionId: input.actionId,
      claimToken: randomUUID(),
      state: "in_flight",
      inputCutoffAt: nowAt.toISOString(),
      privacyEpoch: epoch,
      committedVersionId: null,
      createdAt: nowAt.toISOString(),
      updatedAt: nowAt.toISOString(),
    };
    state.nextIds.letterAttempt += 1;
    state.letterAttempts.push(created);
    return { status: "started", attempt: created };
  }
  if (existing.state === "committed") {
    return {
      status: "already_committed",
      attempt: existing,
      committedVersionId: existing.committedVersionId!,
    };
  }
  if (existing.state === "in_flight" && !isAttemptStale(existing, nowAt)) {
    return { status: "in_flight", attempt: existing };
  }
  // failed / rejected_stale / 卡死的陈旧 in_flight：重新拉回 in_flight，
  // 用当前时刻和当前 epoch 重新起算——这是"同一次重试"，不是新的一次。
  existing.state = "in_flight";
  existing.claimToken = randomUUID();
  existing.inputCutoffAt = nowAt.toISOString();
  existing.privacyEpoch = epoch;
  existing.committedVersionId = null;
  existing.updatedAt = nowAt.toISOString();
  return { status: "started", attempt: existing };
}

/**
 * 内部信号，代表"重启失败 attempt"这个分支的乐观 CAS 没抢到——不是真的
 * 数据库错误。外层 `beginPersonalMemoryLetterAttempt` 的有界重试把它当作
 * 可重试信号，用新事务、新快照重新判断一次。
 */
class LetterAttemptRestartRaceError extends Error {}

class LetterAttemptExecutionConflictError extends Error {}

async function beginPersonalMemoryLetterAttemptOnce(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: BeginPersonalMemoryLetterAttemptInput,
  nowAt: Date
): Promise<BeginPersonalMemoryLetterAttemptResult> {
  return db.transaction(async tx => {
    const [epochRow] = await tx
      .select()
      .from(personalMemoryPrivacyEpochs)
      .where(eq(personalMemoryPrivacyEpochs.userId, input.userId))
      .limit(1);
    const epoch = epochRow?.epoch ?? 1;

    // 刻意用不加锁的普通 SELECT，而不是 SELECT ... FOR UPDATE。
    //
    // 这条 (userId, letterDate, actionId) 组合在首次开始时天然可能不存在，
    // 而 FOR UPDATE 打在一段可能为空的区间上会取间隙锁——这正是这个文件
    // 别处已经记录过两次的死锁根因（来信版本追加、job claim）。改成乐观
    // 策略：先读、按读到的内容决定插入还是更新，插入撞唯一索引或更新的
    // CAS 没对上都只是"有人抢先了"，交给外层有界重试重新走一遍，不是死锁。
    const [existingRow] = await tx
      .select()
      .from(emotionDailyLetterAttempts)
      .where(
        and(
          eq(emotionDailyLetterAttempts.userId, input.userId),
          eq(emotionDailyLetterAttempts.letterDate, input.letterDate),
          eq(emotionDailyLetterAttempts.actionId, input.actionId)
        )
      )
      .limit(1);

    if (!existingRow) {
      await tx.insert(emotionDailyLetterAttempts).values({
        userId: input.userId,
        letterDate: input.letterDate,
        actionId: input.actionId,
        claimToken: randomUUID(),
        state: "in_flight",
        inputCutoffAt: nowAt,
        privacyEpoch: epoch,
        committedVersionId: null,
      });
      const [inserted] = await tx
        .select()
        .from(emotionDailyLetterAttempts)
        .where(
          and(
            eq(emotionDailyLetterAttempts.userId, input.userId),
            eq(emotionDailyLetterAttempts.letterDate, input.letterDate),
            eq(emotionDailyLetterAttempts.actionId, input.actionId)
          )
        )
        .limit(1);
      if (!inserted) throw new Error("来信 attempt 写入后读不回");
      return {
        status: "started",
        attempt: rowToPersonalMemoryLetterAttempt(inserted),
      };
    }

    if (existingRow.state === "committed") {
      return {
        status: "already_committed",
        attempt: rowToPersonalMemoryLetterAttempt(existingRow),
        committedVersionId: existingRow.committedVersionId!,
      };
    }
    if (
      existingRow.state === "in_flight" &&
      !isAttemptStale({ updatedAt: existingRow.updatedAt.toISOString() }, nowAt)
    ) {
      return {
        status: "in_flight",
        attempt: rowToPersonalMemoryLetterAttempt(existingRow),
      };
    }
    // failed / rejected_stale / 卡死的陈旧 in_flight：重启为新一轮 in_flight。
    // CAS 在刚刚观测到的 state 上；命中 0 行说明有人在这两步之间抢先动过它
    // （比如另一个并发调用同时把它标成了 committed），不能无条件覆盖。
    const nextClaimToken = randomUUID();
    const restart = await tx
      .update(emotionDailyLetterAttempts)
      .set({
        state: "in_flight",
        claimToken: nextClaimToken,
        inputCutoffAt: nowAt,
        privacyEpoch: epoch,
        committedVersionId: null,
        updatedAt: nowAt,
      })
      .where(
        and(
          eq(emotionDailyLetterAttempts.id, existingRow.id),
          eq(emotionDailyLetterAttempts.state, existingRow.state),
          eq(emotionDailyLetterAttempts.claimToken, existingRow.claimToken)
        )
      );
    if (restart[0].affectedRows !== 1) {
      throw new LetterAttemptRestartRaceError();
    }
    const [refreshed] = await tx
      .select()
      .from(emotionDailyLetterAttempts)
      .where(eq(emotionDailyLetterAttempts.id, existingRow.id))
      .limit(1);
    if (!refreshed) throw new Error("来信 attempt 重启后读不回");
    if (refreshed.claimToken !== nextClaimToken) {
      throw new LetterAttemptRestartRaceError();
    }
    return {
      status: "started",
      attempt: rowToPersonalMemoryLetterAttempt(refreshed),
    };
  });
}

function rowToPersonalMemoryLetterAttempt(row: {
  id: number;
  userId: number;
  letterDate: string;
  actionId: string;
  claimToken: string;
  state: PersonalMemoryLetterAttemptState;
  inputCutoffAt: Date;
  privacyEpoch: number;
  committedVersionId: number | null;
  createdAt: Date;
  updatedAt: Date;
}): PersonalMemoryLetterAttemptRecord {
  return {
    id: row.id,
    userId: row.userId,
    letterDate: row.letterDate,
    actionId: row.actionId,
    claimToken: row.claimToken,
    state: row.state,
    inputCutoffAt: row.inputCutoffAt.toISOString(),
    privacyEpoch: row.privacyEpoch,
    committedVersionId: row.committedVersionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CommitPersonalMemoryLetterAttemptInput = Omit<
  AppendDailyLetterVersionInput,
  "requiredPrivacyEpoch"
> & {
  attemptId: number;
  claimToken: string;
};

export type CommitPersonalMemoryLetterAttemptResult =
  | {
      outcome: "committed";
      version: PersonalMemoryLetterVersionRecord;
      letter: EmotionDailyLetter;
    }
  /** 版本号已经被别的提交推进；这是极端并发下才会出现的兜底分支
   *  （正常路径下先 begin 才能 commit，同一 attempt 不会有两次提交竞争）。 */
  | { outcome: "revision_conflict" }
  /** 同一动作已经重启；调用方属于上一轮执行，不能提交或覆盖新一轮状态。 */
  | { outcome: "execution_conflict" }
  /** 选材依据在生成期间被撤走：忘记、归档或删除了某条被引用的理解／来源。
   *  attempt 已经被标记 rejected_stale；调用方应该提示"记忆状态已更新，
   *  已为你重新生成"而不是当成一次普通失败。 */
  | { outcome: "epoch_conflict"; currentEpoch: number };

/**
 * 提交一次生成结果，把它写成正式版本。
 *
 * `attemptId` 必须是 `beginPersonalMemoryLetterAttempt` 返回的那个 in_flight
 * attempt；提交时用它开始时记录的 `requiredPrivacyEpoch` 做条件写——这就是
 * "黄历与模型在事务外运行，完成时才做条件提交"这条 Approach 的落地：
 * 模型调用可能耗时数秒，这几秒里用户完全可能在另一个标签页忘记了某条理解，
 * 提交这一刻必须重新证明前提仍然成立。
 */
export async function commitPersonalMemoryLetterAttempt(
  input: CommitPersonalMemoryLetterAttemptInput
): Promise<CommitPersonalMemoryLetterAttemptResult> {
  const attemptRow = await getPersonalMemoryLetterAttemptById(input.attemptId);
  if (
    !attemptRow ||
    attemptRow.userId !== input.userId ||
    attemptRow.letterDate !== input.letterDate ||
    attemptRow.actionId !== input.actionId
  ) {
    throw new Error("来信 attempt 不存在，或与用户、日期、动作不匹配");
  }
  if (attemptRow.claimToken !== input.claimToken) {
    return { outcome: "execution_conflict" };
  }
  let written: AppendDailyLetterVersionResult | null;
  try {
    written = await appendEmotionDailyLetterVersion({
      ...input,
      letterAttemptId: attemptRow.id,
      letterAttemptClaimToken: input.claimToken,
      requiredPrivacyEpoch: attemptRow.privacyEpoch,
    });
  } catch (error) {
    if (error instanceof LetterAttemptExecutionConflictError) {
      return { outcome: "execution_conflict" };
    }
    throw error;
  }
  if (!written) {
    const currentEpoch = await getPersonalMemoryPrivacyEpoch(input.userId);
    if (currentEpoch !== attemptRow.privacyEpoch) {
      await failPersonalMemoryLetterAttempt({
        attemptId: input.attemptId,
        userId: input.userId,
        claimToken: input.claimToken,
        outcome: "rejected_stale",
      });
      return { outcome: "epoch_conflict", currentEpoch };
    }
    // epoch 没变，那就是版本号 CAS 没对上——真正的并发提交竞争。
    return { outcome: "revision_conflict" };
  }
  return {
    outcome: "committed",
    version: written.version,
    letter: written.letter,
  };
}

export async function failPersonalMemoryLetterAttempt(input: {
  attemptId: number;
  userId: number;
  claimToken: string;
  outcome: "failed" | "rejected_stale";
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const row = memoryState.personalMemory.letterAttempts.find(
        item =>
          item.id === input.attemptId &&
          item.userId === input.userId &&
          item.claimToken === input.claimToken
      );
      // 已经提交成功的 attempt 不允许被失败覆盖——那是过期的失败通知
      // （比如生成成功了但客户端超时重发了失败上报），提交结果优先。
      if (!row || row.state === "committed") return;
      row.state = input.outcome;
      row.updatedAt = now().toISOString();
      await persistMemoryState();
    });
  }
  await db
    .update(emotionDailyLetterAttempts)
    .set({ state: input.outcome, updatedAt: new Date() })
    .where(
      and(
        eq(emotionDailyLetterAttempts.id, input.attemptId),
        eq(emotionDailyLetterAttempts.userId, input.userId),
        eq(emotionDailyLetterAttempts.claimToken, input.claimToken),
        ne(emotionDailyLetterAttempts.state, "committed")
      )
    );
}

export async function getPersonalMemoryLetterAttemptById(
  attemptId: number
): Promise<PersonalMemoryLetterAttemptRecord | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.letterAttempts.find(
        row => row.id === attemptId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(emotionDailyLetterAttempts)
    .where(eq(emotionDailyLetterAttempts.id, attemptId))
    .limit(1);
  return row ? rowToPersonalMemoryLetterAttempt(row) : null;
}

/**
 * 把 prompt-lineage 聚合积压的个人记忆 outbox 投影进统一足迹索引（仅本地模式）。
 *
 * 这是跨聚合那一跳：聊天与 outbox 已经在 prompt-lineage 里安全落盘了，
 * 这里只负责把它搬进 local-persist 的足迹索引。中途崩溃是安全的——
 * 下一次调用会从水位续投，重复投递也不会翻倍（见 projectPersonalMemoryOutbox）。
 *
 * 已投影的条目不立刻删：删一次就要多写一遍整份 prompt-lineage 文件，
 * 而那份文件在一次对话里本来就要写好几遍。改成积压超过阈值才裁剪一次，
 * 既不让 outbox 无限长大（2026-07-08 的 383MB 事故就是这么来的），
 * 也不给每一轮对话增加一次全量重写。
 */
const PERSONAL_MEMORY_OUTBOX_PRUNE_THRESHOLD = 200;

export async function drainLocalPersonalMemoryOutbox(): Promise<{
  applied: number;
  pruned: number;
}> {
  const db = await getDb();
  if (db) return { applied: 0, pruned: 0 };
  await ensureLocalPromptLineageLoaded();
  const entries = memoryState.promptLineage.personalMemoryOutbox;
  if (entries.length === 0) return { applied: 0, pruned: 0 };

  const result = await projectPersonalMemoryOutboxIntoIndex(
    "promptLineage",
    entries
  );

  const projected = entries.filter(entry => entry.seq <= result.watermark);
  if (projected.length < PERSONAL_MEMORY_OUTBOX_PRUNE_THRESHOLD) {
    return { applied: result.applied, pruned: 0 };
  }
  // 只裁剪水位之下的条目：水位之上的还没投影，删了就真丢了。
  const remaining = entries.filter(entry => entry.seq > result.watermark);
  memoryState.promptLineage.personalMemoryOutbox = remaining;
  await persistLocalPromptLineageStateToDisk(memoryState.promptLineage);
  return { applied: result.applied, pruned: projected.length };
}
