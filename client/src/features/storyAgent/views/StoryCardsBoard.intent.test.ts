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

  it('keeps the server recognizeIntent route for the background direct-speech entry', () => {
    const routerSource = readFileSync(resolve(root, 'server/routers.ts'), 'utf8');

    expect(routerSource).toContain('recognizeIntent: protectedProcedure');
    expect(routerSource).toContain('recognizeStoryIntent');
  });
});
