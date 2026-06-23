import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptRow, PromptRunRecord } from './types';
import { SINGLE_FRAME_HARD_CONSTRAINT } from '@shared/singleFramePrompt';

export type CompiledPromptRecipe = {
  finalPrompt: string;
  usedDimensions: string[];
};

export function compilePromptRecipe(params: {
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  continuityHint?: string;
}): CompiledPromptRecipe {
  const sortedRows = [...params.rows]
    .filter((row) => row.value.trim())
    .sort((left, right) => right.weight - left.weight);
  const weightedLines = sortedRows.map((row) => {
    const weight = Math.round(row.weight * 100);
    return `${row.label}(${weight}%): ${row.value.trim()}`;
  });

  const shotKey = `SH${String(params.shot.shotNo ?? 0).padStart(2, '0')}`;

  return {
    finalPrompt: [
      `Create exactly one cinematic key frame for ${shotKey}.`,
      'This image belongs to the storyboard, but it must be a single continuous shot frame, not a storyboard sheet or poster.',
      params.shot.styleRef ? `Shared visual framework for the whole film: ${params.shot.styleRef}` : '',
      params.shot.intent ? `Director intent: ${params.shot.intent}` : '',
      params.shot.rationale ? `Why this frame works: ${params.shot.rationale}` : '',
      params.shot.sourceCardContent ? `Source Story Card: ${params.shot.sourceCardContent}` : '',
      params.continuityHint ? `Continuity: ${params.continuityHint}` : '',
      params.shot.dialogue
        ? `Dialogue meaning to express through acting and composition only, do not render as text: ${params.shot.dialogue}`
        : '',
      'Prompt dimensions with weights:',
      ...weightedLines,
      `Hard constraints: ${SINGLE_FRAME_HARD_CONSTRAINT}`,
    ].filter(Boolean).join('\n'),
    usedDimensions: sortedRows.map((row) => row.dimension),
  };
}

export function promptRunUsesDimension(
  promptRun: PromptRunRecord | undefined,
  dimension: string,
): boolean {
  return Boolean(promptRun?.usedDimensions.includes(dimension));
}
