import type { CreationEditorShot } from './CreationEditorContext';
import { compilePromptRecipe } from './promptTable/promptRecipe';
import type { PromptRow } from './promptTable/types';

export type RerenderReference = {
  /** Full frame sent to FLUX Kontext as the visual/style reference. */
  imageUrl?: string;
  /** Cropped face/lower-face anchor used only for identity analysis. */
  identityImageUrl?: string;
};

export type GenerateForMobileInput = {
  storyId: number;
  shotNo: number;
  prompt: string;
  explicitInstruction?: string;
  costConfirmation?: {
    accepted: true;
    estimatedCny: number;
  };
  styleHint?: string;
  autoSelect?: boolean;
  referenceImageUrl?: string;
  referenceIdentityImageUrl?: string;
};

export type GenerateForMobileResult = {
  status: 'ok' | 'error';
  imageUrl?: string;
  imageId?: number;
  prompt?: string;
  error?: string;
};

const MAX_INLINE_REFERENCE_URL_CHARS = 2_500_000;

function isNetworkFetchError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === 'failed to fetch' ||
    normalized === 'load failed' ||
    normalized.includes('networkerror') ||
    normalized.includes('fetch failed')
  );
}

export function readableRerenderError(
  error: unknown,
  fallback = '图片生成失败'
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!message) return fallback;
  if (!isNetworkFetchError(message)) return message;
  return '重渲请求没有连上生成服务。请确认本地服务正在运行后再试；如果刚选择了参考视频，可以先切回“不使用参考”再重渲。';
}

function safeReferenceUrl(value: string | undefined): string | undefined {
  if (!value?.startsWith('data:')) return value;
  return value.length <= MAX_INLINE_REFERENCE_URL_CHARS ? value : undefined;
}

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
  reference?: RerenderReference;
  explicitInstruction?: string;
  costConfirmation?: {
    accepted: true;
    estimatedCny: number;
  };
}): GenerateForMobileInput {
  return {
    storyId: params.storyId,
    shotNo: params.shot.shotNo,
    prompt: buildRerenderPrompt({ shot: params.shot, rows: params.rows }),
    explicitInstruction: params.explicitInstruction?.trim() || undefined,
    costConfirmation: params.costConfirmation,
    styleHint: params.shot.styleRef || undefined,
    autoSelect: true,
    referenceImageUrl: safeReferenceUrl(params.reference?.imageUrl),
    referenceIdentityImageUrl: safeReferenceUrl(params.reference?.identityImageUrl),
  };
}

export async function rerenderShotImage(params: {
  storyId: number;
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  reference?: RerenderReference;
  explicitInstruction?: string;
  costConfirmation?: {
    accepted: true;
    estimatedCny: number;
  };
  generate: (input: GenerateForMobileInput) => Promise<GenerateForMobileResult>;
}): Promise<GenerateForMobileResult> {
  const input = createGenerateForMobileInput(params);
  let result: GenerateForMobileResult;
  try {
    result = await params.generate(input);
  } catch (error) {
    throw new Error(readableRerenderError(error, '重渲请求失败'));
  }
  if (result.status !== 'ok' || !result.imageUrl) {
    throw new Error(readableRerenderError(result.error, '图片生成失败'));
  }
  return result;
}
