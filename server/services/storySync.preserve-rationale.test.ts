import { describe, expect, it } from 'vitest';

import { getStoryRevision, prepareStoryBody } from './storySync';

describe('storySync shot field preservation', () => {
  it('keeps the existing body cleanup and revision behavior', () => {
    const body = prepareStoryBody(
      {
        cards: [],
        characters: [],
        shots: [],
        mobileImages: [{ id: 1 }],
        images: [{ id: 2 }],
      },
      7,
    );

    expect(body).toMatchObject({
      cards: [],
      characters: [],
      shots: [],
      _revision: 7,
    });
    expect(body).not.toHaveProperty('mobileImages');
    expect(body).not.toHaveProperty('images');
    expect(getStoryRevision(body)).toBe(7);
  });

  it('preserves server shot intent and rationale when an older client omits them', () => {
    const serverBody = {
      shots: [
        {
          shotNo: 1,
          subject: '桌面镜头',
          action: '讲述项目',
          intent: 'prove judgement',
          rationale: 'This shot proves the candidate can turn ambiguity into decisions.',
        },
      ],
    };

    const incomingBody = {
      shots: [
        {
          shotNo: 1,
          subject: '手机镜头',
          action: '讲述项目更新',
        },
      ],
    };

    const body = prepareStoryBody(incomingBody, 4, serverBody);

    expect((body.shots as Array<Record<string, unknown>>)[0]).toMatchObject({
      shotNo: 1,
      subject: '手机镜头',
      action: '讲述项目更新',
      intent: 'prove judgement',
      rationale: 'This shot proves the candidate can turn ambiguity into decisions.',
    });
  });

  it('keeps existing shots when a mobile-shaped body sends an empty shots array', () => {
    const serverBody = {
      shots: [
        {
          shotNo: 2,
          subject: '桌面镜头',
          action: '展示成果',
          intent: 'show impact',
          rationale: 'The image should make the business outcome visible.',
        },
      ],
    };

    const mobileBody = {
      cards: [],
      characters: [],
      shots: [],
      messages: [{ id: 'm1', role: 'user', content: '继续聊', timestamp: 1 }],
      mobileImages: [],
    };

    const body = prepareStoryBody(mobileBody, 5, serverBody);

    expect(body.cards).toEqual([]);
    expect(body.messages).toEqual(mobileBody.messages);
    expect(body).not.toHaveProperty('mobileImages');
    expect(body.shots).toEqual(serverBody.shots);
  });

  it('drops empty promptDraft fields while preserving real prompt text', () => {
    const body = prepareStoryBody(
      {
        shots: [
          { shotNo: 1, subject: '第一镜', action: '等待', promptDraft: '' },
          { shotNo: 2, subject: '第二镜', action: '行动', promptDraft: '真实出图提示词' },
        ],
      },
      6,
    );

    const shots = body.shots as Array<Record<string, unknown>>;
    expect(shots[0]).not.toHaveProperty('promptDraft');
    expect(shots[1]).toMatchObject({ promptDraft: '真实出图提示词' });
  });

  it('preserves prompt-table edits when the incoming canonical shot content is unchanged', () => {
    const serverBody = {
      shots: [
        {
          shotNo: 1,
          subject: '桌面镜头',
          action: '讲述项目',
          dialogue: '这就是我做判断的方式',
          cameraMove: 'slow push in',
          promptOverrides: {
            subject: { value: '候选人正在整理作品集', weight: 0.9 },
          },
          promptRun: {
            finalPrompt: 'real prompt used for this exact shot',
            generatedAt: 123,
            imageId: 99,
            source: 'prompt-table-rerender',
            usedDimensions: ['subject'],
          },
          promptDraft: 'real prompt used for this exact shot',
          durationMs: 4200,
        },
      ],
    };

    const incomingBody = {
      shots: [
        {
          shotNo: 1,
          subject: '桌面镜头',
          action: '讲述项目',
          dialogue: '这就是我做判断的方式',
          cameraMove: 'slow push in',
        },
      ],
    };

    const body = prepareStoryBody(incomingBody, 8, serverBody);
    const shot = (body.shots as Array<Record<string, unknown>>)[0];

    expect(shot.promptOverrides).toEqual({
      subject: { value: '候选人正在整理作品集', weight: 0.9 },
    });
    expect(shot.promptRun).toMatchObject({
      finalPrompt: 'real prompt used for this exact shot',
      imageId: 99,
    });
    expect(shot.promptDraft).toBe('real prompt used for this exact shot');
    expect(shot.durationMs).toBe(4200);
  });

  it('does not preserve stale prompt runs when the incoming shot content changed', () => {
    const serverBody = {
      shots: [
        {
          shotNo: 1,
          subject: '旧主体',
          action: '旧动作',
          promptOverrides: {
            subject: { value: '旧出图主体', weight: 0.9 },
          },
          promptRun: {
            finalPrompt: 'old prompt',
            generatedAt: 123,
            imageId: 99,
            source: 'prompt-table-rerender',
            usedDimensions: ['subject'],
          },
          promptDraft: 'old prompt',
          durationMs: 4200,
        },
      ],
    };

    const body = prepareStoryBody(
      {
        shots: [{ shotNo: 1, subject: '新主体', action: '新动作' }],
      },
      9,
      serverBody,
    );
    const shot = (body.shots as Array<Record<string, unknown>>)[0];

    expect(shot).toMatchObject({
      shotNo: 1,
      subject: '新主体',
      action: '新动作',
      durationMs: 4200,
    });
    expect(shot).not.toHaveProperty('promptOverrides');
    expect(shot).not.toHaveProperty('promptRun');
    expect(shot).not.toHaveProperty('promptDraft');
  });
});
