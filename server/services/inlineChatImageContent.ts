import { TRPCError } from '@trpc/server';
import { inlineChatImageIds, inlineChatParts } from '../../shared/inlineChatImages';
import { getGeneratedImageById } from '../repositories/images';
import { materializeImageInput } from './imageAssets';
import type { MessageContent } from '../_core/llm';

/** Resolve IDs under the owned story; never trust a client-provided image URL. */
export async function inlineChatImageContent(text: string, storyId: number | undefined, userId: number): Promise<MessageContent[]> {
  const ids = inlineChatImageIds(text);
  if (!storyId || !ids.length) throw new TRPCError({ code: 'BAD_REQUEST', message: '请先打开图片所属的故事' });
  const images = await Promise.all(ids.map(id => getGeneratedImageById(id)));
  if (images.some(image => !image || image.userId !== userId || image.storyId !== storyId || !image.imageUrl))
    throw new TRPCError({ code: 'NOT_FOUND', message: '引用图片已不可用或不属于当前故事，请重新选择' });
  const urls = await Promise.all(images.map(image => materializeImageInput(image!.imageUrl, userId)));
  const seen = new Set<number>();
  return inlineChatParts(text).flatMap<MessageContent>(part => {
    if (!part.imageId) return [{ type: 'text', text: part.text }];
    const index = ids.indexOf(part.imageId);
    const label: MessageContent = { type: 'text', text: `图${index + 1}（图片 #${part.imageId}）` };
    if (seen.has(part.imageId)) return [label];
    seen.add(part.imageId);
    return [label, { type: 'image_url', image_url: { url: urls[index], detail: 'high' } }];
  });
}
