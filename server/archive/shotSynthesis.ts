import { ENV } from "../_core/env";
import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
import { applyShotPromptComposition } from "../services/shotPromptComposer";
import { annotateScriptShotReasons } from "../services/scriptAgent";
import type { ShotBeat, ShotCharacter, ShotEntry, ShotListPayload, StoryCardPayload, VisualAnchorPayload } from "./storyAgent.types";
import type { ArtRecipeDNA } from "../../shared/artDirection";

const VALID_SHOT_TYPES = ["远", "全", "中", "近", "特", "大特"];
const VALID_BEATS: ShotBeat[] = ["开场", "起势", "转折", "收束"];

// ── 创作素材 → 镜头表合成 ──
// 聊天结束后，把全部创作素材交给同一位"导演"做四件事：
// 1. 从素材里识别 1-3 个核心人物（characterHint 提供时优先纳入并设为主视点）
// 2. 给整段故事一句话情感弧线
// 3. 按最有张力的叙事顺序排一遍
// 4. 把每份素材转成一条镜头（1:1 映射，sourceCardContent 原样回填用于回溯）
// 返回 { characters, arc, shots }
type ShotListCardInput = {
  title?: string;
  content: string;
  rawText?: string;
  sourceQuote?: string;
  emotion?: string;
  emotionOptions?: string[];
  emotionBlend?: string[];
  intensity?: number;
  direction?: string;
  complexity?: string;
  trigger?: string;
  dramaticFunction?: string;
  personalTrace?: string;
  retrievalQuery?: string;
  themeHints?: string[];
  outlierSignal?: string;
  softMembership?: string[];
};

type ShotListIntentInput = {
  purpose?: string;
  audience?: string;
  platform?: string;
  tone?: string | null;
  desiredEffect?: string | null;
  targetRole?: string | null;
  channel?: string | null;
};

type GenerationProfileInput = {
  scriptStyle?: {
    id?: string;
    label?: string;
    logline?: string;
    arc?: string;
    treatment?: string;
  } | null;
  artStyle?: {
    id?: string;
    source?: "preset" | "library";
    title?: string;
    description?: string | null;
    recipe?: Partial<ArtRecipeDNA> | null;
    libraryVersionId?: number | null;
    items?: Array<{
      dimension?: string;
      content?: string;
      negativeContent?: string | null;
    }>;
  } | null;
};

type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
};

type OpenAICompatibleMessageResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function hasScriptStructureAgentConfig(): boolean {
  return Boolean(ENV.scriptStructureAgentApiKey?.trim());
}

function shouldUseScriptStructureClaudeChannel(): boolean {
  return Boolean(
    ENV.scriptStructureAgentModel?.startsWith("cc-") ||
      ENV.scriptStructureAgentApiUrl?.includes("/cc")
  );
}

function resolveScriptStructureClaudeUrl(): string {
  const raw = (
    ENV.scriptStructureAgentApiUrl ||
    ENV.dropZoneApiUrl ||
    ENV.forgeApiUrl ||
    ""
  ).trim();
  if (!raw) return "";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/cc")) return `${normalized}/v1/messages`;
  return normalized;
}

function resolveScriptStructureChatUrl(): string {
  const raw = (ENV.scriptStructureAgentApiUrl || ENV.forgeApiUrl || "").trim();
  if (!raw) return "https://forge.manus.im/v1/chat/completions";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function textFromMessageContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content.type === "text") return content.text;
    return JSON.stringify(content);
  }
  return content
    .map(part => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      return JSON.stringify(part);
    })
    .join("\n");
}

function textFromLLMContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(part => (part.type === "text" ? part.text || "" : ""))
    .filter(Boolean)
    .join("\n");
}

async function invokeScriptStructureClaudeMessages(
  messages: Message[],
  maxTokens: number
): Promise<{ text: string; modelLabel: string }> {
  const apiUrl = resolveScriptStructureClaudeUrl();
  const apiKey = ENV.scriptStructureAgentApiKey?.trim();
  if (!apiUrl) throw new Error("SCRIPT_STRUCTURE_AGENT_API_URL is not configured");
  if (!apiKey) throw new Error("SCRIPT_STRUCTURE_AGENT_API_KEY is not configured");

  const system = messages
    .filter(message => message.role === "system")
    .map(message => textFromMessageContent(message.content))
    .join("\n\n");
  const anthropicMessages = messages
    .filter(message => message.role !== "system")
    .map(message => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: textFromMessageContent(message.content),
    }));

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:
        ENV.scriptStructureAgentModel ||
        ENV.dropZoneModel ||
        ENV.llmModel,
      max_tokens: maxTokens,
      system,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Script structure agent invoke failed: ${response.status} ${body}`
    );
  }

  const data = (await response.json()) as ClaudeMessageResponse;
  const text =
    data.content
      ?.filter(block => block.type === "text" && block.text)
      .map(block => block.text)
      .join("\n")
      .trim() || "";

  return {
    text,
    modelLabel:
      data.model ||
      ENV.scriptStructureAgentModel ||
      ENV.dropZoneModel ||
      ENV.llmModel,
  };
}

async function invokeScriptStructureOpenAICompatible(
  messages: Message[],
  maxTokens: number
): Promise<{ text: string; modelLabel: string }> {
  const apiKey = ENV.scriptStructureAgentApiKey?.trim();
  if (!apiKey) throw new Error("SCRIPT_STRUCTURE_AGENT_API_KEY is not configured");
  const model = ENV.scriptStructureAgentModel || ENV.llmModel;
  const payload: Record<string, unknown> = {
    model,
    messages: messages.map(message => ({
      role: message.role,
      content: textFromMessageContent(message.content),
    })),
    max_tokens: maxTokens,
  };
  if (ENV.llmSupportsResponseFormat) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(resolveScriptStructureChatUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Script structure agent invoke failed: ${response.status} ${body}`
    );
  }

  const data = (await response.json()) as OpenAICompatibleMessageResponse;
  const text = textFromLLMContent(data.choices?.[0]?.message?.content).trim();
  return { text, modelLabel: data.model || model };
}

async function invokeScriptStructureAgent(
  messages: Message[],
  maxTokens: number
): Promise<{ text: string; modelLabel: string }> {
  if (!hasScriptStructureAgentConfig()) {
    return invokeAgent(messages, maxTokens);
  }
  if (shouldUseScriptStructureClaudeChannel()) {
    return invokeScriptStructureClaudeMessages(messages, maxTokens);
  }
  return invokeScriptStructureOpenAICompatible(messages, maxTokens);
}

function cleanList(values: unknown, limit = 8): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map(value => cleanText(value))
    .filter(Boolean)
    .slice(0, limit);
}

function formatGenerationProfile(profile?: GenerationProfileInput): string {
  if (!profile) return "";
  const lines: string[] = [];
  const script = profile.scriptStyle;
  if (script) {
    const parts = [
      cleanText(script.label) ? `选择：${cleanText(script.label)}` : "",
      cleanText(script.arc) ? `弧线：${cleanText(script.arc)}` : "",
      cleanText(script.logline) ? `一句话：${cleanText(script.logline)}` : "",
      cleanText(script.treatment) ? `处理方式：${cleanText(script.treatment)}` : "",
    ].filter(Boolean);
    if (parts.length) lines.push(`剧本风格：${parts.join("；")}`);
  }
  const art = profile.artStyle;
  if (art) {
    const recipe = art.recipe ?? {};
    const recipeParts = [
      cleanList(recipe.style).length ? `风格=${cleanList(recipe.style).join(" / ")}` : "",
      cleanList(recipe.palette).length ? `色彩=${cleanList(recipe.palette).join(" / ")}` : "",
      cleanList(recipe.light).length ? `光线=${cleanList(recipe.light).join(" / ")}` : "",
      cleanList(recipe.composition).length ? `构图=${cleanList(recipe.composition).join(" / ")}` : "",
      cleanList(recipe.material).length ? `材质=${cleanList(recipe.material).join(" / ")}` : "",
      cleanList(recipe.negative).length ? `避免=${cleanList(recipe.negative).join(" / ")}` : "",
    ].filter(Boolean);
    const itemParts = (art.items ?? [])
      .map(item => {
        const dimension = cleanText(item.dimension);
        const content = cleanText(item.content);
        if (!dimension || !content) return "";
        return `${dimension}=${content}`;
      })
      .filter(Boolean)
      .slice(0, 7);
    const artParts = [
      cleanText(art.title) ? `选择：${cleanText(art.title)}` : "",
      cleanText(art.description) ? `说明：${cleanText(art.description)}` : "",
      ...recipeParts,
      ...itemParts,
    ].filter(Boolean);
    if (artParts.length) lines.push(`美术风格：${artParts.join("；")}`);
  }
  return lines.length
    ? ["【生成设置 · 用户在 Story Cards 生成前选择】", ...lines].join("\n")
    : "";
}

function artStyleRefFromProfile(profile?: GenerationProfileInput): string {
  const art = profile?.artStyle;
  if (!art) return "";
  const recipe = art.recipe ?? {};
  const tokens = [
    cleanText(art.title),
    ...cleanList(recipe.style, 3),
    ...cleanList(recipe.palette, 2),
    ...cleanList(recipe.light, 2),
    ...(art.items ?? [])
      .filter(item => /style|palette|lighting|composition|recipe/i.test(cleanText(item.dimension)))
      .map(item => cleanText(item.content))
      .filter(Boolean)
      .slice(0, 4),
  ].filter(Boolean);
  return tokens.slice(0, 8).join(", ");
}

function isJobSearchIntent(
  intent: ShotListIntentInput | null | undefined,
  resonanceContext?: string,
): boolean {
  return (
    intent?.purpose === "linkedin_job_search" ||
    /用途=linkedin_job_search/.test(resonanceContext ?? "")
  );
}

function isFictionIntent(
  intent: ShotListIntentInput | null | undefined,
  resonanceContext?: string,
): boolean {
  return intent?.purpose === "fiction" || /用途=fiction/.test(resonanceContext ?? "");
}

function jobTargetRole(intent?: ShotListIntentInput | null): string {
  return cleanText(intent?.targetRole) || "目标岗位";
}

function jobAudience(intent?: ShotListIntentInput | null): string {
  const audience = cleanText(intent?.audience);
  if (audience === "recruiters") return "招聘者";
  return audience || "招聘者";
}

function cardTitle(card: ShotListCardInput, index: number): string {
  return cleanText(card.title) || cleanText(card.personalTrace) || `优势 ${index + 1}`;
}

function cardEvidence(card: ShotListCardInput): string {
  return (
    cleanText(card.sourceQuote) ||
    cleanText(card.rawText) ||
    cleanText(card.content) ||
    "还缺少可验证证据"
  );
}

function inferJobStrength(card: ShotListCardInput, targetRole: string, index: number): string {
  const titledStrength = cleanText(card.title);
  if (titledStrength) return titledStrength.slice(0, 16);
  const text = `${cardTitle(card, index)} ${card.content} ${targetRole}`;
  if (/跨学科|技术.*艺术|艺术.*技术|影视|特效|计算机|CS/i.test(text)) {
    return "跨学科转译能力";
  }
  if (/AIGC|产品|PM|定义产品|方向/i.test(text)) {
    return "产品方向判断";
  }
  if (/流程|运作|系统|标准|判断|抽象/i.test(text)) {
    return "系统化理解";
  }
  if (/结果|说服|交付|作品|展示/i.test(text)) {
    return "结果导向表达";
  }
  if (/验证|试错|需求|想法|访谈/i.test(text)) {
    return "低成本验证";
  }
  return cardTitle(card, index);
}

function jobRoleConcern(targetRole: string, strength: string): string {
  if (/AIGC|产品|PM/i.test(targetRole)) {
    return `${targetRole} 关心候选人能否把技术可能性、用户需求和商业落点转成可验证的产品判断`;
  }
  return `${targetRole} 关心候选人的优势是否真实、可验证，并能在外部工作场景里产生价值`;
}

function jobDialogueLine(
  card: ShotListCardInput | undefined,
  targetRole: string,
  index: number,
): string {
  const quote = cleanText(card?.sourceQuote) || cleanText(card?.rawText);
  if (quote) return quote.slice(0, 42);
  const strength = card
    ? inferJobStrength(card, targetRole, index)
    : "可验证能力";
  return `我能把${strength}落到${targetRole}真正关心的问题上`;
}

function findCardForShot(
  cards: ShotListCardInput[],
  shot: Pick<ShotEntry, "shotNo" | "sourceCardContent">,
): ShotListCardInput | undefined {
  const source = cleanText(shot.sourceCardContent);
  if (source) {
    const exact = cards.find(card => cleanText(card.content) === source);
    if (exact) return exact;
  }
  return cards[shot.shotNo - 1];
}

function buildJobSearchFallbackShotList(
  cards: ShotListCardInput[],
  characterHint: string,
  modelLabel: string,
  resonanceContext?: string,
  confirmedIntent?: ShotListIntentInput | null,
): ShotListPayload {
  const targetRole = jobTargetRole(confirmedIntent);
  const audience = jobAudience(confirmedIntent);
  const characters: ShotCharacter[] = [
    {
      name: characterHint || "候选人",
      role: "求职短片主视点",
      oneLiner: `面向${audience}证明自己的人`,
    },
  ];
  const total = cards.length;
  const shots: ShotEntry[] = cards.map((card, index) => {
    const strength = inferJobStrength(card, targetRole, index);
    const evidence = cardEvidence(card);
    const roleConcern = jobRoleConcern(targetRole, strength);
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const beat: ShotBeat = isFirst ? "开场" : isLast ? "收束" : index === 1 ? "转折" : "起势";
    const action =
      beat === "开场"
        ? `把${targetRole}关心的问题摆上桌面`
        : beat === "收束"
          ? `把${strength}落到一次值得联系的机会`
          : `用真实材料证明${strength}`;

    return {
      shotNo: index + 1,
      subject: strength.slice(0, 16),
      action,
      dialogue: jobDialogueLine(card, targetRole, index),
      shotType: isFirst ? "全" : isLast ? "近" : "中",
      beat,
      cameraAngle: "",
      cameraMove: "",
      location: isFirst ? "作品整理桌" : "项目复盘现场",
      timeLight: "",
      mood: beat === "转折" ? "清晰有压力" : "可信、克制",
      sound: "",
      styleRef: "",
      note: "模型未返回有效 JSON，系统按求职卡片自动整理的兜底镜头。",
      emotion: beat === "收束" ? "值得联系" : "可信",
      intent: `证明给${audience}：${strength}能回应${targetRole}的真实岗位关切。`,
      rationale: `岗位关切：${roleConcern}；这张卡的证据是「${evidence.slice(0, 80)}」。画面要把优势、证据和外部价值连起来，而不是拍成泛泛情绪。`,
      sourceCardContent: card.content,
    };
  });
  const arc = `岗位关切 → 优势证据 → 值得联系`;
  const composedShots = annotateScriptShotReasons(
    applyShotPromptComposition(shots, { arc }),
    { resonanceContext },
  );

  return {
    configured: true,
    modelLabel,
    characters,
    logline: `用优势证据证明${targetRole}竞争力`,
    theme: "优势必须被看见并被相信",
    arc,
    variants: [
      {
        mode: "克制版",
        logline: "像作品集短片一样证明能力",
        arc: "岗位关切到可信证据",
        treatment: "少煽情，多拍可验证材料、工作现场和判断过程。",
      },
      {
        mode: "戏剧版",
        logline: "把抽象优势拍成一次决策压力",
        arc: "问题压力到判断成立",
        treatment: "用一个关键选择承重，让优势在压力里发生作用。",
      },
      {
        mode: "诗意版",
        logline: "用工作痕迹串起候选人的能力轮廓",
        arc: "零散材料到清晰定位",
        treatment: "用作品、草图、白板和手部动作做连贯意象。",
      },
    ],
    boringCheck: {
      hasConflict: cards.length > 1,
      hasTurn: cards.length > 1,
      hasWish: true,
      hasCost: cards.some(card => /难|卡|必须|转型|压力|抽象|需求/.test(card.content)),
      hasChange: cards.length > 1,
      note: "求职片张力来自岗位关切、优势证据和外部价值之间是否能闭合；证据不足的卡片应继续追问。",
    },
    shots: composedShots,
  };
}

function fictionStoryCore(cards: ShotListCardInput[]): string {
  return cleanText(cards[0]?.title) || cleanText(cards[0]?.content).slice(0, 30) || "一个新世界";
}

function fictionVisualTone(cards: ShotListCardInput[], intent?: ShotListIntentInput | null): string {
  return (
    cleanText(intent?.tone) ||
    cards.flatMap(card => card.themeHints ?? []).find(Boolean) ||
    cleanText(cards[0]?.emotion) ||
    "有电影感的虚构气质"
  );
}

function buildFictionFallbackShotList(
  cards: ShotListCardInput[],
  characterHint: string,
  modelLabel: string,
  resonanceContext?: string,
  confirmedIntent?: ShotListIntentInput | null,
): ShotListPayload {
  const core = fictionStoryCore(cards);
  const first = cards[0];
  const last = cards[cards.length - 1] ?? first;
  const protagonist =
    characterHint ||
    cleanText(first?.personalTrace) ||
    cleanText(first?.direction) ||
    "主角";
  const obstacle =
    cleanText(first?.dramaticFunction) ||
    cleanText(last?.dramaticFunction) ||
    cleanText(first?.complexity) ||
    "这个世界里突然出现的阻碍";
  const worldRule =
    cleanText(first?.trigger) ||
    cleanText(first?.retrievalQuery) ||
    cleanText(first?.content).slice(0, 36) ||
    "世界规则开始显形";
  const visualTone = fictionVisualTone(cards, confirmedIntent);
  const sourceFor = (index: number) => cards[Math.min(index, Math.max(cards.length - 1, 0))]?.content ?? "";
  const desiredCount = Math.min(5, Math.max(4, cards.length + 2));
  const templates: Array<{
    beat: ShotBeat;
    subject: string;
    action: string;
    dialogue: string;
    shotType: string;
    location: string;
    mood: string;
    emotion: string;
    sourceCardContent: string;
  }> = [
    {
      beat: "开场",
      subject: core,
      action: `建立「${core}」的世界规则`,
      dialogue: cleanText(first?.sourceQuote),
      shotType: "远",
      location: cleanText(first?.trigger) || "故事发生的入口",
      mood: visualTone.slice(0, 16),
      emotion: cleanText(first?.emotion) || "奇异",
      sourceCardContent: sourceFor(0),
    },
    {
      beat: "起势",
      subject: protagonist,
      action: `${protagonist}第一次被这条规则推着行动`,
      dialogue: cleanText(first?.rawText).slice(0, 42),
      shotType: "中",
      location: cleanText(first?.direction) || "主角所在的空间",
      mood: "规则逼近",
      emotion: "被召唤",
      sourceCardContent: sourceFor(0),
    },
    {
      beat: "转折",
      subject: obstacle.slice(0, 16),
      action: `阻碍显形，迫使主角做选择`,
      dialogue: cleanText(last?.sourceQuote),
      shotType: "近",
      location: cleanText(last?.trigger) || "冲突发生处",
      mood: "压力升起",
      emotion: "拉扯",
      sourceCardContent: sourceFor(1),
    },
    {
      beat: "收束",
      subject: protagonist,
      action: `留下「${core}」改变后的余味`,
      dialogue: "",
      shotType: "近",
      location: "回到世界的余光里",
      mood: "留白",
      emotion: "余味",
      sourceCardContent: sourceFor(cards.length - 1),
    },
    {
      beat: "起势",
      subject: cleanText(last?.personalTrace) || "关键物件",
      action: `把视觉风格落到一个可拍的具体物件`,
      dialogue: "",
      shotType: "特",
      location: cleanText(last?.direction) || "世界的细节处",
      mood: visualTone.slice(0, 16),
      emotion: cleanText(last?.emotion) || "凝住",
      sourceCardContent: sourceFor(cards.length - 1),
    },
  ];
  const selected = desiredCount === 5
    ? [templates[0], templates[1], templates[4], templates[2], templates[3]]
    : templates.slice(0, 4);
  const shots: ShotEntry[] = selected.map((template, index) => ({
    shotNo: index + 1,
    subject: template.subject.slice(0, 16),
    action: template.action.slice(0, 60),
    dialogue: template.dialogue,
    shotType: template.shotType,
    beat: index === 0 ? "开场" : index === selected.length - 1 ? "收束" : template.beat,
    cameraAngle: "",
    cameraMove: "",
    location: template.location.slice(0, 20),
    timeLight: "",
    mood: template.mood.slice(0, 24),
    sound: "",
    styleRef: "",
    note: "模型未返回有效 JSON，系统按虚构故事卡自动整理的兜底镜头。",
    emotion: template.emotion,
    intent: `服务虚构短片：让「${core}」的世界规则、主角欲望和冲突更清楚。`,
    rationale: `这一镜来自已确认故事卡；画面要推进世界、人物和冲突，让虚构短片在可拍的动作里成立。`,
    sourceCardContent: template.sourceCardContent,
  }));
  const arc = `世界规则显形 → 主角被推动 → 冲突迫近 → 留下余味`;
  const composedShots = annotateScriptShotReasons(
    applyShotPromptComposition(shots, { arc }),
    { resonanceContext },
  );

  return {
    configured: true,
    modelLabel,
    characters: [
      {
        name: protagonist,
        role: "虚构短片主视点",
        oneLiner: `被${core}改变的人`,
      },
    ],
    logline: `${core}里，${protagonist}必须面对一条新规则`,
    theme: cleanText(confirmedIntent?.desiredEffect).slice(0, 30) || "虚构世界里的选择与余味",
    arc,
    variants: [
      {
        mode: "克制版",
        logline: "让世界规则悄悄显形",
        arc: "观察到选择",
        treatment: "少解释，多用空间、物件和动作显示规则。",
      },
      {
        mode: "戏剧版",
        logline: "把主角推到必须选择的一刻",
        arc: "规则到冲突",
        treatment: "强化阻碍和代价，让转折更明确。",
      },
      {
        mode: "诗意版",
        logline: "用一个奇异意象串起短片",
        arc: "意象到余味",
        treatment: "保留怪味和留白，让世界像梦一样成立。",
      },
    ],
    boringCheck: {
      hasConflict: true,
      hasTurn: true,
      hasWish: true,
      hasCost: cards.some(card => /阻碍|冲突|代价|必须|不能|失去|选择/.test(card.content)),
      hasChange: true,
      note: "虚构短片张力来自世界规则、主角欲望和阻碍是否在 3-5 镜内闭合。",
    },
    shots: composedShots,
  };
}

function buildFallbackShotList(
  cards: ShotListCardInput[],
  characterHint: string,
  modelLabel: string,
  resonanceContext?: string,
  confirmedIntent?: ShotListIntentInput | null,
): ShotListPayload {
  if (isJobSearchIntent(confirmedIntent, resonanceContext)) {
    return buildJobSearchFallbackShotList(
      cards,
      characterHint,
      modelLabel,
      resonanceContext,
      confirmedIntent,
    );
  }
  if (isFictionIntent(confirmedIntent, resonanceContext)) {
    return buildFictionFallbackShotList(
      cards,
      characterHint,
      modelLabel,
      resonanceContext,
      confirmedIntent,
    );
  }

  const sorted = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (b.card.intensity ?? 0) - (a.card.intensity ?? 0));
  const turnIndex = cards.length > 2 ? sorted[0]?.index ?? Math.floor(cards.length / 2) : -1;
  const first = cards[0];
  const last = cards[cards.length - 1] ?? first;
  const firstEmotion = first?.emotion || first?.emotionBlend?.[0] || "开始";
  const lastEmotion = last?.emotion || last?.emotionBlend?.[0] || "余味";
  const theme =
    first?.themeHints?.[0] ||
    first?.softMembership?.[0] ||
    last?.themeHints?.[0] ||
    "一段还在成形的私人经验";
  const conflictCount = cards.filter(card =>
    ["冲突", "转折", "关系裂缝", "阻碍", "逃避"].some(token =>
      [card.dramaticFunction, card.complexity, card.direction].join(" ").includes(token),
    ),
  ).length;

  const characters: ShotCharacter[] = characterHint
    ? [{ name: characterHint, role: "主视点", oneLiner: "故事最在意的人" }]
    : [];

  const shots: ShotEntry[] = cards.map((card, index) => {
    const isFirst = index === 0;
    const isLast = index === cards.length - 1;
    const beat: ShotBeat = isFirst
      ? "开场"
      : isLast
        ? "收束"
        : index === turnIndex
          ? "转折"
          : "起势";
    const shotType = isFirst ? "远" : isLast ? "近" : index === turnIndex ? "特" : "中";
    const subject =
      card.personalTrace ||
      card.trigger ||
      card.direction ||
      characterHint ||
      "这个人";
    const mood = [
      card.emotion,
      ...(card.emotionBlend ?? []),
      typeof card.intensity === "number" ? `浓度${card.intensity}` : "",
    ]
      .filter(Boolean)
      .slice(0, 2)
      .join(" / ");

    return {
      shotNo: index + 1,
      subject: subject.slice(0, 16),
      action: card.content.slice(0, 60) || "停在一个还没说完的时刻",
      dialogue: card.sourceQuote || "",
      shotType,
      beat,
      cameraAngle: "",
      cameraMove: "",
      location: "",
      timeLight: "",
      mood: mood.slice(0, 24),
      sound: "",
      styleRef: "",
      note: "模型未返回有效 JSON，系统按卡片自动整理的兜底镜头。",
      emotion: card.emotion || card.emotionBlend?.[0] || "未标",
      sourceCardContent: card.content,
    };
  });
  const arc = `${firstEmotion} → ${conflictCount ? "摩擦" : "停顿"} → ${lastEmotion}`;
  const composedShots = annotateScriptShotReasons(
    applyShotPromptComposition(shots, { arc }),
    { resonanceContext },
  );

  return {
    configured: true,
    modelLabel,
    characters,
    logline: cards.length > 1 ? `一个人从${firstEmotion}走向${lastEmotion}` : first?.content?.slice(0, 30) || "一段故事开始出现",
    theme: theme.slice(0, 30),
    arc,
    variants: [
      {
        mode: "克制版",
        logline: "让素材按日常顺序慢慢显影",
        arc: `${firstEmotion}到${lastEmotion}`,
        treatment: "少解释，多保留用户原话和动作，让情绪自己浮出来。",
      },
      {
        mode: "戏剧版",
        logline: "把最强情绪样本推到转折点",
        arc: `${firstEmotion}被推向一次明显转向`,
        treatment: "用最高浓度的卡片承担转折，但不补用户没说过的大事实。",
      },
      {
        mode: "诗意版",
        logline: "用重复的物和身体感受串起故事",
        arc: `从轻微感受落到${lastEmotion}`,
        treatment: "用空镜、停顿和原话碎片做连接，保留留白。",
      },
    ],
    boringCheck: {
      hasConflict: conflictCount > 0,
      hasTurn: turnIndex >= 0,
      hasWish: cards.some(card => Boolean(card.trigger || card.direction)),
      hasCost: cards.some(card => (card.intensity ?? 0) >= 0.65),
      hasChange: firstEmotion !== lastEmotion,
      note: conflictCount
        ? "已有可用的摩擦点，后续可以继续追问代价和变化。"
        : "当前素材偏平，建议继续追问愿望、阻碍、代价或一次具体转向。",
    },
    shots: composedShots,
  };
}

export async function synthesizeShotList(params: {
  cards: ShotListCardInput[];
  characterHint?: string;
  visualAnchors?: VisualAnchorPayload[];
  confirmedIntent?: ShotListIntentInput | null;
  generationProfile?: GenerationProfileInput | null;
  /** 共鸣上下文（用户意图 / 情绪 + 文学声音）。缺省时合成行为与之前完全一致。 */
  resonanceContext?: string;
}): Promise<ShotListPayload | { error: string; configured: boolean; modelLabel: string }> {
  if (!ENV.forgeApiKey && !hasScriptStructureAgentConfig()) {
    return {
      error:
        "本地未配置 LLM API Key，无法整理创作素材。请配置 BUILT_IN_FORGE_API_KEY 或 SCRIPT_STRUCTURE_AGENT_API_KEY。",
      configured: false,
      modelLabel: "未配置 API",
    };
  }

  if (params.cards.length === 0) {
    return {
      error: "还没有任何创作素材可以整理。",
      configured: true,
      modelLabel: ENV.llmModel,
    };
  }

  const cardsText = params.cards
    .map((c, i) => {
      const meta = [
        c.title ? `卡片标题：${c.title}` : "",
        c.emotion ? `主情绪：${c.emotion}` : "",
        Array.isArray(c.emotionBlend) && c.emotionBlend.length
          ? `混合：${c.emotionBlend.join(" / ")}`
          : "",
        typeof c.intensity === "number" ? `浓度：${c.intensity}` : "",
        c.direction ? `方向：${c.direction}` : "",
        c.complexity ? `复杂度：${c.complexity}` : "",
        c.trigger ? `触发物：${c.trigger}` : "",
        c.dramaticFunction ? `戏剧功能：${c.dramaticFunction}` : "",
        c.personalTrace ? `个人痕迹：${c.personalTrace}` : "",
        c.retrievalQuery ? `检索线索(kNN)：${c.retrievalQuery}` : "",
        Array.isArray(c.themeHints) && c.themeHints.length
          ? `主题线索(聚类)：${c.themeHints.join(" / ")}`
          : "",
        c.outlierSignal ? `异常点(outlier)：${c.outlierSignal}` : "",
        Array.isArray(c.softMembership) && c.softMembership.length
          ? `多主题归属(GMM)：${c.softMembership.join(" / ")}`
          : "",
      ].filter(Boolean);
      return [
        `[${i + 1}] ${c.title ? `${c.title}：` : ""}${c.content}`,
        c.rawText ? `    原话：${c.rawText}` : "",
        c.sourceQuote ? `    原话锚点：${c.sourceQuote}` : "",
        meta.length ? `    情绪样本：${meta.join("；")}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const characterHint = params.characterHint?.trim() || "";
  const isJobSearch = isJobSearchIntent(params.confirmedIntent, params.resonanceContext);
  const isFiction = isFictionIntent(params.confirmedIntent, params.resonanceContext);
  const targetRole = jobTargetRole(params.confirmedIntent);
  const audience = jobAudience(params.confirmedIntent);
  const desiredEffect = cleanText(params.confirmedIntent?.desiredEffect);
  const generationProfileText = formatGenerationProfile(params.generationProfile ?? undefined);
  const generationArtStyleRef = artStyleRefFromProfile(params.generationProfile ?? undefined);
  const visualAnchors = Array.isArray(params.visualAnchors)
    ? params.visualAnchors.slice(0, 6)
    : [];
  const visualAnchorText = visualAnchors.length
    ? visualAnchors
        .map((anchor, i) => {
          const meta = [
            anchor.objective ? `客观：${anchor.objective}` : "",
            anchor.aesthetic ? `美术/情绪：${anchor.aesthetic}` : "",
            Array.isArray(anchor.visualStyle) && anchor.visualStyle.length
              ? `风格：${anchor.visualStyle.join(" / ")}`
              : "",
            Array.isArray(anchor.mood) && anchor.mood.length
              ? `情绪：${anchor.mood.join(" / ")}`
              : "",
            Array.isArray(anchor.colorPalette) && anchor.colorPalette.length
              ? `色彩：${anchor.colorPalette.join(" / ")}`
              : "",
            anchor.prompt ? `提示词锚：${anchor.prompt.slice(0, 240)}` : "",
          ].filter(Boolean);
          return [`[V${i + 1}] ${anchor.title}`, ...meta.map(line => `    ${line}`)]
            .join("\n");
        })
        .join("\n\n")
    : "";

  const systemPrompt = [
    isJobSearch
      ? "你是一位求职广告片导演：你要把用户的优势卡、证据卡和定位卡，整理成一支能说服招聘者的短篇广告片镜头表。"
      : isFiction
        ? "你是一位虚构短片导演：你要把用户已确认的故事卡，整理成一支 3-5 镜的虚构短片镜头表。"
      : "你还是刚才那个朋友——同时你对画面、镜头、和故事结构都有一点感觉。",
    isJobSearch
      ? `目标观众：${audience}；目标岗位：${targetRole}；${desiredEffect ? `希望效果：${desiredEffect}。` : "希望效果：让观众相信这个人值得联系。" }`
      : isFiction
        ? `虚构短片目标：${desiredEffect || "把一个故事世界拍成短片"}。这些卡片不是简历素材，而是故事核心、人物、冲突和视觉风格。`
      : "对方刚刚跟你聊完一段，他沉淀下来这一组情绪样本——每一份都来自日常对话里的真实反应，不一定是感动，也不一定完整。",
    isJobSearch
      ? "现在请把这些卡片整理成**岗位关切 → 用户能力 → 能力来源 → 作用方式 → 可信证据 → 为什么值得联系 → 外部价值**的视觉论证链。不要拍成泛泛情绪短片；每一镜都要说明它在替用户证明什么。"
      : isFiction
        ? "现在请把已确认故事卡整理成**世界规则 → 主角欲望 → 阻碍/冲突 → 转折选择 → 余味收束**的短片弧线。不要套用求职、简历、JD、招聘者或个人优势证明语言。"
      : "现在请帮他把这些样本整理成一份**可以拍出来的、有完整形状的短片镜头表**。这是只属于他的故事，请保留个人痕迹，不要替他升华、不要加结论；但要让这段故事**有情绪起伏、有矛盾、有转向、有落点**——不是一串同色系的漂亮瞬间。",
    generationProfileText,
    "",
    "请做六件事：",
    '1. 从素材里识别 1-3 个核心人物。每个人物给：name（名字或称呼，如「母亲」）、role（关系/在故事里的位置，如「主视点」、「对照面」）、oneLiner（一句话原型，≤16 字）。',
    characterHint
      ? `   用户已经告诉了你：他最在意的人是「${characterHint}」——请把这个人物放进 characters 列表，并设为主视点。`
      : "",
    "2. 写一句 logline（≤30 字）：用一句话告诉别人这是一个关于什么的故事——偏剧情陈述，能回答「这片子讲什么」。",
    "3. 写一句 theme（≤25 字）：这故事底下没说出口的那层意思是什么——偏意义/感受，不要套用「亲情/成长/和解」之类的大词，要从这一组样本里的个人痕迹提炼。",
    "4. 写一句 arc（≤30 字）：整段故事的情绪曲线——从哪种低浓度状态出发，经过哪种矛盾/阻碍/爆发，到哪种余味落地。",
    "5. 排出**最有张力**的镜头顺序，并给每一镜标一个 beat（开场 / 起势 / 转折 / 收束）：",
    "   - 开场（最多 1-2 镜）：establishing。先把对方放进这个故事的「位置」——可以是地点空镜、一个未解的小动作、一个色调，给观众一个进入点。",
    "   - 起势：事情发生、关系展开。素材里大部分中段时刻都属于这里。",
    "   - 转折：整段最重的一刻，承重那一下。一段故事通常只有 1 个转折，最多 2 个。",
    "   - 收束（1 镜）：落点。可以是一句话、一个空镜、一个回到开场的呼应；不必给「答案」，但要让故事停得下来。",
    ...(isFiction
      ? [
          "6. 把已确认故事卡拆成**3-5 镜虚构短片**，哪怕只有一张故事卡，也要拆出完整短片弧线——",
          "   - 第 1 镜必须建立世界规则或定调画面。",
          "   - 中段镜头必须让主角欲望、阻碍和选择逐步显形。",
          "   - 最后一镜必须收束余味，不要继续扩写成长篇世界观。",
          "   - 全表镜头总数必须在 3-5 镜之间；不要按卡片数 1:1 出一镜。",
          "   - sourceCardContent 优先回填最相关的故事卡 content；纯连接镜可以为空字符串「\"\"」。",
        ]
      : [
          "6. 把每份素材转化成镜头，**并允许你补 1-2 镜连接镜**让这段故事真正成形——",
          "   - 你**可以**在最前补一镜「开场镜」（establishing 或定调空镜），如果原素材里没有自然的开场。",
          "   - 你**可以**在最后补一镜「收束镜」（coda / 留白）让故事有落点，如果原素材里最后一份不足以承担收尾。",
          "   - 这两镜之外的所有镜，必须 1:1 来自原素材，不合并、不拆分、不替对方写他没说过的事。",
          "   - 全表镜头总数 = 原素材数 + 你补的连接镜数（≤2）。",
          "   - 连接镜的 sourceCardContent 必须是空字符串「\"\"」（这样系统知道是你加的）。",
        ]),
    visualAnchorText
      ? [
          "",
          "【视觉锚 · 画布已经定下的感觉】",
          "下面这些视觉锚来自用户上传/AI riff 的图片画布。它们不是孤立灵感角，而是下游镜头出图的风格来源。",
          "使用方式：",
          "- 在每一镜的 mood、location、lighting 语感里吸收这些锚的色彩、光线、质感和情绪。",
          "- styleRef 不再留空：请写一个很短的视觉锚引用，例如「V1 冷绿窗光 / 胶片颗粒」或「V2 暖黄厨房 / 低饱和」。",
          "- 不要把视觉锚里的物件强行塞进所有镜头；只继承风格、光线、情绪、材质。",
          visualAnchorText,
        ].join("\n")
      : "",
    "",
    isJobSearch
      ? [
          "【求职说服链要求】",
          "   - 把卡片当作「优势 + 证据 + 因果解释 + 建议状态」的素材簇，而不是情绪标签。",
          "   - 全片必须回答：岗位关心什么 → 用户有什么能力 → 为什么有这个能力 → 怎么发生作用 → 凭什么相信 → 为什么值得联系 → 带来什么外部价值。",
          "   - 卡片证据不足时，不要硬夸；可以把这一镜设计成「证据缺口」或「需要继续追问」的过渡镜，rationale 里说明原因。",
          "   - 优先拍可验证材料：作品、流程图、原型、项目复盘、白板、简历片段、工具界面、会议讨论、手稿、交付物。不要拍成孤独背影、抽象光影或励志海报。",
          "   - 每一镜的 intent 必须是一句职业主张；rationale 必须解释为什么这个画面能让招聘者更相信他。",
          "",
          "【求职台词 / 字幕 Agent 规则】",
          "   - dialogue 在求职片里不是普通生活对白，而是画面上的字幕/旁白候选词；它要帮助招聘者快速读出候选人的优势。",
          "   - 有 rawText/sourceQuote 且能直接证明能力时，优先短摘原话；如果原话不够清楚，就基于卡片事实写一句 12-28 字的职业主张字幕。",
          "   - 字幕必须连接「候选人优势」和「岗位为什么会在意」；不要写空泛鸡血、自夸口号，也不要把 AI 改写句伪装成用户原话。",
          "   - 求职片除纯连接镜外，dialogue 不要留空。它是给招聘者看的重点信息层。",
        ].join("\n")
      : isFiction
        ? [
            "【虚构短片要求】",
            "   - 不要写成求职片、简历片、作品集包装或真实经历复盘；这是一个虚构故事世界。",
            "   - 每一镜都要承担短片功能：世界规则、人物欲望、阻碍冲突、转折选择、余味收束。",
            "   - 3-5 镜内必须看得到故事核心，不要变成长篇设定百科或概念散文。",
            "   - intent 必须说明这一镜如何推进虚构故事；rationale 必须解释世界规则、人物动机或视觉风格为什么成立。",
            "   - 架构约束：这里只返回镜头表 JSON，不声称生成图片、视频、时间轴或素材库记录。",
          ].join("\n")
        : [
          "【情绪曲线要求】",
          "   - 不要把所有镜头都写成同一种温柔/怀旧/释然。必须主动寻找差异：烦躁、回避、羞耻、羡慕、期待、空掉、欲望、阻碍、关系裂缝、余味。",
          "   - 情绪浓度要有变化：低浓度铺垫 → 中浓度摩擦 → 高浓度转折 → 低浓度余味。不要每一镜都 0.7。",
          "   - 如果原样本都很轻，你可以通过镜头顺序制造起伏，但不要编造用户没说过的大事件。",
          "   - 每个镜头都要尽量保留一个个人痕迹：用户的原词、反复出现的人/物、没说出口的动作、身体反应、回避方式。",
        ].join("\n"),
    "",
    "【固定机制 · 剧本整理】",
    "   - 多版本剧本：额外给出 3 个可选叙事壳：克制版 / 戏剧版 / 诗意版。三版只改变叙事骨架、节奏密度和表达方式，不能改变用户事实。",
    "   - 无聊检测：生成前检查故事有没有冲突、转折、愿望、代价、变化。缺什么就在 boringCheck 里标出来；如果够了，说明张力来自哪里。",
    "   - 真实性保护：绝不自行补重大事实和重大创伤。用户没有说的疾病、死亡、暴力、背叛、家庭破裂、重大灾难，都不能写进剧本。连接镜只能补气氛、空间、动作或留白。",
    isJobSearch
      ? "   - 原话追溯：关键原话优先来自 rawText 或 sourceQuote；AI 可写求职字幕/旁白，但不要加引号伪装成用户原话。"
      : "   - 原话追溯：关键台词优先来自 rawText 或 sourceQuote；不要把 AI 写的漂亮句子伪装成用户说过的话。",
    "",
    "【Module 10 · 记忆整理能力】",
    "   - kNN / 相似度：如果多张样本的 retrievalQuery 很接近，把它们看作同一段人生线索的回声。",
    "   - Clustering 聚类：themeHints 相近的样本可以组成同一章，如 家庭 / 迁移 / 职业 / 爱情 / 失去 / 自我成长 / 重要人物。",
    "   - DBSCAN / outlier：outlierSignal 不为空的样本不要当垃圾；它可能是最独特、最值得深挖的故事亮点。",
    "   - GMM：softMembership 表明一个样本可以同时属于多个主题。不要硬分一类；真实人生经常是家庭+成长+孤独叠在一起。",
    "   - 生成剧本时，请优先把主题线索和异常点组织成「人物、冲突、变化、结尾」，而不是只按聊天时间顺序平铺。",
    "",
    "【每镜要填的列】",
    "   - subject:   主体，谁/什么在画面里（如「母亲」「空着的椅子」），≤16 字",
    "   - action:    一句话动作或事件（≤30 字），从原素材衍生（连接镜可自拟，但要朴素具象），不替对方解释或升华",
    isJobSearch
      ? "   - dialogue:  求职字幕/旁白候选词；优先原话，但没有原话时也要基于证据写一句职业主张；纯连接镜可空"
      : "   - dialogue:  台词；原话里有有重量的一句就原样保留，没有就空字符串；连接镜原则上空",
    "   - shotType:  景别，必须从这 6 个里选一个：远 / 全 / 中 / 近 / 特 / 大特",
    "   - beat:      必须从这 4 个里选一个：开场 / 起势 / 转折 / 收束",
    "   - location:  场景 / 地点，简短具象（如「老屋客厅，下午」），≤20 字",
    "   - mood:      氛围 · 色调，一句话描述整镜情绪/色调（如「冷调，带一点湿意」「灰雾」），≤16 字",
    "   - emotion:   1-4 字的情感词（如「清醒」「笃定」「松弛」「烦躁」「羡慕」「失重」「愧疚」「松开了」），不预设类别，避免全是同一种词。理性、有边界感的表达给力量型词，不要归为'防御'",
    "   - intent:    这一镜承担的叙事/求职意图。求职片里必须写成职业主张，如「证明用户能把抽象需求转成可验证产品判断」。",
    "   - rationale: 为什么这样拍能成立。求职片里必须说明岗位关切、卡片证据和外部价值如何被这张画面连起来。",
    "",
    "【请严格留空的列（输出空字符串，不要编造）】",
    "   - cameraAngle: 机位（平视/俯/仰…）—— 留空",
    "   - cameraMove:  运镜（静止/推/拉/摇/移/跟…）—— 留空",
    "   - timeLight:   时间·光 —— 留空",
    "   - sound:       音 —— 留空",
    visualAnchorText
      ? "   - styleRef:    风格参考 —— 必须引用视觉锚的风格/色彩/光线，简短写入"
      : generationArtStyleRef
        ? `   - styleRef:    风格参考 —— 必须继承用户选择的美术风格：${generationArtStyleRef}`
        : "   - styleRef:    风格参考 —— 留空",
    "   - note:        技术备注 —— 留空",
    "",
    "【还要回填的辅助列】",
    "   - sourceCardContent: 原素材的 content 字段，原样回填一字不差。**只有连接镜（你自己加的开场/收束）才允许此字段为空字符串**。",
    "",
    "【返回格式：严格 JSON，绝不附加任何额外文字、不要包 markdown 代码块】",
    "{",
    '  "characters": [',
    '    { "name": "...", "role": "...", "oneLiner": "..." }',
    "  ],",
    '  "logline": "一句话故事 pitch（剧情）",',
    '  "theme": "底下没说出口的那层意思（意义）",',
    '  "arc": "一句话情感走向（感受）",',
    '  "variants": [',
    '    { "mode": "克制版", "logline": "更日常、更留白的版本", "arc": "情绪走向", "treatment": "这个版本怎么拍，≤60 字" },',
    '    { "mode": "戏剧版", "logline": "冲突更明确的版本", "arc": "情绪走向", "treatment": "这个版本怎么拍，≤60 字" },',
    '    { "mode": "诗意版", "logline": "意象更强的版本", "arc": "情绪走向", "treatment": "这个版本怎么拍，≤60 字" }',
    "  ],",
    '  "boringCheck": {',
    '    "hasConflict": true,',
    '    "hasTurn": true,',
    '    "hasWish": true,',
    '    "hasCost": true,',
    '    "hasChange": true,',
    '    "note": "如果故事还平，指出缺少什么；如果够了，说明张力来自哪里，≤60 字"',
    "  },",
    '  "shots": [',
    "    {",
    '      "shotNo": 1,',
    '      "subject": "...",',
    '      "action": "...",',
    '      "dialogue": "",',
    '      "shotType": "远",',
    '      "beat": "开场",',
    '      "location": "...",',
    '      "mood": "...",',
    '      "emotion": "...",',
    '      "intent": "...",',
    '      "rationale": "...",',
    '      "cameraAngle": "",',
    '      "cameraMove": "",',
    '      "timeLight": "",',
    '      "sound": "",',
    '      "styleRef": "",',
    '      "note": "",',
    '      "sourceCardContent": ""  // 这是你自己补的开场连接镜，所以留空',
    "    }",
    "  ]",
    "}",
    "",
    "shotNo 从 1 开始连续编号，与你建议的叙事顺序一致。",
    "全表必须有且只有 1 镜「开场」beat（在最前），有且只有 1 镜「收束」beat（在最后）。中间的镜头按节奏分布在「起势」和「转折」之间。",
    "请优先生成多样的、带有用户个人痕迹的剧本，不要生成泛泛的情绪散文。",
    "用简体中文。",
  ]
    .filter(line => line !== "")
    .join("\n");

  const { text, modelLabel } = await invokeScriptStructureAgent(
    [
      { role: "system", content: systemPrompt },
      ...(params.resonanceContext
        ? [
            {
              role: "system" as const,
              content: `共鸣参照（用户意图 / 情绪 + 文学声音，仅作呼应，不要照抄）：\n${params.resonanceContext}`,
            },
          ]
        : []),
      { role: "user", content: cardsText },
    ],
    2200,
  );

  try {
    const parsed = parseJsonLoose<{
      characters?: Array<{ name?: unknown; role?: unknown; oneLiner?: unknown }>;
      arc?: unknown;
      logline?: unknown;
      theme?: unknown;
      variants?: Array<{
        mode?: unknown;
        logline?: unknown;
        arc?: unknown;
        treatment?: unknown;
      }>;
      boringCheck?: {
        hasConflict?: unknown;
        hasTurn?: unknown;
        hasWish?: unknown;
        hasCost?: unknown;
        hasChange?: unknown;
        note?: unknown;
      };
      shots?: Array<{
        shotNo?: unknown;
        subject?: unknown;
        shotType?: unknown;
        beat?: unknown;
        action?: unknown;
        dialogue?: unknown;
        cameraAngle?: unknown;
        cameraMove?: unknown;
        location?: unknown;
        timeLight?: unknown;
        mood?: unknown;
        sound?: unknown;
        styleRef?: unknown;
        note?: unknown;
        emotion?: unknown;
        intent?: unknown;
        rationale?: unknown;
        sourceCardContent?: unknown;
      }>;
    }>(text);

    if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
      // 模型返回了合法 JSON 但 shots 为空 → 跟下面 catch 一样走 buildFallbackShotList 降级，
      // 【绝不】把「整理失败」错误弹给用户（这正是用户踩到的 live bug：救命的兜底零件造好了却没装上）。
      console.warn("[storyAgent] 模型返回的 shots 为空，按卡片降级出兜底分镜");
      return buildFallbackShotList(
        params.cards,
        characterHint,
        modelLabel,
        params.resonanceContext,
        params.confirmedIntent,
      );
    }

    const characters: ShotCharacter[] = Array.isArray(parsed.characters)
      ? parsed.characters
          .filter(c => c && typeof c === "object")
          .map(c => ({
            name: typeof c.name === "string" ? c.name.trim() : "",
            role: typeof c.role === "string" ? c.role.trim() : "",
            oneLiner: typeof c.oneLiner === "string" ? c.oneLiner.trim() : "",
          }))
          .filter(c => c.name.length > 0)
          .slice(0, 3)
      : [];

    const asString = (v: unknown): string =>
      typeof v === "string" ? v.trim() : "";
    const asBool = (v: unknown): boolean => v === true;

    const variantModes = ["克制版", "戏剧版", "诗意版"] as const;
    const variants = variantModes.map(mode => {
      const raw = Array.isArray(parsed.variants)
        ? parsed.variants.find(item => item && item.mode === mode)
        : undefined;
      return {
        mode,
        logline: asString(raw?.logline),
        arc: asString(raw?.arc),
        treatment: asString(raw?.treatment),
      };
    });

    const boringCheck = {
      hasConflict: asBool(parsed.boringCheck?.hasConflict),
      hasTurn: asBool(parsed.boringCheck?.hasTurn),
      hasWish: asBool(parsed.boringCheck?.hasWish),
      hasCost: asBool(parsed.boringCheck?.hasCost),
      hasChange: asBool(parsed.boringCheck?.hasChange),
      note: asString(parsed.boringCheck?.note),
    };

    const shots: ShotEntry[] = parsed.shots
      .filter(s => s && typeof s === "object")
      .map((s, i) => {
        const shotTypeRaw = asString(s.shotType);
        const shotType = VALID_SHOT_TYPES.includes(shotTypeRaw)
          ? shotTypeRaw
          : "中";
        const beatRaw = asString(s.beat) as ShotBeat;
        const beat: ShotBeat = VALID_BEATS.includes(beatRaw)
          ? beatRaw
          : "起势"; // 模型没标的话先一律算「起势」，下面再做开场/收束兜底
        return {
          shotNo: typeof s.shotNo === "number" ? s.shotNo : i + 1,
          subject: asString(s.subject),
          action: asString(s.action),
          dialogue: asString(s.dialogue),
          shotType,
          beat,
          cameraAngle: asString(s.cameraAngle),
          cameraMove: asString(s.cameraMove),
          location: asString(s.location),
          timeLight: asString(s.timeLight),
          mood: asString(s.mood),
          sound: asString(s.sound),
          styleRef: asString(s.styleRef),
          note: asString(s.note),
          emotion: asString(s.emotion) || "未标",
          intent: asString(s.intent) || null,
          rationale: asString(s.rationale) || null,
          sourceCardContent: asString(s.sourceCardContent),
        };
      })
      .filter(s => s.action.length > 0)
      .sort((a, b) => a.shotNo - b.shotNo)
      // 重新连续编号，避免模型给出 1,2,4 这种空洞
      .map((s, i) => ({ ...s, shotNo: i + 1 }))
      .map((shot, index) => {
        if (!isJobSearch || cleanText(shot.dialogue)) return shot;
        const card = findCardForShot(params.cards, shot);
        if (!card && !cleanText(shot.sourceCardContent)) return shot;
        return {
          ...shot,
          dialogue: jobDialogueLine(card, targetRole, index),
        };
      });

    if (shots.length === 0) {
      // 模型给的镜头全缺 action、被过滤光了 → 同样降级兜底，不弹错。
      console.warn("[storyAgent] 模型镜头全缺 action，按卡片降级出兜底分镜");
      return buildFallbackShotList(
        params.cards,
        characterHint,
        modelLabel,
        params.resonanceContext,
        params.confirmedIntent,
      );
    }

    if (isFiction && (shots.length < 3 || shots.length > 5)) {
      console.warn("[storyAgent] fiction 镜头数不在 3-5，按虚构故事卡降级出兜底分镜");
      return buildFallbackShotList(
        params.cards,
        characterHint,
        modelLabel,
        params.resonanceContext,
        params.confirmedIntent,
      );
    }

    // ── beat 兜底 ──
    // 模型可能没乖乖标 beat。规则：
    //   · 第一镜如果不是「开场」，强制改成「开场」（这一镜会担起 establishing 责任）
    //   · 最后一镜如果不是「收束」，强制改成「收束」
    //   · 中间所有不是「转折」的，统一保持「起势」
    //   · 模型自己标的「转折」保持不动
    if (shots.length > 0) {
      shots[0].beat = "开场";
      shots[shots.length - 1].beat = "收束";
    }

    const arc = typeof parsed.arc === "string" ? parsed.arc.trim() : "";
    const styledShots = generationArtStyleRef
      ? shots.map(shot => ({
          ...shot,
          styleRef: cleanText(shot.styleRef)
            ? `${shot.styleRef} / ${generationArtStyleRef}`
            : generationArtStyleRef,
        }))
      : shots;
    const composedShots = annotateScriptShotReasons(
      applyShotPromptComposition(styledShots, {
        arc,
        visualAnchors,
      }),
      { resonanceContext: params.resonanceContext },
    );

    return {
      configured: true,
      modelLabel,
      characters,
      shots: composedShots,
      arc,
      logline: typeof parsed.logline === "string" ? parsed.logline.trim() : "",
      theme: typeof parsed.theme === "string" ? parsed.theme.trim() : "",
      variants,
      boringCheck,
    };
  } catch (error) {
    console.warn("[storyAgent] shot list JSON parse failed; using local fallback.", error);
    return buildFallbackShotList(
      params.cards,
      characterHint,
      modelLabel,
      params.resonanceContext,
      params.confirmedIntent,
    );
  }
}
