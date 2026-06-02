import { describe, expect, it } from 'vitest';
import {
  extractFragmentsFromAnalysis,
  extractFragmentsFromItem,
  buildPromptPool,
  deduplicateFragments,
  groupByTag,
  type PromptFragment,
} from './promptPool';
import type { VisualCanvasAnalysis, VisualCanvasItem } from './types';

function makeAnalysis(overrides: Partial<VisualCanvasAnalysis> = {}): VisualCanvasAnalysis {
  return {
    objective: '主体：一个人坐在窗边',
    aesthetic: '温柔的胶片感',
    visualStyle: ['胶片', '手持'],
    mood: ['怀旧', '温柔'],
    colorPalette: ['暖橙', '奶油黄'],
    composition: '近景',
    lighting: '自然侧光',
    promptDraft: '',
    negativePrompt: '',
    confidence: 0.85,
    ...overrides,
  };
}

function makeItem(overrides: Partial<VisualCanvasItem> = {}): VisualCanvasItem {
  return {
    id: 'item-1',
    title: '参考图',
    imageUrl: 'https://example.com/img.jpg',
    source: 'reference',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    prompt: '',
    analysis: makeAnalysis(),
    createdAt: Date.now(),
    cardId: 'card-1',
    ...overrides,
  };
}

describe('promptPool', () => {
  describe('extractFragmentsFromAnalysis', () => {
    it('从完整分析中提取所有标签的片段', () => {
      const fragments = extractFragmentsFromAnalysis(makeAnalysis(), {
        originCardId: 'card-1',
        originItemId: 'item-1',
      });

      // 风格 2 + 色彩 2 + 情绪 2 + 构图 1 + 光线 1 + 主体 1 = 9
      expect(fragments).toHaveLength(9);

      const tags = fragments.map((f) => f.tag);
      expect(tags.filter((t) => t === '风格')).toHaveLength(2);
      expect(tags.filter((t) => t === '色彩')).toHaveLength(2);
      expect(tags.filter((t) => t === '情绪')).toHaveLength(2);
      expect(tags.filter((t) => t === '构图')).toHaveLength(1);
      expect(tags.filter((t) => t === '光线')).toHaveLength(1);
      expect(tags.filter((t) => t === '主体')).toHaveLength(1);

      // 所有片段的 source 是 image
      expect(fragments.every((f) => f.source === 'image')).toBe(true);
      // 出处卡
      expect(fragments.every((f) => f.originCardId === 'card-1')).toBe(true);
      // confidence
      expect(fragments.every((f) => f.confidence === 0.85)).toBe(true);
    });

    it('空分析不产出片段', () => {
      const fragments = extractFragmentsFromAnalysis({
        objective: '',
        aesthetic: '',
        visualStyle: [],
        mood: [],
        colorPalette: [],
        composition: '',
        lighting: '',
        promptDraft: '',
        negativePrompt: '',
        confidence: 0,
      });
      expect(fragments).toHaveLength(0);
    });

    it('缺字段（部分为空）只产出有内容的片段', () => {
      const fragments = extractFragmentsFromAnalysis(
        makeAnalysis({
          visualStyle: [],
          mood: ['温柔'],
          colorPalette: [],
          composition: '',
          lighting: '',
          objective: '',
        }),
      );
      // 只有情绪 1
      expect(fragments).toHaveLength(1);
      expect(fragments[0].tag).toBe('情绪');
      expect(fragments[0].text).toBe('温柔');
    });

    it('空白字符串被过滤', () => {
      const fragments = extractFragmentsFromAnalysis(
        makeAnalysis({
          visualStyle: ['  ', '胶片', ''],
          mood: [],
          colorPalette: [],
          composition: '   ',
          lighting: '',
          objective: '',
        }),
      );
      expect(fragments).toHaveLength(1);
      expect(fragments[0].text).toBe('胶片');
    });
  });

  describe('deduplicateFragments', () => {
    it('同 tag 同 text 合并，保留第一个', () => {
      const a: PromptFragment = {
        id: 'a',
        text: '胶片',
        source: 'image',
        tag: '风格',
        originItemId: 'item-1',
      };
      const b: PromptFragment = {
        id: 'b',
        text: '胶片',
        source: 'image',
        tag: '风格',
        originItemId: 'item-2',
      };
      const c: PromptFragment = {
        id: 'c',
        text: '胶片',
        source: 'image',
        tag: '情绪', // 不同 tag，不合并
      };
      const result = deduplicateFragments([a, b, c]);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a');
      expect(result[1].tag).toBe('情绪');
    });
  });

  describe('buildPromptPool', () => {
    it('从多个 item 构建去重池', () => {
      const item1 = makeItem({ id: 'item-1', cardId: 'card-1' });
      const item2 = makeItem({
        id: 'item-2',
        cardId: 'card-2',
        analysis: makeAnalysis({ visualStyle: ['胶片', '赛博朋克'] }),
      });
      const pool = buildPromptPool([item1, item2]);

      // item1: 9 片段；item2: 也有 9 片段（其中「胶片」与 item1 重复）
      // 去重后：风格 3（胶片、手持、赛博朋克）+ 色彩 2 + 情绪 2 + 构图 1 + 光线 1 + 主体 1 = 10
      expect(pool.filter((f) => f.tag === '风格')).toHaveLength(3);
      expect(pool.length).toBeGreaterThanOrEqual(10);
    });

    it('空 items 数组返回空池', () => {
      expect(buildPromptPool([])).toHaveLength(0);
    });
  });

  describe('groupByTag', () => {
    it('按标签分组', () => {
      const pool = buildPromptPool([makeItem()]);
      const groups = groupByTag(pool);
      expect(groups['风格'].every((f) => f.tag === '风格')).toBe(true);
      expect(groups['色彩'].every((f) => f.tag === '色彩')).toBe(true);
    });
  });

  describe('extractFragmentsFromItem', () => {
    it('继承 item 的 cardId 和 id', () => {
      const item = makeItem({ id: 'vis-42', cardId: 'card-7' });
      const fragments = extractFragmentsFromItem(item);
      expect(fragments.length).toBeGreaterThan(0);
      expect(fragments.every((f) => f.originCardId === 'card-7')).toBe(true);
      expect(fragments.every((f) => f.originItemId === 'vis-42')).toBe(true);
    });
  });
});
