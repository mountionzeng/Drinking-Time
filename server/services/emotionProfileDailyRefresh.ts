import type { EmotionAnalysisProfile } from "../../drizzle/schema";
import {
  getEmotionAnalysisProfile,
  getEmotionDailyLetter,
  listEmotionDailyLetters,
  upsertEmotionAnalysisProfile,
} from "../db";
import { getAlmanacDay } from "./almanac";
import {
  EMOTION_DAILY_LETTER_VERSION,
  chinaDateString,
  personalizeEmotionDailyReference302,
} from "./emotionDailyReference302";
import { calculateBirthPillarsLabel } from "../../shared/bazi";
import { ENV } from "../_core/env";
import {
  buildPriorMessageHistory,
  ensureDailyLetterFromProfile,
  saveDailyLetterFromProfile,
} from "./emotionDailyLetters";

type PayloadRecord = Record<string, unknown>;

interface RefreshDependencies {
  getProfile?: typeof getEmotionAnalysisProfile;
  saveProfile?: typeof upsertEmotionAnalysisProfile;
  getAlmanac?: typeof getAlmanacDay;
  personalize?: typeof personalizeEmotionDailyReference302;
  ensureArchive?: typeof ensureDailyLetterFromProfile;
  saveArchive?: typeof saveDailyLetterFromProfile;
  getArchive?: typeof getEmotionDailyLetter;
  listArchive?: typeof listEmotionDailyLetters;
  now?: Date;
  preferAi?: boolean;
}

function payloadRecord(value: unknown): PayloadRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PayloadRecord)
    : null;
}

function currentLunarLabel(
  almanac: Awaited<ReturnType<typeof getAlmanacDay>>,
  fallback: unknown
) {
  const lunarDate = almanac.meta.lunarDate?.trim();
  if (lunarDate) return lunarDate;
  return typeof fallback === "string" ? fallback : "";
}

function enrichAnalysisSeed(seed: PayloadRecord, birthDate: string) {
  const existingBazi =
    typeof seed.birthBazi === "string" ? seed.birthBazi.trim() : "";
  const birthTime =
    typeof seed.birthTime === "string" ? seed.birthTime.trim() : "";
  if (existingBazi && (!birthTime || existingBazi.includes("时"))) return seed;
  const birthBazi = calculateBirthPillarsLabel(birthDate, birthTime);
  return birthBazi ? { ...seed, birthBazi } : seed;
}

function isFreshDailyReference(
  reference: PayloadRecord | null,
  today: string,
  preferAi: boolean
) {
  return Boolean(
    reference?.todayDate === today &&
      reference.letterVersion === EMOTION_DAILY_LETTER_VERSION &&
      (!preferAi || reference.interpretationSource === "302-deepseek")
  );
}

export async function getFreshEmotionAnalysisProfile(
  userId: number,
  dependencies: RefreshDependencies = {}
): Promise<EmotionAnalysisProfile | null> {
  const getProfile = dependencies.getProfile ?? getEmotionAnalysisProfile;
  const saveProfile = dependencies.saveProfile ?? upsertEmotionAnalysisProfile;
  const getAlmanac = dependencies.getAlmanac ?? getAlmanacDay;
  const personalize =
    dependencies.personalize ?? personalizeEmotionDailyReference302;
  const ensureArchive =
    dependencies.ensureArchive ?? ensureDailyLetterFromProfile;
  const saveArchive = dependencies.saveArchive ?? saveDailyLetterFromProfile;
  const getArchive = dependencies.getArchive ?? getEmotionDailyLetter;
  const listArchive = dependencies.listArchive ?? listEmotionDailyLetters;
  const profile = await getProfile(userId);
  if (!profile) return null;

  const dailyReference = payloadRecord(profile.dailyReference);
  const storedAnalysisSeed = payloadRecord(profile.analysisSeed);
  if (!dailyReference || !storedAnalysisSeed) return profile;
  const analysisSeed = enrichAnalysisSeed(
    storedAnalysisSeed,
    profile.birthDate
  );
  const needsBaziEnrichment = analysisSeed !== storedAnalysisSeed;
  const preferAi =
    dependencies.preferAi ??
    Boolean(ENV.api302Key.trim() && ENV.emotion302Model.trim());

  const today = chinaDateString(dependencies.now);
  await ensureArchive(profile);

  const archivedToday = await getArchive(userId, today);
  const archivedReference = payloadRecord(archivedToday?.dailyReference);
  const archivedSeed = payloadRecord(archivedToday?.analysisSeed);
  if (
    archivedToday &&
    isFreshDailyReference(archivedReference, today, preferAi) &&
    archivedSeed
  ) {
    const restoredSeed = enrichAnalysisSeed(archivedSeed, profile.birthDate);
    const alreadyInSync =
      dailyReference.todayDate === today &&
      JSON.stringify(dailyReference) === JSON.stringify(archivedReference) &&
      JSON.stringify(storedAnalysisSeed) === JSON.stringify(restoredSeed);
    if (alreadyInSync) return profile;
    return saveProfile({
      userId: profile.userId,
      projectId: profile.projectId,
      birthDate: profile.birthDate,
      consentVersion: profile.consentVersion,
      consentText: profile.consentText,
      dailyReference: archivedReference,
      analysisSeed: restoredSeed,
    });
  }

  if (
    isFreshDailyReference(dailyReference, today, preferAi) &&
    !needsBaziEnrichment
  ) {
    return profile;
  }

  const isNewDay = dailyReference.todayDate !== today;
  const priorHistory = buildPriorMessageHistory({
    seed: analysisSeed,
    letters: await listArchive(userId, 365),
    beforeDate: today,
  });
  const todayAnalysisSeed = isNewDay
    ? {
        ...analysisSeed,
        userMessage: "",
        conversationMode: "today",
        messageHistory: priorHistory,
      }
    : {
        ...analysisSeed,
        messageHistory: priorHistory,
      };
  const almanac = await getAlmanac(today);
  const baseDailyReference = {
    ...dailyReference,
    todayDate: today,
    lunarLabel: currentLunarLabel(almanac, dailyReference.lunarLabel),
  };
  const refreshed = await personalize({
    date: today,
    almanac,
    baseDailyReference,
    analysisSeed: todayAnalysisSeed,
    generationIntent: "daily-letter",
  });

  const saved = await saveProfile({
    userId: profile.userId,
    projectId: profile.projectId,
    birthDate: profile.birthDate,
    consentVersion: profile.consentVersion,
    consentText: profile.consentText,
    dailyReference: refreshed.dailyReference,
    analysisSeed: todayAnalysisSeed,
  });
  await saveArchive(saved);
  return saved;
}
