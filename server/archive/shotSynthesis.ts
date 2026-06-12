import { ENV } from "../_core/env";
import { type Message } from "../_core/llm";
import { parseJsonLoose } from "../_core/llmJson";
import { invokeAgent } from "../_core/agentChannel";
import { applyShotPromptComposition } from "../services/shotPromptComposer";
import type { ShotBeat, ShotCharacter, ShotEntry, ShotListPayload, StoryCardPayload, VisualAnchorPayload } from "./storyAgent.types";

const VALID_SHOT_TYPES = ["远", "全", "中", "近", "特", "大特"];
const VALID_BEATS: ShotBeat[] = ["开场", "起势", "转折", "收束"];

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
  /** 共鸣上下文（用户意图 / 情绪 + 文学声音）。缺省时合成行为与之前完全一致。 */
  resonanceContext?: string;
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
      ...(params.resonanceContext
        ? [
            {
              role: "system" as const,
              content: `共鸣参照（用户意图 / 情绪 + 文学声音，仅作呼应，不要照抄）：\n${params.resonanceContext}`,
            },
          ]
        : []),
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
      // 模型返回了合法 JSON 但 shots 为空 → 跟下面 catch 一样走 buildFallbackShotList 降级，
      // 【绝不】把「整理失败」错误弹给用户（这正是用户踩到的 live bug：救命的兜底零件造好了却没装上）。
      console.warn("[storyAgent] 模型返回的 shots 为空，按卡片降级出兜底分镜");
      return buildFallbackShotList(params.cards, characterHint, modelLabel);
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
      // 模型给的镜头全缺 action、被过滤光了 → 同样降级兜底，不弹错。
      console.warn("[storyAgent] 模型镜头全缺 action，按卡片降级出兜底分镜");
      return buildFallbackShotList(params.cards, characterHint, modelLabel);
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
