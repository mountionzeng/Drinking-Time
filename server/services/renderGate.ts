/**
 * 全站静态图片唯一的美术提示词工程入口。
 *
 * 上游只负责提供故事/镜头事实、用户指令、参考图提取出的美术 DNA；这里统一决定
 * 如何把它们编译成最终美术提示词。imageGen 等 provider adapter 只负责传图、参数和
 * 模型级安全约束，不得再偷偷补写色调、服装或审美方向。
 */
import { getActiveStyles, styleToFragments } from "./styleLibrary";
import { artRecipePrompt, type ArtRecipeDNA } from "../../shared/artDirection";
import {
  getRecentRejectionSignals,
  getRecentEditPreferences,
  getRecentChatCorrections,
} from "../db";
import { artRepositoryPromptBlocks } from "./artRepository";

export type ImageOutputPurpose =
  | "story-frame"
  | "publishing-cover"
  | "image-edit";
export type ImageReferencePolicy =
  | "none"
  | "style-only"
  | "preserve-identity"
  | "preserve-composition";

/** 渲染上下文：prompt 只承载内容事实；美术与交互意图通过独立字段传入。 */
export type RenderContext = {
  prompt: string;
  /** 用户意图（如「改暖一点」） */
  intent?: string;
  /** 情绪信号 */
  emotion?: string;
  /** 用户参考图 / 原图 URL（美术判断的主要参照之一） */
  referenceImages?: string[];
  /** 关联镜号 */
  shotNo?: string;
  /** 关联项目 */
  projectId?: number;
  /** 关联故事（用于查询拒绝信号） */
  storyId?: number;
  /** 当前故事已经确认的原创视觉配方。存在时优先于流派库。 */
  artDirection?: ArtRecipeDNA;
  /** 用户选择的风格索引（存在 story body 里）。 */
  styleIndex?: number;
  /** 本轮需要持续遵守的、用户可见且可编辑的要求。 */
  userInstructions?: string[];
  /** 不同用途只改变产品约束，不得各自再拥有一套美术提示词。 */
  outputPurpose?: ImageOutputPurpose;
  /** 参考图只供美术 DNA，或作为修改所依赖的构图基础。 */
  referencePolicy?: ImageReferencePolicy;
  /** 四图封面探索使用固定的“1 克制 + 2 大胆 + 1 意外”梯度。 */
  fourCandidateExploration?: boolean;
  /** 未选择上一轮任何候选时，上一整轮视觉方案都视为已拒绝。 */
  discardPreviousRound?: boolean;
  /** 当前探索轮次，用于确定性切换媒介与视觉机制。 */
  explorationRound?: number;
  /** 当前/相邻故事板画面是本轮可见事实来源。 */
  storyboardReferenceTruth?: boolean;
  /** 上游已经复制正式采用封面的美术原文；网关不得再追加或改写美术方向。 */
  preservePrompt?: boolean;
  /**
   * 目标 provider 支持长提示词（gpt-image 等）。3500 字上限本来是 Midjourney 的
   * 限制，却被套在所有 provider 上：精确改图那条路会因此把用户要求截断到 1800 字，
   * 服装、质感这类写在后面的连续性规格整段丢掉，模型收到的是半句话。
   */
  longPrompt?: boolean;
  /**
   * 用户已经逐字写好这一镜要什么，并且有参考帧在手。
   *
   * 2026-08-19 SheSelf 0307：用户写了 400 字的镜头美术要求，编译出来是 2615 字，
   * 他的要求只占 14.1%。剩下 86% 里，【艺术跃迁】命令模型「做一个相机拍不到的
   * 视觉决定」，【艺术谱系】按关键词自动塞进一个流派，【手作完成度】和
   * 【私人策展库审美底线】各加一层材质与审美倾向——八轮重渲每次都被拉回
   * 「暗调、两个女人、油画感」这个平均值，四人红黑构图始终立不住。
   *
   * 这些生成性美术块是给「用户没说清楚」准备的。用户说清楚了的时候，它们就是噪声。
   * 置为 true 时只保留内容主权、用户要求、参考边界、故事板事实与两条硬约束。
   */
  authoredBrief?: boolean;
};

/** 用户明确选中的库风格是覆盖项；自动美术判断走下方的文本艺术谱系。 */
function pickStyle(ctx: RenderContext) {
  const styles = getActiveStyles();
  if (styles.length === 0) return null;
  if (ctx.styleIndex != null) {
    return styles[ctx.styleIndex % styles.length];
  }
  return null;
}

type TextArtSignals = {
  emotion: string;
  era: string | null;
  livedTextures: string[];
  narrativeDistance: string;
};

type ArtLineage = {
  id: string;
  label: string;
  artists: string;
  movements: string;
  media: string;
  making: string;
  signals: string[];
};

/**
 * 默认谱系只使用历史艺术家作为技法坐标，并且把“媒介如何留下痕迹”写清楚。
 * 这里不预设色板，避免艺术谱系重新变成全站统一滤镜。
 */
const HANDMADE_ART_LINEAGES: ArtLineage[] = [
  {
    id: "expressive-print",
    label: "表现主义版画的心理压强",
    artists: "凯绥·柯勒惠支",
    movements: "表现主义版画、社会现实主义绘画",
    media: "木刻、石版、炭笔与粗纸",
    making: "刀痕、重压黑线、擦除和纸纤维共同承担情绪",
    signals: [
      "焦虑",
      "压迫",
      "愤怒",
      "批判",
      "系统",
      "规训",
      "工业",
      "工具",
      "信息流",
    ],
  },
  {
    id: "symbolist-pastel",
    label: "象征主义的内心显影",
    artists: "奥迪隆·雷东、古斯塔夫·莫罗",
    movements: "象征主义、世纪末幻想艺术",
    media: "粉彩、炭笔、薄层油彩与纸本",
    making: "让炭灰、粉彩浮尘和未覆盖底稿把不可见的心理变成物质",
    signals: [
      "欲望",
      "梦",
      "恐惧",
      "沉默",
      "孤独",
      "内心",
      "秘密",
      "灵魂",
      "不安",
    ],
  },
  {
    id: "nabist-memory",
    label: "纳比派的私密记忆",
    artists: "皮埃尔·博纳尔、爱德华·维亚尔",
    movements: "纳比派、后印象主义室内绘画",
    media: "不透明水粉、蜡笔、铅笔底稿与吸水纸",
    making: "可见的叠笔、局部擦洗和轻微失准让记忆像被人反复触摸过",
    signals: [
      "记忆",
      "童年",
      "怀旧",
      "家",
      "厨房",
      "相册",
      "旧",
      "温柔",
      "亲密",
      "九十年代",
      "1990年代",
    ],
  },
  {
    id: "visionary-romantic",
    label: "浪漫主义幻视与手工印制",
    artists: "威廉·布莱克、塞缪尔·帕尔默",
    movements: "浪漫主义幻视绘画、英国水彩传统",
    media: "水彩、墨线、浮雕蚀刻与手工套色",
    making: "让渗色、压印边缘和手工套色偏差构成超现实空间",
    signals: [
      "神话",
      "月亮",
      "命运",
      "生长",
      "死亡",
      "自然",
      "森林",
      "宗教",
      "星空",
      "幻觉",
    ],
  },
  {
    id: "spiritual-abstraction",
    label: "神秘抽象的结构性想象",
    artists: "希尔玛·阿夫·克林特、保罗·克利",
    movements: "早期抽象艺术、神秘主义绘画",
    media: "蛋彩、水粉、铅笔网格与有齿纸面",
    making: "保留测量线、颜色越界和反复覆盖，让抽象结构像亲手推演出来",
    signals: [
      "机制",
      "时间",
      "循环",
      "关系",
      "秩序",
      "意识",
      "抽象",
      "宇宙",
      "结构",
    ],
  },
  {
    id: "naive-fable",
    label: "朴素主义的陌生寓言",
    artists: "亨利·卢梭",
    movements: "朴素主义、民间绘画与寓言插画",
    media: "蛋彩、水粉、平涂油彩与纸板",
    making: "不完美透视、手描轮廓和不均匀平涂保留人的判断",
    signals: [
      "寓言",
      "动物",
      "植物",
      "荒诞",
      "童话",
      "孩子",
      "菜市场",
      "奇遇",
      "幽默",
    ],
  },
];

const COVER_RESTART_METHODS = [
  "让人物与巨大环境的尺度关系承担主题，以断裂地平线和不可能空间组织画面",
  "让颜料、纤维、土壤或木纹发生非现实变形，由材料行为承担主题",
  "把光、影、气流或重力变成有重量的空间结构，让人物在其中行动",
  "以地貌、天气与植物群落的变化表达主题，不使用居中的象征物静物",
  "以人物之间的距离、姿态和遮挡关系表达冲突，不依赖道具隐喻",
  "采用手工剪影、套色版画与粗糙边缘，以平面节奏取代摄影景深",
  "使用不带符号含义的抽象形体、色块边界和材料裂变构成叙事空间",
  "让室内与室外、近景与远景发生不可能的连续折叠，形成梦境式场所",
] as const;

const STATIC_IMAGE_STYLIZATION_CONSTRAINT =
  "【风格化硬约束】最终画面必须是明显风格化、具有手工媒介痕迹的原创图像，不能被误认成相机照片、商品摄影、图库照片或光滑的 3D 渲染。使用可见笔触、纸面阻力、颜料厚薄、套色偏差、擦除或有判断的形体简化；不要摄影写实、产品布光、镜头虚化和塑料质感。";

const STATIC_IMAGE_TEXT_FREE_CONSTRAINT =
  "【静态图片无字硬约束】这是不可被故事、用户指令、参考图或风格规则覆盖的产品不变量：画面像素中禁止可读文字、伪文字、字母、数字、Logo、品牌标记、签名、水印、标题、字幕、标签、书脊字和界面字符。不要描绘钟表、日历、书页、报纸、招牌、包装、屏幕等通常承载字符的正面；故事确实需要时，只能显示无字背面、被完全遮挡或裁出画外的表面。任何需要的标题或文案只能由产品界面后期叠加，绝不能画进图片像素中。";

const ERA_PATTERNS = [
  /(?:18|19|20)\d{2}年代/,
  /(?:六十|七十|八十|九十|零零|一零|二零)年代/,
  /先秦|汉代|唐代|宋代|元代|明代|清代|民国|改革开放初期|当代|未来/,
];

function inferTextArtSignals(ctx: RenderContext): TextArtSignals {
  const text = `${ctx.prompt}\n${ctx.emotion ?? ""}`;
  const era = ERA_PATTERNS.map(
    pattern => text.match(pattern)?.[0] ?? null
  ).find(Boolean) as string | null | undefined;
  const livedTextures = [
    /厨房|卧室|客厅|家里|家庭|母亲|父亲/.test(text) ? "家庭内部" : "",
    /街道|城市|楼房|地铁|霓虹|商场/.test(text) ? "城市日常" : "",
    /村庄|田地|县城|集市|菜市场/.test(text) ? "地方生活" : "",
    /机器|工厂|工业|算法|信息流|屏幕|网络|工具/.test(text) ? "技术与系统" : "",
    /森林|山|河|海|植物|月亮|星空/.test(text) ? "自然世界" : "",
  ].filter(Boolean);
  const inferredEmotion = [
    [/怀旧|记忆|童年|过去/, "怀旧"],
    [/焦虑|窒息|压迫|慌张|不安/, "焦虑与不安"],
    [/愤怒|批判|反抗/, "愤怒与批判"],
    [/温柔|亲密|爱|安慰/, "温柔与亲密"],
    [/孤独|疏离|空虚/, "孤独与疏离"],
    [/清醒|冷静|克制/, "清醒与克制"],
  ].find(([pattern]) => (pattern as RegExp).test(text))?.[1] as
    | string
    | undefined;
  return {
    emotion:
      ctx.emotion?.trim() || inferredEmotion || "未明示，不套固定情绪滤镜",
    era: era ?? null,
    livedTextures:
      livedTextures.length > 0 ? livedTextures : ["由具体人物关系与动作决定"],
    narrativeDistance: /(^|[，。！？\s])我|自己|我们/.test(text)
      ? "贴近当事人的主观经验"
      : "从人物行动与关系观察，不替人物总结",
  };
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length > 0 ? hash % length : 0;
}

function chooseHandmadeLineage(
  ctx: RenderContext,
  signals: TextArtSignals
): ArtLineage {
  const text = `${ctx.prompt}\n${signals.emotion}\n${signals.livedTextures.join(" ")}`;
  const ranked = HANDMADE_ART_LINEAGES.map(lineage => ({
    lineage,
    score: lineage.signals.reduce(
      (score, signal) => score + (text.includes(signal) ? 1 : 0),
      0
    ),
  }));
  if (ctx.discardPreviousRound && ctx.explorationRound) {
    const ordered = ranked.slice().sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.lineage.id.localeCompare(right.lineage.id);
    });
    return ordered[(ctx.explorationRound - 1) % ordered.length]!.lineage;
  }
  const bestScore = Math.max(...ranked.map(candidate => candidate.score));
  const candidates = ranked
    .filter(candidate => candidate.score === bestScore)
    .map(candidate => candidate.lineage);
  return candidates[
    stableIndex(`${ctx.storyId ?? ""}:${ctx.prompt}`, candidates.length)
  ]!;
}

function textArtSignalBlock(signals: TextArtSignals): string {
  return [
    "【文本美术信号】",
    `主情绪：${signals.emotion}`,
    signals.era
      ? `明确年代：${signals.era}。年代只约束有文字证据的服装、物件和制作语境。`
      : "明确年代：原文未明示。不得擅自套用复古、民国、未来或其他年代造型。",
    `生活质地：${signals.livedTextures.join("、")}`,
    `叙述距离：${signals.narrativeDistance}`,
  ].join("\n");
}

function handmadeLineageBlocks(lineage: ArtLineage): string[] {
  return [
    `【艺术谱系】以${lineage.movements}为谱系，以历史艺术家${lineage.artists}作为技法坐标；不是复制某一幅作品。媒介：${lineage.media}。制作逻辑：${lineage.making}。`,
    "【手作完成度】画面必须像真实创作者经手完成的物件，而不是光滑的 AI 渲染。只选择两三种真正服务内容的制作痕迹，例如底稿、纸纤维、颜料厚薄、干刷、擦除、压印或轻微套色偏差；保留有判断的边缘和局部未完成感。禁止塑料般 3D 光泽、无来源泛光、过度平滑渐变、统一锐化、磨皮与无意义的细节堆积。",
  ];
}

function cleanInstructions(ctx: RenderContext): string[] {
  const budget = ctx.longPrompt
    ? LONG_INSTRUCTION_BUDGET
    : MJ_INSTRUCTION_BUDGET;
  const normalized = [...(ctx.userInstructions ?? []), ctx.intent ?? ""]
    .map(value => value.trim())
    .filter(Boolean);
  const unique = normalized.filter(
    (value, index) => normalized.lastIndexOf(value) === index
  );
  const kept: string[] = [];
  let remaining = budget;
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const value = unique[index]!;
    const separatorLength = kept.length > 0 ? 1 : 0;
    if (value.length + separatorLength > remaining) {
      if (kept.length === 0) kept.unshift(value.slice(0, remaining));
      break;
    }
    kept.unshift(value);
    remaining -= value.length + separatorLength;
  }
  return kept;
}

function productConstraintBlock(ctx: RenderContext): string[] {
  const blocks: string[] = [];
  if (ctx.outputPurpose === "publishing-cover") {
    blocks.push(
      "【封面产品约束】生成无文字的完整单幅画面，不做海报排版。主体与关键细节留在居中安全区，顶部保留由环境、材质或光线自然形成的安静留白。禁止可读文字、伪文字、数字、Logo、水印、界面、边框、分栏或装饰画框。所有可能承载字符的表面——钟面、日历、书页、报纸、招牌、包装、屏幕和界面——都必须避开；若它是已确认的故事事实，则只保留无字、被遮挡或不可读的材质表面。",
      "【封面概念转译】原始视觉联想不是已确认的故事事实，可以彻底推翻。除非它本身是故事事实，不要照搬钟表、沙漏、灯泡、棋子、道路、门、梯子、拼图、手机、发光大脑等库存隐喻；把抽象观点转译为空间、尺度、材料行为或人物关系。拒绝商品静物、广告样片、图库照片、励志海报和“一个物件居中放在干净背景上”的安全构图。"
    );
    if (ctx.discardPreviousRound) {
      const round = Math.max(2, ctx.explorationRound ?? 2);
      const base = stableIndex(
        String(ctx.storyId ?? "cover"),
        COVER_RESTART_METHODS.length
      );
      const method =
        COVER_RESTART_METHODS[
          (base + round - 1) % COVER_RESTART_METHODS.length
        ]!;
      blocks.push(
        `【整轮否决·第${round}轮】上一轮四张都没有被选中，视为上一轮的整套视觉方案被拒绝。本轮不得延续或微调上一轮；必须更换核心主体类别、主要物件、空间机制、构图骨架、媒介组合与色彩逻辑。不要把“换一波”做成同一物件的换色、换机位或换背景。本轮指定探索方法：${method}。`
      );
    }
  }
  if (ctx.referencePolicy === "style-only") {
    blocks.push(
      "【参考图边界】只继承已提取并经用户确认的美术 DNA；不得复制参考图中的人物身份、物体、地点、情节或文本。内容事实始终以上游故事为准。"
    );
  } else if (ctx.referencePolicy === "preserve-identity") {
    blocks.push(
      "【人物参考边界】参考图控制同一人物的可辨认身份、面部结构、发型、服装轮廓与已存在的材质特征；新镜头可以改变动作、机位和构图。只锁定图中真实可见的信息，不凭空指定裙长、颜色或其他细节。"
    );
  } else if (ctx.referencePolicy === "preserve-composition") {
    blocks.push(
      "【修改边界】把选中的原图作为视觉起点，保留它最有价值的主体关系、构图骨架与视觉身份；只按用户明确要求改变相应部分。不得凭空锁定某种服装、颜色、光线或材质。"
    );
  }
  if (ctx.storyboardReferenceTruth) {
    blocks.push(
      "【故事板视觉事实】提供的当前画面与相邻画面是本轮可见事实来源。除非用户明确要求改变，保留画面中真实可见的人物身份、年龄、面部、发型、服装、地点、建筑、道具、配色、光线、材质与制作设计；不要根据通用规则补写裙长、冷暖色、配饰或其他未显示的信息，也不要让文字美术库覆盖画面证据。"
    );
  }
  if (ctx.fourCandidateExploration) {
    blocks.push(
      "【四图探索梯度】同一内容生成四个真正不同的方向：一张克制但有艺术判断，两张采用更大胆的空间、尺度或材质表达，一张提供意料之外但仍准确的诗性方案。四张都必须忠于故事事实，不得只做同一构图的换色。"
    );
  }
  return blocks;
}

/** 编译最终提示词；所有静态图片入口必须直接或通过 renderViaGate 使用它。 */
export async function engineerImagePrompt(ctx: RenderContext): Promise<string> {
  if (ctx.preservePrompt) {
    return ctx.prompt.trim().slice(0, promptMaxLengthFor(ctx));
  }
  const additions: string[] = [];
  const instructions = cleanInstructions(ctx);
  const textSignals = inferTextArtSignals(ctx);

  // 故事事实 = 谁、发生了什么、彼此的关系与含义；不包括原文没写的长相。
  // 早期版本把两者混为一谈，于是「我希望是两个女性」这类指定会被模型当成
  // 「篡改故事事实」而悄悄忽略——要求确实送到了，同一段提示词里却另有一句
  // 话准许它不听。外观空缺由用户填，是分工，不是冲突。
  additions.push(
    "【内容主权】严格保留上游提供的人物关系、事件、场景关系与核心含义：不得增删人物、改变他们之间的关系、或反转事情的走向与含义。注意：原文没有明确写出的外观——性别、年龄、发型、体型、衣着、配色、光线与氛围——不属于故事事实，而是留给美术决定的空缺。"
  );
  if (instructions.length > 0) {
    additions.push(
      `【用户持续要求】${instructions.join("；")}。这些要求必须完整落实。这些是用户本人的美术指令，优先级高于你的默认想象：凡是原文未明写的外观，一律按用户所说执行，不得因为「可能改变故事事实」而打折扣或忽略。只有当某条要求与原文明确写出的事实直接冲突时才不执行它，并且照常完成其余要求。`
    );
  }
  additions.push(...productConstraintBlock(ctx));
  if (!ctx.authoredBrief) {
    additions.push(textArtSignalBlock(textSignals));
    additions.push(
      ...(await artRepositoryPromptBlocks(
        `${ctx.prompt}\n${ctx.emotion ?? ""}\n${instructions.join("\n")}`
      ))
    );
  }

  if (ctx.authoredBrief) {
    // 用户自己定了美术，不再叠加流派、谱系与跃迁指令。
  } else if (ctx.artDirection) {
    const recipe = artRecipePrompt(ctx.artDirection);
    if (recipe) {
      additions.push("【故事视觉配方】", recipe);
    }
  } else {
    const style = pickStyle(ctx);
    if (style) {
      const dna = styleToFragments(style)
        .map(f => `${f.tag}：${f.text}`)
        .join("；");
      if (dna) additions.push(`【美术流派·${style.name}】${dna}`);
    } else {
      additions.push(
        ...handmadeLineageBlocks(chooseHandmadeLineage(ctx, textSignals))
      );
    }
  }

  // 矫正循环：读取用户最近拒绝的图片信号 + 聊天矫正，生成负面约束
  if (ctx.storyId || ctx.projectId) {
    const rejectedBlock = await buildRejectionBlock(ctx.storyId, ctx.projectId);
    if (rejectedBlock) additions.push(rejectedBlock);
  }

  // 矫正循环：读取编辑器里的语义注解，把推断的创作偏好注入出图 prompt
  if (ctx.projectId) {
    const prefBlock = await buildEditPreferenceBlock(ctx.projectId);
    if (prefBlock) additions.push(prefBlock);
  }

  if (!ctx.authoredBrief)
    additions.push(
    "【艺术跃迁】避免把内容降格为普通摄影记录或通用“电影感”。至少做出一个相机无法直接拍到、但能让主题更准确的视觉决定：可以是非现实的空间关系、富有表现力的材质行为、象征性尺度、成为实体的光，或可读的情绪抽象。惊喜必须服务内容，不能靠无关奇观、固定暗色或固定配色制造“高级感”。",
    "艺术家与流派只能作为历史谱系、媒介和技法坐标：融合后形成新的视觉判断，不复刻任何单幅作品、标志性角色、签名或现成 IP，也不以在世艺术家的姓名下达直接模仿指令。"
  );
  const hardConstraints = [
    STATIC_IMAGE_STYLIZATION_CONSTRAINT,
    STATIC_IMAGE_TEXT_FREE_CONSTRAINT,
  ].join("\n");
  const bodyBudget = Math.max(
    0,
    promptMaxLengthFor(ctx) - hardConstraints.length - 1
  );
  const body = [ctx.prompt.trim(), additions.join("\n")]
    .filter(Boolean)
    .join("\n")
    .slice(0, bodyBudget);
  return [body, hardConstraints].filter(Boolean).join("\n");
}

/**
 * 从最近的 swipe_left 信号 + 聊天矫正信号中提取负面约束，生成 prompt 块。
 * swipe_left：从被拒图片的 recipe DNA 统计高频元素。
 * chat_correction：从用户聊天中的视觉修正指令直接提取。
 */
async function buildRejectionBlock(
  storyId: number | undefined,
  projectId: number | undefined
): Promise<string | null> {
  const parts: string[] = [];

  // 1. swipe_left 信号：被拒图片的 recipe DNA
  if (storyId) {
    try {
      const signals = await getRecentRejectionSignals(storyId, 10);
      if (signals.length > 0) {
        const rejectedDnas: ArtRecipeDNA[] = [];
        for (const sig of signals) {
          const meta = sig.metadata as Record<string, unknown> | null;
          const recipe = meta?.rejectedRecipe as
            | ArtRecipeDNA
            | null
            | undefined;
          if (recipe) rejectedDnas.push(recipe);
        }
        if (rejectedDnas.length > 0) {
          const threshold = Math.ceil(rejectedDnas.length / 2);
          const fields: (keyof ArtRecipeDNA)[] = [
            "style",
            "palette",
            "light",
            "composition",
            "material",
          ];
          const rejected: string[] = [];
          for (const field of fields) {
            const counts = new Map<string, number>();
            for (const dna of rejectedDnas) {
              const values = dna[field];
              if (!Array.isArray(values)) continue;
              for (const v of values) {
                counts.set(v, (counts.get(v) ?? 0) + 1);
              }
            }
            for (const [value, count] of Array.from(counts.entries())) {
              if (count >= threshold) rejected.push(value);
            }
          }
          if (rejected.length > 0) {
            parts.push(
              `不要使用以下被拒绝过的风格元素：${rejected.join("、")}`
            );
          }
        }
      }
    } catch {
      // 静默跳过
    }
  }

  // 2. chat_correction 信号：用户在聊天中的视觉修正指令
  if (projectId) {
    try {
      const corrections = await getRecentChatCorrections(projectId, 5);
      if (corrections.length > 0) {
        const texts: string[] = [];
        for (const sig of corrections) {
          const meta = sig.metadata as Record<string, unknown> | null;
          const correction = meta?.correction;
          if (typeof correction === "string" && correction.trim()) {
            texts.push(correction.trim());
          }
        }
        if (texts.length > 0) {
          parts.push(`用户明确要求的视觉修正：${texts.join("；")}`);
        }
      }
    } catch {
      // 静默跳过
    }
  }

  if (parts.length === 0) return null;
  return `【用户拒绝过的风格】${parts.join("。")}`;
}

/**
 * 从编辑器的语义注解中提取用户创作偏好，生成正向引导 prompt 块。
 * 逻辑：读取项目最近的 semanticAnnotations，聚合 inferredPreferences，
 * 去重后作为「用户偏好」注入出图 prompt。
 */
async function buildEditPreferenceBlock(
  projectId: number
): Promise<string | null> {
  try {
    const annotations = await getRecentEditPreferences(projectId, 5);
    if (annotations.length === 0) return null;

    const allPrefs: string[] = [];
    for (const ann of annotations) {
      const raw = ann.inferredPreferences;
      if (!raw) continue;
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
          allPrefs.push(
            ...parsed
              .filter(
                (preference): preference is string =>
                  typeof preference === "string"
              )
              .map(preference => preference.trim().slice(0, 300))
              .filter(Boolean)
          );
        }
      } catch {
        // 单条历史注解损坏不应丢弃其他有效偏好。
      }
    }
    if (allPrefs.length === 0) return null;

    // 去重，保留出现次数最多的偏好
    const counts = new Map<string, number>();
    for (const p of allPrefs) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pref]) => pref);

    if (sorted.length === 0) return null;
    return `【用户创作偏好】请参考以下偏好指导生成风格：${sorted.join("；")}`;
  } catch {
    // 查询失败不影响生成，静默跳过
    return null;
  }
}

/**
 * 出图网关：所有出图 / 重绘的唯一必经点。
 *
 * @param ctx    渲染上下文（至少含 prompt）
 * @param render 实际生成器调用，接收（可能被美术判断改写过的）prompt，返回该生成器自己的结果
 * @returns      render 的返回值原样透传（泛型 R，保留各生成器自己的返回形）
 */
const MJ_PROMPT_MAX_LENGTH = 3500;
/** gpt-image 接受的提示词远长于 MJ；这里留足余量，仍然防住无限增长。 */
const LONG_PROMPT_MAX_LENGTH = 12_000;
const MJ_INSTRUCTION_BUDGET = 1_800;
const LONG_INSTRUCTION_BUDGET = 6_000;

function promptMaxLengthFor(ctx: RenderContext): number {
  return ctx.longPrompt ? LONG_PROMPT_MAX_LENGTH : MJ_PROMPT_MAX_LENGTH;
}

export async function renderViaGate<R>(
  ctx: RenderContext,
  render: (prompt: string) => Promise<R>
): Promise<R> {
  const prompt = await engineerImagePrompt(ctx);
  return render(prompt);
}
