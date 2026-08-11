import {
  PUBLISHING_PLATFORM_REGISTRY,
  X_THREAD_POST_LIMIT,
  getPublishingContentError,
  numberXThreadPosts,
  splitXThreadPosts,
  type PublishingDraftContent,
  type PublishingEditAssessment,
  type PublishingPlatformDraft,
  type PublishingPlatformId,
  type PublishingNarrativeIntent,
  type PublishingStoryCore,
  type PublishingStoryCoreContent,
  defaultPublishingNarrativeIntent,
} from "../../shared/publishingDraft";
import {
  getGeneratedTitlePolicy,
  validateGeneratedTitle,
} from "../../shared/textTitle";
import { runJsonAgent, type AgentTurn } from "./agentRuntime";

export class PublishingDraftModelOutputError extends Error {
  constructor(
    operation: "generate" | "convert" | "revise" | "classify",
    public readonly reason: string = "invalid structured output"
  ) {
    super(`Publishing ${operation} returned invalid output: ${reason}`);
    this.name = "PublishingDraftModelOutputError";
  }
}

export type GeneratedPublishingDraft = {
  platform: PublishingPlatformId;
  core: PublishingStoryCoreContent;
  content: PublishingDraftContent;
  modelLabel: string;
};

export type ConvertedPublishingDraft = {
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  modelLabel: string;
};

export type RevisedPublishingDraft = {
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  modelLabel: string;
};

export type PublishingEditClassification = {
  assessment: PublishingEditAssessment;
  proposedCore: PublishingStoryCoreContent | null;
  usedModel: boolean;
  modelLabel: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
    )
  ).slice(0, limit);
}

function normalizeXThreadBody(value: string): string | null {
  const posts = splitXThreadPosts(value);
  if (posts.length === 0 || posts.length > X_THREAD_POST_LIMIT) return null;
  return numberXThreadPosts(value);
}

function normalizeContent(
  value: unknown,
  platform: PublishingPlatformId,
  titleSources: readonly string[] = []
): PublishingDraftContent | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const rawBody = cleanString(obj.body);
  const body =
    platform === "x" ? normalizeXThreadBody(rawBody) : rawBody.slice(0, 20_000);
  if (!body) return null;
  const titleValidation = validateGeneratedTitle({
    kind: "publishing",
    platform,
    value: obj.title,
    anchor: obj.titleAnchor,
    sourceTexts: titleSources,
  });
  const content = {
    title:
      platform === "x" || titleValidation.hardFailures.length > 0
        ? ""
        : titleValidation.normalizedTitle,
    body,
    tags: cleanStringList(obj.tags, platform === "x" ? 3 : 12),
  };
  return getPublishingContentError(platform, content) ? null : content;
}

function publishingCoreTitleSources(
  core: PublishingStoryCore | PublishingStoryCoreContent | null
): string[] {
  if (!core) return [];
  return [
    ...core.facts,
    core.thesis,
    core.emotion,
    ...core.voiceTraits,
    core.visualConcept,
  ].filter(Boolean);
}

function publishingContentTitleSources(
  content: PublishingDraftContent
): string[] {
  return [content.title, content.body, ...content.tags].filter(Boolean);
}

function preserveAppliedPublishingTitle(
  generated: PublishingDraftContent,
  current: PublishingDraftContent,
  platform: PublishingPlatformId
): PublishingDraftContent {
  if (platform === "x" || !current.title) return generated;
  return { ...generated, title: current.title };
}

function publishingTitleContext(platform: PublishingPlatformId): string {
  if (platform === "x") {
    return "X 不使用独立标题：draft.title 与 draft.titleAnchor 都必须是空字符串。";
  }
  const policy = getGeneratedTitlePolicy("publishing", platform);
  return [
    "标题是独立写作任务，标题不是正文摘要，也不是把正文第一句截短。只生成一个标题。",
    `让没看过这个故事的陌生人一眼看到真实处境、具体细节、反差或用户判断；建议不超过 ${policy.recommendedMax} 个字符。`,
    "优先使用原文里的物件、动作、场景、结果、判断或有辨识度的短句。不要写成“关于……的一些想法”“我的感悟”“记录一下”或空泛情绪分类。",
    "不制造悬念、冲突、承诺、数字、人物、结果或情绪强度；不要把普通经历包装成逆袭、秘密、真相或所有人都该知道的结论。",
    "draft.titleAnchor 必须是 title 中逐字出现、并且也逐字存在于输入素材里的最短连续片段。不要把手机号或邮箱写进标题。",
  ].join("\n");
}

const RESTRAINED_REWRITE_MARKERS = [
  "危险的信号",
  "背叛",
  "反噬",
  "尸体",
  "物理地基",
  "存在的根基",
  "守住实体，就是守住",
  "**",
] as const;

function restrainedRewriteViolations(
  instruction: string,
  content: PublishingDraftContent
): string[] {
  if (
    !/矫情|克制|直接|少.{0,3}(修辞|比喻)|不.{0,3}(煽情|夸张|口号)/.test(
      instruction
    )
  ) {
    return [];
  }
  const text = `${content.title}\n${content.body}`;
  return RESTRAINED_REWRITE_MARKERS.filter(marker => text.includes(marker));
}

function invalidContentReason(
  value: unknown,
  platform: PublishingPlatformId
): string {
  const obj = asRecord(value);
  if (!obj) return "missing draft object";
  const rawBody = cleanString(obj.body);
  if (!rawBody) return "empty draft body";
  if (platform !== "x") return "invalid draft content";
  const content = {
    title: "",
    body: numberXThreadPosts(rawBody),
    tags: cleanStringList(obj.tags, 3),
  };
  return getPublishingContentError(platform, content) ?? "invalid X draft";
}

function normalizeCore(value: unknown): PublishingStoryCoreContent | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const thesis = cleanString(obj.thesis);
  if (!thesis) return null;
  return {
    facts: cleanStringList(obj.facts, 20),
    thesis: thesis.slice(0, 2_000),
    emotion: cleanString(obj.emotion).slice(0, 500),
    voiceTraits: cleanStringList(obj.voiceTraits, 12),
    visualConcept: cleanString(obj.visualConcept).slice(0, 2_000),
  };
}

function platformContext(platform: PublishingPlatformId): string {
  const adapter = PUBLISHING_PLATFORM_REGISTRY[platform];
  const rules = [
    `平台：${adapter.label} (${platform})`,
    `表达适配：${adapter.copyGuidance}`,
    "适配平台只改变篇幅、段落、开头和标签习惯，不能改变事实、观点、情绪或结论。",
  ];
  if (platform === "x") {
    rules.push(
      "X 严格格式：title 必须为空字符串；单条正文不超过 280 加权字符。",
      `内容较长时拆成 2-${X_THREAD_POST_LIMIT} 条 thread：每条之间用一个空行分隔，并以 1/N、2/N 的格式编号；每条连同编号仍不得超过 280 加权字符。`,
      "tags 最多 3 个，并为最后一条预留标签长度；不要输出一整篇未分段长文。"
    );
  }
  return rules.join("\n");
}

function narrativeIntentContext(intent: PublishingNarrativeIntent): string {
  const secondaryPurposes = intent.secondaryPurposes.length
    ? `；兼顾用途=${intent.secondaryPurposes.join("、")}`
    : "";
  const secondaryAudiences = intent.secondaryAudiences.length
    ? `；次要观众=${intent.secondaryAudiences.join("、")}`
    : "";
  const mission = (() => {
    switch (intent.primaryPurpose) {
      case "gift":
        return "先挖掘核心观众与用户之间共同经历、专属物件、关系如何彼此改变，以及想说却没说出口的话；写给这个人，不把私人关系磨成泛泛鸡汤。";
      case "share":
        return "先让陌生人快速进入真实处境，再给出值得停留的反差、判断或实用价值；保留用户立场，不把故事改成热点模板。";
      case "persuade":
        return "先给清楚主张，再用用户说过的项目、行动、结果或判断作证据；优先消除核心观众的真实疑虑。";
      case "create":
        return "优先维持人物欲望、世界规则和形式感；不要把创作写成个人经历复盘或营销文案。";
      default:
        return "优先保留真实原话、细节和未完成的感受；不为外部传播强行补冲突、结论或口号。";
    }
  })();
  return [
    "【本版本的故事任务】",
    `主用途=${intent.primaryPurpose}；核心观众=${intent.coreAudience}${secondaryPurposes}${secondaryAudiences}。`,
    mission,
    "无论用途是什么，都从人的基本诉求出发：被看见、被理解、归属、尊严、安全、成长、爱或创造。不要把这些词直接写成口号；让具体经历、关系和选择承载它们。",
  ].join("\n");
}

export async function generatePublishingDraft(params: {
  platform: PublishingPlatformId;
  conversation: AgentTurn[];
  narrativeIntent?: PublishingNarrativeIntent;
}): Promise<GeneratedPublishingDraft> {
  const adapter = PUBLISHING_PLATFORM_REGISTRY[params.platform];
  const outputSchema =
    '{"core":{"facts":["明确事实"],"thesis":"核心判断","emotion":"真实情绪","voiceTraits":["声音特征"],"visualConcept":"无文字封面的视觉概念"},"draft":{"title":"一个具体标题；X 为空","titleAnchor":"标题与输入共有的最短连续片段；X 为空","body":"完整可发布正文","tags":["可选标签"]}}';
  const systemPrompt = [
    "你是个人发布稿编辑。你的工作是把用户已经说出的想法整理成大众能读懂的文字，同时保留鲜明的个人判断。",
    "这不是批量营销稿：不要削弱批评，不要添加用户没说过的经历、数据或结论，不要把有棱角的话改成空泛鸡汤。",
    "默认写得清楚、直接、有个人判断：不要煽情、装深沉、堆比喻、滥用反问或制造虚假的宏大感；除非用户明确就是这样说话。",
    "优先写具体发生了什么、用户为什么不同意，再写结论。不要用“危险的信号”“背叛”“反噬”“守住……就是守住……”这类宏大措辞代替论证。",
    "保留具体判断，但删除口号感、AI 腔和 Markdown 粗体符号。不要为了显得有力量而重复同一个结论。",
    "先从对话提炼一份跨平台故事内核，再只写当前指定平台的一个版本。不得生成其他平台版本。",
    narrativeIntentContext(
      params.narrativeIntent ?? defaultPublishingNarrativeIntent()
    ),
    platformContext(params.platform),
    publishingTitleContext(params.platform),
    "返回严格 JSON，不要 markdown：",
    outputSchema,
    `当前只生成 ${adapter.label}，不要返回 drafts map。`,
  ].join("\n");
  let result = await runJsonAgent<unknown>({
    systemPrompt,
    message: `请根据以上对话生成 ${adapter.label} 发布稿。`,
    history: params.conversation,
    historyLimit: 20,
    maxTokens: 3_000,
    fallback: () => null,
  });
  let root = asRecord(result.parsed);
  let core = normalizeCore(root?.core);
  const titleSources = params.conversation.map(turn => turn.content);
  let content = normalizeContent(root?.draft, params.platform, titleSources);
  if (!core || !content) {
    const firstReason = !root
      ? "invalid JSON root"
      : !core
        ? "invalid story core"
        : invalidContentReason(root.draft, params.platform);
    result = await runJsonAgent<unknown>({
      systemPrompt: [
        "你是发布稿结构修复器。只修复一次上次候选结果，不添加故事素材之外的新事实。",
        platformContext(params.platform),
        publishingTitleContext(params.platform),
        `必须严格返回这个 JSON 结构：${outputSchema}`,
        "只返回 JSON，不要解释。",
      ].join("\n"),
      message: JSON.stringify({
        validationError: firstReason,
        invalidOutput: result.rawText.slice(0, 20_000),
      }),
      history: params.conversation,
      historyLimit: 20,
      maxTokens: 3_000,
      fallback: () => null,
    });
    root = asRecord(result.parsed);
    core = normalizeCore(root?.core);
    content = normalizeContent(root?.draft, params.platform, titleSources);
  }
  if (!core || !content) {
    throw new PublishingDraftModelOutputError(
      "generate",
      !root
        ? "invalid JSON root"
        : !core
          ? "invalid story core"
          : invalidContentReason(root.draft, params.platform)
    );
  }
  return {
    platform: params.platform,
    core,
    content,
    modelLabel: result.modelLabel,
  };
}

export async function convertPublishingDraft(params: {
  core: PublishingStoryCore;
  sourceDraft: PublishingPlatformDraft;
  targetPlatform: PublishingPlatformId;
}): Promise<ConvertedPublishingDraft> {
  const sourceAdapter =
    PUBLISHING_PLATFORM_REGISTRY[params.sourceDraft.platform];
  const targetAdapter = PUBLISHING_PLATFORM_REGISTRY[params.targetPlatform];
  const outputSchema =
    '{"draft":{"title":"一个具体标题；X 为空","titleAnchor":"标题与来源共有的最短连续片段；X 为空","body":"目标平台完整正文","tags":["可选标签"]}}';
  const source = {
    core: params.core,
    source: params.sourceDraft.content,
    targetPlatform: targetAdapter.label,
  };
  const systemPrompt = [
    "你是单平台文字适配编辑。只把现有稿件适配到一个目标平台。",
    "共享内核是不可变约束：事实、核心判断、情绪、结论与个人声音都不能被改写或弱化。",
    `来源平台：${sourceAdapter.label}`,
    platformContext(params.targetPlatform),
    publishingTitleContext(params.targetPlatform),
    "返回严格 JSON，不要 markdown，也不要返回其他平台：",
    outputSchema,
  ].join("\n");
  let result = await runJsonAgent<unknown>({
    systemPrompt,
    message: JSON.stringify(source),
    history: [],
    historyLimit: 0,
    maxTokens: 2_400,
    fallback: () => null,
  });
  let root = asRecord(result.parsed);
  const titleSources = [
    ...publishingCoreTitleSources(params.core),
    ...publishingContentTitleSources(params.sourceDraft.content),
  ];
  let content = normalizeContent(
    root?.draft,
    params.targetPlatform,
    titleSources
  );
  if (!content) {
    const firstReason = invalidContentReason(
      root?.draft,
      params.targetPlatform
    );
    result = await runJsonAgent<unknown>({
      systemPrompt: [
        "你是发布稿结构修复器。只修复一次上次候选结果，不添加来源稿之外的新事实。",
        platformContext(params.targetPlatform),
        publishingTitleContext(params.targetPlatform),
        `必须严格返回这个 JSON 结构：${outputSchema}`,
        "只返回 JSON，不要解释。",
      ].join("\n"),
      message: JSON.stringify({
        ...source,
        validationError: firstReason,
        invalidOutput: result.rawText.slice(0, 20_000),
      }),
      history: [],
      historyLimit: 0,
      maxTokens: 2_400,
      fallback: () => null,
    });
    root = asRecord(result.parsed);
    content = normalizeContent(
      root?.draft,
      params.targetPlatform,
      titleSources
    );
  }
  if (!content) {
    throw new PublishingDraftModelOutputError(
      "convert",
      invalidContentReason(root?.draft, params.targetPlatform)
    );
  }
  return {
    platform: params.targetPlatform,
    content,
    modelLabel: result.modelLabel,
  };
}

export async function revisePublishingDraft(params: {
  core: PublishingStoryCore;
  current: PublishingDraftContent;
  platform: PublishingPlatformId;
  instruction: string;
}): Promise<RevisedPublishingDraft> {
  const outputSchema =
    '{"draft":{"title":"一个具体标题；X 为空","titleAnchor":"标题与输入共有的最短连续片段；X 为空","body":"改写后的完整正文","tags":["可选标签"]}}';
  const source = {
    platform: params.platform,
    core: params.core,
    currentDraft: params.current,
    userInstruction: params.instruction,
  };
  const systemPrompt = [
    "你是用户直接指挥的发布稿改写编辑。只改当前平台的一份稿件，先准确执行用户这次提出的语言、节奏和篇幅要求。",
    "不得添加原稿和故事内核中没有的事实；不得偷偷弱化核心观点，也不得把个人表达改成营销话术。",
    "用户要求更克制、更直接或少一点修辞时，保留事实和具体判断即可，不必保留原稿的情绪强度、比喻或所谓“锋芒”。",
    "这类克制改写必须把观点落回具体动作与因果，不要把一种修辞替换成另一种修辞。删除“危险的信号”“背叛”“反噬”“尸体”“物理地基”“存在的根基”“守住……就是守住……”等宏大、拟人或口号式表达，除非用户明确要求保留某一句。",
    "严格保持原稿的事实确定程度和时态：看到、听说、报道、计划、可能等表述，不得升级成已经确认、已经执行或必然发生。",
    "不要使用 Markdown 粗体符号。只有用户明确要求时才使用 emoji、网络热词或夸张语气。",
    platformContext(params.platform),
    publishingTitleContext(params.platform),
    `严格返回 JSON，不要解释：${outputSchema}`,
  ].join("\n");
  let result = await runJsonAgent<unknown>({
    systemPrompt,
    message: JSON.stringify(source),
    history: [],
    historyLimit: 0,
    maxTokens: 2_400,
    fallback: () => null,
  });
  let root = asRecord(result.parsed);
  const titleSources = [
    ...publishingCoreTitleSources(params.core),
    ...publishingContentTitleSources(params.current),
    params.instruction,
  ];
  let content = normalizeContent(root?.draft, params.platform, titleSources);
  if (!content) {
    result = await runJsonAgent<unknown>({
      systemPrompt: [
        "你是发布稿改写结果修复器。只修复结构和平台长度，不添加新事实。",
        platformContext(params.platform),
        publishingTitleContext(params.platform),
        `必须严格返回这个 JSON 结构：${outputSchema}`,
        "只返回 JSON，不要解释。",
      ].join("\n"),
      message: JSON.stringify({
        ...source,
        validationError: invalidContentReason(root?.draft, params.platform),
        invalidOutput: result.rawText.slice(0, 20_000),
      }),
      history: [],
      historyLimit: 0,
      maxTokens: 2_400,
      fallback: () => null,
    });
    root = asRecord(result.parsed);
    content = normalizeContent(root?.draft, params.platform, titleSources);
  }
  if (!content) {
    throw new PublishingDraftModelOutputError(
      "revise",
      invalidContentReason(root?.draft, params.platform)
    );
  }
  content = preserveAppliedPublishingTitle(
    content,
    params.current,
    params.platform
  );
  const styleViolations = restrainedRewriteViolations(
    params.instruction,
    content
  );
  if (styleViolations.length > 0) {
    const styleRepair = await runJsonAgent<unknown>({
      systemPrompt: [
        "你是发布稿文字质检编辑。上一版没有真正做到克制，请只改措辞，不改变事实、观点或事实的确定程度。",
        `必须删除这些已经检出的表达：${styleViolations.join("、")}。不要用新的宏大比喻、口号或拟人句替换它们。`,
        "把句子改成具体动作、理由和直接判断；不添加新事实，不把可能或听说改成已经发生。",
        platformContext(params.platform),
        publishingTitleContext(params.platform),
        `严格返回 JSON，不要解释：${outputSchema}`,
      ].join("\n"),
      message: JSON.stringify({
        core: params.core,
        draftToRepair: content,
        userInstruction: params.instruction,
      }),
      history: [],
      historyLimit: 0,
      maxTokens: 2_400,
      fallback: () => null,
    });
    const repaired = normalizeContent(
      asRecord(styleRepair.parsed)?.draft,
      params.platform,
      [...titleSources, ...publishingContentTitleSources(content)]
    );
    if (repaired) {
      result = styleRepair;
      content = preserveAppliedPublishingTitle(
        repaired,
        params.current,
        params.platform
      );
    }
  }
  return {
    platform: params.platform,
    content,
    modelLabel: result.modelLabel,
  };
}

function semanticFingerprint(content: PublishingDraftContent): string {
  return [content.title, content.body, ...content.tags]
    .join("")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(
      /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：“”‘’（）【】《》…—·]+/g,
      ""
    );
}

export function isFormattingOnlyPublishingEdit(
  baseline: PublishingDraftContent,
  next: PublishingDraftContent
): boolean {
  return semanticFingerprint(baseline) === semanticFingerprint(next);
}

export async function classifyPublishingDraftEdit(params: {
  baseline: PublishingDraftContent;
  next: PublishingDraftContent;
  core: PublishingStoryCore;
  platform: PublishingPlatformId;
}): Promise<PublishingEditClassification> {
  if (isFormattingOnlyPublishingEdit(params.baseline, params.next)) {
    return {
      assessment: {
        outcome: "wording_only",
        reason: "只改变了空格、分段或标点",
      },
      proposedCore: null,
      usedModel: false,
      modelLabel: "本地判断",
    };
  }

  const { parsed, modelLabel } = await runJsonAgent<unknown>({
    systemPrompt: [
      "你是发布稿修改层级分类器。只判断用户的修改属于哪一层，不替用户做决定。",
      "wording_only：表达、句式、段落、篇幅变化，但事实、观点、情绪和结论未变。",
      "core_change：事实、核心观点、真实情绪、结论或个人声音发生变化。",
      "uncertain：证据不足，必须让用户选择是改措辞还是改内核。",
      "只有 core_change 才返回 proposedCore；不得自动保存或改写其他平台。",
      '返回严格 JSON：{"outcome":"wording_only|core_change|uncertain","reason":"一句话","proposedCore":{"facts":[],"thesis":"","emotion":"","voiceTraits":[],"visualConcept":""}|null}',
    ].join("\n"),
    message: JSON.stringify({
      platform: params.platform,
      currentCore: params.core,
      before: params.baseline,
      after: params.next,
    }),
    history: [],
    historyLimit: 0,
    maxTokens: 1_200,
    fallback: () => ({
      outcome: "uncertain",
      reason: "模型没有返回可确认的修改层级",
      proposedCore: null,
    }),
  });
  const root = asRecord(parsed);
  const outcome =
    root?.outcome === "wording_only" ||
    root?.outcome === "core_change" ||
    root?.outcome === "uncertain"
      ? root.outcome
      : "uncertain";
  const proposedCore =
    outcome === "core_change" ? normalizeCore(root?.proposedCore) : null;
  return {
    assessment: {
      outcome:
        outcome === "core_change" && !proposedCore ? "uncertain" : outcome,
      reason:
        cleanString(root?.reason) ||
        (outcome === "uncertain"
          ? "需要用户确认修改层级"
          : "已完成修改层级判断"),
    },
    proposedCore,
    usedModel: true,
    modelLabel,
  };
}
