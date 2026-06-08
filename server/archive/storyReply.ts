import { ENV } from "../_core/env";
import { type Message, type ResponseFormat } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
import { getRecentAnnotations } from "../services/editContext";
import { asCleanString, asCleanStringArray, asEmotionOptions, asIntensity } from "./storyAgent.parsing";
import { buildAgentSystemPrompt, formatEditContextBlock } from "./storyAgent.prompts";
import type { ChatTurn, HumanityRead, HumanityTrait, SimilarStoryCardPayload, ShotDraft, StoryAgentChatResult, StoryCardPayload, ToolCall } from "./storyAgent.types";

const HUMANITY_TRAITS: HumanityTrait[] = [
  "defensive",
  "performing",
  "numb",
  "romantic",
  "reflecting",
  "nostalgic",
  "conflicted",
];

export async function replyFromStoryAgent(params: {
  message: string;
  history?: ChatTurn[];
  existingCardCount?: number;
  summary?: string;
  currentShots?: ShotDraft[];
  similarCards?: SimilarStoryCardPayload[];
  projectId?: number;
  enableImageGen?: boolean;  // 手机端出图开关
  photoUrl?: string;         // 用户上传的照片 URL，传给 LLM 做多模态理解
}): Promise<StoryAgentChatResult> {
  const existingCardCount = params.existingCardCount ?? 0;
  const summary = params.summary?.trim() || "";
  const currentShots = Array.isArray(params.currentShots) ? params.currentShots : [];
  const similarCards = Array.isArray(params.similarCards)
    ? params.similarCards.slice(0, 3)
    : [];

  if (!ENV.forgeApiKey) {
    return {
      configured: false,
      modelLabel: "未配置 API",
      reply:
        "我已经准备好了，但本地还没配 API Key。请在项目根目录配置 .env，至少补上 BUILT_IN_FORGE_API_KEY、BUILT_IN_FORGE_API_URL 和 LLM_MODEL，然后重启 4321 服务。",
      card: null,
      read: null,
      toolCalls: [],
      suggestImage: false,
    };
  }

  const cleanedHistory = (params.history ?? []).filter((t) => t.content?.trim());

  // userTurnNumber = 截至本轮（含本轮），用户一共说了第几次。
  // history 里的 user 条目数 + 1（即将到来的本轮）。
  const userTurnNumber = cleanedHistory.filter((t) => t.role === "user").length + 1;

  const turns: Message[] = cleanedHistory
    .slice(-16)
    .map((t) => ({ role: t.role, content: t.content.trim() }));

  // 拉取最近编辑标注并格式化成上下文；失败时静默降级为空
  let editContextBlock: string | undefined;
  if (params.projectId != null) {
    try {
      const annotations = await getRecentAnnotations(params.projectId, 5);
      editContextBlock = formatEditContextBlock(annotations) || undefined;
    } catch (err) {
      console.error("[storyAgent] Failed to fetch edit annotations:", err);
    }
  }

  // 构建用户消息：如果有照片就用多模态格式（image_url + text）
  const userContent: import("../_core/llm").MessageContent | import("../_core/llm").MessageContent[] =
    params.photoUrl
      ? [
          { type: "image_url" as const, image_url: { url: params.photoUrl, detail: "low" as const } },
          { type: "text" as const, text: params.message.trim() || "帮我看看这张照片" },
        ]
      : params.message.trim();

  const messages: Message[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt(
        existingCardCount,
        userTurnNumber,
        summary,
        currentShots,
        similarCards,
        editContextBlock,
        params.enableImageGen,
        Boolean(params.photoUrl),  // 有照片 → 注入「先看图」指令
      ),
    },
    ...turns,
    { role: "user", content: userContent },
  ];

  // 强壮性①（从源头堵）：在 OpenAI 兼容通道上显式要求结构化 JSON 输出（json_object 模式），
  // 让模型「必须吐合法 JSON」而不是看心情。这正是 visionAgent 带图时已验证可用的写法，
  // 用的也是同一个 ENV.llmSupportsResponseFormat 守卫。Claude 通道不支持该参数会被自动忽略，
  // 由下面的「解析失败重试」兜底。
  const agentResponseFormat: ResponseFormat | undefined = ENV.llmSupportsResponseFormat
    ? { type: "json_object" }
    : undefined;

  // 强壮性③（给足预算，从源头防截断）：一次要吐 read+reply+card(16 字段)+toolCalls 一整坨 JSON，
  // 700 token 会把卡片写一半就截断 → parseJsonLoose 找不到配平的 {} → 解析失败 → 聊天框露出半截 JSON。
  // 给到 2048 让 JSON 能完整收尾（gemini-2.5-flash 输出上限 8192，余量充足）。以后要调，只改这一个常量。
  const AGENT_MAX_TOKENS = 2048;

  let text: string;
  let modelLabel: string;
  try {
    ({ text, modelLabel } = await invokeAgent(messages, AGENT_MAX_TOKENS, agentResponseFormat));
  } catch (err) {
    // 通道层已对临时性错误自动重试；走到这里说明仍然没接上。
    // 不向上抛错——否则前端只会弹一句吞掉真实原因的「Agent 暂时没接上」并断掉对话。
    // 改为优雅兜底：用小酌的口吻说一句「刚刚没接住」，对话不中断；真实原因记进服务端日志供排查。
    console.error("[storyAgent] invokeAgent failed after retries:", err);
    return {
      configured: true,
      modelLabel: "请求失败",
      reply: "嗯……我这边刚刚卡了一下，没接住你说的。能再说一遍吗？",
      card: null,
      read: null,
      toolCalls: [],
      suggestImage: false,
    };
  }

  type ParsedAgentReply = {
    reply: string;
    card: StoryCardPayload | null;
    read?: { trait?: unknown; note?: unknown } | null;
    toolCalls?: Array<{ name?: string; prompt?: string; shotNo?: number }> | null;
  };
  // 退化兜底：拿不到完整 JSON 时，【绝不】把半截 JSON 原样吐给用户——这正是「聊天框出现整坨 JSON」的根因。
  // 三种情况要分清：
  //   ① 截断的 JSON：字段顺序 read→reply→card，截断多发生在最后那块大 card 里，reply 多半已写完，
  //      用正则把 "reply" 字段单独抠出来、把这句话救回来。
  //   ② 模型干脆没出 JSON、直接说了人话（不以 { 或 [ 开头）：整段就是回复，原样保住——绝不丢掉模型的真实发言。
  //   ③ 是 JSON 形态但连 reply 都抠不出：返回空串，交给下面那句通用兜底——【绝不】把这坨 JSON 露给用户。
  const salvageReply = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    // ① 截断 JSON：抠 "reply" 字段
    const m = trimmed.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m && m[1].trim()) {
      try {
        return JSON.parse(`"${m[1]}"`); // 还原 \n、\" 等转义字符
      } catch {
        return m[1];
      }
    }
    // ② 整段就是人话（不是 JSON）：原样当回复
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return trimmed;
    }
    // ③ JSON 形态但抠不出 reply：返回空串走通用兜底，绝不吐 JSON
    return "";
  };
  const fallbackParsed = (raw: string): ParsedAgentReply => ({
    reply: salvageReply(raw) || "嗯，我在听——再多说一点那个时刻，好吗？",
    card: null,
    read: null,
    toolCalls: null,
  });

  let parsed: ParsedAgentReply;
  try {
    parsed = parseJsonLoose<ParsedAgentReply>(text);
  } catch {
    // 强壮性②（兜底救卡）：第一次没拿到 JSON（模型破功、直接说人话）时，不再静默 card=null，
    // 而是把模型自己那段话回灌给它，逼它「只用 JSON 再说一遍」，把卡片救回来。
    // 「能聊天但一直不出卡」就是老逻辑在这里静默吞掉造成的；现在改成可观测（写日志）+ 可恢复（重试）。
    console.warn("[storyAgent] 首轮返回非 JSON，触发一次「只要 JSON」纠正重试");
    try {
      const retryMessages: Message[] = [
        ...messages,
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            "你刚刚没有按约定返回 JSON。请把同样的意思，**只**用结尾约定的那套严格 JSON 重新输出一遍：" +
            "一个 JSON 对象，含 read / reply / card 三个字段；这一轮该记卡就给出 card（不要设成 null）。" +
            "除了这个 JSON，不要任何其它文字、也不要解释。",
        },
      ];
      const retry = await invokeAgent(retryMessages, AGENT_MAX_TOKENS, agentResponseFormat);
      parsed = parseJsonLoose<ParsedAgentReply>(retry.text);
    } catch (retryErr) {
      // 两次都失败：才退化成「纯回复、无卡」——但写日志，绝不再静默吞掉。
      console.error("[storyAgent] JSON 重试仍失败，本轮退化为无卡回复:", retryErr);
      parsed = fallbackParsed(text);
    }
  }

  // 校验 card 形状：只强制 content + rawText
  let card: StoryCardPayload | null = null;
  if (
    parsed.card &&
    typeof parsed.card.content === "string" &&
    parsed.card.content.trim().length > 0
  ) {
    const rawTextRaw =
      typeof parsed.card.rawText === "string"
        ? parsed.card.rawText
        : params.message;
    card = {
      content: parsed.card.content.trim(),
      rawText: rawTextRaw.trim(),
      sourceQuote: asCleanString(parsed.card.sourceQuote),
      emotion: asCleanString(parsed.card.emotion),
      emotionOptions: asEmotionOptions(parsed.card.emotionOptions),
      emotionBlend: asCleanStringArray(parsed.card.emotionBlend),
      intensity: asIntensity(parsed.card.intensity),
      direction: asCleanString(parsed.card.direction),
      complexity: asCleanString(parsed.card.complexity),
      trigger: asCleanString(parsed.card.trigger),
      dramaticFunction: asCleanString(parsed.card.dramaticFunction),
      personalTrace: asCleanString(parsed.card.personalTrace),
      retrievalQuery: asCleanString(parsed.card.retrievalQuery),
      themeHints: asCleanStringArray(parsed.card.themeHints),
      outlierSignal: asCleanString(parsed.card.outlierSignal),
      softMembership: asCleanStringArray(parsed.card.softMembership),
    };
  }

  // 校验 read 形状：trait 必须是 7 个已知 key 之一
  let read: HumanityRead | null = null;
  if (parsed.read && typeof parsed.read === "object") {
    const traitRaw =
      typeof parsed.read.trait === "string"
        ? parsed.read.trait.trim().toLowerCase()
        : "";
    const noteRaw =
      typeof parsed.read.note === "string" ? parsed.read.note.trim() : "";
    if ((HUMANITY_TRAITS as string[]).includes(traitRaw)) {
      read = {
        trait: traitRaw as HumanityTrait,
        note: noteRaw.slice(0, 80), // 硬截断，避免模型话太多溢出
      };
    }
  }

  // 解析 toolCalls（仅在手机端出图模式下有意义）
  const toolCalls: ToolCall[] = [];
  if (params.enableImageGen && Array.isArray(parsed.toolCalls)) {
    for (const tc of parsed.toolCalls) {
      if (tc.name === "generateImage" && typeof tc.prompt === "string" && tc.prompt.trim()) {
        toolCalls.push({
          name: "generateImage",
          prompt: tc.prompt.trim(),
          shotNo: typeof tc.shotNo === "number" ? tc.shotNo : undefined,
        });
      }
    }
  }

  // 如果有 generateImage toolCall，说明小酌建议出图
  const suggestImage = toolCalls.some(tc => tc.name === "generateImage");

  return {
    configured: true,
    modelLabel,
    reply: parsed.reply || "嗯。",
    card,
    read,
    toolCalls,
    suggestImage,
  };
}
