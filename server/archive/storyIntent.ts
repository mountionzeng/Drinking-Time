import { ENV } from "../_core/env";
import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
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
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.35;
  return Math.max(0, Math.min(1, n));
}

function normalizePurpose(value: unknown): StoryIntentPurpose {
  if (typeof value === "string" && VALID_PURPOSES.includes(value as StoryIntentPurpose)) {
    return value as StoryIntentPurpose;
  }
  return "exploration";
}

function normalizeAudience(value: unknown): StoryIntentAudience {
  if (typeof value === "string" && VALID_AUDIENCES.includes(value as StoryIntentAudience)) {
    return value as StoryIntentAudience;
  }
  return "unknown";
}

function normalizePlatform(value: unknown): StoryIntentPlatform {
  if (typeof value === "string" && VALID_PLATFORMS.includes(value as StoryIntentPlatform)) {
    return value as StoryIntentPlatform;
  }
  return "unknown";
}

function localIntentFallback(text: string): StoryIntentPayload {
  const normalized = text.toLowerCase();
  const hasLinkedIn =
    normalized.includes("linkedin") ||
    text.includes("领英") ||
    text.includes("找工作") ||
    text.includes("求职") ||
    text.includes("招聘") ||
    text.includes("面试");

  if (hasLinkedIn) {
    return {
      purpose: "linkedin_job_search",
      audience: "recruiters",
      platform: "linkedin",
      desiredEffect: "让招聘者快速看见这个人的能力、判断力和可信度",
      tone: "清晰、专业、有个人温度，但不过度私人化",
      confidence: 0.72,
      evidence: ["文本里出现了 LinkedIn / 领英 / 求职 / 找工作 等信号"],
      missingQuestion: "这个短片更想突出你的哪类能力：作品能力、行业经验，还是个人判断力？",
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
    "可选 purpose：",
    "- personal_memory：给自己留念、整理记忆",
    "- social_post：发朋友圈、小红书、抖音、视频号等社交平台",
    "- linkedin_job_search：放 LinkedIn / 领英上找工作、展示职业能力、吸引招聘者",
    "- portfolio：作品集、个人主页、创作者展示",
    "- gift：送给某个人",
    "- relationship_record：记录一段关系或一个重要的人",
    "- fiction：讲别人的故事 / 虚构叙事（不是你的真实经历，而是编一个故事或人物）",
    "- product_intro：介绍自己的产品（展示 / 打动；面向客户、投资人、大众等，由 audience 区分）",
    "- creative_expression：纯表达、情绪短片、审美实验",
    "- exploration：还不确定，正在探索",
    "",
    "LinkedIn / 求职 特别规则：",
    "只要用户提到 LinkedIn、领英、找工作、求职、招聘者、面试、个人品牌、职业机会，优先判断为 linkedin_job_search。",
    "这种用途的 audience 通常是 recruiters，platform 通常是 linkedin，tone 应偏清晰、专业、可信、有个人温度，但不要太私密。",
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
    '  "purpose": "personal_memory | social_post | linkedin_job_search | portfolio | gift | relationship_record | fiction | product_intro | creative_expression | exploration",',
    '  "audience": "self | specific_person | friends | public | recruiters | clients | investors | teammates | unknown",',
    '  "platform": "unknown | wechat | xiaohongshu | douyin | bilibili | linkedin | portfolio_site | presentation | private_archive",',
    '  "desiredEffect": "用户希望短片对观众产生的效果，≤40字",',
    '  "tone": "适合这个用途的表达气质，≤40字",',
    '  "confidence": 0.0,',
    '  "evidence": ["支撑判断的用户原话或信号，最多5条"],',
    '  "missingQuestion": "如果还需要追问，只问一个最关键的问题；若足够明确，也给一个可选追问"',
    "}",
  ].filter(Boolean).join("\n");
}

function normalizeIntent(raw: Partial<StoryIntentPayload>, fallbackText: string): StoryIntentPayload {
  const fallback = localIntentFallback(fallbackText);
  return {
    purpose: normalizePurpose(raw.purpose),
    audience: normalizeAudience(raw.audience),
    platform: normalizePlatform(raw.platform),
    desiredEffect: cleanText(raw.desiredEffect, fallback.desiredEffect).slice(0, 80),
    tone: cleanText(raw.tone, fallback.tone).slice(0, 80),
    confidence: clampConfidence(raw.confidence),
    evidence: cleanStringArray(raw.evidence),
    missingQuestion: cleanText(raw.missingQuestion, fallback.missingQuestion).slice(0, 120),
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
    .filter((turn) => turn.content.trim())
    .slice(-10)
    .map((turn) => ({ role: turn.role, content: turn.content.trim() }));
  const fallbackText = [params.summary, ...history.map((turn) => turn.content), latestMessage]
    .filter(Boolean)
    .join("\n");

  if (!ENV.forgeApiKey) {
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
      ...normalizeIntent(parsed, fallbackText),
      configured: true,
      modelLabel,
    };
  } catch (err) {
    console.warn(
      "[storyIntent] 意图识别失败，使用本地兜底：",
      err instanceof Error ? err.message : err,
    );
    return {
      ...localIntentFallback(fallbackText),
      configured: true,
      modelLabel: "本地兜底",
    };
  }
}
