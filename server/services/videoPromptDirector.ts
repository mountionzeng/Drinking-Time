import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { resolveVisionComputeProvider } from "./textComputeProvider";
import type {
  ShotContinuityRisk,
  ShotDirectorAnalysis,
} from "../../shared/shotDirector";
import { promptShotCode } from "../../shared/shotIdentity";
import { withVideoVisualFidelity } from "../../shared/videoMotionPolicy";
import {
  compileVideoPromptEngineering,
  finalizeVideoPromptEngineering,
  type VideoPromptEngineering,
} from "./videoPromptEngineering";
import {
  compileVideoMaterialLock,
  normalizeVideoMaterialProfile,
  type VideoMaterialProfile,
} from "./videoMaterialProfile";

export type VideoPromptShotContext = {
  shotType?: string;
  cameraAngle?: string;
  cameraHeight?: string;
  lens?: string;
  intent?: string;
  subject?: string;
  action?: string;
  performance?: string;
  environmentMotion?: string;
  cameraMove?: string;
  cameraPath?: string;
  subjectPath?: string;
  videoStart?: string;
  videoEnd?: string;
  mood?: string;
  timeLight?: string;
  lighting?: string;
  colorPalette?: string;
  materialTexture?: string;
  dialogue?: string;
  sound?: string;
  soundBridge?: string;
  transitionIn?: string;
  transitionOut?: string;
  transitionIntent?: string;
  videoPrompt?: string;
  negativePrompt?: string;
};

export type VideoPromptAnalysis = ShotDirectorAnalysis;

export type VideoPromptDirectorResult = {
  prompt: string;
  source: "302-vision" | "openai-next-vision" | "deterministic-fallback";
  model: string;
  analysis: VideoPromptAnalysis | null;
  materialProfile: VideoMaterialProfile | null;
  engineering: VideoPromptEngineering;
  fallbackReason?: string;
};

export type DirectVideoPromptInput = {
  imageInput: string;
  endImageInput?: string;
  middleImageInput?: string;
  /** 人物身份基准，只约束脸、发型和服饰，不替换当前镜头构图。 */
  identityImageInput?: string;
  /** Story cover: palette, material, light and mood only; never identity/composition. */
  storyStyleImageInput?: string;
  previousImageInput?: string;
  nextImageInput?: string;
  fallbackPrompt: string;
  shotNo: number;
  cueCode?: string;
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
  cameraRig?: unknown;
  motionTimeline?: unknown;
  cameraSubjectCoordination?: unknown;
  preservationConstraints?: unknown;
  materialProfile?: unknown;
  continuity?: unknown;
  subjectPosition?: unknown;
  facingGazeDirection?: unknown;
  shotScaleChange?: unknown;
  lightColorMaterial?: unknown;
  actionContinuity?: unknown;
  transitionStrategy?: unknown;
  risks?: unknown;
  recommendedMotion?: unknown;
  finalPrompt?: unknown;
  confidence?: unknown;
};

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
  if (words.length > 160) {
    prompt = words.slice(0, 160).join(" ").trim();
    const sentenceEnd = Math.max(
      prompt.lastIndexOf("."),
      prompt.lastIndexOf("!"),
      prompt.lastIndexOf("?")
    );
    if (sentenceEnd >= 500) prompt = prompt.slice(0, sentenceEnd + 1);
  }
  const latinLetters = (prompt.match(/[a-z]/gi) ?? []).length;
  if (prompt.length < 20 || latinLetters < 20) return "";
  return mjSafeVideoPrompt(prompt);
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

export function mjSafeVideoPrompt(value: string): string {
  return value
    .replace(/\bpot\b/gi, "saucepan")
    .replace(/\bweed\b/gi, "wild grass")
    .replace(/\bdrug\b/gi, "medicine")
    .replace(/\bflame(s)?\b/gi, "warm stove light")
    .replace(/\bidentity, clothing,\s*/gi, "visible subject, ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function compileDirectedPrompt(
  raw: DirectorPayload,
  materialProfile: VideoMaterialProfile | null,
  materialTexture?: string
): string {
  const authoredPrompt = compactPrompt(raw.finalPrompt);
  const subjectMotion = englishClause(raw.subjectMotion, 34);
  const cameraMotion = englishClause(raw.cameraMotion, 28);
  const motionPrompt =
    authoredPrompt || [subjectMotion, cameraMotion].filter(Boolean).join(" ");
  if (!motionPrompt) return "";
  const materialLock = compileVideoMaterialLock({
    profile: materialProfile,
    materialTexture,
  });
  return withVideoVisualFidelity(
    [materialLock, `MOTION: ${mjSafeVideoPrompt(motionPrompt)}`].join("\n")
  );
}

function completionText(data: CompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(part => (part.type === "text" ? (part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeAnalysis(
  raw: DirectorPayload,
  materialProfile: VideoMaterialProfile | null
): VideoPromptAnalysis {
  const confidence = Number(raw.confidence);
  const materialProfileSummary = materialProfile
    ? [
        `识别媒介：${materialProfile.medium}`,
        materialProfile.support ? `承载面：${materialProfile.support}` : "",
        materialProfile.markMaking
          ? `笔触/制痕：${materialProfile.markMaking}`
          : "",
        materialProfile.pigmentBehavior
          ? `颜料/颗粒：${materialProfile.pigmentBehavior}`
          : "",
      ]
        .filter(Boolean)
        .join("；")
    : "";
  return {
    visualSummary: text(raw.visualSummary),
    narrativeIntent: text(raw.narrativeIntent),
    subjectMotion: text(raw.subjectMotion),
    cameraMotion: text(raw.cameraMotion),
    cameraRig: text(raw.cameraRig),
    motionTimeline: text(raw.motionTimeline),
    cameraSubjectCoordination: text(raw.cameraSubjectCoordination),
    preservationConstraints: text(raw.preservationConstraints),
    continuity: text(raw.continuity),
    subjectPosition: text(raw.subjectPosition),
    facingGazeDirection: text(raw.facingGazeDirection),
    shotScaleChange: text(raw.shotScaleChange),
    lightColorMaterial: [text(raw.lightColorMaterial), materialProfileSummary]
      .filter(Boolean)
      .join("；"),
    actionContinuity: text(raw.actionContinuity),
    transitionStrategy: text(raw.transitionStrategy),
    risks: normalizeRisks(raw.risks),
    recommendedMotion: raw.recommendedMotion === "high" ? "high" : "low",
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
}

function normalizeRisks(value: unknown): ShotContinuityRisk[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ShotContinuityRisk["kind"]>([
    "jump-cut",
    "axis",
    "space",
    "action",
    "look",
    "none",
  ]);
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const detail = text(raw.detail, 400);
    const kind = allowed.has(raw.kind as ShotContinuityRisk["kind"])
      ? (raw.kind as ShotContinuityRisk["kind"])
      : "none";
    return detail ? [{ kind, detail }] : [];
  });
}

function fallback(
  input: DirectVideoPromptInput,
  reason: string,
  engineering = compileVideoPromptEngineering(input),
  model = ENV.videoPrompt302Model
): VideoPromptDirectorResult {
  return {
    prompt: engineering.finalPrompt,
    source: "deterministic-fallback",
    model,
    analysis: null,
    materialProfile: null,
    engineering,
    fallbackReason: reason.slice(0, 500),
  };
}

function systemPrompt(): string {
  return [
    "你是聊聊的「视频镜头导演」。你会同时看到当前镜头首帧和故事上下文。",
    "先逐项盘点画面里实际存在的人物、物体、背景结构、光线、色彩、材质、纹理和笔触，再理解叙事任务，最后设计可拍、可剪、可由图生视频模型执行的运动。",
    "先判断视觉媒介，再讨论运动。必须把当前首帧归类为 oil-painting、watercolor、gouache、ink-wash、printmaking、pastel、charcoal、pencil-drawing、collage、digital-painting、photographic、mixed-media 或 other，并提取承载面、笔触/制痕、颜料或颗粒行为、边缘特征。不要只写 cinematic、painterly 或 textured 这类空泛风格词。",
    "材质连续性是逐帧硬约束：运动过程中必须保留同一种画布或纸张纹理、笔触方向与尺度、颜料厚度/透明度/颗粒沉积和手绘边缘。油画不得变成摄影、塑料感或平滑 CGI；水彩不得变成油画厚涂、空气刷渐变或数字磨皮；版画不得丢失刻线、套色错位和纸张压痕。",
    "当前首帧与目标尾帧是视觉事实。除非镜头文字明确要求具体变化，否则人物身份、脸、发型、身体、服装，物体数量与位置、空间几何、构图、光线、色彩、材质、表面纹理和笔触都必须保持，不得新增、删除、复制、替换、融化或凭空显露内容。",
    "若提供人物身份基准图，它是脸、发型和服饰的唯一事实来源；只能把这些身份特征落实到当前镜头，不得照搬基准图的姿势、构图或背景。",
    "当前镜头有目标尾帧时，分析从首帧到尾帧真正发生了什么；不要把两帧之间没有证据的变化编出来。",
    "若提供当前镜头中间参考帧，它只负责约束中段应保持的人物、物体、构图、材质和动作意图；首帧与尾帧仍是必须抵达的时间边界，不得把中间参考帧误写成新的开场或结尾。",
    "editorDraft 中标为“用户当前”或“当前”的动作、表演、环境变化、相机运动、主体运动路径、起始画面、结束状态和衔接是用户确认的硬约束；它们高于“既有视频方案”。若两者冲突，以用户当前要求为准。finalPrompt 必须保留这些要求，不得省略、反转或替换为通用运镜。",
    "promptEngineering 是系统在调用你之前已经生成的镜头工程。它规定叙事节拍、用户硬约束、进入关系、三拍因果动作、摄影机路径和退出关系；你只能结合参考帧把它具体化，不能绕过、弱化或改写用户硬约束。",
    "动作因果顺序必须是：眼神或注意力触发，呼吸与身体重心启动，肢体接触或发力，之后道具或环境才回应；摄影机由人物或道具动作驱动，并在为下一镜准备好的出口状态收稳。",
    "只设计画面中已有主体可以自然完成的动作、环境运动和相机运动，动作必须遵守重力、关节和空间连续性。",
    "必须选择合适的摄影机承载方式：锁定三脚架、云台摇移、短滑轨/车、稳定器跟拍、肩扛或受控手持。手持不是默认装饰；只有叙事需要身体临场感时才使用，并说明晃动幅度、频率、水平线漂移和何时收稳。",
    "把时长拆成起势、中段、收束三个运动节拍，说明人物先做什么、摄影机何时响应、两者是否同向或反向、在什么画面状态停住以便接下一镜。避免全程匀速放大、缩小、漂移或无目的环绕。",
    "若提供前一镜尾帧和后一镜首帧，必须比较主体位置、朝向、视线、运动方向、景别、轴线、空间、明暗、色温、饱和度和材质。",
    "明确指出跳切、轴线错误、空间断裂或动作无法接续的风险，并选择动作匹配、视线匹配、形状匹配、声音桥、遮挡切或硬切。",
    "不要把台词、字幕、文字、UI、水印或抽象概念画进画面。",
    "不要编造首帧里看不到的人物、物件或事件。画面与剧本冲突时，以首帧可见事实为准。",
    "cameraRig、motionTimeline、cameraSubjectCoordination、preservationConstraints 用中文，具体且可执行。",
    "finalPrompt 必须是英文，70-140 个词，依次写人物与环境动作节拍、摄影机承载与路径、人物和摄影机配合、结束状态；不要只写 push-in、zoom 或 pan 这种空模板。",
    "必须返回严格 JSON，不要 markdown，不要解释。",
    'JSON: {"visualSummary":"中文","narrativeIntent":"中文","subjectPosition":"中文","facingGazeDirection":"中文","shotScaleChange":"中文","lightColorMaterial":"中文","materialProfile":{"medium":"oil-painting|watercolor|gouache|ink-wash|printmaking|pastel|charcoal|pencil-drawing|collage|digital-painting|photographic|mixed-media|other","support":"English","markMaking":"English","pigmentBehavior":"English","temporalRules":"English","prohibitedDrift":"English","confidence":0.0},"actionContinuity":"中文","continuity":"中文","transitionStrategy":"中文","cameraRig":"中文","motionTimeline":"中文","cameraSubjectCoordination":"中文","preservationConstraints":"中文","risks":[{"kind":"jump-cut|axis|space|action|look|none","detail":"中文"}],"subjectMotion":"English","cameraMotion":"English","recommendedMotion":"low|high","finalPrompt":"English motion only","confidence":0.0}',
  ].join("\n");
}

function userContext(
  input: DirectVideoPromptInput,
  engineering: VideoPromptEngineering
): string {
  return JSON.stringify({
    storyTitle: input.storyTitle ?? "",
    shotNo: promptShotCode(input),
    subtitle: input.subtitle ?? "",
    currentShot: input.currentShot ?? {},
    previousShot: input.previousShot ?? {},
    nextShot: input.nextShot ?? {},
    editorDraft: input.draftPrompt.slice(0, 1200),
    promptEngineering: engineering,
  });
}

export async function directVideoPrompt(
  input: DirectVideoPromptInput
): Promise<VideoPromptDirectorResult> {
  const engineering = compileVideoPromptEngineering(input);
  const provider = resolveVisionComputeProvider({
    fallback302Model: ENV.videoPrompt302Model,
    fallback302ApiKey: ENV.api302Key,
    fallback302BaseUrl: ENV.api302BaseUrl,
  });
  if (!provider) {
    return fallback(
      input,
      "OpenAI Next / 302 视频提示词通道未配置",
      engineering
    );
  }
  try {
    const visualContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "high" } }
    > = [
      {
        type: "text",
        text: `请分析当前首帧并生成视频提示词。上下文：${userContext(input, engineering)}`,
      },
      {
        type: "image_url",
        image_url: { url: input.imageInput, detail: "high" },
      },
    ];
    if (input.endImageInput) {
      visualContent.push(
        { type: "text", text: "当前镜头目标尾帧：" },
        {
          type: "image_url",
          image_url: { url: input.endImageInput, detail: "high" },
        }
      );
    }
    if (input.middleImageInput) {
      visualContent.push(
        { type: "text", text: "当前镜头中间参考帧（约束中段，不是首尾帧）：" },
        {
          type: "image_url",
          image_url: { url: input.middleImageInput, detail: "high" },
        }
      );
    }
    if (input.identityImageInput) {
      visualContent.push(
        {
          type: "text",
          text: "人物身份基准图（只锁定脸、发型和服饰，不替换当前镜头构图）：",
        },
        {
          type: "image_url",
          image_url: { url: input.identityImageInput, detail: "high" },
        }
      );
    }
    if (input.storyStyleImageInput) {
      visualContent.push(
        {
          type: "text",
          text: "故事正式封面（只继承色板、材质、光线和情绪；不得复制构图，不得作为人物身份）：",
        },
        {
          type: "image_url",
          image_url: { url: input.storyStyleImageInput, detail: "high" },
        }
      );
    }
    if (input.previousImageInput) {
      visualContent.push(
        { type: "text", text: "前一镜尾帧：" },
        {
          type: "image_url",
          image_url: { url: input.previousImageInput, detail: "high" },
        }
      );
    }
    if (input.nextImageInput) {
      visualContent.push(
        { type: "text", text: "后一镜首帧：" },
        {
          type: "image_url",
          image_url: { url: input.nextImageInput, detail: "high" },
        }
      );
    }
    const data = await invokeLLM({
      useCase: "vision",
      replaySafe: false,
      timeoutMs: positiveInteger(ENV.videoPrompt302TimeoutMs, 30_000),
      fallback302Model: ENV.videoPrompt302Model,
      fallback302ApiKey: ENV.api302Key,
      fallback302BaseUrl: ENV.api302BaseUrl,
      maxTokens: 1400,
      reasoningEffort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: visualContent },
      ],
    });
    const raw = parseJsonLoose<DirectorPayload>(completionText(data));
    const materialProfile = normalizeVideoMaterialProfile(raw.materialProfile);
    const prompt = compileDirectedPrompt(
      raw,
      materialProfile,
      input.currentShot?.materialTexture
    );
    if (!prompt) {
      return fallback(
        input,
        `${provider.label} 视频提示词分析未返回有效英文 finalPrompt`,
        engineering,
        provider.model
      );
    }
    const directedEngineering = finalizeVideoPromptEngineering(
      engineering,
      prompt,
      "vision-directed"
    );

    return {
      prompt: directedEngineering.finalPrompt,
      source:
        (data.provider?.id ?? provider.id) === "openai-next"
          ? "openai-next-vision"
          : "302-vision",
      model: data.model || provider.model,
      analysis: normalizeAnalysis(raw, materialProfile),
      materialProfile,
      engineering: directedEngineering,
    };
  } catch (error) {
    return fallback(
      input,
      error instanceof Error
        ? error.message
        : `${provider.label} 视频提示词分析失败`,
      engineering,
      provider.model
    );
  }
}
