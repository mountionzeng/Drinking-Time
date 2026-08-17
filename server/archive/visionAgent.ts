import { ENV } from "../_core/env";
import { invokeLLM, type Message } from "../_core/llm";
import { resolveComputeCandidates } from "../_core/textComputeProvider";
import {
  runInference,
  type InferenceCandidate,
} from "../_core/inferenceOrchestrator";

type VisionAnalyzeParams = {
  imageDataUrl?: string;
  imageUrl?: string;
  fileName?: string;
  brief?: string;
};

export type VisionAnalysisResult = {
  configured: boolean;
  modelLabel: string;
  reply: string;
  card: {
    content: string;
    rawText: string;
  };
  analysis: {
    visualStyle: string[];
    subject: string;
    characters: string[];
    environment: string;
    eraAndCulture: string;
    lighting: string;
    colorPalette: string[];
    composition: string;
    cameraLanguage: string;
    materialsAndTextures: string[];
    mood: string[];
    productionRisks: string[];
    promptDraft: string;
    negativePrompt: string;
    confidence: number;
  };
};

const DEFAULT_ANALYSIS = {
  visualStyle: [],
  subject: "",
  characters: [],
  environment: "",
  eraAndCulture: "",
  lighting: "",
  colorPalette: [],
  composition: "",
  cameraLanguage: "",
  materialsAndTextures: [],
  mood: [],
  productionRisks: [],
  promptDraft: "",
  negativePrompt: "",
  confidence: 0,
};

function shouldUseClaudeChannel(): boolean {
  return Boolean(
    ENV.visionModel?.startsWith("cc-") ||
      ENV.visionApiUrl?.includes("/cc") ||
      ENV.dropZoneModel?.startsWith("cc-") ||
      ENV.dropZoneApiUrl?.includes("/cc")
  );
}

function resolveClaudeUrl(): string {
  const raw = (
    ENV.visionApiUrl ||
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

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("imageDataUrl must be a base64 data URL");
  }
  const mediaType = match[1];
  const data = match[2];
  if (!mediaType.startsWith("image/")) {
    throw new Error("Only image data URLs are supported");
  }
  if (Buffer.byteLength(data, "base64") > 12 * 1024 * 1024) {
    throw new Error("Image is too large; please use an image under 12MB");
  }
  return { mediaType, data };
}

function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("Vision model returned non-JSON response");
    }
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
  }
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 12)
    : [];

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

function normalizeAnalysis(raw: unknown): VisionAnalysisResult["analysis"] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const confidenceRaw = Number(obj.confidence);
  return {
    visualStyle: stringArray(obj.visualStyle),
    subject: stringValue(obj.subject),
    characters: stringArray(obj.characters),
    environment: stringValue(obj.environment),
    eraAndCulture: stringValue(obj.eraAndCulture),
    lighting: stringValue(obj.lighting),
    colorPalette: stringArray(obj.colorPalette),
    composition: stringValue(obj.composition),
    cameraLanguage: stringValue(obj.cameraLanguage),
    materialsAndTextures: stringArray(obj.materialsAndTextures),
    mood: stringArray(obj.mood),
    productionRisks: stringArray(obj.productionRisks),
    promptDraft: stringValue(obj.promptDraft),
    negativePrompt: stringValue(obj.negativePrompt),
    confidence: Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0,
  };
}

function buildSystemPrompt() {
  return [
    "你是 Drinking Time 的影视视觉分析 Agent。",
    "用户会给你一张参考图。你的任务不是简单描述图片，而是把图片翻译成影视美术和 AI 生成可以使用的结构化信息。",
    "请重点识别：美术风格、主体/人物、场景、时代文化线索、光线、色彩、构图、镜头语言、材质纹理、情绪、制作风险、可执行 prompt。",
    "如果输入是手机截图或带平台水印的转载图，必须把水印、可读文字、作者签名、用户名、账号、状态栏、应用界面、页码、播放控件和截图黑边列为 source artifacts / productionRisks；它们不是美术风格，不得进入 visualStyle、composition、materialsAndTextures 或 promptDraft。negativePrompt 必须要求最终画面不出现这些污染层。",
    "参考图的主体、人物、物体、地点和情节可以客观描述，但不得在 promptDraft 中写成必须复制的内容；promptDraft 只保留可泛化的构图、光线、材料、情绪和制作方法。",
    "不要编造看不见的事实。看不清时用“无法确定”或降低 confidence。",
    "请用简体中文输出。必须返回严格 JSON，不要 markdown，不要解释。",
    "JSON 格式如下：",
    "{",
    '  "reply": "给用户看的温和短回复，3-6 行",',
    '  "card": { "content": "可以入册的素材卡片，保留图像的创作价值", "rawText": "用户原始补充或文件名" },',
    '  "analysis": {',
    '    "visualStyle": ["风格关键词"],',
    '    "subject": "主体/画面中心",',
    '    "characters": ["人物或角色线索"],',
    '    "environment": "场景与空间",',
    '    "eraAndCulture": "时代/地域/文化线索；不确定就写无法确定",',
    '    "lighting": "光线方式",',
    '    "colorPalette": ["颜色关键词"],',
    '    "composition": "构图与空间层次",',
    '    "cameraLanguage": "景别/镜头/焦段倾向",',
    '    "materialsAndTextures": ["材质纹理"],',
    '    "mood": ["情绪关键词"],',
    '    "productionRisks": ["缺失信息或制作风险"],',
    '    "promptDraft": "可直接给图像/视频模型的中文提示词",',
    '    "negativePrompt": "负面提示词",',
    '    "confidence": 0.82',
    "  }",
    "}",
  ].join("\n");
}

function extractText(result: {
  choices: Array<{ message: { content: string | Array<{ type?: string; text?: string }> } }>;
}): string {
  const content = result.choices[0]?.message?.content;
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map(part => (part.type === "text" ? (part.text ?? "") : ""))
          .filter(Boolean)
          .join("\n")
      : "";
}

function buildUserText(params: VisionAnalyzeParams) {
  return [
    params.fileName ? `文件名：${params.fileName}` : "",
    params.brief ? `用户补充：${params.brief}` : "",
    "请把这张参考图分析成 Drinking Time 的影视美术模板素材。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function invokeOpenAICompatibleVision(params: VisionAnalyzeParams) {
  if (!ENV.llmSupportsImage) {
    throw new Error(
      "Current LLM_MODEL is configured as text-only. Set LLM_SUPPORTS_IMAGE=true and use a vision-capable model."
    );
  }

  const imageUrl = params.imageDataUrl || params.imageUrl;
  if (!imageUrl) throw new Error("imageDataUrl or imageUrl is required");

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        { type: "text", text: buildUserText(params) },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ],
    },
  ];

  const result = await invokeLLM({
    messages,
    maxTokens: 1800,
    response_format: ENV.llmSupportsResponseFormat
      ? { type: "json_object" }
      : undefined,
  });

  return { text: extractText(result), modelLabel: ENV.llmModel };
}

/**
 * 统一视觉候选链：Next/302 视觉档位打头，配置了的话 Claude Messages 兜底。
 *
 * 这两条原本是各自独立的直连 fetch，且互不回退——Next 视觉瞬时失败时今天
 * 没有任何机会退到 Claude。现在它们进同一条编排链，瞬时失败可以在预算内
 * 跨协议回退到 Claude；两者都没配置时返回 null，交给调用方走 tier-3 的
 * 通用文本模型兜底（该兜底本就通过 invokeLLM 走 orchestrator，无需改动）。
 */
async function invokeUnifiedVisionChannel(
  params: VisionAnalyzeParams
): Promise<{ text: string; modelLabel: string } | null> {
  if (params.imageDataUrl) {
    // 只做格式与体积校验，转换成 image_url 消息内容仍统一走下面的 Message。
    parseImageDataUrl(params.imageDataUrl);
  }
  const imageUrl = params.imageDataUrl || params.imageUrl;
  if (!imageUrl) throw new Error("imageDataUrl or imageUrl is required");

  const chain: InferenceCandidate[] = [];

  for (const candidate of resolveComputeCandidates("vision", {
    fallback302Model: ENV.vision302Model,
    fallback302ApiKey: ENV.vision302ApiKey,
    fallback302BaseUrl: ENV.vision302BaseUrl,
  })) {
    chain.push({ ...candidate, protocol: "openai-compatible" });
  }

  if (shouldUseClaudeChannel()) {
    const endpointUrl = resolveClaudeUrl();
    if (endpointUrl) {
      chain.push({
        id: "302",
        label: "302",
        apiKey: ENV.forgeApiKey,
        baseUrl: endpointUrl,
        chatCompletionsUrl: endpointUrl,
        endpointUrl,
        protocol: "claude-messages",
        model: ENV.visionModel || ENV.dropZoneModel || ENV.llmModel,
      });
    }
  }

  if (chain.length === 0) return null;

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        { type: "text", text: buildUserText(params) },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ],
    },
  ];

  const outcome = await runInference({
    useCase: "vision",
    messages,
    candidates: { fallback302Model: ENV.vision302Model },
    explicitCandidates: chain,
    maxTokens: 1800,
    // 原直连实现两条通道都不下发 response_format，靠 prompt 约定 JSON——
    // 这里保持一致，不引入未经真实网关验证的行为变化。
    // 视觉分析是纯读取，没有工具调用也没有业务写入，可以安全重发。
    replaySafe: true,
    deadlineMs: 45_000,
  });

  return { text: extractText(outcome.result), modelLabel: outcome.result.model || outcome.model };
}

// 视觉模型没吐出合法 JSON 时的兜底（视觉模型经常直接说大白话，而不是严格 JSON）。
// 这里【绝不】把错误抛成 500，而是把模型的自然语言描述原样保留下来当素材，
// 让「喂图 → 入册 → riff」链路继续走得通 —— 和分镜那条线的 buildFallbackShotList 同一套兜底思路。
// 代价：这版分析是空的结构化字段，下游 createArtRiff 已有 `|| 兜底` 默认值，
// 所以 riff 仍能出图（只是偏通用），不会再触发新的报错。
function buildFallbackVisionResult(
  rawText: string,
  modelLabel: string,
  params: VisionAnalyzeParams
): VisionAnalysisResult {
  const cleaned = (rawText ?? "").trim();
  // 模型描述可能很长，截断到 600 字以内，避免塞爆卡片和后续 prompt。
  const snippet = cleaned.length > 600 ? `${cleaned.slice(0, 600)}…` : cleaned;
  return {
    configured: true,
    modelLabel,
    reply:
      snippet ||
      "我看了这张图，但这次没能把它拆成结构化分析。它仍然可以作为视觉参考进入素材池，我们可以继续聊它的风格和情绪。",
    card: {
      content: snippet || "视觉参考素材（自动分析未完全成功）",
      rawText: params.brief || params.fileName || "",
    },
    analysis: { ...DEFAULT_ANALYSIS },
  };
}

export async function analyzeVisionReference(
  params: VisionAnalyzeParams
): Promise<VisionAnalysisResult> {
  if (!params.imageDataUrl && !params.imageUrl) {
    throw new Error("imageDataUrl or imageUrl is required");
  }

  // 判据是「路由能不能解析出候选」，而不是某个历史环境变量——两者都没配置时
  // invokeUnifiedVisionChannel 返回 null，退到 tier-3；tier-3 自己的 ENV.llmSupportsImage
  // 守卫和 invokeLLM 的「无可用文本算力」错误已经能给出清晰、及时的配置报错。
  const unified = await invokeUnifiedVisionChannel(params);
  const { text, modelLabel } =
    unified ?? (await invokeOpenAICompatibleVision(params));

  let parsed: {
    reply?: unknown;
    card?: { content?: unknown; rawText?: unknown };
    analysis?: unknown;
  };
  try {
    parsed = parseJsonLoose<{
      reply?: unknown;
      card?: { content?: unknown; rawText?: unknown };
      analysis?: unknown;
    }>(text);
  } catch (error) {
    // 视觉模型没给合法 JSON（line 131/133 都会抛到这里）→ 降级兜底，不再弹「Vision model returned non-JSON response」。
    console.warn(
      "[visionAgent] 视觉模型未返回合法 JSON，按原始描述降级，不抛错。",
      error
    );
    return buildFallbackVisionResult(text, modelLabel, params);
  }

  const analysis = normalizeAnalysis(parsed.analysis ?? DEFAULT_ANALYSIS);
  const fallbackCard = [
    analysis.subject ? `主体：${analysis.subject}` : "",
    analysis.environment ? `场景：${analysis.environment}` : "",
    analysis.visualStyle.length
      ? `风格：${analysis.visualStyle.join("、")}`
      : "",
    analysis.mood.length ? `情绪：${analysis.mood.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    configured: true,
    modelLabel,
    reply:
      stringValue(parsed.reply) ||
      "我看完这张图了。它可以作为视觉参考进入素材池，下面是可继续拆成镜头和 prompt 的分析。",
    card: {
      content:
        stringValue(parsed.card?.content) || fallbackCard || "视觉参考素材",
      rawText:
        stringValue(parsed.card?.rawText) ||
        params.brief ||
        params.fileName ||
        "",
    },
    analysis,
  };
}
