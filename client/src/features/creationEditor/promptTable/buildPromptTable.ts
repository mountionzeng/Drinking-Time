import type { CreationEditorShot } from '../CreationEditorContext';
import {
  getStructuredPromptStub,
  type StructuredPromptAdapter,
} from './structuredPromptAdapter';
import { applyPromptInheritance } from './inheritance';
import type { PromptCategory, PromptRow, PromptSource } from './types';

type ContentDimension = {
  key: keyof CreationEditorShot;
  dimension: string;
  label: string;
  weight: number;
  source: PromptSource['system'];
};

const CONTENT_DIMENSIONS: ContentDimension[] = [
  { key: 'subject', dimension: 'subject', label: '主体', weight: 0.42, source: 'chat' },
  { key: 'action', dimension: 'action', label: '动作', weight: 0.38, source: 'chat' },
  { key: 'dialogue', dimension: 'dialogue', label: '台词', weight: 0.34, source: 'chat' },
  { key: 'location', dimension: 'location', label: '场景', weight: 0.32, source: 'intent' },
  { key: 'shotType', dimension: 'shotType', label: '景别', weight: 0.28, source: 'intent' },
  { key: 'cameraAngle', dimension: 'cameraAngle', label: '机位', weight: 0.24, source: 'intent' },
  { key: 'cameraMove', dimension: 'cameraMove', label: '运镜', weight: 0.22, source: 'intent' },
  { key: 'timeLight', dimension: 'timeLight', label: '时间光', weight: 0.24, source: 'intent' },
  { key: 'mood', dimension: 'mood', label: '情绪', weight: 0.3, source: 'intent' },
  { key: 'styleRef', dimension: 'styleRef', label: '风格参考', weight: 0.26, source: 'intent' },
];

const SOURCE_LABELS: Record<PromptSource['system'], string> = {
  chat: '聊天',
  intent: '意图',
  'art-repo': 'art库',
  inheritance: '继承',
  manual: '手改',
};

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function contentLength(value: string) {
  return Array.from(value).length;
}

function sourceFor(
  system: PromptSource['system'],
  shot: CreationEditorShot,
): PromptSource {
  return {
    system,
    label: SOURCE_LABELS[system],
    sourceCardContent: shot.sourceCardContent || undefined,
  };
}

function row(
  params: {
    id: string;
    dimension: string;
    label: string;
    value: string;
    weight: number;
    source: PromptSource;
    category: PromptCategory;
  },
): PromptRow {
  return {
    ...params,
    inheritance: 'own',
    contentLength: contentLength(params.value),
  };
}

export function buildContentPromptRows(shot: CreationEditorShot): PromptRow[] {
  return CONTENT_DIMENSIONS.flatMap((dimension) => {
    const value = clean(shot[dimension.key]);
    if (!value) return [];
    return row({
      id: `content:${dimension.dimension}`,
      dimension: dimension.dimension,
      label: dimension.label,
      value,
      weight: dimension.weight,
      source: sourceFor(dimension.source, shot),
      category: 'content',
    });
  });
}

export function buildArtPromptRows(
  shot: CreationEditorShot,
  adapter: StructuredPromptAdapter = getStructuredPromptStub,
): PromptRow[] {
  const result = adapter(shot);
  return result.dimensions.flatMap((dimension) => {
    const value = clean(dimension.value);
    if (!value) return [];
    return row({
      id: `art:${dimension.dimension}`,
      dimension: dimension.dimension,
      label: dimension.label,
      value,
      weight: dimension.weight,
      source: sourceFor('art-repo', shot),
      category: 'style',
    });
  });
}

export function buildPromptTable(
  shot: CreationEditorShot,
  options: {
    structuredPromptAdapter?: StructuredPromptAdapter;
    previousShots?: readonly CreationEditorShot[];
  } = {},
): PromptRow[] {
  const contentRows = buildContentPromptRows(shot);
  let baseRows = contentRows;
  try {
    baseRows = [
      ...contentRows,
      ...buildArtPromptRows(shot, options.structuredPromptAdapter),
    ];
  } catch {
    baseRows = contentRows;
  }

  const previousRowsByShot = (options.previousShots ?? []).map((previousShot) => {
    const previousContentRows = buildContentPromptRows(previousShot);
    let previousRows = previousContentRows;
    try {
      previousRows = [
        ...previousContentRows,
        ...buildArtPromptRows(previousShot, options.structuredPromptAdapter),
      ];
    } catch {
      previousRows = previousContentRows;
    }
    return {
      shotNo: previousShot.shotNo,
      rows: previousRows,
    };
  });

  return applyPromptInheritance({
    rows: baseRows,
    shot,
    previousRowsByShot,
  });
}
