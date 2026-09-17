/** Persistence operations for emotionLetters. Local and MySQL behavior share this boundary. */
import { eq, and, desc } from "drizzle-orm";
import {
  InsertEmotionAnalysisProfile,
  emotionAnalysisProfiles,
  EmotionAnalysisProfile,
  InsertEmotionDailyLetter,
  emotionDailyLetters,
  EmotionDailyLetter,
} from "../../drizzle/schema";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

// ─── Emotion Analysis Profile ────────────────────────────────────────────

export async function getEmotionAnalysisProfile(
  userId: number
): Promise<EmotionAnalysisProfile | null> {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.emotionAnalysisProfiles
      .filter(item => item.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return rows[0] ?? null;
  }
  const result = await db
    .select()
    .from(emotionAnalysisProfiles)
    .where(eq(emotionAnalysisProfiles.userId, userId))
    .orderBy(desc(emotionAnalysisProfiles.updatedAt))
    .limit(1);
  return result[0] ?? null;
}

export async function upsertEmotionAnalysisProfile(
  data: InsertEmotionAnalysisProfile
): Promise<EmotionAnalysisProfile> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.emotionAnalysisProfiles
      .filter(item => item.userId === data.userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }

    const row: EmotionAnalysisProfile = {
      id: nextMemoryId("emotionAnalysisProfile"),
      userId: data.userId,
      projectId: data.projectId ?? null,
      birthDate: data.birthDate,
      consentVersion: data.consentVersion,
      consentText: data.consentText ?? null,
      dailyReference: data.dailyReference ?? null,
      analysisSeed: data.analysisSeed ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.emotionAnalysisProfiles.push(row);
    await persistMemoryState();
    return row;
  }

  const existing = await getEmotionAnalysisProfile(data.userId);
  if (existing) {
    await db
      .update(emotionAnalysisProfiles)
      .set(data)
      .where(
        and(
          eq(emotionAnalysisProfiles.id, existing.id),
          eq(emotionAnalysisProfiles.userId, data.userId)
        )
      );
    return (await getEmotionAnalysisProfile(data.userId))!;
  }

  const result = await db.insert(emotionAnalysisProfiles).values(data);
  const inserted = await db
    .select()
    .from(emotionAnalysisProfiles)
    .where(eq(emotionAnalysisProfiles.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

// ─── Emotion Daily Letters ─────────────────────────────────────────────

export async function getEmotionDailyLetter(
  userId: number,
  letterDate: string
): Promise<EmotionDailyLetter | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.emotionDailyLetters.find(
        item => item.userId === userId && item.letterDate === letterDate
      ) ?? null
    );
  }
  const [row] = await db
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

export async function listEmotionDailyLetters(
  userId: number,
  limit = 90
): Promise<EmotionDailyLetter[]> {
  const safeLimit = Math.max(1, Math.min(365, Math.floor(limit)));
  const db = await getDb();
  if (!db) {
    return memoryState.emotionDailyLetters
      .filter(item => item.userId === userId)
      .sort((a, b) => b.letterDate.localeCompare(a.letterDate))
      .slice(0, safeLimit);
  }
  return db
    .select()
    .from(emotionDailyLetters)
    .where(eq(emotionDailyLetters.userId, userId))
    .orderBy(desc(emotionDailyLetters.letterDate))
    .limit(safeLimit);
}

export async function ensureEmotionDailyLetter(
  data: InsertEmotionDailyLetter
): Promise<EmotionDailyLetter> {
  const existing = await getEmotionDailyLetter(data.userId, data.letterDate);
  if (existing) return existing;

  const db = await getDb();
  if (!db) {
    return upsertEmotionDailyLetter(data);
  }
  await db
    .insert(emotionDailyLetters)
    .values(data)
    .onDuplicateKeyUpdate({
      set: { letterDate: data.letterDate },
    });
  return (await getEmotionDailyLetter(data.userId, data.letterDate))!;
}

export async function upsertEmotionDailyLetter(
  data: InsertEmotionDailyLetter
): Promise<EmotionDailyLetter> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.emotionDailyLetters.find(
      item => item.userId === data.userId && item.letterDate === data.letterDate
    );
    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }

    const row: EmotionDailyLetter = {
      id: nextMemoryId("emotionDailyLetter"),
      userId: data.userId,
      letterDate: data.letterDate,
      userMessage: data.userMessage ?? null,
      userMessageSaidAt: data.userMessageSaidAt ?? null,
      userMessageEditedAt: data.userMessageEditedAt ?? null,
      dailyReference: data.dailyReference,
      analysisSeed: data.analysisSeed,
      revision: data.revision ?? 1,
      currentVersionId: data.currentVersionId ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.emotionDailyLetters.push(row);
    await persistMemoryState();
    return row;
  }

  await db
    .insert(emotionDailyLetters)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        userMessage: data.userMessage ?? null,
        userMessageSaidAt: data.userMessageSaidAt ?? null,
        userMessageEditedAt: data.userMessageEditedAt ?? null,
        dailyReference: data.dailyReference,
        analysisSeed: data.analysisSeed,
        revision: data.revision ?? 1,
        updatedAt: new Date(),
      },
    });
  return (await getEmotionDailyLetter(data.userId, data.letterDate))!;
}

export async function updateEmotionDailyLetterIfRevision(
  data: InsertEmotionDailyLetter,
  expectedRevision: number
): Promise<EmotionDailyLetter | null> {
  const db = await getDb();
  if (!db) {
    const existing = memoryState.emotionDailyLetters.find(
      item => item.userId === data.userId && item.letterDate === data.letterDate
    );
    if (!existing || existing.revision !== expectedRevision) return null;
    applyDefinedValues(
      existing as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    existing.revision = expectedRevision + 1;
    existing.updatedAt = now();
    await persistMemoryState();
    return existing;
  }

  const result = await db
    .update(emotionDailyLetters)
    .set({
      userMessage: data.userMessage ?? null,
      userMessageSaidAt: data.userMessageSaidAt ?? null,
      userMessageEditedAt: data.userMessageEditedAt ?? null,
      dailyReference: data.dailyReference,
      analysisSeed: data.analysisSeed,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emotionDailyLetters.userId, data.userId),
        eq(emotionDailyLetters.letterDate, data.letterDate),
        eq(emotionDailyLetters.revision, expectedRevision)
      )
    );
  if (result[0].affectedRows !== 1) return null;
  return getEmotionDailyLetter(data.userId, data.letterDate);
}
