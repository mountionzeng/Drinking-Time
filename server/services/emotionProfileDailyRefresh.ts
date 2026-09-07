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
  generateDailyLetterViaAttempt,
} from "./emotionDailyLetters";

type PayloadRecord = Record<string, unknown>;

interface RefreshDependencies {
  getProfile?: typeof getEmotionAnalysisProfile;
  saveProfile?: typeof upsertEmotionAnalysisProfile;
  getAlmanac?: typeof getAlmanacDay;
  personalize?: typeof personalizeEmotionDailyReference302;
  generateLetter?: typeof generateDailyLetterViaAttempt;
  ensureArchive?: typeof ensureDailyLetterFromProfile;
  /** @deprecated U6 的新版本由 generateLetter attempt 原子提交；仅保留测试兼容。 */
  saveArchive?: (profile: EmotionAnalysisProfile) => Promise<unknown>;
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
      (!preferAi ||
        reference.interpretationSource === "302-deepseek" ||
        reference.interpretationSource === "openai-next")
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
  const generateLetter =
    dependencies.generateLetter ??
    (input =>
      generateDailyLetterViaAttempt(input, {
        getAlmanac,
        personalize,
      }));
  const ensureArchive =
    dependencies.ensureArchive ?? ensureDailyLetterFromProfile;
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
    Boolean(
      (ENV.openaiNextApiKey.trim() && ENV.openaiNextEmotionModel.trim()) ||
        (ENV.api302Key.trim() && ENV.emotion302Model.trim())
    );

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
    personalizedYi: [],
    personalizedJi: [],
  };
  const generated = await generateLetter({
    userId,
    letterDate: today,
    actionId: `profile-ensure:${today}`,
    trigger: "generated",
    generationIntent: "daily-letter",
    baseDailyReference,
    analysisSeed: todayAnalysisSeed,
    userMessage: null,
    userMessageSaidAt: null,
    userMessageEditedAt: null,
    profileRevision: profile.updatedAt.toISOString(),
  });
  if (generated.status === "in_flight" || generated.status === "failed") {
    // 另一标签页仍在生成，或这次外部调用失败：保留当前画像和上一封信，
    // 不能拿半成品覆盖 profile。下一次读取会用同一 action ID 安全续跑。
    return profile;
  }

  const generatedReference = payloadRecord(generated.letter.dailyReference);
  const generatedSeed = payloadRecord(generated.letter.analysisSeed);
  if (!generatedReference || !generatedSeed) return profile;

  const saved = await saveProfile({
    userId: profile.userId,
    projectId: profile.projectId,
    birthDate: profile.birthDate,
    consentVersion: profile.consentVersion,
    consentText: profile.consentText,
    dailyReference: generatedReference,
    analysisSeed: generatedSeed,
  });
  return saved;
}
