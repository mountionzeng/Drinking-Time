/** Persistence operations for accessAnalytics. Local and MySQL behavior share this boundary. */
import { eq, and, isNotNull, sql } from "drizzle-orm";
import {
  users,
  User,
  accessSessions,
  AccessSession,
  generatedImages,
  videoTakes,
} from "../../drizzle/schema";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

const MAX_ACCESS_HEARTBEAT_GAP_SECONDS = 90;

export type AccessOverviewRow = {
  userId: number;
  name: string | null;
  email: string | null;
  role: User["role"];
  createdAt: Date;
  lastSignedIn: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hasAccessHistory: boolean;
  visitCount: number;
  durationSeconds: number;
  imageGenerations: number;
  videoGenerations: number;
  videoSeconds: number;
  recentSessions: Array<{
    startedAt: Date;
    lastSeenAt: Date;
    durationSeconds: number;
  }>;
};

function isMissingVideoTakesTable(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const candidate = current as {
      code?: unknown;
      sqlMessage?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "ER_NO_SUCH_TABLE" &&
      typeof candidate.sqlMessage === "string" &&
      candidate.sqlMessage.includes("video_takes")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function recordAccessHeartbeat(input: {
  userId: number;
  visitId: string;
  siteHost: string;
  occurredAt?: Date;
}): Promise<AccessSession> {
  const occurredAt = input.occurredAt ?? now();
  const db = await getDb();

  if (!db) {
    await ensureMemoryLoaded();
    const existing = memoryState.accessSessions.find(
      session =>
        session.userId === input.userId &&
        session.visitId === input.visitId &&
        session.siteHost === input.siteHost
    );
    if (existing) {
      const elapsedSeconds = Math.max(
        0,
        Math.floor(
          (occurredAt.getTime() - existing.lastSeenAt.getTime()) / 1000
        )
      );
      existing.durationSeconds += Math.min(
        elapsedSeconds,
        MAX_ACCESS_HEARTBEAT_GAP_SECONDS
      );
      existing.lastSeenAt = occurredAt;
      await persistMemoryState();
      return existing;
    }

    const row: AccessSession = {
      id: nextMemoryId("accessSession"),
      userId: input.userId,
      visitId: input.visitId,
      siteHost: input.siteHost,
      startedAt: occurredAt,
      lastSeenAt: occurredAt,
      durationSeconds: 0,
    };
    memoryState.accessSessions.push(row);
    await persistMemoryState();
    return row;
  }

  const [existing] = await db
    .select()
    .from(accessSessions)
    .where(
      and(
        eq(accessSessions.userId, input.userId),
        eq(accessSessions.visitId, input.visitId),
        eq(accessSessions.siteHost, input.siteHost)
      )
    )
    .limit(1);

  if (!existing) {
    await db.insert(accessSessions).values({
      userId: input.userId,
      visitId: input.visitId,
      siteHost: input.siteHost,
      startedAt: occurredAt,
      lastSeenAt: occurredAt,
      durationSeconds: 0,
    });
  } else {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((occurredAt.getTime() - existing.lastSeenAt.getTime()) / 1000)
    );
    await db
      .update(accessSessions)
      .set({
        lastSeenAt: occurredAt,
        durationSeconds:
          existing.durationSeconds +
          Math.min(elapsedSeconds, MAX_ACCESS_HEARTBEAT_GAP_SECONDS),
      })
      .where(eq(accessSessions.id, existing.id));
  }

  const [saved] = await db
    .select()
    .from(accessSessions)
    .where(
      and(
        eq(accessSessions.userId, input.userId),
        eq(accessSessions.visitId, input.visitId),
        eq(accessSessions.siteHost, input.siteHost)
      )
    )
    .limit(1);
  if (!saved) {
    throw new Error("访问会话保存失败");
  }
  return saved;
}

export async function getAccessOverview(
  siteHost: string
): Promise<AccessOverviewRow[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
  }
  const sessions = !db
    ? memoryState.accessSessions.filter(
        session => session.siteHost === siteHost
      )
    : await db
        .select()
        .from(accessSessions)
        .where(eq(accessSessions.siteHost, siteHost));
  const allUsers = !db ? memoryState.users : await db.select().from(users);
  const imageUsage = !db
    ? Array.from(
        memoryState.generatedImages.reduce((counts, image) => {
          if (image.userId != null) {
            counts.set(image.userId, (counts.get(image.userId) ?? 0) + 1);
          }
          return counts;
        }, new Map<number, number>())
      ).map(([userId, count]) => ({ userId, count }))
    : await db
        .select({
          userId: generatedImages.userId,
          count: sql<number>`count(*)`,
        })
        .from(generatedImages)
        .where(isNotNull(generatedImages.userId))
        .groupBy(generatedImages.userId);
  let videoUsage: Array<{ userId: number; count: number; seconds: number }>;
  if (!db) {
    videoUsage = Array.from(
      memoryState.videoTakes.reduce((usage, video) => {
        if (video.status !== "available") return usage;
        const current = usage.get(video.userId) ?? { count: 0, seconds: 0 };
        current.count += 1;
        current.seconds += video.durationSec ?? 0;
        usage.set(video.userId, current);
        return usage;
      }, new Map<number, { count: number; seconds: number }>())
    ).map(([userId, value]) => ({ userId, ...value }));
  } else {
    try {
      videoUsage = await db
        .select({
          userId: videoTakes.userId,
          count: sql<number>`count(*)`,
          seconds: sql<number>`coalesce(sum(${videoTakes.durationSec}), 0)`,
        })
        .from(videoTakes)
        .where(eq(videoTakes.status, "available"))
        .groupBy(videoTakes.userId);
    } catch (error) {
      if (!isMissingVideoTakesTable(error)) throw error;
      console.warn(
        "[AccessAnalytics] video_takes table is not available; reporting zero video usage"
      );
      videoUsage = [];
    }
  }
  const emailUsers = allUsers.filter(user => Boolean(user.email));
  const usersById = new Map(emailUsers.map(user => [user.id, user]));
  const overview = new Map<number, AccessOverviewRow>();

  for (const user of emailUsers) {
    overview.set(user.id, {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      lastSignedIn: user.lastSignedIn,
      firstSeenAt: user.createdAt,
      lastSeenAt: user.lastSignedIn,
      hasAccessHistory: false,
      visitCount: 0,
      durationSeconds: 0,
      imageGenerations: 0,
      videoGenerations: 0,
      videoSeconds: 0,
      recentSessions: [],
    });
  }

  for (const session of sessions) {
    const user = usersById.get(session.userId);
    if (!user) continue;
    const current = overview.get(session.userId)!;
    if (!current.hasAccessHistory) {
      current.firstSeenAt = session.startedAt;
      current.lastSeenAt = session.lastSeenAt;
      current.hasAccessHistory = true;
    }
    current.firstSeenAt =
      session.startedAt < current.firstSeenAt
        ? session.startedAt
        : current.firstSeenAt;
    current.lastSeenAt =
      session.lastSeenAt > current.lastSeenAt
        ? session.lastSeenAt
        : current.lastSeenAt;
    current.visitCount += 1;
    current.durationSeconds += session.durationSeconds;
    current.recentSessions.push({
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      durationSeconds: session.durationSeconds,
    });
  }

  for (const image of imageUsage) {
    if (image.userId == null) continue;
    const current = overview.get(image.userId);
    if (current) current.imageGenerations = Number(image.count);
  }
  for (const video of videoUsage) {
    const current = overview.get(video.userId);
    if (!current) continue;
    current.videoGenerations = Number(video.count);
    current.videoSeconds = Number(video.seconds);
  }
  for (const current of Array.from(overview.values())) {
    current.recentSessions = current.recentSessions
      .sort(
        (left, right) => right.startedAt.getTime() - left.startedAt.getTime()
      )
      .slice(0, 3);
  }

  return Array.from(overview.values()).sort(
    (left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
  );
}
