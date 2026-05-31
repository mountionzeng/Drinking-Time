import type { AlmanacDay } from "@/features/nayin/almanac";
import {
  formatLunarDate,
  getDailyActivityAdvice,
  getDailyClothingAdvice,
} from "@/features/nayin/dailyPresentation";
import type { TodayNayin } from "@/features/nayin/nayin";

export const EMOTION_ANALYSIS_LOCAL_KEY = "dt:emotionAnalysisProfile";
export const EMOTION_ANALYSIS_CONSENT_TEXT =
  "我同意将出生日期保存为长期情绪分析底盘，用于生成今日参考和后续对话中的个性化理解；这不是医疗、心理诊断或命运判断。";

export interface EmotionScheduleBlock {
  label: string;
  title: string;
  detail: string;
}

export interface EmotionLensBlock {
  label: string;
  detail: string;
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
}

export interface EmotionAnalysisSeed extends Record<string, unknown> {
  birthDate: string;
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

export interface SaveEmotionAnalysisProfileInput {
  birthDate: string;
  dailyReference: EmotionDailyReference;
  analysisSeed: EmotionAnalysisSeed;
  consentAccepted: true;
  consentText: string;
}

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

function historicalLens(
  today: TodayNayin,
  almanac: AlmanacDay | null | undefined
) {
  const yi =
    almanac && (almanac.status === "ok" || almanac.status === "partial")
      ? almanac.yi.slice(0, 2)
      : [];
  const yiText = yi.length ? `黄历宜事提到“${yi.join("、")}”，` : "";
  return `历史参照上，历法本来就是把个人日程放进季节和共同生活里的工具；${yiText}今天更适合把情绪变成可执行的小安排，而不是把它解释成命运。`;
}

export function buildEmotionAnalysisProfile(
  birthDate: string,
  today: TodayNayin,
  almanac: AlmanacDay | null | undefined
): EmotionAnalysisProfile | null {
  const birth = parseBirthDate(birthDate);
  if (!birth || !isValidBirthDate(birthDate, today)) return null;

  const age = calculateAge(birth, today);
  const lifeStage = lifeStageForAge(age);
  const birthSeason = birthSeasonForMonth(birth.month);
  const cohort = cohortForYear(birth.year);
  const clothing = getDailyClothingAdvice(today);
  const activity = getDailyActivityAdvice(today, almanac);
  const lunarLabel = formatLunarDate(today);

  const analysisSeed: EmotionAnalysisSeed = {
    birthDate,
    age,
    lifeStage,
    birthSeason,
    cohort,
    savedFor: "long_term_emotion_analysis",
  };

  const dailyReference: EmotionDailyReference = {
    todayDate: today.cstDateStr,
    lunarLabel,
    title: "今日情绪日程参考",
    summary: `${lifeStage}。今天的${today.theme.elementCn}气更适合把感受落成一个小动作，而不是急着给自己下判断。`,
    clothing: clothing.title,
    activity: activity.short,
    schedule: ELEMENT_SCHEDULE[today.element],
    lenses: [
      { label: "社会学", detail: ELEMENT_SOCIAL_LENS[today.element] },
      { label: "人类学", detail: ELEMENT_ANTHRO_LENS[today.element] },
      { label: "历史参照", detail: historicalLens(today, almanac) },
    ],
    avoid: "不适合在疲惫时做重大关系结论，也不适合把一时情绪当成完整的自己。",
    note: `${birthSeason}；${cohort}。这份参考会进入长期情绪分析底盘，作为后续对话的背景线索。`,
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
    note: String(value.note ?? ""),
  };
}

function normalizeAnalysisSeed(value: unknown): EmotionAnalysisSeed | null {
  if (!isObject(value) || typeof value.birthDate !== "string") return null;
  return {
    birthDate: value.birthDate,
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

  return {
    birthDate: value.birthDate,
    dailyReference,
    analysisSeed,
    consentVersion: String(value.consentVersion ?? "emotion-analysis-v1"),
    consentText: String(value.consentText ?? EMOTION_ANALYSIS_CONSENT_TEXT),
    savedAt,
    source,
  };
}

export function loadLocalEmotionAnalysisProfile() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EMOTION_ANALYSIS_LOCAL_KEY);
    return raw
      ? normalizeEmotionAnalysisProfile(JSON.parse(raw), "local")
      : null;
  } catch {
    return null;
  }
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
