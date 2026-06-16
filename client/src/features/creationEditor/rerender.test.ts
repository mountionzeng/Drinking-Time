import { describe, expect, it, vi } from 'vitest';
import type { CreationEditorShot } from './CreationEditorContext';
import { buildRerenderPrompt, rerenderShotImage } from './rerender';
import type { PromptRow } from './promptTable/types';

const shot: CreationEditorShot = {
  shotNo: 2,
  shotKey: 'SH02',
  subject: '女孩',
  action: '',
  dialogue: '等一等',
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
  sourceCardContent: '她在门边停住。',
};

function row(overrides: Partial<PromptRow>): PromptRow {
  return {
    id: overrides.id ?? 'row',
    dimension: overrides.dimension ?? 'genre',
    label: overrides.label ?? '流派',
    value: overrides.value ?? '油画',
    weight: overrides.weight ?? 0.5,
    source: overrides.source ?? { system: 'art-repo', label: 'art库' },
    category: overrides.category ?? 'style',
    inheritance: overrides.inheritance ?? 'own',
    contentLength: overrides.contentLength ?? 2,
  };
}

describe('creation editor rerender', () => {
  it('includes edited weights in the generated prompt', () => {
    const prompt = buildRerenderPrompt({
      shot,
      rows: [
        row({ label: '流派', value: '胶片油画', weight: 0.9 }),
        row({ label: '主体', value: '女孩', weight: 0.4 }),
      ],
    });

    expect(prompt).toContain('流派(90%): 胶片油画');
    expect(prompt).toContain('主体(40%): 女孩');
  });

  it('calls generateForMobile once for the current shot only', async () => {
    const generate = vi.fn(async () => ({
      status: 'ok' as const,
      imageUrl: '/api/images/new.png',
      imageId: 12,
    }));

    await rerenderShotImage({
      storyId: 7,
      shot,
      rows: [row({ value: '水彩', weight: 0.8 })],
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      storyId: 7,
      shotNo: 2,
    }));
    expect(generate.mock.calls[0][0].prompt).toContain('水彩');
  });

  it('surfaces generation errors without returning a new image', async () => {
    await expect(rerenderShotImage({
      storyId: 7,
      shot,
      rows: [row({})],
      generate: async () => ({ status: 'error', error: 'service down' }),
    })).rejects.toThrow('service down');
  });
});
