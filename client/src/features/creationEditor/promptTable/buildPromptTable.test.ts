import { describe, expect, it } from 'vitest';
import type { CreationEditorShot } from '../CreationEditorContext';
import { buildPromptTable } from './buildPromptTable';

function makeShot(overrides: Partial<CreationEditorShot> = {}): CreationEditorShot {
  return {
    shotNo: 1,
    shotKey: 'SH01',
    subject: '女孩',
    action: '站在厨房门边',
    dialogue: '我只是想等一下',
    shotType: '中景',
    beat: '转折',
    cameraAngle: '平视',
    cameraMove: '缓慢推进',
    location: '傍晚厨房',
    timeLight: '落日侧光',
    mood: '温柔但紧张',
    sound: '',
    styleRef: '胶片油画',
    note: '',
    emotion: '犹豫',
    sourceCardContent: '用户说她在厨房门边停了一会儿。',
    ...overrides,
  };
}

describe('buildPromptTable', () => {
  it('builds content rows with source and category from shot fields', () => {
    const rows = buildPromptTable(makeShot());
    const subject = rows.find((row) => row.dimension === 'subject');

    expect(subject).toMatchObject({
      label: '主体',
      value: '女孩',
      category: 'content',
      source: {
        system: 'chat',
        label: '聊天',
        sourceCardContent: '用户说她在厨房门边停了一会儿。',
      },
    });
  });

  it('injects the structured prompt stub as eight art rows with weights', () => {
    const rows = buildPromptTable(makeShot());
    const artRows = rows.filter((row) => row.source.system === 'art-repo');

    expect(artRows).toHaveLength(8);
    expect(artRows.map((row) => row.dimension)).toEqual([
      'genre',
      'tone',
      'emotion',
      'lighting',
      'composition',
      'material',
      'angle',
      'palette',
    ]);
    expect(artRows.find((row) => row.dimension === 'genre')?.weight).toBe(0.5);
    expect(artRows.find((row) => row.dimension === 'tone')?.weight).toBe(0.3);
    expect(artRows.find((row) => row.dimension === 'emotion')?.weight).toBe(0.15);
  });

  it('omits empty content fields without crashing', () => {
    const rows = buildPromptTable(makeShot({
      subject: '',
      action: '',
      dialogue: '',
    }));

    expect(rows.some((row) => row.dimension === 'subject')).toBe(false);
    expect(rows.some((row) => row.dimension === 'action')).toBe(false);
    expect(rows.some((row) => row.dimension === 'dialogue')).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('falls back to content rows if the structured prompt adapter fails', () => {
    const rows = buildPromptTable(makeShot(), {
      structuredPromptAdapter: () => {
        throw new Error('art repo unavailable');
      },
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.category === 'content')).toBe(true);
    expect(rows.some((row) => row.source.system === 'art-repo')).toBe(false);
  });
});
