/**
 * 镜头间连续性提示 —— 基于前一个镜头的 prompt/图片/元数据，
 * 生成衔接提示，确保镜头之间的视觉连贯性。
 *
 * 连续性维度：
 * 1. 主体一致性：同一角色在相邻镜头中外观一致
 * 2. 场景过渡：地点、时间、光线的自然衔接
 * 3. 情绪弧线：情绪的渐变而非突变
 * 4. 色调延续：前一镜头的色调/氛围在下一镜头中保持
 * 5. 运镜衔接：前一镜头的结束构图与下一镜头的开始构图匹配
 */

import type { PromptPreviousShot, PromptShotMeta } from './promptContext';

// ── 连续性分析 ──

type ContinuityDimension = {
  /** 维度名称 */
  name: string;
  /** 连续性提示文本 */
  hint: string;
  /** 强度 0-1：0=完全独立，1=强连续 */
  strength: number;
};

/**
 * 分析两个相邻镜头之间的连续性需求。
 */
function analyzeContinuity(
  prev: PromptPreviousShot,
  current: PromptShotMeta,
): ContinuityDimension[] {
  const dims: ContinuityDimension[] = [];

  // 1. 主体连续性：如果前后镜头都有 subject，且内容不同但相关
  if (prev.subject && current.subject) {
    const sameSubject = prev.subject.toLowerCase() === current.subject.toLowerCase();
    if (sameSubject) {
      dims.push({
        name: 'subject',
        hint: `Maintain the same character/subject appearance as the previous frame (SH${String(prev.shotNo).padStart(2, '0')}).`,
        strength: 0.9,
      });
    } else {
      dims.push({
        name: 'subject',
        hint: `Transition from the previous subject "${prev.subject}" to the new subject "${current.subject}".`,
        strength: 0.6,
      });
    }
  }

  // 2. 场景连续性
  if (prev.location && current.location) {
    if (prev.location.toLowerCase() === current.location.toLowerCase()) {
      dims.push({
        name: 'location',
        hint: `Same location as previous frame: ${current.location}. Maintain spatial consistency.`,
        strength: 0.8,
      });
    } else {
      dims.push({
        name: 'location',
        hint: `Transition from "${prev.location}" to "${current.location}".`,
        strength: 0.5,
      });
    }
  }

  // 3. 情绪连续性
  if (prev.mood && current.mood) {
    if (prev.mood.toLowerCase() === current.mood.toLowerCase()) {
      dims.push({
        name: 'mood',
        hint: `Maintain the ${current.mood} atmosphere from the previous frame.`,
        strength: 0.7,
      });
    } else {
      dims.push({
        name: 'mood',
        hint: `Emotional shift: from ${prev.mood} to ${current.mood}. Ensure a natural emotional gradient, not an abrupt cut.`,
        strength: 0.6,
      });
    }
  }

  // 4. 风格连续性
  if (prev.styleRef && current.styleRef) {
    if (prev.styleRef === current.styleRef) {
      dims.push({
        name: 'style',
        hint: `Maintain the same visual style as the previous frame for series coherence.`,
        strength: 0.95,
      });
    }
  }

  // 5. 转场提示
  if (prev.transition) {
    dims.push({
      name: 'transition',
      hint: `Previous transition type: ${prev.transition}. Ensure the visual flow supports this transition.`,
      strength: 0.4,
    });
  }

  return dims;
}

/**
 * 从前一个镜头的最终 prompt 中提取关键视觉元素（色调、构图关键词）。
 * 这些信息用于生成更精准的连续性提示。
 */
function extractVisualAnchors(prompt: string): string[] {
  const anchors: string[] = [];
  // 提取方括号内的关键词（常见于 MJ prompt 的风格标记）
  const bracketMatches = prompt.match(/\[([^\]]+)\]/g);
  if (bracketMatches) {
    anchors.push(...bracketMatches.slice(0, 3));
  }
  // 提取常见的视觉关键词
  const visualKeywords = [
    /(?:warm|cool|cold|golden|amber|blue|green|red|dark|bright|soft|hard)\s+(?:light|tone|mood|color)/gi,
    /(?:close[- ]?up|wide shot|medium shot|over[- ]?the[- ]?shoulder|bird'?s? eye)/gi,
  ];
  for (const kw of visualKeywords) {
    const matches = prompt.match(kw);
    if (matches) {
      anchors.push(...matches.slice(0, 2));
    }
  }
  return anchors.slice(0, 5);
}

/**
 * 构建镜头间连续性提示块。
 *
 * @param prev     前一个镜头的信息
 * @param current  当前镜头的信息
 * @returns        连续性提示文本，可直接拼接到 prompt 中
 */
export function buildContinuityHint(
  prev: PromptPreviousShot,
  current: PromptShotMeta,
): string {
  const dims = analyzeContinuity(prev, current);
  if (dims.length === 0) return '';

  // 按强度排序，只保留有意义的维度
  const significant = dims.filter((d) => d.strength >= 0.3);
  if (significant.length === 0) return '';

  const lines: string[] = [
    `【Inter-shot continuity from SH${String(prev.shotNo).padStart(2, '0')} → SH${String(current.shotNo).padStart(2, '0')}】`,
  ];

  // 如果有前一镜头的 finalPrompt，提取视觉锚点
  if (prev.finalPrompt) {
    const anchors = extractVisualAnchors(prev.finalPrompt);
    if (anchors.length > 0) {
      lines.push(`Previous frame visual anchors: ${anchors.join(', ')}.`);
    }
  }

  for (const dim of significant) {
    lines.push(dim.hint);
  }

  return lines.join('\n');
}
