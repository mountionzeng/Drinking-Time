import type { AlmanacDay } from "@/features/nayin/almanac";
import {
  formatLunarDate,
  getDailyActivityAdvice,
  getDailyClothingAdvice,
} from "@/features/nayin/dailyPresentation";
import type { TodayNayin } from "@/features/nayin/nayin";
import {
  currentChinaShichen,
  shichenFromTime,
  shichenGuidance,
} from "@shared/shichen";

export const EMOTION_ANALYSIS_LOCAL_KEY = "dt:emotionAnalysisProfile";
export const EMOTION_ANALYSIS_GUEST_ID_KEY = "dt:emotionAnalysisGuestId";
export const EMOTION_ANALYSIS_CONSENT_TEXT =
  "你愿意留下的资料和这段话，只用来生成今日回信、接住之后的对话；随时可以修改，也不会替你做诊断或决定。";
export const EMOTION_DAILY_LETTER_VERSION = "daily-letter-v9";

export interface EmotionScheduleBlock {
  label: string;
  title: string;
  detail: string;
}

export interface EmotionLensBlock {
  label: string;
  detail: string;
}

export interface EmotionMessageEntry {
  id: string;
  text: string;
  saidAt: string;
  editedAt?: string;
}

export interface EmotionDailyReference extends Record<string, unknown> {
  todayDate: string;
  lunarLabel: string;
  title: string;
  summary: string;
  clothing: string;
  activity: string;
  schedule: EmotionScheduleBlock[];
  lenses: EmotionLensBlock[];
  avoid: string;
  note: string;
  mindset?: string;
  personalizedYi?: string[];
  personalizedJi?: string[];
  birthShichen?: string;
  currentShichen?: string;
  letterVersion?:
    | "daily-letter-v1"
    | "daily-letter-v2"
    | "daily-letter-v3"
    | "daily-letter-v4"
    | "daily-letter-v5"
    | "daily-letter-v6"
    | "daily-letter-v7"
    | "daily-letter-v8"
    | "daily-letter-v9";
  factSource?: string;
  interpretationSource?: "302-deepseek" | "local-template";
  interpretationModel?: string;
  interpretationGeneratedAt?: string;
}

export interface EmotionAnalysisSeed extends Record<string, unknown> {
  birthDate: string;
  birthTime?: string;
  birthShichen?: string;
  birthBazi?: string;
  birthPlace?: string;
  currentLocation?: string;
  userMessage?: string;
  messageHistory?: EmotionMessageEntry[];
  conversationMode?: EmotionConversationMode;
  age: number | null;
  lifeStage: string;
  birthSeason: string;
  cohort: string;
  savedFor: "long_term_emotion_analysis";
}

export interface EmotionAnalysisProfile {
  birthDate: string;
  dailyReference: EmotionDailyReference;
  analysisSeed: EmotionAnalysisSeed;
  consentVersion: string;
  consentText: string;
  savedAt: string;
  source: "server" | "local";
}

export interface EmotionDailyLetterRecord {
  id: number;
  letterDate: string;
  userMessage: string;
  userMessageSaidAt: string | null;
  userMessageEditedAt: string | null;
  dailyReference: EmotionDailyReference;
  analysisSeed: EmotionAnalysisSeed;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveEmotionAnalysisProfileInput {
  birthDate: string;
  dailyReference: EmotionDailyReference;
  analysisSeed: EmotionAnalysisSeed;
  consentAccepted: true;
  consentText: string;
}

export interface EmotionAnalysisBuildInput {
  birthDate: string;
  birthTime?: string;
  birthPlace?: string;
  currentLocation?: string;
  userMessage?: string;
  messageHistory?: EmotionMessageEntry[];
  conversationMode?: EmotionConversationMode;
}

export type EmotionConversationMode = "today" | "history";

type BirthParts = {
  year: number;
  month: number;
  day: number;
};

function parseBirthDate(value: string): BirthParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isValidBirthDate(value: string, today: TodayNayin) {
  const birth = parseBirthDate(value);
  if (!birth) return false;
  if (birth.year < 1900) return false;
  const todayValue = `${today.cstDate.y}-${String(today.cstDate.m).padStart(2, "0")}-${String(today.cstDate.d).padStart(2, "0")}`;
  return value <= todayValue;
}

function calculateAge(birth: BirthParts, today: TodayNayin) {
  let age = today.cstDate.y - birth.year;
  const birthdayPassed =
    today.cstDate.m > birth.month ||
    (today.cstDate.m === birth.month && today.cstDate.d >= birth.day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
}

function lifeStageForAge(age: number | null) {
  if (age === null) return "时间线待确认";
  if (age < 24) return "身份正在成形，适合把外界期待和自己的愿望分开放";
  if (age < 35) return "选择密度变高，容易在关系、工作和自我证明之间来回切换";
  if (age < 50) return "责任网络更厚，适合把情绪放回具体边界和资源分配里看";
  return "经验开始沉淀，适合区分真正重要的关系和只是惯性的责任";
}

function birthSeasonForMonth(month: number) {
  if (month <= 2 || month === 12) return "冬生：对稳定、安全感和慢热关系更敏感";
  if (month <= 5) return "春生：更容易被开始、变化和成长感牵动";
  if (month <= 8) return "夏生：情绪表达往往更需要被看见，也更怕被消耗";
  return "秋生：对秩序、取舍和关系里的分寸感更敏锐";
}

function cohortForYear(year: number) {
  if (year < 1980) return "转型前后成长：很多感受会和稳定、责任、家庭叙事相连";
  if (year < 1990) return "八十年代成长：个人选择和集体期待常常同时在场";
  if (year < 2000) return "九十年代成长：自我表达更强，也更容易被比较系统牵动";
  if (year < 2010)
    return "零零年代成长：数字关系很近，身体节奏和信息节奏需要重新对齐";
  return "新世代成长：身份流动更快，需要保留可以慢下来的日常仪式";
}

const ELEMENT_SCHEDULE: Record<TodayNayin["element"], EmotionScheduleBlock[]> =
  {
    metal: [
      {
        label: "上午",
        title: "先清边界",
        detail: "适合处理待确认、待拒绝、待归档的事，少用解释换理解。",
      },
      {
        label: "下午",
        title: "做一次取舍",
        detail: "把一个关系或任务里的责任写清楚，别让模糊继续耗能。",
      },
      {
        label: "晚上",
        title: "少做即时回应",
        detail: "重要消息可以晚一点回，给自己留出判断空间。",
      },
    ],
    wood: [
      {
        label: "上午",
        title: "让想法冒头",
        detail: "适合开新文档、发起轻量沟通，先别急着定结论。",
      },
      {
        label: "下午",
        title: "找生长点",
        detail: "把今天真正有生命力的一件小事留下来，它可能比计划更重要。",
      },
      {
        label: "晚上",
        title: "留一点松动",
        detail: "别把所有情绪都解释完，允许关系有自然生长的余地。",
      },
    ],
    water: [
      {
        label: "上午",
        title: "顺着暗流听",
        detail: "适合复盘、倾听、整理聊天记录，先看见感受的来处。",
      },
      {
        label: "下午",
        title: "降低对抗",
        detail: "需要沟通时先问对方处境，再说自己的需要。",
      },
      {
        label: "晚上",
        title: "保护睡前情绪",
        detail: "少刷让自己比较或失落的内容，用一点固定仪式收尾。",
      },
    ],
    fire: [
      {
        label: "上午",
        title: "把重点点亮",
        detail: "适合表达观点、推进决定，但别把速度误认为确定。",
      },
      {
        label: "下午",
        title: "留意被看见的需求",
        detail: "如果很想证明自己，先问那份急迫是来自热爱还是焦虑。",
      },
      {
        label: "晚上",
        title: "把火放柔",
        detail: "适合见朋友、轻松聊天，不适合在疲惫时做关系审判。",
      },
    ],
    earth: [
      {
        label: "上午",
        title: "先安顿身体",
        detail: "适合慢一点开始，吃好、收拾桌面，再进入复杂任务。",
      },
      {
        label: "下午",
        title: "把关系落地",
        detail: "适合谈资源、安排、实际支持，少停在情绪猜测里。",
      },
      {
        label: "晚上",
        title: "回到稳定感",
        detail: "做一件能看见结果的小事，让今天有一个踏实的结尾。",
      },
    ],
  };

const ELEMENT_SOCIAL_LENS: Record<TodayNayin["element"], string> = {
  metal:
    "社会学上，今天适合重新分配边界：谁的责任、谁的期待、谁的劳动，需要说得更清楚。",
  wood: "社会学上，今天适合看见关系里的生长空间：不要急着把人固定成一种角色。",
  water: "社会学上，今天适合观察情绪如何在群聊、工作节奏和亲密关系之间流动。",
  fire: "社会学上，今天适合处理可见度：你想被谁看见，又不必向谁证明。",
  earth: "社会学上，今天适合把抽象感受落回资源、时间和照顾责任的分配。",
};

const ELEMENT_LETTER_CONTEXT: Record<TodayNayin["element"], string> = {
  metal:
    "你说的事也许还牵着边界、责任和期待；哪些该由谁承担，不必一下全算在自己身上。",
  wood: "你说的事也许仍在变化，关系和计划都不必立刻被固定成一种样子。",
  water:
    "情绪会跟着工作节奏、群聊和亲近的人流动，今天的感受不必被当成全部的你。",
  fire: "想被看见，又不想总向别人证明自己，这两种心情可以同时存在。",
  earth: "抽象的感受背后，也可能连着时间、资源和照顾责任这些很具体的东西。",
};

const ELEMENT_ANTHRO_LENS: Record<TodayNayin["element"], string> = {
  metal:
    "人类学上，可以给今天一个小型断舍离仪式：删一条草稿、清一个角落、结束一个悬而未决。",
  wood: "人类学上，可以给今天一个生长仪式：浇水、散步、写下一个还没成熟但值得保留的念头。",
  water:
    "人类学上，可以给今天一个过渡仪式：洗杯子、泡饮品、把身体从上一段情绪里带出来。",
  fire: "人类学上，可以给今天一个点火仪式：见面、表达、分享，但在热烈之后留一段安静。",
  earth:
    "人类学上，可以给今天一个安放仪式：整理包、备餐、归档，让生活重新有容器。",
};

function historicalLens(almanac: AlmanacDay | null | undefined) {
  const yi =
    almanac && (almanac.status === "ok" || almanac.status === "partial")
      ? almanac.yi.slice(0, 2)
      : [];
  const yiText = yi.length ? `黄历宜事提到“${yi.join("、")}”，` : "";
  return `历史参照上，历法本来就是把个人日程放进季节和共同生活里的工具；${yiText}今天更适合把情绪变成可执行的小安排，而不是把它解释成命运。`;
}

function cleanOptionalText(value: string | undefined, maxLength: number) {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  return cleaned.slice(0, maxLength);
}

function currentWordsFromMessage(value: string) {
  const continued = value.match(
    /^接着\d{1,2}月\d{1,2}日说的“[\s\S]*?”，我现在想说[：:]\s*([\s\S]+)$/
  );
  return continued?.[1]?.trim() || value;
}

function normalizeMessageHistory(value: unknown): EmotionMessageEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map(item => ({
      id: String(item.id ?? "").trim(),
      text: currentWordsFromMessage(
        cleanOptionalText(typeof item.text === "string" ? item.text : "", 800)
      ),
      saidAt: String(item.saidAt ?? "").trim(),
      ...(typeof item.editedAt === "string" && item.editedAt.trim()
        ? { editedAt: item.editedAt.trim() }
        : {}),
    }))
    .filter(
      item => item.id && item.text && !Number.isNaN(Date.parse(item.saidAt))
    )
    .slice(-30);
}

function withoutTerminalPunctuation(value: string) {
  return value.replace(/[。；，、,.!?！？…]+$/g, "");
}

function quoteUserMessage(value: string) {
  const compact = cleanOptionalText(value, 54);
  const quoted = withoutTerminalPunctuation(compact);
  return quoted
    ? `“${quoted}${value.trim().length > compact.length ? "…" : ""}”`
    : "";
}

function uniqueAdvice(items: Array<string | undefined>) {
  return Array.from(
    new Set(items.filter((item): item is string => Boolean(item)))
  )
    .map(item => item.slice(0, 8))
    .slice(0, 5);
}

function messageAdvice(message: string) {
  if (/焦虑|担心|害怕|紧张/.test(message)) {
    return { yi: "拆小一件事", ji: "反复预演" };
  }
  if (/累|疲惫|睡不着|失眠/.test(message)) {
    return { yi: "留出休息", ji: "硬撑加码" };
  }
  if (/工作|收入|钱|职业|项目/.test(message)) {
    return { yi: "理清轻重", ji: "同时开太多" };
  }
  if (/关系|朋友|家人|喜欢|分手|争吵/.test(message)) {
    return { yi: "说清需要", ji: "替人下结论" };
  }
  return { yi: "先做一件事", ji: "急着定论" };
}

function localDailyLetter({
  userMessage,
  lifeStage,
  previousMessage,
  letterContext,
  yi,
  currentShichen,
  currentTimeAdvice,
}: {
  userMessage: string;
  lifeStage: string;
  previousMessage: string;
  letterContext: string;
  yi: string;
  currentShichen: string;
  currentTimeAdvice: string;
}) {
  const opening = userMessage
    ? `${quoteUserMessage(userMessage)}，我记下了。先让这句话保持它原来的样子，不急着把它解释成别的。`
    : `${lifeStage}。今天还没有新的话，也没关系，我先替你把这一天留在这里。`;
  const continuity = previousMessage
    ? `你前一次还写过${quoteUserMessage(previousMessage)}。把两句话放在一起，能不能看见变化，现在还不用急着回答；至少，它们都没有被漏掉。`
    : letterContext;
  const gentleAction = userMessage
    ? `如果今天想给这句话一个很小的落点，可以先${yi}。不想马上做什么也可以，记录本身已经让它有了位置。`
    : "等你想说的时候，从一句最小、最具体的话开始就好；今天不需要先准备一个完整的答案。";
  return [
    opening,
    previousMessage ? continuity : letterContext,
    gentleAction,
    `现在是${currentShichen}，${currentTimeAdvice} 问题被好好看见，答案会慢慢浮出来。`,
  ].join("\n\n");
}

export function buildEmotionAnalysisProfile(
  input: string | EmotionAnalysisBuildInput,
  today: TodayNayin,
  almanac: AlmanacDay | null | undefined
): EmotionAnalysisProfile | null {
  const values = typeof input === "string" ? { birthDate: input } : input;
  const birthDate = values.birthDate;
  const birthTime = cleanOptionalText(values.birthTime, 5);
  const birthShichen = birthTime ? shichenFromTime(birthTime) : null;
  const currentShichen = currentChinaShichen();
  const birthPlace = cleanOptionalText(values.birthPlace, 80);
  const currentLocation = cleanOptionalText(values.currentLocation, 80);
  const userMessage = currentWordsFromMessage(
    cleanOptionalText(values.userMessage, 800)
  );
  const messageHistory = normalizeMessageHistory(values.messageHistory);
  const previousMessage =
    [...messageHistory]
      .reverse()
      .find(item => item.text && item.text !== userMessage)?.text ?? "";
  const birth = parseBirthDate(birthDate);
  if (!birth || !isValidBirthDate(birthDate, today)) return null;

  const age = calculateAge(birth, today);
  const lifeStage = lifeStageForAge(age);
  const birthSeason = birthSeasonForMonth(birth.month);
  const cohort = cohortForYear(birth.year);
  const clothing = getDailyClothingAdvice(today);
  const activity = getDailyActivityAdvice(today, almanac);
  const lunarLabel = formatLunarDate(today);
  const personalMessageAdvice = messageAdvice(userMessage);
  const currentTimeAdvice = shichenGuidance(currentShichen);
  const canonicalYi =
    almanac && (almanac.status === "ok" || almanac.status === "partial")
      ? almanac.yi
      : [];
  const canonicalJi =
    almanac && (almanac.status === "ok" || almanac.status === "partial")
      ? almanac.ji
      : [];
  const personalizedYi = uniqueAdvice([
    personalMessageAdvice.yi,
    currentTimeAdvice.recommended,
    birthShichen ? "按自己节奏" : undefined,
    currentLocation ? "预留路上时间" : undefined,
    canonicalYi[0],
  ]);
  const personalizedJi = uniqueAdvice([
    personalMessageAdvice.ji,
    currentTimeAdvice.avoid,
    birthShichen ? "勉强赶节奏" : undefined,
    currentLocation ? "行程排太紧" : undefined,
    canonicalJi[0],
  ]);
  const summary = localDailyLetter({
    userMessage,
    lifeStage,
    previousMessage,
    letterContext: ELEMENT_LETTER_CONTEXT[today.element],
    yi: personalMessageAdvice.yi,
    currentShichen,
    currentTimeAdvice: currentTimeAdvice.letterAdvice,
  });

  const analysisSeed: EmotionAnalysisSeed = {
    birthDate,
    ...(birthTime && birthShichen ? { birthTime, birthShichen } : {}),
    ...(birthPlace ? { birthPlace } : {}),
    ...(currentLocation ? { currentLocation } : {}),
    ...(userMessage ? { userMessage } : {}),
    ...(messageHistory.length ? { messageHistory } : {}),
    ...(values.conversationMode
      ? { conversationMode: values.conversationMode }
      : {}),
    age,
    lifeStage,
    birthSeason,
    cohort,
    savedFor: "long_term_emotion_analysis",
  };

  const dailyReference: EmotionDailyReference = {
    todayDate: today.cstDateStr,
    lunarLabel,
    title: "聊会儿写给你的信",
    summary,
    clothing: clothing.title,
    activity: activity.short,
    schedule: ELEMENT_SCHEDULE[today.element],
    lenses: [
      { label: "社会学", detail: ELEMENT_SOCIAL_LENS[today.element] },
      { label: "人类学", detail: ELEMENT_ANTHRO_LENS[today.element] },
      { label: "历史参照", detail: historicalLens(almanac) },
    ],
    avoid: "不适合在疲惫时做重大关系结论，也不适合把一时情绪当成完整的自己。",
    note:
      [birthSeason, cohort, "这份回信会留作之后聊天的背景，你随时可以改"]
        .filter(Boolean)
        .join("；") + "。",
    mindset: `今天可以先${personalMessageAdvice.yi}；${currentTimeAdvice.mindset}。`,
    personalizedYi,
    personalizedJi,
    ...(birthShichen ? { birthShichen } : {}),
    currentShichen,
    letterVersion: EMOTION_DAILY_LETTER_VERSION,
  };

  return {
    birthDate,
    dailyReference,
    analysisSeed,
    consentVersion: "emotion-analysis-v1",
    consentText: EMOTION_ANALYSIS_CONSENT_TEXT,
    savedAt: new Date().toISOString(),
    source: "local",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDailyReference(value: unknown): EmotionDailyReference | null {
  if (!isObject(value)) return null;
  const schedule = Array.isArray(value.schedule)
    ? value.schedule
        .filter(isObject)
        .map(item => ({
          label: String(item.label ?? ""),
          title: String(item.title ?? ""),
          detail: String(item.detail ?? ""),
        }))
        .filter(item => item.label && item.title && item.detail)
    : [];
  const lenses = Array.isArray(value.lenses)
    ? value.lenses
        .filter(isObject)
        .map(item => ({
          label: String(item.label ?? ""),
          detail: String(item.detail ?? ""),
        }))
        .filter(item => item.label && item.detail)
    : [];
  const personalizedYi = Array.isArray(value.personalizedYi)
    ? value.personalizedYi
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const personalizedJi = Array.isArray(value.personalizedJi)
    ? value.personalizedJi
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  if (!value.todayDate || !value.title || !value.summary) return null;
  return {
    todayDate: String(value.todayDate),
    lunarLabel: String(value.lunarLabel ?? ""),
    title: String(value.title),
    summary: String(value.summary),
    clothing: String(value.clothing ?? ""),
    activity: String(value.activity ?? ""),
    schedule,
    lenses,
    avoid: String(value.avoid ?? ""),
    note: String(value.note ?? "")
      .replace(
        /(?:^|；)你从[^；。]+来到[^；。]+，地点变化带来的生活节奏和关系网络，也会放进这份参考里(?=；|。|$)/g,
        ""
      )
      .replace(/^；|；(?=。|$)/g, ""),
    ...(personalizedYi.length ? { personalizedYi } : {}),
    ...(personalizedJi.length ? { personalizedJi } : {}),
    ...(typeof value.birthShichen === "string"
      ? { birthShichen: value.birthShichen }
      : {}),
    ...(typeof value.currentShichen === "string"
      ? { currentShichen: value.currentShichen }
      : {}),
    ...(typeof value.mindset === "string" && value.mindset.trim()
      ? { mindset: value.mindset.trim() }
      : {}),
    ...(value.letterVersion === "daily-letter-v1" ||
    value.letterVersion === "daily-letter-v2" ||
    value.letterVersion === "daily-letter-v3" ||
    value.letterVersion === "daily-letter-v4" ||
    value.letterVersion === "daily-letter-v5" ||
    value.letterVersion === "daily-letter-v6" ||
    value.letterVersion === "daily-letter-v7" ||
    value.letterVersion === "daily-letter-v8" ||
    value.letterVersion === "daily-letter-v9"
      ? { letterVersion: value.letterVersion }
      : {}),
    ...(typeof value.factSource === "string"
      ? { factSource: value.factSource }
      : {}),
    ...(value.interpretationSource === "302-deepseek" ||
    value.interpretationSource === "local-template"
      ? { interpretationSource: value.interpretationSource }
      : {}),
    ...(typeof value.interpretationModel === "string"
      ? { interpretationModel: value.interpretationModel }
      : {}),
    ...(typeof value.interpretationGeneratedAt === "string"
      ? { interpretationGeneratedAt: value.interpretationGeneratedAt }
      : {}),
  };
}

function normalizeAnalysisSeed(value: unknown): EmotionAnalysisSeed | null {
  if (!isObject(value) || typeof value.birthDate !== "string") return null;
  return {
    birthDate: value.birthDate,
    ...(typeof value.birthTime === "string" && value.birthTime.trim()
      ? { birthTime: value.birthTime.trim() }
      : {}),
    ...(typeof value.birthShichen === "string" && value.birthShichen.trim()
      ? { birthShichen: value.birthShichen.trim() }
      : {}),
    ...(typeof value.birthBazi === "string" && value.birthBazi.trim()
      ? { birthBazi: value.birthBazi.trim() }
      : {}),
    ...(typeof value.birthPlace === "string" && value.birthPlace.trim()
      ? { birthPlace: value.birthPlace.trim() }
      : {}),
    ...(typeof value.currentLocation === "string" &&
    value.currentLocation.trim()
      ? { currentLocation: value.currentLocation.trim() }
      : {}),
    ...(typeof value.userMessage === "string" && value.userMessage.trim()
      ? { userMessage: value.userMessage.trim() }
      : {}),
    ...(normalizeMessageHistory(value.messageHistory).length
      ? { messageHistory: normalizeMessageHistory(value.messageHistory) }
      : {}),
    ...(value.conversationMode === "today" ||
    value.conversationMode === "history"
      ? { conversationMode: value.conversationMode }
      : {}),
    age: typeof value.age === "number" ? value.age : null,
    lifeStage: String(value.lifeStage ?? ""),
    birthSeason: String(value.birthSeason ?? ""),
    cohort: String(value.cohort ?? ""),
    savedFor: "long_term_emotion_analysis",
  };
}

export function normalizeEmotionAnalysisProfile(
  value: unknown,
  source: "server" | "local" = "local"
): EmotionAnalysisProfile | null {
  if (!isObject(value) || typeof value.birthDate !== "string") return null;
  const dailyReference = normalizeDailyReference(value.dailyReference);
  const analysisSeed = normalizeAnalysisSeed(value.analysisSeed);
  if (!dailyReference || !analysisSeed) return null;

  const updatedAt = value.updatedAt;
  const savedAt =
    updatedAt instanceof Date
      ? updatedAt.toISOString()
      : typeof updatedAt === "string"
        ? updatedAt
        : typeof value.savedAt === "string"
          ? value.savedAt
          : new Date().toISOString();

  const compatibleAnalysisSeed =
    analysisSeed.messageHistory?.length || !analysisSeed.userMessage
      ? analysisSeed
      : {
          ...analysisSeed,
          messageHistory: [
            {
              id: `legacy-${savedAt}`,
              text: analysisSeed.userMessage,
              saidAt: savedAt,
            },
          ],
        };

  return {
    birthDate: value.birthDate,
    dailyReference,
    analysisSeed: compatibleAnalysisSeed,
    consentVersion: String(value.consentVersion ?? "emotion-analysis-v1"),
    consentText: String(value.consentText ?? EMOTION_ANALYSIS_CONSENT_TEXT),
    savedAt,
    source,
  };
}

function normalizeIsoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeEmotionDailyLetter(
  value: unknown
): EmotionDailyLetterRecord | null {
  if (!isObject(value)) return null;
  const letterDate =
    typeof value.letterDate === "string" ? value.letterDate : "";
  const dailyReference = normalizeDailyReference(value.dailyReference);
  const analysisSeed = normalizeAnalysisSeed(value.analysisSeed);
  const createdAt = normalizeIsoDate(value.createdAt);
  const updatedAt = normalizeIsoDate(value.updatedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(letterDate) ||
    !dailyReference ||
    !analysisSeed ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id: typeof value.id === "number" ? value.id : 0,
    letterDate,
    userMessage:
      typeof value.userMessage === "string" ? value.userMessage.trim() : "",
    userMessageSaidAt: normalizeIsoDate(value.userMessageSaidAt),
    userMessageEditedAt: normalizeIsoDate(value.userMessageEditedAt),
    dailyReference,
    analysisSeed,
    revision:
      typeof value.revision === "number" && value.revision > 0
        ? Math.floor(value.revision)
        : 1,
    createdAt,
    updatedAt,
  };
}

export function loadLocalEmotionAnalysisProfile() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EMOTION_ANALYSIS_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const source =
      isObject(parsed) && parsed.source === "server" ? "server" : "local";
    return normalizeEmotionAnalysisProfile(parsed, source);
  } catch {
    return null;
  }
}

export function loadLocalGuestEmotionAnalysisProfile() {
  const profile = loadLocalEmotionAnalysisProfile();
  return profile?.source === "local" ? profile : null;
}

export function saveLocalEmotionAnalysisProfile(
  profile: EmotionAnalysisProfile
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EMOTION_ANALYSIS_LOCAL_KEY,
      JSON.stringify(profile)
    );
  } catch {
    // localStorage 不可用时跳过，服务端保存仍然可以工作。
  }
}

export function clearLocalGuestEmotionAnalysisProfile() {
  if (typeof window === "undefined") return;
  try {
    const profile = loadLocalEmotionAnalysisProfile();
    if (profile?.source === "local") {
      window.localStorage.removeItem(EMOTION_ANALYSIS_LOCAL_KEY);
    }
  } catch {
    // 本地存储不可用时无需阻断账号登录。
  }
}

export function getOrCreateLocalEmotionGuestId() {
  if (typeof window === "undefined") return "guest-server-render";
  try {
    const existing = window.localStorage
      .getItem(EMOTION_ANALYSIS_GUEST_ID_KEY)
      ?.trim();
    if (existing) return existing;
    const randomPart =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const guestId = `guest-${randomPart}`;
    window.localStorage.setItem(EMOTION_ANALYSIS_GUEST_ID_KEY, guestId);
    return guestId;
  } catch {
    return `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
