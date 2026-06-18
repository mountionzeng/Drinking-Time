import { describe, expect, it } from 'vitest';
import {
  filterPromptRowsBySource,
  getPromptTableColumns,
  sortPromptRows,
  sourceFilterOptions,
} from './sort';
import type { PromptRow } from './types';

function row(overrides: Partial<PromptRow>): PromptRow {
  return {
    id: overrides.id ?? 'row',
    dimension: overrides.dimension ?? 'subject',
    label: overrides.label ?? '主体',
    value: overrides.value ?? 'value',
    weight: overrides.weight ?? 0.1,
    source: overrides.source ?? { system: 'chat', label: '聊天' },
    category: overrides.category ?? 'content',
    inheritance: overrides.inheritance ?? 'own',
    contentLength: overrides.contentLength ?? Array.from(overrides.value ?? 'value').length,
  };
}

describe('prompt table sort and filters', () => {
  it('sorts rows by weight descending', () => {
    const sorted = sortPromptRows([
      row({ id: 'low', label: '低', weight: 0.1 }),
      row({ id: 'high', label: '高', weight: 0.8 }),
      row({ id: 'mid', label: '中', weight: 0.4 }),
    ], 'weight');

    expect(sorted.map((item) => item.id)).toEqual(['high', 'mid', 'low']);
  });

  it('puts content rows before style rows when sorting by content length', () => {
    const sorted = sortPromptRows([
      row({ id: 'style-long', category: 'style', value: '这是一条很长的风格描述', contentLength: 11 }),
      row({ id: 'content-short', category: 'content', value: '短', contentLength: 1 }),
      row({ id: 'content-long', category: 'content', value: '内容更长', contentLength: 4 }),
    ], 'contentLength');

    expect(sorted.map((item) => item.id)).toEqual([
      'content-long',
      'content-short',
      'style-long',
    ]);
  });

  it('filters rows by source system for upstream validation', () => {
    const rows = [
      row({ id: 'chat', source: { system: 'chat', label: '聊天' } }),
      row({ id: 'art', source: { system: 'art-repo', label: 'art库' }, category: 'style' }),
    ];

    expect(filterPromptRowsBySource(rows, 'art-repo').map((item) => item.id)).toEqual(['art']);
    expect(sourceFilterOptions(rows)).toContainEqual({ source: 'art-repo', count: 1 });
  });

  it('keeps usage visible and adds dynamic columns only when rows need them', () => {
    const ownContent = [row({ id: 'own' })];
    const mixed = [
      row({ id: 'own' }),
      row({
        id: 'inherited',
        category: 'style',
        inheritance: 'inherited',
        source: { system: 'inheritance', label: '继承', inheritedFromShotNo: 1 },
      }),
    ];

    expect(getPromptTableColumns(ownContent)).toEqual(['dimension', 'value', 'usage', 'weight', 'source']);
    expect(getPromptTableColumns(mixed)).toEqual([
      'dimension',
      'category',
      'value',
      'usage',
      'weight',
      'source',
      'inheritance',
    ]);
  });
});
