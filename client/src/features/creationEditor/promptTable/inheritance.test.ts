import { describe, expect, it } from 'vitest';
import type { CreationEditorShot } from '../CreationEditorContext';
import { buildPromptTable } from './buildPromptTable';

function shot(
  shotNo: number,
  overrides: Partial<CreationEditorShot> = {},
): CreationEditorShot {
  return {
    shotNo,
    shotKey: `SH${String(shotNo).padStart(2, '0')}`,
    subject: shotNo === 1 ? '女孩' : '',
    action: `动作 ${shotNo}`,
    dialogue: '',
    shotType: '',
    beat: '',
    cameraAngle: '',
    cameraMove: '',
    location: '',
    timeLight: '',
    mood: shotNo === 1 ? '安静' : '',
    sound: '',
    styleRef: shotNo === 1 ? '胶片油画' : '',
    note: '',
    emotion: '',
    sourceCardContent: shotNo === 1 ? '用户提到女孩站在厨房门口。' : '',
    ...overrides,
  };
}

describe('prompt table inheritance', () => {
  it('inherits person-like subject from SH01 for later shots without overrides', () => {
    const first = shot(1);
    const second = shot(2);
    const third = shot(3);

    const sh2Subject = buildPromptTable(second, { previousShots: [first] })
      .find((row) => row.dimension === 'subject');
    const sh3Subject = buildPromptTable(third, { previousShots: [first, second] })
      .find((row) => row.dimension === 'subject');

    expect(sh2Subject).toMatchObject({
      value: '女孩',
      inheritance: 'inherited',
      source: { system: 'inheritance', inheritedFromShotNo: 1 },
    });
    expect(sh3Subject).toMatchObject({
      value: '女孩',
      inheritance: 'inherited',
      source: { system: 'inheritance', inheritedFromShotNo: 1 },
    });
  });

  it('turns a single shot override into overridden state without affecting other shots', () => {
    const first = shot(1);
    const second = shot(2, {
      promptOverrides: {
        subject: { value: '女孩换成背影里的成年人' },
      },
    });
    const third = shot(3);

    const sh1Subject = buildPromptTable(first).find((row) => row.dimension === 'subject');
    const sh2Subject = buildPromptTable(second, { previousShots: [first] })
      .find((row) => row.dimension === 'subject');
    const sh3Subject = buildPromptTable(third, { previousShots: [first, second] })
      .find((row) => row.dimension === 'subject');

    expect(sh1Subject?.inheritance).toBe('own');
    expect(sh2Subject).toMatchObject({
      value: '女孩换成背影里的成年人',
      inheritance: 'overridden',
      source: { system: 'manual' },
    });
    expect(sh3Subject).toMatchObject({
      value: '女孩',
      inheritance: 'inherited',
      source: { inheritedFromShotNo: 1 },
    });
  });

  it('does not inherit per-shot emotion', () => {
    const first = shot(1, { mood: '平静' });
    const second = shot(2, { mood: '' });
    const rows = buildPromptTable(second, { previousShots: [first] });

    expect(rows.find((row) => row.dimension === 'mood')).toBeUndefined();
  });

  it('keeps first-shot inheritable dimensions as own when there is no source', () => {
    const rows = buildPromptTable(shot(1));
    const subject = rows.find((row) => row.dimension === 'subject');
    const genre = rows.find((row) => row.dimension === 'genre');

    expect(subject?.inheritance).toBe('own');
    expect(genre?.inheritance).toBe('own');
  });
});
