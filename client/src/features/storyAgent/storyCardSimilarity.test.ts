import { describe, expect, it } from 'vitest';

import {
  buildIdfIndex,
  getSimilarCards,
  inverseDocumentFrequency,
  tfidfCosine,
  tokenizeForSimilarity,
} from './storyCardSimilarity';
import type { StoryCard } from './types';

function card(id: string, content: string, extra: Partial<StoryCard> = {}): StoryCard {
  return {
    id,
    title: id,
    content,
    emotion: '',
    sensoryDetails: [],
    createdAt: 0,
    ...extra,
  };
}

describe('inverseDocumentFrequency', () => {
  it('越稀有权重越高', () => {
    const rare = inverseDocumentFrequency(100, 1);
    const common = inverseDocumentFrequency(100, 100);
    expect(rare).toBeGreaterThan(common);
  });

  it('处处都有的词权重恒为正，不会把向量模长算没', () => {
    expect(inverseDocumentFrequency(50, 50)).toBeGreaterThan(0);
  });
});

describe('buildIdfIndex', () => {
  it('虚词（每篇都有）的权重低于只出现一次的实词', () => {
    const documents = [
      new Set(['今天', '葬礼']),
      new Set(['今天', '早饭']),
      new Set(['今天', '通勤']),
    ];
    const idf = buildIdfIndex(documents);
    expect(idf.get('葬礼')!).toBeGreaterThan(idf.get('今天')!);
  });
});

describe('tfidfCosine', () => {
  it('毫无重叠时为 0', () => {
    const idf = buildIdfIndex([new Set(['a']), new Set(['b'])]);
    expect(tfidfCosine(new Set(['a']), new Set(['b']), idf, 2)).toBe(0);
  });

  it('完全相同的两段文本相似度为 1', () => {
    const tokens = new Set(['葬礼', '母亲']);
    const idf = buildIdfIndex([tokens, new Set(['早饭'])]);
    expect(tfidfCosine(tokens, tokens, idf, 2)).toBeCloseTo(1, 10);
  });

  it('未登录词也参与打分，不被当作零权重丢掉', () => {
    const idf = buildIdfIndex([new Set(['早饭'])]);
    const score = tfidfCosine(new Set(['稀有词']), new Set(['稀有词']), idf, 1);
    expect(score).toBeGreaterThan(0);
  });
});

describe('getSimilarCards', () => {
  it('实词命中排在虚词命中前面（IDF 的核心作用）', () => {
    // 「有点」「今天」「觉得」出现在每一张卡里 → IDF 压到很低；
    // 「葬礼」只在一张卡里 → IDF 很高。
    const cards = [
      card('filler-1', '今天有点累 我觉得有点困 今天真的有点长 我觉得'),
      card('filler-2', '今天有点忙 我觉得有点烦 今天有点吵 我觉得'),
      card('funeral', '今天我去了外婆的葬礼 我觉得有点空'),
    ];
    const result = getSimilarCards('今天我觉得有点想起葬礼那天', cards);
    expect(result[0].content).toContain('葬礼');
  });

  it('最多返回 3 张，按分数降序', () => {
    const cards = Array.from({ length: 6 }, (_, index) =>
      card(`c${index}`, `雨夜 便利店 关东煮 第${index}次`),
    );
    const result = getSimilarCards('雨夜的便利店', cards);
    expect(result).toHaveLength(3);
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    expect(result[1].score).toBeGreaterThanOrEqual(result[2].score);
  });

  it('完全不相关时返回空，不硬凑 3 张', () => {
    expect(getSimilarCards('量子色动力学', [card('a', '雨夜便利店')])).toEqual([]);
  });

  it('空 query 返回空', () => {
    expect(getSimilarCards('   ', [card('a', '雨夜便利店')])).toEqual([]);
  });

  it('卡池为空时不炸', () => {
    expect(getSimilarCards('雨夜', [])).toEqual([]);
  });

  it('检索用到 retrievalQuery 等专门字段，不只看正文', () => {
    const cards = [
      card('a', '无关内容'),
      card('b', '无关内容', { retrievalQuery: '高中转学时的孤独感' }),
    ];
    const result = getSimilarCards('转学的孤独', cards);
    expect(result[0].retrievalQuery).toBe('高中转学时的孤独感');
  });

  it('长卡片不因为词多而天然占便宜', () => {
    const short = card('short', '雨夜便利店');
    const long = card('long', `雨夜便利店 ${'无关词汇 '.repeat(80)}`);
    const result = getSimilarCards('雨夜便利店', [long, short]);
    expect(result[0].content).toBe(short.content);
  });
});

describe('tokenizeForSimilarity', () => {
  it('中文切 bigram，英文数字按词切', () => {
    const tokens = tokenizeForSimilarity('雨夜 cafe 2024');
    expect(tokens.has('cafe')).toBe(true);
    expect(tokens.has('2024')).toBe(true);
    expect(tokens.has('雨夜')).toBe(true);
  });
});
