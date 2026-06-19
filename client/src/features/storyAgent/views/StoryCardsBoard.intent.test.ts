import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('StoryCardsBoard intent entry', () => {
  it('does not keep the old StoryIntentGate entry point on the cards board', () => {
    const boardSource = readFileSync(
      resolve(root, 'client/src/features/storyAgent/views/StoryCardsBoard.tsx'),
      'utf8',
    );

    expect(boardSource).not.toContain('StoryIntentGate');
    expect(boardSource).not.toContain('generateScript(confirmedIntent');
    expect(
      existsSync(resolve(root, 'client/src/features/storyAgent/views/StoryIntentGate.tsx')),
    ).toBe(false);
  });

  it('exposes an integrated storyboard review board outside the list-only card body', () => {
    const boardSource = readFileSync(
      resolve(root, 'client/src/features/storyAgent/views/StoryCardsBoard.tsx'),
      'utf8',
    );

    expect(boardSource).toContain('故事版看板');
    expect(boardSource).toContain('StoryboardReviewBoard');
    expect(boardSource).toContain('叙事风格');
    expect(boardSource).toContain('美术风格');
    expect(boardSource).toContain('导演理由');
    expect(boardSource).toContain('latestStoryboardFrames');
  });

  it('keeps the server recognizeIntent route for the background direct-speech entry', () => {
    const routerSource = readFileSync(resolve(root, 'server/routers.ts'), 'utf8');

    expect(routerSource).toContain('recognizeIntent: protectedProcedure');
    expect(routerSource).toContain('recognizeStoryIntent');
  });
});
