/** Persistence operations for memoryInsights. Local and MySQL behavior share this boundary. */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  personalMemoryEvents,
  personalMemoryJobs,
  personalMemoryPrivacyEpochs,
  personalMemoryInsights,
  personalMemoryEvidence,
  personalMemorySuppressions,
  storyConversationMessages,
} from "../../drizzle/schema";
import {
  applyPersonalMemoryCapture,
  createEmptyPersonalMemoryEventSnapshot,
  decideEvidenceLossOutcome,
  decideInsightMutation,
  decideLineageStateChange,
  insightLineageTip,
  reinforceInsightConfidence,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryEventRecord,
  type PersonalMemoryEvidenceRecord,
  type PersonalMemoryInsightLineageView,
  type PersonalMemoryInsightMutation,
  type PersonalMemoryInsightRecord,
  type PersonalMemoryJobRecord,
  type PersonalMemoryLocalState,
  type PersonalMemorySuppressionRecord,
} from "../../shared/personalMemory";
import {
  ensureLocalPromptLineageLoaded,
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import {
  PersonalMemoryMysqlTx,
  PersonalMemoryTxScope,
  capturePersonalMemoryEvent,
  findPersonalMemoryEventInTx,
  isDeadlockError,
  rowToPersonalMemoryEvent,
} from "./memoryEvents";
import { rowToPersonalMemoryInsight } from "./memoryRows";

// ─── 个人记忆（U5）：提炼任务队列与理解状态机 ───────────────────────────
//
// 这一段建在 U1-U3 的事件/来源基础设施之上。核心不变量：
//
//   1. reinforce／supersede 只能作用在当前恰好是 active 的 lineage tip 上；
//      任何用户动作或另一个任务抢先完成，都会让这里判定「过期，丢弃」而
//      不是覆盖。判定逻辑在 shared/personalMemory.ts，MySQL 与本地各自
//      负责读出同一形状的切片喂给它。
//   2. 手动动作（纠正／归档／恢复／忘记）自己也生成一条 sourceType=insight
//      的经历，让理解状态的变化本身可追溯；提炼驱动的 reinforce 复用触发
//      它的原始事件作证据，不再造一条合成事件。

export type PersonalMemoryInsightRow = PersonalMemoryInsightRecord;

function rowToPersonalMemoryEvidence(row: {
  id: number;
  userId: number;
  insightId: number;
  eventId: number;
  sourceRevision: string;
  createdAt: Date;
}): PersonalMemoryEvidenceRecord {
  return {
    id: row.id,
    userId: row.userId,
    insightId: row.insightId,
    eventId: row.eventId,
    sourceRevision: row.sourceRevision,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToPersonalMemoryJob(row: {
  id: number;
  userId: number;
  eventId: number;
  operationId: string;
  extractorVersion: string;
  state: string;
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  availableAt: Date;
  lastErrorKind: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PersonalMemoryJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    eventId: row.eventId,
    operationId: row.operationId,
    extractorVersion: row.extractorVersion,
    state: row.state as PersonalMemoryJobRecord["state"],
    attempts: row.attempts,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt
      ? row.leaseExpiresAt.toISOString()
      : null,
    availableAt: row.availableAt.toISOString(),
    lastErrorKind: row.lastErrorKind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── 任务 claim／完成／失败 ─────────────────────────────────────────────

export type ClaimPersonalMemoryJobsInput = {
  /** 单轮最多 claim 多少条。 */
  limit: number;
  leaseMs: number;
  now?: Date;
};

/**
 * 逐条 claim，而不是一条 UPDATE 批量抢。
 *
 * 用「UPDATE ... WHERE id = (SELECT id ... LIMIT 1)」这个经典 MySQL 原子
 * 单行写法：两个并发 runner 的子查询可能选中同一行，但只有一个 UPDATE 真的
 * 生效——InnoDB 对 UPDATE 命中的行做当前读，第二个事务重新求值 WHERE 时
 * 这行状态已经变了，affectedRows=0，直接跳过。不需要 SKIP LOCKED，也不会
 * 死锁：每次只碰一行，不会有两个事务同时握着不同行互相等对方。
 *
 * 过期 lease 的回收不需要单独一步——WHERE 条件本身就把
 * `state='claimed' AND leaseExpiresAt<now` 当作可 claim，启动时第一轮
 * claim 自然把它们收回来。
 */
export async function claimPersonalMemoryJobs(
  input: ClaimPersonalMemoryJobsInput
): Promise<PersonalMemoryJobRecord[]> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const limit = Math.max(0, Math.min(50, Math.floor(input.limit)));
  if (limit === 0) return [];

  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const state = memoryState.personalMemory;
      const claimed: PersonalMemoryJobRecord[] = [];
      const eligible = state.jobs
        .filter(
          job =>
            job.state === "pending" ||
            (job.state === "claimed" &&
              job.leaseExpiresAt !== null &&
              new Date(job.leaseExpiresAt).getTime() < now.getTime())
        )
        .sort(
          (a, b) => a.availableAt.localeCompare(b.availableAt) || a.id - b.id
        )
        .filter(job => new Date(job.availableAt).getTime() <= now.getTime());
      for (const job of eligible.slice(0, limit)) {
        job.state = "claimed";
        job.leaseToken = randomUUID();
        job.leaseExpiresAt = leaseExpiresAt.toISOString();
        job.attempts += 1;
        job.updatedAt = now.toISOString();
        claimed.push({ ...job });
      }
      if (claimed.length > 0) await persistMemoryState();
      return claimed;
    });
  }

  const claimed: PersonalMemoryJobRecord[] = [];
  for (let i = 0; i < limit; i += 1) {
    const row = await claimOnePersonalMemoryJobRow(db, now, leaseExpiresAt);
    if (!row) break; // 没有更多可 claim 的了
    claimed.push(rowToPersonalMemoryJob(row));
  }
  return claimed;
}

/**
 * 单行原子 claim，带死锁重试。
 *
 * 这条 `UPDATE ... WHERE id = (SELECT ... ORDER BY ... LIMIT 1)` 即使只有
 * 一行数据、即使不带 FOR UPDATE，在真实 MySQL 上仍然会死锁——InnoDB 给
 * range 条件扫描加的是 next-key lock，锁的是它扫过的整段间隙，不只是最终
 * 命中的那一行。两个并发事务的扫描顺序一旦交叉，就会互相等对方持有的间隙
 * 锁。这在只有本地文件模式和 tsc 类型检查时完全看不出来，2026-09-04 用真实
 * MySQL 跑并发 claim 测试时才复现——和来信版本首次并发追加的死锁是同一类
 * 根因，修法也一样：不是避免这条语句，而是死锁了就重试，因为重试就是新
 * 事务、新快照，两边不会永远互相卡住。
 */
async function claimOnePersonalMemoryJobRow(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  now: Date,
  leaseExpiresAt: Date
): Promise<{
  id: number;
  userId: number;
  eventId: number;
  operationId: string;
  extractorVersion: string;
  state: string;
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  availableAt: Date;
  lastErrorKind: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const MAX_CLAIM_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt += 1) {
    const leaseToken = randomUUID();
    try {
      const result = await db.execute(sql`
        UPDATE personal_memory_jobs
        SET state = 'claimed',
            leaseToken = ${leaseToken},
            leaseExpiresAt = ${leaseExpiresAt},
            attempts = attempts + 1,
            updatedAt = NOW()
        WHERE id = (
          SELECT id FROM (
            SELECT id FROM personal_memory_jobs
            WHERE (state = 'pending' OR (state = 'claimed' AND leaseExpiresAt < ${now}))
              AND availableAt <= ${now}
            ORDER BY availableAt ASC, id ASC
            LIMIT 1
          ) AS eligible
        )
      `);
      const affected = (result as unknown as [{ affectedRows: number }])[0]
        ?.affectedRows;
      if (!affected) return null; // 没有更多可 claim 的了
      const [row] = await db
        .select()
        .from(personalMemoryJobs)
        .where(eq(personalMemoryJobs.leaseToken, leaseToken))
        .limit(1);
      return row ?? null;
    } catch (error) {
      if (!isDeadlockError(error) || attempt >= MAX_CLAIM_ATTEMPTS) throw error;
      // 不无限重试：持续死锁说明有别的问题，应该报出来而不是自己转圈。
    }
  }
}

export type PersonalMemoryExtractionCompletion = {
  jobId: number;
  leaseToken: string;
  userId: number;
  eventId: number;
  mutations: PersonalMemoryInsightMutation[];
};

export type PersonalMemoryAppliedMutation = {
  mutation: PersonalMemoryInsightMutation;
  outcome: string;
  /**
   * 实际写入／命中的理解行 ID；判 stale 时为 null。
   * 调用方要靠它精确定位这次写了哪条，而不是回头查「最近更新的一条」——
   * 同一毫秒内建两条时那种查法是不稳定的。
   */
  insightId: number | null;
  /** 这条理解的 lineage；判 stale 时为 null。 */
  lineageKey: string | null;
};

export type PersonalMemoryExtractionCompletionResult = {
  /** false = 任务已被别的 runner 抢占完成，本次结果整体丢弃。 */
  jobClaimValid: boolean;
  /** 事件在完成前被删除内容或被抑制，结果被丢弃但任务仍标记成功。 */
  discarded: "content_scrubbed" | "event_suppressed" | null;
  applied: PersonalMemoryAppliedMutation[];
};

/**
 * 提炼完成：在同一个事务／本地聚合锁内验证 lease、按序应用每条 mutation、
 * 把任务标成功。这是「旧任务不能覆盖新纠正」的落地点——
 * 每条 mutation 都在这里重新读一次目标 lineage 的当前状态再判定。
 */
export async function completePersonalMemoryExtractionJob(
  input: PersonalMemoryExtractionCompletion
): Promise<PersonalMemoryExtractionCompletionResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const result = applyExtractionCompletionLocally(
          memoryState.personalMemory,
          input
        );
        if (result.jobClaimValid) await persistMemoryState();
        return result;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(tx => applyExtractionCompletionMysql(tx, input));
}

/** 本地模式：在给定状态上应用一次提炼完成。原地修改，失败时调用方整份还原。 */
function applyExtractionCompletionLocally(
  state: PersonalMemoryLocalState,
  input: PersonalMemoryExtractionCompletion
): PersonalMemoryExtractionCompletionResult {
  const job = state.jobs.find(item => item.id === input.jobId);
  if (!job || job.leaseToken !== input.leaseToken || job.state !== "claimed") {
    return { jobClaimValid: false, discarded: null, applied: [] };
  }

  const now = new Date().toISOString();
  const finish = (
    discarded: PersonalMemoryExtractionCompletionResult["discarded"],
    applied: PersonalMemoryExtractionCompletionResult["applied"]
  ): PersonalMemoryExtractionCompletionResult => {
    job.state = "succeeded";
    job.leaseToken = null;
    job.leaseExpiresAt = null;
    job.updatedAt = now;
    return { jobClaimValid: true, discarded, applied };
  };

  const event = state.events.find(item => item.id === input.eventId);
  if (!event || event.contentScrubbed) {
    return finish("content_scrubbed", []);
  }
  if (isEventSuppressedLocally(state, input.userId, input.eventId)) {
    return finish("event_suppressed", []);
  }

  const applied: PersonalMemoryExtractionCompletionResult["applied"] = [];
  for (const mutation of input.mutations) {
    applied.push({
      mutation,
      ...applyInsightMutationLocally(state, input.userId, event, mutation),
    });
  }
  return finish(null, applied);
}

function isEventSuppressedLocally(
  state: PersonalMemoryLocalState,
  userId: number,
  eventId: number
): boolean {
  return state.suppressions.some(
    row => row.userId === userId && row.suppressedEventIds.includes(eventId)
  );
}

/**
 * 应用单条 mutation 到本地状态，返回一个人类可读的结果标签（供测试断言）。
 *
 * 按 `mutation.action` 分支（而不是 `decision.kind`）是为了让 TypeScript
 * 的判别联合在分支内正确收窄——`decideInsightMutation` 的返回类型和
 * `mutation` 是分开算出来的两个值，编译器关联不起来，只有判在 `mutation`
 * 自己的判别字段上才能拿到 `mutation.text` 这些字段。
 */
function applyInsightMutationLocally(
  state: PersonalMemoryLocalState,
  userId: number,
  event: PersonalMemoryEventRecord,
  mutation: PersonalMemoryInsightMutation
): Omit<PersonalMemoryAppliedMutation, "mutation"> {
  const now = new Date().toISOString();
  const lineageKey =
    mutation.action === "new" ? randomUUID() : mutation.lineageKey;
  const view: PersonalMemoryInsightLineageView = {
    revisions: state.insights.filter(
      row => row.userId === userId && row.lineageKey === lineageKey
    ),
  };
  const decision = decideInsightMutation(mutation, lineageKey, view);
  if (decision.kind === "stale") {
    return {
      outcome: `stale: ${decision.reason}`,
      insightId: null,
      lineageKey: null,
    };
  }

  if (mutation.action === "new") {
    const insight: PersonalMemoryInsightRecord = {
      id: state.nextIds.insight,
      userId,
      lineageKey,
      revision: 1,
      state: "active",
      origin: mutation.origin,
      category: mutation.category,
      text: mutation.text,
      scope: mutation.scope,
      confidence: mutation.confidence,
      allowProactiveMention: mutation.allowProactiveMention,
      supersededByInsightId: null,
      createdAt: now,
      updatedAt: now,
    };
    state.nextIds.insight += 1;
    state.insights.push(insight);
    addEvidenceLocally(
      state,
      userId,
      insight.id,
      event.id,
      event.sourceRevision
    );
    return { outcome: "created", insightId: insight.id, lineageKey };
  }

  if (mutation.action === "reinforce") {
    if (decision.kind !== "reinforce") {
      throw new Error(
        `internal invariant: reinforce mutation produced ${decision.kind} decision`
      );
    }
    decision.target.confidence = reinforceInsightConfidence(
      decision.target.confidence
    );
    decision.target.updatedAt = now;
    addEvidenceLocally(
      state,
      userId,
      decision.target.id,
      event.id,
      event.sourceRevision
    );
    return {
      outcome: "reinforced",
      insightId: decision.target.id,
      lineageKey,
    };
  }

  // supersede
  if (decision.kind !== "supersede") {
    throw new Error(
      `internal invariant: supersede mutation produced ${decision.kind} decision`
    );
  }
  decision.target.state = "superseded";
  decision.target.updatedAt = now;
  const next: PersonalMemoryInsightRecord = {
    id: state.nextIds.insight,
    userId,
    lineageKey,
    revision: decision.target.revision + 1,
    state: "active",
    origin: mutation.origin,
    category: mutation.category,
    text: mutation.text,
    scope: mutation.scope,
    confidence: mutation.confidence,
    allowProactiveMention: mutation.allowProactiveMention,
    supersededByInsightId: null,
    createdAt: now,
    updatedAt: now,
  };
  state.nextIds.insight += 1;
  state.insights.push(next);
  decision.target.supersededByInsightId = next.id;
  addEvidenceLocally(state, userId, next.id, event.id, event.sourceRevision);
  return { outcome: "superseded", insightId: next.id, lineageKey };
}

function addEvidenceLocally(
  state: PersonalMemoryLocalState,
  userId: number,
  insightId: number,
  eventId: number,
  sourceRevision: string
): void {
  const existing = state.evidence.find(
    row => row.insightId === insightId && row.eventId === eventId
  );
  if (existing) return; // (insightId, eventId) 唯一，重放幂等
  state.evidence.push({
    id: state.nextIds.evidence,
    userId,
    insightId,
    eventId,
    sourceRevision,
    createdAt: new Date().toISOString(),
  });
  state.nextIds.evidence += 1;
}

/** MySQL 模式：同一事务内完成一次提炼。 */
async function applyExtractionCompletionMysql(
  tx: PersonalMemoryMysqlTx,
  input: PersonalMemoryExtractionCompletion
): Promise<PersonalMemoryExtractionCompletionResult> {
  const [jobRow] = await tx
    .select()
    .from(personalMemoryJobs)
    .where(eq(personalMemoryJobs.id, input.jobId))
    .limit(1);
  if (
    !jobRow ||
    jobRow.leaseToken !== input.leaseToken ||
    jobRow.state !== "claimed"
  ) {
    return { jobClaimValid: false, discarded: null, applied: [] };
  }

  const finish = async (
    discarded: PersonalMemoryExtractionCompletionResult["discarded"],
    applied: PersonalMemoryExtractionCompletionResult["applied"]
  ): Promise<PersonalMemoryExtractionCompletionResult> => {
    await tx
      .update(personalMemoryJobs)
      .set({ state: "succeeded", leaseToken: null, leaseExpiresAt: null })
      .where(eq(personalMemoryJobs.id, input.jobId));
    return { jobClaimValid: true, discarded, applied };
  };

  const [eventRow] = await tx
    .select()
    .from(personalMemoryEvents)
    .where(eq(personalMemoryEvents.id, input.eventId))
    .limit(1);
  if (!eventRow || eventRow.contentScrubbed) {
    return finish("content_scrubbed", []);
  }
  const event = rowToPersonalMemoryEvent(eventRow);

  const [suppressionRow] = await tx
    .select({
      suppressedEventIds: personalMemorySuppressions.suppressedEventIds,
    })
    .from(personalMemorySuppressions)
    .where(
      and(
        eq(personalMemorySuppressions.userId, input.userId),
        sql`JSON_CONTAINS(${personalMemorySuppressions.suppressedEventIds}, ${JSON.stringify(input.eventId)})`
      )
    )
    .limit(1);
  if (suppressionRow) return finish("event_suppressed", []);

  const applied: PersonalMemoryExtractionCompletionResult["applied"] = [];
  for (const mutation of input.mutations) {
    applied.push({
      mutation,
      ...(await applyInsightMutationMysql(tx, input.userId, event, mutation)),
    });
  }
  return finish(null, applied);
}

/**
 * 按 `mutation.action` 分支（而不是 `decision.kind`），理由同本地版本：
 * `decision` 与 `mutation` 是分开算出来的两个值，只有判在 `mutation` 自己的
 * 判别字段上，TypeScript 才能在分支内正确收窄出 `mutation.text` 这些字段。
 */
async function applyInsightMutationMysql(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  event: PersonalMemoryEventRecord,
  mutation: PersonalMemoryInsightMutation
): Promise<Omit<PersonalMemoryAppliedMutation, "mutation">> {
  const lineageKey =
    mutation.action === "new" ? randomUUID() : mutation.lineageKey;
  const rows = await tx
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey)
      )
    )
    .for("update");
  const revisions = rows.map(rowToPersonalMemoryInsight);
  const decision = decideInsightMutation(mutation, lineageKey, { revisions });
  if (decision.kind === "stale") {
    return {
      outcome: `stale: ${decision.reason}`,
      insightId: null,
      lineageKey: null,
    };
  }

  if (mutation.action === "new") {
    await tx.insert(personalMemoryInsights).values({
      userId,
      lineageKey,
      revision: 1,
      state: "active",
      origin: mutation.origin,
      category: mutation.category,
      text: mutation.text,
      scope: mutation.scope,
      confidence: mutation.confidence,
      allowProactiveMention: mutation.allowProactiveMention,
    });
    const [created] = await tx
      .select({ id: personalMemoryInsights.id })
      .from(personalMemoryInsights)
      .where(
        and(
          eq(personalMemoryInsights.userId, userId),
          eq(personalMemoryInsights.lineageKey, lineageKey),
          eq(personalMemoryInsights.revision, 1)
        )
      )
      .limit(1);
    if (created) {
      await addEvidenceMysql(
        tx,
        userId,
        created.id,
        event.id,
        event.sourceRevision
      );
    }
    return { outcome: "created", insightId: created?.id ?? null, lineageKey };
  }

  if (mutation.action === "reinforce") {
    if (decision.kind !== "reinforce") {
      throw new Error(
        `internal invariant: reinforce mutation produced ${decision.kind} decision`
      );
    }
    await tx
      .update(personalMemoryInsights)
      .set({
        confidence: reinforceInsightConfidence(decision.target.confidence),
      })
      .where(eq(personalMemoryInsights.id, decision.target.id));
    await addEvidenceMysql(
      tx,
      userId,
      decision.target.id,
      event.id,
      event.sourceRevision
    );
    return {
      outcome: "reinforced",
      insightId: decision.target.id,
      lineageKey,
    };
  }

  // supersede
  if (decision.kind !== "supersede") {
    throw new Error(
      `internal invariant: supersede mutation produced ${decision.kind} decision`
    );
  }
  const nextRevision = decision.target.revision + 1;
  await tx.insert(personalMemoryInsights).values({
    userId,
    lineageKey,
    revision: nextRevision,
    state: "active",
    origin: mutation.origin,
    category: mutation.category,
    text: mutation.text,
    scope: mutation.scope,
    confidence: mutation.confidence,
    allowProactiveMention: mutation.allowProactiveMention,
  });
  const [created] = await tx
    .select({ id: personalMemoryInsights.id })
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey),
        eq(personalMemoryInsights.revision, nextRevision)
      )
    )
    .limit(1);
  await tx
    .update(personalMemoryInsights)
    .set({
      state: "superseded",
      supersededByInsightId: created?.id ?? null,
    })
    .where(eq(personalMemoryInsights.id, decision.target.id));
  if (created) {
    await addEvidenceMysql(
      tx,
      userId,
      created.id,
      event.id,
      event.sourceRevision
    );
  }
  return { outcome: "superseded", insightId: created?.id ?? null, lineageKey };
}

async function addEvidenceMysql(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  insightId: number,
  eventId: number,
  sourceRevision: string
): Promise<void> {
  await tx
    .insert(personalMemoryEvidence)
    .values({ userId, insightId, eventId, sourceRevision })
    .onDuplicateKeyUpdate({ set: { sourceRevision } }); // (insightId, eventId) 唯一，重放幂等
}

export type FailPersonalMemoryJobInput = {
  jobId: number;
  leaseToken: string;
  errorKind: string;
  /** true：任务永久失败，不再重试。false：退避后重新排队。 */
  permanent: boolean;
  /** 非永久失败时的下次可用时间。 */
  nextAvailableAt?: Date;
};

/**
 * 任务失败处理。条件更新在 leaseToken 上：过期 lease 被别人抢先 claim
 * 后再回来失败，这里直接不生效（affectedRows=0／本地找不到匹配），
 * 不会覆盖新 claim 的状态。
 */
export async function failPersonalMemoryJob(
  input: FailPersonalMemoryJobInput
): Promise<boolean> {
  const nextState = input.permanent ? "permanently_failed" : "pending";
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const job = memoryState.personalMemory.jobs.find(
        item => item.id === input.jobId
      );
      if (
        !job ||
        job.leaseToken !== input.leaseToken ||
        job.state !== "claimed"
      ) {
        return false;
      }
      job.state = nextState;
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      job.lastErrorKind = input.errorKind;
      job.updatedAt = new Date().toISOString();
      if (!input.permanent && input.nextAvailableAt) {
        job.availableAt = input.nextAvailableAt.toISOString();
      }
      await persistMemoryState();
      return true;
    });
  }
  const result = await db
    .update(personalMemoryJobs)
    .set({
      state: nextState,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorKind: input.errorKind,
      ...(!input.permanent && input.nextAvailableAt
        ? { availableAt: input.nextAvailableAt }
        : {}),
    })
    .where(
      and(
        eq(personalMemoryJobs.id, input.jobId),
        eq(personalMemoryJobs.leaseToken, input.leaseToken),
        eq(personalMemoryJobs.state, "claimed")
      )
    );
  return result[0].affectedRows === 1;
}

/** 单个任务当前状态；供 runner 的 kill switch 判断残留积压时读取。 */
export async function countPendingPersonalMemoryJobs(): Promise<number> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.jobs.filter(
      job => job.state === "pending"
    ).length;
  }
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(personalMemoryJobs)
    .where(eq(personalMemoryJobs.state, "pending"));
  return Number(row?.count ?? 0);
}

// ─── 提炼候选与抑制检查 ─────────────────────────────────────────────────

/**
 * 喂给模型的「可能冲突」候选：这个用户当前活跃的理解，最近更新的在前。
 * 数量必须小——「提炼输入只包含单个经历及最少冲突候选」，不是全量召回。
 */
export async function listActivePersonalMemoryInsightCandidates(
  userId: number,
  limit: number
): Promise<PersonalMemoryInsightRecord[]> {
  const safeLimit = Math.max(0, Math.min(20, Math.floor(limit)));
  if (safeLimit === 0) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights
      .filter(row => row.userId === userId && row.state === "active")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, safeLimit);
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.state, "active")
      )
    )
    .orderBy(desc(personalMemoryInsights.updatedAt))
    .limit(safeLimit);
  return rows.map(rowToPersonalMemoryInsight);
}

/** 这条事件的证据是否被某条忘记 tombstone 永久禁止再次生成理解。 */
export async function isPersonalMemoryEventSuppressed(
  userId: number,
  eventId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.suppressions.some(
      row => row.userId === userId && row.suppressedEventIds.includes(eventId)
    );
  }
  const [row] = await db
    .select({ id: personalMemorySuppressions.id })
    .from(personalMemorySuppressions)
    .where(
      and(
        eq(personalMemorySuppressions.userId, userId),
        sql`JSON_CONTAINS(${personalMemorySuppressions.suppressedEventIds}, ${JSON.stringify(eventId)})`
      )
    )
    .limit(1);
  return Boolean(row);
}

/** 读一条 lineage 的全部修订，按 revision 升序。供测试与展示用。 */
export async function listPersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<PersonalMemoryInsightRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights
      .filter(row => row.userId === userId && row.lineageKey === lineageKey)
      .sort((a, b) => a.revision - b.revision);
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey)
      )
    )
    .orderBy(personalMemoryInsights.revision);
  return rows.map(rowToPersonalMemoryInsight);
}

export async function listPersonalMemoryEvidenceForInsight(
  insightId: number
): Promise<PersonalMemoryEvidenceRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.evidence.filter(
      row => row.insightId === insightId
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryEvidence)
    .where(eq(personalMemoryEvidence.insightId, insightId));
  return rows.map(rowToPersonalMemoryEvidence);
}

// ─── 理解状态迁移：归档／恢复／忘记／来源清空 ───────────────────────────
//
// 四个都是**用户可见动作**（或由删除传播触发），所以各自都在同一事务里
// 补一条 `sourceType: "insight"` 的经历，让状态变化本身可追溯——footprint
// 以后能说清楚「这条理解是哪天被归档/恢复/忘记的」。提炼驱动的 reinforce
// 不需要这个：它复用触发它的原始事件作证据，没有「新状态变化」要交代。

export type LineageStateChangeResult =
  | { outcome: "applied"; insightId: number }
  | { outcome: "invalid"; reason: string };

async function recordInsightLifecycleEventInTx(
  scope: PersonalMemoryTxScope,
  input: {
    userId: number;
    lineageKey: string;
    revision: number;
    actionKind: Extract<
      PersonalMemoryEventIdentity["actionKind"],
      | "insight_archived"
      | "insight_restored"
      | "insight_forgotten"
      | "insight_corrected"
    >;
  }
): Promise<void> {
  const now = new Date();
  await capturePersonalMemoryEvent(scope, {
    identity: {
      userId: input.userId,
      sourceType: "insight",
      sourceKey: `insight:${input.lineageKey}`,
      sourceRevision: String(input.revision),
      actionKind: input.actionKind,
      actionId: randomUUID(),
    },
    occurredOn: chinaDateStringLocal(now),
    occurredAt: now.toISOString(),
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: null,
    job: null,
  });
}

/** 与 emotionDailyReference302.chinaDateString 同口径，db.ts 不引入该模块避免循环依赖。 */
function chinaDateStringLocal(date: Date): string {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function archivePersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<LineageStateChangeResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const view = localLineageView(userId, lineageKey);
        const decision = decideLineageStateChange(view, "archived");
        if (decision.kind === "invalid") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        decision.target.state = "archived";
        decision.target.updatedAt = new Date().toISOString();
        await recordInsightLifecycleEventInTx(
          { mode: "local", state: memoryState.personalMemory },
          {
            userId,
            lineageKey,
            revision: decision.target.revision,
            actionKind: "insight_archived",
          }
        );
        await persistMemoryState();
        return { outcome: "applied", insightId: decision.target.id } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, userId, lineageKey);
    const decision = decideLineageStateChange(view, "archived");
    if (decision.kind === "invalid") {
      return { outcome: "invalid", reason: decision.reason };
    }
    await tx
      .update(personalMemoryInsights)
      .set({ state: "archived" })
      .where(eq(personalMemoryInsights.id, decision.target.id));
    await recordInsightLifecycleEventInTx(
      { mode: "mysql", tx },
      {
        userId,
        lineageKey,
        revision: decision.target.revision,
        actionKind: "insight_archived",
      }
    );
    return { outcome: "applied", insightId: decision.target.id };
  });
}

export async function restorePersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<LineageStateChangeResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const view = localLineageView(userId, lineageKey);
        const decision = decideLineageStateChange(view, "active");
        if (decision.kind === "invalid") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        decision.target.state = "active";
        decision.target.updatedAt = new Date().toISOString();
        await recordInsightLifecycleEventInTx(
          { mode: "local", state: memoryState.personalMemory },
          {
            userId,
            lineageKey,
            revision: decision.target.revision,
            actionKind: "insight_restored",
          }
        );
        await persistMemoryState();
        return { outcome: "applied", insightId: decision.target.id } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, userId, lineageKey);
    const decision = decideLineageStateChange(view, "active");
    if (decision.kind === "invalid") {
      return { outcome: "invalid", reason: decision.reason };
    }
    await tx
      .update(personalMemoryInsights)
      .set({ state: "active" })
      .where(eq(personalMemoryInsights.id, decision.target.id));
    await recordInsightLifecycleEventInTx(
      { mode: "mysql", tx },
      {
        userId,
        lineageKey,
        revision: decision.target.revision,
        actionKind: "insight_restored",
      }
    );
    return { outcome: "applied", insightId: decision.target.id };
  });
}

/**
 * 忘记整条 lineage：清除**全部修订**的正文（不只是当前 tip——历史 superseded
 * 版本也是要忘记的「派生内容」的一部分），建立忘记 tombstone 绑定这条 lineage
 * 历史上出现过的全部证据事件，并在同一事务里递增用户隐私 epoch。
 */
export async function forgetPersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<LineageStateChangeResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const view = localLineageView(userId, lineageKey);
        const decision = decideLineageStateChange(view, "forgotten");
        if (decision.kind === "invalid") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        const now = new Date().toISOString();
        const insightIds = new Set(view.revisions.map(row => row.id));
        for (const revision of view.revisions) {
          revision.state = "forgotten";
          revision.text = null;
          revision.updatedAt = now;
        }
        const suppressedEventIds = Array.from(
          new Set(
            memoryState.personalMemory.evidence
              .filter(row => insightIds.has(row.insightId))
              .map(row => row.eventId)
          )
        );
        memoryState.personalMemory.evidence =
          memoryState.personalMemory.evidence.filter(
            row => !insightIds.has(row.insightId)
          );
        const existingSuppression =
          memoryState.personalMemory.suppressions.find(
            row => row.userId === userId && row.lineageKey === lineageKey
          );
        if (existingSuppression) {
          existingSuppression.suppressedEventIds = Array.from(
            new Set([
              ...existingSuppression.suppressedEventIds,
              ...suppressedEventIds,
            ])
          );
        } else {
          memoryState.personalMemory.suppressions.push({
            id: memoryState.personalMemory.nextIds.suppression,
            userId,
            lineageKey,
            suppressedEventIds,
            createdAt: now,
          });
          memoryState.personalMemory.nextIds.suppression += 1;
        }
        bumpPrivacyEpochLocally(userId);
        await recordInsightLifecycleEventInTx(
          { mode: "local", state: memoryState.personalMemory },
          {
            userId,
            lineageKey,
            revision: decision.target.revision,
            actionKind: "insight_forgotten",
          }
        );
        await persistMemoryState();
        return { outcome: "applied", insightId: decision.target.id } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, userId, lineageKey);
    const decision = decideLineageStateChange(view, "forgotten");
    if (decision.kind === "invalid") {
      return { outcome: "invalid", reason: decision.reason };
    }
    const insightIds = view.revisions.map(row => row.id);
    await tx
      .update(personalMemoryInsights)
      .set({ state: "forgotten", text: null })
      .where(
        and(
          eq(personalMemoryInsights.userId, userId),
          inArray(personalMemoryInsights.id, insightIds)
        )
      );
    const evidenceRows = await tx
      .select({ eventId: personalMemoryEvidence.eventId })
      .from(personalMemoryEvidence)
      .where(inArray(personalMemoryEvidence.insightId, insightIds));
    const suppressedEventIds = Array.from(
      new Set(evidenceRows.map(row => row.eventId))
    );
    await tx
      .delete(personalMemoryEvidence)
      .where(inArray(personalMemoryEvidence.insightId, insightIds));
    const [existing] = await tx
      .select()
      .from(personalMemorySuppressions)
      .where(
        and(
          eq(personalMemorySuppressions.userId, userId),
          eq(personalMemorySuppressions.lineageKey, lineageKey)
        )
      )
      .limit(1);
    const mergedIds = Array.from(
      new Set([
        ...((existing?.suppressedEventIds as number[] | undefined) ?? []),
        ...suppressedEventIds,
      ])
    );
    if (existing) {
      await tx
        .update(personalMemorySuppressions)
        .set({ suppressedEventIds: mergedIds })
        .where(eq(personalMemorySuppressions.id, existing.id));
    } else {
      await tx.insert(personalMemorySuppressions).values({
        userId,
        lineageKey,
        suppressedEventIds: mergedIds,
      });
    }
    await bumpPrivacyEpochInTx(tx, userId);
    await recordInsightLifecycleEventInTx(
      { mode: "mysql", tx },
      {
        userId,
        lineageKey,
        revision: decision.target.revision,
        actionKind: "insight_forgotten",
      }
    );
    return { outcome: "applied", insightId: decision.target.id };
  });
}

function localLineageView(
  userId: number,
  lineageKey: string
): PersonalMemoryInsightLineageView {
  return {
    revisions: memoryState.personalMemory.insights.filter(
      row => row.userId === userId && row.lineageKey === lineageKey
    ),
  };
}

async function mysqlLineageView(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  lineageKey: string
): Promise<PersonalMemoryInsightLineageView> {
  const rows = await tx
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey)
      )
    )
    .for("update");
  return { revisions: rows.map(rowToPersonalMemoryInsight) };
}

function bumpPrivacyEpochLocally(userId: number): number {
  const rows = memoryState.personalMemory.privacyEpochs;
  const existing = rows.find(row => row.userId === userId);
  const next = (existing?.epoch ?? 1) + 1;
  const stamp = new Date().toISOString();
  if (existing) {
    existing.epoch = next;
    existing.updatedAt = stamp;
  } else {
    rows.push({ userId, epoch: next, updatedAt: stamp });
  }
  return next;
}

/** 与 bumpPersonalMemoryPrivacyEpoch 语义相同，但在调用方已有的事务里执行。 */
async function bumpPrivacyEpochInTx(
  tx: PersonalMemoryMysqlTx,
  userId: number
): Promise<void> {
  await tx
    .insert(personalMemoryPrivacyEpochs)
    .values({ userId, epoch: 2 })
    .onDuplicateKeyUpdate({
      set: { epoch: sql`${personalMemoryPrivacyEpochs.epoch} + 1` },
    });
}

// ─── 来源清空（删除传播）后重新计算依据 ─────────────────────────────────

export type ScrubEventResult = {
  /** false = 事件已经是 scrubbed（重放安全，幂等），本次没有新动作。 */
  changed: boolean;
  /** 因这次清空而退出召回（active → unsupported）的理解数。 */
  unsupportedInsightIds: number[];
};

/**
 * 明确删除来源时调用：清空事件正文，重新计算把它当证据的活跃理解是否还有
 * 依据，最后一个有效来源没了的理解退出召回并清除正文。同一事务里递增隐私
 * epoch——在途的来信生成即使已经拿到模型结果也不能再用旧输入提交。
 *
 * 多来源理解删掉其中一个仍然有依据：这里只处理**这一个事件**波及到的理解，
 * 判定用 shared 的 decideEvidenceLossOutcome，不在这里重新发明规则。
 */
export async function scrubPersonalMemoryEventAndRecompute(
  userId: number,
  eventId: number
): Promise<ScrubEventResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const state = memoryState.personalMemory;
        const event = state.events.find(
          item => item.id === eventId && item.userId === userId
        );
        if (!event) return { changed: false, unsupportedInsightIds: [] };
        if (event.contentScrubbed) {
          return { changed: false, unsupportedInsightIds: [] };
        }
        event.contentScrubbed = true;
        event.snapshot = createEmptyPersonalMemoryEventSnapshot();

        const affectedInsightIds = new Set(
          state.evidence
            .filter(row => row.eventId === eventId && row.userId === userId)
            .map(row => row.insightId)
        );
        const unsupported: number[] = [];
        for (const insightId of affectedInsightIds) {
          const insight = state.insights.find(row => row.id === insightId);
          if (!insight) continue;
          const remaining = state.evidence.filter(row => {
            if (row.insightId !== insightId) return false;
            const evidenceEvent = state.events.find(e => e.id === row.eventId);
            return Boolean(evidenceEvent) && !evidenceEvent!.contentScrubbed;
          }).length;
          const outcome = decideEvidenceLossOutcome(insight, remaining);
          if (outcome === "unsupported") {
            insight.state = "unsupported";
            insight.text = null;
            insight.updatedAt = new Date().toISOString();
            unsupported.push(insight.id);
          }
        }
        bumpPrivacyEpochLocally(userId);
        await persistMemoryState();
        return { changed: true, unsupportedInsightIds: unsupported };
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }

  return db.transaction(async tx => {
    const [eventRow] = await tx
      .select()
      .from(personalMemoryEvents)
      .where(
        and(
          eq(personalMemoryEvents.id, eventId),
          eq(personalMemoryEvents.userId, userId)
        )
      )
      .limit(1)
      .for("update");
    if (!eventRow) return { changed: false, unsupportedInsightIds: [] };
    if (eventRow.contentScrubbed) {
      return { changed: false, unsupportedInsightIds: [] };
    }
    await tx
      .update(personalMemoryEvents)
      .set({
        contentScrubbed: true,
        excerpt: null,
        contentHash: null,
        display: null,
      })
      .where(eq(personalMemoryEvents.id, eventId));

    const affectedRows = await tx
      .select({ insightId: personalMemoryEvidence.insightId })
      .from(personalMemoryEvidence)
      .where(
        and(
          eq(personalMemoryEvidence.eventId, eventId),
          eq(personalMemoryEvidence.userId, userId)
        )
      );
    const affectedInsightIds = Array.from(
      new Set(affectedRows.map(row => row.insightId))
    );
    const unsupported: number[] = [];
    for (const insightId of affectedInsightIds) {
      const [insightRow] = await tx
        .select()
        .from(personalMemoryInsights)
        .where(eq(personalMemoryInsights.id, insightId))
        .limit(1)
        .for("update");
      if (!insightRow) continue;
      const insight = rowToPersonalMemoryInsight(insightRow);
      const evidenceRows = await tx
        .select({ eventId: personalMemoryEvidence.eventId })
        .from(personalMemoryEvidence)
        .where(eq(personalMemoryEvidence.insightId, insightId));
      let remaining = 0;
      for (const row of evidenceRows) {
        const [ev] = await tx
          .select({ contentScrubbed: personalMemoryEvents.contentScrubbed })
          .from(personalMemoryEvents)
          .where(eq(personalMemoryEvents.id, row.eventId))
          .limit(1);
        if (ev && !ev.contentScrubbed) remaining += 1;
      }
      const outcome = decideEvidenceLossOutcome(insight, remaining);
      if (outcome === "unsupported") {
        await tx
          .update(personalMemoryInsights)
          .set({ state: "unsupported", text: null })
          .where(eq(personalMemoryInsights.id, insightId));
        unsupported.push(insightId);
      }
    }
    await bumpPrivacyEpochInTx(tx, userId);
    return { changed: true, unsupportedInsightIds: unsupported };
  });
}

// ─── 手动纠正 ───────────────────────────────────────────────────────────

/**
 * 用户在足迹里直接纠正一条理解（U7 的 UI 动作，这里先建好底层机制）。
 * 可信级别永远是 user_corrected——这不是可配置项。
 *
 * 纠正没有天然的「触发事件」，所以先在同一事务里补一条 sourceType=insight
 * 的经历（actionKind: insight_corrected），把它当作这次纠正唯一的证据。
 * 目标 lineage 必须当前是 active（与提炼的 supersede 同一条门槛）；
 * lineage 不存在时视为对一个新理解的直接陈述，走 create。
 */
function buildCorrectionMutation(
  input: {
    lineageKey: string | null;
    category: PersonalMemoryInsightRecord["category"];
    text: string;
    scope: Record<string, unknown> | null;
    allowProactiveMention: boolean;
  },
  tipRevision: number | undefined
): PersonalMemoryInsightMutation {
  return input.lineageKey
    ? {
        action: "supersede",
        lineageKey: input.lineageKey,
        // 纠正是一次读了当前内容之后做出的动作：expectedRevision 就是刚读到
        // 的这个 tip 版本号。真正防「陈旧覆盖」的检查发生在 decideInsightMutation
        // 里；这里给不出版本号（tip 不存在）时传 -1，保证必然判 stale 而不是
        // 侥幸通过。
        expectedRevision: tipRevision ?? -1,
        origin: "user_corrected",
        category: input.category,
        text: input.text,
        scope: input.scope,
        confidence: 1,
        allowProactiveMention: input.allowProactiveMention,
      }
    : {
        action: "new",
        origin: "user_corrected",
        category: input.category,
        text: input.text,
        scope: input.scope,
        confidence: 1,
        allowProactiveMention: input.allowProactiveMention,
      };
}

export async function correctPersonalMemoryInsight(input: {
  userId: number;
  lineageKey: string | null;
  category: PersonalMemoryInsightRecord["category"];
  text: string;
  scope: Record<string, unknown> | null;
  allowProactiveMention: boolean;
}): Promise<LineageStateChangeResult> {
  const lineageKey = input.lineageKey ?? randomUUID();

  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const state = memoryState.personalMemory;
        const view = localLineageView(input.userId, lineageKey);
        const mutation = buildCorrectionMutation(
          input,
          insightLineageTip(view)?.revision
        );
        const decision = decideInsightMutation(mutation, lineageKey, view);
        if (decision.kind === "stale") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        const eventNow = new Date();
        const eventCapture = correctionEventCapture(
          input.userId,
          lineageKey,
          view,
          eventNow
        );
        const captured = applyPersonalMemoryCapture(state, eventCapture);
        const result = applyInsightMutationLocally(
          state,
          input.userId,
          captured.event,
          mutation
        );
        if (result.insightId === null) {
          return { outcome: "invalid", reason: result.outcome } as const;
        }
        await persistMemoryState();
        return { outcome: "applied", insightId: result.insightId } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }

  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, input.userId, lineageKey);
    const mutation = buildCorrectionMutation(
      input,
      insightLineageTip(view)?.revision
    );
    const decision = decideInsightMutation(mutation, lineageKey, view);
    if (decision.kind === "stale") {
      return { outcome: "invalid", reason: decision.reason };
    }
    const eventNow = new Date();
    const eventCapture = correctionEventCapture(
      input.userId,
      lineageKey,
      view,
      eventNow
    );
    await capturePersonalMemoryEvent({ mode: "mysql", tx }, eventCapture);
    const event = await findPersonalMemoryEventInTx(tx, eventCapture.identity);
    if (!event) throw new Error("纠正经历写入后读不回");
    const result = await applyInsightMutationMysql(
      tx,
      input.userId,
      event,
      mutation
    );
    if (result.insightId === null) {
      return { outcome: "invalid", reason: result.outcome };
    }
    const tipView = await mysqlLineageView(tx, input.userId, lineageKey);
    const tip = insightLineageTip(tipView);
    return { outcome: "applied", insightId: tip!.id };
  });
}

function correctionEventCapture(
  userId: number,
  lineageKey: string,
  view: PersonalMemoryInsightLineageView,
  now: Date
): PersonalMemoryCapture {
  const nextRevision = (insightLineageTip(view)?.revision ?? 0) + 1;
  return {
    identity: {
      userId,
      sourceType: "insight",
      sourceKey: `insight:${lineageKey}`,
      sourceRevision: String(nextRevision),
      actionKind: "insight_corrected",
      actionId: randomUUID(),
    },
    occurredOn: chinaDateStringLocal(now),
    occurredAt: now.toISOString(),
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: null,
    job: null,
  };
}

/** 读一个 lineage 的忘记 tombstone（若存在）。供测试与展示用。 */
export async function getPersonalMemorySuppression(
  userId: number,
  lineageKey: string
): Promise<PersonalMemorySuppressionRecord | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.suppressions.find(
        row => row.userId === userId && row.lineageKey === lineageKey
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(personalMemorySuppressions)
    .where(
      and(
        eq(personalMemorySuppressions.userId, userId),
        eq(personalMemorySuppressions.lineageKey, lineageKey)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    lineageKey: row.lineageKey,
    suppressedEventIds: row.suppressedEventIds as number[],
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── 提炼的完整正文回源（U5）───────────────────────────────────────────

/**
 * 按 messageId + userId 直接读一条聊天消息的完整正文，用于提炼。
 *
 * 聊天消息事件的快照只存 200 字展示摘录（见 personalMemoryEvents.ts 的
 * chatSnapshotFor）——那是有意的：这条来源有稳定不变的权威修订，截断摘录
 * 不丢东西，完整正文永远从这里回源解析。`story_conversation_messages` 行上
 * 直接带 userId，不需要经过 storyId 才能验证归属。
 *
 * 消息已被删除或不属于这个用户时返回 null——调用方（提炼）据此把它当作
 * 内容已清空处理，不編造正文。
 */
export async function getChatMessageContentForPersonalMemory(
  messageId: number,
  userId: number
): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    await ensureLocalPromptLineageLoaded();
    const message = memoryState.promptLineage.messages.find(
      row => row.id === messageId && row.userId === userId
    );
    return message?.content ?? null;
  }
  const [row] = await db
    .select({ content: storyConversationMessages.content })
    .from(storyConversationMessages)
    .where(
      and(
        eq(storyConversationMessages.id, messageId),
        eq(storyConversationMessages.userId, userId)
      )
    )
    .limit(1);
  return row?.content ?? null;
}

/** 按事件 ID 读一条经历，供提炼取 sourceType／snapshot 用。 */
export async function getPersonalMemoryEventById(
  eventId: number,
  userId: number
): Promise<PersonalMemoryEventRecord | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.events.find(
        event => event.id === eventId && event.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.id, eventId),
        eq(personalMemoryEvents.userId, userId)
      )
    )
    .limit(1);
  return row ? rowToPersonalMemoryEvent(row) : null;
}
