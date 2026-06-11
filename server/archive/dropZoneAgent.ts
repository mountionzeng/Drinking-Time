/**
 * Drop Zone Agent（「工坊」）—— Drop Zone 页的对话助手。
 *
 * 对话型 + 意图识别：理解用户意图、识别缺失信息(场景/时间/情绪/机位)、给下一步最小行动，
 * 把模糊的影视想法逐步变成可分析、可拆镜头的材料。会读用户的长期情绪画像(emotionAnalysis)
 * 折进上下文(见 resonanceSignal)，带着情绪底盘去理解。
 *
 * 主接口：replyFromDropZoneAgent({ userId, message, history, projectId?, stageKey? }) → { reply, configured, modelLabel }
 */
import { ENV } from "../_core/env";
import { invokeLLM, type Message } from "../_core/llm";
import {
  getProjectAnalysis,
  getProjectById,
  getProjectReferences,
  getProjectShots,
} from "../db";
import {
  buildResonanceSignalForUser,
  describeResonanceSignal,
} from "../services/resonanceSignal";
import { normalizeTurns } from "../services/agentRuntime";

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

type DropZoneAgentParams = {
  userId: number;
  message: string;
  history?: ChatTurn[];
  projectId?: string;
  stageKey?: string;
};

type DropZoneAgentReply = {
  reply: string;
  configured: boolean;
  modelLabel: string;
};

type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
};

// ── 阶段引导词 ──
// 根据用户当前所在的工作阶段，给 Agent 不同的行为指引
const stageGuidance: Record<string, string> = {
  idea_pool: "当前处在灵感池阶段。优先帮助用户扩写方向、拆出候选镜头、辨认情绪和视觉母题。",
  requirement_pool: "当前处在需求池阶段。优先帮助用户明确客户要求、限制条件、交付边界和缺失素材。",
  structured: "当前处在结构化阶段。优先把信息整理成场景、镜头、层次、用途和执行字段。",
  production_ready: "当前处在可生产阶段。优先输出可执行提示词、镜头参数、负面提示和下一步动作。",
  queued: "当前处在排队阶段。优先解释当前顺位、建议补充资料，并提醒可并行准备的内容。",
  rendered: "当前处在已出图阶段。优先做品鉴、迭代建议和版本对比。",
  blocked: "当前处在阻塞阶段。优先指出阻塞原因，并给出最短恢复路径。",
};

function parseProjectId(projectId?: string): number | null {
  if (!projectId) return null;
  if (/^\d+$/.test(projectId)) return Number(projectId);
  const match = projectId.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

function cleanText(value: string | null | undefined, fallback = "—") {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

// ── 构建项目上下文 ──
// 从数据库读取当前项目的素材、镜头、分析结果，拼成文本给 Agent 参考
async function buildProjectContext(userId: number, rawProjectId?: string) {
  const projectId = parseProjectId(rawProjectId);
  if (!projectId) return null;

  const project = await getProjectById(projectId, userId);
  if (!project) return null;

  const [references, shots, analysis] = await Promise.all([
    getProjectReferences(project.id),
    getProjectShots(project.id),
    getProjectAnalysis(project.id),
  ]);

  const shotPreview = shots
    .slice(0, 6)
    .map(
      shot =>
        `- ${shot.sceneNo} / ${shot.shotNo} · ${shot.status} · ${cleanText(shot.sourceSummary, "未命名镜头")}`,
    )
    .join("\n");

  const refPreview = references
    .slice(0, 5)
    .map(ref => `- ${ref.title} · ${ref.sourceType} · importance ${ref.importance}`)
    .join("\n");

  return [
    `当前项目：${project.name}`,
    `项目截止时间：${project.deadline || "未设置"}`,
    `素材数量：${references.length}`,
    `镜头数量：${shots.length}`,
    `最新模板总结：${cleanText(analysis?.summary, "暂无分析总结")}`,
    refPreview ? `素材样本：\n${refPreview}` : "素材样本：暂无",
    shotPreview ? `镜头样本：\n${shotPreview}` : "镜头样本：暂无",
  ].join("\n");
}

// ── 构建系统提示词 ──
// 定义 Agent 的身份、职责、行为规范
// stageKey 决定当前阶段的额外指引
function buildSystemPrompt(stageKey?: string) {
  const stageNote = stageKey ? stageGuidance[stageKey] ?? "" : "";

  return [
    "你是 Drinking Time 的 DROP ZONE 助手，名字叫“工坊”。",
    "你的职责是陪用户聊天，同时把模糊的影视想法逐步变成可以分析、可以拆镜头、可以继续生产的材料。",
    "请默认使用简体中文，语气专业、温和、像一个很懂影视前期和 AI 工作流的搭档。",
    "不要假装已经渲染、已经训练、已经接入不存在的功能。",
    "优先做这几类事情：",
    "1. 理解用户意图，并复述当前理解。",
    "2. 识别缺失信息，例如场景、时间、情绪、机位、客户限制。",
    "3. 给出下一步最小行动，而不是泛泛而谈。",
    "4. 当用户信息足够时，把内容整理成镜头、提示词、环境模板方向。",
    "5. 如果用户只是情绪表达或挫败感，不要立刻技术化，先接住再推进。",
    "回复尽量控制在 3 到 8 行；需要列表时用短列表，不要长篇大论。",
    stageNote,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── 组装完整的消息列表 ──
// 把 system prompt + 项目上下文 + 历史对话 + 当前用户消息 拼成 LLM 需要的 messages 数组
function buildMessages({
  message,
  history,
  projectContext,
  stageKey,
  resonanceText,
}: {
  message: string;
  history?: ChatTurn[];
  projectContext: string | null;
  stageKey?: string;
  resonanceText?: string;
}): Message[] {
  const turns = normalizeTurns(history, 12);

  const contextBlock = [
    projectContext ? `项目上下文：\n${projectContext}` : "项目上下文：暂无项目数据。",
    stageKey ? `当前界面阶段：${stageKey}` : "",
    resonanceText
      ? `用户意图与情绪画像（来自意图识别 + 长期情绪底盘）：\n${resonanceText}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: buildSystemPrompt(stageKey),
    },
    {
      role: "system",
      content: contextBlock,
    },
    ...turns,
    {
      role: "user",
      content: message.trim(),
    },
  ];
}

function resolveDropZoneUrl() {
  const raw = (ENV.dropZoneApiUrl || ENV.forgeApiUrl || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/cc")) return `${normalized}/v1/messages`;
  return normalized;
}

// ── 调用 Claude Messages API ──
// 当配置了 Claude 专用接口时，走 Anthropic 原生格式而非 OpenAI 格式
async function invokeDropZoneClaudeMessages(messages: Message[]) {
  const apiUrl = resolveDropZoneUrl();
  if (!apiUrl) {
    throw new Error("DROP_ZONE_API_URL is not configured");
  }

  const system = messages
    .filter(message => message.role === "system")
    .map(message => String(message.content))
    .join("\n\n");

  const anthropicMessages = messages
    .filter(message => message.role !== "system")
    .map(message => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content),
    }));

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ENV.forgeApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ENV.dropZoneModel,
      max_tokens: 900,
      system,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude messages invoke failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as ClaudeMessageResponse;
  const reply = data.content
    ?.filter(block => block.type === "text" && block.text)
    .map(block => block.text)
    .join("\n")
    .trim();

  return {
    reply: reply || "我收到了，但这次没有成功组织出有效回复。你可以再换一种说法试一次。",
    modelLabel: data.model || ENV.dropZoneModel,
  };
}

// ── 主入口：DROP ZONE Agent 回复 ──
// 外部调用这个函数来获取 Agent 的回复
// 流程：构建项目上下文 → 组装消息 → 选择 Claude 或 OpenAI 格式调用 → 返回回复
export async function replyFromDropZoneAgent(
  params: DropZoneAgentParams,
): Promise<DropZoneAgentReply> {
  const projectContext = await buildProjectContext(params.userId, params.projectId);

  if (!ENV.forgeApiKey) {
    return {
      configured: false,
      modelLabel: "未配置 API",
      reply:
        "我已经准备好接入真实大模型了，但当前本地还没有配置 API Key。\n请先在项目根目录配置 `.env`，至少补上 `BUILT_IN_FORGE_API_KEY`、`BUILT_IN_FORGE_API_URL` 和 `LLM_MODEL`，然后重启 4321 服务。\n我已经顺手给你写了一份训练文档，里面有完整配置步骤和后续训练路线。",
    };
  }

  // 长期情绪画像（来自 emotionAnalysis）折进上下文，让意图识别带着用户的情绪底盘去理解
  const resonanceText = describeResonanceSignal(
    await buildResonanceSignalForUser(params.userId),
  );

  const messages = buildMessages({
    message: params.message,
    history: params.history,
    projectContext,
    stageKey: params.stageKey,
    resonanceText,
  });

  if (ENV.dropZoneModel?.startsWith("cc-") || ENV.dropZoneApiUrl?.includes("/cc")) {
    const result = await invokeDropZoneClaudeMessages(messages);
    return {
      configured: true,
      modelLabel: result.modelLabel,
      reply: result.reply,
    };
  }

  const llmResult = await invokeLLM({
    messages,
    maxTokens: 900,
  });

  const reply =
    typeof llmResult.choices?.[0]?.message?.content === "string"
      ? llmResult.choices[0].message.content.trim()
      : "";

  return {
    configured: true,
    modelLabel: ENV.llmModel,
    reply: reply || "我收到了，但这次没有成功组织出有效回复。你可以再换一种说法试一次。",
  };
}
