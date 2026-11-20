import { pictureRegionSchema, pictureRegionNote } from "./chatPictureRegion";
import { z } from 'zod';
import { hasRemovalTargetDescription, isImageObjectRemoval } from './imageObjectRemoval';
import { estimateStoryboardImageCost, estimateStoryboardMaskedEditCost } from './imageRenderCost';
import { formatComputeQuote } from './computeMoney';

import { inlineChatParts } from './inlineChatImages';
import { MAX_CHAT_IMAGE_REFS } from './chatImageRefs';

/** Only a review receipt lists a complete, ordered board. */
export function keyframeBoardImageIds(id: string, text: string): number[] {
  if (!id.startsWith('saved-photos:') || !/关键帧初稿|关键帧修订稿/.test(text)) return [];
  const ids = inlineChatParts(text).flatMap(part => part.imageId ? [part.imageId] : []);
  return new Set(ids).size === ids.length ? ids : [];
}

/** Intent only. This persisted record must never contain payment authorization. */
export const chatImageEditPlanSchema = z.object({
  status: z.enum(['draft', 'submitted']),
  renderRoute: z.enum(['precision', 'storyboard']).optional(),
  regionScanSourceId: z.number().int().positive().optional(),
  keyframeBoardId: z.string().startsWith('saved-photos:').max(500).optional(),
  mode: z.enum(['separate', 'compose']),
  images: z.array(z.object({
    imageId: z.number().int().positive(),
    imageUrl: z.string().min(1),
    label: z.string(),
    role: z.enum(['undecided', 'target', 'reference', 'omit']),
    copies: z.number().int().min(1).max(4),
    purpose: z.string().max(1000),
    region: pictureRegionSchema.optional(),
  })).min(1).max(15).refine(images => new Set(images.map(image => image.imageId)).size === images.length),
  changes: z.string().max(2000),
  preserve: z.string().max(1000),
  details: z.string().max(1000),
}).refine(plan => plan.regionScanSourceId ? Boolean(plan.keyframeBoardId && plan.mode === "separate" &&
  plan.images.length <= 12 && plan.images.some(i => i.imageId === plan.regionScanSourceId && i.region) &&
  plan.images.every(i => i.copies === 1 && (i.role === "omit" || i.role === "target" && i.region)) &&
  (plan.status === "draft" || plan.images.some(i => i.role === "target"))) : plan.keyframeBoardId
  ? plan.mode === 'separate' && plan.images.every(i => i.copies === 1 && ['target', 'reference'].includes(i.role)) && plan.images.some(i => i.role === 'target') && plan.images.filter(i => i.role === 'target').length <= 12 &&
    plan.images.filter(i => i.role === 'reference').length < MAX_CHAT_IMAGE_REFS
  : plan.images.length <= MAX_CHAT_IMAGE_REFS);
export type ChatImageEditPlan = z.infer<typeof chatImageEditPlanSchema>;

// A committed form is a new chat record. Stale-body merges deliberately keep
// existing messages, so mutating the original form ID cannot commit its fields.
export const localEraseReceiptId = (planId: string) => "saved-photos:keyframe-revision:local-erase:" + planId;
export const confirmedImageEditPlanId = (sourceId: string) => `image-edit-confirmed:${sourceId}`;
export const adjustedImageEditPlanId = (sourceId: string) => `image-edit-adjusted:${sourceId}`;

export function imageEditPlanOutput(plan: ChatImageEditPlan, imageId: number, copy: number) {
  const error = imageEditPlanError(plan);
  if (error) throw new Error(error);
  if (plan.status !== 'submitted') throw new Error('请先确认修改要求。');
  if (!plan.preserve.trim()) throw new Error('请补充必须保留的内容，再准备报价。');
  const target = plan.images.find(image => image.imageId === imageId && image.role === 'target');
  if (!target || !Number.isInteger(copy) || copy < 1 || copy > target.copies) throw new Error('待修改图片或张数已变化，请重新核对。');
  const refs = [target, ...plan.images.filter(image => image.imageId !== imageId &&
    (plan.keyframeBoardId ? image.role === 'reference' : image.role !== 'omit'))];
  return {
    refs: refs.map(({ imageId, imageUrl, label }) => ({ imageId, imageUrl, label })),
    instruction: [
      `本次只修改图片 #${imageId}，输出第 ${copy}/${target.copies} 张独立候选；其他图片仅按下面说明参考，不同时修改，不拼贴。`,
      `这张图的要求：${target.purpose}`,
      ...(plan.regionScanSourceId && target.region ? ["仅修改这张原图的定位范围 " +
        pictureRegionNote(target.region, {text:"",object:"",available:false}, false)] : []),
      `共同修改要求：${plan.changes}`,
      `必须保留：${plan.preserve}`,
      `层次、配色和其他要求：${plan.details}`,
      ...refs.slice(1).map(image => `参考图片 #${image.imageId}：${image.purpose || '仅在共同修改要求明确点名时参考，不借用其构图或主体。'}`),
      '所有图片编号均为仓库ID；当前底图是图1。只输出这张底图的新候选，保留原图，不替换当前剪辑。',
    ].join('\n'),
  };
}

export function createChatImageEditPlan(
  refs: Array<{ imageId: number; imageUrl: string; label: string }>, instruction: string,
): ChatImageEditPlan {
  return {
    status: 'draft', mode: 'separate', changes: instruction,
    preserve: isImageObjectRemoval(instruction) ? '未要求修改的主体与背景保持原样；保留对象的大小、颜色、形状、位置及原有明暗不变。' : '', details: '',
    images: refs.map(ref => ({ ...ref, role: refs.length === 1 ? 'target' : 'undecided', copies: 1, purpose: '' })),
  };
}

export function imageEditPlanQuote(plan: ChatImageEditPlan) {
  const targets = plan.images.filter(image => image.role === 'target');
  const economy = plan.renderRoute === 'storyboard';
  const unit = economy ? estimateStoryboardImageCost() : estimateStoryboardMaskedEditCost();
  const tasks = targets.reduce((sum, image) => sum + (economy ? 1 : image.copies), 0);
  return { unitCny: unit.estimatedCny, totalCny: Number((unit.estimatedCny * tasks).toFixed(2)), candidates: tasks * unit.candidateCount, tasks };
}

export function imageEditPlanOutputCount(plan: ChatImageEditPlan): number {
  return plan.images.reduce((count, image) => count + (image.role === 'target' ? image.copies : 0), 0);
}

export function imageEditPlanError(plan: ChatImageEditPlan): string | null {
  if (!chatImageEditPlanSchema.safeParse(plan).success) return '图片或张数无效，请重新核对。';
  if (plan.images.some(image => image.role === 'undecided')) return '请明确每张图片的用途：待修改、仅参考或不用。';
  const targets = plan.images.filter(image => image.role === 'target');
  if (!targets.length) return '请选择至少一张待修改的图片。';
  if (plan.mode === 'compose' && targets.length !== 1) return '合成模式需要明确一张底图，其余图片设为参考。';
  if (plan.images.some(image => image.role === 'reference' && !image.purpose.trim())) return '请说明参考图用于配色、层次、构图还是其他部分。';
  if (!plan.changes.trim()) return '请说明这次需要修改的地方。';
  if (isImageObjectRemoval(plan.changes) && targets.some(image => !(plan.regionScanSourceId && image.region) && !hasRemovalTargetDescription(`${plan.changes}\n${image.purpose}`)))
    return '请在图片说明中明确删除或保留哪一个（位置、大小或颜色），避免误删其他物体。';
  return null;
}

/** Stable image IDs retain their meaning even when each target later becomes the base. */
export function imageEditPlanReply(plan: ChatImageEditPlan, generationEstimate?: number): string {
  return [
    `改图要求确认：${plan.mode === 'separate' ? '每张原图分别修改' : '按一张底图合成'}，共 ${imageEditPlanQuote(plan).candidates} 张新候选。`,
    ...plan.images.map(image => `[[ref:image%3A${image.imageId}]] 图片 #${image.imageId}：${image.role === 'target'
      ? `${plan.mode === 'separate' ? '分别修改' : '合成底图'}，生成 ${plan.renderRoute === 'storyboard' ? 4 : image.copies} 张`
      : image.role === 'reference' ? '仅作参考，不生成' : '本次不用'}${image.purpose.trim() ? `；${image.purpose.trim()}` : ''}`),
    `要修改：${plan.changes.trim()}`,
    `必须保留：${plan.preserve.trim() || '尚未补充，请先问清楚，不能默认可改动其他内容。'}`,
    ...(plan.details.trim() ? [`其他要求：${plan.details.trim()}`] : []),
    generationEstimate === undefined
      ? '这次只确认要求，不批准付费生成或采用。先核对修改和保护范围，再按实际输出张数报价。'
      : `确认以上要求和预计合计 ${formatComputeQuote(generationEstimate)}，生成 ${imageEditPlanQuote(plan).candidates} 张新候选；结果存入仓库，不替换当前剪辑。`,
  ].join('\n');
}
