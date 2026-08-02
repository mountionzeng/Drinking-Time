import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptOverride, PromptOverrides, PromptRow } from './types';
import {
  displayShotCode,
  type ShotDisplayLike,
} from '@shared/shotIdentity';
import {
  canonicalDimension,
  promptDimensionLabel,
} from '@shared/promptDimensions';

// 这是实际匹配用的数据键集合（camelCase，对应 PromptRow.dimension 的字面量），
// 不是展示文案——保持原样不变。是否要把它扩到 art 库产出的 visual_style 等
// canonical 维度（继承目前对那些维度失效）是一个单独的产品决策，不在这一步。
const INHERITABLE_DIMENSIONS = new Set([
  'subject',
  'styleRef',
  'genre',
  'tone',
  'composition',
  'palette',
]);

/** 标签统一从 shared/promptDimensions.ts 派生；查不到时退回原字面量。 */
function dimLabel(dimension: string, fallback: string): string {
  return promptDimensionLabel(canonicalDimension(dimension)) ?? fallback;
}

const INHERITABLE_LABELS: Record<string, string> = {
  subject: dimLabel('subject', '主体'),
  styleRef: dimLabel('styleRef', '风格参考'),
  genre: dimLabel('genre', '流派'),
  tone: dimLabel('tone', '色调'),
  composition: dimLabel('composition', '构图'),
  palette: dimLabel('palette', '配色'),
};

export function isInheritableDimension(dimension: string): boolean {
  return INHERITABLE_DIMENSIONS.has(dimension);
}

function contentLength(value: string) {
  return Array.from(value).length;
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

function inheritedRow(source: PromptRow, sourceShot: ShotDisplayLike & { shotNo: number }): PromptRow {
  return {
    ...source,
    id: `inherit:${source.dimension}`,
    source: {
      system: 'inheritance',
      label: `继承自 ${displayShotCode(sourceShot)}`,
      inheritedFromShotNo: sourceShot.shotNo,
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
  previousRowsByShot: readonly (ShotDisplayLike & {
    shotNo: number;
    rows: readonly PromptRow[];
  })[],
) {
  for (const entry of previousRowsByShot) {
    const row = entry.rows.find((candidate) => candidate.dimension === dimension && candidate.value.trim());
    if (row) return { row, shot: entry };
  }
  return null;
}

export function applyPromptInheritance(params: {
  rows: readonly PromptRow[];
  shot: CreationEditorShot;
  previousRowsByShot?: readonly (ShotDisplayLike & {
    shotNo: number;
    rows: readonly PromptRow[];
  })[];
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
        nextRows.push(inheritedRow(source.row, source.shot));
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
    if (source) nextRows.push(applyOverride(inheritedRow(source.row, source.shot), override));
  }

  for (const dimension of Array.from(INHERITABLE_DIMENSIONS)) {
    if (seenDimensions.has(dimension)) continue;
    const source = findInheritanceSource(dimension, previousRowsByShot);
    if (source) nextRows.push(inheritedRow(source.row, source.shot));
  }

  return nextRows;
}
