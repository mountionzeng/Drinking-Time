import type { CreationEditorShot } from './CreationEditorContext';
import { compilePromptRecipe } from './promptTable/promptRecipe';
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
  return compilePromptRecipe(params).finalPrompt;
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
