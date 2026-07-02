import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StoryCard } from '@/features/storyAgent/types';

vi.stubGlobal('React', React);

const fictionCard = {
  id: 'card-fiction-1',
  title: '月亮掉进菜市场',
  content: '月亮掉进菜市场，所有摊位都被银色潮水照亮。',
  rawText: '我想写一个月亮掉进菜市场的故事',
  sourceQuote: '月亮掉进菜市场',
  emotion: '好奇',
  emotionOptions: ['好奇', '荒诞', '温柔', '惊讶', '余味'],
  intensity: 0.7,
  direction: '世界规则',
  complexity: '混合',
  trigger: '月亮掉进菜市场',
  dramaticFunction: '故事核心',
  personalTrace: '月亮与菜市场',
  retrievalQuery: '月亮掉进菜市场的虚构故事',
  themeHints: ['故事核心', '世界规则', '关键场景'],
  outlierSignal: '',
  softMembership: ['虚构故事'],
  createdAt: 1,
} as StoryCard;

describe('StoryCardsGraph', () => {
  it('uses the fiction story-world columns instead of the job causal chain', async () => {
    const { default: StoryCardsGraph } = await import('./StoryCardsGraph');

    const html = renderToStaticMarkup(
      <StoryCardsGraph cards={[fictionCard]} storyShots={[]} mode="fiction" />,
    );

    expect(html).toContain('Story World');
    expect(html).toContain('故事核心');
    expect(html).toContain('主角/视点');
    expect(html).toContain('欲望与阻碍');
    expect(html).toContain('世界规则');
    expect(html).not.toContain('岗位关心什么');
    expect(html).not.toContain('你有什么能力');
  });
});
