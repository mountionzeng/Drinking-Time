import type {
  EmotionAnalysisProfile,
  EmotionDailyLetter,
} from "../../drizzle/schema";
import {
  appendEmotionDailyLetterVersion,
  getEmotionAnalysisProfile,
  getEmotionDailyLetter,
  listEmotionDailyLetters,
  upsertEmotionAnalysisProfile,
} from "../db";
import type { PersonalMemoryLetterPayload } from "../../shared/personalMemory";
import { dailyLetterMessageCaptureIfEnabled } from "./personalMemoryEvents";
import { getAlmanacDay } from "./almanac";
import {
  chinaDateString,
  personalizeEmotionDailyReference302,
} from "./emotionDailyReference302";

type PayloadRecord = Record<string, unknown>;

interface DailyLetterDependencies {
  getLetter?: typeof getEmotionDailyLetter;
  listLetters?: typeof listEmotionDailyLetters;
  getProfile?: typeof getEmotionAnalysisProfile;
  getAlmanac?: typeof getAlmanacDay;
  personalize?: typeof personalizeEmotionDailyReference302;
  writeLetter?: typeof appendEmotionDailyLetterVersion;
  saveProfile?: typeof upsertEmotionAnalysisProfile;
  now?: Date;
}

/**
 * U1 起来信正文只有一个写入口：不可变版本。
 *
 * 这个门面把 legacy 的三条写路径（ensure／save／rewrite）统一收进
 * `appendEmotionDailyLetterVersion`，日期级 `emotion_daily_letters` 降级为
 * 「当前版本指针 + 可由版本重建的兼容投影」。
 *
 * **不要**把任何一条 legacy writer 放回去直接改日期级正文——包括回滚构建。
 * 一旦放回去，双写和历史漂移当天就会重新出现，而这正是 U1 要一次性关掉的口子。
 */
function letterPayloadFrom(data: {
  userMessage: string | null;
  dailyReference: unknown;
  analysisSeed: unknown;
}): PersonalMemoryLetterPayload {
  return {
    dailyReference: data.dailyReference,
    analysisSeed: data.analysisSeed,
    userMessage: data.userMessage,
    // 八字修订、黄历事实与所选证据由 U6 的生成链路填充；
    // U1 只负责把既有内容搬进版本权威，不伪造它没有的东西。
    profileRevision: null,
    almanac: null,
    selectedEvidence: [],
  };
}

const LETTER_WRITER_VERSIONS = {
  selectorVersion: "u1-legacy",
  promptVersion: "u1-legacy",
  modelVersion: "u1-legacy",
} as const;

export class EmotionDailyLetterNotFoundError extends Error {
  constructor() {
    super("这一天的回信还没有生成");
    this.name = "EmotionDailyLetterNotFoundError";
  }
}

export class EmotionDailyLetterConflictError extends Error {
  constructor() {
    super("这封信刚刚在别处改过，请刷新后再写一次");
    this.name = "EmotionDailyLetterConflictError";
  }
}

function payloadRecord(value: unknown): PayloadRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as PayloadRecord) }
    : {};
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cleanMessage(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 800);
}

function messageHistory(seed: PayloadRecord) {
  return Array.isArray(seed.messageHistory)
    ? seed.messageHistory
        .filter(
          (item): item is PayloadRecord =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
        .map(item => ({ ...item }))
    : [];
}

function messageDate(item: PayloadRecord) {
  if (
    typeof item.dailyLetterDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.dailyLetterDate)
  ) {
    return item.dailyLetterDate;
  }
  if (typeof item.saidAt !== "string") return "";
  const parsed = dateValue(item.saidAt);
  return parsed ? chinaDateString(parsed) : "";
}

export function buildPriorMessageHistory({
  seed,
  letters,
  beforeDate,
}: {
  seed: PayloadRecord;
  letters: EmotionDailyLetter[];
  beforeDate: string;
}) {
  const byKey = new Map<string, PayloadRecord>();

  for (const item of messageHistory(seed)) {
    const text = typeof item.text === "string" ? cleanMessage(item.text) : "";
    if (!text) continue;
    const date = messageDate(item);
    if (date && date >= beforeDate) continue;
    const key =
      date ||
      (typeof item.id === "string" && item.id) ||
      (typeof item.saidAt === "string" && item.saidAt) ||
      text;
    byKey.set(key, {
      ...item,
      ...(date ? { dailyLetterDate: date } : {}),
      text,
    });
  }

  for (const letter of letters) {
    const text = cleanMessage(letter.userMessage ?? "");
    if (!text || letter.letterDate >= beforeDate) continue;
    byKey.set(letter.letterDate, {
      id: `daily-${letter.letterDate}`,
      dailyLetterDate: letter.letterDate,
      text,
      saidAt:
        letter.userMessageSaidAt?.toISOString() ??
        letter.createdAt.toISOString(),
      ...(letter.userMessageEditedAt
        ? { editedAt: letter.userMessageEditedAt.toISOString() }
        : {}),
    });
  }

  return Array.from(byKey.values())
    .sort((left, right) => {
      const leftDate = messageDate(left);
      const rightDate = messageDate(right);
      return leftDate.localeCompare(rightDate);
    })
    .slice(-12);
}

function findMessageRecord(seed: PayloadRecord, date: string, text: string) {
  const history = messageHistory(seed);
  return (
    [...history]
      .reverse()
      .find(
        item =>
          item.dailyLetterDate === date ||
          item.id === `daily-${date}` ||
          (text && item.text === text)
      ) ?? null
  );
}

function nextMessageHistory({
  seed,
  date,
  message,
  saidAt,
  editedAt,
}: {
  seed: PayloadRecord;
  date: string;
  message: string;
  saidAt: Date | null;
  editedAt: Date | null;
}) {
  const history = messageHistory(seed);
  let existingIndex = history.findIndex(
    item => item.dailyLetterDate === date || item.id === `daily-${date}`
  );
  if (existingIndex < 0 && message) {
    existingIndex = history.findLastIndex(item => item.text === message);
  }
  if (!message) {
    return history.filter((_, index) => index !== existingIndex).slice(-30);
  }

  const entry = {
    ...(existingIndex >= 0 ? history[existingIndex] : {}),
    id: `daily-${date}`,
    dailyLetterDate: date,
    text: message,
    saidAt: (saidAt ?? new Date()).toISOString(),
    ...(editedAt ? { editedAt: editedAt.toISOString() } : {}),
  };
  if (existingIndex >= 0) {
    history[existingIndex] = entry;
    return history.slice(-30);
  }
  return [...history, entry].slice(-30);
}

export function dailyLetterDataFromProfile(profile: EmotionAnalysisProfile) {
  const dailyReference = payloadRecord(profile.dailyReference);
  const analysisSeed = payloadRecord(profile.analysisSeed);
  const letterDate =
    typeof dailyReference.todayDate === "string"
      ? dailyReference.todayDate
      : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(letterDate)) return null;

  const userMessage =
    typeof analysisSeed.userMessage === "string"
      ? cleanMessage(analysisSeed.userMessage)
      : "";
  const message = findMessageRecord(analysisSeed, letterDate, userMessage);
  const saidAt =
    dateValue(message?.saidAt) ?? (userMessage ? profile.updatedAt : null);
  const editedAt = dateValue(message?.editedAt);
  const archivedHistory = nextMessageHistory({
    seed: analysisSeed,
    date: letterDate,
    message: userMessage,
    saidAt,
    editedAt,
  });

  return {
    userId: profile.userId,
    letterDate,
    userMessage: userMessage || null,
    userMessageSaidAt: saidAt,
    userMessageEditedAt: editedAt,
    dailyReference,
    analysisSeed: {
      ...analysisSeed,
      ...(archivedHistory.length ? { messageHistory: archivedHistory } : {}),
    },
    revision: 1,
  };
}

export async function ensureDailyLetterFromProfile(
  profile: EmotionAnalysisProfile,
  writeLetter = appendEmotionDailyLetterVersion
) {
  const data = dailyLetterDataFromProfile(profile);
  if (!data) return null;
  const existing = await getEmotionDailyLetter(profile.userId, data.letterDate);
  if (existing) return existing;
  // 稳定 action ID：并发标签页同时首次打开只会确认同一个 version 1。
  const written = await writeLetter({
    userId: data.userId,
    letterDate: data.letterDate,
    actionId: `profile-ensure:${data.letterDate}`,
    trigger: "generated",
    ...LETTER_WRITER_VERSIONS,
    privacyEpoch: 1,
    payload: letterPayloadFrom(data),
    userMessageSaidAt: data.userMessageSaidAt,
    userMessageEditedAt: data.userMessageEditedAt,
  });
  return written?.letter ?? null;
}

export async function saveDailyLetterFromProfile(
  profile: EmotionAnalysisProfile,
  writeLetter = appendEmotionDailyLetterVersion
) {
  const data = dailyLetterDataFromProfile(profile);
  if (!data) return null;
  const existing = await getEmotionDailyLetter(profile.userId, data.letterDate);
  const nextRevision = existing ? existing.revision + 1 : 1;
  // action ID 绑定目标版本号：两个并发调用算出同一个目标时只落一版，
  // 而不是像过去那样各自盲写覆盖。
  const written = await writeLetter({
    userId: data.userId,
    letterDate: data.letterDate,
    actionId: `profile-save:${data.letterDate}:${nextRevision}`,
    trigger: "generated",
    ...LETTER_WRITER_VERSIONS,
    privacyEpoch: 1,
    payload: letterPayloadFrom(data),
    userMessageSaidAt: data.userMessageSaidAt,
    userMessageEditedAt: data.userMessageEditedAt,
  });
  return written?.letter ?? null;
}

export async function rewriteEmotionDailyLetter(
  {
    userId,
    letterDate,
    userMessage,
    expectedRevision,
  }: {
    userId: number;
    letterDate: string;
    userMessage: string;
    expectedRevision: number;
  },
  dependencies: DailyLetterDependencies = {}
): Promise<EmotionDailyLetter> {
  const getLetter = dependencies.getLetter ?? getEmotionDailyLetter;
  const listLetters = dependencies.listLetters ?? listEmotionDailyLetters;
  const getProfile = dependencies.getProfile ?? getEmotionAnalysisProfile;
  const getAlmanac = dependencies.getAlmanac ?? getAlmanacDay;
  const personalize =
    dependencies.personalize ?? personalizeEmotionDailyReference302;
  const writeLetter = dependencies.writeLetter ?? appendEmotionDailyLetterVersion;
  const saveProfile = dependencies.saveProfile ?? upsertEmotionAnalysisProfile;
  const existing = await getLetter(userId, letterDate);
  if (!existing) throw new EmotionDailyLetterNotFoundError();
  if (existing.revision !== expectedRevision) {
    throw new EmotionDailyLetterConflictError();
  }

  const profile = await getProfile(userId);
  if (!profile) throw new EmotionDailyLetterNotFoundError();

  const now = dependencies.now ?? new Date();
  const message = cleanMessage(userMessage);
  const previousMessage = cleanMessage(existing.userMessage ?? "");
  const saidAt = existing.userMessageSaidAt ?? (message ? now : null);
  const editedAt =
    previousMessage !== message && existing.userMessageSaidAt ? now : null;
  const analysisSeed = payloadRecord(existing.analysisSeed);
  const priorHistory = buildPriorMessageHistory({
    seed: analysisSeed,
    letters: await listLetters(userId, 365),
    beforeDate: letterDate,
  });
  const nextSeed = {
    ...analysisSeed,
    userMessage: message,
    conversationMode: priorHistory.length ? "history" : "today",
    messageHistory: nextMessageHistory({
      seed: { ...analysisSeed, messageHistory: priorHistory },
      date: letterDate,
      message,
      saidAt,
      editedAt,
    }),
  };
  const almanac = await getAlmanac(letterDate);
  const dailyReference = payloadRecord(existing.dailyReference);
  const refreshed = await personalize({
    date: letterDate,
    almanac,
    baseDailyReference: {
      ...dailyReference,
      todayDate: letterDate,
      lunarLabel:
        almanac.meta.lunarDate?.trim() || dailyReference.lunarLabel || "",
      personalizedYi: [],
      personalizedJi: [],
    },
    analysisSeed: nextSeed,
    generationIntent: "daily-letter",
  });
  // legacy 的 revision CAS 原样保留，只是改由版本权威执行：
  // expectedCurrentVersionNumber 不匹配时一行都不改，返回冲突。
  // action ID 绑定这次 CAS 尝试，重试同一次保存返回同一版本而不是追加两版。
  const written = await writeLetter({
    userId,
    letterDate,
    actionId: `rewrite:${letterDate}:${expectedRevision}`,
    trigger: "generated",
    ...LETTER_WRITER_VERSIONS,
    privacyEpoch: 1,
    payload: letterPayloadFrom({
      userMessage: message || null,
      dailyReference: refreshed.dailyReference,
      analysisSeed: nextSeed,
    }),
    userMessageSaidAt: saidAt,
    userMessageEditedAt: editedAt,
    expectedCurrentVersionNumber: expectedRevision,
    // 用户这次写下／改写／清空的留言，与版本推进同一个短事务（U2）。
    // 黄历查询和来信生成都在事务之外，它们失败不会回滚已经保存的留言。
    // 构造器自带 Phase 1 白名单门禁，未列入的账号在这里就是 null。
    personalMemoryCapture:
      dailyLetterMessageCaptureIfEnabled({
        userId,
        letterDate,
        revision: expectedRevision + 1,
        message,
        previousMessage: existing.userMessage,
        occurredAt: now,
      }) ?? undefined,
  });
  if (!written) throw new EmotionDailyLetterConflictError();
  const saved = written.letter;

  const writeDate = chinaDateString(dependencies.now ?? new Date());
  const latestProfile = await getProfile(userId);
  const latestReference = payloadRecord(latestProfile?.dailyReference);
  if (
    latestProfile &&
    letterDate === writeDate &&
    latestReference.todayDate === letterDate
  ) {
    await saveProfile({
      userId: latestProfile.userId,
      projectId: latestProfile.projectId,
      birthDate: latestProfile.birthDate,
      consentVersion: latestProfile.consentVersion,
      consentText: latestProfile.consentText,
      dailyReference: refreshed.dailyReference,
      analysisSeed: nextSeed,
    });
  }
  return saved;
}
