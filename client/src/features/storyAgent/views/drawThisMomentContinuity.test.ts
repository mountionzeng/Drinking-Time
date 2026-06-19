import { describe, expect, it } from 'vitest';
import {
  buildDrawCardHint,
  buildStoryboardContinuityHint,
  findStoryboardContinuityImage,
} from './drawThisMomentContinuity';

describe('drawThisMoment continuity helpers', () => {
  const cards = [
    { title: '起点', content: '他有技术和艺术双背景，正在重新定义方向。', emotion: '期待' },
    { title: 'AIGC PM', content: '他明确说出 AIGC 类 PM 岗位。', emotion: '笃定' },
    { title: '定义产品往哪走', content: '他想决定方向，而不是只把东西做出来。', emotion: '清醒' },
  ];

  it('adds whole-story continuity context instead of only the selected card', () => {
    const hint = buildDrawCardHint(cards[1], cards, 2);

    expect(hint).toContain('他明确说出 AIGC 类 PM 岗位');
    expect(hint).toContain('第 2/3 个镜头');
    expect(hint).toContain('不是一张独立海报');
    expect(hint).toContain('同一支短片里的连续镜头');
    expect(hint).toContain('故事顺序');
    expect(hint).toContain('定义产品往哪走');
  });

  it('keeps single-card stories concise', () => {
    expect(buildStoryboardContinuityHint([cards[0]], 1)).toBe('');
  });

  it('uses the nearest previous accepted story image as continuity reference', () => {
    const image = findStoryboardContinuityImage(
      [
        { id: 1, imageUrl: '/api/images/shot1.png', prompt: '', shotNo: 1, storyId: 22, status: 'ready' },
        { id: 2, imageUrl: '/api/images/shot3.png', prompt: '', shotNo: 3, storyId: 22, status: 'ready' },
        { id: 3, imageUrl: '/api/images/draft.png', prompt: '', shotNo: 4, storyId: 22, status: 'draft' },
      ],
      4,
    );

    expect(image?.imageUrl).toBe('/api/images/shot3.png');
  });

  it('falls back to nearest accepted image when there is no previous shot', () => {
    const image = findStoryboardContinuityImage(
      [
        { id: 2, imageUrl: '/api/images/shot3.png', prompt: '', shotNo: 3, storyId: 22, status: 'ready' },
      ],
      1,
    );

    expect(image?.imageUrl).toBe('/api/images/shot3.png');
  });
});
