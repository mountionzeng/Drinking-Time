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
}

export const FIRST_QUESTION =
  '今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。';
