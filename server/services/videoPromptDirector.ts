import { ENV } from "../_core/env";
import { parseJsonLoose } from "../_core/llmJson";

export type VideoPromptShotContext = {
  intent?: string;
  subject?: string;
  action?: string;
  cameraMove?: string;
  videoStart?: string;
  videoEnd?: string;
  mood?: string;
  dialogue?: string;
  transitionIn?: string;
  transitionOut?: string;
};

export type VideoPromptAnalysis = {
  visualSummary: string;
  narrativeIntent: string;
  subjectMotion: string;
  cameraMotion: string;
  continuity: string;
  recommendedMotion: "low" | "high";
  confidence: number;
};

export type VideoPromptDirectorResult = {
  prompt: string;
  source: "302-vision" | "deterministic-fallback";
  model: string;
  analysis: VideoPromptAnalysis | null;
  fallbackReason?: string;
};

type DirectVideoPromptInput = {
  imageInput: string;
  fallbackPrompt: string;
  shotNo: number;
  draftPrompt: string;
  subtitle?: string;
  storyTitle?: string;
  currentShot?: VideoPromptShotContext;
  previousShot?: VideoPromptShotContext;
  nextShot?: VideoPromptShotContext;
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
  visualSummary?: unknown;
  narrativeIntent?: unknown;
  subjectMotion?: unknown;
  cameraMotion?: unknown;
  continuity?: unknown;
  recommendedMotion?: unknown;
  finalPrompt?: unknown;
  confidence?: unknown;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function text(value: unknown, max = 600): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function cleanPromptText(value: unknown): string {
  return text(value, 1000)
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/--[a-z][\w-]*(?:\s+\S+)?/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'「『\s]+|["'」』\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function compactPrompt(value: unknown): string {
  let prompt = cleanPromptText(value);
  const words = prompt.split(/\s+/);
  if (words.length > 65) {
    prompt = words.slice(0, 65).join(" ").trim();
    const sentenceEnd = Math.max(
      prompt.lastIndexOf("."),
      prompt.lastIndexOf("!"),
      prompt.lastIndexOf("?")
    );
    if (sentenceEnd >= 180) prompt = prompt.slice(0, sentenceEnd + 1);
  }
  const latinLetters = (prompt.match(/[a-z]/gi) ?? []).length;
  if (prompt.length < 20 || latinLetters < 20) return "";
  return prompt;
}

function englishClause(value: unknown, maxWords: number): string {
  const cleaned = cleanPromptText(value);
  if ((cleaned.match(/[a-z]/gi) ?? []).length < 5) return "";
  const firstCompleteSentence = cleaned.match(/^.*?[.!?](?:\s|$)/)?.[0];
  const primary = (firstCompleteSentence ?? cleaned).split(";")[0].trim();
  const words = primary.split(/\s+/);
  let clause = words.slice(0, maxWords).join(" ");
  if (words.length > maxWords) {
    const comma = clause.lastIndexOf(",");
    if (comma >= Math.floor(clause.length * 0.55)) {
      clause = clause.slice(0, comma);
    }
  }
  clause = clause.replace(/[,;:\s.]+$/, "").trim();
  if (!clause) return "";
  return `${clause}.`;
}

function compileDirectedPrompt(raw: DirectorPayload): string {
  const subjectMotion = englishClause(raw.subjectMotion, 34);
  const cameraMotion = englishClause(raw.cameraMotion, 18);
  if (!subjectMotion && !cameraMotion) return compactPrompt(raw.finalPrompt);
  return [
    subjectMotion,
    cameraMotion,
    "Preserve identity, clothing, lighting, and original composition; use natural motion only.",
  ]
    .filter(Boolean)
    .join(" ");
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

function normalizeAnalysis(raw: DirectorPayload): VideoPromptAnalysis {
  const confidence = Number(raw.confidence);
  return {
    visualSummary: text(raw.visualSummary),
    narrativeIntent: text(raw.narrativeIntent),
    subjectMotion: text(raw.subjectMotion),
    cameraMotion: text(raw.cameraMotion),
    continuity: text(raw.continuity),
    recommendedMotion: raw.recommendedMotion === "high" ? "high" : "low",
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
}

function fallback(
  input: DirectVideoPromptInput,
  reason: string
): VideoPromptDirectorResult {
  return {
    prompt: input.fallbackPrompt,
    source: "deterministic-fallback",
    model: ENV.videoPrompt302Model,
    analysis: null,
    fallbackReason: reason.slice(0, 500),
  };
}

function systemPrompt(): string {
  return [
    "你是小酌的「视频镜头导演」。你会同时看到当前镜头首帧和故事上下文。",
    "先判断画面实际包含什么，再理解这一镜在故事里的叙事任务，最后为图生视频模型写运动提示词。",
    "首帧已经定义人物、场景、构图、服饰、光线和美术风格；不要重画、替换或新增这些内容。",
    "只设计画面中已有主体可以自然完成的微动作、环境运动和相机运动。",
    "不要把台词、字幕、文字、UI、水印或抽象概念画进画面。",
    "不要编造首帧里看不到的人物、物件或事件。画面与剧本冲突时，以首帧可见事实为准。",
    "finalPrompt 必须是英文，25-65 个词，使用正向描述，只写动作、时序、运镜和必须保持不变的内容。",
    "必须返回严格 JSON，不要 markdown，不要解释。",
    'JSON: {"visualSummary":"中文","narrativeIntent":"中文","subjectMotion":"English","cameraMotion":"English","continuity":"中文","recommendedMotion":"low|high","finalPrompt":"English","confidence":0.0}',
  ].join("\n");
}

function userContext(input: DirectVideoPromptInput): string {
  return JSON.stringify({
    storyTitle: input.storyTitle ?? "",
    shotNo: `SH${String(input.shotNo).padStart(2, "0")}`,
    subtitle: input.subtitle ?? "",
    currentShot: input.currentShot ?? {},
    previousShot: input.previousShot ?? {},
    nextShot: input.nextShot ?? {},
    editorDraft: input.draftPrompt.slice(0, 1200),
  });
}

export async function directVideoPrompt(
  input: DirectVideoPromptInput
): Promise<VideoPromptDirectorResult> {
  if (!ENV.videoPrompt302Model.trim()) {
    return fallback(input, "VIDEO_PROMPT_302_MODEL 未配置");
  }
  if (!ENV.api302Key) {
    return fallback(input, "API302_KEY 未配置");
  }

  const url = `${normalizeBaseUrl(ENV.api302BaseUrl)}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(ENV.videoPrompt302TimeoutMs, 30_000)
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${ENV.api302Key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENV.videoPrompt302Model,
        stream: false,
        max_completion_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt() },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `请分析当前首帧并生成视频提示词。上下文：${userContext(input)}`,
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
        `302 视频提示词分析失败 HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`
      );
    }

    const data = (await response.json()) as CompletionResponse;
    const raw = parseJsonLoose<DirectorPayload>(completionText(data));
    const prompt = compileDirectedPrompt(raw);
    if (!prompt) {
      return fallback(input, "302 视频提示词分析未返回有效英文 finalPrompt");
    }

    return {
      prompt,
      source: "302-vision",
      model: data.model || ENV.videoPrompt302Model,
      analysis: normalizeAnalysis(raw),
    };
  } catch (error) {
    return fallback(
      input,
      error instanceof Error ? error.message : "302 视频提示词分析失败"
    );
  } finally {
    clearTimeout(timeout);
  }
}
