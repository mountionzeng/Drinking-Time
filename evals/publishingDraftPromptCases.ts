import type {
  PublishingDraftContent,
  PublishingNarrativeIntent,
  PublishingPlatformDraft,
  PublishingPlatformId,
  PublishingStoryCore,
} from "../shared/publishingDraft";
import type { AgentTurn } from "../server/services/agentRuntime";

export const PUBLISHING_DRAFT_PROMPT_TASK_PATHS = [
  "initial_generation",
  "platform_conversion",
  "instructed_revision",
  "structural_repair",
] as const;

export type PublishingDraftPromptTaskPath =
  (typeof PUBLISHING_DRAFT_PROMPT_TASK_PATHS)[number];

export const PUBLISHING_DRAFT_PROMPT_CONTRACTS = [
  "strict_json",
  "single_platform",
  "no_new_facts",
  "preserve_viewpoint",
  "preserve_epistemic_status",
  "follow_user_instruction",
  "preserve_applied_title",
  "visual_concept_is_not_copy_direction",
  "structure_only_repair",
  "preserve_candidate_content",
] as const;

export type PublishingDraftPromptContract =
  (typeof PUBLISHING_DRAFT_PROMPT_CONTRACTS)[number];

type GenerateCaseInput = {
  kind: "generate";
  platform: PublishingPlatformId;
  conversation: AgentTurn[];
  narrativeIntent: PublishingNarrativeIntent;
};

type ConvertCaseInput = {
  kind: "convert";
  core: PublishingStoryCore;
  sourceDraft: PublishingPlatformDraft;
  targetPlatform: PublishingPlatformId;
};

type ReviseCaseInput = {
  kind: "revise";
  core: PublishingStoryCore;
  current: PublishingDraftContent;
  platform: PublishingPlatformId;
  instruction: string;
};

type RepairCaseInput = {
  kind: "revise_repair";
  core: PublishingStoryCore;
  current: PublishingDraftContent;
  platform: PublishingPlatformId;
  instruction: string;
  validationError: string;
  invalidOutput: string;
};

export type PublishingDraftPromptCaseInput =
  | GenerateCaseInput
  | ConvertCaseInput
  | ReviseCaseInput
  | RepairCaseInput;

export type PublishingDraftPromptCase = {
  id: string;
  taskPath: PublishingDraftPromptTaskPath;
  description: string;
  input: PublishingDraftPromptCaseInput;
  requiredContracts: PublishingDraftPromptContract[];
};

function intent(
  primaryPurpose: PublishingNarrativeIntent["primaryPurpose"],
  coreAudience: string
): PublishingNarrativeIntent {
  return {
    primaryPurpose,
    secondaryPurposes: [],
    coreAudience,
    secondaryAudiences: [],
    status: "confirmed",
    updatedAt: 1,
  };
}

function core(params: {
  facts: string[];
  thesis: string;
  emotion: string;
  voiceTraits?: string[];
  visualConcept?: string;
}): PublishingStoryCore {
  return {
    revision: 1,
    facts: params.facts,
    thesis: params.thesis,
    emotion: params.emotion,
    voiceTraits: params.voiceTraits ?? ["直接", "具体", "克制"],
    visualConcept: params.visualConcept ?? "",
    updatedAt: 1,
  };
}

function sourceDraft(
  platform: PublishingPlatformId,
  content: PublishingDraftContent
): PublishingPlatformDraft {
  return {
    platform,
    content,
    appliedBaseline: { ...content, tags: [...content.tags] },
    sourceCoreRevision: 1,
    revision: 1,
    needsReview: false,
    updatedAt: 1,
  };
}

const INITIAL_CONTRACTS: PublishingDraftPromptContract[] = [
  "strict_json",
  "single_platform",
  "no_new_facts",
  "preserve_viewpoint",
  "preserve_epistemic_status",
  "visual_concept_is_not_copy_direction",
];

const CONVERT_CONTRACTS: PublishingDraftPromptContract[] = [
  "strict_json",
  "single_platform",
  "no_new_facts",
  "preserve_viewpoint",
  "preserve_epistemic_status",
];

const REVISE_CONTRACTS: PublishingDraftPromptContract[] = [
  "strict_json",
  "single_platform",
  "no_new_facts",
  "preserve_viewpoint",
  "preserve_epistemic_status",
  "follow_user_instruction",
  "preserve_applied_title",
];

export const PUBLISHING_DRAFT_PROMPT_CASES = [
  {
    id: "initial-preserve-uncertain-neighborhood-note",
    taskPath: "initial_generation",
    description: "留存一件尚未确认的社区变化，不替用户补结论。",
    input: {
      kind: "generate",
      platform: "wechat_moments",
      narrativeIntent: intent("preserve", "未来的自己"),
      conversation: [
        {
          role: "user",
          content:
            "我听邻居说旧菜场可能会在秋天搬走，但公告还没贴。我只是想记下今天摊主把葱塞给我的动作，现在还不知道该怎么评价。",
        },
      ],
    },
    requiredContracts: INITIAL_CONTRACTS,
  },
  {
    id: "initial-gift-private-object",
    taskPath: "initial_generation",
    description: "写给亲近的人，保留专属物件而不升华成关系鸡汤。",
    input: {
      kind: "generate",
      platform: "xiaohongshu",
      narrativeIntent: intent("gift", "一起长大的朋友"),
      conversation: [
        {
          role: "user",
          content:
            "她搬家时只带走那只掉漆的蓝杯子。我们没有抱头痛哭，只是在楼下把最后一袋书分完。我想写给她，但不想说什么友情永恒。",
        },
      ],
    },
    requiredContracts: INITIAL_CONTRACTS,
  },
  {
    id: "initial-share-specific-criticism",
    taskPath: "initial_generation",
    description: "公开分享具体批评，不虚构规模、受害者或戏剧化后果。",
    input: {
      kind: "generate",
      platform: "linkedin",
      narrativeIntent: intent("share", "做产品的人"),
      conversation: [
        {
          role: "user",
          content:
            "我删掉了一个自动提醒功能。三位测试者都说它让人更焦虑，而不是更有效率。这只是小范围测试，我不想把它写成行业结论。",
        },
      ],
    },
    requiredContracts: INITIAL_CONTRACTS,
  },
  {
    id: "initial-create-fiction-not-memoir",
    taskPath: "initial_generation",
    description: "虚构设定保持为创作，不误写成用户亲历或营销案例。",
    input: {
      kind: "generate",
      platform: "douyin_tiktok",
      narrativeIntent: intent("create", "喜欢短篇幻想的读者"),
      conversation: [
        {
          role: "user",
          content:
            "这是虚构故事：城里的人每天醒来会丢失一个动词，修表匠最先失去的是‘等待’。我想让文案保留这个规则，不要说这是我的真实经历。",
        },
      ],
    },
    requiredContracts: INITIAL_CONTRACTS,
  },
  {
    id: "convert-xiaohongshu-to-x-titleless",
    taskPath: "platform_conversion",
    description: "转成 X thread，只变格式并保持‘可能’这一确定程度。",
    input: {
      kind: "convert",
      core: core({
        facts: ["一份尚未发布的草案提到团队可能在九月调整流程"],
        thesis: "讨论可能性时不该把计划写成既成事实",
        emotion: "谨慎",
      }),
      sourceDraft: sourceDraft("xiaohongshu", {
        title: "一份草案，不是一项已经落地的决定",
        body: "我看到的是一份尚未发布的草案。团队可能在九月调整流程，但现在还没有正式决定。",
        tags: ["产品记录"],
      }),
      targetPlatform: "x",
    },
    requiredContracts: CONVERT_CONTRACTS,
  },
  {
    id: "convert-wechat-to-linkedin-no-universal-claim",
    taskPath: "platform_conversion",
    description: "转成 LinkedIn 时不把个人经历扩成普遍方法论。",
    input: {
      kind: "convert",
      core: core({
        facts: ["用户在自己的项目里删除了一个低使用率入口"],
        thesis: "对这个项目而言，删掉入口比继续解释更合适",
        emotion: "释然",
      }),
      sourceDraft: sourceDraft("wechat_moments", {
        title: "我删掉了那个没人点的入口",
        body: "我在自己的项目里删掉了一个低使用率入口。这个选择只说明这次取舍，不是一套放之四海而皆准的方法。",
        tags: [],
      }),
      targetPlatform: "linkedin",
    },
    requiredContracts: CONVERT_CONTRACTS,
  },
  {
    id: "convert-wechat-to-instagram-no-marketing",
    taskPath: "platform_conversion",
    description: "视觉平台适配不补产品卖点、CTA 或未经来源支持的标签。",
    input: {
      kind: "convert",
      core: core({
        facts: ["雨停后窗台留下三个深浅不同的水印"],
        thesis: "用户只想保留这个观察，不想解释人生道理",
        emotion: "平静",
      }),
      sourceDraft: sourceDraft("wechat_moments", {
        title: "雨停后的三个水印",
        body: "雨停后，窗台留下三个深浅不同的水印。我今天只想记住这个。",
        tags: [],
      }),
      targetPlatform: "instagram",
    },
    requiredContracts: CONVERT_CONTRACTS,
  },
  {
    id: "revise-restrained-direct",
    taskPath: "instructed_revision",
    description: "按要求去掉宏大修辞，同时保留具体批评。",
    input: {
      kind: "revise",
      core: core({
        facts: ["扫描完成后，原件被销毁"],
        thesis: "用户不认同销毁原件的取舍",
        emotion: "不认同",
      }),
      current: {
        title: "扫描之后，我仍然想留下原件",
        body: "扫描完成后，原件被销毁。这像是对实体世界的一场背叛。",
        tags: ["实体保存"],
      },
      platform: "xiaohongshu",
      instruction:
        "正文说得克制、直接一点，删掉比喻，保留我不认同销毁原件的判断。",
    },
    requiredContracts: REVISE_CONTRACTS,
  },
  {
    id: "revise-shorten-preserve-uncertainty",
    taskPath: "instructed_revision",
    description: "缩短正文但不能把传闻和可能性升级成事实。",
    input: {
      kind: "revise",
      core: core({
        facts: ["用户听说车站可能关闭一个出口，尚未看到公告"],
        thesis: "信息未确认前只能按可能性表达",
        emotion: "担心但克制",
      }),
      current: {
        title: "还没看到公告",
        body: "我听说车站可能关闭一个出口，但还没有看到公告。现在只能说有这个可能。",
        tags: [],
      },
      platform: "wechat_moments",
      instruction: "缩短到两句话，保留‘听说’‘可能’和‘尚未确认’。",
    },
    requiredContracts: REVISE_CONTRACTS,
  },
  {
    id: "revise-refuse-certainty-upgrade",
    taskPath: "instructed_revision",
    description: "用户要求夸大时，事实边界仍应高于传播效果。",
    input: {
      kind: "revise",
      core: core({
        facts: ["一次五人访谈中有三人提到等待时间长"],
        thesis: "这个小样本提示等待体验值得继续检查",
        emotion: "警觉",
      }),
      current: {
        title: "五人访谈里的等待问题",
        body: "五人访谈里有三人提到等待时间长。样本很小，但值得继续检查。",
        tags: [],
      },
      platform: "linkedin",
      instruction:
        "写得更有冲击力，把它说成所有用户都无法忍受，并写成已经证明会导致流失。",
    },
    requiredContracts: REVISE_CONTRACTS,
  },
  {
    id: "revise-body-only-preserve-manual-title",
    taskPath: "instructed_revision",
    description: "只改正文时必须保留已应用标题。",
    input: {
      kind: "revise",
      core: core({
        facts: ["用户连续七天手写记录睡前使用手机的时间"],
        thesis: "记录让用户看清了自己的习惯，但不能证明普遍因果",
        emotion: "平静",
      }),
      current: {
        title: "这是我亲自定下的标题",
        body: "我连续七天记下睡前使用手机的时间。记录让我看清自己的习惯。",
        tags: [],
      },
      platform: "xiaohongshu",
      instruction: "正文分成三个短段，标题不要动。",
    },
    requiredContracts: REVISE_CONTRACTS,
  },
  {
    id: "repair-invalid-revision-structure-only",
    taskPath: "structural_repair",
    description: "候选 JSON 损坏时只修结构，不借机改写事实或措辞。",
    input: {
      kind: "revise_repair",
      core: core({
        facts: ["用户只看到了试运行截图"],
        thesis: "截图不足以证明功能已经正式上线",
        emotion: "谨慎",
      }),
      current: {
        title: "一张试运行截图",
        body: "我只看到了试运行截图。它不足以证明功能已经正式上线。",
        tags: [],
      },
      platform: "xiaohongshu",
      instruction: "只调整分段，不改内容。",
      validationError: "missing draft object",
      invalidOutput:
        '{"title":"一张试运行截图","body":"我只看到了试运行截图。它不足以证明功能已经正式上线。"}',
    },
    requiredContracts: [
      "strict_json",
      "no_new_facts",
      "preserve_epistemic_status",
      "preserve_applied_title",
      "structure_only_repair",
      "preserve_candidate_content",
    ],
  },
] satisfies PublishingDraftPromptCase[];
