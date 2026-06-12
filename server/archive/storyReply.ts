import { ENV } from "../_core/env";
import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
import { getRecentAnnotations } from "../services/editContext";
import { asCleanString, asCleanStringArray, asEmotionOptions, asIntensity } from "./storyAgent.parsing";
import { buildAgentSystemPrompt, formatEditContextBlock, buildCardExtractionPrompt } from "./storyAgent.prompts";
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

// 第一步「回话」拿到的是纯文本。但模型偶尔仍会习惯性地包一层 JSON 或 ``` 代码块 ```，
// 这里做一次温柔的解包：是代码块就剥围栏；像 { "reply": "..." } 就取出 reply；否则原样用。
// 目的：让用户看到的永远是干净的一段话，而不是一串 JSON。
function extractReplyText(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";
  // 剥掉 markdown 代码块围栏（```json ... ``` 或 ``` ... ```）
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  // 如果整段就是一个带 reply 字段的 JSON 对象，把 reply 取出来
  if (text.startsWith("{") && text.includes('"reply"')) {
    try {
      const obj = JSON.parse(text) as { reply?: unknown };
      if (typeof obj.reply === "string" && obj.reply.trim()) {
        return obj.reply.trim();
      }
    } catch {
      // 不是合法 JSON，按原文用就好
    }
  }
  return text;
}

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

  // 给足 token 预算，从源头防截断。
  // gemini-2.5-flash 默认开启 thinking，经 OpenAI 兼容代理（302.ai）时这些推理 token 会算进
  // max_tokens；700 会被推理吃掉大半 → 回话写半句就断、抽取的 16 字段大卡 JSON 配不平括号 →
  // 解析失败、出不了卡。回话这步短，2048 足够（gemini-2.5-flash 输出上限 8192，余量充足）。
  const AGENT_MAX_TOKENS = 2048;
  // 抽取那一步要吐 16 字段大卡，且 gemini-2.5-flash 默认 thinking 会先吃掉一大块预算
  // （实测 2048 时模型已经在认真写卡，但写到 content 就被截断 → JSON 配不平 → 解析失败、丢卡）。
  // 给抽取单独更高的预算，让「推理 + 完整卡」都装得下；回话那步短，仍用 2048 即可。
  const EXTRACTION_MAX_TOKENS = 4096;

  // ── B 改造 · 第一步：回话（robust，纯人话，不背 JSON）──
  let text: string;
  let modelLabel: string;
  try {
    ({ text, modelLabel } = await invokeAgent(messages, AGENT_MAX_TOKENS));
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

  // 用户看到的「回话」：第一步已经拿到，温柔解包成干净的一段话（剥代码块 / 取 reply 字段）。
  const reply = extractReplyText(text);

  // ── B 改造 · 第二步：后台抽取（非致命）──
  // 把同一段对话 + 小酌刚说的回话，交给无人设的「后台分析器」抽出 read / card / toolCalls。
  // 任何失败（调用失败 / 不是合法 JSON）都【不致命】：card=null、read=null、toolCalls=[]，
  // 绝不回头影响上面已经拿到的 reply —— 这正是把「出卡」从「回话」里解耦出来的全部意义。
  let card: StoryCardPayload | null = null;
  let read: HumanityRead | null = null;
  const toolCalls: ToolCall[] = [];
  try {
    const extractionMessages: Message[] = [
      {
        role: "system",
        content: buildCardExtractionPrompt(
          existingCardCount,
          userTurnNumber,
          params.enableImageGen,
          Boolean(params.photoUrl),
        ),
      },
      ...turns,
      { role: "user", content: userContent },   // 对方这一轮（带图时含图）
      { role: "assistant", content: reply },     // 小酌这一轮的回话
      {
        role: "user",
        content:
          "（以上是刚刚的对话。请只针对对方最后这一轮，按系统提示输出严格 JSON：{ read, card" +
          (params.enableImageGen ? ", toolCalls" : "") +
          " }。）",
      },
    ];

    const { text: extractionText } = await invokeAgent(extractionMessages, EXTRACTION_MAX_TOKENS);
    const parsed = parseJsonLoose<{
      card?: Record<string, unknown> | null;
      read?: { trait?: unknown; note?: unknown } | null;
      toolCalls?: Array<{ name?: string; prompt?: string; shotNo?: number }> | null;
    }>(extractionText);

    // 校验 card 形状：只强制 content
    if (
      parsed.card &&
      typeof parsed.card.content === "string" &&
      (parsed.card.content as string).trim().length > 0
    ) {
      const rawTextRaw =
        typeof parsed.card.rawText === "string"
          ? (parsed.card.rawText as string)
          : params.message;
      card = {
        content: (parsed.card.content as string).trim(),
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
  } catch (err) {
    // 抽取这一步失败完全不影响对话：这一轮就当没出卡，reply 照常返回。
    console.warn(
      "[storyAgent] 后台抽取失败，本轮按无卡片降级（不影响回复）：",
      err instanceof Error ? err.message : err,
    );
  }

  // 如果有 generateImage toolCall，说明小酌建议出图
  const suggestImage = toolCalls.some(tc => tc.name === "generateImage");

  return {
    configured: true,
    modelLabel,
    reply: reply || "嗯。",
    card,
    read,
    toolCalls,
    suggestImage,
  };
}

/**
 * 手动点「把这一刻画出来」时，从最近对话现编一条英文出图 prompt。
 * 没有可画内容或模型暂时不可用时返回空串，由路由给出友好提示。
 */
export async function deriveMobileImagePrompt(params: {
  history?: ChatTurn[];
  cardHint?: string;
}): Promise<string> {
  if (!ENV.forgeApiKey) return "";
  const recent = (params.history ?? [])
    .filter(turn => turn.content?.trim())
    .slice(-12);
  if (recent.length === 0 && !params.cardHint?.trim()) return "";

  const systemPrompt = [
    "你是小酌的出图描述师。从对话里挑出最值得定格成一帧画面的瞬间。",
    "写成一行英文出图 prompt，必须包含场景、光线、氛围、人物动作或神态。",
    "风格偏电影感、温暖、写实的情绪影像。",
    "只输出英文 prompt，不要解释、引号、JSON 或中文。",
  ].join("\n");
  const turns: Message[] = recent.map(turn => ({
    role: turn.role,
    content: turn.content.trim(),
  }));
  const request = params.cardHint?.trim()
    ? `重点抓住这一刻：${params.cardHint.trim()}。只回一行英文 prompt。`
    : "把以上对话里最值得画的瞬间写成一行英文 prompt。";

  try {
    const { text } = await invokeAgent(
      [
        { role: "system", content: systemPrompt },
        ...turns,
        { role: "user", content: request },
      ],
      400,
    );
    let prompt = (text ?? "").trim();
    const fence = prompt.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
    if (fence) prompt = fence[1].trim();
    prompt = prompt
      .replace(/^["'「『\s]+|["'」』\s]+$/g, "")
      .split(/\r?\n/)[0]
      .trim();
    return prompt.slice(0, 600);
  } catch (error) {
    console.warn(
      "[deriveMobileImagePrompt] 现编出图 prompt 失败：",
      error instanceof Error ? error.message : error,
    );
    return "";
  }
}
