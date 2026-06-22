import { describe, expect, it, vi } from 'vitest';
import type { StoryShot } from './types';
import {
  applyStoryboardStyleRef,
  buildStoryboardDraftPrompt,
  generateStoryboardDraftFrames,
  pickStoryboardDraftShots,
  resolveStoryboardStyleRef,
  type StoryboardDraftGenerateInput,
  type StoryboardDraftGenerateResult,
} from './storyboardDrafts';

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
      styleRef: 'minimal editorial, product storytelling, off-white',
      intent: '证明用户能把抽象需求转成产品判断。',
      rationale: '岗位关心判断是否可信，这一镜展示可验证材料。',
    }));

    expect(prompt).toContain('SH03');
    expect(prompt).toContain('Director intent: 证明用户能把抽象需求转成产品判断。');
    expect(prompt).toContain('Why this frame works: 岗位关心判断是否可信');
    expect(prompt).toContain('Shared visual framework for the whole film: minimal editorial, product storytelling, off-white');
    expect(prompt).toContain('主体：白板上的产品流程');
  });

  it('resolves one shared storyboard style and writes it to every shot', () => {
    const styleRef = resolveStoryboardStyleRef({
      shots: [shot({ shotNo: 1 }), shot({ shotNo: 2 })],
      artRecipe: {
        style: ['premium commercial film', 'human-centered'],
        palette: ['off-white'],
        light: ['clean studio light'],
        composition: ['precise framing'],
        material: ['paper'],
        negative: [],
      },
    });

    expect(styleRef).toBe('premium commercial film, human-centered, off-white, clean studio light, precise framing, paper');
    expect(
      applyStoryboardStyleRef([
        shot({ shotNo: 1 }),
        shot({ shotNo: 2, styleRef: 'old sketch' }),
      ], styleRef).map((item) => item.styleRef),
    ).toEqual([styleRef, styleRef]);
  });

  it('starts picked draft frame generation in parallel and returns successful frames', async () => {
    const resolvers = new Map<number, (result: StoryboardDraftGenerateResult) => void>();
    const generate = vi.fn((input: StoryboardDraftGenerateInput) => new Promise<StoryboardDraftGenerateResult>((resolve) => {
      resolvers.set(input.shotNo, resolve);
    }));
    const promise = generateStoryboardDraftFrames({
      storyId: 23,
      shots: [
        shot({ shotNo: 1, beat: '开场', styleRef: 'premium commercial film' }),
        shot({ shotNo: 2, beat: '转折', styleRef: 'premium commercial film' }),
        shot({ shotNo: 3, beat: '收束', styleRef: 'premium commercial film' }),
      ],
      generate,
    });

    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls.map(([input]) => input.shotNo)).toEqual([1, 2, 3]);
    expect(generate.mock.calls.every(([input]) => input.mode === 'draft')).toBe(true);
    expect(generate.mock.calls.every(([input]) => input.styleHint === 'premium commercial film')).toBe(true);

    resolvers.get(1)?.({ status: 'ok', imageId: 101, imageUrl: '/frame-1.png', prompt: 'frame 1', mode: 'draft' });
    resolvers.get(2)?.({ status: 'error', error: 'quota' });
    resolvers.get(3)?.({ status: 'ok', imageId: 103, imageUrl: '/frame-3.png', prompt: 'frame 3', mode: 'final' });

    await expect(promise).resolves.toMatchObject({
      generatedCount: 2,
      failedCount: 1,
      images: [
        { id: 101, imageUrl: '/frame-1.png', shotNo: 1, storyId: 23, status: 'draft' },
        { id: 103, imageUrl: '/frame-3.png', shotNo: 3, storyId: 23, status: 'ready' },
      ],
    });
  });
});
