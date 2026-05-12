import { ENV } from "../_core/env";
import { invokeLLM, type Message } from "../_core/llm";

type VisionAnalyzeParams = {
  imageDataUrl?: string;
  imageUrl?: string;
  fileName?: string;
  brief?: string;
};

type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
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
      ENV.dropZoneApiUrl?.includes("/cc"),
  );
}

function resolveClaudeUrl(): string {
  const raw = (ENV.visionApiUrl || ENV.dropZoneApiUrl || ENV.forgeApiUrl || "").trim();
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
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
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

function buildUserText(params: VisionAnalyzeParams) {
  return [
    params.fileName ? `文件名：${params.fileName}` : "",
    params.brief ? `用户补充：${params.brief}` : "",
    "请把这张参考图分析成 Drinking Time 的影视美术模板素材。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function invokeClaudeVision(params: VisionAnalyzeParams) {
  const apiUrl = resolveClaudeUrl();
  if (!apiUrl) throw new Error("Claude messages endpoint is not configured");
  if (!params.imageDataUrl) {
    throw new Error("Claude vision analysis requires imageDataUrl");
  }

  const image = parseImageDataUrl(params.imageDataUrl);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ENV.forgeApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ENV.visionModel || ENV.dropZoneModel || ENV.llmModel,
      max_tokens: 1800,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildUserText(params) },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.data,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude vision invoke failed: ${response.status} ${body}`);
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
    modelLabel: data.model || ENV.visionModel || ENV.dropZoneModel || ENV.llmModel,
  };
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

  const content = result.choices[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map(part => (part.type === "text" ? part.text : ""))
            .filter(Boolean)
            .join("\n")
        : "";

  return { text, modelLabel: ENV.llmModel };
}

export async function analyzeVisionReference(
  params: VisionAnalyzeParams,
): Promise<VisionAnalysisResult> {
  if (!ENV.forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
  }
  if (!params.imageDataUrl && !params.imageUrl) {
    throw new Error("imageDataUrl or imageUrl is required");
  }

  const { text, modelLabel } = shouldUseClaudeChannel()
    ? await invokeClaudeVision(params)
    : await invokeOpenAICompatibleVision(params);

  const parsed = parseJsonLoose<{
    reply?: unknown;
    card?: { content?: unknown; rawText?: unknown };
    analysis?: unknown;
  }>(text);

  const analysis = normalizeAnalysis(parsed.analysis ?? DEFAULT_ANALYSIS);
  const fallbackCard = [
    analysis.subject ? `主体：${analysis.subject}` : "",
    analysis.environment ? `场景：${analysis.environment}` : "",
    analysis.visualStyle.length ? `风格：${analysis.visualStyle.join("、")}` : "",
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
      content: stringValue(parsed.card?.content) || fallbackCard || "视觉参考素材",
      rawText: stringValue(parsed.card?.rawText) || params.brief || params.fileName || "",
    },
    analysis,
  };
}
