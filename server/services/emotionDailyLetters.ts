import type {
  EmotionAnalysisProfile,
  EmotionDailyLetter,
} from "../../drizzle/schema";
import {
  appendEmotionDailyLetterVersion,
  beginPersonalMemoryLetterAttempt,
  commitPersonalMemoryLetterAttempt,
  failPersonalMemoryLetterAttempt,
  getEmotionAnalysisProfile,
  getEmotionDailyLetter,
  listEmotionDailyLetters,
  listEmotionDailyLetterVersions,
  saveEmotionDailyLetterMessageIfRevision,
  upsertEmotionAnalysisProfile,
} from "../db";
import type {
  PersonalMemoryCapture,
  PersonalMemoryLetterPayload,
} from "../../shared/personalMemory";
import {
  dailyLetterMessageCaptureIfEnabled,
  isPersonalMemoryCaptureEnabled,
} from "./personalMemoryEvents";
import {
  PERSONAL_MEMORY_SELECTOR_VERSION,
  selectPersonalMemoryContextForDailyLetter,
} from "./personalMemorySelection";
import { getAlmanacDay, type AlmanacDay } from "./almanac";
import {
  EMOTION_DAILY_LETTER_VERSION,
  chinaDateString,
  personalizeEmotionDailyReference302,
} from "./emotionDailyReference302";

type PayloadRecord = Record<string, unknown>;

/**
 * 黄历事实是否可信到能进入来信 payload（R15）。
 *
 * `getAlmanacDay(date)` 内部总是把返回对象的 `date` 字段设成调用方传入的
 * 那个 `date` 参数——它并不能替我们证实供应商真的返回了那一天的数据。
 * 这里的 `almanac.date !== targetDate` 检查因此更像一份**意图声明**：万一
 * 未来这层实现变了、开始诚实回传供应商的真实日期，这里立刻就能生效，
 * 不需要回头找这一处调用点。`status` 才是当前唯一能实际判定可信度的信号：
 * 非 ok/partial（超时、限流、未配置、解析失败）一律不可信。
 */
export function trustedAlmanacFacts(
  almanac: AlmanacDay,
  targetDate: string
): Record<string, unknown> | null {
  if (almanac.date !== targetDate) return null;
  if (almanac.status !== "ok" && almanac.status !== "partial") return null;
  const hasFacts =
    almanac.yi.length > 0 ||
    almanac.ji.length > 0 ||
    almanac.luckyHours.length > 0 ||
    almanac.directions.length > 0 ||
    Object.keys(almanac.meta).length > 0;
  if (!hasFacts) return null;
  return {
    provider: almanac.provider,
    source: almanac.sourceLabel,
    status: almanac.status,
    fetchedAt: almanac.fetchedAt,
    yi: almanac.yi,
    ji: almanac.ji,
    luckyHours: almanac.luckyHours,
    directions: almanac.directions,
    meta: almanac.meta,
  };
}

interface DailyLetterDependencies {
  getLetter?: typeof getEmotionDailyLetter;
  listLetters?: typeof listEmotionDailyLetters;
  getProfile?: typeof getEmotionAnalysisProfile;
  getAlmanac?: typeof getAlmanacDay;
  personalize?: typeof personalizeEmotionDailyReference302;
  generateAttempt?: typeof generateDailyLetterViaAttempt;
  listVersions?: typeof listEmotionDailyLetterVersions;
  saveMessage?: typeof saveEmotionDailyLetterMessageIfRevision;
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
  /** 生成时固定的资料快照；不传入即保持 U1 的空占位（尚未经过 U6 生成链路的调用点）。 */
  profileRevision?: string | null;
  almanac?: Record<string, unknown> | null;
  selectedEvidence?: PersonalMemoryLetterPayload["selectedEvidence"];
}): PersonalMemoryLetterPayload {
  return {
    dailyReference: data.dailyReference,
    analysisSeed: data.analysisSeed,
    userMessage: data.userMessage,
    profileRevision: data.profileRevision ?? null,
    almanac: data.almanac ?? null,
    selectedEvidence: data.selectedEvidence ?? [],
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

// ─── 生成 attempt：选材 → 黄历 → 模型 → 条件提交（U6） ────────────────────

/**
 * 一次生成 attempt 的结果。**这不是异常通道**——in_flight／failed 都是
 * 正常、预期内的分支，调用方（router）负责把它们映射成用户能看懂的状态，
 * 而不是让 UI 收到一个五百错误。
 */
export type DailyLetterAttemptOutcome =
  | {
      status: "committed";
      letter: EmotionDailyLetter;
      refreshedDailyReference: PayloadRecord;
    }
  /** 同一个 action ID 之前已经成功过；重复提交／重放直接拿旧结果。 */
  | { status: "already_committed"; letter: EmotionDailyLetter }
  /** 另一个真正在跑的请求还没完成，不应该并发再触发一次生成。 */
  | { status: "in_flight" }
  /** 失败：黄历/模型出错，或选材依据在生成期间被撤走。旧版本仍然可读。 */
  | { status: "failed"; reason: string };

interface DailyLetterGenerationDependencies {
  beginAttempt?: typeof beginPersonalMemoryLetterAttempt;
  commitAttempt?: typeof commitPersonalMemoryLetterAttempt;
  failAttempt?: typeof failPersonalMemoryLetterAttempt;
  selectMemory?: typeof selectPersonalMemoryContextForDailyLetter;
  getAlmanac?: typeof getAlmanacDay;
  personalize?: typeof personalizeEmotionDailyReference302;
  getLetter?: typeof getEmotionDailyLetter;
}

/**
 * 首次打开与显式重读共用的生成入口。
 *
 * 调用方负责准备好 `analysisSeed`（含 messageHistory／conversationMode 等
 * 已经算好的字段）——这个函数只管"选材 → 查黄历 → 调模型 → 条件提交"这一段，
 * 不重新推导用户留言的历史拼装逻辑，那部分在两个调用点已经不一样
 * （首次打开是"重置今天留言"，重读是"CAS 更新今天留言"）。
 */
export async function generateDailyLetterViaAttempt(
  input: {
    userId: number;
    letterDate: string;
    actionId: string;
    trigger: "generated" | "reread";
    generationIntent: "daily-letter" | "conversation-reply";
    baseDailyReference: PayloadRecord;
    analysisSeed: PayloadRecord;
    userMessage: string | null;
    userMessageSaidAt: Date | null;
    userMessageEditedAt: Date | null;
    /** 生成时固定的资料快照标识（这里用 profile.updatedAt，见调用点）。 */
    profileRevision: string | null;
    expectedCurrentVersionNumber?: number;
    expectedLetterRevision?: number;
    personalMemoryCapture?: PersonalMemoryCapture;
  },
  dependencies: DailyLetterGenerationDependencies = {}
): Promise<DailyLetterAttemptOutcome> {
  const beginAttempt =
    dependencies.beginAttempt ?? beginPersonalMemoryLetterAttempt;
  const commitAttempt =
    dependencies.commitAttempt ?? commitPersonalMemoryLetterAttempt;
  const failAttempt =
    dependencies.failAttempt ?? failPersonalMemoryLetterAttempt;
  const selectMemory =
    dependencies.selectMemory ?? selectPersonalMemoryContextForDailyLetter;
  const getAlmanac = dependencies.getAlmanac ?? getAlmanacDay;
  const personalize =
    dependencies.personalize ?? personalizeEmotionDailyReference302;
  const getLetter = dependencies.getLetter ?? getEmotionDailyLetter;

  const begun = await beginAttempt({
    userId: input.userId,
    letterDate: input.letterDate,
    actionId: input.actionId,
  });
  if (begun.status === "already_committed") {
    const letter = await getLetter(input.userId, input.letterDate);
    if (!letter) return { status: "failed", reason: "已提交但读不到来信" };
    return { status: "already_committed", letter };
  }
  if (begun.status === "in_flight") {
    return { status: "in_flight" };
  }

  try {
    const selection = await selectMemory({
      userId: input.userId,
      targetDate: input.letterDate,
    });
    const almanac = await getAlmanac(input.letterDate);
    const refreshed = await personalize({
      date: input.letterDate,
      almanac,
      baseDailyReference: input.baseDailyReference,
      analysisSeed: input.analysisSeed,
      generationIntent: input.generationIntent,
      personalMemoryContext: selection.promptContext,
    });

    const committed = await commitAttempt({
      attemptId: begun.attempt.id,
      userId: input.userId,
      letterDate: input.letterDate,
      actionId: input.actionId,
      trigger: input.trigger,
      selectorVersion: PERSONAL_MEMORY_SELECTOR_VERSION,
      promptVersion: EMOTION_DAILY_LETTER_VERSION,
      modelVersion: refreshed.model,
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: letterPayloadFrom({
        userMessage: input.userMessage,
        dailyReference: refreshed.dailyReference,
        analysisSeed: input.analysisSeed,
        profileRevision: input.profileRevision,
        almanac: trustedAlmanacFacts(almanac, input.letterDate),
        selectedEvidence: selection.selected.map(item => ({
          insightId: item.insightId,
          insightRevision: item.revision,
          eventIds: item.evidenceEventIds,
        })),
      }),
      userMessageSaidAt: input.userMessageSaidAt,
      userMessageEditedAt: input.userMessageEditedAt,
      expectedCurrentVersionNumber: input.expectedCurrentVersionNumber,
      expectedLetterRevision: input.expectedLetterRevision,
      personalMemoryCapture: input.personalMemoryCapture,
      captureLetterVersionEvent: isPersonalMemoryCaptureEnabled(input.userId),
    });

    if (committed.outcome === "committed") {
      return {
        status: "committed",
        letter: committed.letter,
        refreshedDailyReference: refreshed.dailyReference,
      };
    }
    if (committed.outcome === "epoch_conflict") {
      // attempt 已经在 db 层被标记 rejected_stale。这里不在原地无限重试——
      // "安全重选或降级"落在调用方：它可以决定要不要发起新一次 attempt
      // （新 action ID），这里只诚实报告"这次没能提交，原因是什么"。
      return {
        status: "failed",
        reason: "记忆状态已更新，请重试",
      };
    }
    // revision_conflict：正常路径下先 begin 才能 commit，同一 attempt
    // 不会有两次提交竞争；出现只可能是极端并发下的兜底分支。
    await failAttempt({
      attemptId: begun.attempt.id,
      userId: input.userId,
      outcome: "failed",
    });
    return { status: "failed", reason: "版本已被并发更新，请刷新后重试" };
  } catch (error) {
    // 黄历超时、模型报错等：标记失败，旧版本继续可读，调用方可以安全重试
    // （同一 action ID 会把这个失败的 attempt 重新拉回 in_flight）。
    await failAttempt({
      attemptId: begun.attempt.id,
      userId: input.userId,
      outcome: "failed",
    }).catch(() => {});
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "生成失败",
    };
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
    actionId,
  }: {
    userId: number;
    letterDate: string;
    userMessage: string;
    expectedRevision: number;
    actionId?: string;
  },
  dependencies: DailyLetterDependencies = {}
): Promise<EmotionDailyLetter> {
  const getLetter = dependencies.getLetter ?? getEmotionDailyLetter;
  const listLetters = dependencies.listLetters ?? listEmotionDailyLetters;
  const listVersions =
    dependencies.listVersions ?? listEmotionDailyLetterVersions;
  const getProfile = dependencies.getProfile ?? getEmotionAnalysisProfile;
  const getAlmanac = dependencies.getAlmanac ?? getAlmanacDay;
  const personalize =
    dependencies.personalize ?? personalizeEmotionDailyReference302;
  const generateAttempt =
    dependencies.generateAttempt ??
    (input =>
      generateDailyLetterViaAttempt(input, {
        getAlmanac,
        personalize,
      }));
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
  const dailyReference = payloadRecord(existing.dailyReference);
  const versions = await listVersions(userId, letterDate);
  const currentVersion =
    versions.find(version => version.id === existing.currentVersionId) ??
    versions.at(-1);
  const generated = await generateAttempt({
    userId,
    letterDate,
    actionId: actionId ?? `reread:${letterDate}:${expectedRevision}`,
    trigger: "reread",
    generationIntent: "daily-letter",
    baseDailyReference: {
      ...dailyReference,
      todayDate: letterDate,
      personalizedYi: [],
      personalizedJi: [],
    },
    analysisSeed: nextSeed,
    userMessage: message || null,
    userMessageSaidAt: saidAt,
    userMessageEditedAt: editedAt,
    profileRevision: profile.updatedAt.toISOString(),
    expectedCurrentVersionNumber:
      currentVersion?.envelope.versionNumber ?? expectedRevision,
    expectedLetterRevision: expectedRevision,
    // 用户这次写下／改写／清空的留言，与版本推进同一个短事务（U2）。
    // 黄历查询和来信生成都在事务之外，它们失败不会回滚已经保存的留言。
    // 构造器自带 Phase 1 白名单门禁，未列入的账号在这里就是 null。
    personalMemoryCapture:
      previousMessage !== message
        ? (dailyLetterMessageCaptureIfEnabled({
            userId,
            letterDate,
            revision: expectedRevision + 1,
            message,
            previousMessage: existing.userMessage,
            occurredAt: now,
          }) ?? undefined)
        : undefined,
  });
  if (generated.status === "in_flight") {
    throw new EmotionDailyLetterConflictError();
  }
  if (generated.status === "failed") {
    throw new Error(generated.reason);
  }
  const saved = generated.letter;

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
      dailyReference: saved.dailyReference,
      analysisSeed: nextSeed,
    });
  }
  return saved;
}

/** 保存每日留言本身，不生成新来信版本。显式“再读一遍”由独立入口负责。 */
export async function saveEmotionDailyLetterMessage(
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
  const saveMessage =
    dependencies.saveMessage ?? saveEmotionDailyLetterMessageIfRevision;
  const saveProfile = dependencies.saveProfile ?? upsertEmotionAnalysisProfile;
  const existing = await getLetter(userId, letterDate);
  if (!existing) throw new EmotionDailyLetterNotFoundError();
  if (existing.revision !== expectedRevision) {
    throw new EmotionDailyLetterConflictError();
  }
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
  const saved = await saveMessage({
    userId,
    letterDate,
    expectedRevision,
    userMessage: message || null,
    userMessageSaidAt: saidAt,
    userMessageEditedAt: editedAt,
    analysisSeed: nextSeed,
    personalMemoryCapture:
      previousMessage !== message
        ? (dailyLetterMessageCaptureIfEnabled({
            userId,
            letterDate,
            revision: expectedRevision + 1,
            message,
            previousMessage: existing.userMessage,
            occurredAt: now,
          }) ?? undefined)
        : undefined,
  });
  if (!saved) throw new EmotionDailyLetterConflictError();

  const latestProfile = await (
    dependencies.getProfile ?? getEmotionAnalysisProfile
  )(userId);
  const latestReference = payloadRecord(latestProfile?.dailyReference);
  if (
    latestProfile &&
    letterDate === chinaDateString(now) &&
    latestReference.todayDate === letterDate
  ) {
    await saveProfile({
      userId: latestProfile.userId,
      projectId: latestProfile.projectId,
      birthDate: latestProfile.birthDate,
      consentVersion: latestProfile.consentVersion,
      consentText: latestProfile.consentText,
      dailyReference: latestProfile.dailyReference,
      analysisSeed: nextSeed,
    });
  }
  return saved;
}
