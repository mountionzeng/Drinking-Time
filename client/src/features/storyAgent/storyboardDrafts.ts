import type { StoryShot } from './types';
import type { GeneratedImageItem } from '@/features/mobileChat/types';
import { defaultArtRecipe, type ArtRecipeDNA } from '@shared/artDirection';
import { SINGLE_FRAME_HARD_CONSTRAINT } from '@shared/singleFramePrompt';

export const STORYBOARD_DRAFT_SHOT_LIMIT = 3;
const STORYBOARD_STYLE_TOKEN_LIMIT = 8;

const BEAT_PRIORITY = ['开场', '转折', '收束'] as const;

export type StoryboardDraftGenerateInput = {
  storyId: number;
  shotNo: number;
  prompt: string;
  styleHint?: string;
  mode: 'draft';
  sceneWeight: number;
};

export type StoryboardDraftGenerateResult = {
  status: 'ok' | 'error';
  imageUrl?: string;
  imageId?: number;
  prompt?: string;
  mode?: 'draft' | 'final';
  error?: string;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function artRecipeToStyleRef(recipe: ArtRecipeDNA | undefined): string {
  if (!recipe) return '';
  return [
    ...recipe.style,
    ...recipe.palette,
    ...recipe.light,
    ...recipe.composition,
    ...recipe.material,
  ]
    .map(clean)
    .filter(Boolean)
    .slice(0, STORYBOARD_STYLE_TOKEN_LIMIT)
    .join(', ');
}

export function commonShotStyleRef(shots: readonly StoryShot[]): string {
  const refs = new Set(
    shots
      .map((shot) => clean(shot.styleRef))
      .filter(Boolean),
  );
  return refs.size === 1 ? Array.from(refs)[0] : '';
}

export function resolveStoryboardStyleRef(params: {
  shots: readonly StoryShot[];
  artRecipe?: ArtRecipeDNA;
}): string {
  return commonShotStyleRef(params.shots)
    || artRecipeToStyleRef(params.artRecipe)
    || artRecipeToStyleRef(defaultArtRecipe());
}

export function applyStoryboardStyleRef(
  shots: readonly StoryShot[],
  styleRef: string,
): StoryShot[] {
  const cleanStyleRef = clean(styleRef);
  if (!cleanStyleRef) return [...shots];
  return shots.map((shot) => ({ ...shot, styleRef: cleanStyleRef }));
}

export function pickStoryboardDraftShots(
  shots: readonly StoryShot[],
  limit = STORYBOARD_DRAFT_SHOT_LIMIT,
): StoryShot[] {
  if (limit <= 0) return [];
  const sorted = [...shots]
    .filter((shot) => Number.isFinite(shot.shotNo) && shot.shotNo > 0)
    .sort((left, right) => left.shotNo - right.shotNo);
  const picked = new Map<number, StoryShot>();

  for (const beat of BEAT_PRIORITY) {
    const shot = sorted.find((candidate) => candidate.beat === beat);
    if (shot) picked.set(shot.shotNo, shot);
    if (picked.size >= limit) break;
  }

  for (const shot of sorted) {
    if (picked.size >= limit) break;
    picked.set(shot.shotNo, shot);
  }

  return Array.from(picked.values()).sort((left, right) => left.shotNo - right.shotNo);
}

export function buildStoryboardDraftPrompt(shot: StoryShot): string {
  const fallbackPrompt = [
    clean(shot.subject) ? `主体：${clean(shot.subject)}` : '',
    clean(shot.action) ? `动作：${clean(shot.action)}` : '',
    clean(shot.location) ? `场景：${clean(shot.location)}` : '',
    clean(shot.mood) ? `氛围：${clean(shot.mood)}` : '',
    clean(shot.styleRef) ? `风格：${clean(shot.styleRef)}` : '',
  ].filter(Boolean).join('；');

  return [
    `Create exactly one cinematic key frame for SH${String(shot.shotNo).padStart(2, '0')}.`,
    'This image belongs to the generated storyboard, but it must be a single continuous shot frame, not a storyboard sheet or poster.',
    clean(shot.styleRef) ? `Shared visual framework for the whole film: ${clean(shot.styleRef)}` : '',
    clean(shot.intent) ? `Director intent: ${clean(shot.intent)}` : '',
    clean(shot.rationale) ? `Why this frame works: ${clean(shot.rationale)}` : '',
    clean(shot.sourceCardContent) ? `Source Story Card: ${clean(shot.sourceCardContent)}` : '',
    clean(shot.promptDraft) || fallbackPrompt,
    `Hard constraints: ${SINGLE_FRAME_HARD_CONSTRAINT}`,
  ].filter(Boolean).join('\n');
}

export async function generateStoryboardDraftFrames(params: {
  storyId: number;
  shots: readonly StoryShot[];
  generate: (input: StoryboardDraftGenerateInput) => Promise<StoryboardDraftGenerateResult>;
}): Promise<{
  images: GeneratedImageItem[];
  generatedCount: number;
  failedCount: number;
}> {
  const draftShots = pickStoryboardDraftShots(params.shots);
  const results = await Promise.all(
    draftShots.map(async (shot): Promise<GeneratedImageItem | null> => {
      const prompt = buildStoryboardDraftPrompt(shot);
      try {
        const result = await params.generate({
          storyId: params.storyId,
          shotNo: shot.shotNo,
          prompt,
          styleHint: clean(shot.styleRef) || undefined,
          mode: 'draft',
          sceneWeight: 0.5,
        });
        if (result.status !== 'ok' || !result.imageUrl || typeof result.imageId !== 'number') {
          return null;
        }
        return {
          id: result.imageId,
          imageUrl: result.imageUrl,
          prompt: result.prompt ?? prompt,
          shotNo: shot.shotNo,
          storyId: params.storyId,
          status: result.mode === 'draft' ? 'draft' : 'ready',
        };
      } catch {
        return null;
      }
    }),
  );
  const images = results.filter((image): image is GeneratedImageItem => Boolean(image));
  return {
    images,
    generatedCount: images.length,
    failedCount: draftShots.length - images.length,
  };
}
