/** 关键阶段的本地与 MySQL 存储。写入失败时返回 dropped，不向调用方抛错。 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_PLATFORMS,
  ACTIVITY_RESULTS,
  FAILURE_CATEGORIES,
  SUBJECT_KINDS,
  journeyFromProviderAttempt,
  platformForOperationType,
  subjectKindForOperationType,
  type ActivityEventName,
  type ActivityPlatform,
  type ActivityResult,
  type FailureCategory,
  type SubjectKind,
} from "../../shared/activityJourney";
import { activityJourneyEvents, type ActivityJourneyEvent } from "../../drizzle/schema";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

const DEDUPE_KEY = /^[a-z0-9][a-z0-9_:-]{7,79}$/;
const SERVER_BURST_LIMIT = 500;
const serverBursts = new Map<number, { windowStartedAt: number; count: number }>();
let forceWriteFailure = false;

export function failNextActivityWriteForTesting(failed: boolean): void {
  forceWriteFailure = failed;
}

export type NewActivityEvent = {
  userId: number;
  platform: ActivityPlatform;
  eventName: ActivityEventName;
  result?: ActivityResult;
  failureCategory?: FailureCategory | null;
  subjectKind?: SubjectKind | null;
  subjectRef?: number | null;
  dedupeKey: string;
  occurredAt?: Date;
};

export type ActivityEventView = {
  userId: number;
  platform: ActivityPlatform;
  eventName: ActivityEventName;
  result: ActivityResult;
  failureCategory: FailureCategory | null;
  subjectKind: SubjectKind | null;
  subjectRef: number | null;
  occurredAt: Date;
};

export function resetActivityJourneyLimiterForTesting(): void {
  serverBursts.clear();
  forceWriteFailure = false;
}

export function activityKey(parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return digest;
}

function isAllowed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function validInput(input: NewActivityEvent): boolean {
  return (
    Number.isSafeInteger(input.userId) &&
    input.userId > 0 &&
    isAllowed(input.platform, ACTIVITY_PLATFORMS) &&
    isAllowed(input.eventName, ACTIVITY_EVENTS) &&
    isAllowed(input.result ?? "none", ACTIVITY_RESULTS) &&
    (input.failureCategory == null || isAllowed(input.failureCategory, FAILURE_CATEGORIES)) &&
    (input.subjectKind == null || isAllowed(input.subjectKind, SUBJECT_KINDS)) &&
    (input.subjectRef == null ||
      (Number.isSafeInteger(input.subjectRef) && input.subjectRef > 0)) &&
    DEDUPE_KEY.test(input.dedupeKey) &&
    (input.occurredAt == null || !Number.isNaN(input.occurredAt.getTime()))
  );
}

function withinServerBurst(userId: number, occurredAt: Date): boolean {
  const current = serverBursts.get(userId);
  if (!current || occurredAt.getTime() - current.windowStartedAt >= 60_000) {
    serverBursts.set(userId, { windowStartedAt: occurredAt.getTime(), count: 1 });
    return true;
  }
  if (current.count >= SERVER_BURST_LIMIT) return false;
  current.count += 1;
  return true;
}

function isMissingActivityTable(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const candidate = current as { code?: unknown; sqlMessage?: unknown; cause?: unknown };
    if (
      candidate.code === "ER_NO_SUCH_TABLE" &&
      typeof candidate.sqlMessage === "string" &&
      candidate.sqlMessage.includes("activity_journey_events")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function toView(row: ActivityJourneyEvent): ActivityEventView | null {
  if (
    !isAllowed(row.platform, ACTIVITY_PLATFORMS) ||
    !isAllowed(row.eventName, ACTIVITY_EVENTS) ||
    !isAllowed(row.result, ACTIVITY_RESULTS)
  ) {
    return null;
  }
  return {
    userId: row.userId,
    platform: row.platform,
    eventName: row.eventName,
    result: row.result,
    failureCategory:
      row.failureCategory && isAllowed(row.failureCategory, FAILURE_CATEGORIES)
        ? row.failureCategory
        : null,
    subjectKind:
      row.subjectKind && isAllowed(row.subjectKind, SUBJECT_KINDS) ? row.subjectKind : null,
    subjectRef: row.subjectRef ?? null,
    occurredAt: row.occurredAt,
  };
}

export async function noteActivityEvent(input: NewActivityEvent): Promise<"recorded" | "duplicate" | "rejected" | "dropped"> {
  try {
    return await insertActivityEvent(input);
  } catch {
    return "dropped";
  }
}

async function insertActivityEvent(input: NewActivityEvent): Promise<"recorded" | "duplicate" | "rejected" | "dropped"> {
  if (forceWriteFailure) throw new Error("activity store unavailable");
  if (!validInput(input)) return "rejected";
  const occurredAt = input.occurredAt ?? now();
  if (!withinServerBurst(input.userId, occurredAt)) return "dropped";
  const row = {
    userId: input.userId,
    platform: input.platform,
    eventName: input.eventName,
    result: input.result ?? "none",
    failureCategory: input.failureCategory ?? null,
    subjectKind: input.subjectKind ?? null,
    subjectRef: input.subjectRef ?? null,
    dedupeKey: input.dedupeKey,
    occurredAt,
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const existing = memoryState.activityJourneyEvents.find(
      item => item.userId === row.userId && item.dedupeKey === row.dedupeKey
    );
    if (existing) return "duplicate";
    memoryState.activityJourneyEvents.push({
      id: nextMemoryId("activityJourneyEvent"),
      ...row,
    });
    await persistMemoryState();
    return "recorded";
  }
  try {
    const [result] = await db.insert(activityJourneyEvents).values(row);
    return Number(result.affectedRows) === 1 ? "recorded" : "duplicate";
  } catch (error) {
    if (isMissingActivityTable(error)) return "dropped";
    const candidate = error as { code?: unknown };
    if (candidate.code === "ER_DUP_ENTRY") return "duplicate";
    return "dropped";
  }
}

export async function listActivityEventsForUser(userId: number): Promise<ActivityEventView[]> {
  const db = await getDb();
  const rows = !db
    ? (await ensureMemoryLoaded(),
      memoryState.activityJourneyEvents.filter(item => item.userId === userId))
    : await db
        .select()
        .from(activityJourneyEvents)
        .where(eq(activityJourneyEvents.userId, userId));
  return rows
    .map(toView)
    .filter((item): item is ActivityEventView => item != null)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
}

export async function summarizeActivityEvents(since: Date): Promise<Array<{
  platform: ActivityPlatform;
  eventName: ActivityEventName;
  result: ActivityResult;
  count: number;
}>> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const counts = new Map<string, { platform: ActivityPlatform; eventName: ActivityEventName; result: ActivityResult; count: number }>();
    for (const row of memoryState.activityJourneyEvents) {
      const view = toView(row);
      if (!view || view.occurredAt < since) continue;
      const key = `${view.platform}\0${view.eventName}\0${view.result}`;
      const current = counts.get(key) ?? { ...view, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    return [...counts.values()];
  }
  const rows = await db
    .select({
      platform: activityJourneyEvents.platform,
      eventName: activityJourneyEvents.eventName,
      result: activityJourneyEvents.result,
      count: sql<number>`count(*)`,
    })
    .from(activityJourneyEvents)
    .where(gte(activityJourneyEvents.occurredAt, since))
    .groupBy(
      activityJourneyEvents.platform,
      activityJourneyEvents.eventName,
      activityJourneyEvents.result
    );
  return rows.flatMap(row => {
    if (
      !isAllowed(row.platform, ACTIVITY_PLATFORMS) ||
      !isAllowed(row.eventName, ACTIVITY_EVENTS) ||
      !isAllowed(row.result, ACTIVITY_RESULTS)
    ) {
      return [];
    }
    return [{ platform: row.platform, eventName: row.eventName, result: row.result, count: Number(row.count) }];
  });
}

/** 只删除超过保留期的阶段行。不读、不写作品和账本。 */
export async function pruneActivityEvents(olderThan: Date, limit = 500): Promise<number> {
  const bounded = Math.min(Math.max(1, limit), 1000);
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const doomed = memoryState.activityJourneyEvents
      .filter(item => item.occurredAt < olderThan)
      .slice(0, bounded)
      .map(item => item.id);
    if (doomed.length === 0) return 0;
    const remove = new Set(doomed);
    memoryState.activityJourneyEvents = memoryState.activityJourneyEvents.filter(
      item => !remove.has(item.id)
    );
    await persistMemoryState();
    return doomed.length;
  }
  const stale = await db
    .select({ id: activityJourneyEvents.id })
    .from(activityJourneyEvents)
    .where(lt(activityJourneyEvents.occurredAt, olderThan))
    .limit(bounded);
  if (stale.length === 0) return 0;
  await db.delete(activityJourneyEvents).where(
    and(
      lt(activityJourneyEvents.occurredAt, olderThan),
      inArray(activityJourneyEvents.id, stale.map(row => row.id))
    )
  );
  return stale.length;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function halfHourBucket(date: Date): string {
  return String(Math.floor(date.getTime() / 1_800_000));
}

export async function noteWebVisit(userId: number, visitId: string): Promise<void> {
  await noteActivityEvent({
    userId,
    platform: "web",
    eventName: "account.entered",
    dedupeKey: `enterweb${activityKey([String(userId), visitId])}`,
  });
}

export async function noteProviderAttemptJourney(input: {
  userId: number;
  operationId: string;
  operationType: string;
  billingOperationId: number;
  status: string;
}): Promise<void> {
  const journey = journeyFromProviderAttempt(input.status);
  if (!journey) return;
  const operationKey = activityKey([input.operationId]);
  await noteActivityEvent({
    userId: input.userId,
    platform: platformForOperationType(input.operationType),
    eventName: journey.eventName,
    result: journey.result,
    failureCategory: journey.failureCategory,
    subjectKind: subjectKindForOperationType(input.operationType),
    subjectRef: input.billingOperationId,
    dedupeKey:
      journey.eventName === "generation.submitted"
        ? `submit${operationKey}`
        : `resolve${journey.result}${operationKey}`,
  });
}

export async function noteStoredGeneration(input: {
  userId: number;
  kind: "image" | "video";
  subjectRef: number;
  platform?: ActivityPlatform;
}): Promise<void> {
  await noteActivityEvent({
    userId: input.userId,
    platform: input.platform ?? "web",
    eventName: "generation.resolved",
    result: "succeeded",
    subjectKind: input.kind,
    subjectRef: input.subjectRef,
    dedupeKey: `stored${input.kind}${activityKey([String(input.subjectRef)])}`,
  });
}

export async function noteImageTaskJourney(input: {
  userId: number;
  taskId: string;
  billingOperationId?: string | null;
  status: "submitted" | "failed" | "unknown";
}): Promise<void> {
  const identity = activityKey([input.billingOperationId || input.taskId]);
  if (input.status === "submitted") {
    await noteActivityEvent({
      userId: input.userId,
      platform: "web",
      eventName: "generation.submitted",
      subjectKind: "image",
      dedupeKey: `submit${identity}`,
    });
    return;
  }
  await noteActivityEvent({
    userId: input.userId,
    platform: "web",
    eventName: "generation.resolved",
    result: input.status === "failed" ? "failed" : "unknown",
    failureCategory: input.status === "failed" ? "unspecified" : "submission_unknown",
    subjectKind: "image",
    dedupeKey: `resolve${input.status === "failed" ? "failed" : "unknown"}${identity}`,
  });
}

export async function noteStoryBodySaved(userId: number, storyId: number, occurredAt = new Date()): Promise<void> {
  await noteActivityEvent({
    userId,
    platform: "web",
    eventName: "creation.edited",
    subjectKind: "story",
    subjectRef: storyId,
    occurredAt,
    dedupeKey: `editweb${activityKey([String(storyId), dayKey(occurredAt)])}`,
  });
}

export async function noteMiniprogramVisit(userId: number, occurredAt = new Date()): Promise<void> {
  await noteActivityEvent({
    userId,
    platform: "miniprogram",
    eventName: "account.entered",
    occurredAt,
    dedupeKey: `entermp${activityKey([String(userId), halfHourBucket(occurredAt)])}`,
  });
}

export async function noteMiniprogramStoryOpen(userId: number, storyId: number, occurredAt = new Date()): Promise<void> {
  await noteActivityEvent({
    userId,
    platform: "miniprogram",
    eventName: "creation.entered",
    subjectKind: "story",
    subjectRef: storyId,
    occurredAt,
    dedupeKey: `openmp${activityKey([String(userId), String(storyId), halfHourBucket(occurredAt)])}`,
  });
}

export async function noteMiniprogramReservation(input: {
  userId: number;
  operationId: string;
  operationType: string;
  billingOperationId?: number | null;
}): Promise<void> {
  await noteActivityEvent({
    userId: input.userId,
    platform: "miniprogram",
    eventName: "generation.submitted",
    subjectKind: subjectKindForOperationType(input.operationType),
    subjectRef: input.billingOperationId ?? null,
    dedupeKey: `submit${activityKey([input.operationId])}`,
  });
}

