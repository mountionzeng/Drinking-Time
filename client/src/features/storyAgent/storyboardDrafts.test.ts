import { describe, expect, it } from 'vitest';
import type { StoryShot } from './types';
import { buildStoryboardDraftPrompt, pickStoryboardDraftShots } from './storyboardDrafts';

function shot(overrides: Partial<StoryShot>): StoryShot {
  return {
    shotNo: 1,
    subject: '候选人',
    action: '整理作品集',
    dialogue: '',
    shotType: '中',
    beat: '起势',
    cameraAngle: '',
    cameraMove: '',
    location: '工作桌',
    timeLight: '',
    mood: '可信',
    sound: '',
    styleRef: '',
    note: '',
    emotion: '可信',
    sourceCardContent: '他能把抽象需求变成可验证方案。',
    ...overrides,
  };
}

describe('storyboard draft helpers', () => {
  it('picks key story beats before filling sequential shots', () => {
    const picked = pickStoryboardDraftShots([
      shot({ shotNo: 1, beat: '开场' }),
      shot({ shotNo: 2, beat: '起势' }),
      shot({ shotNo: 3, beat: '转折' }),
      shot({ shotNo: 4, beat: '起势' }),
      shot({ shotNo: 5, beat: '收束' }),
    ]);

    expect(picked.map((item) => item.shotNo)).toEqual([1, 3, 5]);
  });

  it('builds frame prompts from the same shot intent, rationale and prompt draft', () => {
    const prompt = buildStoryboardDraftPrompt(shot({
      shotNo: 3,
      promptDraft: '主体：白板上的产品流程；情绪电荷：清晰',
      intent: '证明用户能把抽象需求转成产品判断。',
      rationale: '岗位关心判断是否可信，这一镜展示可验证材料。',
    }));

    expect(prompt).toContain('SH03');
    expect(prompt).toContain('Director intent: 证明用户能把抽象需求转成产品判断。');
    expect(prompt).toContain('Why this frame works: 岗位关心判断是否可信');
    expect(prompt).toContain('主体：白板上的产品流程');
  });
});
