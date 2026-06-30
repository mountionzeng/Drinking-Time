import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptRow, PromptRunRecord } from './types';
import { SINGLE_FRAME_HARD_CONSTRAINT } from '@shared/singleFramePrompt';
import {
  type PromptContext,
  type PromptPreviousShot,
  buildUnifiedPrompt,
} from '@shared/promptContext';
import { buildContinuityHint } from '@shared/promptContinuity';

export type CompiledPromptRecipe = {
  finalPrompt: string;
  usedDimensions: string[];
};

function u(v: string | null | undefined): string | undefined {
  return v ?? undefined;
}

export function compilePromptRecipe(params: {
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  continuityHint?: string;
  previousShot?: PromptPreviousShot;
}): CompiledPromptRecipe {
  const sortedRows = [...params.rows]
    .filter((row) => row.value.trim())
    .sort((left, right) => right.weight - left.weight);

  // 构建 PromptContext
  const shot = params.shot;
  const ctx: PromptContext = {
    shot: {
      shotNo: shot.shotNo ?? 0,
      subject: u(shot.subject),
      action: u(shot.action),
      location: u(shot.location),
      timeLight: u(shot.timeLight),
      mood: u(shot.mood),
      styleRef: u(shot.styleRef),
      shotType: u(shot.shotType),
      cameraAngle: u(shot.cameraAngle),
      cameraMove: u(shot.cameraMove),
      beat: u(shot.beat),
      intent: u(shot.intent),
      rationale: u(shot.rationale),
      sourceCardContent: u(shot.sourceCardContent),
      negativePrompt: u(shot.negativePrompt),
    },
    story: { storyId: 0 },
    previousShot: params.previousShot,
  };

  let prompt = buildUnifiedPrompt(ctx);

  // 在镜头内容和硬约束之间插入加权维度行
  if (sortedRows.length > 0) {
    const weightedLines = sortedRows.map((row) => {
      const weight = Math.round(row.weight * 100);
      return `${row.label}(${weight}%): ${row.value.trim()}`;
    });
    const dimensionBlock = 'Prompt dimensions with weights:\n' + weightedLines.join('\n');

    const constraintIdx = prompt.indexOf('Single-frame rule:');
    if (constraintIdx > 0) {
      prompt = prompt.slice(0, constraintIdx) + dimensionBlock + '\n' + prompt.slice(constraintIdx);
    } else {
      prompt = prompt + '\n' + dimensionBlock;
    }
  }

  // 连续性提示
  const continuity = params.continuityHint
    ? `Continuity: ${params.continuityHint}`
    : (params.previousShot ? buildContinuityHint(params.previousShot, ctx.shot) : '');
  if (continuity) {
    const constraintIdx = prompt.indexOf('Single-frame rule:');
    if (constraintIdx > 0) {
      prompt = prompt.slice(0, constraintIdx) + continuity + '\n' + prompt.slice(constraintIdx);
    } else {
      prompt = prompt + '\n' + continuity;
    }
  }

  // 对话叙事提示
  if (shot.dialogue) {
    const narrativeHint = 'Dialogue meaning to express through acting and composition only, do not render as text. Visual storytelling: convey the emotion and meaning of this scene through composition, lighting and acting.';
    const constraintIdx = prompt.indexOf('Single-frame rule:');
    if (constraintIdx > 0) {
      prompt = prompt.slice(0, constraintIdx) + narrativeHint + '\n' + prompt.slice(constraintIdx);
    } else {
      prompt = prompt + '\n' + narrativeHint;
    }
  }

  return {
    finalPrompt: prompt,
    usedDimensions: sortedRows.map((row) => row.dimension),
  };
}

export function promptRunUsesDimension(
  promptRun: PromptRunRecord | undefined,
  dimension: string,
): boolean {
  return Boolean(promptRun?.usedDimensions.includes(dimension));
}
