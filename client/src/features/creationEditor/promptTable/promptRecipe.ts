import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptRow, PromptRunRecord } from './types';

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

  return {
    finalPrompt: [
      `Rerender only ${params.shot.shotKey}. Create exactly one single ad-film storyboard key frame. Use other shots only as continuity context; do not show them.`,
      'Director goal: communicate the user strength behind this Story Card to the intended audience. Make the image explain why this moment is credible, useful, and worth contacting the person for.',
      'Hard constraints: no split screen, no comic panels, no storyboard grid, no contact sheet, no subtitles, no captions, no readable text, no UI, no watermark.',
      'Avoid generic mood posters. Prefer concrete work evidence, visible decision process, artifacts, prototypes, whiteboards, portfolios, tools, meetings, or material traces that make the advantage believable.',
      params.shot.sourceCardContent ? `Source material: ${params.shot.sourceCardContent}` : '',
      params.continuityHint ? `Continuity: ${params.continuityHint}` : '',
      params.shot.dialogue
        ? `Dialogue meaning to express through acting and composition only, do not render as text: ${params.shot.dialogue}`
        : '',
      'Prompt dimensions with weights:',
      ...weightedLines,
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
