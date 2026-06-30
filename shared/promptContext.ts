/**
 * 统一提示词框架 —— 所有出图路径共享的 prompt 结构与组装逻辑。
 *
 * 设计原则：
 * 1. 所有路径输出标准化的 PromptContext，不再各自拼字符串
 * 2. buildUnifiedPrompt 按固定顺序组装 prompt block，自动去重
 * 3. 镜头间连续性由 buildContinuityHint 生成，注入 prompt
 */

import { SINGLE_FRAME_HARD_CONSTRAINT } from './singleFramePrompt';
import type { ArtRecipeDNA } from './artDirection';
import { artRecipePrompt } from './artDirection';

// ── PromptContext 类型 ──

/** 镜头元数据：每个镜头必有的信息 */
export type PromptShotMeta = {
  shotNo: number;
  subject?: string;
  action?: string;
  location?: string;
  timeLight?: string;
  mood?: string;
  styleRef?: string;
  shotType?: string;
  cameraAngle?: string;
  cameraMove?: string;
  beat?: string;
  intent?: string;
  rationale?: string;
  sourceCardContent?: string;
  negativePrompt?: string;
  promptDraft?: string;
};

/** 故事上下文：跨镜头共享的信息 */
export type PromptStoryContext = {
  storyId: number;
  storyTitle?: string;
  storyTheme?: string;
  genre?: string;
};

/** 角色信息 */
export type PromptCharacter = {
  name: string;
  description?: string;
  referenceImageUrl?: string;
};

/** 前一个镜头的连续性信息 */
export type PromptPreviousShot = {
  shotNo: number;
  finalPrompt?: string;
  imageUrl?: string;
  subject?: string;
  mood?: string;
  location?: string;
  styleRef?: string;
  transition?: string;
};

/** 美术方向 */
export type PromptArtDirection = {
  recipe?: ArtRecipeDNA;
  styleIndex?: number;
};

/** 用户反馈信号 */
export type PromptFeedback = {
  rejectionStyles?: string[];
  editPreferences?: string[];
  chatCorrections?: string[];
};

/** 完整的提示词上下文 */
export type PromptContext = {
  shot: PromptShotMeta;
  story: PromptStoryContext;
  artDirection?: PromptArtDirection;
  characters?: PromptCharacter[];
  previousShot?: PromptPreviousShot;
  feedback?: PromptFeedback;
  /** 自由文本 prompt（聊天路径直接传入的英文 prompt） */
  freeTextPrompt?: string;
  /** 出图模式 */
  mode?: 'draft' | 'final';
};

// ── Prompt Block 组装 ──

type PromptBlock = {
  label: string;
  text: string;
};

/**
 * 从 PromptContext 的各字段提取 prompt blocks，
 * 按优先级排序，去重后合并为完整 prompt。
 */
function extractBlocks(ctx: PromptContext): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  const seen = new Set<string>();

  function add(label: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // 去重：如果文本的前 60 字符已出现过，跳过
    const key = trimmed.slice(0, 60).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ label, text: trimmed });
  }

  // 1. 镜头标识
  add('shot', `Create exactly one cinematic key frame for SH${String(ctx.shot.shotNo).padStart(2, '0')}.`);

  // 2. 自由文本 prompt（聊天路径的 LLM 生成内容）
  if (ctx.freeTextPrompt) {
    add('freeText', ctx.freeTextPrompt);
  }

  // 3. 镜头内容：promptDraft 优先（它本身就是完整的镜头描述），否则从 shot 字段构建
  // 当 promptDraft 存在时，跳过后续的 styleRef/intent/rationale/camera block 避免重复和超长
  const hasPromptDraft = !ctx.freeTextPrompt && Boolean(ctx.shot.promptDraft);
  if (!ctx.freeTextPrompt) {
    if (ctx.shot.promptDraft) {
      add('content', ctx.shot.promptDraft);
    } else {
      const contentParts: string[] = [];
      if (ctx.shot.subject) contentParts.push(`Subject: ${ctx.shot.subject}`);
      if (ctx.shot.action) contentParts.push(`Action: ${ctx.shot.action}`);
      if (ctx.shot.location) contentParts.push(`Scene: ${ctx.shot.location}`);
      if (ctx.shot.timeLight) contentParts.push(`Lighting: ${ctx.shot.timeLight}`);
      if (ctx.shot.mood) contentParts.push(`Mood: ${ctx.shot.mood}`);
      if (ctx.shot.sourceCardContent) contentParts.push(`Source Story Card: ${ctx.shot.sourceCardContent}`);
      add('content', contentParts.join('. ') + '.');
    }
  }

  // 4-6. 视觉框架 / 导演意图 / 运镜：仅在没有 promptDraft 时追加（避免重复）
  if (ctx.shot.styleRef) {
    add('styleRef', `Shared visual framework for the whole film: ${ctx.shot.styleRef}`);
  }
  if (ctx.shot.intent) {
    add('intent', `Director intent: ${ctx.shot.intent}`);
  }
  if (ctx.shot.rationale) {
    add('rationale', `Why this frame works: ${ctx.shot.rationale}`);
  }
  if (!hasPromptDraft) {
    const cameraParts: string[] = [];
    if (ctx.shot.shotType) cameraParts.push(`Shot type: ${ctx.shot.shotType}`);
    if (ctx.shot.cameraAngle) cameraParts.push(`Camera angle: ${ctx.shot.cameraAngle}`);
    if (ctx.shot.cameraMove) cameraParts.push(`Camera movement: ${ctx.shot.cameraMove}`);
    if (cameraParts.length > 0) {
      add('camera', cameraParts.join('. ') + '.');
    }
  }

  // 7. 角色描述
  if (ctx.characters && ctx.characters.length > 0) {
    const charDesc = ctx.characters
      .map((c) => c.description ? `${c.name}: ${c.description}` : c.name)
      .join('; ');
    add('characters', `Characters: ${charDesc}`);
  }

  // 8. 美术方向（artRecipeDNA）
  if (ctx.artDirection?.recipe) {
    const recipeText = artRecipePrompt(ctx.artDirection.recipe);
    if (recipeText) {
      add('artRecipe', `【Story visual recipe】${recipeText}`);
    }
  }

  // 9. 负面提示
  if (ctx.shot.negativePrompt) {
    add('negative', `Avoid: ${ctx.shot.negativePrompt}`);
  }

  // 10. 用户反馈
  if (ctx.feedback) {
    if (ctx.feedback.rejectionStyles && ctx.feedback.rejectionStyles.length > 0) {
      add('rejection', `Do not use rejected styles: ${ctx.feedback.rejectionStyles.join(', ')}`);
    }
    if (ctx.feedback.chatCorrections && ctx.feedback.chatCorrections.length > 0) {
      add('corrections', `User visual corrections: ${ctx.feedback.chatCorrections.join('; ')}`);
    }
    if (ctx.feedback.editPreferences && ctx.feedback.editPreferences.length > 0) {
      add('preferences', `User preferences: ${ctx.feedback.editPreferences.join('; ')}`);
    }
  }

  // 11. 硬约束
  add('hardConstraint', SINGLE_FRAME_HARD_CONSTRAINT);

  // 12. 原创声明
  add('originality', '保持原创风格化插图，不模仿或复制任何具名艺术家、电影或现成 IP。');

  return blocks;
}

/**
 * 从 PromptContext 构建统一格式的 prompt 字符串。
 *
 * 输出格式：
 *   [镜头标识]
 *   [镜头内容 / 自由文本]
 *   [视觉框架]
 *   [导演意图]
 *   [镜头类型与运镜]
 *   [角色]
 *   [美术配方]
 *   [负面提示]
 *   [用户反馈]
 *   [硬约束]
 *   [原创声明]
 */
export function buildUnifiedPrompt(ctx: PromptContext): string {
  const blocks = extractBlocks(ctx);
  let prompt = blocks.map((b) => b.text).join('\n');
  // MJ prompt 长度软限制：超过 3000 字符时截断尾部块
  const MAX_PROMPT_LENGTH = 3000;
  if (prompt.length > MAX_PROMPT_LENGTH) {
    // 保留前 N 个 block，逐步截断直到符合限制
    for (let keep = blocks.length - 1; keep > 1; keep--) {
      const truncated = blocks.slice(0, keep).map((b) => b.text).join('\n');
      if (truncated.length <= MAX_PROMPT_LENGTH) {
        return truncated;
      }
    }
    return prompt.slice(0, MAX_PROMPT_LENGTH);
  }
  return prompt;
}

/**
 * 提取去重后的 styleRef：如果 prompt 内容里已经包含风格描述，
 * 外部就不要再追加 ", art style: xxx" 了。
 *
 * 返回 true 表示"prompt 已经自带风格，外部不需要再追加 styleHint"。
 */
export function promptHasStyleRef(ctx: PromptContext): boolean {
  return Boolean(ctx.shot.styleRef?.trim());
}
