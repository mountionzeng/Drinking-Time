import type {
  PublishingPlatformId,
  PublishingNarrativeIntent,
  PublishingStoryCore,
} from "../../shared/publishingDraft";
import { defaultPublishingNarrativeIntent } from "../../shared/publishingDraft";
import {
  buildPublishingVideoPreview,
  canonicalizePublishingVideoParagraphs,
  isPublishingVideoBeat,
  validatePublishingVideoPreview,
  type PublishingVideoBeat,
  type PublishingVideoStoryboardPreview,
} from "../../shared/publishingVideoStoryboard";
import { ENV } from "../_core/env";
import { parseJsonLoose } from "../_core/llmJson";
import { runInference } from "../_core/inferenceOrchestrator";
import { resolveComputeCandidates } from "../_core/textComputeProvider";

export class PublishingVideoStoryboardModelOutputError extends Error {
  constructor(readonly reasons: string[]) {
    super(
      `Publishing video storyboard output is invalid: ${reasons.join(", ")}`
    );
    this.name = "PublishingVideoStoryboardModelOutputError";
  }
}

type ModelParagraph = {
  paragraphId: string;
  scriptText: string;
  visualTreatment: string;
  treatmentReason?: string | null;
  beat?: PublishingVideoBeat;
  shots: Array<{
    subject: string;
    action: string;
    imageRequirement: string;
    videoRequirement: string;
    soundRequirement: string;
  }>;
};

type CompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

const MODEL_PARAGRAPH_BATCH_SIZE = 3;
const MODEL_BATCH_CONCURRENCY = 2;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 6_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeModelParagraphs(value: unknown): ModelParagraph[] {
  const root = record(value);
  if (!root || !Array.isArray(root.paragraphs)) return [];
  return root.paragraphs.flatMap(raw => {
    const item = record(raw);
    if (!item) return [];
    const paragraphId = text(item.paragraphId, 200);
    const scriptText = text(item.scriptText);
    const visualTreatment = text(item.visualTreatment);
    if (!paragraphId || !scriptText || !visualTreatment) return [];
    const shots = Array.isArray(item.shots)
      ? item.shots.slice(0, 6).flatMap(rawShot => {
          const shot = record(rawShot);
          if (!shot) return [];
          const normalized = {
            subject: text(shot.subject, 2_000),
            action: text(shot.action, 2_000),
            imageRequirement: text(shot.imageRequirement, 4_000),
            videoRequirement: text(shot.videoRequirement, 4_000),
            soundRequirement: text(shot.soundRequirement, 2_000),
          };
          return normalized.subject &&
            normalized.action &&
            normalized.imageRequirement &&
            normalized.videoRequirement
            ? [normalized]
            : [];
        })
      : [];
    if (shots.length === 0) return [];
    return [
      {
        paragraphId,
        scriptText,
        visualTreatment,
        beat: isPublishingVideoBeat(item.beat) ? item.beat : undefined,
        treatmentReason:
          typeof item.treatmentReason === "string"
            ? text(item.treatmentReason, 1_000)
            : null,
        shots,
      },
    ];
  });
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fallbackRewrite(input: {
  paragraph: ReturnType<typeof canonicalizePublishingVideoParagraphs>[number];
  core: PublishingStoryCore | null;
}): ModelParagraph {
  const anchor = input.paragraph.text.replace(/\s+/g, " ").slice(0, 24);
  const visualConcept = input.core?.visualConcept?.trim();
  const material = visualConcept
    ? `沿用“${visualConcept.slice(0, 80)}”的视觉基调`
    : "以人物、环境和光线的关系承接这一段";
  const classification = input.paragraph.classification;
  const scriptText =
    classification === "cta"
      ? "不直接朗读行动号召；人物在将要离开画面时停一下，把邀请留给观众自己接住。"
      : classification === "formatting"
        ? "不把结构提示念出来；镜头用一次停顿和重新整理的动作，让信息在画面里落位。"
        : `这句话不直接朗读。人物把“${anchor}”留在一个短暂停顿里，再把目光移向更开阔的地方。`;
  const visualTreatment =
    classification === "cta"
      ? `${material}，用留白、回望和未完成的动作代替逐字号召。`
      : classification === "formatting"
        ? `${material}，让纸面、物件或手部动作完成一次可见的整理。`
        : `${material}，用视线、手部和景别变化把第 ${input.paragraph.ordinal} 段的感受落下来。`;

  return {
    paragraphId: input.paragraph.paragraphId,
    scriptText,
    visualTreatment,
    treatmentReason:
      classification === "narrative"
        ? null
        : `${classification} 内容改为非逐字的画面/表演处理`,
    shots: [
      {
        subject: "与正文情绪一致的人物和环境",
        action:
          classification === "cta"
            ? "停在画面边缘，回望后把动作留在未完成处"
            : "完成一次停顿、视线移动和细小的手部动作",
        imageRequirement: `${visualTreatment}；保持封面的人物、色板与油画或纸张材质连续。`,
        videoRequirement:
          "从中景缓慢推进到近景，动作自然完成，不复制封面构图。",
        soundRequirement: "",
      },
    ],
  };
}

function completeModelRewrites(input: {
  paragraphs: ReturnType<typeof canonicalizePublishingVideoParagraphs>;
  modelRewrites: ModelParagraph[];
  core: PublishingStoryCore | null;
}): { rewrites: ModelParagraph[]; usedFallback: boolean } {
  const byParagraph = new Map(
    input.modelRewrites.map(rewrite => [rewrite.paragraphId, rewrite])
  );
  let usedFallback = false;
  const rewrites = input.paragraphs.map(paragraph => {
    const candidate = byParagraph.get(paragraph.paragraphId);
    if (
      candidate &&
      compactText(candidate.scriptText) !== compactText(paragraph.text) &&
      candidate.visualTreatment.trim()
    ) {
      return candidate;
    }
    usedFallback = true;
    return fallbackRewrite({ paragraph, core: input.core });
  });
  return { rewrites, usedFallback };
}

function allowlistedContext(input: {
  body: string;
  platform: PublishingPlatformId;
  core: PublishingStoryCore | null;
  narrativeIntent?: PublishingNarrativeIntent;
  coverVisualDescription?: string | null;
}) {
  const paragraphs = canonicalizePublishingVideoParagraphs(input.body);
  return {
    platform: input.platform,
    totalParagraphs: paragraphs.length,
    paragraphs: paragraphs.map(paragraph => ({
      paragraphId: paragraph.paragraphId,
      // 分批处理时模型只看得见本批 3 段，位置信息是它判断叙事位置的唯一依据
      ordinal: paragraph.ordinal,
      text: paragraph.text,
      classification: paragraph.classification,
    })),
    storyCore: input.core
      ? {
          facts: input.core.facts.slice(0, 20),
          thesis: input.core.thesis,
          emotion: input.core.emotion,
          voiceTraits: input.core.voiceTraits.slice(0, 12),
          visualConcept: input.core.visualConcept,
        }
      : null,
    narrativeIntent:
      input.narrativeIntent ?? defaultPublishingNarrativeIntent(),
    coverVisualDescription: text(input.coverVisualDescription, 2_000) || null,
  };
}

function generationPrompt(intent: PublishingNarrativeIntent): string {
  const narrativeDirection = (() => {
    switch (intent.primaryPurpose) {
      case "gift":
        return "礼物版：每镜优先让核心观众认出两人之间的共同细节、关系动作和只属于他们的物件；不要退化成单个人的泛泛伤感肖像。";
      case "share":
        return "分享版：每镜都要让陌生观众先看懂处境，再看见反差、判断或值得转发的具体点；避免只拍漂亮但无法理解的氛围图。";
      case "persuade":
        return "介绍／说服版：每镜必须承担一个可见的论证任务，用用户给出的证据、行动或结果回应核心观众的疑虑；避免职业人物、桌子或门口等泛泛象征。";
      case "create":
        return "创作版：每镜推动人物欲望、阻碍或世界规则，维持独立的形式和美术逻辑；不要套用真实经历的回忆蒙太奇。";
      default:
        return "留存版：优先保存真实物件、动作、时间关系和未完成感；不要为了好看或传播性强行制造戏剧冲突。";
    }
  })();
  return [
    "你是短片编剧兼分镜导演。把用户已确认的发布正文转成可说、可演、可拍的短片剧本，不补写正文之外的新事实。",
    "输入中的 paragraphId 必须原样返回且每个只出现一次。每个正文段落都必须有 scriptText、visualTreatment 和至少一个 shots 项。",
    "scriptText 是可表演、可执行的视觉剧本，不承载旁白或声音制作；CTA/格式段也必须覆盖，但不能机械呈现‘点赞关注’。旁白文字由系统直接继承文字稿原文。",
    "用户只提供情绪时，用景别、视角、动作节拍、主体与环境关系补足基础镜头语言；不要写具体视频模型参数，也不要发起图片或视频生成。",
    "每个 shot 必须完整提供 subject、action、imageRequirement、videoRequirement，并单独提供 soundRequirement（没有声音要求时返回空字符串）；前四项任一为空即视为无效。图片要求写清单帧主体、场景、构图、光线、材质；视频要求只写动作三拍、表演、摄影机承载与路径、结尾状态及衔接，不得写旁白、对白、音乐、环境声或音效；声音内容全部写入 soundRequirement。保持人物、色板、油画颜料或纸张纤维等材质连续，但让每镜构图服从本段内容，不复制封面构图，也不得复用其他镜头的句子。",
    `【本版本意图】主用途=${intent.primaryPurpose}；核心观众=${intent.coreAudience}。${narrativeDirection}`,
    "所有镜头仍以人的基本诉求为底层线索（被看见、被理解、归属、尊严、安全、成长、爱或创造）；把它落实为人物关系、物件、动作和选择，绝不写成抽象口号。",
    "本次请求会分批处理：每个正文段落至少一镜、单段最多 6 镜。最终短片总镜头数由系统在合并所有批次后校验。",
    "每段还要给 beat，标明这一段在**整片**里承担的位置，只能是：开场 / 起势 / 转折 / 收束。",
    "判断依据是 ordinal（本段序号）和 totalParagraphs（全片段落总数）—— 你每批只看得到其中几段，务必按整片位置判断，不要按本批位置判断。",
    "开场用于建立处境；起势是事情展开；转折是整片最重的那一下，通常只有一到两段；收束是落点。第一段一般是开场，最后一段一般是收束，中间按内容分配。",
    "严格返回 JSON，不要 markdown：",
    '{"paragraphs":[{"paragraphId":"原样键","beat":"开场|起势|转折|收束","scriptText":"视觉剧本转写","visualTreatment":"画面/表演处理","treatmentReason":"可选分类理由","shots":[{"subject":"主体","action":"动作","imageRequirement":"静帧画面要求","videoRequirement":"纯视觉动作与运镜要求","soundRequirement":"背景音、环境声、音乐和音效要求；没有则为空字符串"}]}]}',
  ].join("\n");
}

/**
 * 合并各批次后归一叙事位置。
 *
 * 模型一批只看 3 段，即使给了 ordinal 也可能出现：多批各自 claim 转折、
 * 首段不是开场、末段不是收束。这些都得在拿到全局视图后修掉 ——
 * 段预算依赖「首开场、尾收束、中间有转折」这个骨架成立。
 */
export function assignNarrativeBeats(
  paragraphs: ReturnType<typeof canonicalizePublishingVideoParagraphs>,
  rewrites: ModelParagraph[]
): ModelParagraph[] {
  const byId = new Map(rewrites.map(rewrite => [rewrite.paragraphId, rewrite]));
  const ordered = paragraphs
    .map(paragraph => byId.get(paragraph.paragraphId))
    .filter((rewrite): rewrite is ModelParagraph => Boolean(rewrite));
  const total = ordered.length;
  if (total === 0) return rewrites;

  ordered.forEach((rewrite, index) => {
    // 不信任入参：非法值一律当作未标注处理
    const claimed = isPublishingVideoBeat(rewrite.beat) ? rewrite.beat : undefined;
    if (index === 0) rewrite.beat = "开场";
    else if (index === total - 1) rewrite.beat = "收束";
    else if (!claimed || claimed === "开场" || claimed === "收束") {
      rewrite.beat = "起势";
    } else {
      rewrite.beat = claimed;
    }
  });

  // 中间段一个转折都没有：把靠后位置那段提为转折。否则转折段预算为 0，
  // 整片没有承重点 —— 那不是一个故事。
  const middle = ordered.slice(1, Math.max(1, total - 1));
  if (middle.length > 0 && !middle.some(rewrite => rewrite.beat === "转折")) {
    middle[Math.floor(middle.length * 0.6)].beat = "转折";
  }

  return rewrites;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(input: {
  items: readonly T[];
  concurrency: number;
  task: (item: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const results = new Array<R>(input.items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(input.concurrency, input.items.length) },
    async () => {
      while (nextIndex < input.items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await input.task(input.items[index]!, index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function runPublishingVideoStoryboardTextCompute(input: {
  systemPrompt: string;
  context: unknown;
}): Promise<{ parsed: unknown; modelLabel: string }> {
  const candidates = resolveComputeCandidates("text", {
    fallback302Model: ENV.videoPrompt302Model,
  });
  if (candidates.length === 0) {
    return {
      parsed: null,
      modelLabel: "文本算力未配置（本地保底补全）",
    };
  }
  const label = candidates[0].label;

  try {
    const outcome = await runInference({
      useCase: "text",
      messages: [
        { role: "system", content: input.systemPrompt },
        {
          role: "user",
          content: `请按要求逐段生成剧本、图片提示词与视频提示词。上下文：${JSON.stringify(input.context)}`,
        },
      ],
      candidates: { fallback302Model: ENV.videoPrompt302Model },
      maxTokens: 4_500,
      reasoningEffort: "low",
      responseFormat: { type: "json_object" },
      // 转写是纯生成，没有工具调用也没有业务写入，可以安全重发。
      replaySafe: true,
      deadlineMs: positiveInteger(
        ENV.publishingVideoStoryboard302TimeoutMs,
        90_000
      ),
    });

    const data = outcome.result as CompletionResponse;
    try {
      return {
        parsed: parseJsonLoose<unknown>(completionText(data)),
        modelLabel: data.model || outcome.model,
      };
    } catch {
      // 模型答错格式是业务问题，不是供应商故障——保持原有的本地补全语义。
      return {
        parsed: null,
        modelLabel: `${outcome.providerLabel} 返回不是有效 JSON（本地保底补全）`,
      };
    }
  } catch (error) {
    return {
      parsed: null,
      modelLabel: `${label} 转写失败：${
        error instanceof Error ? error.message.slice(0, 120) : "未知错误"
      }（本地保底补全）`,
    };
  }
}

export async function generatePublishingVideoStoryboardPreview(input: {
  body: string;
  platform: PublishingPlatformId;
  core: PublishingStoryCore | null;
  narrativeIntent?: PublishingNarrativeIntent;
  coverVisualDescription?: string | null;
  now?: number;
}): Promise<{ preview: PublishingVideoStoryboardPreview; modelLabel: string }> {
  const context = allowlistedContext(input);
  const paragraphs = canonicalizePublishingVideoParagraphs(input.body);
  if (paragraphs.length === 0) {
    throw new PublishingVideoStoryboardModelOutputError(["empty_source"]);
  }
  const batchResults = await mapWithConcurrency({
    items: batches(context.paragraphs, MODEL_PARAGRAPH_BATCH_SIZE),
    concurrency: MODEL_BATCH_CONCURRENCY,
    task: batch =>
      runPublishingVideoStoryboardTextCompute({
        systemPrompt: generationPrompt(
          input.narrativeIntent ?? defaultPublishingNarrativeIntent()
        ),
        context: { ...context, paragraphs: batch },
      }),
  });
  const modelRewrites = batchResults.flatMap(result =>
    normalizeModelParagraphs(result.parsed)
  );
  const modelLabels = Array.from(
    new Set(batchResults.map(result => result.modelLabel))
  );

  const completed = completeModelRewrites({
    paragraphs,
    modelRewrites,
    core: input.core,
  });
  const preview = buildPublishingVideoPreview({
    paragraphs,
    rewrites: assignNarrativeBeats(paragraphs, completed.rewrites),
    now: input.now,
  });
  const issues = validatePublishingVideoPreview(preview);
  if (issues.length > 0) {
    throw new PublishingVideoStoryboardModelOutputError(
      issues.map(issue => issue.code)
    );
  }
  return {
    preview,
    modelLabel: completed.usedFallback
      ? `${modelLabels.join("；")}（本地保底补全）`
      : modelLabels.join("；"),
  };
}
