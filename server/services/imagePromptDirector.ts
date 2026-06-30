import { ENV } from "../_core/env";
import { parseJsonLoose } from "../_core/llmJson";

export type ImageReferencePurpose =
  | "current-frame"
  | "character"
  | "scene-style";

export type ImagePromptAnalysis = {
  referenceRead: string;
  narrativeIntent: string;
  referenceUse: ImageReferencePurpose;
  mustPreserve: string[];
  allowedChanges: string[];
  compositionPlan: string;
  lightingPlan: string;
  negativePrompt: string;
  confidence: number;
};

export type ImagePromptDirectorResult = {
  prompt: string;
  source: "302-vision" | "deterministic-fallback";
  model: string;
  analysis: ImagePromptAnalysis | null;
  fallbackReason?: string;
};

type DirectImagePromptInput = {
  imageInput: string;
  fallbackPrompt: string;
  referencePurpose: ImageReferencePurpose;
  narrativePrompt: string;
  shotNo?: number;
  storyTitle?: string;
};

type CompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type DirectorPayload = {
  referenceRead?: unknown;
  narrativeIntent?: unknown;
  referenceUse?: unknown;
  mustPreserve?: unknown;
  allowedChanges?: unknown;
  compositionPlan?: unknown;
  lightingPlan?: unknown;
  finalPrompt?: unknown;
  negativePrompt?: unknown;
  confidence?: unknown;
};

const SINGLE_FRAME_CONSTRAINT =
  "Create exactly one cinematic frame; no collage, split screen, storyboard grid, inset image, readable text, captions, UI, logo, or watermark.";

const PURPOSE_CONSTRAINTS: Record<ImageReferencePurpose, string> = {
  "current-frame":
    "Preserve the referenced subject, setting, spatial composition, clothing, and lighting unless the requested change explicitly requires otherwise.",
  character:
    "Preserve only the referenced character's identity, facial features, hairstyle, and clothing; follow the requested scene, pose, lighting, and composition instead of copying the reference background.",
  "scene-style":
    "Preserve the referenced scene's palette, lighting, materials, and visual language; do not copy people or exact composition unless explicitly requested.",
};

function cleanText(value: unknown, max = 1_200): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, max)
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/--[a-z][\w-]*(?:\s+\S+)?/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'「『\s]+|["'」』\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => cleanText(item, 120))
    .filter(Boolean)
    .slice(0, 8);
}

function completionText(data: CompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(part => (part.type === "text" ? part.text ?? "" : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeAnalysis(
  raw: DirectorPayload,
  purpose: ImageReferencePurpose
): ImagePromptAnalysis {
  const confidence = Number(raw.confidence);
  return {
    referenceRead: cleanText(raw.referenceRead, 600),
    narrativeIntent: cleanText(raw.narrativeIntent, 600),
    referenceUse: purpose,
    mustPreserve: stringList(raw.mustPreserve),
    allowedChanges: stringList(raw.allowedChanges),
    compositionPlan: cleanText(raw.compositionPlan, 600),
    lightingPlan: cleanText(raw.lightingPlan, 600),
    negativePrompt: cleanText(raw.negativePrompt, 500),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
}

function compilePrompt(
  raw: DirectorPayload,
  purpose: ImageReferencePurpose
): string {
  const finalPrompt = cleanText(raw.finalPrompt, 1_000);
  const latinLetters = (finalPrompt.match(/[a-z]/gi) ?? []).length;
  if (finalPrompt.length < 24 || latinLetters < 20) return "";
  return [
    finalPrompt.replace(/[.;\s]+$/, "."),
    PURPOSE_CONSTRAINTS[purpose],
    SINGLE_FRAME_CONSTRAINT,
  ].join(" ");
}

function fallback(
  input: DirectImagePromptInput,
  reason: string
): ImagePromptDirectorResult {
  return {
    prompt: input.fallbackPrompt,
    source: "deterministic-fallback",
    model: ENV.imagePrompt302Model,
    analysis: null,
    fallbackReason: reason.slice(0, 500),
  };
}

function systemPrompt(): string {
  return [
    "你是小酌的「图片镜头导演」。你会同时看到一张参考图、参考图用途和镜头叙事要求。",
    "先客观阅读参考图，再判断这一镜需要保留什么、允许改变什么，最后写一条给图像模型使用的英文提示词。",
    "referencePurpose=current-frame 时，参考图是待修改的当前画面；除用户明确要求外，保留人物、场景、空间构图、服装和光线。",
    "referencePurpose=character 时，参考图只用于人物身份、脸、发型和服装连续性；不要复制参考图背景、姿势或构图。",
    "referencePurpose=scene-style 时，只继承色彩、光线、材质、场景和美术语言；不要无故复制人物或精确构图。",
    "默认只生成一个连续电影画面。除用户明确要求，不得生成四宫格、拼贴、分屏、故事板、海报、界面、字幕、标志或水印。",
    "不要添加镜头任务没有要求的人物、物件、文字或事件。",
    "finalPrompt 必须是英文、具体、可视化，并完整描述主体、动作、场景、构图、光线和风格；不要包含 URL 或 Midjourney 参数。",
    "必须返回严格 JSON，不要 markdown，不要解释。",
    'JSON: {"referenceRead":"中文","narrativeIntent":"中文","referenceUse":"current-frame|character|scene-style","mustPreserve":["中文"],"allowedChanges":["中文"],"compositionPlan":"中文","lightingPlan":"中文","finalPrompt":"English","negativePrompt":"English","confidence":0.0}',
  ].join("\n");
}

function userContext(input: DirectImagePromptInput): string {
  return JSON.stringify({
    storyTitle: input.storyTitle ?? "",
    shotNo:
      input.shotNo == null
        ? ""
        : `SH${String(input.shotNo).padStart(2, "0")}`,
    referencePurpose: input.referencePurpose,
    narrativePrompt: input.narrativePrompt.slice(0, 1_500),
    existingPrompt: input.fallbackPrompt.slice(0, 1_500),
  });
}

export async function directImagePrompt(
  input: DirectImagePromptInput
): Promise<ImagePromptDirectorResult> {
  if (!ENV.imagePrompt302Model.trim()) {
    return fallback(input, "IMAGE_PROMPT_302_MODEL 未配置");
  }
  if (!ENV.api302Key) {
    return fallback(input, "API302_KEY 未配置");
  }

  const baseUrl = ENV.api302BaseUrl.trim().replace(/\/+$/, "");
  const timeoutMs = Number(ENV.imagePrompt302TimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : 30_000
  );

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ENV.api302Key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENV.imagePrompt302Model,
        stream: false,
        max_completion_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt() },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `请分析参考图并生成图片提示词。上下文：${userContext(input)}`,
              },
              {
                type: "image_url",
                image_url: { url: input.imageInput, detail: "high" },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return fallback(
        input,
        `302 图片提示词分析失败 HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`
      );
    }

    const data = (await response.json()) as CompletionResponse;
    const raw = parseJsonLoose<DirectorPayload>(completionText(data));
    const prompt = compilePrompt(raw, input.referencePurpose);
    if (!prompt) {
      return fallback(input, "302 图片提示词分析未返回有效英文 finalPrompt");
    }

    return {
      prompt,
      source: "302-vision",
      model: data.model || ENV.imagePrompt302Model,
      analysis: normalizeAnalysis(raw, input.referencePurpose),
    };
  } catch (error) {
    return fallback(
      input,
      error instanceof Error ? error.message : "302 图片提示词分析失败"
    );
  } finally {
    clearTimeout(timeout);
  }
}
