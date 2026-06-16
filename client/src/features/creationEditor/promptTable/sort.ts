import type { PromptRow, PromptSourceSystem } from './types';

export type PromptSortMode = 'weight' | 'contentLength';
export type PromptSourceFilter = 'all' | PromptSourceSystem;
export type PromptTableColumn =
  | 'dimension'
  | 'category'
  | 'value'
  | 'weight'
  | 'source'
  | 'inheritance';

const CATEGORY_RANK: Record<PromptRow['category'], number> = {
  content: 0,
  style: 1,
};

export function sortPromptRows(
  rows: readonly PromptRow[],
  mode: PromptSortMode,
): PromptRow[] {
  return [...rows].sort((left, right) => {
    if (mode === 'contentLength') {
      const categoryDelta = CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category];
      if (categoryDelta !== 0) return categoryDelta;
      const lengthDelta = right.contentLength - left.contentLength;
      if (lengthDelta !== 0) return lengthDelta;
    }

    const weightDelta = right.weight - left.weight;
    if (weightDelta !== 0) return weightDelta;
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });
}

export function filterPromptRowsBySource(
  rows: readonly PromptRow[],
  filter: PromptSourceFilter,
): PromptRow[] {
  if (filter === 'all') return [...rows];
  return rows.filter((row) => row.source.system === filter);
}

export function sourceFilterOptions(rows: readonly PromptRow[]) {
  const counts = new Map<PromptSourceFilter, number>();
  counts.set('all', rows.length);
  for (const row of rows) {
    counts.set(row.source.system, (counts.get(row.source.system) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([source, count]) => ({ source, count }));
}

export function getPromptTableColumns(rows: readonly PromptRow[]): PromptTableColumn[] {
  const columns: PromptTableColumn[] = ['dimension', 'value', 'weight', 'source'];
  const hasMultipleCategories = new Set(rows.map((row) => row.category)).size > 1;
  if (hasMultipleCategories) columns.splice(1, 0, 'category');
  const hasInheritanceState = rows.some((row) => row.inheritance !== 'own');
  if (hasInheritanceState) columns.push('inheritance');
  return columns;
}
