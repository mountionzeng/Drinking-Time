import { expect, it } from 'vitest';
import { createChatImageEditPlan, imageEditPlanOutput } from '@shared/chatImageEditPlan';
import { buildChatImageRemixRequest } from '@shared/chatImageRefs';
import { estimateStoryboardMaskedEditCost } from '@shared/imageRenderCost';
import { imageEditGenerationError, imageEditPurchaseError, type ImageEditPurchase } from './imageEditPurchase';
import type { ImageEditBatch } from '../../../../server/services/chatImageEditBatch';

function fixture() {
  const plan = createChatImageEditPlan([11, 22].map(imageId => ({ imageId, imageUrl: `/${imageId}.png`, label: `#${imageId}` })), '只改树冠');
  plan.status = 'submitted'; plan.preserve = '保留飞机'; plan.images.forEach(image => { image.role = 'target'; });
  const unitEstimatedCny = estimateStoryboardMaskedEditCost().estimatedCny;
  const approval: ImageEditPurchase = { storyId: 1, planMessageId: 'p', stableShotId: 's3', plan, unitEstimatedCny };
  const batch: ImageEditBatch = { storyId: 1, planMessageId: 'p', stableShotId: 's3', shotNo: 3, unitEstimatedCny, remainingEstimatedCny: unitEstimatedCny * 2,
    items: plan.images.map(image => ({ imageId: image.imageId, imageUrl: image.imageUrl, copy: 1, requestId: `${image.imageId}`, status: 'ready', request: buildChatImageRemixRequest(imageEditPlanOutput(plan, image.imageId, 1)) as ImageEditBatch['items'][number]['request'] })) };
  return { approval, batch };
}

it('requires preservation and a valid final prompt before showing an enabled purchase action', () => {
  const { approval } = fixture();
  expect(imageEditGenerationError(approval.plan)).toBeNull();
  approval.plan.preserve = ''; expect(imageEditGenerationError(approval.plan)).toContain('必须保留');
  approval.plan.preserve = '保留飞机'; approval.plan.details = 'x'.repeat(2000);
  expect(imageEditGenerationError(approval.plan)).toBeTruthy();
  approval.plan.details = 'x'.repeat(1000); approval.plan.changes = 'x'.repeat(1500);
  expect(imageEditGenerationError(approval.plan)).toContain('2000');
});

it('accepts only the clicked plan and current quote, reusing already completed outputs', () => {
  const { approval, batch } = fixture(); expect(imageEditPurchaseError(approval, batch)).toBeNull();
  batch.items[0].status = 'done'; batch.remainingEstimatedCny /= 2;
  expect(imageEditPurchaseError(approval, batch)).toBeNull();
});

it.each(['story', 'plan', 'shot', 'price', 'count', 'instructions', 'reference', 'unknown'])(
  'blocks generation if the saved %s differs from the clicked form', kind => {
    const { approval, batch } = fixture();
    if (kind === 'story') batch.storyId++;
    if (kind === 'plan') batch.planMessageId = 'other';
    if (kind === 'shot') batch.stableShotId = 'other';
    if (kind === 'price') batch.unitEstimatedCny++;
    if (kind === 'count') batch.items.pop();
    if (kind === 'instructions') batch.items[0].request.explicitInstruction = 'different';
    if (kind === 'reference') batch.items[0].request.referenceImageUrl = '/other.png';
    if (kind === 'unknown') batch.items[0].status = 'unknown';
    expect(imageEditPurchaseError(approval, batch)).toBeTruthy();
  });
