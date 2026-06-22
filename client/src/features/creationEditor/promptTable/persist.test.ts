import { describe, expect, it } from 'vitest';
import { writePromptOverride, writePromptRun, writePromptShot, writeShotDuration } from './persist';

describe('creation editor prompt persistence', () => {
  it('writes duration into the target shot without changing sibling shots', () => {
    const body = {
      cards: [],
      shots: [
        { shotNo: 1, subject: 'A' },
        { shotNo: 2, subject: 'B' },
      ],
    };

    const next = writeShotDuration(body, 2, 4200);

    expect((next.shots as any[])[1]).toMatchObject({ shotNo: 2, durationMs: 4200 });
    expect((next.shots as any[])[0]).toEqual({ shotNo: 1, subject: 'A' });
  });

  it('adds promptOverrides to old shots that do not have editor fields yet', () => {
    const next = writePromptOverride(
      { shots: [{ shotNo: 'SH01', subject: '旧故事' }] },
      1,
      'genre',
      { value: '水彩', weight: 0.9 },
    );

    expect((next.shots as any[])[0].promptOverrides).toEqual({
      genre: { value: '水彩', weight: 0.9 },
    });
  });

  it('creates a minimal shot entry when the story body has no shots array', () => {
    const next = writeShotDuration({ cards: [] }, 3, 2600);

    expect(next.shots).toEqual([{ shotNo: 3, durationMs: 2600 }]);
  });

  it('creates a prompt-table shot without overwriting an existing shot', () => {
    const next = writePromptShot(
      { shots: [{ shotNo: 1, subject: '已有主体' }] },
      1,
      { subject: '新主体', styleRef: '油画' },
    );

    expect((next.shots as any[])[0]).toMatchObject({
      shotNo: 1,
      subject: '已有主体',
      styleRef: '油画',
    });
  });

  it('updates narrative jobs on existing prompt-table shots', () => {
    const next = writePromptShot(
      {
        shots: [{
          shotNo: 1,
          subject: '已有主体',
          styleRef: '',
          narrativeJob: { claim: '旧主张', visualTranslation: '旧转译' },
        }],
      },
      1,
      {
        subject: '新主体',
        styleRef: '油画',
        narrativeJob: {
          intentSummary: '用途：求职',
          audience: '招聘者',
          claim: '新主张',
          evidence: '项目和数字',
          visualTranslation: '新转译',
          avoidMisread: '避免普通背影',
        },
      },
    );

    expect((next.shots as any[])[0]).toMatchObject({
      shotNo: 1,
      subject: '已有主体',
      styleRef: '油画',
      narrativeJob: {
        claim: '新主张',
        visualTranslation: '新转译',
      },
    });
  });

  it('records the final prompt run on the target shot without overwriting the source draft', () => {
    const next = writePromptRun(
      { shots: [{ shotNo: 2, subject: 'B', promptDraft: 'source draft' }] },
      2,
      {
        finalPrompt: 'final prompt',
        generatedAt: 123,
        imageId: 99,
        source: 'draw-this-moment',
        usedDimensions: ['subject', 'styleRef'],
      },
    );

    expect((next.shots as any[])[0]).toMatchObject({
      promptDraft: 'source draft',
      promptRun: {
        finalPrompt: 'final prompt',
        imageId: 99,
        usedDimensions: ['subject', 'styleRef'],
      },
    });
  });
});
