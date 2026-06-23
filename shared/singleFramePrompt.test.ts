import { describe, expect, it } from 'vitest';
import {
  allowsMultiFrameComposition,
  singleFrameNegativeTermsForPrompt,
  withSingleFramePromptConstraint,
} from './singleFramePrompt';

describe('singleFramePrompt', () => {
  it('adds the single-frame rule before existing Midjourney params', () => {
    const prompt = withSingleFramePromptConstraint('a quiet room --no dogs --relax');

    expect(prompt).toContain('Single-frame rule:');
    expect(prompt.indexOf('Single-frame rule:')).toBeLessThan(prompt.indexOf('--no dogs'));
    expect((prompt.match(/--no/g) || []).length).toBe(1);
  });

  it('treats explicit collage requests as multi-frame intent', () => {
    expect(allowsMultiFrameComposition('make this a four panel collage')).toBe(true);
    expect(allowsMultiFrameComposition('做成多个镜头的拼接')).toBe(true);
    expect(allowsMultiFrameComposition('不要 collage，不要 split screen，只要单镜头')).toBe(false);
  });

  it('keeps MJ --no additions parser-safe', () => {
    const terms = singleFrameNegativeTermsForPrompt('a quiet single frame');

    expect(terms).toContain('collage');
    expect(terms).toContain('thumbnails');
    expect(terms.every((term) => /^[a-z]+$/i.test(term))).toBe(true);
    expect(terms.join(' ')).not.toMatch(/\s-|-\s|,/);
    expect(singleFrameNegativeTermsForPrompt('make this a collage')).toEqual([]);
  });
});
