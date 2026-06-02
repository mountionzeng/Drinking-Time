/**
 * Creation Agent — server-side service for the Creation Engine.
 *
 * Receives conversation + project context (cards, script, shots), infers the
 * focus shot, determines when to generate images, and calls imageGen / segmentation.
 */

import { type Message } from "../_core/llm";
import { invokeAgent } from "../_core/agentChannel";
import { parseJsonLoose } from "../_core/llmJson";
import { ENV } from "../_core/env";
import { generateImage, type ImageProvider } from "./imageGen";
import { createGeneratedImage, getImagesByShotNo, type GeneratedImage } from "../db";

// ── Types ──

type ChatTurn = { role: "user" | "assistant"; content: string };

export type ShotContext = {
  shotNo: string;
  subject: string;
  action: string;
  dialogue: string;
  shotType: string;
  mood: string;
  promptDraft?: string;
};

export type CreationAgentInput = {
  message: string;
  history?: ChatTurn[];
  cards?: Array<{ content: string; emotion?: string }>;
  currentScript?: string;
  shots?: ShotContext[];
  currentFocusShotNo?: string;
  projectId: number;
  imageProvider?: ImageProvider;
};

export type GenerateImageToolCall = {
  tool: "generateImage";
  prompt: string;
  shotNo: string;
};

export type UpdateFocusToolCall = {
  tool: "updateFocus";
  shotNo: string;
};

type ToolCall = GenerateImageToolCall | UpdateFocusToolCall;

export type CreationAgentResult = {
  reply: string;
  toolCalls: ToolCall[];
  focusShotNo: string | null;
  generatedImage: {
    imageUrl: string;
    imageKey: string;
    shotNo: string;
    imageId: number;
  } | null;
  configured: boolean;
  modelLabel: string;
};

// ── System prompt ──

function buildSystemPrompt(
  shots: ShotContext[],
  cards: Array<{ content: string; emotion?: string }>,
  currentScript: string,
  currentFocusShotNo: string | null,
): string {
  const shotSummary = shots.length > 0
    ? shots.map(s => `  ${s.shotNo}: ${s.subject} — ${s.action} [${s.shotType}] ${s.mood}`).join("\n")
    : "（尚无镜头）";

  const cardSummary = cards.length > 0
    ? cards.slice(0, 8).map((c, i) => `  ${i + 1}. ${c.content.slice(0, 80)}`).join("\n")
    : "（尚无故事卡片）";

  const scriptSnippet = currentScript
    ? currentScript.slice(0, 600)
    : "（尚无剧本）";

  const focusLine = currentFocusShotNo
    ? `当前焦点镜头: ${currentFocusShotNo}`
    : "当前没有焦点镜头";

  return `你是 Creation Agent，drinking-time 工坊的创作引擎助手。你帮用户把故事变成画面。

## 你的能力
- 解读故事卡片和剧本，讨论镜头的视觉呈现
- 当画面描述足够具体时，自动触发出图
- 推断用户当前在讨论哪个镜头（焦点镜头）

## 当前项目状态

故事卡片:
${cardSummary}

剧本摘要:
${scriptSnippet}

镜头表:
${shotSummary}

${focusLine}

## 出图判断
当用户对某个镜头的画面描述达到以下条件时触发出图：
1. 有明确的主体（谁/什么在画面中）
2. 有场景或氛围描述（光线、色调、环境）
3. 用户表达了"出图"、"生成"、"看看"等意愿，或者描述已经非常具体

## 返回格式
返回 JSON：
{
  "reply": "你的回复文字",
  "toolCalls": [
    // 可选，出图时:
    { "tool": "generateImage", "prompt": "英文出图提示词", "shotNo": "SH01" },
    // 可选，焦点变更时:
    { "tool": "updateFocus", "shotNo": "SH02" }
  ],
  "focusShotNo": "SH01"  // 当前推断的焦点镜头，null 如果无法确定
}

## 规则
- prompt 必须是英文，描述画面内容、构图、光线、氛围
- reply 用中文
- 不要主动讨论技术细节（prompt 工程等），只聊画面
- 如果用户提到某个镜头编号（如"SH03"、"第三镜"），更新焦点
- 没有卡片和剧本时，引导用户先去 Analysis 页面完成故事创作`;
}

// ── Focus inference ──

const SHOT_NO_PATTERN = /SH0?(\d+)|第(\d+)镜|镜头\s*(\d+)/gi;

function inferFocusFromMessage(message: string, existingShots: ShotContext[]): string | null {
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  SHOT_NO_PATTERN.lastIndex = 0;
  while ((m = SHOT_NO_PATTERN.exec(message)) !== null) {
    matches.push(m);
  }
  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1];
  const num = lastMatch[1] || lastMatch[2] || lastMatch[3];
  if (!num) return null;

  const padded = `SH${num.padStart(2, "0")}`;
  if (existingShots.some(s => s.shotNo === padded)) {
    return padded;
  }
  return null;
}

// ── Main function ──

export async function replyFromCreationAgent(
  input: CreationAgentInput,
): Promise<CreationAgentResult> {
  if (!ENV.forgeApiKey) {
    return {
      configured: false,
      modelLabel: "未配置 API",
      reply: "创作引擎已准备就绪，但还没配置 API Key。请在 .env 中补上 BUILT_IN_FORGE_API_KEY 和 BUILT_IN_FORGE_API_URL，然后重启服务。",
      toolCalls: [],
      focusShotNo: null,
      generatedImage: null,
    };
  }

  const shots = input.shots ?? [];
  const cards = input.cards ?? [];
  const currentScript = input.currentScript ?? "";
  const history = (input.history ?? []).filter(t => t.content?.trim());

  // Infer focus from user message first
  const inferredFocus = inferFocusFromMessage(input.message, shots);
  const effectiveFocus = inferredFocus || input.currentFocusShotNo || null;

  const turns: Message[] = history
    .slice(-12)
    .map(t => ({ role: t.role, content: t.content.trim() }));

  const messages: Message[] = [
    {
      role: "system",
      content: buildSystemPrompt(shots, cards, currentScript, effectiveFocus),
    },
    ...turns,
    { role: "user", content: input.message.trim() },
  ];

  const { text, modelLabel } = await invokeAgent(messages, 800);

  // Parse LLM response
  let parsed: {
    reply: string;
    toolCalls?: ToolCall[];
    focusShotNo?: string | null;
  };
  try {
    parsed = parseJsonLoose<typeof parsed>(text);
  } catch {
    parsed = {
      reply: text.trim() || "我们来聊聊画面吧，你想从哪个镜头开始？",
      toolCalls: [],
      focusShotNo: effectiveFocus,
    };
  }

  const reply = parsed.reply || "我们来聊聊画面吧。";
  const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
  const focusShotNo = parsed.focusShotNo || effectiveFocus;

  // Process generateImage tool calls
  let generatedImage: CreationAgentResult["generatedImage"] = null;
  const generateCall = toolCalls.find(
    (tc): tc is GenerateImageToolCall => tc.tool === "generateImage",
  );

  if (generateCall && generateCall.prompt && generateCall.shotNo) {
    const genResult = await generateImage(generateCall.prompt, {
      provider: input.imageProvider,
    });
    if (genResult.status === "ok" && genResult.imageUrl && genResult.imageKey) {
      const dbImage = await createGeneratedImage({
        projectId: input.projectId,
        shotNo: generateCall.shotNo,
        imageKey: genResult.imageKey,
        imageUrl: genResult.imageUrl,
        prompt: generateCall.prompt,
        parentImageId: null,
        isCurrent: true,
        generationType: "generate",
        maskKey: null,
      });
      generatedImage = {
        imageUrl: genResult.imageUrl,
        imageKey: genResult.imageKey,
        shotNo: generateCall.shotNo,
        imageId: dbImage.id,
      };
    }
  }

  return {
    reply,
    toolCalls,
    focusShotNo,
    generatedImage,
    configured: true,
    modelLabel,
  };
}
