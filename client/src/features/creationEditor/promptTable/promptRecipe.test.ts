import { describe, expect, it } from 'vitest';
import type { CreationEditorShot } from '../CreationEditorContext';
import { compilePromptRecipe, promptRunUsesDimension } from './promptRecipe';
import type { PromptRow } from './types';

const shot: CreationEditorShot = {
  shotNo: 1,
  shotKey: 'SH01',
  subject: '主角',
  action: '',
  dialogue: '我要开始了',
  shotType: '',
  beat: '',
  cameraAngle: '',
  cameraMove: '',
  location: '',
  timeLight: '',
  mood: '',
  sound: '',
  styleRef: '',
  note: '',
  emotion: '',
  sourceCardContent: '他站在门口。',
};

function row(overrides: Partial<PromptRow>): PromptRow {
  return {
    id: overrides.id ?? 'row',
    dimension: overrides.dimension ?? 'subject',
    label: overrides.label ?? '主体',
    value: overrides.value ?? '门口的主角',
    weight: overrides.weight ?? 0.5,
    source: overrides.source ?? { system: 'chat', label: '聊天' },
    category: overrides.category ?? 'content',
    inheritance: overrides.inheritance ?? 'own',
    contentLength: overrides.contentLength ?? 5,
  };
}

describe('promptRecipe', () => {
  it('compiles weighted rows into the final generation prompt', () => {
    const recipe = compilePromptRecipe({
      shot: {
        ...shot,
        styleRef: 'premium commercial film, off-white',
      },
      rows: [
        row({ dimension: 'tone', label: '色调', value: '暖色', weight: 0.3 }),
        row({ dimension: 'subject', label: '主体', value: '门口的人', weight: 0.8 }),
      ],
      continuityHint: 'same short film',
    });

    expect(recipe.finalPrompt).toContain('Create exactly one cinematic key frame for SH01');
    expect(recipe.finalPrompt).toContain('single continuous shot frame, not a storyboard sheet');
    expect(recipe.finalPrompt).toContain('Source Story Card: 他站在门口。');
    expect(recipe.finalPrompt).toContain('Shared visual framework for the whole film: premium commercial film, off-white');
    expect(recipe.finalPrompt).toContain('Single-frame rule: compose one uninterrupted cinematic camera frame only');
    expect(recipe.finalPrompt).toContain('no collage, no contact sheet, no inset thumbnails');
    expect(recipe.finalPrompt).toContain('No captions, no readable text, no UI, no watermark');
    expect(recipe.finalPrompt).toContain('Dialogue meaning to express through acting and composition only, do not render as text');
    expect(recipe.finalPrompt).toContain('Continuity: same short film');
    expect(recipe.finalPrompt).toContain('主体(80%): 门口的人');
    expect(recipe.finalPrompt).toContain('色调(30%): 暖色');
    expect(recipe.usedDimensions).toEqual(['subject', 'tone']);
  });

  it('reports whether a previous prompt run used a dimension', () => {
    expect(promptRunUsesDimension({
      finalPrompt: 'x',
      generatedAt: 1,
      source: 'draw-this-moment',
      usedDimensions: ['subject'],
    }, 'subject')).toBe(true);
    expect(promptRunUsesDimension(undefined, 'subject')).toBe(false);
  });

  it('includes director narrative rows in the final generation prompt', () => {
    const recipe = compilePromptRecipe({
      shot,
      rows: [
        row({
          dimension: 'narrativeClaim',
          label: '本镜主张',
          value: '让招聘者看懂这段经历如何证明跨学科创新力。',
          weight: 0.48,
          source: { system: 'director', label: '导演' },
          category: 'narrative',
        }),
      ],
    });

    expect(recipe.finalPrompt).toContain('本镜主张(48%): 让招聘者看懂这段经历如何证明跨学科创新力。');
    expect(recipe.usedDimensions).toEqual(['narrativeClaim']);
  });
});
