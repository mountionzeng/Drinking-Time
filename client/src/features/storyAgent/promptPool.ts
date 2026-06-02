/**
 * 提示词片段池 — 从 VisualCanvasItem.analysis 派生图像片段
 *
 * 片段（PromptFragment）是最小可复用单元：一段文本 + 标签 + 来源。
 * 本轮只新造 image 源片段；text 源字段保留给下一轮。
 */

import type { VisualCanvasItem, VisualCanvasAnalysis } from './types';

// ── 数据类型 ──

export type FragmentTag = '风格' | '色彩' | '构图' | '情绪' | '主体' | '光线';

export interface PromptFragment {
  id: string;
  text: string;
  source: 'image' | 'text';
  tag: FragmentTag;
  originCardId?: string;
  originItemId?: string;
  confidence?: number;
}

// ── 从单个 VisualCanvasAnalysis 提取片段 ──

export function extractFragmentsFromAnalysis(
  analysis: VisualCanvasAnalysis,
  options: { originCardId?: string; originItemId?: string } = {},
): PromptFragment[] {
  const fragments: PromptFragment[] = [];
  const { originCardId, originItemId } = options;
  const conf = analysis.confidence ?? undefined;

  // 风格
  for (const style of analysis.visualStyle ?? []) {
    const text = style.trim();
    if (text) {
      fragments.push({
        id: fragmentId('风格', text, originItemId),
        text,
        source: 'image',
        tag: '风格',
        originCardId,
        originItemId,
        confidence: conf,
      });
    }
  }

  // 色彩
  for (const color of analysis.colorPalette ?? []) {
    const text = color.trim();
    if (text) {
      fragments.push({
        id: fragmentId('色彩', text, originItemId),
        text,
        source: 'image',
        tag: '色彩',
        originCardId,
        originItemId,
        confidence: conf,
      });
    }
  }

  // 情绪
  for (const mood of analysis.mood ?? []) {
    const text = mood.trim();
    if (text) {
      fragments.push({
        id: fragmentId('情绪', text, originItemId),
        text,
        source: 'image',
        tag: '情绪',
        originCardId,
        originItemId,
        confidence: conf,
      });
    }
  }

  // 构图
  const composition = (analysis.composition ?? '').trim();
  if (composition) {
    fragments.push({
      id: fragmentId('构图', composition, originItemId),
      text: composition,
      source: 'image',
      tag: '构图',
      originCardId,
      originItemId,
      confidence: conf,
    });
  }

  // 光线
  const lighting = (analysis.lighting ?? '').trim();
  if (lighting) {
    fragments.push({
      id: fragmentId('光线', lighting, originItemId),
      text: lighting,
      source: 'image',
      tag: '光线',
      originCardId,
      originItemId,
      confidence: conf,
    });
  }

  // 主体（从 objective 提取）
  const objective = (analysis.objective ?? '').trim();
  if (objective) {
    fragments.push({
      id: fragmentId('主体', objective, originItemId),
      text: objective,
      source: 'image',
      tag: '主体',
      originCardId,
      originItemId,
      confidence: conf,
    });
  }

  return fragments;
}

// ── 从单个 VisualCanvasItem 提取片段 ──

export function extractFragmentsFromItem(item: VisualCanvasItem): PromptFragment[] {
  return extractFragmentsFromAnalysis(item.analysis, {
    originCardId: item.cardId,
    originItemId: item.id,
  });
}

// ── 从全部 visualCanvasItems 构建去重池 ──

export function buildPromptPool(items: VisualCanvasItem[]): PromptFragment[] {
  const all: PromptFragment[] = [];
  for (const item of items) {
    all.push(...extractFragmentsFromItem(item));
  }
  return deduplicateFragments(all);
}

// ── 去重：同 tag + 同 text 合并（保留第一个出现的） ──

export function deduplicateFragments(fragments: PromptFragment[]): PromptFragment[] {
  const seen = new Set<string>();
  const result: PromptFragment[] = [];
  for (const f of fragments) {
    const key = `${f.tag}::${f.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(f);
    }
  }
  return result;
}

// ── 按标签分组 ──

export function groupByTag(fragments: PromptFragment[]): Record<FragmentTag, PromptFragment[]> {
  const groups: Record<FragmentTag, PromptFragment[]> = {
    '风格': [],
    '色彩': [],
    '构图': [],
    '情绪': [],
    '主体': [],
    '光线': [],
  };
  for (const f of fragments) {
    groups[f.tag].push(f);
  }
  return groups;
}

// ── 辅助 ──

function fragmentId(tag: string, text: string, itemId?: string): string {
  // 确定性 id：让同一来源同一标签同一文本始终产出同一 id
  const base = `${tag}:${text}:${itemId ?? ''}`;
  // 简单 hash —— 不需要密码学安全，只需稳定
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return `frag-${tag}-${Math.abs(hash).toString(36)}`;
}
