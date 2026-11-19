import { inlineChatImageIds, inlineChatInstruction, inlineImageToken } from '@shared/inlineChatImages';
import type { ChatMessage } from './types';
import type { ChatImageRef } from './chatImageRefs';

export type FailedImageEditRecovery = {
  failureId: string;
  quoteId: string;
  storyId: number;
  stableShotId: string;
  shotNo: number;
  ref: ChatImageRef;
  instruction: string;
  userContent: string;
};

/** Restore the submitted request, never today's selection or a new AI guess. */
export function failedImageEditRecovery(messages: ChatMessage[], storyId: number | null,
  images: Array<{ imageId?: number; imageUrl: string; label: string }>): FailedImageEditRecovery | null {
  const failed = messages.at(-1);
  const user = messages.at(-2);
  if (!storyId || failed?.role !== 'assistant' || user?.role !== 'user') return null;
  if (!failed.content.startsWith('这条消息未完成：') &&
      failed.content !== '嗯……我这边刚刚卡了一下，没接住你说的。能再说一遍吗？') return null;
  const selected = user.selectionQuote;
  if (selected?.storyId !== storyId || !selected.stableShotId || !selected.shotNo || selected.selection) return null;
  const explicit = inlineChatImageIds(user.content);
  const ids = explicit.length ? explicit : selected.sourceType === 'storyboard-image' && selected.imageId ? [selected.imageId] : [];
  if (ids.length !== 1) return null; // Multi-image roles must still be confirmed in the existing plan.
  const image = images.find(image => image.imageId === ids[0]);
  if (!image?.imageUrl) return null;
  const quoteId = `image-recovery-quote:${failed.id}`;
  if (messages.some(message => message.id === quoteId)) return null;
  return {
    failureId: failed.id, quoteId, storyId, stableShotId: selected.stableShotId, shotNo: selected.shotNo,
    ref: {imageId: ids[0], imageUrl: image.imageUrl, label: image.label},
    instruction: inlineChatInstruction(user.content),
    userContent: explicit.length ? user.content : `${inlineImageToken(ids[0])} ${user.content}`,
  };
}

/** Reload restores the quote's source, never its payment authorization. */
export function quotedImageEditRecovery(messages: ChatMessage[], storyId: number | null,
  images: Array<{ imageId?: number; imageUrl: string; label: string }>): FailedImageEditRecovery | null {
  const quote = messages.at(-1);
  if (quote?.role !== 'assistant' || !quote.id.startsWith('image-recovery-quote:')) return null;
  const failureId = quote.id.slice('image-recovery-quote:'.length);
  const failureIndex = messages.findIndex(message => message.id === failureId);
  if (failureIndex < 0) return null;
  const request = failedImageEditRecovery(messages.slice(0, failureIndex + 1), storyId, images);
  const user = messages.at(-2);
  return request && user?.id === `image-recovery-user:${failureId}` && user.content === request.userContent ? request : null;
}

/** This prepares a local quote only. No persisted state authorizes payment. */
export function recoveredImageEditQuoteMessages(request: FailedImageEditRecovery, quote: string, now: number): ChatMessage[] {
  const selectionQuote = {sourceType: 'shot' as const, sourceId: request.stableShotId, storyId: request.storyId,
    stableShotId: request.stableShotId, shotNo: request.shotNo, selectedText: request.userContent};
  return [
    {id:`image-recovery-user:${request.failureId}`,role:'user',timestamp:now,content:request.userContent,selectionQuote},
    {id:request.quoteId,role:'assistant',timestamp:now+1,
      content:`已收到 1 张引用，图1为图片 #${request.ref.imageId}。原话已恢复，预计 ${quote}；确认后才会提交新的改图任务，候选不替换剪辑。此前未完成的文字请求没有重试，旧费用仍待核对。`,
      selectionQuote:{...selectionQuote,selectedText:'图片修改报价'}},
  ];
}
