import { createHash } from 'node:crypto';
import { buildChatImageRemixRequest } from '../../shared/chatImageRefs';
import { recoverStoryboardImageTask, type Task } from './storyboardImageTask';
import { TRPCError } from '@trpc/server';
import { inlineChatImageIds, inlineChatInstruction } from '../../shared/inlineChatImages';
import { shotIdentityFromShot } from '../../shared/shotIdentity';
import { getStoryById } from '../repositories/stories';
import { getStoryGeneratedImages } from '../repositories/images';
import { jsonRecord } from '../repositories/storyValues';
import { recordShotConversationMedia } from './shotConversationMedia';

/** Stable per persisted quote: refresh/double-click can only recover the same purchase. */
export function chatImageRemixRequestId(storyId: number, quoteMessageId: string) {
  const h = createHash('sha256').update(JSON.stringify(['chat-image-remix', storyId, quoteMessageId])).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function readChatImageRemixQuote(input: { storyId: number; userId: number; quoteMessageId: string }) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: 'NOT_FOUND', message: '故事不存在或无权访问' });
  const body = jsonRecord(story.body);
  const messages = (Array.isArray(body.messages) ? body.messages : []).map(jsonRecord);
  const quoteIndex = messages.findIndex(message => message.id === input.quoteMessageId);
  const quote = messages[quoteIndex];
  const user = messages[quoteIndex - 1];
  const text = String(user?.text ?? user?.content ?? '');
  const quoteText = String(quote?.text ?? quote?.content ?? '');
  if (!quote || !user || !['s', 'assistant'].includes(String(quote.who ?? quote.role)) ||
      !['u', 'user'].includes(String(user.who ?? user.role)) || !/^已收到 \d 张引用/.test(quoteText) || !text.includes('[[ref:')) return null;
  const selection = jsonRecord(quote.selectionQuote);
  const stableShotId = typeof selection.stableShotId === 'string' ? selection.stableShotId : '';
  const shots = (Array.isArray(body.shots) ? body.shots : []).map(jsonRecord);
  const index = shots.findIndex((shot, i) => shotIdentityFromShot(shot, i) === stableShotId);
  if (index < 0 || selection.storyId !== input.storyId) return null;
  const instruction = inlineChatInstruction(text).trim();
  const references = inlineChatImageIds(text);
  const timestamp = Number(quote.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  const images = await getStoryGeneratedImages(input.storyId, input.userId);
  if (references.some(id => !images.some(image => image.id === id && image.userId === input.userId))) return null;
  // An older quote must not claim an image created for a later quote with the same wording.
  const nextQuote = messages.slice(quoteIndex + 1).find(message => /^已收到 \d 张引用/.test(String(message.text ?? message.content ?? '')));
  const before = nextQuote ? Number(nextQuote.timestamp) : Infinity;
  const refs = references.map(id => {
    const image = images.find(image => image.id === id)!;
    return { imageId: id, imageUrl: image.imageUrl, label: `图片 #${id}` };
  });
  const request = buildChatImageRemixRequest({ refs, instruction });
  if ('error' in request) throw new TRPCError({ code: 'BAD_REQUEST', message: request.error });
  const requestId = chatImageRemixRequestId(input.storyId, input.quoteMessageId);
  const task = ((body.storyboardImageTasks ?? []) as Task[]).find(t => t.requestId === requestId);
  if (task && task.shotIdentity !== stableShotId) throw new TRPCError({ code: 'CONFLICT', message: '任务镜头归属不一致，已停止。' });
  return { request, requestId, refs, task, images, instruction, references, timestamp, before,
    stableShotId, shotNo: Number(shots[index].shotNo) || index + 1 };
}

/** Read an existing receipt only; this function can never purchase generation. */
export async function recoverChatImageRemix(input: { storyId: number; userId: number; quoteMessageId: string }) {
  const quote = await readChatImageRemixQuote(input);
  if (!quote) return null;
  const { images, instruction, references, timestamp, before, stableShotId, shotNo, task } = quote;
  let image;
  if (task) {
    const result = await recoverStoryboardImageTask(input.storyId, input.userId, quote.requestId);
    if (result.status !== 'ok') {
      if (task.status === 'failed') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.error });
      return { pending: true as const, requestId: quote.requestId, startedAt: task.createdAt,
        recoverable: Boolean(task.providerTaskId || task.providerResultUrl), error: result.error };
    }
    image = (await getStoryGeneratedImages(input.storyId, input.userId)).find(i => i.id === result.imageId);
    if (!image) throw new TRPCError({ code: 'CONFLICT', message: '已完成候选缺失，已停止，不能重复购买。' });
  } else {
    const candidates = images.filter(image => image.userId === input.userId && !references.includes(image.id) &&
      image.generationType === 'inpaint' && +new Date(image.createdAt) >= timestamp && +new Date(image.createdAt) < before &&
      image.prompt?.includes(instruction));
    if (!candidates.length) return null;
    if (candidates.length !== 1) throw new TRPCError({ code: 'CONFLICT', message: '这条要求对应多个已保存候选，请从仓库明确选择；没有重新生成。' });
    image = candidates[0];
  }
  await recordShotConversationMedia({ ...input, stableShotId, imageIds: [image.id], instruction });
  return { imageId: image.id, imageUrl: image.imageUrl, instruction, stableShotId,
    shotNo, sourceImageIds: references, recovered: true as const };
}
