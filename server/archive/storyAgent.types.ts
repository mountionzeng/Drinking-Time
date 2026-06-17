import type {
  ShotPromptComposition,
  VisualAnchorForPrompt,
} from "../services/shotPromptComposer";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type StoryCardPayload = {
  content: string;
  rawText: string;
  sourceQuote?: string;
  emotion?: string;
  emotionOptions?: string[];
  emotionBlend?: string[];
  intensity?: number;
  direction?: string;
  complexity?: string;
  trigger?: string;
  dramaticFunction?: string;
  personalTrace?: string;
  // 第 10 模块对应：kNN / 相似度检索。以后接 embedding 后，可用这句话去找相似记忆。
  retrievalQuery?: string;
  // 第 10 模块对应：Clustering。先让模型给出主题线索，后续可替换成自动聚类标签。
  themeHints?: string[];
  // 第 10 模块对应：DBSCAN / outlier。记录“不属于普通主题但可能很有戏”的异常故事点。
  outlierSignal?: string;
  // 第 10 模块对应：GMM soft membership。真实人生片段通常同时属于多个主题。
  softMembership?: string[];
};

export type SimilarStoryCardPayload = {
  content: string;
  rawText?: string;
  emotion?: string;
  emotionBlend?: string[];
  retrievalQuery?: string;
  themeHints?: string[];
  personalTrace?: string;
  score?: number;
};

export type VisualAnchorPayload = {
  title: string;
  imageUrl?: string;
  objective?: string;
  aesthetic?: string;
  prompt?: string;
  visualStyle?: string[];
  mood?: string[];
  colorPalette?: string[];
} & VisualAnchorForPrompt;

export type HumanityTrait =
  | "defensive"
  | "performing"
  | "numb"
  | "romantic"
  | "reflecting"
  | "nostalgic"
  | "conflicted";

export type HumanityRead = {
  trait: HumanityTrait;
  note: string;
};

// ── 工具调用类型（手机端出图用） ──
export type GenerateImageToolCall = {
  name: "generateImage";
  prompt: string;       // 图片生成 prompt
  shotNo?: number;      // 绑定到第几镜
};

export type ToolCall = GenerateImageToolCall;

export type StoryAgentChatResult = {
  reply: string;
  card: StoryCardPayload | null;
  read: HumanityRead | null;
  configured: boolean;
  modelLabel: string;
  toolCalls: ToolCall[];           // 手机端出图工具调用
  suggestImage: boolean;           // 是否建议生成图片
};

export type StoryChatIntentPayload = {
  purpose: string;
  audience?: string;
  platform?: string;
  desiredEffect?: string;
  tone?: string;
  targetRole?: string;
  channel?: string;
};

export type ShotCharacter = {
  name: string;
  role: string;
  oneLiner: string;
};

/**
 * 叙事位置（beat）—— 一镜在故事弧线上的位置。模型在 synthesize 时给每镜一个 beat，
 * 让一段镜头表既是「画面表」也是「故事结构表」。四阶用最朴素的中文，避免学院派术语。
 *   - 开场：establishing。第一刻的钩子，可以是空镜、地点、一个未解的画面
 *   - 起势：setup / development。事情开始发生、人物上场、关系铺开
 *   - 转折：turn / climax。最重的一刻，承重的转向
 *   - 收束：coda / closing。落点，留白，回应开场
 * 一段故事大体走 开场 → 起势×N → 转折 → 收束，但具体走几次起势看素材。
 */
export type ShotBeat = "开场" | "起势" | "转折" | "收束";

export type ShotEntry = {
  shotNo: number;
  // ── 主线（默认可见）──
  subject: string;     // 主体：谁/什么在画面里
  action: string;      // 主体的动作 / 发生的事件
  dialogue: string;    // 台词原话
  shotType: string;    // 景别：远 / 全 / 中 / 近 / 特 / 大特
  beat: ShotBeat;      // 这一镜在故事弧线上的位置（开场/起势/转折/收束）
  // ── 技术细节（默认折叠）──
  cameraAngle: string; // 机位：平视 / 俯 / 仰 / 过肩 / 顶视
  cameraMove: string;  // 运镜：静止 / 推 / 拉 / 摇 / 移 / 跟 / 升降 / 手持
  location: string;    // 场景 / 地点
  timeLight: string;   // 时间 · 光：清晨/黄昏/夜；柔光/侧逆/顶光
  mood: string;        // 氛围 · 色调：暖/冷/灰雾/高饱
  sound: string;       // 环境声 / 音效
  styleRef: string;    // 风格参考：王家卫/纪录片/35mm 胶片 等
  // ── 内部 / 不展示给用户的列 ──
  note: string;             // 技术备注
  emotion: string;          // 情感词（1-3 字）
  // 回溯到原素材；模型自己加的连接镜（establishing / 反应镜 / coda）此字段为空字符串。
  sourceCardContent: string;
} & Partial<ShotPromptComposition>;

export type ShotListPayload = {
  characters: ShotCharacter[];
  arc: string;       // 一句话情感弧线（≤30 字）—— 偏感受
  logline: string;   // 一句话故事 pitch（≤30 字）—— 偏剧情
  theme: string;     // 故事底下没说出口的意思（≤25 字）—— 偏意义
  variants: Array<{
    mode: "克制版" | "戏剧版" | "诗意版";
    logline: string;
    arc: string;
    treatment: string;
  }>;
  boringCheck: {
    hasConflict: boolean;
    hasTurn: boolean;
    hasWish: boolean;
    hasCost: boolean;
    hasChange: boolean;
    note: string;
  };
  shots: ShotEntry[];
  configured: boolean;
  modelLabel: string;
};

// 给 chat agent 看的"轻量镜头表草稿"——只送 11 个用户可见列 + shotNo
export type ShotDraft = {
  shotNo: number;
  subject: string;
  action: string;
  dialogue: string;
  shotType: string;
  cameraAngle: string;
  cameraMove: string;
  location: string;
  timeLight: string;
  mood: string;
  sound: string;
  styleRef: string;
};

export type SummaryPayload = {
  summary: string;
  configured: boolean;
  modelLabel: string;
};

export type StoryIntentPurpose =
  | "personal_memory"
  | "social_post"
  | "linkedin_job_search"
  | "portfolio"
  | "gift"
  | "relationship_record"
  | "fiction"        // 讲别人的故事 / 虚构叙事（编故事，不是挖真实回忆——会改变小酌聊法）
  | "product_intro"  // 介绍自己的产品（收拢原 brand_promo + pitch；投资人/客户由 audience 区分）
  | "creative_expression"
  | "exploration";

export type StoryIntentPlatform =
  | "unknown"
  | "wechat"
  | "xiaohongshu"
  | "douyin"
  | "bilibili"
  | "linkedin"
  | "portfolio_site"
  | "presentation"
  | "private_archive";

export type StoryIntentAudience =
  | "self"
  | "specific_person"
  | "friends"
  | "public"
  | "recruiters"
  | "clients"
  | "investors"
  | "teammates"
  | "unknown";

export type StoryIntentPayload = {
  purpose: StoryIntentPurpose;
  audience: StoryIntentAudience;
  platform: StoryIntentPlatform;
  desiredEffect: string;
  tone: string;
  confidence: number;
  evidence: string[];
  missingQuestion: string;
  targetRole?: string;
  channel?: string;
};

export type StoryIntentResult = StoryIntentPayload & {
  configured: boolean;
  modelLabel: string;
};
