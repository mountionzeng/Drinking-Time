import { ENV } from "../_core/env";
import { parseJsonLoose } from "../_core/llmJson";
import type { AlmanacDay } from "./almanac";
import {
  currentChinaShichenGuidance,
  type ShichenGuidance,
} from "../../shared/shichen";

type PayloadRecord = Record<string, unknown>;

type ScheduleBlock = {
  label: string;
  title: string;
  detail: string;
};

type LensBlock = {
  label: string;
  detail: string;
};

type DeepSeekPayload = {
  summary?: unknown;
  clothing?: unknown;
  mindset?: unknown;
  schedule?: unknown;
  lenses?: unknown;
  avoid?: unknown;
  note?: unknown;
  personalizedYi?: unknown;
  personalizedJi?: unknown;
};

type CompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

type Fetcher = (
  input: string,
  init?: RequestInit
) => Promise<FetchResponseLike>;

export interface PersonalizeEmotionDailyReferenceInput {
  date: string;
  almanac: AlmanacDay;
  baseDailyReference: PayloadRecord;
  analysisSeed: PayloadRecord;
  generationIntent?: "daily-letter" | "conversation-reply";
  fetcher?: Fetcher;
  now?: Date;
}

export interface PersonalizeEmotionDailyReferenceResult {
  dailyReference: PayloadRecord;
  source: "302-deepseek" | "local-template";
  model: string;
  fallbackReason?: string;
}

export const EMOTION_DAILY_LETTER_VERSION = "daily-letter-v10";

const LENS_LABELS = ["社会学", "人类学", "历史参照"] as const;
const GAN_WUXING: Record<string, string> = {
  甲: "木",
  乙: "木",
  丙: "火",
  丁: "火",
  戊: "土",
  己: "土",
  庚: "金",
  辛: "金",
  壬: "水",
  癸: "水",
};
const WUXING_SHENG: Record<string, string> = {
  金: "水",
  水: "木",
  木: "火",
  火: "土",
  土: "金",
};
const WUXING_KE: Record<string, string> = {
  金: "木",
  木: "土",
  土: "水",
  水: "火",
  火: "金",
};
const WUXING_COLORS: Record<string, string[]> = {
  金: ["白色", "银色", "金色"],
  木: ["绿色", "青色", "翠色"],
  水: ["黑色", "深蓝", "藏青"],
  火: ["红色", "紫色", "橙色"],
  土: ["黄色", "棕色", "米色"],
};
const REPORT_TONE_PATTERN =
  /社会学上|人类学上|历史参照上|按传统时间文化的排法|日主.{0,3}属[金木水火土]|[金木水火土](?:生|克)[金木水火土]/;
const INTERPRETIVE_OVERREACH_PATTERN =
  /你(?:真正|其实)(?:想要|需要|害怕|讨厌|在意)的是|你(?:想要|需要|害怕|讨厌|在意)的不是.{0,36}(?:而是|只是|是这种|是因为|是为了)|这说明你(?:真正|其实)?|本质上你/;

function cleanText(value: unknown, max = 800) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, max)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function currentWordsFromMessage(value: unknown) {
  const message = cleanText(value, 800);
  const continued = message.match(
    /^接着\d{1,2}月\d{1,2}日说的“[\s\S]*?”，我现在想说[：:]\s*([\s\S]+)$/
  );
  return continued?.[1]?.trim() || message;
}

function cleanLetter(value: unknown, max = 1_200) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .trim()
    .slice(0, max)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .split(/\r?\n/)
    .map(line => line.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (cleaned.includes("\n\n") || cleaned.length < 180) return cleaned;

  const sentences =
    cleaned
      .match(/[^。！？]+[。！？]?/g)
      ?.map(item => item.trim())
      .filter(Boolean) ?? [];
  if (sentences.length < 3) return cleaned;

  const paragraphCount = Math.min(
    5,
    Math.max(3, Math.ceil(cleaned.length / 130))
  );
  const sentenceCount = Math.ceil(sentences.length / paragraphCount);
  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += sentenceCount) {
    paragraphs.push(sentences.slice(index, index + sentenceCount).join(""));
  }
  return paragraphs.join("\n\n");
}

function letterQualityIssue(summary: string) {
  const paragraphs = summary
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);
  if (REPORT_TONE_PATTERN.test(summary)) {
    return "仍带有分析报告腔";
  }
  if (
    summary.length < 380 ||
    summary.length > 700 ||
    paragraphs.length < 4 ||
    paragraphs.length > 5
  ) {
    return "篇幅或结构不完整";
  }
  if (INTERPRETIVE_OVERREACH_PATTERN.test(summary)) {
    return "替用户解释内心，把一种推测写成了结论";
  }
  return "";
}

function completeLetter(summary: string) {
  return !letterQualityIssue(summary);
}

function normalizeAdvice(value: unknown, fallback: unknown) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(fallback)
      ? fallback
      : [];
  return Array.from(
    new Set(
      source
        .filter((item): item is string => typeof item === "string")
        .map(item => cleanText(item, 8))
        .filter(Boolean)
    )
  ).slice(0, 5);
}

function mergeAdvice(value: unknown, addition: string) {
  const existing = Array.isArray(value) ? value : [];
  return normalizeAdvice([addition, ...existing], []);
}

function currentTimeContext(
  input: PersonalizeEmotionDailyReferenceInput
): ShichenGuidance {
  return currentChinaShichenGuidance(input.now);
}

function includeCurrentTimeAdvice(
  summary: string,
  guidance: ShichenGuidance
) {
  if (summary.includes(guidance.name)) return summary;
  const paragraphs = summary
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);
  if (!paragraphs.length) return summary;
  const currentAdvice = `现在是${guidance.name}（${guidance.range}），${guidance.letterAdvice}`;
  paragraphs[paragraphs.length - 1] =
    `${paragraphs[paragraphs.length - 1]} ${currentAdvice}`;
  return paragraphs.join("\n\n");
}

function completionText(data: CompletionResponse) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(part => (part.type === "text" ? (part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeSchedule(value: unknown, fallback: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) return normalizeScheduleFallback(fallback);
  const schedule = value
    .filter(
      (item): item is PayloadRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map(item => ({
      label: cleanText(item.label, 12),
      title: cleanText(item.title, 40),
      detail: cleanText(item.detail, 180),
    }))
    .filter(item => item.label && item.title && item.detail)
    .slice(0, 3);
  return schedule.length === 3 ? schedule : normalizeScheduleFallback(fallback);
}

function normalizeScheduleFallback(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is PayloadRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map(item => ({
      label: cleanText(item.label, 12),
      title: cleanText(item.title, 40),
      detail: cleanText(item.detail, 180),
    }))
    .filter(item => item.label && item.title && item.detail)
    .slice(0, 3);
}

function normalizeLenses(value: unknown, fallback: unknown): LensBlock[] {
  if (!Array.isArray(value)) return normalizeLensFallback(fallback);
  const byLabel = new Map<string, string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as PayloadRecord;
    const label = cleanText(record.label, 12);
    const detail = cleanText(record.detail, 220);
    if (detail && LENS_LABELS.includes(label as (typeof LENS_LABELS)[number])) {
      byLabel.set(label, detail);
    }
  }
  if (byLabel.size !== LENS_LABELS.length) {
    return normalizeLensFallback(fallback);
  }
  return LENS_LABELS.map(label => ({ label, detail: byLabel.get(label)! }));
}

function normalizeLensFallback(value: unknown): LensBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is PayloadRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map(item => ({
      label: cleanText(item.label, 12),
      detail: cleanText(item.detail, 220),
    }))
    .filter(item => item.label && item.detail)
    .slice(0, 3);
}

function hasAlmanacFacts(almanac: AlmanacDay) {
  return (
    (almanac.status === "ok" || almanac.status === "partial") &&
    (almanac.yi.length > 0 ||
      almanac.ji.length > 0 ||
      almanac.luckyHours.length > 0 ||
      almanac.directions.length > 0 ||
      Object.keys(almanac.meta).length > 0)
  );
}

function factualActivity(almanac: AlmanacDay, fallback: unknown) {
  if (almanac.yi.length) {
    return `宜 ${almanac.yi.slice(0, 5).join("、")}`;
  }
  return cleanText(fallback, 160);
}

function safeLocalLetter(
  input: PersonalizeEmotionDailyReferenceInput,
  guidance: ShichenGuidance
) {
  const currentWords = currentWordsFromMessage(input.analysisSeed.userMessage);
  const quotedWords = currentWords
    ? `你写下：“${currentWords.slice(0, 320)}”`
    : "今天你还没有留下新的话";
  return [
    `${quotedWords}。我先让这句话保持原来的样子，不把其中的情绪换成一个更容易解释的词，也不急着替你判断它最终意味着什么。`,
    "现在能确定的，只是这句话已经值得被认真留下。它可能还连着别的感受，也可能只是此刻最响亮的那一部分；那些没有说出来的地方，先不由聊会儿替你补上。",
    "如果这件事牵涉到空间、时间、钱、照顾或与别人共同承担的日常，可以等你愿意时再一项项说清。现实里的重量被看见以后，感受不必独自承担全部解释。",
    `现在是${guidance.name}（${guidance.range}），${guidance.letterAdvice} 这不是为问题作答，只是先给此刻留一点可以呼吸和观察的距离。`,
    "等你下次再说起它，我们再看原来的词有没有变化，旁边有没有多出另一句话。问题被好好看见，答案会慢慢浮出来。",
  ].join("\n\n");
}

function localFallback(
  input: PersonalizeEmotionDailyReferenceInput,
  reason: string
): PersonalizeEmotionDailyReferenceResult {
  const guidance = currentTimeContext(input);
  const storedSummary = cleanLetter(input.baseDailyReference.summary);
  const summary =
    REPORT_TONE_PATTERN.test(storedSummary) ||
    INTERPRETIVE_OVERREACH_PATTERN.test(storedSummary)
      ? safeLocalLetter(input, guidance)
      : includeCurrentTimeAdvice(storedSummary, guidance);
  return {
    dailyReference: {
      ...input.baseDailyReference,
      summary,
      activity: factualActivity(
        input.almanac,
        input.baseDailyReference.activity
      ),
      factSource: hasAlmanacFacts(input.almanac)
        ? input.almanac.sourceLabel
        : "本地农历与纳音",
      interpretationSource: "local-template",
      mindset:
        cleanText(input.baseDailyReference.mindset, 220) || guidance.mindset,
      personalizedYi: mergeAdvice(
        input.baseDailyReference.personalizedYi,
        guidance.recommended
      ),
      personalizedJi: mergeAdvice(
        input.baseDailyReference.personalizedJi,
        guidance.avoid
      ),
      currentShichen: guidance.name,
      letterVersion: EMOTION_DAILY_LETTER_VERSION,
    },
    source: "local-template",
    model: ENV.emotion302Model,
    fallbackReason: reason.slice(0, 500),
  };
}

function systemPrompt() {
  return [
    "你是「聊会儿」的回信人。你认真听用户自愿留下的话，替他们保存其中具体、真实的部分，再把当下和过去之间能确认的变化轻轻指出来。你不是老师、咨询师或算命先生，不提供医疗或心理诊断。",
    "核心规则：问题被好好看见，答案会慢慢浮出来。只呈现用户原话里真实可见的线索、重复、变化和现实背景，不替用户制造一个答案。",
    "不得写“答案是”“你真正想要的是”“你应该”或“你必须”；也不得写“你不是……而是……”“你讨厌的不是……而是……”或“这说明你……”来替换用户自己的感受。不得替用户选择、劝导、定性，也不得把推测包装成结论。用户没有说出的答案，宁可留白。",
    "输入中的 almanacFacts 是唯一可引用的黄历事实；不得补写、改写或猜测未提供的宜忌、吉时、方位、节气、生肖、冲煞。",
    "birthBazi 是历法库按用户自愿填写的公历出生日期和标准时钟时间换算的四柱，只能作为传统时间文化参照；不得据此推断命运、人格定论、健康状况、财运、婚姻或身份属性。",
    "traditionalTimeContext 是服务器根据 birthBazi 与天行当日干支做出的可复核计算，不得自行更改其中的日主、五行、生克关系或颜色集合。",
    "currentShichenContext 是服务器按中国标准时间确定的当下时辰、时间范围和日常节奏参照。它只说明此刻更适合怎样安排动作，不表示吉凶，也不能覆盖用户的现实处境。",
    "生日、出生地、当前所在地和用户留言只用于理解生活阶段、社会角色、关系网络与日常节奏。",
    "文字要温和、具体、克制，承认不确定性，不夸大转折，不替用户下结论。",
    "currentWords 是用户在目标日期写下的原话；previousWords 只包含这一天之前由同一用户留下的文字。两者必须严格区分，旧话不能写成今天刚说的话。",
    "currentWords 已去掉产品自动添加的“接着某天说的……我现在想说”导航句。回信只引用用户真正新写的内容；需要联系旧话时，从 previousWords 取，并标明日期。",
    "先在内部比较 currentWords 与 previousWords：判断它更像过去感受的延续、变化、新出现的关注，还是证据还不够。只有文字本身有清楚证据时，才把这个判断自然写进回信；不得贴心理标签，也不得猜测用户没有说出的动机。",
    "generationIntent 为 daily-letter 时，这是新一天首次登录看到的信：没有当日新话时，可以从最近的 previousWords 里选一条真正相关的旧话继续回应，但必须标明日期，不能假装用户今天刚说过。",
    "generationIntent 为 conversation-reply 时，以 currentWords 为主，最多联系两条确实相关的 previousWords，并用“你在M月D日写过”标明来源；不要翻旧账，不要为了显得懂用户而牵强关联。",
    "summary 是页面唯一展示的主回信。写成 4 到 5 个自然段、380 到 650 个汉字：第一段接住一句最具体的原话，不改写它的情绪；第二段只在有证据时写出它和过去之间的延续或变化；第三段把现实生活里的空间、时间、劳动、钱、关系角色等具体处境轻轻放进来；第四段结合当下时辰给一个很小、可选择的动作；最后留一点未完成的空间。每封信至少保留用户原话里的一个具体名词或动作，不要把“拼豆、面试、猫、某个人”等具体内容概括成空泛的“责任、资源、关系位置”。",
    "面对同一句话可能有不止一种理解时，把两种或三种仍有依据的可能并排放着，并清楚区分“能确定的”和“还不能确定的”。这不是为了罗列选项，而是避免用一个漂亮解释盖住用户复杂、矛盾或尚未说完的感受。",
    "summary 不要标题、列表、编号，也不要按上午/下午/晚上报日程。严禁出现“社会学上”“人类学上”“历史参照上”“按传统时间文化的排法”、日主五行生克公式或字段名；这些只用于你在内部理解，不能直接倒给用户。不要写成分析报告、客服话术或免责声明。",
    "社会结构、人类学日常经验、历史处境与传统时间参照，只有确实能照亮用户这句具体的话时，才能自然融入一句；不要逐项展示知识，不要为了显得专业而堆术语。",
    "避免每封信重复“这不是……”“不拿它……”“这只是一封……”“你可以拿走有用的部分”等自我说明。结尾不要宣布结论，可以停在一个仍值得留意的变化、动作或开放问题上。",
    "穿衣、行动和心态只能作为可选择的今日参照，不能被写成用户问题的答案或解决方案。",
    "写回信时必须结合 currentShichenContext：mindset、personalizedYi、personalizedJi 至少各有一处与当前时辰的 recommended、avoid 或 mindset 保持一致。summary 可以自然提到当前时辰，但不要另造一套时辰吉凶；服务器会确保最终回信带有一条当下时辰建议。",
    "clothing 写一句朴素、可执行的穿衣建议，可以参考季节与传统时间参照，但不能假装知道实时天气，也不能声称颜色或衣服可以改运。",
    "mindset 写一句今天可以保持的心态，必须是允许选择的建议，不写命令和吉凶。",
    "schedule 仍必须正好三项，仅供内部结构化参考，label 依次为上午、下午、晚上；lenses 必须正好三项，label 依次为社会学、人类学、历史参照。",
    "personalizedYi 和 personalizedJi 各写 3 到 5 个不超过 8 个汉字的行动建议。它们是个人今日建议，不是黄历事实；可参考出生时辰、当前时辰和用户留言，但不得宣称命定、吉凶或时辰决定人格。",
    "历史参照只谈普遍的时代经验和生活结构，不虚构具体史实、人物、年份或出处。",
    "只返回严格 JSON，不要 markdown，不要解释。",
    'JSON: {"summary":"中文","clothing":"中文","mindset":"中文","schedule":[{"label":"上午","title":"中文","detail":"中文"},{"label":"下午","title":"中文","detail":"中文"},{"label":"晚上","title":"中文","detail":"中文"}],"lenses":[{"label":"社会学","detail":"中文"},{"label":"人类学","detail":"中文"},{"label":"历史参照","detail":"中文"}],"personalizedYi":["中文"],"personalizedJi":["中文"],"avoid":"中文","note":"中文"}',
  ].join("\n");
}

function userContext(input: PersonalizeEmotionDailyReferenceInput) {
  const { almanac, analysisSeed, baseDailyReference } = input;
  const guidance = currentTimeContext(input);
  const currentMessage = currentWordsFromMessage(analysisSeed.userMessage);
  const previousWords = Array.isArray(analysisSeed.messageHistory)
    ? analysisSeed.messageHistory
        .filter(
          item =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
        .map(item => {
          const record = item as PayloadRecord;
          const saidAt = cleanText(record.saidAt, 40);
          const explicitDate = cleanText(record.dailyLetterDate, 10);
          const inferredDate = /^\d{4}-\d{2}-\d{2}/.test(saidAt)
            ? saidAt.slice(0, 10)
            : "";
          return {
            date: explicitDate || inferredDate,
            text: currentWordsFromMessage(record.text),
            saidAt,
            editedAt: cleanText(record.editedAt, 40),
          };
        })
        .filter(
          item =>
            item.text &&
            item.date !== input.date &&
            (!item.date || item.date < input.date)
        )
        .filter(
          (item, index, items) =>
            items.findIndex(
              candidate =>
                candidate.date === item.date && candidate.text === item.text
            ) === index
        )
        .slice(-12)
    : [];
  return JSON.stringify({
    today: input.date,
    generationIntent: input.generationIntent ?? "conversation-reply",
    almanacFacts: {
      source: almanac.sourceLabel,
      yi: almanac.yi.slice(0, 12),
      ji: almanac.ji.slice(0, 12),
      luckyHours: almanac.luckyHours.slice(0, 12),
      directions: almanac.directions.slice(0, 8),
      meta: almanac.meta,
    },
    userContext: {
      birthDate: cleanText(analysisSeed.birthDate, 10),
      birthTime: cleanText(analysisSeed.birthTime, 5),
      birthShichen: cleanText(analysisSeed.birthShichen, 8),
      birthBazi: cleanText(analysisSeed.birthBazi, 80),
      currentShichen: guidance.name,
      birthPlace: cleanText(analysisSeed.birthPlace, 80),
      currentLocation: cleanText(analysisSeed.currentLocation, 80),
      currentWords: {
        date: input.date,
        text: currentMessage,
      },
      conversationMode:
        analysisSeed.conversationMode === "history" ? "history" : "today",
      previousWords,
      age: typeof analysisSeed.age === "number" ? analysisSeed.age : undefined,
      lifeStage: cleanText(analysisSeed.lifeStage, 180),
      birthSeason: cleanText(analysisSeed.birthSeason, 80),
      cohort: cleanText(analysisSeed.cohort, 120),
    },
    currentShichenContext: guidance,
    traditionalTimeContext: buildTraditionalTimeContext(almanac, analysisSeed),
    existingReference: {
      summary: cleanText(baseDailyReference.summary, 500),
      clothing: cleanText(baseDailyReference.clothing, 160),
      activity: factualActivity(almanac, baseDailyReference.activity),
      schedule: baseDailyReference.schedule,
      lenses: baseDailyReference.lenses,
      avoid: cleanText(baseDailyReference.avoid, 300),
      note: cleanText(baseDailyReference.note, 300),
    },
  });
}

function firstPillar(value: unknown) {
  const match = cleanText(value, 80).match(
    /([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])/
  );
  return match?.[1] ?? "";
}

function birthPillar(value: unknown, position: "年" | "月" | "日" | "时") {
  const text = cleanText(value, 120);
  const suffixMatch = text.match(
    new RegExp(`([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])${position}`)
  );
  if (suffixMatch) return suffixMatch[1];
  const prefixMatch = text.match(
    new RegExp(
      `${position}柱\\s*([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])`
    )
  );
  return prefixMatch?.[1] ?? "";
}

function relationBetween(dayMasterElement: string, todayElement: string) {
  if (!dayMasterElement || !todayElement) return "";
  if (dayMasterElement === todayElement) {
    return `日主${dayMasterElement}与今日天干${todayElement}同类`;
  }
  if (WUXING_SHENG[todayElement] === dayMasterElement) {
    return `今日天干${todayElement}生扶日主${dayMasterElement}`;
  }
  if (WUXING_SHENG[dayMasterElement] === todayElement) {
    return `日主${dayMasterElement}生今日天干${todayElement}`;
  }
  if (WUXING_KE[todayElement] === dayMasterElement) {
    return `今日天干${todayElement}克日主${dayMasterElement}`;
  }
  if (WUXING_KE[dayMasterElement] === todayElement) {
    return `日主${dayMasterElement}克今日天干${todayElement}`;
  }
  return "";
}

export function buildTraditionalTimeContext(
  almanac: AlmanacDay,
  analysisSeed: PayloadRecord
) {
  const birthBazi = cleanText(analysisSeed.birthBazi, 120);
  const birthDayPillar = birthPillar(birthBazi, "日");
  const dayMaster = birthDayPillar.slice(0, 1);
  const dayMasterElement = GAN_WUXING[dayMaster] ?? "";
  const todayDayPillar = firstPillar(almanac.meta.ganzhiDay);
  const todayStem = todayDayPillar.slice(0, 1);
  const todayStemElement = GAN_WUXING[todayStem] ?? "";
  const supportingElement =
    Object.entries(WUXING_SHENG).find(
      ([, generated]) => generated === dayMasterElement
    )?.[0] ?? "";
  const controllingElement =
    Object.entries(WUXING_KE).find(
      ([, controlled]) => controlled === dayMasterElement
    )?.[0] ?? "";

  return {
    basis: "传统时间文化参照，不作为命运或现实决策依据",
    birthPillars: birthBazi,
    birthYearPillar: birthPillar(birthBazi, "年"),
    birthMonthPillar: birthPillar(birthBazi, "月"),
    birthDayPillar,
    birthTimePillar: birthPillar(birthBazi, "时"),
    dayMaster,
    dayMasterElement,
    todayYearPillar: firstPillar(almanac.meta.ganzhiYear),
    todayMonthPillar: firstPillar(almanac.meta.ganzhiMonth),
    todayDayPillar,
    todayStem,
    todayStemElement,
    relation: relationBetween(dayMasterElement, todayStemElement),
    supportingElement,
    controllingElement,
    supportiveColors: [
      ...(WUXING_COLORS[supportingElement] ?? []),
      ...(WUXING_COLORS[dayMasterElement] ?? []),
    ],
    avoidColors: WUXING_COLORS[controllingElement] ?? [],
    tianapiDirections: almanac.directions,
    tianapiYi: almanac.yi,
    tianapiJi: almanac.ji,
  };
}

export async function personalizeEmotionDailyReference302(
  input: PersonalizeEmotionDailyReferenceInput
): Promise<PersonalizeEmotionDailyReferenceResult> {
  if (!hasAlmanacFacts(input.almanac)) {
    return localFallback(input, "天行黄历事实暂不可用");
  }
  if (!ENV.api302Key.trim()) {
    return localFallback(input, "API302_KEY 未配置");
  }
  if (!ENV.emotion302Model.trim()) {
    return localFallback(input, "EMOTION_302_MODEL 未配置");
  }

  const baseUrl = ENV.api302BaseUrl.trim().replace(/\/+$/, "");
  const timeoutValue = Number(ENV.emotion302TimeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutValue) && timeoutValue > 0
      ? Math.floor(timeoutValue)
      : 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetcher = input.fetcher ?? (globalThis.fetch as Fetcher);
  const guidance = currentTimeContext(input);

  try {
    const response = await fetcher(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ENV.api302Key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENV.emotion302Model,
        stream: false,
        temperature: 0.4,
        max_tokens: 1_800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt() },
          {
            role: "user",
            content: `请根据可信黄历事实和用户自愿提供的信息，写一份今日回信：${userContext(input)}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return localFallback(
        input,
        `302 DeepSeek 请求失败 HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`
      );
    }

    let data = (await response.json()) as CompletionResponse;
    let raw = parseJsonLoose<DeepSeekPayload>(completionText(data));
    const firstSummary = cleanLetter(raw.summary);
    const firstQualityIssue = letterQualityIssue(firstSummary);
    if (firstQualityIssue) {
      const retryResponse = await fetcher(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ENV.api302Key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ENV.emotion302Model,
          stream: false,
          temperature: 0.35,
          max_tokens: 1_800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt() },
            {
              role: "user",
              content: `请根据可信黄历事实和用户自愿提供的信息，写一份今日回信：${userContext(input)}`,
            },
            {
              role: "assistant",
              content: JSON.stringify(raw),
            },
            {
              role: "user",
              content: `第一次回信${firstQualityIssue}。请保留用户原话、事实边界和其他 JSON 字段，把 summary 重写为 4 到 5 个自然段、380 到 650 个汉字。不要用“你不是……而是……”“你真正……”或“这说明你……”替用户解释内心；有证据的多种可能要并排保留，并区分能确定与还不能确定的部分。不要增加标题、列表、术语报告或用户没有说过的结论。仍只返回完整 JSON。`,
            },
          ],
        }),
        signal: controller.signal,
      });
      if (retryResponse.ok) {
        const retryData = (await retryResponse.json()) as CompletionResponse;
        const retryRaw = parseJsonLoose<DeepSeekPayload>(
          completionText(retryData)
        );
        const retrySummary = cleanLetter(retryRaw.summary);
        if (completeLetter(retrySummary)) {
          data = retryData;
          raw = retryRaw;
        }
      }
    }
    const selectedSummary = cleanLetter(raw.summary);
    const remainingQualityIssue = letterQualityIssue(selectedSummary);
    if (remainingQualityIssue) {
      return localFallback(input, `302 DeepSeek 回信${remainingQualityIssue}`);
    }
    const summary = includeCurrentTimeAdvice(selectedSummary, guidance);
    const clothing = cleanText(raw.clothing, 180);
    const mindset = cleanText(raw.mindset, 220);
    const avoid = cleanText(raw.avoid, 300);
    const note = cleanText(raw.note, 320);
    if (!summary || !avoid || !note) {
      return localFallback(input, "302 DeepSeek 返回字段不完整");
    }
    if (REPORT_TONE_PATTERN.test(summary)) {
      return localFallback(input, "302 DeepSeek 回信仍带有分析报告腔");
    }

    return {
      dailyReference: {
        ...input.baseDailyReference,
        summary,
        clothing: clothing || cleanText(input.baseDailyReference.clothing, 180),
        mindset:
          mindset || cleanText(input.baseDailyReference.mindset, 220) || avoid,
        activity: factualActivity(
          input.almanac,
          input.baseDailyReference.activity
        ),
        schedule: normalizeSchedule(
          raw.schedule,
          input.baseDailyReference.schedule
        ),
        lenses: normalizeLenses(raw.lenses, input.baseDailyReference.lenses),
        avoid,
        note,
        factSource: input.almanac.sourceLabel,
        interpretationSource: "302-deepseek",
        interpretationModel: data.model || ENV.emotion302Model,
        interpretationGeneratedAt: new Date().toISOString(),
        personalizedYi: mergeAdvice(
          normalizeAdvice(
            raw.personalizedYi,
            input.baseDailyReference.personalizedYi
          ),
          guidance.recommended
        ),
        personalizedJi: mergeAdvice(
          normalizeAdvice(
            raw.personalizedJi,
            input.baseDailyReference.personalizedJi
          ),
          guidance.avoid
        ),
        birthShichen: cleanText(input.analysisSeed.birthShichen, 8),
        currentShichen: guidance.name,
        letterVersion: EMOTION_DAILY_LETTER_VERSION,
      },
      source: "302-deepseek",
      model: data.model || ENV.emotion302Model,
    };
  } catch (error) {
    return localFallback(
      input,
      error instanceof Error ? error.message : "302 DeepSeek 请求失败"
    );
  } finally {
    clearTimeout(timer);
  }
}

export function chinaDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
