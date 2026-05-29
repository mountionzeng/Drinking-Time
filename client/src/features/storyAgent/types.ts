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
