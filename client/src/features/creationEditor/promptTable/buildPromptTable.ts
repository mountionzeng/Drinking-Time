import type { CreationEditorShot } from '../types';
import {
  getStructuredPromptStub,
  type StructuredPromptAdapter,
} from './structuredPromptAdapter';
import { applyPromptInheritance } from './inheritance';
import type { PromptCategory, PromptRow, PromptSource } from './types';
import {
  canonicalDimension,
  promptDimensionLabel,
} from '@shared/promptDimensions';

type ContentDimension = {
  key: keyof CreationEditorShot;
  dimension: string;
  label: string;
  weight: number;
  source: PromptSource['system'];
};

/**
 * 标签统一从 shared/promptDimensions.ts 派生，避免同一个维度在这里和别处
 * 各写一份中文标签、改一处漏一处。查不到时退回原字面量（历史值，容错）——
 * `dimension` 与 `weight` 保持字面量不变：它们是持久化数据键和当前生效权重，
 * 改名/改值属于另一个需要单独评审的步骤。
 */
function dimLabel(dimension: string, fallback: string): string {
  return promptDimensionLabel(canonicalDimension(dimension)) ?? fallback;
}

const CONTENT_DIMENSIONS: ContentDimension[] = [
  { key: 'sceneTitle', dimension: 'sceneTitle', label: dimLabel('sceneTitle', '场次'), weight: 0.34, source: 'intent' },
  { key: 'sceneArtBrief', dimension: 'sceneArtBrief', label: dimLabel('sceneArtBrief', '场景美术库'), weight: 0.4, source: 'art-repo' },
  { key: 'subject', dimension: 'subject', label: dimLabel('subject', '主体'), weight: 0.42, source: 'chat' },
  { key: 'action', dimension: 'action', label: dimLabel('action', '动作'), weight: 0.38, source: 'chat' },
  { key: 'dialogue', dimension: 'dialogue', label: dimLabel('dialogue', '字幕/旁白'), weight: 0.34, source: 'chat' },
  { key: 'location', dimension: 'location', label: dimLabel('location', '场景'), weight: 0.32, source: 'intent' },
  { key: 'shotType', dimension: 'shotType', label: dimLabel('shotType', '景别'), weight: 0.28, source: 'intent' },
  { key: 'cameraAngle', dimension: 'cameraAngle', label: dimLabel('cameraAngle', '机位'), weight: 0.24, source: 'intent' },
  { key: 'timeLight', dimension: 'timeLight', label: dimLabel('timeLight', '时间光'), weight: 0.24, source: 'intent' },
  { key: 'mood', dimension: 'mood', label: dimLabel('mood', '情绪'), weight: 0.3, source: 'intent' },
  { key: 'styleRef', dimension: 'styleRef', label: dimLabel('styleRef', '风格参考'), weight: 0.26, source: 'intent' },
];

const VIDEO_DIMENSIONS: ContentDimension[] = [
  { key: 'cameraMove', dimension: 'cameraMove', label: dimLabel('cameraMove', '相机运动'), weight: 0.36, source: 'director' },
  { key: 'videoStart', dimension: 'videoStart', label: dimLabel('videoStart', '起始画面'), weight: 0.35, source: 'director' },
  { key: 'videoEnd', dimension: 'videoEnd', label: dimLabel('videoEnd', '结束状态'), weight: 0.34, source: 'director' },
  { key: 'transitionIn', dimension: 'transitionIn', label: dimLabel('transitionIn', '接前镜'), weight: 0.3, source: 'director' },
  { key: 'transitionOut', dimension: 'transitionOut', label: dimLabel('transitionOut', '接后镜'), weight: 0.3, source: 'director' },
  { key: 'sound', dimension: 'sound', label: dimLabel('sound', '背景音/字幕气口'), weight: 0.32, source: 'director' },
  { key: 'videoPrompt', dimension: 'videoPrompt', label: dimLabel('videoPrompt', '图生视频提示词'), weight: 0.5, source: 'director' },
];

const SOURCE_LABELS: Record<PromptSource['system'], string> = {
  chat: '聊天',
  intent: '意图',
  director: '导演',
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

export function buildVideoPromptRows(shot: CreationEditorShot): PromptRow[] {
  return VIDEO_DIMENSIONS.map((dimension) => {
    const value = clean(shot[dimension.key]);
    return row({
      id: `video:${dimension.dimension}`,
      dimension: dimension.dimension,
      label: dimension.label,
      value,
      weight: dimension.weight,
      source: sourceFor(dimension.source, shot),
      category: 'motion',
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

export function buildNarrativePromptRows(shot: CreationEditorShot): PromptRow[] {
  const job = shot.narrativeJob;
  const intent = clean(shot.intent ?? '');
  const rationale = clean(shot.rationale ?? '');
  if (!job && !intent && !rationale) return [];
  const dimensions = job
    ? [
        { dimension: 'narrativeClaim', label: dimLabel('narrativeClaim', '优势主张'), value: job.claim, weight: 0.54 },
        { dimension: 'roleConcern', label: dimLabel('roleConcern', '岗位关心什么'), value: job.roleConcern, weight: 0.5 },
        { dimension: 'visualTranslation', label: dimLabel('visualTranslation', '导演画面策略'), value: job.visualTranslation, weight: 0.48 },
        { dimension: 'causalExplanation', label: dimLabel('causalExplanation', '因果解释'), value: job.causalExplanation, weight: 0.46 },
        { dimension: 'narrativeEvidence', label: dimLabel('narrativeEvidence', '可信证据'), value: job.evidence, weight: 0.44 },
        { dimension: 'externalValue', label: dimLabel('externalValue', '外部价值'), value: job.externalValue, weight: 0.42 },
        { dimension: 'storyContext', label: dimLabel('storyContext', '上下文位置'), value: job.storyContext, weight: 0.36 },
        { dimension: 'avoidMisread', label: dimLabel('avoidMisread', '避免误读'), value: job.avoidMisread, weight: 0.3 },
        { dimension: 'recommendationStatus', label: dimLabel('recommendationStatus', '建议状态'), value: job.recommendationStatus, weight: 0.26 },
        { dimension: 'intentSummary', label: dimLabel('intentSummary', '意图摘要'), value: job.intentSummary, weight: 0.22 },
      ]
    : [
        // narrativeClaim / causalExplanation 在这个分支下故意使用与求职分支不同的
        // 文案（"镜头意图"/"导演解释" vs "优势主张"/"因果解释"）——同一维度、
        // 不同语境的展示文案，不是重复声明，不能用 dimLabel 的 canonical 文案覆盖。
        { dimension: 'narrativeClaim', label: '镜头意图', value: intent, weight: 0.5 },
        { dimension: 'causalExplanation', label: '导演解释', value: rationale, weight: 0.46 },
        {
          dimension: 'storyContext',
          label: dimLabel('storyContext', '上下文位置'),
          value: [shot.beat, shot.sourceCardContent].filter(Boolean).join('：'),
          weight: 0.34,
        },
      ];
  return dimensions.flatMap((dimension) => {
    const value = clean(dimension.value);
    if (!value) return [];
    return row({
      id: `director:${dimension.dimension}`,
      dimension: dimension.dimension,
      label: dimension.label,
      value,
      weight: dimension.weight,
      source: sourceFor('director', shot),
      category: 'narrative',
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
  const videoRows = buildVideoPromptRows(shot);
  const narrativeRows = buildNarrativePromptRows(shot);
  let baseRows = [...contentRows, ...videoRows];
  try {
    baseRows = [
      ...contentRows,
      ...videoRows,
      ...narrativeRows,
      ...buildArtPromptRows(shot, options.structuredPromptAdapter),
    ];
  } catch {
    baseRows = [...contentRows, ...videoRows, ...narrativeRows];
  }

  const previousRowsByShot = (options.previousShots ?? []).map((previousShot) => {
    const previousContentRows = buildContentPromptRows(previousShot);
    const previousVideoRows = buildVideoPromptRows(previousShot);
    const previousNarrativeRows = buildNarrativePromptRows(previousShot);
    let previousRows = [...previousContentRows, ...previousVideoRows];
    try {
      previousRows = [
        ...previousContentRows,
        ...previousVideoRows,
        ...previousNarrativeRows,
        ...buildArtPromptRows(previousShot, options.structuredPromptAdapter),
      ];
    } catch {
      previousRows = [...previousContentRows, ...previousVideoRows, ...previousNarrativeRows];
    }
    return {
      shotNo: previousShot.shotNo,
      cueCode: previousShot.cueCode,
      shotKey: previousShot.shotKey,
      rows: previousRows,
    };
  });

  return applyPromptInheritance({
    rows: baseRows,
    shot,
    previousRowsByShot,
  });
}
