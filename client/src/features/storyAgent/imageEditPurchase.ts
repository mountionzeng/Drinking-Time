import { imageEditPlanError, imageEditPlanOutput, type ChatImageEditPlan } from '@shared/chatImageEditPlan';
import { buildChatImageRemixRequest } from '@shared/chatImageRefs';
import type { ImageEditBatch } from '../../../../server/services/chatImageEditBatch';

/** Exists only between an explicit priced click and its submission; never archived. */
export type ImageEditPurchase = {
  storyId: number; planMessageId: string; stableShotId: string;
  unitEstimatedCny: number; plan: ChatImageEditPlan;
};

function outputs(plan: ChatImageEditPlan) {
  return plan.images.filter(image => image.role === 'target').flatMap(image =>
    Array.from({ length: plan.renderRoute === 'storyboard' ? 1 : image.copies }, (_, index) => ({ imageId: image.imageId, copy: index + 1,
      output: imageEditPlanOutput({ ...plan, status: 'submitted' }, image.imageId, index + 1) })));
}

export function imageEditGenerationError(plan: ChatImageEditPlan): string | null {
  const error = imageEditPlanError(plan);
  if (error) return error;
  if (!plan.preserve.trim()) return '请补充必须保留的内容，再确认生成。';
  return outputs(plan).some(item => item.output.instruction.length > 2000)
    ? '合并后的单图要求超过2000字，请精简要求后生成。' : null;
}

/** Saving a form may race another edit. Verify its entire request before spending. */
export function imageEditPurchaseError(approval: ImageEditPurchase, batch: ImageEditBatch): string | null {
  if (approval.storyId !== batch.storyId || approval.planMessageId !== batch.planMessageId || approval.stableShotId !== batch.stableShotId)
    return '故事或修改要求已变化，请重新核对后生成。';
  if ((approval.plan.renderRoute ?? 'precision') !== (batch.renderRoute ?? 'precision') || approval.unitEstimatedCny !== batch.unitEstimatedCny)
    return '预计费用已变化，请核对新报价后生成。';
  const error = imageEditGenerationError(approval.plan);
  if (error) return error;
  const expected = outputs(approval.plan);
  if (expected.length !== batch.items.length || expected.some((item, index) => {
    const actual = batch.items[index];
    const request = buildChatImageRemixRequest(item.output);
    return item.imageId !== actual.imageId || item.copy !== actual.copy ||
      JSON.stringify(request) !== JSON.stringify(actual.request);
  })) return '已保存的图片、张数或修改要求与本次确认不一致，未提交生成。';
  if (batch.items.some(item => !['ready', 'done'].includes(item.status)))
    return '原任务尚未完成，请先查询回执，不重新购买。';
  return null;
}
