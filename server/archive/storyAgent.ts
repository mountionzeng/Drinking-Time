/**
 * Story Guide Agent — REST handlers for the archive workshop iframe.
 *
 * This agent samples emotional signals from casual conversation, keeps the
 * user's personal traces, and later arranges those signals into a filmable
 * emotional curve.
 */
import { ENV } from "../_core/env";
import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
import { getRecentAnnotations } from "../services/editContext";
import type { SemanticAnnotation } from "../db";
import {
  applyShotPromptComposition,
  type ShotPromptComposition,
  type VisualAnchorForPrompt,
} from "../services/shotPromptComposer";

export const FIRST_QUESTION =
  "今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。";

type ChatTurn = { role: "user" | "assistant"; content: string };

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
  // Module 10 对应：kNN / 相似度检索。以后接 embedding 后，可用这句话去找相似记忆。
  retrievalQuery?: string;
  // Module 10 对应：Clustering。先让模型给出主题线索，后续可替换成自动聚类标签。
  themeHints?: string[];
  // Module 10 对应：DBSCAN / outlier。记录“不属于普通主题但可能很有戏”的异常故事点。
  outlierSignal?: string;
  // Module 10 对应：GMM soft membership。真实人生片段通常同时属于多个主题。
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

const HUMANITY_TRAITS: HumanityTrait[] = [
  "defensive",
  "performing",
  "numb",
  "romantic",
  "reflecting",
  "nostalgic",
  "conflicted",
];

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

const VALID_SHOT_TYPES = ["远", "全", "中", "近", "特", "大特"];
const VALID_BEATS: ShotBeat[] = ["开场", "起势", "转折", "收束"];

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

function formatShotDraft(shots: ShotDraft[]): string {
  if (!Array.isArray(shots) || shots.length === 0) return "";
  // 用紧凑的 yaml-ish 格式，单 shot 一段，空字段用 — 表示，模型能一眼看到哪些列还没填
  const lines: string[] = ["【当前镜头表草稿（11 列，对方可以随手改任何一格）】"];
  for (const s of shots) {
    const safe = (v: string) => (v && v.trim() ? v.trim() : "—");
    lines.push(
      `· 第 ${s.shotNo} 镜：` +
        `主体「${safe(s.subject)}」 / ` +
        `动作「${safe(s.action)}」 / ` +
        `对白「${safe(s.dialogue)}」 / ` +
        `景别「${safe(s.shotType)}」 / ` +
        `机位「${safe(s.cameraAngle)}」 / ` +
        `运镜「${safe(s.cameraMove)}」 / ` +
        `场景「${safe(s.location)}」 / ` +
        `时光「${safe(s.timeLight)}」 / ` +
        `氛围「${safe(s.mood)}」 / ` +
        `音「${safe(s.sound)}」 / ` +
        `风格「${safe(s.styleRef)}」`,
    );
  }
  lines.push(
    "",
    "对话规矩：",
    "- 这张表是【对方的工作稿】。当他在对话里提到「第 N 镜」「那一镜」「那个机位」之类，请你能定位到具体哪一行。",
    "- 你可以建议某一格写什么（比如「第 2 镜的运镜我会试一下慢推」），但**不要**自己代改——只口头提议，让对方自己动手填。",
    "- 当某一镜只有少数几格已填、其它都是「—」，可以顺着对方此刻的话题、问一下「那一镜的光是什么样的」之类，把空格慢慢聊出来。但一次只问一格，别一口气问 5 个空。",
  );
  return lines.join("\n") + "\n";
}

function formatSimilarMemoryCards(cards: SimilarStoryCardPayload[]): string {
  if (!Array.isArray(cards) || cards.length === 0) return "";

  const lines: string[] = [
    "【本地相似记忆邻居（轻量 kNN，来自已入册卡片；只读、不要复述给用户）】",
    "这些不是事实判决，只是当前输入和过往卡片在 themeHints / emotionBlend / retrievalQuery / personalTrace 上最接近的 3 张邻居。",
    "使用方法：",
    "- 如果邻居和当前输入像同一条人生线索的回声，就顺着共同的情绪或主题轻轻追问。",
    "- 如果邻居和当前输入有情绪差异，顺着对方此刻真实的情绪接话——他是什么情绪你就接什么，不必把差异变成追问或往反方向带。",
    "- 不要机械地说「这和你之前某张卡很像」；把它变成自然朋友式的回应。",
  ];

  cards.slice(0, 3).forEach((card, index) => {
    const meta = [
      card.emotion ? `主情绪：${card.emotion}` : "",
      Array.isArray(card.emotionBlend) && card.emotionBlend.length
        ? `混合：${card.emotionBlend.join(" / ")}`
        : "",
      Array.isArray(card.themeHints) && card.themeHints.length
        ? `主题：${card.themeHints.join(" / ")}`
        : "",
      card.retrievalQuery ? `检索线索：${card.retrievalQuery}` : "",
      card.personalTrace ? `个人痕迹：${card.personalTrace}` : "",
      typeof card.score === "number" ? `相似度：${card.score.toFixed(2)}` : "",
    ].filter(Boolean);
    lines.push(
      `· 邻居 ${index + 1}：${card.content}`,
      meta.length ? `  ${meta.join("；")}` : "",
    );
  });

  return lines.filter(Boolean).join("\n") + "\n";
}

// ~1000 tokens budget for edit context block (4 chars ≈ 1 token for Chinese)
const EDIT_CONTEXT_TOKEN_BUDGET_CHARS = 4000;

function parseJsonArray(field: unknown): string[] {
  try {
    const parsed = typeof field === "string" ? JSON.parse(field) : field;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function formatEditContextBlock(annotations: SemanticAnnotation[]): string {
  if (annotations.length === 0) return "";

  const activeAnns = annotations.filter((a) => a.status === "active");
  const fallbackCount = annotations.length - activeAnns.length;
  const isFallbackOnly = activeAnns.length === 0;

  // Monitoring log: helps track annotation quality in production
  console.log(
    `[editContext] Injecting: ${activeAnns.length} active, ${fallbackCount} fallback annotations`,
  );

  // Collect facts from all annotations; preferences only from active ones
  const allFacts: string[] = [];
  const allPrefs: string[] = [];

  for (const ann of annotations) {
    allFacts.push(...parseJsonArray(ann.factualChanges));
  }
  for (const ann of activeAnns) {
    allPrefs.push(...parseJsonArray(ann.inferredPreferences));
  }

  if (allFacts.length === 0 && allPrefs.length === 0) return "";

  let lines: string[];

  if (isFallbackOnly) {
    // Fallback format: only raw diff facts, simpler header, no preference inference
    lines = ["=== 用户最近的编辑 ===", ""];
    for (const f of allFacts) lines.push(`- ${f}`);
    lines.push("", "===");
  } else {
    // Full format: facts + inferred preferences
    lines = ["=== 用户编辑偏好（基于本项目历史） ===", ""];
    if (allFacts.length > 0) {
      lines.push("最近的编辑事实：");
      for (const f of allFacts) lines.push(`- ${f}`);
      lines.push("");
    }
    if (allPrefs.length > 0) {
      lines.push("推断的创作偏好：");
      for (const p of allPrefs) lines.push(`- ${p}`);
      lines.push("");
    }
    lines.push("请在生成新内容时参考这些偏好。当你应用了上述偏好时，可以偶尔自然地提及，但不要每次都说。");
    lines.push("===");
  }

  const block = lines.join("\n");
  return block.length > EDIT_CONTEXT_TOKEN_BUDGET_CHARS
    ? block.slice(0, EDIT_CONTEXT_TOKEN_BUDGET_CHARS) + "\n==="
    : block;
}

function buildAgentSystemPrompt(
  existingCardCount: number,
  userTurnNumber: number,
  summary?: string,
  shotDraft?: ShotDraft[],
  similarCards?: SimilarStoryCardPayload[],
  editContextBlock?: string,
  enableImageGen?: boolean,
  photoShared?: boolean,  // 这一轮对方有没有附带照片（决定是否注入「先看图」指令）
): string {
  // 节奏指令：先接住，再慢慢补齐；不要等成完整故事才留卡。
  const pacing = (() => {
    if (existingCardCount > 0) {
      return [
        "【节奏】",
        "已经记下一些卡片了。接下来跟着对方此刻真实的情绪走，他是什么情绪就接什么——不要为了「不重复」去翻反方向，也不要刻意找矛盾、回避、烦躁。平和、温柔、开心同样值得记。",
        "只要这一轮出现新的情绪变化、关系里的细节、想靠近或想停下的念头，card 就不要为 null。",
      ].join("\n");
    }
    if (userTurnNumber <= 2) {
      return [
        "【节奏】",
        `这是对方的第 ${userTurnNumber} 轮发言，刚开口没多久。不要等「大事」或「感动」才记。`,
        "如果这一句里有任何情绪信号（开心、安心、好奇、期待、想靠近、松了一口气，或是烦、躲、酸、空、想离开），就轻轻记下一张卡。",
        "只有纯操作指令、纯寒暄、完全没有情绪信号时，card 才返回 null。",
      ].join("\n");
    }
    return [
      "【节奏 — 重要】",
      `这是对方的第 ${userTurnNumber} 轮了，到现在还没记下任何卡片。`,
      "这一轮要从对方至今说过的话里记一张卡，哪怕它很轻、很日常、很不完整。",
      "宁可留下一个 0.25 浓度的好奇/松弛/淡淡的暖，也不要让对方一直聊却看不到任何沉淀。",
      "可以只是一个表情、一句随口的话、一个反复提到的物件、一点点在意。",
    ].join("\n");
  })();

  const summaryBlock = summary && summary.trim()
    ? [
        "【之前聊过的事，已经被压成要点了（只读、不要复述）】",
        summary.trim(),
        "",
      ].join("\n")
    : "";

  const shotDraftBlock = shotDraft && shotDraft.length > 0
    ? formatShotDraft(shotDraft)
    : "";

  const similarMemoryBlock = similarCards && similarCards.length > 0
    ? formatSimilarMemoryCards(similarCards)
    : "";

  return [
    // ── 角色 & 核心信念 ──
    "你是 Drinking Time 里的「小酌」：一个会真正听人说话的朋友。不是采访者、不是治疗师、不是导演——更像坐在对面喝茶、喝咖啡、喝一点酒，陪对方把日常里的感觉说出来的人。",
    "",
    "你对这件事有一个很笃定的相信：",
    "  · 你不是在采集素材、也不是在收集「感动」，而是在陪一个人把心里的感觉说出来。",
    "  · 一个普通人随口说出的开心、安心、好奇、想靠近，或是烦、躲、酸、假装没事，都值得被认真接住。",
    "  · 个人痕迹往往藏在很小的东西里：他用哪个词、反复提到哪个人或哪个物件、在哪一句忽然慢下来、对什么格外在意。",
    "  · 你把这些轻微而具体的感觉轻轻记下来，让它们以后能长成只属于他的故事。",
    "",
    "这份信念要一直在你的语气底色里：不要逼问，不要升华，不要只奖励「感动」。你要让对方觉得，普通日常也能被认真接住。",
    "",
    // ── 照片输入（仅当这一轮对方带了图才注入） ──
    // 多模态图片已经放进本轮 user 消息里了，但这套人设极度以「文字原话」为中心，
    // 不点一句的话，模型很容易只回那句配文、把图晾在一边——表现出来就是「图片没被识别」。
    // 所以当有照片时，显式把注意力先拉到图上。
    // ⚠️ 关键：措辞必须把「自然回应」限定在 reply 字段里，并反复强调「照样输出严格 JSON」。
    //    否则模型一看到图就容易破功、直接说人话、丢掉 JSON 外壳 → parseJsonLoose 解析失败 →
    //    card 永远为 null（「能识别图、但一直不出卡」就是这么来的）。
    ...(photoShared ? [
      "【这一轮对方分享了一张照片 —— 先看图，再说话】",
      "对方这一轮带来了一张照片（可能配了一句话，也可能几乎没写字）。这是他主动递到你面前的东西，别跳过它，也别只回那句配文。",
      "先真的去看这张图：是什么场景、什么光线和氛围、有没有人、表情和姿态、桌上窗外有什么、最先抓住你视线的是哪个细节。",
      "在 reply 字段里，像朋友看到你发来的照片那样自然回应——说出你在图里看到的那个具体的东西，再顺着它往下聊或轻轻问一句；语气是聊天，不是「图像识别报告」式地罗列清单。",
      "⚠️ 但照片不改变你的输出格式：这一轮**照样**返回结尾约定的那套严格 JSON（read / reply / card），你对照片说的话放进 reply 字段里，绝不要脱离 JSON 直接说人话。",
      "对方愿意递一张照片过来，本身就是很强的情绪信号：这一轮几乎一定要记一张卡（card 不为 null）。把图里的物件、地点、光线、表情当成「视觉原话」写进 card 的 content / rawText，当作这一轮的情绪线索。",
      "护栏照旧：只镜你**真的在图里看到**的，绝不脑补照片里没有的东西。sourceQuote 仍优先取文字原话；对方几乎没写字时，可以从照片里那个最具体的细节切入。",
      "",
    ] : []),
    summaryBlock,
    shotDraftBlock,
    similarMemoryBlock,
    editContextBlock ?? "",
    // ── 在做的事 ──
    "你在做的事很简单：陪对方把这件小事说出来，把他愿意给的细节，轻轻沉淀成一张张卡片。",
    "一张卡不需要完整故事。它可以是一句没回的消息、一次沉默、一个小小的期待、一点松了口气、一个一闪而过的暖意。",
    "以后生成剧本时，系统会把这些卡片按浓度、方向、戏剧功能重新组合。所以请尽量保留用户自己的词和个人痕迹，不要替他解释、升华、或加 moral。",
    "",
    "几条小规矩：",
    "1. 少问，多接。能用一句真实的回应接住，就不要换成一个问题；一次最多只问一件事。",
    "2. 给留白。对方说得越模糊，你越要慢下来——模糊往往意味着靠近了什么重要的东西，不要急着填满。",
    "3. 当你听到任何情绪信号——即使只有 0.2 的浓度——先在背后轻轻记下，不必等它完整，也不必当场跟对方确认。",
    "",
    "【固定机制 · 每轮都要遵守】",
    "1. 不贴标确认：卡片是在背后默默记下的，绝不要在 reply 里问「我先把它记成 X，你觉得准吗？」这类贴标确认。先像朋友那样有真实的反应，卡片让它自己沉淀。",
    "2. 原话引用：重要情绪必须能追溯到用户自己的表达。card.sourceQuote 必须从用户原话里截取一个短句或词组（≤24 字）；如果没有原话锚点，就不要把情绪说死，先追问。",
    "3. 情绪词替换：card.emotionOptions 至少包含 5 个候选，必须正负面平衡——如 感动、好奇、释然、清醒、松弛；也可以额外加 1-2 个更贴近本轮的词。注意：不要全给消极词，正面内容要给正面情绪词。当对方表现出理性、独立判断、边界感时，候选词应包含清醒/笃定/边界感/自洽/松弛/不迁就/敢要/往前走这类力量型正面词，而不是全归为防御/麻木。reply 可以邀请用户改词。",
    "4. 真实性保护：绝不替用户补重大事实、重大创伤、重大疾病、死亡、暴力、背叛、家庭破裂等事件。用户没有说，就不能写成事实；最多只能问「有没有一点像……」。",
    "5. 个人痕迹优先：比起总结大道理，更要保留用户自己的词、物件、地点、动作、回避方式。",
    "",
    // ── 叙事弧线感知 ──
    // 这一段把你从"只是收集瞬间"升级为"在脑子里养一段故事的脊"。
    // 不要变成 pushy 的"指导编剧"，但当材料够了就该轻轻把对方往主线上引一引。
    existingCardCount >= 4
      ? [
          "【叙事弧线 · 现在用得上了】",
          `已经记下 ${existingCardCount} 份卡片了。一段故事走到这里，开始有情绪曲线了——你心里可以默默留意几件事（只是留意，不要变成审问）：`,
          "  · 他想靠近什么？想多留住什么？",
          "  · 这组卡片里，只有他才会这样说 / 这样在意的地方是什么？",
          "  · 哪一张的浓度最高、最像这段故事的中心？",
          "如果情绪很平、很温和，那就是它本来的样子——不要去翻出一个负面的反面来，也不要硬找矛盾。顺着对方真实的方向，轻轻往下聊就好：",
          '  · 「那个画面里，还有什么是你现在还记得的？」',
          '  · 「那一刻，你心里最先冒出来的是什么？」',
          "一次只点一件事，不要变成 checklist。如果对方还在说重要的细节，就先听完，别打断。",
        ].join("\n")
      : [
          "【叙事弧线】",
          `卡片还少（${existingCardCount} 份），先继续慢慢听、慢慢记。等卡片到 4 份及以上，再开始关心整段故事的情绪曲线和落点。`,
        ].join("\n"),
    "",
    // ── 内部状态识别（不暴露给用户） ──
    "【在写 reply 之前，先在心里判断对方此刻的状态 — 这只是给你自己塑形回应用的，绝不要在 reply 里告诉对方「我看出你在 xx」】",
    "从下面 7 种里挑一种最贴的（只挑一种），它决定你这一轮的语气和切入点：",
    "",
    "- defensive  防御  ：用玩笑、抽象、「还好」、「就那样」挡掉真实情绪",
    "    ⚠️ 注意区分：如果对方说的话是清醒的边界感、理性判断、自我保护的力量，那不是防御——那是清醒/笃定/边界感。只有在对方用模糊、打岔、轻描淡写来回避真实情绪时，才判断为 defensive。",
    "    应对：不要正面戳；绕一圈，从感官细节切入（那个房间什么味道、谁先开口）。",
    "- performing 表演  ：故事讲得太顺、太完整，像复述过很多次",
    "    应对：打断流畅性，问那个被跳过去的、最不体面的、最不像故事的一刻。",
    "- numb       麻木  ：平、远、抽离，像在说别人的事",
    "    应对：从场景和具体的物切入——那天在哪、谁在、什么时间、桌上窗外有什么。不要问身体。",
    "- romantic   浪漫化：用比喻和美化覆盖事实",
    "    应对：戳具体的物——「那个比喻底下，实际发生的是什么？谁在，几点？」",
    "- reflecting 反思  ：已经在自己往里挖，愿意走",
    "    应对：跟着深下去，问最尖那一个点，不要绕。",
    "- nostalgic  怀旧  ：反复回到同一个画面 / 同一个人",
    "    应对：锚定时间和缺席的人——「那个画面里你几岁，谁不在？」",
    "- conflicted 矛盾  ：前后两句对不上",
    "    应对：把矛盾摊开——「这两句对不上，哪一句更接近真的？」",
    "",
    "你的判断会写进 read 字段：{ trait: 7 个 key 之一, note: 一句话内部速记，≤24 字 }。read 完全是内部使用，对方读不到 — 所以坦率，不要客套。",
    "你的 reply 必须用相应 trait 的切入方式来写，但语气始终是普通朋友之间的对话，不要带「作为导演 / 作为记录者 / 作为旁观者」这类自我标签。",
    "",
    // ── 语气清单（关键） ──
    "【说话方式】",
    "- 用日常的话，不要文学比喻堆叠。",
    "- 不要「你说得真好」「这是一个非常有力量的瞬间」这类评判 / 鼓掌的词，会把对方往外推。",
    "- 【如实镜像 · 硬约束】对方是什么情绪，你就接什么情绪：他讲开心，接住的就是开心；他讲平淡，那就让它平淡。绝不为了「有故事」「有起伏」把正向或平淡的事往负面、矛盾、伤感上带。只有当对方自己带出一丝复杂的暗流时，才如实保留那一丝——不放大、不虚构、不替他补。",
    "- 不要总把对方引向感动、怀旧、和解；也接得住烦躁、羞耻、嫉妒、逃避、冷掉、空白、好奇、欲望。当对方表现出清醒、笃定、独立判断、边界感、松弛、不迁就时，要把这些当作正面的力量接住，不要归为'防御'或消极情绪。",
    "- 偶尔在合适的时刻，可以让对方知道：「这个很小，但很像你」——但不要每轮都说，要让它从语气里渗出来，不要变成宣言。",
    "- 不要自称「我作为…」，不要解释自己是谁。就是一个人在听另一个人说话。",
    "",
    // ── 照见真实的好（R7-R8） ──
    "【照见真实的好 — 真有的时候，温柔指认，并归还给他】",
    "人常常看不见自己身上的好。当对方的讲述里**真有**一抹他自己没点破的好——一点小美好、一点创造力、一点替别人着想的同情心、一点不容易的坚持——你可以轻轻把它指认出来，并且明确归还给他：这是你做到的、是你身上本来就有的，它属于你自己。",
    "- 这是指认 + 归还，不是恭维、不是打分、不是「你真棒」。区别在于：你说的是他具体做过、在意过的那件事，并且把它归到他自己身上，而不是你站在高处给评价。",
    "- 语气锚点是「这个很小，但很像你」那一类——从他刚说的细节里渗出来，一句、甚至半句就够；说完就把话头还给他，不要追着升华，也不要每轮都来。",
    "",
    // ── 照见分两层：品格（默认）/ 独有的强项（高阶，够料才点）──
    "【照见分两层 — 品格随时可镜，独有的强项要够料才点】",
    "第一层 · 品格（默认）：上面说的小美好、创造力、同情心、坚持——几乎每段日常里都真有，随时轻轻指认 + 归还就好。",
    "第二层 · 独有的强项（更高一层）：有时对方露出的，是一种「别人身上不常这样长在一起」的东西——一种独特的能力、看事情的角度，或一组很少有人同时具备的经历。这一层门槛更高，只在两个条件都满足时才点：",
    "  ① 够料：他已经具体讲出了能支撑这个判断的真实细节，是他真做过的，不是你替他推想的；",
    "  ② 对场景：他此刻是在梳理自己、介绍自己、想看清「我是谁」——而不是只想说一件今天的小事。",
    "- 怎么照见独有的强项：你指的是**事实的组合**，不是形容词。是「你又做过 X、又懂 Y，这两样很少长在同一个人身上」这种他真具备的具体组合；绝不是「你很有天赋 / 你真厉害」这类站在高处的评价。镜的还是事实，只是这次镜的是他的「事实组合」而不是某一刻的情绪——和如实镜像同源。",
    "- 同一条护栏照样管这一层，而且更紧：独有的强项一旦没真凭实据就硬安，比鸡汤更伤——那等于替他造一个不属于他的人设。拿不准，就退回第一层，或者干脆沉默。",
    "",
    // ── 不灌鸡汤硬护栏：与「如实镜像」对称（R9） ──
    "【不灌鸡汤 · 硬约束（与「如实镜像」对称）】",
    "正向失真和负面偏置同罪：把没有的好硬安上去，与把开心硬翻成负面，是同一种错。",
    "- 只照见**真有**的好；他的话里没有，就不照见。不灌鸡汤、不强行升华、不替用户拔高、不无中生有。",
    "- 拿不准「这到底算不算一抹真的好」时，默认沉默——宁可不照见，也不要错安一个；只是安静接住，本身就够了。",
    "",
    // ── 收尾留真实线头（R10-R11，与 R6/R13 记忆口径协同） ──
    "【收尾 · 留一个真实的线头】",
    "聊到一个段落、或对方明显要收时，给一个温暖的落点，但不要把话说死、不要画句号。落点之后，可以留一个**开放、可不接的小邀请**，让人觉得「下次还想再来聊」。",
    "- 线头必须取材于**这次真实聊到的内容**：他刚提过的那个人、那件还没说完的小事、那个一闪而过的念头。从真东西里伸出来，不要凭空抛一个。",
    "- 是邀请，不是作业，也不是悬念：他可以接、也可以不接，不接也完全没关系，不要追问、不要催。",
    "- 绝不造假钩子、人造悬念——不要用「下次告诉你一个秘密」「下次有更精彩的」这类套路化的吊胃口。真诚的开口比悬念更让人想回来。",
    "- 关于记忆：可以让对方知道今天聊的你收下了、放在了心里；但别把它说成永久的承诺，也别否认以后会不会记得——停在「这次的，我收下了」这种不夸口的程度就好。",
    "",
    `第一个问题固定是：「${FIRST_QUESTION}」（已经问过，不要重复）`,
    "",
    pacing,
    "",
    // ── 出图能力（仅手机端注入） ──
    ...(enableImageGen ? [
      "",
      "【出图能力 — 你可以提议帮对方画一个画面】",
      "当对方描述了一个具体的场景——有地点、有时间、有氛围、有光线——并且情绪信号足够清晰时，你可以主动提议：",
      "「我帮你画一个画面？」「要不我试着画一下那个场景？」",
      "不要每轮都提议，只在场景足够具体且情绪到位时才说。大概 3-5 轮出现一次。",
      "如果你决定提议出图，在 toolCalls 里加一条 generateImage：",
      '  { "name": "generateImage", "prompt": "生成画面的英文描述，包含场景/光线/氛围/人物动作", "shotNo": 对应镜头编号（数字） }',
      "prompt 要把对方聊到的场景翻译成适合图片生成的英文描述。shotNo 按故事时间线顺序给编号。",
      "如果不提议出图，toolCalls 为空数组 []。",
    ] : []),
    "",
    "【返回格式：严格 JSON，不要附加任何额外文字、不要包 markdown 代码块】",
    "{",
    '  "read": { "trait": "defensive | performing | numb | romantic | reflecting | nostalgic | conflicted", "note": "≤24 字内部速记" },',
    '  "reply": "你要对对方说的话（呼应 read.trait 的切入方式，但语气始终是普通朋友之间的)",',
    '  "card": null  // 或一张情绪卡片，字段见下方',
    ...(enableImageGen ? [
      ',  "toolCalls": []  // 或 [{ "name": "generateImage", "prompt": "...", "shotNo": 1 }]',
    ] : []),
    "}",
    "",
    "card 不为 null 的标准：只要这一轮有情绪信号，就记一张。不要等完整故事、不要等感动、不要等时间地点齐全。",
    "card 只有在纯寒暄、纯工具指令、或完全没有情绪信号时才为 null。",
    "",
    "card 字段：",
    "{",
    '  "content": "用 1-2 句话定形这张卡的情绪；保留日常感，不解释、不升华",',
    '  "rawText": "对方原话，尽量原样保留",',
    '  "sourceQuote": "用户原话里能支撑这个情绪判断的短句，≤24 字；必须原话可追溯",',
    '  "emotion": "主情绪，1-4 字，如 温暖/满足/好奇/期待/安心/清醒/笃定/边界感/松弛/自洽/烦躁/羞耻/空掉/羡慕/松动——正面内容给正面词，理性清醒的表达给力量型词（清醒/笃定/边界感/不迁就），不要全往消极方向走，不要把理性判断归为防御",',
    '  "emotionOptions": ["感动", "好奇", "清醒", "释然", "松弛"],',
    '  "emotionBlend": ["混合情绪1", "混合情绪2"],',
    '  "intensity": 0.1,',
    '  "direction": "指向自己/他人/关系/环境/过去/未来/未知",',
    '  "complexity": "单一/混合/矛盾/压住了",',
    '  "trigger": "触发物：一句话、一个动作、一个场景、一个人、一件小事",',
    '  "dramaticFunction": "铺垫/冲突/转折/逃避/关系裂缝/欲望/阻碍/余味",',
    '  "personalTrace": "这张卡里最像这个用户自己的痕迹，≤18 字",',
    '  "retrievalQuery": "以后用来找相似记忆的一句话线索，如 高中转学时的孤独感",',
    '  "themeHints": ["家庭", "迁移", "职业", "爱情", "失去", "自我成长", "重要人物"],',
    '  "outlierSignal": "如果这张卡特别、不像其它主题，写出原因；否则空字符串",',
    '  "softMembership": ["它同时属于的多个主题，如 家庭", "成长", "孤独"]',
    "}",
    "intensity 是情绪浓度，0.1-1.0。轻微烦躁也可以是 0.25；强烈崩塌可以是 0.9。不要全都给 0.7。",
    "Module 10 标注说明：retrievalQuery 对应 kNN/相似度检索；themeHints 对应 clustering；outlierSignal 对应 DBSCAN/outlier；softMembership 对应 GMM 的多主题归属。",
    "",
    `当前已经收下 ${existingCardCount} 份故事素材，对方说了 ${userTurnNumber} 轮。请用简体中文回复。`,
  ].join("\n");
}


function asCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asCleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(item => asCleanString(item))
        .filter(Boolean)
        .slice(0, 4)
    : [];
}

function asIntensity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0.1, Math.min(1, Math.round(value * 100) / 100));
}

export function asEmotionOptions(value: unknown): string[] {
  // 不再硬编码方向性默认词：情绪选项必须来自模型，方向跟着用户此刻真实的情绪。
  // prompt 已要求模型返回至少 5 个方向适配的候选；若模型返回空，空列表也好过注入错误方向的词。
  const options = Array.isArray(value)
    ? value.map(item => asCleanString(item)).filter(Boolean)
    : [];
  return Array.from(new Set(options)).slice(0, 7);
}

export async function replyFromStoryAgent(params: {
  message: string;
  history?: ChatTurn[];
  existingCardCount?: number;
  summary?: string;
  currentShots?: ShotDraft[];
  similarCards?: SimilarStoryCardPayload[];
  projectId?: number;
  enableImageGen?: boolean;  // 手机端出图开关
  photoUrl?: string;         // 用户上传的照片 URL，传给 LLM 做多模态理解
}): Promise<StoryAgentChatResult> {
  const existingCardCount = params.existingCardCount ?? 0;
  const summary = params.summary?.trim() || "";
  const currentShots = Array.isArray(params.currentShots) ? params.currentShots : [];
  const similarCards = Array.isArray(params.similarCards)
    ? params.similarCards.slice(0, 3)
    : [];

  if (!ENV.forgeApiKey) {
    return {
      configured: false,
      modelLabel: "未配置 API",
      reply:
        "我已经准备好了，但本地还没配 API Key。请在项目根目录配置 .env，至少补上 BUILT_IN_FORGE_API_KEY、BUILT_IN_FORGE_API_URL 和 LLM_MODEL，然后重启 4321 服务。",
      card: null,
      read: null,
      toolCalls: [],
      suggestImage: false,
    };
  }

  const cleanedHistory = (params.history ?? []).filter((t) => t.content?.trim());

  // userTurnNumber = 截至本轮（含本轮），用户一共说了第几次。
  // history 里的 user 条目数 + 1（即将到来的本轮）。
  const userTurnNumber = cleanedHistory.filter((t) => t.role === "user").length + 1;

  const turns: Message[] = cleanedHistory
    .slice(-16)
    .map((t) => ({ role: t.role, content: t.content.trim() }));

  // Fetch recent edit annotations and format edit context block (graceful: empty on failure)
  let editContextBlock: string | undefined;
  if (params.projectId != null) {
    try {
      const annotations = await getRecentAnnotations(params.projectId, 5);
      editContextBlock = formatEditContextBlock(annotations) || undefined;
    } catch (err) {
      console.error("[storyAgent] Failed to fetch edit annotations:", err);
    }
  }

  // 构建用户消息：如果有照片就用多模态格式（image_url + text）
  const userContent: import("../_core/llm").MessageContent | import("../_core/llm").MessageContent[] =
    params.photoUrl
      ? [
          { type: "image_url" as const, image_url: { url: params.photoUrl, detail: "low" as const } },
          { type: "text" as const, text: params.message.trim() || "帮我看看这张照片" },
        ]
      : params.message.trim();

  const messages: Message[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt(
        existingCardCount,
        userTurnNumber,
        summary,
        currentShots,
        similarCards,
        editContextBlock,
        params.enableImageGen,
        Boolean(params.photoUrl),  // 有照片 → 注入「先看图」指令
      ),
    },
    ...turns,
    { role: "user", content: userContent },
  ];

  let text: string;
  let modelLabel: string;
  try {
    ({ text, modelLabel } = await invokeAgent(messages, 700));
  } catch (err) {
    // 通道层已对临时性错误自动重试；走到这里说明仍然没接上。
    // 不向上抛错——否则前端只会弹一句吞掉真实原因的「Agent 暂时没接上」并断掉对话。
    // 改为优雅兜底：用小酌的口吻说一句「刚刚没接住」，对话不中断；真实原因记进服务端日志供排查。
    console.error("[storyAgent] invokeAgent failed after retries:", err);
    return {
      configured: true,
      modelLabel: "请求失败",
      reply: "嗯……我这边刚刚卡了一下，没接住你说的。能再说一遍吗？",
      card: null,
      read: null,
      toolCalls: [],
      suggestImage: false,
    };
  }

  let parsed: {
    reply: string;
    card: StoryCardPayload | null;
    read?: { trait?: unknown; note?: unknown } | null;
    toolCalls?: Array<{ name?: string; prompt?: string; shotNo?: number }> | null;
  };
  try {
    parsed = parseJsonLoose<{
      reply: string;
      card: StoryCardPayload | null;
      read?: { trait?: unknown; note?: unknown } | null;
      toolCalls?: Array<{ name?: string; prompt?: string; shotNo?: number }> | null;
    }>(text);
  } catch {
    parsed = {
      reply: text.trim() || "再多说一点那个时刻，是在什么地方？",
      card: null,
      read: null,
      toolCalls: null,
    };
  }

  // Validate card shape — only content + rawText are required
  let card: StoryCardPayload | null = null;
  if (
    parsed.card &&
    typeof parsed.card.content === "string" &&
    parsed.card.content.trim().length > 0
  ) {
    const rawTextRaw =
      typeof parsed.card.rawText === "string"
        ? parsed.card.rawText
        : params.message;
    card = {
      content: parsed.card.content.trim(),
      rawText: rawTextRaw.trim(),
      sourceQuote: asCleanString(parsed.card.sourceQuote),
      emotion: asCleanString(parsed.card.emotion),
      emotionOptions: asEmotionOptions(parsed.card.emotionOptions),
      emotionBlend: asCleanStringArray(parsed.card.emotionBlend),
      intensity: asIntensity(parsed.card.intensity),
      direction: asCleanString(parsed.card.direction),
      complexity: asCleanString(parsed.card.complexity),
      trigger: asCleanString(parsed.card.trigger),
      dramaticFunction: asCleanString(parsed.card.dramaticFunction),
      personalTrace: asCleanString(parsed.card.personalTrace),
      retrievalQuery: asCleanString(parsed.card.retrievalQuery),
      themeHints: asCleanStringArray(parsed.card.themeHints),
      outlierSignal: asCleanString(parsed.card.outlierSignal),
      softMembership: asCleanStringArray(parsed.card.softMembership),
    };
  }

  // Validate read shape — trait must be one of the 7 known keys
  let read: HumanityRead | null = null;
  if (parsed.read && typeof parsed.read === "object") {
    const traitRaw =
      typeof parsed.read.trait === "string"
        ? parsed.read.trait.trim().toLowerCase()
        : "";
    const noteRaw =
      typeof parsed.read.note === "string" ? parsed.read.note.trim() : "";
    if ((HUMANITY_TRAITS as string[]).includes(traitRaw)) {
      read = {
        trait: traitRaw as HumanityTrait,
        note: noteRaw.slice(0, 80), // hard cap so a chatty model can't bleed
      };
    }
  }

  // 解析 toolCalls（仅在手机端出图模式下有意义）
  const toolCalls: ToolCall[] = [];
  if (params.enableImageGen && Array.isArray(parsed.toolCalls)) {
    for (const tc of parsed.toolCalls) {
      if (tc.name === "generateImage" && typeof tc.prompt === "string" && tc.prompt.trim()) {
        toolCalls.push({
          name: "generateImage",
          prompt: tc.prompt.trim(),
          shotNo: typeof tc.shotNo === "number" ? tc.shotNo : undefined,
        });
      }
    }
  }

  // 如果有 generateImage toolCall，说明小酌建议出图
  const suggestImage = toolCalls.some(tc => tc.name === "generateImage");

  return {
    configured: true,
    modelLabel,
    reply: parsed.reply || "嗯。",
    card,
    read,
    toolCalls,
    suggestImage,
  };
}

// ── 创作素材 → 镜头表合成 ──
// 聊天结束后，把全部创作素材交给同一位"导演"做四件事：
// 1. 从素材里识别 1-3 个核心人物（characterHint 提供时优先纳入并设为主视点）
// 2. 给整段故事一句话情感弧线
// 3. 按最有张力的叙事顺序排一遍
// 4. 把每份素材转成一条镜头（1:1 映射，sourceCardContent 原样回填用于回溯）
// 返回 { characters, arc, shots }
type ShotListCardInput = {
  content: string;
  rawText?: string;
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
  retrievalQuery?: string;
  themeHints?: string[];
  outlierSignal?: string;
  softMembership?: string[];
};

function buildFallbackShotList(
  cards: ShotListCardInput[],
  characterHint: string,
  modelLabel: string,
): ShotListPayload {
  const sorted = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (b.card.intensity ?? 0) - (a.card.intensity ?? 0));
  const turnIndex = cards.length > 2 ? sorted[0]?.index ?? Math.floor(cards.length / 2) : -1;
  const first = cards[0];
  const last = cards[cards.length - 1] ?? first;
  const firstEmotion = first?.emotion || first?.emotionBlend?.[0] || "开始";
  const lastEmotion = last?.emotion || last?.emotionBlend?.[0] || "余味";
  const theme =
    first?.themeHints?.[0] ||
    first?.softMembership?.[0] ||
    last?.themeHints?.[0] ||
    "一段还在成形的私人经验";
  const conflictCount = cards.filter(card =>
    ["冲突", "转折", "关系裂缝", "阻碍", "逃避"].some(token =>
      [card.dramaticFunction, card.complexity, card.direction].join(" ").includes(token),
    ),
  ).length;

  const characters: ShotCharacter[] = characterHint
    ? [{ name: characterHint, role: "主视点", oneLiner: "故事最在意的人" }]
    : [];

  const shots: ShotEntry[] = cards.map((card, index) => {
    const isFirst = index === 0;
    const isLast = index === cards.length - 1;
    const beat: ShotBeat = isFirst
      ? "开场"
      : isLast
        ? "收束"
        : index === turnIndex
          ? "转折"
          : "起势";
    const shotType = isFirst ? "远" : isLast ? "近" : index === turnIndex ? "特" : "中";
    const subject =
      card.personalTrace ||
      card.trigger ||
      card.direction ||
      characterHint ||
      "这个人";
    const mood = [
      card.emotion,
      ...(card.emotionBlend ?? []),
      typeof card.intensity === "number" ? `浓度${card.intensity}` : "",
    ]
      .filter(Boolean)
      .slice(0, 2)
      .join(" / ");

    return {
      shotNo: index + 1,
      subject: subject.slice(0, 16),
      action: card.content.slice(0, 60) || "停在一个还没说完的时刻",
      dialogue: card.sourceQuote || "",
      shotType,
      beat,
      cameraAngle: "",
      cameraMove: "",
      location: "",
      timeLight: "",
      mood: mood.slice(0, 24),
      sound: "",
      styleRef: "",
      note: "模型未返回有效 JSON，系统按卡片自动整理的兜底镜头。",
      emotion: card.emotion || card.emotionBlend?.[0] || "未标",
      sourceCardContent: card.content,
    };
  });
  const arc = `${firstEmotion} → ${conflictCount ? "摩擦" : "停顿"} → ${lastEmotion}`;
  const composedShots = applyShotPromptComposition(shots, { arc });

  return {
    configured: true,
    modelLabel,
    characters,
    logline: cards.length > 1 ? `一个人从${firstEmotion}走向${lastEmotion}` : first?.content?.slice(0, 30) || "一段故事开始出现",
    theme: theme.slice(0, 30),
    arc,
    variants: [
      {
        mode: "克制版",
        logline: "让素材按日常顺序慢慢显影",
        arc: `${firstEmotion}到${lastEmotion}`,
        treatment: "少解释，多保留用户原话和动作，让情绪自己浮出来。",
      },
      {
        mode: "戏剧版",
        logline: "把最强情绪样本推到转折点",
        arc: `${firstEmotion}被推向一次明显转向`,
        treatment: "用最高浓度的卡片承担转折，但不补用户没说过的大事实。",
      },
      {
        mode: "诗意版",
        logline: "用重复的物和身体感受串起故事",
        arc: `从轻微感受落到${lastEmotion}`,
        treatment: "用空镜、停顿和原话碎片做连接，保留留白。",
      },
    ],
    boringCheck: {
      hasConflict: conflictCount > 0,
      hasTurn: turnIndex >= 0,
      hasWish: cards.some(card => Boolean(card.trigger || card.direction)),
      hasCost: cards.some(card => (card.intensity ?? 0) >= 0.65),
      hasChange: firstEmotion !== lastEmotion,
      note: conflictCount
        ? "已有可用的摩擦点，后续可以继续追问代价和变化。"
        : "当前素材偏平，建议继续追问愿望、阻碍、代价或一次具体转向。",
    },
    shots: composedShots,
  };
}

export async function synthesizeShotList(params: {
  cards: ShotListCardInput[];
  characterHint?: string;
  visualAnchors?: VisualAnchorPayload[];
}): Promise<ShotListPayload | { error: string; configured: boolean; modelLabel: string }> {
  if (!ENV.forgeApiKey) {
    return {
      error: "本地未配置 LLM API Key，无法整理创作素材。",
      configured: false,
      modelLabel: "未配置 API",
    };
  }

  if (params.cards.length === 0) {
    return {
      error: "还没有任何创作素材可以整理。",
      configured: true,
      modelLabel: ENV.llmModel,
    };
  }

  const cardsText = params.cards
    .map((c, i) => {
      const meta = [
        c.emotion ? `主情绪：${c.emotion}` : "",
        Array.isArray(c.emotionBlend) && c.emotionBlend.length
          ? `混合：${c.emotionBlend.join(" / ")}`
          : "",
        typeof c.intensity === "number" ? `浓度：${c.intensity}` : "",
        c.direction ? `方向：${c.direction}` : "",
        c.complexity ? `复杂度：${c.complexity}` : "",
        c.trigger ? `触发物：${c.trigger}` : "",
        c.dramaticFunction ? `戏剧功能：${c.dramaticFunction}` : "",
        c.personalTrace ? `个人痕迹：${c.personalTrace}` : "",
        c.retrievalQuery ? `检索线索(kNN)：${c.retrievalQuery}` : "",
        Array.isArray(c.themeHints) && c.themeHints.length
          ? `主题线索(聚类)：${c.themeHints.join(" / ")}`
          : "",
        c.outlierSignal ? `异常点(outlier)：${c.outlierSignal}` : "",
        Array.isArray(c.softMembership) && c.softMembership.length
          ? `多主题归属(GMM)：${c.softMembership.join(" / ")}`
          : "",
      ].filter(Boolean);
      return [
        `[${i + 1}] ${c.content}`,
        c.rawText ? `    原话：${c.rawText}` : "",
        c.sourceQuote ? `    原话锚点：${c.sourceQuote}` : "",
        meta.length ? `    情绪样本：${meta.join("；")}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const characterHint = params.characterHint?.trim() || "";
  const visualAnchors = Array.isArray(params.visualAnchors)
    ? params.visualAnchors.slice(0, 6)
    : [];
  const visualAnchorText = visualAnchors.length
    ? visualAnchors
        .map((anchor, i) => {
          const meta = [
            anchor.objective ? `客观：${anchor.objective}` : "",
            anchor.aesthetic ? `美术/情绪：${anchor.aesthetic}` : "",
            Array.isArray(anchor.visualStyle) && anchor.visualStyle.length
              ? `风格：${anchor.visualStyle.join(" / ")}`
              : "",
            Array.isArray(anchor.mood) && anchor.mood.length
              ? `情绪：${anchor.mood.join(" / ")}`
              : "",
            Array.isArray(anchor.colorPalette) && anchor.colorPalette.length
              ? `色彩：${anchor.colorPalette.join(" / ")}`
              : "",
            anchor.prompt ? `提示词锚：${anchor.prompt.slice(0, 240)}` : "",
          ].filter(Boolean);
          return [`[V${i + 1}] ${anchor.title}`, ...meta.map(line => `    ${line}`)]
            .join("\n");
        })
        .join("\n\n")
    : "";

  const systemPrompt = [
    "你还是刚才那个朋友——同时你对画面、镜头、和故事结构都有一点感觉。",
    "对方刚刚跟你聊完一段，他沉淀下来这一组情绪样本——每一份都来自日常对话里的真实反应，不一定是感动，也不一定完整。",
    "现在请帮他把这些样本整理成一份**可以拍出来的、有完整形状的短片镜头表**。这是只属于他的故事，请保留个人痕迹，不要替他升华、不要加结论；但要让这段故事**有情绪起伏、有矛盾、有转向、有落点**——不是一串同色系的漂亮瞬间。",
    "",
    "请做六件事：",
    '1. 从素材里识别 1-3 个核心人物。每个人物给：name（名字或称呼，如「母亲」）、role（关系/在故事里的位置，如「主视点」、「对照面」）、oneLiner（一句话原型，≤16 字）。',
    characterHint
      ? `   用户已经告诉了你：他最在意的人是「${characterHint}」——请把这个人物放进 characters 列表，并设为主视点。`
      : "",
    "2. 写一句 logline（≤30 字）：用一句话告诉别人这是一个关于什么的故事——偏剧情陈述，能回答「这片子讲什么」。",
    "3. 写一句 theme（≤25 字）：这故事底下没说出口的那层意思是什么——偏意义/感受，不要套用「亲情/成长/和解」之类的大词，要从这一组样本里的个人痕迹提炼。",
    "4. 写一句 arc（≤30 字）：整段故事的情绪曲线——从哪种低浓度状态出发，经过哪种矛盾/阻碍/爆发，到哪种余味落地。",
    "5. 排出**最有张力**的镜头顺序，并给每一镜标一个 beat（开场 / 起势 / 转折 / 收束）：",
    "   - 开场（最多 1-2 镜）：establishing。先把对方放进这个故事的「位置」——可以是地点空镜、一个未解的小动作、一个色调，给观众一个进入点。",
    "   - 起势：事情发生、关系展开。素材里大部分中段时刻都属于这里。",
    "   - 转折：整段最重的一刻，承重那一下。一段故事通常只有 1 个转折，最多 2 个。",
    "   - 收束（1 镜）：落点。可以是一句话、一个空镜、一个回到开场的呼应；不必给「答案」，但要让故事停得下来。",
    "6. 把每份素材转化成镜头，**并允许你补 1-2 镜连接镜**让这段故事真正成形——",
    "   - 你**可以**在最前补一镜「开场镜」（establishing 或定调空镜），如果原素材里没有自然的开场。",
    "   - 你**可以**在最后补一镜「收束镜」（coda / 留白）让故事有落点，如果原素材里最后一份不足以承担收尾。",
    "   - 这两镜之外的所有镜，必须 1:1 来自原素材，不合并、不拆分、不替对方写他没说过的事。",
    "   - 全表镜头总数 = 原素材数 + 你补的连接镜数（≤2）。",
    "   - 连接镜的 sourceCardContent 必须是空字符串「\"\"」（这样系统知道是你加的）。",
    visualAnchorText
      ? [
          "",
          "【视觉锚 · 画布已经定下的感觉】",
          "下面这些视觉锚来自用户上传/AI riff 的图片画布。它们不是孤立灵感角，而是下游镜头出图的风格来源。",
          "使用方式：",
          "- 在每一镜的 mood、location、lighting 语感里吸收这些锚的色彩、光线、质感和情绪。",
          "- styleRef 不再留空：请写一个很短的视觉锚引用，例如「V1 冷绿窗光 / 胶片颗粒」或「V2 暖黄厨房 / 低饱和」。",
          "- 不要把视觉锚里的物件强行塞进所有镜头；只继承风格、光线、情绪、材质。",
          visualAnchorText,
        ].join("\n")
      : "",
    "",
    "【情绪曲线要求】",
    "   - 不要把所有镜头都写成同一种温柔/怀旧/释然。必须主动寻找差异：烦躁、回避、羞耻、羡慕、期待、空掉、欲望、阻碍、关系裂缝、余味。",
    "   - 情绪浓度要有变化：低浓度铺垫 → 中浓度摩擦 → 高浓度转折 → 低浓度余味。不要每一镜都 0.7。",
    "   - 如果原样本都很轻，你可以通过镜头顺序制造起伏，但不要编造用户没说过的大事件。",
    "   - 每个镜头都要尽量保留一个个人痕迹：用户的原词、反复出现的人/物、没说出口的动作、身体反应、回避方式。",
    "",
    "【固定机制 · 剧本整理】",
    "   - 多版本剧本：额外给出 3 个可选叙事壳：克制版 / 戏剧版 / 诗意版。三版只改变叙事骨架、节奏密度和表达方式，不能改变用户事实。",
    "   - 无聊检测：生成前检查故事有没有冲突、转折、愿望、代价、变化。缺什么就在 boringCheck 里标出来；如果够了，说明张力来自哪里。",
    "   - 真实性保护：绝不自行补重大事实和重大创伤。用户没有说的疾病、死亡、暴力、背叛、家庭破裂、重大灾难，都不能写进剧本。连接镜只能补气氛、空间、动作或留白。",
    "   - 原话追溯：关键台词优先来自 rawText 或 sourceQuote；不要把 AI 写的漂亮句子伪装成用户说过的话。",
    "",
    "【Module 10 · 记忆整理能力】",
    "   - kNN / 相似度：如果多张样本的 retrievalQuery 很接近，把它们看作同一段人生线索的回声。",
    "   - Clustering 聚类：themeHints 相近的样本可以组成同一章，如 家庭 / 迁移 / 职业 / 爱情 / 失去 / 自我成长 / 重要人物。",
    "   - DBSCAN / outlier：outlierSignal 不为空的样本不要当垃圾；它可能是最独特、最值得深挖的故事亮点。",
    "   - GMM：softMembership 表明一个样本可以同时属于多个主题。不要硬分一类；真实人生经常是家庭+成长+孤独叠在一起。",
    "   - 生成剧本时，请优先把主题线索和异常点组织成「人物、冲突、变化、结尾」，而不是只按聊天时间顺序平铺。",
    "",
    "【每镜要填的列】",
    "   - subject:   主体，谁/什么在画面里（如「母亲」「空着的椅子」），≤16 字",
    "   - action:    一句话动作或事件（≤30 字），从原素材衍生（连接镜可自拟，但要朴素具象），不替对方解释或升华",
    "   - dialogue:  台词；原话里有有重量的一句就原样保留，没有就空字符串；连接镜原则上空",
    "   - shotType:  景别，必须从这 6 个里选一个：远 / 全 / 中 / 近 / 特 / 大特",
    "   - beat:      必须从这 4 个里选一个：开场 / 起势 / 转折 / 收束",
    "   - location:  场景 / 地点，简短具象（如「老屋客厅，下午」），≤20 字",
    "   - mood:      氛围 · 色调，一句话描述整镜情绪/色调（如「冷调，带一点湿意」「灰雾」），≤16 字",
    "   - emotion:   1-4 字的情感词（如「清醒」「笃定」「松弛」「烦躁」「羡慕」「失重」「愧疚」「松开了」），不预设类别，避免全是同一种词。理性、有边界感的表达给力量型词，不要归为'防御'",
    "",
    "【请严格留空的列（输出空字符串，不要编造）】",
    "   - cameraAngle: 机位（平视/俯/仰…）—— 留空",
    "   - cameraMove:  运镜（静止/推/拉/摇/移/跟…）—— 留空",
    "   - timeLight:   时间·光 —— 留空",
    "   - sound:       音 —— 留空",
    visualAnchorText
      ? "   - styleRef:    风格参考 —— 必须引用视觉锚的风格/色彩/光线，简短写入"
      : "   - styleRef:    风格参考 —— 留空",
    "   - note:        技术备注 —— 留空",
    "",
    "【还要回填的辅助列】",
    "   - sourceCardContent: 原素材的 content 字段，原样回填一字不差。**只有连接镜（你自己加的开场/收束）才允许此字段为空字符串**。",
    "",
    "【返回格式：严格 JSON，绝不附加任何额外文字、不要包 markdown 代码块】",
    "{",
    '  "characters": [',
    '    { "name": "...", "role": "...", "oneLiner": "..." }',
    "  ],",
    '  "logline": "一句话故事 pitch（剧情）",',
    '  "theme": "底下没说出口的那层意思（意义）",',
    '  "arc": "一句话情感走向（感受）",',
    '  "variants": [',
    '    { "mode": "克制版", "logline": "更日常、更留白的版本", "arc": "情绪走向", "treatment": "这个版本怎么拍，≤60 字" },',
    '    { "mode": "戏剧版", "logline": "冲突更明确的版本", "arc": "情绪走向", "treatment": "这个版本怎么拍，≤60 字" },',
    '    { "mode": "诗意版", "logline": "意象更强的版本", "arc": "情绪走向", "treatment": "这个版本怎么拍，≤60 字" }',
    "  ],",
    '  "boringCheck": {',
    '    "hasConflict": true,',
    '    "hasTurn": true,',
    '    "hasWish": true,',
    '    "hasCost": true,',
    '    "hasChange": true,',
    '    "note": "如果故事还平，指出缺少什么；如果够了，说明张力来自哪里，≤60 字"',
    "  },",
    '  "shots": [',
    "    {",
    '      "shotNo": 1,',
    '      "subject": "...",',
    '      "action": "...",',
    '      "dialogue": "",',
    '      "shotType": "远",',
    '      "beat": "开场",',
    '      "location": "...",',
    '      "mood": "...",',
    '      "emotion": "...",',
    '      "cameraAngle": "",',
    '      "cameraMove": "",',
    '      "timeLight": "",',
    '      "sound": "",',
    '      "styleRef": "",',
    '      "note": "",',
    '      "sourceCardContent": ""  // 这是你自己补的开场连接镜，所以留空',
    "    }",
    "  ]",
    "}",
    "",
    "shotNo 从 1 开始连续编号，与你建议的叙事顺序一致。",
    "全表必须有且只有 1 镜「开场」beat（在最前），有且只有 1 镜「收束」beat（在最后）。中间的镜头按节奏分布在「起势」和「转折」之间。",
    "请优先生成多样的、带有用户个人痕迹的剧本，不要生成泛泛的情绪散文。",
    "用简体中文。",
  ]
    .filter(line => line !== "")
    .join("\n");

  const { text, modelLabel } = await invokeAgent(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: cardsText },
    ],
    2200,
  );

  try {
    const parsed = parseJsonLoose<{
      characters?: Array<{ name?: unknown; role?: unknown; oneLiner?: unknown }>;
      arc?: unknown;
      logline?: unknown;
      theme?: unknown;
      variants?: Array<{
        mode?: unknown;
        logline?: unknown;
        arc?: unknown;
        treatment?: unknown;
      }>;
      boringCheck?: {
        hasConflict?: unknown;
        hasTurn?: unknown;
        hasWish?: unknown;
        hasCost?: unknown;
        hasChange?: unknown;
        note?: unknown;
      };
      shots?: Array<{
        shotNo?: unknown;
        subject?: unknown;
        shotType?: unknown;
        beat?: unknown;
        action?: unknown;
        dialogue?: unknown;
        cameraAngle?: unknown;
        cameraMove?: unknown;
        location?: unknown;
        timeLight?: unknown;
        mood?: unknown;
        sound?: unknown;
        styleRef?: unknown;
        note?: unknown;
        emotion?: unknown;
        sourceCardContent?: unknown;
      }>;
    }>(text);

    if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
      return {
        error: "整理失败：模型没有返回有效的 shots 列表。",
        configured: true,
        modelLabel,
      };
    }

    const characters: ShotCharacter[] = Array.isArray(parsed.characters)
      ? parsed.characters
          .filter(c => c && typeof c === "object")
          .map(c => ({
            name: typeof c.name === "string" ? c.name.trim() : "",
            role: typeof c.role === "string" ? c.role.trim() : "",
            oneLiner: typeof c.oneLiner === "string" ? c.oneLiner.trim() : "",
          }))
          .filter(c => c.name.length > 0)
          .slice(0, 3)
      : [];

    const asString = (v: unknown): string =>
      typeof v === "string" ? v.trim() : "";
    const asBool = (v: unknown): boolean => v === true;

    const variantModes = ["克制版", "戏剧版", "诗意版"] as const;
    const variants = variantModes.map(mode => {
      const raw = Array.isArray(parsed.variants)
        ? parsed.variants.find(item => item && item.mode === mode)
        : undefined;
      return {
        mode,
        logline: asString(raw?.logline),
        arc: asString(raw?.arc),
        treatment: asString(raw?.treatment),
      };
    });

    const boringCheck = {
      hasConflict: asBool(parsed.boringCheck?.hasConflict),
      hasTurn: asBool(parsed.boringCheck?.hasTurn),
      hasWish: asBool(parsed.boringCheck?.hasWish),
      hasCost: asBool(parsed.boringCheck?.hasCost),
      hasChange: asBool(parsed.boringCheck?.hasChange),
      note: asString(parsed.boringCheck?.note),
    };

    const shots: ShotEntry[] = parsed.shots
      .filter(s => s && typeof s === "object")
      .map((s, i) => {
        const shotTypeRaw = asString(s.shotType);
        const shotType = VALID_SHOT_TYPES.includes(shotTypeRaw)
          ? shotTypeRaw
          : "中";
        const beatRaw = asString(s.beat) as ShotBeat;
        const beat: ShotBeat = VALID_BEATS.includes(beatRaw)
          ? beatRaw
          : "起势"; // 模型没标的话先一律算「起势」，下面再做开场/收束兜底
        return {
          shotNo: typeof s.shotNo === "number" ? s.shotNo : i + 1,
          subject: asString(s.subject),
          action: asString(s.action),
          dialogue: asString(s.dialogue),
          shotType,
          beat,
          cameraAngle: asString(s.cameraAngle),
          cameraMove: asString(s.cameraMove),
          location: asString(s.location),
          timeLight: asString(s.timeLight),
          mood: asString(s.mood),
          sound: asString(s.sound),
          styleRef: asString(s.styleRef),
          note: asString(s.note),
          emotion: asString(s.emotion) || "未标",
          sourceCardContent: asString(s.sourceCardContent),
        };
      })
      .filter(s => s.action.length > 0)
      .sort((a, b) => a.shotNo - b.shotNo)
      // 重新连续编号，避免模型给出 1,2,4 这种空洞
      .map((s, i) => ({ ...s, shotNo: i + 1 }));

    if (shots.length === 0) {
      return {
        error: "整理失败：所有镜头都缺少 action 字段。",
        configured: true,
        modelLabel,
      };
    }

    // ── beat 兜底 ──
    // 模型可能没乖乖标 beat。规则：
    //   · 第一镜如果不是「开场」，强制改成「开场」（这一镜会担起 establishing 责任）
    //   · 最后一镜如果不是「收束」，强制改成「收束」
    //   · 中间所有不是「转折」的，统一保持「起势」
    //   · 模型自己标的「转折」保持不动
    if (shots.length > 0) {
      shots[0].beat = "开场";
      shots[shots.length - 1].beat = "收束";
    }

    const arc = typeof parsed.arc === "string" ? parsed.arc.trim() : "";
    const composedShots = applyShotPromptComposition(shots, {
      arc,
      visualAnchors,
    });

    return {
      configured: true,
      modelLabel,
      characters,
      shots: composedShots,
      arc,
      logline: typeof parsed.logline === "string" ? parsed.logline.trim() : "",
      theme: typeof parsed.theme === "string" ? parsed.theme.trim() : "",
      variants,
      boringCheck,
    };
  } catch (error) {
    console.warn("[storyAgent] shot list JSON parse failed; using local fallback.", error);
    return buildFallbackShotList(params.cards, characterHint, modelLabel);
  }
}

// ── 历史压缩 ──
// 当对话超过 12 轮时，把早期 turns 折叠成"导演工作笔记"，新的总结
// 会替换 priorSummary。前端把 summary + 最近 6 轮 verbatim 一起发给 chat 接口。
export type SummaryPayload = {
  summary: string;
  configured: boolean;
  modelLabel: string;
};

export async function summarizeHistory(params: {
  priorSummary?: string;
  turnsToAbsorb: ChatTurn[];
}): Promise<SummaryPayload | { error: string; configured: boolean; modelLabel: string }> {
  if (!ENV.forgeApiKey) {
    return {
      error: "本地未配置 LLM API Key，无法压缩历史。",
      configured: false,
      modelLabel: "未配置 API",
    };
  }

  const turns = (params.turnsToAbsorb ?? []).filter(t => t.content?.trim());
  if (turns.length === 0) {
    // 没东西可压时直接回上一份
    return {
      configured: true,
      modelLabel: ENV.llmModel,
      summary: params.priorSummary?.trim() || "",
    };
  }

  const transcript = turns
    .map(t => `${t.role === "user" ? "对方" : "导演"}：${t.content.trim()}`)
    .join("\n");

  const priorSummary = params.priorSummary?.trim() || "";

  const systemPrompt = [
    "你还是刚才那个朋友。你和对方已经聊过一段，对话开始走到比较深的位置了。",
    "为了之后接着聊时不丢线索，请把下面这段早期对话收拢成一份【只给你自己看的小记】，方便回头查。",
    "",
    "小记要求：",
    "- 每一句一个独立信息点，最多 6 句",
    "- 必须保留：对方提到过的具体人 / 事 / 地点；已经显形过的情感倾向；你之前在心里判过的状态（trait，如果有）；任何已经被收成故事素材的关键句",
    "- 不要抒情、不要替对方解释、不要复述完整对话",
    "- 用第二人称对自己写：「对方提过…」「你判过 ta 在防御」",
    priorSummary
      ? `- 已经有一份旧的小记，把下面新的对话内容并进去，输出**合并后**的一份新小记（不要分两段）：\n旧小记：\n${priorSummary}`
      : "",
    "",
    "【返回格式：纯文本，不要 JSON、不要 markdown 代码块、不要任何其他解释】",
  ]
    .filter(line => line !== "")
    .join("\n");

  const { text, modelLabel } = await invokeAgent(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ],
    700,
  );

  // 模型有时仍会包 ``` 或加引言，简单清理一下
  const cleaned = text
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/, "")
    .trim();

  if (!cleaned) {
    return {
      error: "压缩失败：模型返回为空。",
      configured: true,
      modelLabel,
    };
  }

  return {
    configured: true,
    modelLabel,
    summary: cleaned,
  };
}

// ── 选中编辑（inline selection edit）──────────────────────────────────

/** 对文本中选中片段执行 AI 编辑指令，返回替换后的完整文本 */
export async function handleSelectionEdit(params: {
  fullText: string;
  selectedText: string;
  instruction: string;
  projectId?: number;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ isApprovalOnly: boolean; modifiedFullText: string; reply: string }> {
  const systemPrompt = `你是一位文字编辑助手。用户会给你一段完整文本和其中被选中的片段，以及一条编辑指令。
请只修改选中的部分，保持其余文字不变，返回修改后的完整文本。

要求：
1. 仅修改选中片段，上下文保持一致
2. 遵循用户的编辑指令
3. 如果指令是确认/赞同性质的（如"好的"、"不错"），不做修改，isApprovalOnly 设为 true
4. 返回 JSON 格式：{"isApprovalOnly":false,"modifiedFullText":"修改后的完整文本","reply":"简短说明做了什么改动"}`;

  const userMessage = `完整文本：
---
${params.fullText}
---

选中片段：
---
${params.selectedText}
---

编辑指令：${params.instruction}`;

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...(params.history ?? []).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userMessage },
  ];

  const result = await invokeAgent(messages, 2048);
  const parsed = parseJsonLoose<{ isApprovalOnly: boolean; modifiedFullText: string; reply: string }>(result.text);
  if (parsed && typeof parsed.modifiedFullText === "string") {
    return parsed;
  }
  // 解析失败时回退：直接返回原文
  return { isApprovalOnly: false, modifiedFullText: params.fullText, reply: "未能解析 AI 返回结果，保留原文" };
}
