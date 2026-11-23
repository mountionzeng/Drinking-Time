import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { activityJourneyEvents as events, adminUserLabels, generatedImages, videoTakes } from "../../drizzle/schema";
import {
  ACTIVITY_DAY_MS, ACTIVITY_MAX_DAYS, ACTIVITY_VERSION, activityBounds,
  activityBeijingDate, activityBeijingTime, type ActivitySignal, type ActivityWindow,
} from "../../shared/activityJourney";
import { activityJourneyEnabled, activityKey, activityWebVisit } from "../services/activityJourneyContext";
import { aggregateActivity } from "../services/activityJourneyReport";
import { getDb } from "./runtime";
import { consumePersistentRateLimit } from "./accounts";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Event = typeof events.$inferInsert;
type Kind = NonNullable<Event["subjectKind"]>;
type Outcome = Exclude<Event["result"], "none">;
const MAX_REPORT_EVENTS = 25_000;
const WRITE_DEADLINE_MS = 150;
const MAX_ACTIVE_WRITES = 4;
let activeWrites = 0;

async function observe(write: (db: Db) => Promise<void>) {
  if (!activityJourneyEnabled() || activeWrites >= MAX_ACTIVE_WRITES) return;
  activeWrites++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const db = await getDb();
    if (db) await write(db);
  })().catch(() => {
    // Never log payloads or database errors from this path.
    console.warn("[activity-journey] event write unavailable");
  }).finally(() => { activeWrites--; });
  await Promise.race([work, new Promise<void>(resolve => {
    timer = setTimeout(resolve, WRITE_DEADLINE_MS);
  })]);
  clearTimeout(timer);
}

async function insert(db: Db, rows: Event[]) {
  await db.insert(events).values(rows).onDuplicateKeyUpdate({ set: { dedupeKey: sql`${events.dedupeKey}` } });
}

function evidence(userId: number, kind: Kind, taskId: number | string) {
  return activityKey("task", userId, kind, taskId);
}

export async function recordGenerationSubmitted(userId: number, kind: Kind, taskId: number | string) {
  const visit = activityWebVisit.getStore();
  if (visit?.userId !== userId) return;
  const attemptKey = evidence(userId, kind, taskId);
  await observe(db => insert(db, [{
    userId, schemaVersion: ACTIVITY_VERSION, platform: "web", eventName: "generation.submitted",
    result: "none", subjectKind: kind, visitKey: visit.visitKey, attemptKey,
    dedupeKey: activityKey("generation.submitted", attemptKey), occurredAtMs: Date.now(),
  }]));
}

export async function recordGenerationResolved(
  userId: number, kind: Kind, taskId: number | string,
  result: Outcome, resultIds: number[] = [],
) {
  if (result === "succeeded" && !resultIds.length) return;
  const occurredAtMs = Date.now();
  await observe(async db => {
    const attemptKey = evidence(userId, kind, taskId);
    const [submitted] = await db.select({ visitKey: events.visitKey, occurredAtMs: events.occurredAtMs })
      .from(events).where(eq(events.dedupeKey, activityKey("generation.submitted", attemptKey))).limit(1);
    if (!submitted) return;
    await insert(db, (result === "succeeded" ? resultIds : [null]).map(subjectRef => ({
      userId, schemaVersion: ACTIVITY_VERSION, platform: "web", eventName: "generation.resolved",
      result, subjectKind: kind, subjectRef, visitKey: submitted.visitKey, attemptKey,
      dedupeKey: activityKey("generation.resolved", attemptKey, result, subjectRef ?? 0),
      occurredAtMs: Math.max(occurredAtMs, submitted.occurredAtMs),
    })));
  });
}

export async function recordActivitySignal(userId: number, input: ActivitySignal) {
  const visit = activityWebVisit.getStore();
  if (visit?.userId !== userId) return;
  const occurredAtMs = Date.now();
  await observe(async db => {
    const rate = await consumePersistentRateLimit({
      scope: "activity-journey", subject: String(userId), windowSeconds: 60, maxAttempts: 30,
    });
    if (!rate.allowed) return;
    const base = { userId, schemaVersion: ACTIVITY_VERSION, platform: "web", result: "none", occurredAtMs } as const;
    if (input.eventName === "creation.entered") {
      await insert(db, [{
        ...base, eventName: input.eventName, visitKey: visit.visitKey,
        dedupeKey: activityKey(input.eventName, visit.visitKey),
      }]);
      return;
    }

    const { subjectKind, subjectRef } = input;
    const [stored] = await db.select({ attemptKey: events.attemptKey, occurredAtMs: events.occurredAtMs })
      .from(events).where(and(
        eq(events.userId, userId), eq(events.subjectKind, subjectKind), eq(events.subjectRef, subjectRef),
        eq(events.eventName, "generation.resolved"), eq(events.result, "succeeded"),
        eq(events.platform, "web"), eq(events.schemaVersion, ACTIVITY_VERSION),
      )).limit(1);
    if (!stored?.attemptKey) return;
    const [visible] = subjectKind === "image"
      ? await db.select({ id: generatedImages.id }).from(generatedImages).where(and(
          eq(generatedImages.id, subjectRef), eq(generatedImages.userId, userId),
          sql`length(${generatedImages.imageUrl}) > 0`,
        )).limit(1)
      : await db.select({ id: videoTakes.id }).from(videoTakes).where(and(
          eq(videoTakes.id, subjectRef), eq(videoTakes.userId, userId), eq(videoTakes.status, "available"),
          sql`length(${videoTakes.videoKey}) > 0 and length(${videoTakes.videoUrl}) > 0`,
        )).limit(1);
    if (!visible) return;
    await insert(db, [{
      ...base, eventName: input.eventName, subjectKind, subjectRef, attemptKey: stored.attemptKey,
      visitKey: visit.visitKey, occurredAtMs: Math.max(occurredAtMs, stored.occurredAtMs),
      dedupeKey: activityKey(input.eventName, stored.attemptKey, subjectKind, subjectRef),
    }]);
  });
}

export async function readActivityReport(input: ActivityWindow, now = Date.now()) {
  const { start, end } = activityBounds(input.from, input.through);
  if (input.through > activityBeijingDate(now) || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请选择已经开始的北京时间窗口" });
  }
  const observedThrough = Math.min(now, end + ACTIVITY_MAX_DAYS * ACTIVITY_DAY_MS - 1);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "创作漏斗数据源不可用" });
  const category = sql<import("../../shared/adminUsers").AdminUserCategory>`COALESCE(${adminUserLabels.category}, 'unclassified')`;
  const [rows, [first]] = await Promise.all([
    db.select({
      userId: events.userId, occurredAtMs: events.occurredAtMs, platform: events.platform,
      eventName: events.eventName, result: events.result, subjectKind: events.subjectKind,
      subjectRef: events.subjectRef, visitKey: events.visitKey, attemptKey: events.attemptKey,
      category,
    }).from(events).leftJoin(adminUserLabels, eq(events.userId, adminUserLabels.userId)).where(and(
      eq(events.schemaVersion, ACTIVITY_VERSION),
      gte(events.occurredAtMs, start), lte(events.occurredAtMs, observedThrough),
      // Avoid scanning entry-only traffic after the cohort window.
      sql`(${events.eventName} <> 'creation.entered' OR ${lt(events.occurredAtMs, end)})`,
      input.platform ? eq(events.platform, input.platform) : undefined,
      input.category ? eq(category, input.category) : undefined,
    )).limit(MAX_REPORT_EVENTS + 1),
    db.select({ at: events.occurredAtMs }).from(events).where(eq(events.schemaVersion, ACTIVITY_VERSION))
      .orderBy(events.occurredAtMs).limit(1),
  ]);
  if (rows.length > MAX_REPORT_EVENTS) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "窗口内事件超过 25,000 条，请缩小日期或筛选范围" });
  }
  return {
    schemaVersion: ACTIVITY_VERSION,
    from: input.from, through: input.through,
    enabled: activityJourneyEnabled(),
    observedThrough: activityBeijingTime(observedThrough),
    firstRecordedAt: first ? activityBeijingTime(first.at) : null,
    rows: aggregateActivity(rows, start, end, input),
  };
}

export async function recordVideoAvailability(take: Pick<typeof videoTakes.$inferSelect,
  "id" | "userId" | "status" | "videoKey" | "videoUrl"> | null) {
  if (take?.status !== "available") return;
  if (take.videoKey?.trim() && take.videoUrl?.trim()) {
    await recordGenerationResolved(take.userId, "video", take.id, "succeeded", [take.id]);
  } else {
    await recordGenerationResolved(take.userId, "video", take.id, "unknown");
  }
}
