import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { hasStoryAgentCompute, invokeAgent } from "../_core/agentChannel";
import {
  storyIntentProfileFromLegacy,
  type StoryIntentProfile,
} from "../../shared/storyIntentProfile";
import type {
  ChatTurn,
  StoryCardPayload,
  StoryIntentAudience,
  StoryIntentPayload,
  StoryIntentPlatform,
  StoryIntentPurpose,
  StoryIntentResult,
} from "./storyAgent.types";

const VALID_PURPOSES: StoryIntentPurpose[] = [
  "self_reflection",
  "raw_record",
  "personal_memory",
  "social_post",
  "linkedin_job_search",
  "portfolio",
  "gift",
  "relationship_record",
  "fiction",
  "product_intro",
  "creative_expression",
  "exploration",
];

export function recognizedIntentToProfile(
  intent: Pick<
    StoryIntentPayload,
    "purpose" | "audience" | "platform" | "tone" | "desiredEffect" | "primaryPurpose" | "secondaryPurposes" | "coreAudience" | "secondaryAudiences"
  >,
  options: { revision: number; now?: number }
): StoryIntentProfile {
  return storyIntentProfileFromLegacy(
    { ...intent, status: "provisional" },
    {
      revision: options.revision,
      source: "recognition",
      now: options.now,
    }
  )!;
}

const VALID_AUDIENCES: StoryIntentAudience[] = [
  "self",
  "specific_person",
  "friends",
  "public",
  "recruiters",
  "clients",
  "investors",
  "teammates",
  "unknown",
];

const VALID_PLATFORMS: StoryIntentPlatform[] = [
  "unknown",
  "wechat",
  "xiaohongshu",
  "x",
  "instagram",
  "wechat_moments",
  "douyin_tiktok",
  "douyin",
  "bilibili",
  "linkedin",
  "portfolio_site",
  "presentation",
  "private_archive",
];

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.35;
  return Math.max(0, Math.min(1, n));
}

function normalizePurpose(value: unknown): StoryIntentPurpose {
  if (
    typeof value === "string" &&
    VALID_PURPOSES.includes(value as StoryIntentPurpose)
  ) {
    return value as StoryIntentPurpose;
  }
  return "exploration";
}

function normalizeAudience(value: unknown): StoryIntentAudience {
  if (
    typeof value === "string" &&
    VALID_AUDIENCES.includes(value as StoryIntentAudience)
  ) {
    return value as StoryIntentAudience;
  }
  return "unknown";
}

function audienceLabel(audience: StoryIntentAudience): string {
  const labels: Record<StoryIntentAudience, string> = {
    self: "自己",
    specific_person: "某位重要的人",
    friends: "朋友",
    public: "公开观众",
    recruiters: "招聘者",
    clients: "客户",
    investors: "投资人",
    teammates: "团队",
    unknown: "自己",
  };
  return labels[audience];
}

function normalizePlatform(value: unknown): StoryIntentPlatform {
  if (
    typeof value === "string" &&
    VALID_PLATFORMS.includes(value as StoryIntentPlatform)
  ) {
    return value as StoryIntentPlatform;
  }
  return "unknown";
}

type NarrativePurpose =
  | "preserve"
  | "gift"
  | "share"
  | "persuade"
  | "create";

const NARRATIVE_PURPOSES: NarrativePurpose[] = [
  "preserve",
  "gift",
  "share",
  "persuade",
  "create",
];

function normalizeNarrativePurpose(
  value: unknown,
  legacyPurpose: StoryIntentPurpose
): NarrativePurpose {
  if (
    typeof value === "string" &&
    NARRATIVE_PURPOSES.includes(value as NarrativePurpose)
  ) {
    return value as NarrativePurpose;
  }
  if (legacyPurpose === "gift") return "gift";
  if (legacyPurpose === "social_post") return "share";
  if (
    ["linkedin_job_search", "portfolio", "product_intro"].includes(
      legacyPurpose
    )
  ) {
    return "persuade";
  }
  if (["fiction", "creative_expression"].includes(legacyPurpose)) {
    return "create";
  }
  return "preserve";
}

function localIntentFallback(text: string): StoryIntentPayload {
  const normalized = text.toLowerCase();
  const mentionsLinkedIn =
    normalized.includes("linkedin") || text.includes("领英");
  const hasJobSearch =
    text.includes("找工作") ||
    text.includes("求职") ||
    text.includes("招聘") ||
    text.includes("面试") ||
    text.includes("岗位") ||
    text.includes("职业机会");
  const mentionsX = /\bx\b/i.test(normalized) || /twitter|推特/i.test(text);
  const mentionsInstagram =
    normalized.includes("instagram") || /\big\b/i.test(normalized);
  const mentionsMoments =
    text.includes("朋友圈") || normalized.includes("wechat moments");
  const mentionsDouyinTikTok =
    text.includes("抖音") ||
    normalized.includes("douyin") ||
    normalized.includes("tiktok");
  const mentionsXiaohongshu =
    text.includes("小红书") ||
    normalized.includes("rednote") ||
    /\bxhs\b/i.test(normalized);
  const hasFiction =
    text.includes("虚构") ||
    text.includes("另一个世界") ||
    text.includes("编一个故事") ||
    text.includes("编故事") ||
    /(?:我想|想要|希望|帮我)?(?:写|讲|做|创造|生成|设计)(?:一个|一段|一部)?[^。！？\n]{0,48}(?:故事|短片|世界)/.test(
      text
    ) ||
    text.includes("故事世界") ||
    text.includes("小说") ||
    text.includes("童话") ||
    text.includes("科幻") ||
    text.includes("奇幻") ||
    text.includes("世界观") ||
    normalized.includes("fiction") ||
    normalized.includes("fantasy") ||
    normalized.includes("sci-fi") ||
    normalized.includes("story world");
  const hasParentChildStory =
    /父母|爸爸|妈妈|家长|亲子/.test(text) &&
    /孩子|小孩|小朋友|儿童|睡前|讲故事/.test(text);
  const hasFriendsGift =
    /礼物|送给|讲给/.test(text) &&
    /亲友|亲人|家人|朋友|父母|爸爸|妈妈|孩子|伴侣|爱人|同事|闺蜜/.test(text);
  const hasSocialAudience =
    /社交平台|小红书|抖音|视频号|朋友圈|公开发布|陌生人|公开观众/.test(text) ||
    mentionsX ||
    mentionsInstagram ||
    mentionsLinkedIn ||
    mentionsDouyinTikTok;
  const hasPersonalStory =
    /介绍自己|自我介绍|我的经历|个人经历|成长经历|职业经历|我的故事/.test(text);
  const hasSelfReflection =
    /给自己讲|讲给自己|梳理自己|理解自己|看清自己|想明白自己|自己的选择和变化/.test(
      text
    );
  const hasRawRecord =
    /记录再说|先记录|先记下来|先保存|暂时不讲|以后再说|先留着/.test(text);
  const hasPersonalRecord = /记录|留念|保存|回看|回忆|纪念/.test(text);

  if (mentionsLinkedIn && hasJobSearch) {
    return {
      purpose: "linkedin_job_search",
      audience: "recruiters",
      platform: "linkedin",
      desiredEffect: "让招聘者快速看见这个人的能力、判断力和可信度",
      tone: "清晰、专业、有个人温度，但不过度私人化",
      confidence: 0.72,
      evidence: ["文本里出现了 LinkedIn / 领英 / 求职 / 找工作 等信号"],
      missingQuestion:
        "这个短片更想突出你的哪类能力：作品能力、行业经验，还是个人判断力？",
    };
  }

  if (hasFiction) {
    return {
      purpose: "fiction",
      audience: "public",
      platform: "presentation",
      desiredEffect: "把一句虚构灵感发展成一个能拍的短片故事",
      tone: "有世界感、有人物动机、带一点电影气质",
      confidence: 0.72,
      evidence: ["文本里出现了虚构故事 / 另一个世界 / 世界观等信号"],
      missingQuestion:
        "这个世界里最先打动你的，是一个人物、一个场景，还是一个冲突？",
    };
  }

  if (hasParentChildStory || hasFriendsGift) {
    return {
      purpose: "gift",
      audience: "specific_person",
      platform: "private_archive",
      primaryPurpose: "gift",
      secondaryPurposes: hasSocialAudience ? ["share"] : [],
      coreAudience: "某位重要的人",
      secondaryAudiences: hasSocialAudience ? ["公开观众"] : [],
      desiredEffect: "让一位亲友感受到这段故事是专门为他或她准备的",
      tone: "亲切、真诚、有私人细节，不过度煽情",
      confidence: 0.72,
      evidence: ["文本里出现了送给亲友或讲给特定对象的信号"],
      missingQuestion: "你最希望这位亲友从故事里感受到什么？",
    };
  }

  if (hasSocialAudience) {
    const platform: StoryIntentPlatform = mentionsXiaohongshu
      ? "xiaohongshu"
      : mentionsX
        ? "x"
        : mentionsInstagram
          ? "instagram"
          : mentionsLinkedIn
            ? "linkedin"
            : mentionsMoments
              ? "wechat_moments"
              : mentionsDouyinTikTok
                ? "douyin_tiktok"
                : "wechat";
    return {
      purpose: "social_post",
      audience: "public",
      platform,
      primaryPurpose: "share",
      secondaryPurposes: [],
      coreAudience: "公开观众",
      secondaryAudiences: [],
      desiredEffect: "让社交平台上的陌生观众快速理解并愿意看完",
      tone: "清楚、有分享感、对陌生观众友好",
      confidence: 0.72,
      evidence: ["文本里出现了社交平台 / 陌生观众 / 公开发布等信号"],
      missingQuestion: "你希望陌生观众看完后记住哪一句话？",
    };
  }

  if (hasSelfReflection) {
    return {
      purpose: "self_reflection",
      audience: "self",
      platform: "private_archive",
      desiredEffect: "把零散经历讲成一条自己能够理解的内在线索",
      tone: "坦诚、细腻，允许矛盾和未完成",
      confidence: 0.82,
      evidence: ["文本明确表示想讲给自己，或借故事理解自己"],
      missingQuestion: "这段经历里，你最想重新看懂的是哪个选择或变化？",
    };
  }

  if (hasRawRecord || hasPersonalRecord) {
    return {
      purpose: "raw_record",
      audience: "self",
      platform: "private_archive",
      desiredEffect: "先保存事实、原话、动作和感受，不急着补成完整故事",
      tone: "克制、纪实、保留原貌",
      confidence: hasRawRecord ? 0.82 : 0.72,
      evidence: ["文本表示先记录、保存或留待以后再说"],
      missingQuestion: "这段记录里，哪一个原话、动作或画面最不能丢？",
    };
  }

  if (hasPersonalStory) {
    return {
      purpose: "portfolio",
      audience: "public",
      platform: "presentation",
      desiredEffect: "把自己的真实经历整理成一个别人能理解的个人故事",
      tone: "真实、清楚、有个人视角",
      confidence: 0.72,
      evidence: ["文本里出现了介绍自己 / 个人经历 / 我的故事等信号"],
      missingQuestion: "这段经历里最能代表你的选择或变化是什么？",
    };
  }

  return {
    purpose: "exploration",
    audience: "unknown",
    platform: "unknown",
    desiredEffect: "先帮助用户看清这支短片想服务的真实目的",
    tone: "开放、轻量、可继续追问",
    confidence: 0.35,
    evidence: [],
    missingQuestion: "这个小短片最后主要是给自己看，还是给别人看？",
  };
}

function applyDeterministicIntentGuard(
  parsed: Partial<StoryIntentPayload>,
  fallbackText: string
): Partial<StoryIntentPayload> {
  const fallback = localIntentFallback(fallbackText);
  if (fallback.purpose === "exploration") return parsed;

  const parsedPurpose = normalizePurpose(parsed.purpose);
  if (parsedPurpose === fallback.purpose) return parsed;

  return {
    ...parsed,
    purpose: fallback.purpose,
    audience:
      normalizeAudience(parsed.audience) === "unknown"
        ? fallback.audience
        : (parsed.audience ?? fallback.audience),
    platform:
      normalizePlatform(parsed.platform) === "unknown"
        ? fallback.platform
        : (parsed.platform ?? fallback.platform),
    desiredEffect: fallback.desiredEffect,
    tone: fallback.tone,
    confidence: Math.max(
      clampConfidence(parsed.confidence),
      fallback.confidence ?? 0.72
    ),
    evidence: [
      ...cleanStringArray(parsed.evidence),
      ...cleanStringArray(fallback.evidence),
    ].slice(0, 5),
    missingQuestion: fallback.missingQuestion,
  };
}

function formatCardsForIntent(cards?: StoryCardPayload[]): string {
  if (!cards?.length) return "";
  return cards
    .slice(-6)
    .map((card, index) => {
      const emotion = card.emotion ? ` / ${card.emotion}` : "";
      return `${index + 1}. ${card.content}${emotion}`;
    })
    .join("\n");
}

function buildIntentPrompt(params: {
  summary?: string;
  cards?: StoryCardPayload[];
  existingIntent?: StoryIntentPayload | null;
}): string {
  const cardBlock = formatCardsForIntent(params.cards);
  return [
    "你是 Drinking Time 的短片用途识别 Agent。",
    "你的任务不是聊天，也不是写文案，而是判断：用户想拿这支小短片去干嘛。",
    "",
    "只根据用户明确说过的内容、最近对话、已有故事卡片判断；不要为了显得聪明而脑补商业目的。",
    "如果目的还不清楚，purpose 用 exploration，并给出一个最值得问的 missingQuestion。",
    "",
    "当前只按四个一级方向识别：",
    "1. 给自己讲",
    "- self_reflection：借讲述梳理自己的经历、选择、变化与尚未想明白的部分；服务自我理解，不服务外部说服",
    "2. 给别人讲",
    "- portfolio：介绍自己，让别人通过真实经历理解我是谁、在意什么、做过什么",
    "- gift：给亲友的礼物，为一个明确的人保留私人细节和关系温度",
    "- social_post：发在社交平台上，服务公开传播和陌生观众的理解效率",
    "3. 记录再说",
    "- raw_record：先忠实保存事实、原话、动作、时间与感受，不强行补冲突、弧线或结论",
    "4. 创造另外一个世界",
    "- fiction：虚构叙事、人物或故事世界（保持原虚构逻辑）",
    "- exploration：还不确定，正在探索",
    "",
    "求职仍是自然语言可识别的独立意图，但不属于‘给别人讲’按钮展开的三个常用分支。",
    "LinkedIn / 求职 特别规则：",
    "只要用户提到 LinkedIn、领英、找工作、求职、招聘者、面试、个人品牌、职业机会，优先判断为 linkedin_job_search。",
    "这种用途的 audience 通常是 recruiters，platform 通常是 linkedin，tone 应偏清晰、专业、可信、有个人温度，但不要太私密。",
    "",
    "虚构故事 / 创造另一个世界 特别规则：",
    "只要用户明确说想写虚构故事、创造另一个世界、编一个人物/故事世界、小说感、科幻、奇幻、童话、世界观，优先判断为 fiction。",
    "这种用途的 audience 通常是 public 或 self，platform 可用 presentation，tone 应服务人物动机、场景规则和电影感，不要套用求职、简历、招聘者话术。",
    "",
    "架构约束：这里只做用途识别，不生成故事卡、不拆镜、不写素材状态；下游模块必须通过 purpose=fiction 自己决定表现。",
    "",
    params.summary?.trim()
      ? `【已有对话摘要】\n${params.summary.trim()}\n`
      : "",
    cardBlock ? `【已有故事卡片】\n${cardBlock}\n` : "",
    params.existingIntent
      ? `【上一轮用途判断】\n${JSON.stringify(params.existingIntent)}\n`
      : "",
    "返回严格 JSON，不要 markdown，不要解释：",
    "{",
    '  "purpose": "self_reflection | raw_record | gift | social_post | linkedin_job_search | portfolio | fiction | exploration",',
    '  "audience": "self | specific_person | friends | public | recruiters | clients | investors | teammates | unknown",',
    '  "platform": "unknown | wechat | xiaohongshu | x | instagram | linkedin | wechat_moments | douyin_tiktok | douyin | bilibili | portfolio_site | presentation | private_archive",',
    '  "desiredEffect": "用户希望短片对观众产生的效果，≤40字",',
    '  "tone": "适合这个用途的表达气质，≤40字",',
    '  "confidence": 0.0,',
    '  "evidence": ["支撑判断的用户原话或信号，最多5条"],',
    '  "missingQuestion": "如果还需要追问，只问一个最关键的问题；若足够明确，也给一个可选追问",',
    '  "primaryPurpose": "preserve | gift | share | persuade | create",',
    '  "secondaryPurposes": ["可兼顾的用途，最多4个"],',
    '  "coreAudience": "最优先服务的具体人或人群，≤40字",',
    '  "secondaryAudiences": ["还要兼顾的人或人群，最多5个"]',
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeIntent(
  raw: Partial<StoryIntentPayload>,
  fallbackText: string
): StoryIntentPayload {
  const fallback = localIntentFallback(fallbackText);
  const purpose = normalizePurpose(raw.purpose);
  const primaryPurpose = normalizeNarrativePurpose(raw.primaryPurpose, purpose);
  return {
    purpose,
    audience: normalizeAudience(raw.audience),
    platform: normalizePlatform(raw.platform),
    desiredEffect: cleanText(raw.desiredEffect, fallback.desiredEffect).slice(
      0,
      80
    ),
    tone: cleanText(raw.tone, fallback.tone).slice(0, 80),
    confidence: clampConfidence(raw.confidence),
    evidence: cleanStringArray(raw.evidence),
    missingQuestion: cleanText(
      raw.missingQuestion,
      fallback.missingQuestion
    ).slice(0, 120),
    primaryPurpose,
    secondaryPurposes: cleanStringArray(raw.secondaryPurposes)
      .filter((item): item is NarrativePurpose =>
        NARRATIVE_PURPOSES.includes(item as NarrativePurpose)
      )
      .filter(item => item !== primaryPurpose),
    coreAudience: cleanText(
      raw.coreAudience,
      audienceLabel(normalizeAudience(raw.audience))
    ).slice(0, 80),
    secondaryAudiences: cleanStringArray(raw.secondaryAudiences).slice(0, 5),
  };
}

export async function recognizeStoryIntent(params: {
  message: string;
  history?: ChatTurn[];
  summary?: string;
  cards?: StoryCardPayload[];
  existingIntent?: StoryIntentPayload | null;
}): Promise<StoryIntentResult> {
  const latestMessage = params.message.trim();
  const history = (params.history ?? [])
    .filter(turn => turn.content.trim())
    .slice(-10)
    .map(turn => ({ role: turn.role, content: turn.content.trim() }));
  const fallbackText = [
    params.summary,
    ...history.map(turn => turn.content),
    latestMessage,
  ]
    .filter(Boolean)
    .join("\n");

  if (!hasStoryAgentCompute()) {
    return {
      ...localIntentFallback(fallbackText),
      configured: false,
      modelLabel: "未配置 API",
    };
  }

  const messages: Message[] = [
    {
      role: "system",
      content: buildIntentPrompt({
        summary: params.summary,
        cards: params.cards,
        existingIntent: params.existingIntent,
      }),
    },
    ...history,
    { role: "user", content: latestMessage || "帮我判断这个短片的用途" },
  ];

  try {
    const { text, modelLabel } = await invokeAgent(messages, 900);
    const parsed = parseJsonLoose<Partial<StoryIntentPayload>>(text);
    return {
      ...normalizeIntent(
        applyDeterministicIntentGuard(parsed, fallbackText),
        fallbackText
      ),
      configured: true,
      modelLabel,
    };
  } catch (err) {
    console.warn(
      "[storyIntent] 意图识别失败，使用本地兜底：",
      err instanceof Error ? err.message : err
    );
    return {
      ...localIntentFallback(fallbackText),
      configured: true,
      modelLabel: "本地兜底",
    };
  }
}
