import type { StoryShot } from './types';
import type { GeneratedImageItem } from '@/features/mobileChat/types';
import { defaultArtRecipe, type ArtRecipeDNA } from '@shared/artDirection';
import { SINGLE_FRAME_HARD_CONSTRAINT } from '@shared/singleFramePrompt';
import {
  type PromptContext,
  type PromptPreviousShot,
  buildUnifiedPrompt,
} from '@shared/promptContext';
import { buildContinuityHint } from '@shared/promptContinuity';

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

export function buildStoryboardDraftPrompt(
  shot: StoryShot,
  previousShot?: PromptPreviousShot,
): string {
  const ctx: PromptContext = {
    shot: {
      shotNo: shot.shotNo,
      subject: clean(shot.subject),
      action: clean(shot.action),
      location: clean(shot.location),
      timeLight: clean(shot.timeLight),
      mood: clean(shot.mood),
      styleRef: clean(shot.styleRef),
      shotType: clean(shot.shotType),
      cameraAngle: clean(shot.cameraAngle),
      cameraMove: clean(shot.cameraMove),
      beat: clean(shot.beat),
      intent: clean(shot.intent),
      rationale: clean(shot.rationale),
      sourceCardContent: clean(shot.sourceCardContent),
      negativePrompt: clean(shot.negativePrompt),
      promptDraft: clean(shot.promptDraft),
    },
    story: { storyId: 0 },
    previousShot,
  };

  const base = buildUnifiedPrompt(ctx);

  if (previousShot) {
    const continuity = buildContinuityHint(previousShot, ctx.shot);
    if (continuity) {
      // 连续性提示插入在镜头内容之后、硬约束之前
      const constraintIdx = base.indexOf('Single-frame rule:');
      if (constraintIdx > 0) {
        return base.slice(0, constraintIdx) + continuity + '\n' + base.slice(constraintIdx);
      }
      return base + '\n' + continuity;
    }
  }

  return base;
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
    draftShots.map(async (shot, index) => {
      const previous = draftShots[index - 1];
      const previousShot: PromptPreviousShot | undefined = previous
        ? {
            shotNo: previous.shotNo,
            finalPrompt: buildStoryboardDraftPrompt(previous),
            subject: clean(previous.subject),
            mood: clean(previous.mood),
            location: clean(previous.location),
            styleRef: clean(previous.styleRef),
          }
        : undefined;
    const prompt = buildStoryboardDraftPrompt(shot, previousShot);
    try {
      const result = await params.generate({
        storyId: params.storyId,
        shotNo: shot.shotNo,
        prompt,
        styleHint: clean(shot.styleRef) || undefined,
        mode: 'draft',
        sceneWeight: 0.5,
      });
      if (result.status === 'ok' && result.imageUrl && typeof result.imageId === 'number') {
        return {
          image: {
          id: result.imageId,
          imageUrl: result.imageUrl,
          prompt: result.prompt ?? prompt,
          shotNo: shot.shotNo,
          storyId: params.storyId,
          status: result.mode === 'draft' ? 'draft' : 'ready',
          } satisfies GeneratedImageItem,
          failed: false,
        };
      }
      return { image: null, failed: true };
    } catch {
      return { image: null, failed: true };
    }
    })
  );

  const images: GeneratedImageItem[] = results.flatMap(result =>
    result.image ? [result.image] : []
  );
  const failedCount = results.filter(result => result.failed).length;
  return { images, generatedCount: images.length, failedCount };
}
