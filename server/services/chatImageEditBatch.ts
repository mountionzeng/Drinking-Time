import { canRetryImage, imageAttemptHistory, imageEditBatchRequestId, imageFailureReason, retryRequestId, type ImageRetryOffer } from './reviewedImageRetry';
export { imageEditBatchRequestId } from './reviewedImageRetry';
import { TRPCError } from '@trpc/server';
import { imageEditPlanQuote, chatImageEditPlanSchema, imageEditPlanOutput, adjustedImageEditPlanId, localEraseReceiptId, keyframeBoardImageIds } from '../../shared/chatImageEditPlan';
import { buildChatImageRemixRequest } from '../../shared/chatImageRefs';
import { inlineChatImageIds, inlineChatParts } from '../../shared/inlineChatImages';
import { shotIdentityFromShot } from '../../shared/shotIdentity';
import { getStoryById } from '../repositories/stories';
import { getStoryGeneratedImages } from '../repositories/images';
import { jsonRecord } from '../repositories/storyValues';
import type { Task } from './storyboardImageTask';

export type ImageEditBatchItem = {
  imageId: number; imageUrl: string; copy: number; requestId: string;
  status: 'ready' | 'pending' | 'unknown' | 'failed' | 'done';
  result?: { imageId: number; imageUrl: string };
  candidates?: Array<{ imageId: number; imageUrl: string }>;
  error?: string;
  recoverable?: boolean;
  retry?: ImageRetryOffer;
  request: Exclude<ReturnType<typeof buildChatImageRemixRequest>, { error: string }>;
};
export type ImageEditBatch = {
  storyId: number; planMessageId: string; stableShotId: string; shotNo: number;
  renderRoute?: 'precision' | 'storyboard';
  unitEstimatedCny: number; remainingEstimatedCny: number; items: ImageEditBatchItem[];
};

/** Reads intent and receipts only. A quote or refresh never starts generation. */
export async function readChatImageEditBatch(input: { storyId: number; userId: number; planMessageId: string }): Promise<ImageEditBatch> {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: 'NOT_FOUND', message: '故事不存在或无权访问' });
  const body = jsonRecord(story.body);
  const messages = (Array.isArray(body.messages) ? body.messages : []).map(jsonRecord);
  const message = messages.find(message => message.id === input.planMessageId);
  const parsed = chatImageEditPlanSchema.safeParse(message?.imageEditPlan);
  if (!parsed.success || parsed.data.status !== 'submitted') throw new TRPCError({ code: 'BAD_REQUEST', message: '修改要求尚未保存，请先确认要求。' });
  if (messages.some(message => message.id === adjustedImageEditPlanId(input.planMessageId))) throw new TRPCError({ code: 'CONFLICT', message: '修改要求已调整，请使用最新确认。' });
  const originalId = input.planMessageId.replace(/^image-edit-confirmed:/, '');
  if (messages.some(row => row.id === 'image-edit-withdrawn:' + originalId)) throw new TRPCError({ code: 'CONFLICT', message: '修改要求已撤回。' });
  if (messages.some(row => row.id === localEraseReceiptId(originalId))) throw new TRPCError({ code: "CONFLICT", message: "本次选区已完成本地擦除，请从最新一组继续。" });
  if (originalId !== input.planMessageId && messages.some(row => row.id === adjustedImageEditPlanId(originalId)))
    throw new TRPCError({ code: 'CONFLICT', message: '这份报价已被新的修改范围取代，请查看最新报价。' });
  const selection = jsonRecord(message?.selectionQuote);
  const shots = (Array.isArray(body.shots) ? body.shots : []).map(jsonRecord);
  const index = shots.findIndex((shot, i) => shotIdentityFromShot(shot, i) === selection.stableShotId);
  if (selection.storyId !== input.storyId || index < 0 || typeof selection.stableShotId !== 'string') throw new TRPCError({ code: 'CONFLICT', message: '原镜头已变化，请重新核对。' });
  if (parsed.data.keyframeBoardId) {
    const board = messages.find(row => row.id === parsed.data.keyframeBoardId && row.who === 's');
    const origin = jsonRecord(board?.selectionQuote);
    const ids = board ? keyframeBoardImageIds(String(board.id), String(board.text)) : [];
    if (origin.storyId !== input.storyId || origin.stableShotId !== selection.stableShotId ||
        JSON.stringify((parsed.data.regionScanSourceId ? parsed.data.images : parsed.data.images.filter(i => i.role === 'target')).map(i => i.imageId)) !== JSON.stringify(ids))
      throw new TRPCError({ code: 'CONFLICT', message: '待改画面与本镜审图记录不一致，请核对原组。' });
  }
  const images = await getStoryGeneratedImages(input.storyId, input.userId);
  const plan = { ...parsed.data, images: parsed.data.images.map(ref => {
    if (ref.role === 'omit') return ref;
    const image = images.find(image => image.id === ref.imageId && image.userId === input.userId);
    if (!image) throw new TRPCError({ code: 'CONFLICT', message: `原图 #${ref.imageId} 已不可用，未提交生成。` });
    return { ...ref, imageUrl: image.imageUrl };
  }) };
  const tasks = (Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : []) as Task[];
  const byId = new Map(tasks.map(task=>[task.requestId,task]));
  const { unitCny:unitEstimatedCny } = imageEditPlanQuote(plan);
  const items: ImageEditBatchItem[] = [];
  const economy = plan.renderRoute === 'storyboard';
  for (const target of plan.images.filter(image => image.role === 'target')) for (let copy = 1; copy <= (economy ? 1 : target.copies); copy++) {
    const output = imageEditPlanOutput(plan, target.imageId, copy);
    if (output.instruction.length > 2000) throw new TRPCError({ code: 'BAD_REQUEST', message: '合并后的单图要求超过2000字，请精简要求后确认。' });
    const request = buildChatImageRemixRequest(output);
    if ('error' in request) throw new TRPCError({ code: 'BAD_REQUEST', message: request.error });
    const root = imageEditBatchRequestId(input.storyId, input.planMessageId, target.imageId, copy);
    const task = imageAttemptHistory(byId,root).at(-1);
    const requestId = task?.requestId ?? root;
    const item: ImageEditBatchItem = { imageId: target.imageId, imageUrl: target.imageUrl, copy, requestId, request, status: 'ready' };
    if (task) {
      if (task.shotIdentity !== selection.stableShotId) throw new TRPCError({ code: 'CONFLICT', message: '图片任务的镜头归属不一致，已停止。' });
      if (task.status === 'succeeded' && task.result?.status === 'ok') {
        const resultImageId = task.result.imageId;
        const image = images.find(image => image.id === resultImageId && image.userId === input.userId);
        if (!image) throw new TRPCError({ code: 'CONFLICT', message: '已完成候选不可用，已停止，不能重复购买。' });
        item.status = 'done'; item.result = { imageId: image.id, imageUrl: image.imageUrl };
        if (economy) item.candidates = task.result.candidates.map(candidate => {
          const saved = images.find(row => row.id === candidate.imageId && row.userId === input.userId);
          if (!saved) throw new TRPCError({ code: 'CONFLICT', message: '已完成候选不可用，请核对原任务。' });
          return { imageId: saved.id, imageUrl: saved.imageUrl };
        });
      } else {
        item.status = task.status === 'failed' ? 'failed' : task.status === 'unknown' ? 'unknown' : 'pending';
        item.recoverable = Boolean(task.providerTaskId || task.providerResultUrl);
        item.error = task.result?.status === 'error' ? imageFailureReason(task.result.error) : undefined;
        if (canRetryImage(task)) item.retry = {storyId: input.storyId, stableShotId: selection.stableShotId,
          planMessageId: input.planMessageId, imageId: target.imageId, copy, failedId: requestId, nextId: retryRequestId(requestId), unitCny: unitEstimatedCny};
      }
    } else if (!economy && !plan.keyframeBoardId) {
      // Bridge the existing single-output quotes. Exact instruction + ordered IDs +
      // its quote window are required; visual similarity never claims a paid result.
      const candidates = new Map<number, typeof images[number]>();
      let legacyQuote = false;
      messages.forEach((quote, i) => {
        const user = messages[i - 1];
        const text = String(user?.text ?? user?.content ?? '');
        const quoteText = String(quote.text ?? quote.content ?? '');
        const quoteSelection = jsonRecord(quote.selectionQuote);
        if (!/^已收到 \d 张引用/.test(quoteText) || !['u', 'user'].includes(String(user?.who ?? user?.role)) ||
          quoteSelection.storyId !== input.storyId || quoteSelection.stableShotId !== selection.stableShotId ||
          Number(quote.timestamp) < Number(message?.timestamp) ||
          inlineChatParts(text).filter(part => !part.imageId).map(part => part.text).join('').trim() !== output.instruction ||
          JSON.stringify(inlineChatImageIds(text)) !== JSON.stringify(output.refs.map(ref => ref.imageId))) return;
        legacyQuote = true;
        const nextQuote = messages.slice(i + 1).find(next => /^已收到 \d 张引用/.test(String(next.text ?? next.content ?? '')));
        const before = nextQuote ? Number(nextQuote.timestamp) : Infinity;
        for (const image of images) if (image.userId === input.userId && image.generationType === 'inpaint' &&
          +new Date(image.createdAt) >= Number(quote.timestamp) && +new Date(image.createdAt) < before && image.prompt?.includes(output.instruction)) candidates.set(image.id, image);
      });
      if (candidates.size > 1) throw new TRPCError({ code: 'CONFLICT', message: `图片 #${target.imageId} 对应多个候选，请先核对，未重新购买。` });
      const image = [...candidates.values()][0];
      if (image) { item.status = 'done'; item.result = { imageId: image.id, imageUrl: image.imageUrl }; }
      else if (legacyQuote) { item.status = 'unknown'; item.error = '旧报价尚无完成回执，先核对原任务，不能重复购买。'; }
    }
    items.push(item);
  }
  return { renderRoute: plan.renderRoute ?? 'precision', storyId: input.storyId, planMessageId: input.planMessageId, stableShotId: selection.stableShotId,
    shotNo: Number(shots[index].shotNo) || index + 1, unitEstimatedCny,
    remainingEstimatedCny: items.filter(item => item.status === 'ready').length * unitEstimatedCny, items };
}
