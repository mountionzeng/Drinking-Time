import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptOverride, PromptOverrides, PromptRow } from './types';

const INHERITABLE_DIMENSIONS = new Set([
  'subject',
  'styleRef',
  'genre',
  'tone',
  'composition',
  'palette',
]);

const INHERITABLE_LABELS: Record<string, string> = {
  subject: '主体',
  styleRef: '风格参考',
  genre: '流派',
  tone: '色调',
  composition: '构图',
  palette: '配色',
};

export function isInheritableDimension(dimension: string): boolean {
  return INHERITABLE_DIMENSIONS.has(dimension);
}

function contentLength(value: string) {
  return Array.from(value).length;
}

function shotLabel(shotNo: number) {
  return `SH${String(shotNo).padStart(2, '0')}`;
}

function applyOverride(row: PromptRow, override: PromptOverride): PromptRow {
  const value = override.value?.trim() || row.value;
  const weight = typeof override.weight === 'number' && Number.isFinite(override.weight)
    ? override.weight
    : row.weight;

  return {
    ...row,
    value,
    weight,
    source: {
      system: 'manual',
      label: '手改',
      sourceCardContent: row.source.sourceCardContent,
    },
    inheritance: 'overridden',
    contentLength: contentLength(value),
  };
}

function inheritedRow(source: PromptRow, sourceShotNo: number): PromptRow {
  return {
    ...source,
    id: `inherit:${source.dimension}`,
    source: {
      system: 'inheritance',
      label: `继承自 ${shotLabel(sourceShotNo)}`,
      inheritedFromShotNo: sourceShotNo,
      sourceCardContent: source.source.sourceCardContent,
    },
    inheritance: 'inherited',
    contentLength: contentLength(source.value),
  };
}

function manualRow(
  dimension: string,
  override: PromptOverride,
  shot: CreationEditorShot,
): PromptRow | null {
  const value = override.value?.trim();
  if (!value) return null;
  return {
    id: `manual:${dimension}`,
    dimension,
    label: INHERITABLE_LABELS[dimension] ?? dimension,
    value,
    weight: typeof override.weight === 'number' && Number.isFinite(override.weight)
      ? override.weight
      : 0.25,
    source: {
      system: 'manual',
      label: '手改',
      sourceCardContent: shot.sourceCardContent || undefined,
    },
    category: dimension === 'subject' ? 'content' : 'style',
    inheritance: 'overridden',
    contentLength: contentLength(value),
  };
}

function findInheritanceSource(
  dimension: string,
  previousRowsByShot: readonly { shotNo: number; rows: readonly PromptRow[] }[],
) {
  for (const entry of previousRowsByShot) {
    const row = entry.rows.find((candidate) => candidate.dimension === dimension && candidate.value.trim());
    if (row) return { row, shotNo: entry.shotNo };
  }
  return null;
}

export function applyPromptInheritance(params: {
  rows: readonly PromptRow[];
  shot: CreationEditorShot;
  previousRowsByShot?: readonly { shotNo: number; rows: readonly PromptRow[] }[];
  overrides?: PromptOverrides;
}): PromptRow[] {
  const previousRowsByShot = params.previousRowsByShot ?? [];
  const overrides = params.overrides ?? params.shot.promptOverrides ?? {};
  const nextRows: PromptRow[] = [];
  const seenDimensions = new Set<string>();

  for (const row of params.rows) {
    const override = overrides[row.dimension];
    if (override) {
      nextRows.push(applyOverride(row, override));
      seenDimensions.add(row.dimension);
      continue;
    }

    if (isInheritableDimension(row.dimension)) {
      const source = findInheritanceSource(row.dimension, previousRowsByShot);
      if (source) {
        nextRows.push(inheritedRow(source.row, source.shotNo));
        seenDimensions.add(row.dimension);
        continue;
      }
    }

    nextRows.push(row);
    seenDimensions.add(row.dimension);
  }

  for (const dimension of Object.keys(overrides)) {
    if (seenDimensions.has(dimension)) continue;
    const override = overrides[dimension];
    const manual = manualRow(dimension, override, params.shot);
    if (manual) {
      nextRows.push(manual);
      seenDimensions.add(dimension);
      continue;
    }
    if (!isInheritableDimension(dimension)) continue;
    const source = findInheritanceSource(dimension, previousRowsByShot);
    if (source) nextRows.push(applyOverride(inheritedRow(source.row, source.shotNo), override));
  }

  for (const dimension of Array.from(INHERITABLE_DIMENSIONS)) {
    if (seenDimensions.has(dimension)) continue;
    const source = findInheritanceSource(dimension, previousRowsByShot);
    if (source) nextRows.push(inheritedRow(source.row, source.shotNo));
  }

  return nextRows;
}
