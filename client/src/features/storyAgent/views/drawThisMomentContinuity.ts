import type { GeneratedImageItem } from '@/features/mobileChat/types';
import { parseShotNo } from '@/features/mobileChat/types';

type StoryCardForDrawing = {
  id?: string;
  title?: string;
  content?: string;
  sensoryDetails?: string[];
  emotion?: string;
};

function compactText(value: string | undefined, limit: number): string {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

export function buildStoryboardContinuityHint(
  cards: StoryCardForDrawing[],
  targetShotNo: number,
): string {
  if (cards.length <= 1) return '';
  const sequence = cards
    .map((card, index) => {
      const title = compactText(card.title, 28);
      const content = compactText(card.content, 72);
      return `${index + 1}. ${[title, content].filter(Boolean).join(' - ')}`;
    })
    .filter(Boolean)
    .join(' / ');

  return [
    `故事连续性：这是第 ${targetShotNo}/${cards.length} 个镜头，不是一张独立海报。`,
    '整组图片必须像同一支短片里的连续镜头：同一个主角气质、同一视觉世界、相近色彩与材质、可衔接的镜头语言。',
    sequence ? `故事顺序：${sequence}` : '',
  ].filter(Boolean).join(' ');
}

export function buildDrawCardHint(
  card: StoryCardForDrawing | undefined,
  cards: StoryCardForDrawing[],
  targetShotNo: number,
): string {
  if (!card) return '';
  const parts: string[] = [];
  if (card.content?.trim()) parts.push(card.content.trim());
  if (card.title?.trim() && card.title.trim() !== card.content?.trim()) {
    parts.push(card.title.trim());
  }
  if (card.sensoryDetails?.length) {
    parts.push(`感官细节：${card.sensoryDetails.join('、')}`);
  }
  if (card.emotion?.trim()) parts.push(`情绪：${card.emotion.trim()}`);
  const continuity = buildStoryboardContinuityHint(cards, targetShotNo);
  if (continuity) parts.push(continuity);
  return parts.join('；');
}

export function findStoryboardContinuityImage(
  storyImages: GeneratedImageItem[],
  targetShotNo: number,
): GeneratedImageItem | undefined {
  const readyImages = storyImages
    .filter((image) => image.status === 'ready' && image.imageUrl)
    .map((image, index) => ({
      image,
      index,
      shotNo: parseShotNo(image.shotNo),
    }))
    .filter((item): item is { image: GeneratedImageItem; index: number; shotNo: number } =>
      item.shotNo !== undefined,
    );
  if (!readyImages.length) return undefined;

  const previous = readyImages
    .filter((item) => item.shotNo < targetShotNo)
    .sort((left, right) => right.shotNo - left.shotNo || right.index - left.index)[0];
  if (previous) return previous.image;

  return readyImages
    .sort(
      (left, right) =>
        Math.abs(left.shotNo - targetShotNo) - Math.abs(right.shotNo - targetShotNo) ||
        right.index - left.index,
    )[0]?.image;
}
