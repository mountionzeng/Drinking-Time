import type { CreationEditorShot } from './CreationEditorContext';
import type { PromptRow } from './promptTable/types';

export type GenerateForMobileInput = {
  storyId: number;
  shotNo: number;
  prompt: string;
};

export type GenerateForMobileResult = {
  status: 'ok' | 'error';
  imageUrl?: string;
  imageId?: number;
  prompt?: string;
  error?: string;
};

export function buildRerenderPrompt(params: {
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
}): string {
  const sortedRows = [...params.rows].sort((left, right) => right.weight - left.weight);
  const weightedLines = sortedRows.map((row) => {
    const weight = Math.round(row.weight * 100);
    return `${row.label}(${weight}%): ${row.value}`;
  });

  return [
    `Rerender only ${params.shot.shotKey}. Do not change other shots.`,
    params.shot.sourceCardContent ? `Source material: ${params.shot.sourceCardContent}` : '',
    params.shot.dialogue ? `Subtitle/dialogue: ${params.shot.dialogue}` : '',
    'Prompt dimensions with weights:',
    ...weightedLines,
  ].filter(Boolean).join('\n');
}

export function createGenerateForMobileInput(params: {
  storyId: number;
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
}): GenerateForMobileInput {
  return {
    storyId: params.storyId,
    shotNo: params.shot.shotNo,
    prompt: buildRerenderPrompt({ shot: params.shot, rows: params.rows }),
  };
}

export async function rerenderShotImage(params: {
  storyId: number;
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  generate: (input: GenerateForMobileInput) => Promise<GenerateForMobileResult>;
}): Promise<GenerateForMobileResult> {
  const input = createGenerateForMobileInput(params);
  const result = await params.generate(input);
  if (result.status !== 'ok' || !result.imageUrl) {
    throw new Error(result.error || '图片生成失败');
  }
  return result;
}
