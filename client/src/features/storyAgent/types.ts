/**
 * Story Guide Agent — shared types
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** If set, this assistant turn produced a card (for inline UI hints). */
  spawnedCardId?: string;
  /** If set, this user message was a selection edit instruction. */
  selectionQuote?: SelectionQuote;
}

export interface StoryCard {
  id: string;
  title: string;
  content: string;
  rawText?: string;
  sourceQuote?: string;
  emotion: string;
  emotionOptions?: string[];
  emotionBlend?: string[];
  sensoryDetails: string[];
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
  createdAt: number;
}

export interface ScriptScene {
  sceneNo: string;
  fromCardId: string;
  visual: string;
  emotion: string;
}

export interface GeneratedScript {
  id: string;
  title: string;
  logline: string;
  theme?: string;
  scenes: ScriptScene[];
  arcSummary: string;
  variants?: Array<{
    mode: '克制版' | '戏剧版' | '诗意版';
    logline: string;
    arc: string;
    treatment: string;
  }>;
  boringCheck?: {
    hasConflict: boolean;
    hasTurn: boolean;
    hasWish: boolean;
    hasCost: boolean;
    hasChange: boolean;
    note: string;
  };
  /** Card order this script was generated from — useful for re-running. */
  cardOrder: string[];
  createdAt: number;
}

export interface StoryShot {
  shotNo: number;
  subject: string;
  action: string;
  dialogue: string;
  shotType: string;
  beat: string;
  cameraAngle: string;
  cameraMove: string;
  location: string;
  timeLight: string;
  mood: string;
  sound: string;
  styleRef: string;
  note: string;
  emotion: string;
  sourceCardContent: string;
  /** 情绪电荷：本镜情绪 + beat 位置 + 与上一镜的流动 delta。 */
  emotionCharge?: string;
  /** 与上一镜的情绪转变描述。转折镜重点表达这个变化。 */
  emotionDelta?: string;
  /** 画布视觉锚摘要，供下游出图继承风格。 */
  visualAnchorText?: string;
  /** 最终出图 prompt：视觉内容 + 情绪电荷 + 视觉锚。 */
  promptDraft?: string;
  negativePrompt?: string;
}

export interface VisualCanvasAnalysis {
  /** 客观内容：图里实际有什么，尽量不脑补。 */
  objective: string;
  /** 美术/情绪解读：这张图给人的审美和情绪感觉。 */
  aesthetic: string;
  visualStyle: string[];
  mood: string[];
  colorPalette: string[];
  composition: string;
  lighting: string;
  promptDraft: string;
  negativePrompt: string;
  confidence: number;
}

export interface VisualCanvasItem {
  id: string;
  title: string;
  imageUrl: string;
  originalImageUrl?: string;
  source: 'reference' | 'riff';
  parentId?: string;
  cardId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  userInstruction?: string;
  analysis: VisualCanvasAnalysis;
  createdAt: number;
}

export interface SelectionState {
  sourceType: 'card' | 'script-scene' | 'script-meta' | 'shot' | 'chat';
  sourceId: string;
  selectedText: string;
  fullText: string;
}

export interface SelectionQuote {
  sourceType: SelectionState['sourceType'];
  sourceId: string;
  selectedText: string;
}

export const FIRST_QUESTION =
  '今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。';

// 桌面端开场「报到 + 人格 + 定位」preamble（U4 / D4：前缀策略，不改 FIRST_QUESTION 文本）。
// 一句话点到「朋友 + 助手」身份，落点交给 FIRST_QUESTION 的邀请。
// 精简自原三句版：删掉与 FIRST_QUESTION 重复的「随口说 / 不用大事」，收到约 1/3，避免开场啰嗦（AE1 实测反馈）。
// 硬约束：保留「你好，我是小酌 / 朋友 / 助手 / 一件今天的小事」四个 token（openingCopy.test.ts 守着）；
// 不含「收集 / 采样」字样；不含「永久 / 永远记得 / 都会记住」式永久记忆承诺（R6/R13）。
export const OPENING_PREAMBLE =
  '你好，我是小酌——会听你说话的朋友，也是帮你把一件今天的小事做成小短片的助手。';

// emptyState() 实际播出的组合开场消息：preamble 在前报到 + 立人格，FIRST_QUESTION 收尾邀请。
export const OPENING_MESSAGE = `${OPENING_PREAMBLE}\n\n${FIRST_QUESTION}`;

// ── 第二步：召回 + 记忆承诺 ──
// 老用户从「入口选择屏」点回一篇旧故事时，小酌说的「我还记得上次……」再问候。
// 这是「记忆承诺」体验的核心一句：用真实留存的内容（logline / 最近一张卡片 / 标题）
// 证明「我记着」，把人温柔地接回这篇，邀请往下说。
//
// honesty 约束（R6 / R13）：
//   · 语气克制——只说「还记着 / 还留着 / 还在」，绝不承诺「永久 / 永远记住 / 都会记住」；
//     承诺强度被本地留存能力兜着（同账号服务端留存，不是永久），不能说死。
//   · 不再问「继续还是开新」——那是入口选择屏的事；这里只接回这一篇。
//   · 没有任何用户发言可召回时返回 null（不硬造记忆、不对空故事假装记得）。
// 守着这些约束的回归测试在 returningGreeting.test.ts。
export interface ReturningGreetingInput {
  /** 这篇故事里是否有过用户真实发言（只有开场白不算）。false → 不召回。 */
  hasPriorUserMessages: boolean;
  /** 故事 logline（最有画面感，优先用）。 */
  logline?: string | null;
  /** 最近一张卡片的原话锚点（card.sourceQuote，≤24 字），次选。 */
  lastCardQuote?: string | null;
  /** 故事标题，再次选。 */
  title?: string | null;
}

function clampGreetingText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

export function buildReturningGreeting(input: ReturningGreetingInput): string | null {
  if (!input.hasPriorUserMessages) return null;
  const logline = input.logline?.trim();
  const quote = input.lastCardQuote?.trim();
  const title = input.title?.trim();
  if (logline) {
    return `我还记得我们上次聊到的——「${clampGreetingText(logline, 40)}」。今天想从这儿接着说吗？`;
  }
  if (quote) {
    return `上次你说到「${clampGreetingText(quote, 24)}」，我还记着。今天想接着往下聊吗？`;
  }
  if (title) {
    return `「${clampGreetingText(title, 24)}」我还留着呢。今天想从哪儿接着说？`;
  }
  return '我还在呢，上次聊的都留着。今天想从哪儿接着说？';
}
