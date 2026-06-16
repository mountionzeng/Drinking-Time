import { describe, expect, it } from 'vitest';
import { writePromptOverride, writeShotDuration } from './persist';

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
});
