import type { StoryShot } from './types';

export const STORYBOARD_DRAFT_SHOT_LIMIT = 3;

const BEAT_PRIORITY = ['开场', '转折', '收束'] as const;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    `Create exactly one storyboard key frame for SH${String(shot.shotNo).padStart(2, '0')}.`,
    'This image is part of the generated storyboard, not a standalone poster.',
    clean(shot.intent) ? `Director intent: ${clean(shot.intent)}` : '',
    clean(shot.rationale) ? `Why this frame works: ${clean(shot.rationale)}` : '',
    clean(shot.sourceCardContent) ? `Source Story Card: ${clean(shot.sourceCardContent)}` : '',
    clean(shot.promptDraft) || fallbackPrompt,
    'Hard constraints: no captions, no readable text, no UI, no watermark, no split screen, no storyboard grid.',
  ].filter(Boolean).join('\n');
}
