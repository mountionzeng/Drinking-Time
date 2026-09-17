/** Persistence operations for memoryEvents. Local and MySQL behavior share this boundary. */
import { eq, and, desc, inArray, lt, or, sql } from "drizzle-orm";
import {
  personalMemorySources,
  personalMemoryEvents,
  personalMemoryJobs,
  personalMemoryPrivacyEpochs,
  personalMemoryInsights,
} from "../../drizzle/schema";
import {
  applyPersonalMemoryCapture,
  normalizePersonalMemoryEventIdentity,
  personalMemoryEventFingerprint,
  projectPersonalMemoryOutbox,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryEventRecord,
  type PersonalMemoryInsightRecord,
  type PersonalMemoryInsightState,
  type PersonalMemoryLocalState,
  type PersonalMemoryOutboxEntry,
  type PersonalMemorySourceType,
  type PersonalMemoryTimelineCursor,
} from "../../shared/personalMemory";
import {
  getDb,
  memoryState,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import { rowToPersonalMemoryInsight } from "./memoryRows";

// ─── 个人记忆（U1）─────────────────────────────────────────────────────
//
// 语义在 shared/personalMemory.ts，这里只负责把它落到两条持久化路径上，
// 并保证两条路径对外可观察的结果一致。
//
// 两种模式的耐久机制**不同**，这是有意的，不要试图抹平：
//
//   MySQL：来源、事件与任务写在同一个 SQL 事务里，本来就原子。
//   本地：  outbox 写进来源自己所属的聚合，跨聚合靠带水位的幂等投影。
//          两份 JSON 之间没有共同事务，代码里也不许假装有。

export type PersonalMemoryEventRow = PersonalMemoryEventRecord;

/**
 * MySQL 事务句柄。U2／U3／U5 在自己的领域事务里把它传进来，
 * 让经历与来源写入搭上同一趟车，而不是各自另开一个嵌套事务。
 */
type DrizzleDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type PersonalMemoryMysqlTx = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];

/** 事务作用域。调用方必须已经在自己的领域事务／聚合写入里。 */
export type PersonalMemoryTxScope =
  | { mode: "mysql"; tx: PersonalMemoryMysqlTx }
  /**
   * 本地模式：直接作用在传入的状态上。调用方负责把这份状态和自己的来源
   * 一起落盘——失败就整份丢弃，不做部分回滚。
   */
  | { mode: "local"; state: PersonalMemoryLocalState };

export function rowToPersonalMemoryEvent(row: {
  id: number;
  userId: number;
  sourceType: string;
  sourceKey: string;
  sourceRevision: string;
  actionKind: string;
  actionId: string;
  occurredOn: string;
  occurredAt: Date;
  excerpt: string | null;
  contentHash: string | null;
  display: unknown;
  contentScrubbed: boolean;
  createdAt: Date;
}): PersonalMemoryEventRecord {
  return {
    id: row.id,
    userId: row.userId,
    sourceType: row.sourceType as PersonalMemoryEventIdentity["sourceType"],
    sourceKey: row.sourceKey,
    sourceRevision: row.sourceRevision,
    actionKind: row.actionKind as PersonalMemoryEventIdentity["actionKind"],
    actionId: row.actionId,
    occurredOn: row.occurredOn,
    occurredAt: row.occurredAt.toISOString(),
    snapshot: {
      excerpt: row.excerpt,
      contentHash: row.contentHash,
      display: (row.display as Record<string, unknown> | null) ?? null,
    },
    contentScrubbed: row.contentScrubbed,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 事务作用域内幂等捕获一次经历。
 *
 * 重放同一动作 ID 时返回既有事件、`changed: false`，事件／任务基数不变。
 * 身份非法（任何一段为空）会抛错——**在写任何一行之前**，因为空串在 MySQL
 * 唯一索引里等价于 NULL，放过去就是静默重复。
 */
export async function capturePersonalMemoryEvent(
  scope: PersonalMemoryTxScope,
  capture: PersonalMemoryCapture
): Promise<{ event: PersonalMemoryEventRecord; changed: boolean }> {
  // 先校验再动手：两条路径都不允许「写了一半才发现身份不合法」。
  const identity = normalizePersonalMemoryEventIdentity(capture.identity);

  if (scope.mode === "local") {
    return applyPersonalMemoryCapture(scope.state, {
      ...capture,
      identity,
    });
  }

  const { tx } = scope;
  const existing = await findPersonalMemoryEventInTx(tx, identity);
  if (existing) return { event: existing, changed: false };

  // 多态来源先登记进租户注册表；事件再用 (sourceId, userId) 复合外键指过来，
  // 这样跨账号引用在数据库层就写不进去。
  await tx
    .insert(personalMemorySources)
    .values({
      userId: identity.userId,
      sourceType: identity.sourceType,
      sourceKey: identity.sourceKey,
      storyId: capture.storyId,
    })
    .onDuplicateKeyUpdate({ set: { sourceKey: identity.sourceKey } });
  // FOR UPDATE：见 findPersonalMemoryEventInTx 的说明。上面这条
  // INSERT ... ON DUPLICATE KEY UPDATE 是当前读，能看到并发事务刚提交的来源行；
  // 但如果这里用普通读，就会退回本事务开始时的快照、把那一行读成不存在。
  const [source] = await tx
    .select({ id: personalMemorySources.id })
    .from(personalMemorySources)
    .where(
      and(
        eq(personalMemorySources.userId, identity.userId),
        eq(personalMemorySources.sourceType, identity.sourceType),
        eq(personalMemorySources.sourceKey, identity.sourceKey)
      )
    )
    .limit(1)
    .for("update");
  if (!source) throw new Error("个人记忆来源登记失败");

  const occurredAt = new Date(capture.occurredAt);
  try {
    await tx.insert(personalMemoryEvents).values({
      userId: identity.userId,
      sourceId: source.id,
      sourceType: identity.sourceType,
      sourceKey: identity.sourceKey,
      sourceRevision: identity.sourceRevision,
      actionKind: identity.actionKind,
      actionId: identity.actionId,
      occurredOn: capture.occurredOn,
      occurredAt,
      excerpt: capture.snapshot.excerpt,
      contentHash: capture.snapshot.contentHash,
      display: capture.snapshot.display,
    });
  } catch (error) {
    // 并发重放：另一个事务抢先写了同一身份。唯一索引挡住了重复，
    // 这里把既有事件当前读回来，语义与「一开始就发现已存在」完全一致。
    // 不用 SELECT ... FOR UPDATE 抢在插入之前做，是为了避免两个事务
    // 同时在缺失行上持有间隙锁然后互相等成死锁。
    if (!isDuplicateKeyError(error)) throw error;
    const existingAfterRace = await findPersonalMemoryEventInTx(
      tx,
      identity,
      true
    );
    if (!existingAfterRace) throw error;
    return { event: existingAfterRace, changed: false };
  }
  const event = await findPersonalMemoryEventInTx(tx, identity);
  if (!event) throw new Error("个人记忆事件写入后读不回");

  if (capture.job) {
    // 同一事件 + 同一提炼器版本只排一次，靠唯一索引兜住并发重复投递。
    // operationId 也有全局唯一索引，所以这里用 ON DUPLICATE KEY UPDATE
    // 而不是让并发投递炸出来。
    await tx
      .insert(personalMemoryJobs)
      .values({
        userId: identity.userId,
        eventId: event.id,
        operationId: capture.job.operationId,
        extractorVersion: capture.job.extractorVersion,
        availableAt: occurredAt,
      })
      .onDuplicateKeyUpdate({
        set: { extractorVersion: capture.job.extractorVersion },
      });
  }

  return { event, changed: true };
}

/**
 * 认出「唯一键冲突」。drizzle 会把 mysql2 的错误包一层，所以要顺着 cause 找。
 */
export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062)
      return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * 死锁。InnoDB 会挑一个事务回滚掉，被回滚的那个重试即可。
 *
 * 这在并发插入同一段区间时是**正常现象**，不是 bug——除非我们自己去抢间隙锁
 * 把它变成必然。见 appendEmotionDailyLetterVersion 的说明。
 */
export function isDeadlockError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (candidate.code === "ER_LOCK_DEADLOCK" || candidate.errno === 1213) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * @param locking true = `FOR UPDATE`，读当前已提交状态而不是事务快照。
 *
 * 这个参数不是性能开关，是正确性开关。MySQL 默认 REPEATABLE READ：事务里
 * 第一次普通 SELECT 就确立了快照，之后再普通读**看不到**别的事务在这期间
 * 提交的行——哪怕自己刚刚被那一行的唯一键挡了一下。所以「插入撞了唯一键、
 * 回头把既有行读出来」这一步必须是当前读，否则会读回空、然后误报写入失败。
 */
export async function findPersonalMemoryEventInTx(
  tx: PersonalMemoryMysqlTx,
  identity: PersonalMemoryEventIdentity,
  locking = false
): Promise<PersonalMemoryEventRecord | null> {
  const query = tx
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, identity.userId),
        eq(personalMemoryEvents.sourceType, identity.sourceType),
        eq(personalMemoryEvents.sourceKey, identity.sourceKey),
        eq(personalMemoryEvents.sourceRevision, identity.sourceRevision),
        eq(personalMemoryEvents.actionKind, identity.actionKind),
        eq(personalMemoryEvents.actionId, identity.actionId)
      )
    )
    .limit(1);
  const [row] = await (locking ? query.for("update") : query);
  return row ? rowToPersonalMemoryEvent(row) : null;
}

/**
 * 自带事务的捕获入口。只给「没有更大领域事务可搭车」的调用方用；
 * U2／U3／U5 必须走 capturePersonalMemoryEvent + 自己的事务。
 */
export async function capturePersonalMemoryEventStandalone(
  capture: PersonalMemoryCapture
): Promise<{ event: PersonalMemoryEventRecord; changed: boolean }> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      const result = capturePersonalMemoryEvent(
        { mode: "local", state: memoryState.personalMemory },
        capture
      );
      const resolved = await result;
      if (!resolved.changed) return resolved;
      try {
        await persistMemoryState();
      } catch (error) {
        // 落盘失败就整份还原：本地聚合是 copy-on-write，不留半写状态。
        memoryState.personalMemory = before;
        throw error;
      }
      return resolved;
    });
  }
  return db.transaction(async tx =>
    capturePersonalMemoryEvent({ mode: "mysql", tx }, capture)
  );
}

export async function getPersonalMemoryEventByIdentity(
  identity: PersonalMemoryEventIdentity
): Promise<PersonalMemoryEventRecord | null> {
  const normalized = normalizePersonalMemoryEventIdentity(identity);
  const db = await getDb();
  if (!db) {
    const fingerprint = personalMemoryEventFingerprint(normalized);
    return (
      memoryState.personalMemory.events.find(
        event => personalMemoryEventFingerprint(event) === fingerprint
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, normalized.userId),
        eq(personalMemoryEvents.sourceType, normalized.sourceType),
        eq(personalMemoryEvents.sourceKey, normalized.sourceKey),
        eq(personalMemoryEvents.sourceRevision, normalized.sourceRevision),
        eq(personalMemoryEvents.actionKind, normalized.actionKind),
        eq(personalMemoryEvents.actionId, normalized.actionId)
      )
    )
    .limit(1);
  return row ? rowToPersonalMemoryEvent(row) : null;
}

/**
 * 按 `occurredAt DESC, id DESC` 列出经历。
 * 两条路径排序必须一致，否则 U7 的 keyset 分页会在切换模式后错位。
 */
export async function listPersonalMemoryEvents(
  userId: number,
  limit = 50
): Promise<PersonalMemoryEventRecord[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.events
      .filter(event => event.userId === userId)
      .sort((left, right) => {
        const byTime = right.occurredAt.localeCompare(left.occurredAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      })
      .slice(0, safeLimit);
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(eq(personalMemoryEvents.userId, userId))
    .orderBy(
      desc(personalMemoryEvents.occurredAt),
      desc(personalMemoryEvents.id)
    )
    .limit(safeLimit);
  return rows.map(rowToPersonalMemoryEvent);
}

/**
 * 足迹时间线的 keyset 分页。
 *
 * 按 `(occurredAt DESC, id DESC)` 取 `limit + 1` 行：多出来那一行只用来判断
 * 「还有没有下一页」，不返回给调用方。用 keyset 而不是 OFFSET，是因为翻页
 * 期间随时会插入新事件——OFFSET 会让分页边界整体错位，用户会看到重复行，
 * 或者更糟：漏掉一整条经历还毫无察觉。
 *
 * `(userId, occurredAt, id)` 上有专门的复合索引支撑这个顺序。
 */
export async function listPersonalMemoryEventsPage(input: {
  userId: number;
  cursor?: PersonalMemoryTimelineCursor | null;
  limit?: number;
  sourceTypes?: readonly PersonalMemorySourceType[] | null;
}): Promise<{ events: PersonalMemoryEventRecord[]; hasMore: boolean }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
  const cursor = input.cursor ?? null;
  const sourceTypes =
    input.sourceTypes && input.sourceTypes.length > 0
      ? [...input.sourceTypes]
      : null;
  const db = await getDb();

  if (!db) {
    const cursorAt = cursor ? Date.parse(cursor.occurredAt) : null;
    const filtered = memoryState.personalMemory.events
      .filter(event => {
        if (event.userId !== input.userId) return false;
        if (sourceTypes && !sourceTypes.includes(event.sourceType)) {
          return false;
        }
        if (!cursor || cursorAt == null) return true;
        // 和 SQL 侧同一条 keyset 谓词：时间更早，或同一时刻但 id 更小。
        const eventAt = Date.parse(event.occurredAt);
        if (eventAt < cursorAt) return true;
        return eventAt === cursorAt && event.id < cursor.id;
      })
      .sort((left, right) => {
        const byTime =
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      });
    return {
      events: filtered.slice(0, safeLimit),
      hasMore: filtered.length > safeLimit,
    };
  }

  const conditions = [eq(personalMemoryEvents.userId, input.userId)];
  if (sourceTypes) {
    conditions.push(inArray(personalMemoryEvents.sourceType, sourceTypes));
  }
  if (cursor) {
    const cursorAt = new Date(cursor.occurredAt);
    conditions.push(
      or(
        lt(personalMemoryEvents.occurredAt, cursorAt),
        and(
          eq(personalMemoryEvents.occurredAt, cursorAt),
          lt(personalMemoryEvents.id, cursor.id)
        )
      )!
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(and(...conditions))
    .orderBy(
      desc(personalMemoryEvents.occurredAt),
      desc(personalMemoryEvents.id)
    )
    .limit(safeLimit + 1);
  return {
    events: rows.slice(0, safeLimit).map(rowToPersonalMemoryEvent),
    hasMore: rows.length > safeLimit,
  };
}

/**
 * 按 ID 批量取事件（仍然按 userId 过滤）。
 *
 * 存在的理由是理解卡要显示「依据 X 月 X 日起的 N 条记录」：证据行只存
 * eventId，日期在事件上。一张卡逐条查会变成 N×M 次往返，所以这里一次取回。
 */
export async function listPersonalMemoryEventsByIds(
  userId: number,
  eventIds: readonly number[]
): Promise<PersonalMemoryEventRecord[]> {
  const ids = [...new Set(eventIds)].filter(
    id => Number.isSafeInteger(id) && id > 0
  );
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.events.filter(
      event => event.userId === userId && ids.includes(event.id)
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, userId),
        inArray(personalMemoryEvents.id, ids)
      )
    );
  return rows.map(rowToPersonalMemoryEvent);
}

/**
 * 某一天的全部事件（不分页——一天的量天然有限，不需要 keyset）。
 *
 * 这条查询单独存在的理由：`listPersonalMemoryEventsPage` 是给"滚动浏览"用的
 * keyset 分页，只保证「最近 N 条」；日期详情页要的是「**这一天**的全部事件」，
 * 用户越活跃、要翻的天数越靠前，这两者的语义差距就越大——用最近 N 条做
 * 日期详情，翻旧日期会静默返回空，而不是报错，最容易被漏测。
 */
export async function listPersonalMemoryEventsForDay(
  userId: number,
  occurredOn: string
): Promise<PersonalMemoryEventRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.events
      .filter(
        event => event.userId === userId && event.occurredOn === occurredOn
      )
      .sort((left, right) => {
        const byTime = right.occurredAt.localeCompare(left.occurredAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      });
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, userId),
        eq(personalMemoryEvents.occurredOn, occurredOn)
      )
    )
    .orderBy(
      desc(personalMemoryEvents.occurredAt),
      desc(personalMemoryEvents.id)
    );
  return rows.map(rowToPersonalMemoryEvent);
}

/**
 * 列出某账号的派生理解。
 *
 * 只按 userId 过滤——所有调用方都必须从认证上下文拿这个值，绝不接受
 * 客户端传入的用户身份。
 */
export async function listPersonalMemoryInsightsForUser(input: {
  userId: number;
  states?: readonly PersonalMemoryInsightState[] | null;
  limit?: number;
}): Promise<PersonalMemoryInsightRecord[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const states =
    input.states && input.states.length > 0 ? [...input.states] : null;
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights
      .filter(
        insight =>
          insight.userId === input.userId &&
          (!states || states.includes(insight.state))
      )
      .sort((left, right) => {
        const byTime = right.updatedAt.localeCompare(left.updatedAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      })
      .slice(0, safeLimit);
  }
  const conditions = [eq(personalMemoryInsights.userId, input.userId)];
  if (states) {
    conditions.push(inArray(personalMemoryInsights.state, states));
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(and(...conditions))
    .orderBy(
      desc(personalMemoryInsights.updatedAt),
      desc(personalMemoryInsights.id)
    )
    .limit(safeLimit);
  return rows.map(rowToPersonalMemoryInsight);
}

/**
 * 按 ID 批量取理解修订（仍按 userId 过滤）。
 *
 * 选材器算冷却期要把"过去某个 attemptId 提交时选中的 insightId"翻回
 * lineageKey——那条 insightId 可能是某个**特定修订**，纠正之后已经不在
 * 当前 active 候选池里了，但它的 lineageKey 仍然代表同一件事，冷却期
 * 必须认得出来，不能因为查不到当前候选就悄悄漏掉。理解修订是 append-only
 * 的（纠正产生新行，不改写旧行），所以按 ID 直接查旧修订总能查到。
 */
export async function listPersonalMemoryInsightsByIds(
  userId: number,
  insightIds: readonly number[]
): Promise<PersonalMemoryInsightRecord[]> {
  const ids = [...new Set(insightIds)].filter(
    id => Number.isSafeInteger(id) && id > 0
  );
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights.filter(
      insight => insight.userId === userId && ids.includes(insight.id)
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        inArray(personalMemoryInsights.id, ids)
      )
    );
  return rows.map(rowToPersonalMemoryInsight);
}

/**
 * 把某个来源聚合的 outbox 投影进统一足迹索引（**仅本地模式**）。
 *
 * MySQL 不需要它——那里事件本来就和来源同事务落库。
 */
export async function projectPersonalMemoryOutboxIntoIndex(
  aggregateName: string,
  entries: readonly PersonalMemoryOutboxEntry[]
): Promise<{ applied: number; skipped: number; watermark: number }> {
  const db = await getDb();
  if (db) return { applied: 0, skipped: entries.length, watermark: 0 };
  return withLocalAggregateMutationLock(async () => {
    const before = structuredClone(memoryState.personalMemory);
    const result = projectPersonalMemoryOutbox(
      memoryState.personalMemory,
      aggregateName,
      entries
    );
    if (
      result.applied === 0 &&
      result.watermark === before.projectionWatermarks[aggregateName]
    ) {
      return result;
    }
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.personalMemory = before;
      throw error;
    }
    return result;
  });
}

/**
 * 读取用户当前隐私 epoch。没有记录时是 1（不写行，读多写少）。
 */
export async function getPersonalMemoryPrivacyEpoch(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.privacyEpochs.find(
        row => row.userId === userId
      )?.epoch ?? 1
    );
  }
  const [row] = await db
    .select()
    .from(personalMemoryPrivacyEpochs)
    .where(eq(personalMemoryPrivacyEpochs.userId, userId))
    .limit(1);
  return row?.epoch ?? 1;
}

/**
 * 递增隐私 epoch。忘记或删除来源时**必须**在同一短事务里调用，
 * 让在途的来信生成即使已经拿到模型结果也无法提交旧输入。
 */
export async function bumpPersonalMemoryPrivacyEpoch(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const rows = memoryState.personalMemory.privacyEpochs;
      const existing = rows.find(row => row.userId === userId);
      const next = (existing?.epoch ?? 1) + 1;
      const stamp = now().toISOString();
      if (existing) {
        existing.epoch = next;
        existing.updatedAt = stamp;
      } else {
        rows.push({ userId, epoch: next, updatedAt: stamp });
      }
      await persistMemoryState();
      return next;
    });
  }
  await db
    .insert(personalMemoryPrivacyEpochs)
    .values({ userId, epoch: 2 })
    .onDuplicateKeyUpdate({
      set: { epoch: sql`${personalMemoryPrivacyEpochs.epoch} + 1` },
    });
  return getPersonalMemoryPrivacyEpoch(userId);
}
