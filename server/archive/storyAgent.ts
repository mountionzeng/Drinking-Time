/**
 * Story Guide Agent — REST handlers for the archive workshop iframe.
 *
 * This agent samples emotional signals from casual conversation, keeps the
 * user's personal traces, and later arranges those signals into a filmable
 * emotional curve.
 */
import { ENV } from "../_core/env";
import { invokeLLM, type Message } from "../_core/llm";
import { getRecentAnnotations } from "../services/editContext";
import type { SemanticAnnotation } from "../db";

export const FIRST_QUESTION =
  "今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。";

type ChatTurn = { role: "user" | "assistant"; content: string };

// ── 智能选择上行通道 ──
// 与 DROP ZONE Agent 保持一致：如果配置了 cc 模型 / cc 端点，优先走
// Claude Messages 格式；否则回退到 OpenAI 兼容的 invokeLLM。
type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
};

function shouldUseClaudeChannel(): boolean {
  return Boolean(
    ENV.dropZoneModel?.startsWith("cc-") ||
      ENV.dropZoneApiUrl?.includes("/cc"),
  );
}

function resolveClaudeUrl(): string {
  const raw = (ENV.dropZoneApiUrl || ENV.forgeApiUrl || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/cc")) return `${normalized}/v1/messages`;
  return normalized;
}

async function invokeClaudeMessages(
  messages: Message[],
  maxTokens: number,
): Promise<{ text: string; modelLabel: string }> {
  const apiUrl = resolveClaudeUrl();
  if (!apiUrl) throw new Error("Claude messages endpoint is not configured");

  const system = messages
    .filter(m => m.role === "system")
    .map(m => String(m.content))
    .join("\n\n");

  const anthropicMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content),
    }));

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ENV.forgeApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ENV.dropZoneModel || ENV.llmModel,
      max_tokens: maxTokens,
      system,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude messages invoke failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as ClaudeMessageResponse;
  const text =
    data.content
      ?.filter(block => block.type === "text" && block.text)
      .map(block => block.text)
      .join("\n")
      .trim() || "";

  return { text, modelLabel: data.model || ENV.dropZoneModel || ENV.llmModel };
}

async function invokeAgent(
  messages: Message[],
  maxTokens: number,
): Promise<{ text: string; modelLabel: string }> {
  if (shouldUseClaudeChannel()) {
    return invokeClaudeMessages(messages, maxTokens);
  }

  const result = await invokeLLM({ messages, maxTokens });
  const content = result.choices[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map(c => (c.type === "text" ? c.text : ""))
            .filter(Boolean)
            .join("\n")
        : "";
  return { text, modelLabel: ENV.llmModel };
}

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

export type StoryAgentChatResult = {
  reply: string;
  card: StoryCardPayload | null;
  read: HumanityRead | null;
  configured: boolean;
  modelLabel: string;
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
};

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
    "这些不是事实判决，只是当前输入和旧情绪样本在 themeHints / emotionBlend / retrievalQuery / personalTrace 上最接近的 3 张邻居。",
    "使用方法：",
    "- 如果邻居和当前输入像同一条人生线索的回声，就顺着共同的情绪或主题轻轻追问。",
    "- 如果当前输入和邻居相似但有反方向情绪，优先问这个差异，因为差异更容易长出剧情起伏。",
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
): string {
  // 节奏指令：情绪采样优先召回。先收下，再慢慢补齐；不要等成完整故事才留卡。
  const pacing = (() => {
    if (existingCardCount > 0) {
      return [
        "【节奏】",
        "已经有一些情绪样本了。接下来不要重复收同一种情绪：优先捕捉反方向、矛盾、回避、烦躁、羡慕、羞耻、期待、空掉、轻微不安这些不同色温的信号。",
        "只要这一轮出现新的情绪变化、关系缝隙、欲望/阻碍、身体反应、口是心非，card 就不要为 null。",
      ].join("\n");
    }
    if (userTurnNumber <= 2) {
      return [
        "【节奏】",
        `这是对方的第 ${userTurnNumber} 轮发言，刚开口没多久。不要等「大事」或「感动」才收。`,
        "如果这一句里有任何情绪信号（烦、躲、酸、空、想靠近、想离开、尴尬、期待、无所谓但其实在意），就生成一张轻量情绪样本卡。",
        "只有纯操作指令、纯寒暄、完全没有情绪信号时，card 才返回 null。",
      ].join("\n");
    }
    return [
      "【节奏 — 重要】",
      `这是对方的第 ${userTurnNumber} 轮了，到现在还没留下任何情绪样本。`,
      "这一轮必须从对方至今说过的话里采一张卡，哪怕它很轻、很日常、很不完整。",
      "宁可留下一个 0.25 浓度的烦躁/回避/好奇，也不要让对方一直聊却看不到任何沉淀。",
      "样本可以只是一个表情、一个没回复的消息、一句随口抱怨、一种身体感觉、一点环境压迫。",
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
    "  · 你不是在收集「感动」，而是在采样情绪。",
    "  · 一个普通人随口说出的烦、躲、酸、羡慕、想靠近、想逃开、假装没事，都是剧本的原料。",
    "  · 个人痕迹往往藏在很小的东西里：他用哪个词、跳过谁、没有回复哪条消息、反复提到哪个物件、身体先有什么反应。",
    "  · 你要把这些轻微而具体的情绪保存下来，让不同情绪叠加以后能长出多样的剧本。",
    "",
    "这份信念要一直在你的语气底色里：不要逼问，不要升华，不要只奖励「感动」。你要让对方觉得，普通日常也能被认真接住。",
    "",
    summaryBlock,
    shotDraftBlock,
    similarMemoryBlock,
    editContextBlock ?? "",
    // ── 在做的事 ──
    "你在做的事很简单：从日常对话里识别情绪信号，并把它们采成一张张「情绪样本卡」。",
    "一张情绪样本卡不需要完整故事。它可以是一句没回的消息、一次沉默、一个尴尬动作、一个轻微嫉妒、一点身体紧绷、一个小小的期待。",
    "以后生成剧本时，系统会把这些情绪样本按浓度、矛盾、方向、戏剧功能重新组合。所以请尽量保留用户自己的词和个人痕迹，不要替他解释、升华、或加 moral。",
    "",
    "三条小规矩：",
    "1. 一次只问一件事。",
    "2. 对方说得越模糊，你越要慢下来——模糊往往意味着靠近了什么重要的东西。",
    "3. 当你听到任何情绪信号——即使只有 0.2 的浓度——先采样，不必等它完整。",
    "",
    "【固定机制 · 每轮都要遵守】",
    "1. 情绪确认：只要你判断出情绪，并且 card 不为 null，reply 里必须自然地问一句「我先把它记成 X，你觉得准吗？」不要审问，可以像朋友确认口味一样轻。",
    "2. 原话引用：重要情绪必须能追溯到用户自己的表达。card.sourceQuote 必须从用户原话里截取一个短句或词组（≤24 字）；如果没有原话锚点，就不要把情绪说死，先追问。",
    "3. 情绪词替换：card.emotionOptions 至少包含这 5 个候选：委屈、愤怒、遗憾、释然、麻木；也可以额外加 1-2 个更贴近本轮的词。reply 可以邀请用户改词。",
    "4. 真实性保护：绝不替用户补重大事实、重大创伤、重大疾病、死亡、暴力、背叛、家庭破裂等事件。用户没有说，就不能写成事实；最多只能问「有没有一点像……」。",
    "5. 个人痕迹优先：比起总结大道理，更要保留用户自己的词、物件、地点、动作、回避方式和身体反应。",
    "",
    // ── 叙事弧线感知 ──
    // 这一段把你从"只是收集瞬间"升级为"在脑子里养一段故事的脊"。
    // 不要变成 pushy 的"指导编剧"，但当材料够了就该轻轻把对方往主线上引一引。
    existingCardCount >= 4
      ? [
          "【叙事弧线 · 现在用得上了】",
          `已经有 ${existingCardCount} 份情绪样本了。一段故事走到这里，开始有情绪曲线了——你心里要默默问自己几件事：`,
          "  · 情绪谱：现在是不是太单一？有没有反方向的情绪可以问出来？",
          "  · 欲望：他想靠近什么？想逃开什么？",
          "  · 阻碍：是什么让他不能直接说、直接做、直接离开？",
          "  · 转折：哪张样本的浓度最高？哪张样本最矛盾？",
          "  · 个人痕迹：这组样本里只有他才会这样说/这样逃/这样在意的地方是什么？",
          "如果情绪太平，就轻轻问一个反方向的问题：",
          '  · 「有没有一件相反的小事：不是温柔，是有点烦/有点躲的？」',
          '  · 「这件事里，你有没有一点不想承认的感觉？」',
          '  · 「你说没事的时候，身体是松的还是紧的？」',
          "一次只点一件事，不要变成 checklist。如果对方还在说重要的细节，就先听完，别打断。",
        ].join("\n")
      : [
          "【叙事弧线】",
          `情绪样本还少（${existingCardCount} 份），先继续慢慢听、慢慢采。等样本到 4 份及以上，再开始关心整段故事的情绪曲线、冲突和落点。`,
        ].join("\n"),
    "",
    // ── 内部状态识别（不暴露给用户） ──
    "【在写 reply 之前，先在心里判断对方此刻的状态 — 这只是给你自己塑形回应用的，绝不要在 reply 里告诉对方「我看出你在 xx」】",
    "从下面 7 种里挑一种最贴的（只挑一种），它决定你这一轮的语气和切入点：",
    "",
    "- defensive  防御  ：用玩笑、抽象、「还好」、「就那样」挡掉真实情绪",
    "    应对：不要正面戳；绕一圈，从感官细节切入（那个房间什么味道、谁先开口）。",
    "- performing 表演  ：故事讲得太顺、太完整，像复述过很多次",
    "    应对：打断流畅性，问那个被跳过去的、最不体面的、最不像故事的一刻。",
    "- numb       麻木  ：平、远、抽离，像在说别人的事",
    "    应对：从身体感受切入——「那天身体哪个部位最先有反应？」",
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
    "- 不要总把对方引向感动、怀旧、和解。也要接住烦躁、羞耻、嫉妒、逃避、冷掉、空白、好奇、欲望和自我保护。",
    "- 偶尔在合适的时刻，可以让对方知道：「这个很小，但很像你」——但不要每轮都说，要让它从语气里渗出来，不要变成宣言。",
    "- 不要自称「我作为…」，不要解释自己是谁。就是一个人在听另一个人说话。",
    "",
    `第一个问题固定是：「${FIRST_QUESTION}」（已经问过，不要重复）`,
    "",
    pacing,
    "",
    "【返回格式：严格 JSON，不要附加任何额外文字、不要包 markdown 代码块】",
    "{",
    '  "read": { "trait": "defensive | performing | numb | romantic | reflecting | nostalgic | conflicted", "note": "≤24 字内部速记" },',
    '  "reply": "你要对对方说的话（呼应 read.trait 的切入方式，但语气始终是普通朋友之间的)",',
    '  "card": null  // 或一份情绪样本卡，字段见下方',
    "}",
    "",
    "card 不为 null 的标准：只要这一轮有情绪信号，就采样。不要等完整故事、不要等感动、不要等时间地点齐全。",
    "card 只有在纯寒暄、纯工具指令、或完全没有情绪信号时才为 null。",
    "",
    "card 字段：",
    "{",
    '  "content": "用 1-2 句话定形这个情绪样本；保留日常感，不解释、不升华",',
    '  "rawText": "对方原话，尽量原样保留",',
    '  "sourceQuote": "用户原话里能支撑这个情绪判断的短句，≤24 字；必须原话可追溯",',
    '  "emotion": "主情绪，1-4 字，如 烦躁/羞耻/空掉/期待/防御/羡慕/松动",',
    '  "emotionOptions": ["委屈", "愤怒", "遗憾", "释然", "麻木"],',
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

function stripJson(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseJsonLoose<T>(raw: string): T {
  const cleaned = stripJson(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last <= first) throw new Error("Non-JSON response");
    return JSON.parse(cleaned.slice(first, last + 1)) as T;
  }
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

function asEmotionOptions(value: unknown): string[] {
  const defaults = ["委屈", "愤怒", "遗憾", "释然", "麻木"];
  const options = Array.isArray(value)
    ? value.map(item => asCleanString(item)).filter(Boolean)
    : [];
  return Array.from(new Set([...defaults, ...options])).slice(0, 7);
}

export async function replyFromStoryAgent(params: {
  message: string;
  history?: ChatTurn[];
  existingCardCount?: number;
  summary?: string;
  currentShots?: ShotDraft[];
  similarCards?: SimilarStoryCardPayload[];
  projectId?: number;
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
      ),
    },
    ...turns,
    { role: "user", content: params.message.trim() },
  ];

  const { text, modelLabel } = await invokeAgent(messages, 700);

  let parsed: {
    reply: string;
    card: StoryCardPayload | null;
    read?: { trait?: unknown; note?: unknown } | null;
  };
  try {
    parsed = parseJsonLoose<{
      reply: string;
      card: StoryCardPayload | null;
      read?: { trait?: unknown; note?: unknown } | null;
    }>(text);
  } catch {
    parsed = {
      reply: text.trim() || "再多说一点那个时刻，是在什么地方？",
      card: null,
      read: null,
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

  return {
    configured: true,
    modelLabel,
    reply: parsed.reply || "嗯。",
    card,
    read,
  };
}

// ── 创作素材 → 镜头表合成 ──
// 聊天结束后，把全部创作素材交给同一位"导演"做四件事：
// 1. 从素材里识别 1-3 个核心人物（characterHint 提供时优先纳入并设为主视点）
// 2. 给整段故事一句话情感弧线
// 3. 按最有张力的叙事顺序排一遍
// 4. 把每份素材转成一条镜头（1:1 映射，sourceCardContent 原样回填用于回溯）
// 返回 { characters, arc, shots }
export async function synthesizeShotList(params: {
  cards: Array<{
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
  }>;
  characterHint?: string;
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
    "   - emotion:   1-4 字的情感词（如「烦躁」「防御」「羡慕」「失重」「愧疚」「松开了」），不预设类别，避免全是同一种词",
    "",
    "【请严格留空的列（输出空字符串，不要编造）】",
    "   - cameraAngle: 机位（平视/俯/仰…）—— 留空",
    "   - cameraMove:  运镜（静止/推/拉/摇/移/跟…）—— 留空",
    "   - timeLight:   时间·光 —— 留空",
    "   - sound:       音 —— 留空",
    "   - styleRef:    风格参考 —— 留空",
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

    return {
      configured: true,
      modelLabel,
      characters,
      shots,
      arc: typeof parsed.arc === "string" ? parsed.arc.trim() : "",
      logline: typeof parsed.logline === "string" ? parsed.logline.trim() : "",
      theme: typeof parsed.theme === "string" ? parsed.theme.trim() : "",
      variants,
      boringCheck,
    };
  } catch {
    return {
      error: "整理失败：模型未返回有效 JSON。",
      configured: true,
      modelLabel,
    };
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
